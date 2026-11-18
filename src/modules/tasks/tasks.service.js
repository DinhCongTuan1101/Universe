'use strict';
const prisma = require('../../database/prisma');
const activity = require('../../services/activity.service');
const ai = require('../../services/ai/ai.service');
const prompts = require('../../services/ai/prompts');
const { notFound, badRequest } = require('../../utils/errors');
const { fromDbDate } = require('../../utils/dates');

const TASK_INCLUDE = {
  subject: { select: { id: true, name: true, color: true } },
  classMeeting: { select: { id: true, date: true, startPeriod: true, endPeriod: true, room: true, subject: { select: { name: true } } } },
  group: { select: { id: true, name: true } },
  assignee: { select: { id: true, fullName: true } },
  _count: { select: { subtasks: { where: { deletedAt: null } } } },
};

function shape(t) {
  return t.classMeeting ? { ...t, classMeeting: { ...t.classMeeting, date: fromDbDate(t.classMeeting.date) } } : t;
}

async function ownTask(userId, id) {
  const t = await prisma.task.findFirst({ where: { id, userId, groupId: null, deletedAt: null } });
  if (!t) throw notFound('Không tìm thấy công việc');
  return t;
}

async function checkLinks(userId, { subjectId, classMeetingId, parentId }) {
  if (subjectId) {
    const s = await prisma.subject.findFirst({ where: { id: subjectId, userId, deletedAt: null } });
    if (!s) throw badRequest('Môn học không hợp lệ');
  }
  if (classMeetingId) {
    const m = await prisma.classMeeting.findFirst({ where: { id: classMeetingId, userId } });
    if (!m) throw badRequest('Buổi học không hợp lệ');
  }
  if (parentId) await ownTask(userId, parentId);
}

async function list(userId, q) {
  const where = { deletedAt: null };
  const scope = q.includeGroup
    ? { OR: [{ userId, groupId: null }, { assigneeId: userId, groupId: { not: null }, group: { deletedAt: null } }] }
    : { userId, groupId: null };
  const and = [scope];
  if (q.status) where.status = q.status;
  if (q.priority) where.priority = q.priority;
  if (q.subjectId) where.subjectId = q.subjectId;
  if (q.parentId !== undefined) where.parentId = q.parentId;
  else if (!q.includeSubtasks) where.parentId = null;
  if (q.search) and.push({ OR: [{ title: { contains: q.search } }, { description: { contains: q.search } }] });
  if (q.from || q.to) where.dueAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
  if (q.overdue) and.push({ dueAt: { lt: new Date() }, status: { not: 'DONE' } });
  where.AND = and;
  const orderBy =
    q.sort === 'priority'
      ? [{ priority: 'desc' }, { dueAt: 'asc' }]
      : q.sort === 'created'
        ? [{ createdAt: 'desc' }]
        : q.sort === 'manual'
          ? [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
          : [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
  const rows = await prisma.task.findMany({ where, orderBy, include: TASK_INCLUDE, take: 1000 });
  return rows.map(shape);
}

async function get(userId, id) {
  const t = await prisma.task.findFirst({
    where: { id, deletedAt: null, OR: [{ userId, groupId: null }, { assigneeId: userId }] },
    include: { ...TASK_INCLUDE, subtasks: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, title: true, status: true, dueAt: true } } },
  });
  if (!t) throw notFound('Không tìm thấy công việc');
  return shape(t);
}

function statusData(status, current) {
  if (!status || status === current) return {};
  return { status, completedAt: status === 'DONE' ? new Date() : null };
}

async function create(userId, data) {
  await checkLinks(userId, data);
  const maxOrder = await prisma.task.aggregate({ where: { userId, groupId: null, status: data.status || 'TODO' }, _max: { sortOrder: true } });
  const t = await prisma.task.create({
    data: {
      ...data,
      userId,
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      completedAt: data.status === 'DONE' ? new Date() : null,
    },
  });
  await activity.log(userId, 'task.create', `Tạo công việc "${t.title}"`, { entityType: 'TASK', entityId: t.id });
  return get(userId, t.id);
}

async function update(userId, id, data) {
  const t = await ownTask(userId, id);
  await checkLinks(userId, { ...data, parentId: data.parentId === id ? null : data.parentId });
  if (data.parentId === id) throw badRequest('Công việc không thể là con của chính nó');
  const { status, ...rest } = data;
  // Đổi thời điểm nhắc => cho phép nhắc lại
  if ('remindAt' in rest) rest.reminderSentAt = null;
  await prisma.task.update({ where: { id }, data: { ...rest, ...statusData(status, t.status) } });
  if (status === 'DONE' && t.status !== 'DONE') {
    await activity.log(userId, 'task.done', `Hoàn thành "${t.title}"`, { entityType: 'TASK', entityId: id });
  }
  return get(userId, id);
}

/** Kéo thả Kanban: cập nhật trạng thái + thứ tự của cả cột trong 1 transaction. */
async function reorder(userId, { status, orderedIds }) {
  const tasks = await prisma.task.findMany({ where: { id: { in: orderedIds }, userId, groupId: null, deletedAt: null }, select: { id: true, status: true } });
  if (tasks.length !== orderedIds.length) throw badRequest('Danh sách công việc không hợp lệ');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.task.update({ where: { id }, data: { sortOrder: i, ...statusData(status, byId.get(id).status) } }))
  );
  return { ok: true };
}

async function remove(userId, id) {
  const t = await ownTask(userId, id);
  const now = new Date();
  await prisma.$transaction([
    prisma.task.update({ where: { id }, data: { deletedAt: now } }),
    prisma.task.updateMany({ where: { parentId: id, deletedAt: null }, data: { deletedAt: now } }),
  ]);
  await activity.log(userId, 'task.delete', `Xóa công việc "${t.title}"`, { entityType: 'TASK', entityId: id });
}

async function createSubtasks(userId, parentId, items) {
  const parent = await ownTask(userId, parentId);
  await prisma.$transaction(
    items.map((it, i) =>
      prisma.task.create({
        data: { userId, parentId, title: it.title, description: it.description ?? null, dueAt: it.dueAt ?? null, priority: parent.priority, subjectId: parent.subjectId, sortOrder: i },
      })
    )
  );
  return get(userId, parentId);
}

async function stats(userId) {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86400000);
  const base = { deletedAt: null, parentId: null, OR: [{ userId, groupId: null }, { assigneeId: userId }] };
  const [byStatus, overdue, dueSoon, doneThisWeek] = await Promise.all([
    prisma.task.groupBy({ by: ['status'], where: base, _count: true }),
    prisma.task.count({ where: { ...base, status: { not: 'DONE' }, dueAt: { lt: now } } }),
    prisma.task.count({ where: { ...base, status: { not: 'DONE' }, dueAt: { gte: now, lte: week } } }),
    prisma.task.count({ where: { ...base, status: 'DONE', completedAt: { gte: new Date(now.getTime() - 7 * 86400000) } } }),
  ]);
  const counts = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
  for (const s of byStatus) counts[s.status] = s._count;
  const total = counts.TODO + counts.IN_PROGRESS + counts.DONE;
  return { counts, total, overdue, dueSoon, doneThisWeek, completionRate: total ? Math.round((counts.DONE / total) * 100) : 0 };
}

// ------------------------------------------------------------------ AI (chỉ đề xuất)
function describeTask(t) {
  return `#${t.id} "${t.title}" – trạng thái ${t.status}, ưu tiên ${t.priority}${t.dueAt ? `, hạn ${t.dueAt.toISOString()}` : ', không có hạn'}${t.subject ? `, môn ${t.subject.name}` : ''}${t.description ? `\n   Mô tả: ${t.description.slice(0, 300)}` : ''}`;
}

async function aiBreakdown(userId, id) {
  const t = await get(userId, id);
  const { data } = await ai.completeJson(userId, 'task.breakdown', {
    system: prompts.TASK_BREAKDOWN,
    messages: [{ role: 'user', content: `Công việc: ${describeTask(t)}\nThời điểm hiện tại: ${new Date().toISOString()}` }],
    maxTokens: 900,
  });
  const subtasks = (Array.isArray(data?.subtasks) ? data.subtasks : [])
    .filter((s) => s?.title)
    .slice(0, 10)
    .map((s) => ({ title: String(s.title).slice(0, 255), description: s.description ? String(s.description).slice(0, 2000) : null, estimateHours: Number(s.estimateHours) || null }));
  return { subtasks, advice: data?.advice ? String(data.advice) : null, note: 'Đây là đề xuất – chọn các bước muốn thêm rồi bấm Lưu.' };
}

async function openTasks(userId) {
  return prisma.task.findMany({
    where: { deletedAt: null, parentId: null, status: { not: 'DONE' }, OR: [{ userId, groupId: null }, { assigneeId: userId }] },
    include: { subject: { select: { name: true } } },
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }],
    take: 40,
  });
}

async function aiPriorities(userId) {
  const tasks = await openTasks(userId);
  if (!tasks.length) return { suggestions: [], note: 'Không có công việc đang mở.' };
  const { data } = await ai.completeJson(userId, 'task.priority', {
    system: prompts.TASK_PRIORITY,
    messages: [{ role: 'user', content: `Thời điểm hiện tại: ${new Date().toISOString()}\nDanh sách:\n${tasks.map(describeTask).join('\n')}` }],
    maxTokens: 1200,
  });
  const valid = new Map(tasks.map((t) => [t.id, t]));
  const suggestions = (Array.isArray(data?.suggestions) ? data.suggestions : [])
    .filter((s) => valid.has(Number(s.id)) && ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(s.priority))
    .map((s) => ({ id: Number(s.id), title: valid.get(Number(s.id)).title, current: valid.get(Number(s.id)).priority, priority: s.priority, reason: String(s.reason || '') }));
  return { suggestions, note: 'Đây là đề xuất – bấm Áp dụng cho từng công việc nếu đồng ý.' };
}

async function aiStudyPlan(userId) {
  const tasks = await openTasks(userId);
  const from = new Date();
  const to = new Date(from.getTime() + 7 * 86400000);
  const meetings = await prisma.classMeeting.findMany({
    where: { userId, status: 'SCHEDULED', date: { gte: new Date(from.toISOString().slice(0, 10)), lte: to }, subject: { deletedAt: null } },
    include: { subject: { select: { name: true } } },
    orderBy: [{ date: 'asc' }, { startPeriod: 'asc' }],
    take: 80,
  });
  const result = await ai.complete(userId, 'task.study_plan', {
    system: prompts.STUDY_PLAN,
    messages: [
      {
        role: 'user',
        content: `Hôm nay: ${from.toISOString().slice(0, 10)}\nCÔNG VIỆC:\n${tasks.map(describeTask).join('\n') || '(không có)'}\n\nLỊCH HỌC 7 NGÀY TỚI (theo tiết):\n${
          meetings.map((m) => `${fromDbDate(m.date)} tiết ${m.startPeriod}-${m.endPeriod}: ${m.subject.name}${m.room ? ` (${m.room})` : ''}`).join('\n') || '(không có)'
        }`,
      },
    ],
  });
  return { content: result.text };
}

async function aiProgress(userId) {
  const [s, tasks] = await Promise.all([
    stats(userId),
    prisma.task.findMany({
      where: { deletedAt: null, parentId: null, OR: [{ userId, groupId: null }, { assigneeId: userId }] },
      include: { subject: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 40,
    }),
  ]);
  const result = await ai.complete(userId, 'task.progress', {
    system: prompts.PROGRESS,
    messages: [{ role: 'user', content: `Thống kê: ${JSON.stringify(s)}\nHôm nay: ${new Date().toISOString()}\nCông việc:\n${tasks.map(describeTask).join('\n')}` }],
  });
  return { content: result.text, stats: s };
}

module.exports = { list, get, create, update, reorder, remove, createSubtasks, stats, aiBreakdown, aiPriorities, aiStudyPlan, aiProgress };
