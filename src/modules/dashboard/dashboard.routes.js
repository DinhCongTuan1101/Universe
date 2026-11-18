'use strict';
/** Dashboard: tổng hợp dữ liệu THẬT từ database của người dùng hiện tại. */
const { Router } = require('express');
const prisma = require('../../database/prisma');
const tasks = require('../tasks/tasks.service');
const schedule = require('../schedule/schedule.service');
const library = require('../library/library.service');
const { requireAuth } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { ok } = require('../../utils/response');
const { z, isoDate } = require('../../utils/schemas');
const { todayVN } = require('../../utils/dates');

const r = Router();
r.use(requireAuth);

r.get('/', validate({ query: z.object({ today: isoDate.optional() }) }), async (req, res) => {
  const userId = req.user.id;
  const today = req.valid.query.today || todayVN();
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400000);

  const [todayClasses, taskStats, upcoming, recentFiles, recentNotes, groupActivity, storage, counts, periods, recent] = await Promise.all([
    schedule.listMeetings(userId, { from: today, to: today }),
    tasks.stats(userId),
    prisma.task.findMany({
      where: { deletedAt: null, status: { not: 'DONE' }, dueAt: { lte: in7 }, OR: [{ userId, groupId: null }, { assigneeId: userId }] },
      include: { subject: { select: { name: true, color: true } }, group: { select: { id: true, name: true } } },
      orderBy: { dueAt: 'asc' },
      take: 8,
    }),
    prisma.driveFile.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, originalName: true, extension: true, size: true, updatedAt: true, document: { select: { status: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    }),
    prisma.note.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true, icon: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 6 }),
    prisma.activityLog.findMany({
      where: { group: { deletedAt: null, members: { some: { userId } } } },
      include: { user: { select: { id: true, fullName: true } }, group: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.driveFile.aggregate({ where: { userId }, _sum: { size: true } }),
    Promise.all([
      prisma.subject.count({ where: { userId, deletedAt: null } }),
      prisma.note.count({ where: { userId, deletedAt: null } }),
      prisma.driveFile.count({ where: { userId, deletedAt: null } }),
      prisma.quizAttempt.count({ where: { userId, status: 'SUBMITTED' } }),
      prisma.quizAttempt.aggregate({ where: { userId, status: 'SUBMITTED', submittedAt: { gte: new Date(now.getTime() - 30 * 86400000) } }, _avg: { score: true } }),
      prisma.groupMember.count({ where: { userId, group: { deletedAt: null } } }),
      prisma.classMeeting.count({ where: { userId, status: 'SCHEDULED', subject: { deletedAt: null }, date: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(new Date(`${today}T00:00:00Z`).getTime() + 6 * 86400000) } } }),
    ]),
    prisma.classPeriod.findMany({ orderBy: { periodNumber: 'asc' } }),
    library.listRecent(userId, { limit: 6 }),
  ]);

  ok(res, {
    today,
    todayClasses,
    classPeriods: periods,
    tasks: { stats: taskStats, upcoming },
    recentFiles: recentFiles.map((f) => ({ ...f, size: Number(f.size) })),
    recentNotes,
    recentlyViewed: recent,
    groupActivity,
    stats: {
      subjects: counts[0],
      notes: counts[1],
      files: counts[2],
      quizAttempts: counts[3],
      avgQuizScore30d: counts[4]._avg.score === null ? null : Math.round(counts[4]._avg.score * 10) / 10,
      groups: counts[5],
      classesThisWeek: counts[6],
      storageUsed: Number(storage._sum.size || 0),
      storageQuota: Number(req.user.storageQuota),
    },
  });
});

module.exports = r;
