'use strict';
/**
 * Kiểm thử API & luồng nghiệp vụ chính trên database thật.
 * Tự động BỎ QUA nếu chưa kết nối được MySQL (chưa cấu hình DATABASE_URL hoặc chưa chạy migration).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prisma, client, registeredUser, cleanup, dbAvailable, waitFor } = require('../helpers');

let ok = false;
let A;
let B;

test.before(async () => {
  ok = await dbAvailable();
  if (!ok) return;
  A = await registeredUser('alice');
  B = await registeredUser('bob');
});
test.after(async () => {
  if (ok) await cleanup();
  await prisma.$disconnect();
});
const need = (t) => {
  if (!ok) {
    t.skip('Chưa kết nối được MySQL – cấu hình DATABASE_URL và chạy "npm run db:deploy"');
    return false;
  }
  return true;
};

// ---------------------------------------------------------------- Auth
test('auth: CSRF bắt buộc cho request thay đổi dữ liệu', async (t) => {
  if (!need(t)) return;
  const c = await client();
  const res = await c.agent.post('/api/v1/auth/login').send({ email: A.email, password: 'Passw0rd!x' });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'CSRF');
});

test('auth: đăng ký trùng email => 409, sai mật khẩu => 401, validation => 422', async (t) => {
  if (!need(t)) return;
  const c = await client();
  assert.equal((await c.post('/api/v1/auth/register', { email: A.email, password: 'Passw0rd!x', fullName: 'Dup' })).status, 409);
  assert.equal((await c.post('/api/v1/auth/login', { email: A.email, password: 'sai-mat-khau1' })).status, 401);
  const v = await c.post('/api/v1/auth/register', { email: 'not-an-email', password: '123', fullName: 'x' });
  assert.equal(v.status, 422);
  assert.ok(v.body.details.length >= 2);
});

test('auth: đăng nhập / trạng thái / đăng xuất; mật khẩu không bao giờ trả về', async (t) => {
  if (!need(t)) return;
  const c = await client();
  const login = await c.post('/api/v1/auth/login', { email: A.email, password: 'Passw0rd!x' });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.user.passwordHash, undefined);
  const st = await c.get('/api/v1/auth/status');
  assert.equal(st.body.data.authenticated, true);
  assert.equal((await c.post('/api/v1/auth/logout')).status, 200);
  assert.equal((await c.get('/api/v1/users/me')).status, 401);
});

test('auth: đổi mật khẩu', async (t) => {
  if (!need(t)) return;
  const c = await registeredUser('pw');
  assert.equal((await c.post('/api/v1/auth/change-password', { currentPassword: 'wrongpass1', newPassword: 'NewPassw0rd' })).status, 400);
  assert.equal((await c.post('/api/v1/auth/change-password', { currentPassword: 'Passw0rd!x', newPassword: 'NewPassw0rd' })).status, 200);
  const c2 = await client();
  assert.equal((await c2.post('/api/v1/auth/login', { email: c.email, password: 'NewPassw0rd' })).status, 200);
});

test('phân quyền vai trò: Student không vào được API Admin/Moderator', async (t) => {
  if (!need(t)) return;
  assert.equal((await A.get('/api/v1/users')).status, 403);
  assert.equal((await A.get('/api/v1/community/moderation/reports')).status, 403);
  assert.equal((await A.put('/api/v1/system/class-periods', { periods: [{ periodNumber: 1, shift: 'MORNING' }] })).status, 403);
});

// ---------------------------------------------------------------- UniSchedule + KMA
test('UniSchedule: import KMA (.xls) – preview chưa lưu, confirm mới lưu, sinh đúng buổi học, phát hiện xung đột', async (t) => {
  if (!need(t)) return;
  const file = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kma-anonymized.xls'));
  const pv = await A.upload('/api/v1/schedules/import/preview', 'file', file, 'tkb.xls');
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  const p = pv.body.data;
  assert.equal(p.adapter, 'kma');
  assert.equal(p.subjects.length, 7);
  assert.equal(p.stats.totalCredits, 21);
  assert.ok(p.conflicts.length >= 1, 'phải phát hiện xung đột HP001 vs HP006');
  // Chưa có môn nào được lưu
  assert.equal((await A.get('/api/v1/schedules/subjects')).body.data.length, 0);

  const confirm = await A.post(`/api/v1/schedules/import/${p.importId}/confirm`, {
    newSemester: { name: 'HK test', academicYear: '2026-2027' },
    subjects: p.subjects.map((s) => ({ ...s, include: true })),
  });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.equal(confirm.body.data.created, 7);
  assert.equal(confirm.body.data.meetings, p.stats.meetingCount);

  const subjects = (await A.get('/api/v1/schedules/subjects')).body.data;
  assert.equal(subjects.length, 7);
  const hp1 = subjects.find((s) => s.code === 'HP001');
  assert.equal(hp1.periods.length, 3);
  assert.equal(hp1._count.meetings, 8);

  const meetings = (await A.get('/api/v1/schedules/meetings?from=2026-08-10&to=2026-08-16')).body.data;
  // Tuần 10–16/08: HP001 T3,T5 + HP002 T2,T6 + HP004 T7 + HP005 T2,T4 + HP006 T3 = 8 buổi
  assert.equal(meetings.length, 8);
  for (const m of meetings) assert.ok(m.date >= '2026-08-10' && m.date <= '2026-08-16');
  const conflicts = (await A.get('/api/v1/schedules/conflicts?from=2026-08-10&to=2026-08-16')).body.data;
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].date, '2026-08-11');

  // Import lần 2 cùng học kỳ, chế độ skip => không nhân bản
  const pv2 = (await A.upload('/api/v1/schedules/import/preview', 'file', file, 'tkb.xls')).body.data;
  assert.ok(pv2.stats.existingConflicts > 0, 'phải cảnh báo trùng với lịch đã có');
  const again = await A.post(`/api/v1/schedules/import/${pv2.importId}/confirm`, { semesterId: confirm.body.data.semesterId, duplicateMode: 'skip', subjects: pv2.subjects.map((s) => ({ ...s, include: true })) });
  assert.equal(again.body.data.created, 0);
  assert.equal(again.body.data.skipped, 7);

  // Người khác không xem được
  assert.equal((await B.get(`/api/v1/schedules/subjects/${hp1.id}`)).status, 404);
  assert.equal((await B.get('/api/v1/schedules/meetings?from=2026-08-10&to=2026-08-16')).body.data.length, 0);
});

test('UniSchedule: file thiếu cột => 422 với thông báo rõ ràng', async (t) => {
  if (!need(t)) return;
  const file = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kma-missing-column.xls'));
  const r = await A.upload('/api/v1/schedules/import/preview', 'file', file, 'x.xls');
  assert.equal(r.status, 422);
  assert.match(r.body.message, /Thời gian địa điểm/);
});

test('UniSchedule: tạo môn thủ công với nhiều khoảng lịch', async (t) => {
  if (!need(t)) return;
  const r = await B.post('/api/v1/schedules/subjects', {
    name: 'Môn thủ công',
    credits: 2,
    periods: [
      { startDate: '2026-09-07', endDate: '2026-09-20', sessions: [{ dayOfWeek: 1, startPeriod: 1, endPeriod: 2, room: 'P1' }] },
      { startDate: '2026-09-21', endDate: '2026-09-27', sessions: [{ dayOfWeek: 3, startPeriod: 6, endPeriod: 8, room: 'P2' }] },
    ],
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.data._count.meetings, 3); // 07/09, 14/09 (T2) + 23/09 (T4)
  const bad = await B.post('/api/v1/schedules/subjects', { name: 'X', periods: [{ startDate: '2026-09-10', endDate: '2026-09-01', sessions: [{ dayOfWeek: 1, startPeriod: 1, endPeriod: 2 }] }] });
  assert.equal(bad.status, 422);
});

// ---------------------------------------------------------------- UniDrive
test('UniDrive: upload TXT, trích xuất văn bản, tìm nội dung; quyền truy cập file', async (t) => {
  if (!need(t)) return;
  const content = Buffer.from('Giao thức định tuyến OSPF sử dụng thuật toán Dijkstra để tìm đường đi ngắn nhất.\n'.repeat(5));
  const up = await A.upload('/api/v1/drive/upload', 'files', content, 'mang-may-tinh.txt');
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const file = up.body.data.files[0];
  assert.equal(file.extension, 'txt');
  await waitFor(async () => (await prisma.document.findUnique({ where: { fileId: file.id } }))?.status === 'READY');
  const search = await A.get('/api/v1/drive?search=Dijkstra');
  assert.ok(search.body.data.files.some((f) => f.id === file.id && f.match));
  const all = await A.get('/api/v1/search?q=OSPF');
  assert.ok(all.body.data.results.files.some((f) => f.id === file.id));
  // Người khác không tải / không tìm thấy được
  assert.equal((await B.get(`/api/v1/drive/files/${file.id}/download`)).status, 404);
  assert.equal((await B.get('/api/v1/search?q=OSPF')).body.data.results.files.length, 0);
  // Tải về OK cho chủ sở hữu, header an toàn
  const dl = await A.get(`/api/v1/drive/files/${file.id}/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers['x-content-type-options'], 'nosniff');
  assert.match(dl.headers['content-disposition'], /attachment/);
});

test('UniDrive: từ chối file giả mạo phần mở rộng (nội dung không khớp)', async (t) => {
  if (!need(t)) return;
  const fake = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // header file .exe
  const r = await A.upload('/api/v1/drive/upload', 'files', fake, 'bai-giang.pdf');
  assert.equal(r.status, 201);
  assert.equal(r.body.data.files.length, 0);
  assert.equal(r.body.data.rejected.length, 1);
});

test('UniDrive: thư mục, di chuyển, xóa mềm & khôi phục', async (t) => {
  if (!need(t)) return;
  const f1 = (await A.post('/api/v1/drive/folders', { name: 'Học kỳ 1' })).body.data;
  const f2 = (await A.post('/api/v1/drive/folders', { name: 'Con', parentId: f1.id })).body.data;
  assert.equal((await A.post('/api/v1/drive/folders', { name: 'Học kỳ 1' })).status, 409);
  assert.equal((await A.patch(`/api/v1/drive/folders/${f1.id}`, { parentId: f2.id })).status, 400, 'không cho chuyển vào thư mục con');
  assert.equal((await A.del(`/api/v1/drive/folders/${f1.id}`)).status, 200);
  const trash = (await A.get('/api/v1/library/trash')).body.data;
  assert.ok(trash.some((x) => x.entityType === 'FOLDER' && x.entityId === f1.id));
  assert.equal((await A.post('/api/v1/library/trash/restore', { entityType: 'FOLDER', entityId: f1.id })).status, 200);
  const list = (await A.get(`/api/v1/drive?folderId=${f1.id}`)).body.data;
  assert.ok(list.folders.some((x) => x.id === f2.id), 'thư mục con được khôi phục cùng');
});

// ---------------------------------------------------------------- UniNote
test('UniNote: tạo, tự động lưu có version, chống ghi đè (409), quyền truy cập', async (t) => {
  if (!need(t)) return;
  const n = (await A.post('/api/v1/notes', { title: 'Ghi chú test' })).body.data;
  const blocks = [{ id: 'b1', type: 'heading1', text: 'Tiêu đề' }, { id: 'b2', type: 'todo', text: 'Việc', checked: true }, { id: 'b3', type: 'table', text: '', rows: [['a', 'b'], ['1', '2']] }];
  const s1 = await A.patch(`/api/v1/notes/${n.id}`, { version: n.version, content: { blocks } });
  assert.equal(s1.status, 200);
  assert.equal(s1.body.data.version, n.version + 1);
  const stale = await A.patch(`/api/v1/notes/${n.id}`, { version: n.version, title: 'cũ' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  const child = (await A.post('/api/v1/notes', { title: 'Trang con', parentId: n.id })).body.data;
  assert.equal(child.parentId, n.id);
  assert.equal((await B.get(`/api/v1/notes/${n.id}`)).status, 404);
  const xss = await A.patch(`/api/v1/notes/${n.id}`, { version: s1.body.data.version, content: { blocks: [{ id: 'x', type: 'link', text: 'x', url: 'javascript:alert(1)' }] } });
  assert.equal(xss.status, 422, 'chặn liên kết javascript:');
});

// ---------------------------------------------------------------- UniSheet
test('UniSheet: tạo workbook, lưu ô & công thức, export xlsx', async (t) => {
  if (!need(t)) return;
  const wb = (await A.post('/api/v1/sheets', { title: 'Bảng điểm' })).body.data;
  const sheet = wb.sheets[0];
  const save = await A.patch(`/api/v1/sheets/${wb.id}/sheets/${sheet.id}`, { version: sheet.version, cells: { A1: { v: '8' }, A2: { v: '6' }, A3: { v: '=AVERAGE(A1:A2)', s: { b: true } } } });
  assert.equal(save.status, 200);
  const conflict = await A.patch(`/api/v1/sheets/${wb.id}/sheets/${sheet.id}`, { version: sheet.version, cells: {} });
  assert.equal(conflict.status, 409);
  const exp = await A.agent.get(`/api/v1/sheets/${wb.id}/export?format=csv`).buffer(true);
  assert.equal(exp.status, 200);
  assert.match(exp.text || exp.body.toString(), /7/);
  assert.equal((await B.get(`/api/v1/sheets/${wb.id}`)).status, 404);
  const bad = await A.patch(`/api/v1/sheets/${wb.id}/sheets/${sheet.id}`, { cells: { 'A1; DROP': { v: 'x' } } });
  assert.equal(bad.status, 422);
});

// ---------------------------------------------------------------- UniTask
test('UniTask: tạo, liên kết môn học, Kanban reorder, thống kê, quyền', async (t) => {
  if (!need(t)) return;
  const subj = (await A.get('/api/v1/schedules/subjects/options')).body.data[0];
  const t1 = (await A.post('/api/v1/tasks', { title: 'Việc 1', subjectId: subj?.id, dueAt: new Date(Date.now() + 86400000).toISOString(), priority: 'HIGH' })).body.data;
  const t2 = (await A.post('/api/v1/tasks', { title: 'Việc 2' })).body.data;
  assert.equal(t1.subject?.id, subj?.id);
  assert.equal((await A.post('/api/v1/tasks/reorder', { status: 'DONE', orderedIds: [t2.id, t1.id] })).status, 200);
  const done = (await A.get('/api/v1/tasks?status=DONE&sort=manual')).body.data;
  assert.deepEqual(done.map((x) => x.id).slice(0, 2), [t2.id, t1.id]);
  assert.ok(done[0].completedAt);
  const stats = (await A.get('/api/v1/tasks/stats')).body.data;
  assert.ok(stats.counts.DONE >= 2);
  assert.equal((await B.patch(`/api/v1/tasks/${t1.id}`, { title: 'hack' })).status, 404);
  assert.equal((await B.post('/api/v1/tasks/reorder', { status: 'TODO', orderedIds: [t1.id] })).status, 400);
  // Không thể gắn môn học của người khác
  if (subj) assert.equal((await B.post('/api/v1/tasks', { title: 'x', subjectId: subj.id })).status, 400);
});

// ---------------------------------------------------------------- UniAI
test('UniAI: chưa cấu hình => 503 rõ ràng, không giả lập câu trả lời, không lưu tin nhắn', async (t) => {
  if (!need(t)) return;
  const st = (await A.get('/api/v1/ai/status')).body.data;
  assert.equal(st.configured, false);
  const c = (await A.post('/api/v1/ai/conversations', {})).body.data;
  const r = await A.post(`/api/v1/ai/conversations/${c.id}/messages`, { content: 'Xin chào' });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'AI_NOT_CONFIGURED');
  assert.equal((await A.get(`/api/v1/ai/conversations/${c.id}`)).body.data.messages.length, 0);
  assert.equal((await B.get(`/api/v1/ai/conversations/${c.id}`)).status, 404);
});

// ---------------------------------------------------------------- UniQuiz
test('UniQuiz: không lộ đáp án trước khi nộp; chấm điểm đúng; practice phản hồi từng câu', async (t) => {
  if (!need(t)) return;
  const set = (
    await A.post('/api/v1/quiz/sets', {
      title: 'Quiz test',
      questions: [
        { type: 'SINGLE', content: '1+1?', options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], correctAnswer: 'b', topic: 'Toán' },
        { type: 'MULTIPLE', content: 'Số chẵn?', options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }, { id: 'c', text: '4' }], correctAnswer: ['a', 'c'], topic: 'Toán' },
        { type: 'TRUE_FALSE', content: 'Trái đất phẳng', correctAnswer: false, topic: 'Địa' },
        { type: 'SHORT', content: 'Thủ đô Việt Nam?', correctAnswer: ['Hà Nội'], topic: 'Địa' },
      ],
    })
  ).body.data;
  assert.equal(set.questions.length, 4);
  const bad = await A.post('/api/v1/quiz/sets', { title: 'x', questions: [{ type: 'SINGLE', content: 'q', options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], correctAnswer: 'z' }] });
  assert.equal(bad.status, 422);

  const start = (await A.post(`/api/v1/quiz/sets/${set.id}/attempts`, { mode: 'MOCK', timeLimitMin: 10 })).body.data;
  const raw = JSON.stringify(start.questions);
  assert.ok(!raw.includes('correctAnswer') && !raw.includes('explanation'), 'không gửi đáp án xuống frontend');
  const byContent = Object.fromEntries(start.questions.map((q) => [q.content, q.id]));
  const answers = [
    { questionId: byContent['1+1?'], answer: 'b' },
    { questionId: byContent['Số chẵn?'], answer: ['c', 'a'] },
    { questionId: byContent['Trái đất phẳng'], answer: true },
    { questionId: byContent['Thủ đô Việt Nam?'], answer: 'ha noi' },
  ];
  const during = await A.get(`/api/v1/quiz/attempts/${start.attempt.id}`);
  assert.ok(!JSON.stringify(during.body.data).includes('correctAnswer'));
  const sub = (await A.post(`/api/v1/quiz/attempts/${start.attempt.id}/submit`, { answers })).body.data;
  assert.equal(sub.attempt.correctCount, 3);
  assert.equal(sub.attempt.score, 7.5);
  assert.ok(sub.review.every((q) => 'correctAnswer' in q));
  assert.equal((await B.get(`/api/v1/quiz/attempts/${start.attempt.id}`)).status, 404);

  const pr = (await A.post(`/api/v1/quiz/sets/${set.id}/attempts`, { mode: 'PRACTICE' })).body.data;
  const q0 = pr.questions[0];
  const fb = await A.post(`/api/v1/quiz/attempts/${pr.attempt.id}/answer`, { questionId: q0.id, answer: q0.type === 'TRUE_FALSE' ? false : 'b' });
  assert.equal(fb.status, 200);
  assert.ok('correctAnswer' in fb.body.data);
  assert.equal((await A.post(`/api/v1/quiz/attempts/${pr.attempt.id}/answer`, { questionId: q0.id, answer: 'a' })).status, 400, 'không trả lời lại câu đã khóa');
  const stats = (await A.get('/api/v1/quiz/stats')).body.data;
  assert.equal(stats.totalAttempts, 1);
});

// ---------------------------------------------------------------- UniGroup
test('UniGroup: tạo, tham gia bằng mã, phân quyền trưởng nhóm, chia sẻ tài liệu', async (t) => {
  if (!need(t)) return;
  const g = (await A.post('/api/v1/groups', { name: 'Nhóm test' })).body.data;
  assert.ok(g.joinCode);
  assert.equal((await B.get(`/api/v1/groups/${g.id}`)).status, 404, 'chưa là thành viên');
  const joined = (await B.post('/api/v1/groups/join', { code: g.joinCode })).body.data;
  assert.equal(joined.myRole, 'MEMBER');
  assert.equal(joined.joinCode, undefined, 'thành viên thường không thấy mã mời');
  // Member không được giao việc cho người khác / không được xóa thành viên
  assert.equal((await B.post(`/api/v1/groups/${g.id}/tasks`, { title: 'x', assigneeId: A.user.id })).status, 403);
  assert.equal((await B.del(`/api/v1/groups/${g.id}/members/${A.user.id}`)).status, 403);
  // Leader giao việc cho B; B chỉ được đổi trạng thái
  const task = (await A.post(`/api/v1/groups/${g.id}/tasks`, { title: 'Làm slide', assigneeId: B.user.id })).body.data;
  assert.equal((await B.patch(`/api/v1/groups/${g.id}/tasks/${task.id}`, { title: 'đổi tên' })).status, 403);
  assert.equal((await B.patch(`/api/v1/groups/${g.id}/tasks/${task.id}`, { status: 'DONE' })).status, 200);
  // Việc nhóm hiện trong UniTask của B
  assert.ok((await B.get('/api/v1/tasks')).body.data.some((x) => x.id === task.id));
  // Thông báo giao việc
  const notif = (await B.get('/api/v1/notifications')).body.data;
  assert.ok(notif.items.some((n) => n.type === 'task.assigned'));
  // Chia sẻ file: chỉ file của chính mình
  const fileA = (await A.upload('/api/v1/drive/upload', 'files', Buffer.from('Tài liệu nhóm về cơ sở dữ liệu quan hệ'), 'nhom.txt')).body.data.files[0];
  assert.equal((await B.post(`/api/v1/groups/${g.id}/resources`, { type: 'FILE', fileId: fileA.id })).status, 404);
  assert.equal((await A.post(`/api/v1/groups/${g.id}/resources`, { type: 'FILE', fileId: fileA.id })).status, 201);
  assert.equal((await B.get(`/api/v1/drive/files/${fileA.id}/download`)).status, 200, 'thành viên tải được tài liệu chia sẻ');
  assert.equal((await B.del(`/api/v1/drive/files/${fileA.id}`)).status, 404, 'nhưng không xóa được');
  // Rời nhóm => mất quyền
  assert.equal((await B.post(`/api/v1/groups/${g.id}/leave`)).status, 200);
  assert.equal((await B.get(`/api/v1/drive/files/${fileA.id}/download`)).status, 404);
  assert.equal((await A.post(`/api/v1/groups/${g.id}/leave`)).status, 400, 'chủ nhóm không thể rời');
});

// ---------------------------------------------------------------- UniShare
test('UniShare: đăng bài, bản quyền, bình luận, đánh giá, báo cáo, kiểm duyệt', async (t) => {
  if (!need(t)) return;
  const fileB = (await B.upload('/api/v1/drive/upload', 'files', Buffer.from('Đề cương ôn tập môn Hệ điều hành'), 'de-cuong.txt')).body.data.files[0];
  assert.equal((await B.post('/api/v1/community/posts', { type: 'OUTLINE', title: 'Đề cương HĐH', content: 'Nội dung đề cương ôn tập', fileId: fileB.id })).status, 400, 'bắt buộc xác nhận bản quyền');
  const post = (await B.post('/api/v1/community/posts', { type: 'OUTLINE', title: 'Đề cương HĐH', content: 'Nội dung đề cương ôn tập', fileId: fileB.id, copyrightConfirmed: true, subjectName: 'Hệ điều hành' })).body.data;
  assert.equal((await A.get(`/api/v1/drive/files/${fileB.id}/download`)).status, 200, 'tài liệu đính kèm bài công khai tải được');
  assert.equal((await A.post(`/api/v1/community/posts/${post.id}/comments`, { content: 'Cảm ơn bạn!' })).status, 201);
  const rate = await A.put(`/api/v1/community/posts/${post.id}/rating`, { value: 5 });
  assert.equal(rate.body.data.ratingAvg, 5);
  assert.equal((await B.put(`/api/v1/community/posts/${post.id}/rating`, { value: 5 })).status, 400, 'không tự đánh giá');
  assert.equal((await A.patch(`/api/v1/community/posts/${post.id}`, { title: 'Sửa bài người khác' })).status, 403);
  assert.equal((await A.post('/api/v1/community/reports', { targetType: 'POST', targetId: post.id, reason: 'copyright' })).status, 201);
  assert.equal((await A.post('/api/v1/community/reports', { targetType: 'POST', targetId: post.id, reason: 'spam' })).status, 409);
  // Moderator xử lý
  const mod = await registeredUser('mod');
  await prisma.user.update({ where: { id: mod.user.id }, data: { role: 'MODERATOR' } });
  const reports = (await mod.get('/api/v1/community/moderation/reports?status=OPEN')).body.data;
  const rep = reports.find((r) => r.targetId === post.id);
  assert.ok(rep);
  assert.equal((await mod.post(`/api/v1/community/moderation/reports/${rep.id}/resolve`, { action: 'hide', note: 'Kiểm tra bản quyền' })).status, 200);
  assert.equal((await A.get(`/api/v1/community/posts/${post.id}`)).status, 404, 'bài bị ẩn không hiển thị với người khác');
  assert.equal((await B.get(`/api/v1/community/posts/${post.id}`)).status, 200, 'tác giả vẫn xem được');
  assert.equal((await A.get(`/api/v1/drive/files/${fileB.id}/download`)).status, 404, 'tài liệu của bài bị ẩn không còn công khai');
});

// ---------------------------------------------------------------- Thông báo, Favorites, Dashboard
test('Notification Center, Favorites, Recently Viewed, Dashboard dùng dữ liệu thật', async (t) => {
  if (!need(t)) return;
  const n = (await A.post('/api/v1/notes', { title: 'Yêu thích' })).body.data;
  assert.equal((await A.put('/api/v1/library/favorites', { entityType: 'NOTE', entityId: n.id, favorite: true })).status, 200);
  assert.ok((await A.get('/api/v1/library/favorites')).body.data.some((f) => f.entityId === n.id));
  assert.equal((await B.put('/api/v1/library/favorites', { entityType: 'NOTE', entityId: n.id, favorite: true })).status, 404, 'không yêu thích dữ liệu không có quyền');
  await A.get(`/api/v1/notes/${n.id}`);
  assert.ok((await A.get('/api/v1/library/recent')).body.data.some((r) => r.entityType === 'NOTE' && r.entityId === n.id));
  const dash = (await A.get('/api/v1/dashboard?today=2026-08-11')).body.data;
  assert.ok(dash.todayClasses.length >= 2, 'lịch học ngày 11/08 từ file import');
  assert.ok(dash.stats.subjects >= 7);
  const all = (await B.get('/api/v1/notifications')).body.data;
  if (all.items[0]) {
    assert.equal((await A.patch(`/api/v1/notifications/${all.items[0].id}`, { read: true })).status, 404, 'không đọc thông báo của người khác');
    assert.equal((await B.patch(`/api/v1/notifications/${all.items[0].id}`, { read: true })).status, 200);
  }
  assert.equal((await B.post('/api/v1/notifications/read-all')).status, 200);
  assert.equal((await B.get('/api/v1/notifications/unread-count')).body.data.unreadCount, 0);
});

test('Lỗi chuẩn hóa: 404 API, JSON hỏng, không lộ stack trace', async (t) => {
  if (!need(t)) return;
  const r = await A.get('/api/v1/khong-ton-tai');
  assert.equal(r.status, 404);
  assert.equal(r.body.success, false);
  const bad = await A.agent.post('/api/v1/tasks').set('X-CSRF-Token', A.token()).set('Content-Type', 'application/json').send('{"title":');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.stack, undefined);
});
