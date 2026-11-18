'use strict';
/**
 * Seed dữ liệu UniVerse – AN TOÀN, KHÔNG xóa/ghi đè dữ liệu đang có:
 *  1. Cấu hình tiết học mặc định 1–10 (sáng 1–5, chiều 6–10) – CHƯA có giờ (không tự đoán giờ học).
 *     Chỉ tạo nếu bảng class_periods đang trống.
 *  2. (Chỉ khi NODE_ENV=development) tài khoản & dữ liệu DEMO, đánh dấu isDemo = true.
 *     Bỏ qua nếu tài khoản demo đã tồn tại.
 *
 * Chạy: npm run db:seed
 * Mật khẩu demo: biến SEED_DEMO_PASSWORD (mặc định "Demo@2026" – CHỈ dùng trên máy phát triển).
 */
const path = require('node:path');
const fs = require('node:fs');
const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { expandDates } = require('../src/modules/schedule/schedule.logic');

const prisma = new PrismaClient();
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Demo@2026';
const d = (iso) => new Date(`${iso}T00:00:00.000Z`);

async function seedClassPeriods() {
  const count = await prisma.classPeriod.count();
  if (count) {
    console.log(`• Class periods: đã có ${count} tiết – giữ nguyên.`);
    return;
  }
  await prisma.classPeriod.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({ periodNumber: i + 1, shift: i < 5 ? 'MORNING' : 'AFTERNOON', startTime: null, endTime: null })),
  });
  console.log('• Class periods: đã tạo tiết 1–10 (chưa có giờ – quản trị viên tự cấu hình).');
}

function isoAddDays(base, n) {
  const x = new Date(base.getTime() + n * 86400000);
  return x.toISOString().slice(0, 10);
}

async function seedDemo() {
  if (process.env.NODE_ENV !== 'development') {
    console.log('• Bỏ qua dữ liệu demo (chỉ tạo khi NODE_ENV=development).');
    return;
  }
  const exists = await prisma.user.findUnique({ where: { email: 'demo.student@universe.local' } });
  if (exists) {
    console.log('• Dữ liệu demo đã tồn tại – bỏ qua.');
    return;
  }
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const [admin, student, friend] = await Promise.all([
    prisma.user.create({ data: { email: 'demo.admin@universe.local', passwordHash: hash, fullName: 'Quản trị Demo', role: 'ADMIN', isDemo: true, university: 'Trường Demo' } }),
    prisma.user.create({ data: { email: 'demo.student@universe.local', passwordHash: hash, fullName: 'Sinh viên Demo', role: 'STUDENT', isDemo: true, university: 'Trường Demo', major: 'Công nghệ thông tin', className: 'DEMO01' } }),
    prisma.user.create({ data: { email: 'demo.moderator@universe.local', passwordHash: hash, fullName: 'Kiểm duyệt Demo', role: 'MODERATOR', isDemo: true } }),
  ]);

  // Lịch học demo: bắt đầu từ thứ 2 của tuần hiện tại, kéo dài 6 tuần
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (((now.getUTCDay() || 7) - 1))));
  const start = monday.toISOString().slice(0, 10);
  const end = isoAddDays(monday, 41);
  const semester = await prisma.semester.create({ data: { userId: student.id, name: 'Học kỳ Demo', academicYear: `${now.getFullYear()}-${now.getFullYear() + 1}`, isCurrent: true, startDate: d(start), endDate: d(end) } });
  const subjects = [
    { name: '[Demo] Cấu trúc dữ liệu', code: 'DEMO101', credits: 3, color: '#2563EB', sessions: [{ day: 2, s: 1, e: 3, room: 'A101' }, { day: 4, s: 1, e: 3, room: 'A101' }] },
    { name: '[Demo] Mạng máy tính', code: 'DEMO202', credits: 3, color: '#10B981', sessions: [{ day: 3, s: 6, e: 8, room: 'B205' }] },
    { name: '[Demo] Toán rời rạc', code: 'DEMO303', credits: 2, color: '#F59E0B', sessions: [{ day: 5, s: 4, e: 5, room: 'C303' }] },
  ];
  for (const s of subjects) {
    const subject = await prisma.subject.create({ data: { userId: student.id, semesterId: semester.id, name: s.name, code: s.code, credits: s.credits, color: s.color, classCode: `${s.code}-01` } });
    const period = await prisma.schedulePeriod.create({ data: { subjectId: subject.id, startDate: d(start), endDate: d(end), rawText: '[Dữ liệu demo]' } });
    for (const x of s.sessions) {
      const session = await prisma.classSession.create({ data: { periodId: period.id, dayOfWeek: x.day, startPeriod: x.s, endPeriod: x.e, periods: Array.from({ length: x.e - x.s + 1 }, (_, i) => x.s + i).join(','), room: x.room } });
      await prisma.classMeeting.createMany({ data: expandDates(start, end, x.day).map((date) => ({ userId: student.id, subjectId: subject.id, sessionId: session.id, date: d(date), startPeriod: x.s, endPeriod: x.e, room: x.room })) });
    }
    s.id = subject.id;
  }

  await prisma.task.createMany({
    data: [
      { userId: student.id, title: '[Demo] Bài tập cây nhị phân', subjectId: subjects[0].id, priority: 'HIGH', dueAt: new Date(Date.now() + 2 * 86400000) },
      { userId: student.id, title: '[Demo] Đọc chương 3 – Định tuyến', subjectId: subjects[1].id, status: 'IN_PROGRESS', dueAt: new Date(Date.now() + 5 * 86400000) },
      { userId: student.id, title: '[Demo] Ôn tập quan hệ & hàm', subjectId: subjects[2].id, status: 'DONE', completedAt: new Date() },
    ],
  });

  const content = {
    blocks: [
      { id: 'd1', type: 'heading2', text: 'Ghi chú demo – Cấu trúc dữ liệu' },
      { id: 'd2', type: 'paragraph', text: 'Đây là dữ liệu mẫu cho môi trường phát triển.' },
      { id: 'd3', type: 'bullet', text: 'Mảng, danh sách liên kết' },
      { id: 'd4', type: 'bullet', text: 'Ngăn xếp, hàng đợi' },
      { id: 'd5', type: 'todo', text: 'Cài đặt cây BST', checked: false },
      { id: 'd6', type: 'code', language: 'js', text: 'function height(n) {\n  return n ? 1 + Math.max(height(n.left), height(n.right)) : 0;\n}' },
    ],
  };
  await prisma.note.create({ data: { userId: student.id, subjectId: subjects[0].id, title: '[Demo] Tổng quan CTDL', icon: '📘', content, contentText: content.blocks.map((b) => b.text).join('\n') } });

  const group = await prisma.group.create({
    data: { ownerId: student.id, name: '[Demo] Nhóm học CTDL', description: 'Nhóm học tập mẫu', joinCode: 'DEMO2026', members: { create: [{ userId: student.id, role: 'LEADER' }, { userId: friend.id, role: 'MEMBER' }] } },
  });
  await prisma.task.create({ data: { userId: student.id, groupId: group.id, assigneeId: friend.id, title: '[Demo] Chuẩn bị slide thuyết trình', dueAt: new Date(Date.now() + 4 * 86400000) } });

  await prisma.post.create({
    data: { authorId: student.id, type: 'ARTICLE', title: '[Demo] Mẹo học Cấu trúc dữ liệu hiệu quả', content: '## Mẹo\n\n- Vẽ hình minh họa cho mỗi thao tác\n- Tự cài đặt lại từ đầu\n- Luyện bài tập theo chủ đề', subjectName: 'Cấu trúc dữ liệu', topic: 'Phương pháp học' },
  });

  console.log('• Đã tạo dữ liệu DEMO (development):');
  console.log('    demo.student@universe.local / demo.admin@universe.local / demo.moderator@universe.local');
  console.log(`    Mật khẩu: ${process.env.SEED_DEMO_PASSWORD ? '(giá trị SEED_DEMO_PASSWORD)' : DEMO_PASSWORD}`);
  void admin;
}

(async () => {
  try {
    await seedClassPeriods();
    await seedDemo();
  } catch (err) {
    console.error('Seed thất bại:', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
