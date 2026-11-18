'use strict';
/**
 * UniSearch – tìm kiếm toàn hệ thống (tìm kiếm từ khóa).
 * Chỉ trả về dữ liệu người dùng có quyền xem: của mình, của nhóm mình tham gia, bài viết cộng đồng công khai.
 */
const { Router } = require('express');
const prisma = require('../../database/prisma');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { ok } = require('../../utils/response');
const { z } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

const TYPES = ['files', 'notes', 'tasks', 'groups', 'posts', 'subjects', 'workbooks', 'quizzes'];

function snippet(text, q) {
  if (!text) return null;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, 120);
  return text.slice(Math.max(0, idx - 50), idx + q.length + 70).replace(/\s+/g, ' ');
}

r.get(
  '/',
  validate({
    query: z.object({
      q: z.string().trim().min(1, 'Nhập từ khóa').max(100),
      types: z
        .string()
        .optional()
        .transform((s) => (s ? s.split(',').filter((t) => TYPES.includes(t)) : TYPES)),
      limit: z.coerce.number().int().min(1).max(30).default(8),
    }),
  }),
  async (req, res) => {
    const { q, types, limit } = req.valid.query;
    const userId = req.user.id;
    const want = new Set(types);
    const memberOf = { deletedAt: null, members: { some: { userId } } };
    const tasks = [];

    if (want.has('files')) {
      tasks.push(
        (async () => {
          const chunkHits = await prisma.documentChunk.findMany({
            where: {
              content: { contains: q },
              document: { file: { deletedAt: null, OR: [{ userId }, { groupResources: { some: { group: memberOf } } }] } },
            },
            select: { content: true, pageNumber: true, document: { select: { fileId: true } } },
            take: 50,
          });
          const byContent = new Map();
          for (const c of chunkHits) if (!byContent.has(c.document.fileId)) byContent.set(c.document.fileId, c);
          const files = await prisma.driveFile.findMany({
            where: {
              deletedAt: null,
              AND: [
                { OR: [{ userId }, { groupResources: { some: { group: memberOf } } }] },
                { OR: [{ originalName: { contains: q } }, { description: { contains: q } }, { id: { in: [...byContent.keys()] } }] },
              ],
            },
            select: { id: true, originalName: true, extension: true, updatedAt: true, userId: true },
            orderBy: { updatedAt: 'desc' },
            take: limit,
          });
          return [
            'files',
            files.map((f) => {
              const c = byContent.get(f.id);
              return {
                id: f.id,
                title: f.originalName,
                subtitle: c ? `…${snippet(c.content, q)}…${c.pageNumber ? ` (trang ${c.pageNumber})` : ''}` : f.extension.toUpperCase(),
                link: `/drive?file=${f.id}`,
                shared: f.userId !== userId,
                updatedAt: f.updatedAt,
              };
            }),
          ];
        })()
      );
    }
    if (want.has('notes')) {
      tasks.push(
        prisma.note
          .findMany({
            where: { deletedAt: null, OR: [{ userId }, { groupResources: { some: { group: memberOf } } }], AND: [{ OR: [{ title: { contains: q } }, { contentText: { contains: q } }] }] },
            select: { id: true, title: true, icon: true, contentText: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: limit,
          })
          .then((rows) => ['notes', rows.map((n) => ({ id: n.id, title: n.title || 'Không tiêu đề', icon: n.icon, subtitle: snippet(n.contentText, q), link: `/notes/${n.id}`, updatedAt: n.updatedAt }))])
      );
    }
    if (want.has('tasks')) {
      tasks.push(
        prisma.task
          .findMany({
            where: {
              deletedAt: null,
              OR: [{ userId, groupId: null }, { groupId: { not: null }, group: memberOf }],
              AND: [{ OR: [{ title: { contains: q } }, { description: { contains: q } }] }],
            },
            select: { id: true, title: true, status: true, dueAt: true, groupId: true },
            orderBy: { updatedAt: 'desc' },
            take: limit,
          })
          .then((rows) => [
            'tasks',
            rows.map((t) => ({ id: t.id, title: t.title, subtitle: t.status, link: t.groupId ? `/groups/${t.groupId}?tab=tasks` : `/tasks?open=${t.id}`, dueAt: t.dueAt })),
          ])
      );
    }
    if (want.has('groups')) {
      tasks.push(
        prisma.group
          .findMany({ where: { ...memberOf, OR: [{ name: { contains: q } }, { description: { contains: q } }] }, select: { id: true, name: true, description: true }, take: limit })
          .then((rows) => ['groups', rows.map((g) => ({ id: g.id, title: g.name, subtitle: snippet(g.description, q), link: `/groups/${g.id}` }))])
      );
    }
    if (want.has('posts')) {
      tasks.push(
        prisma.post
          .findMany({
            where: { deletedAt: null, status: 'PUBLISHED', OR: [{ title: { contains: q } }, { content: { contains: q } }, { subjectName: { contains: q } }, { topic: { contains: q } }] },
            select: { id: true, title: true, content: true, type: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
          .then((rows) => ['posts', rows.map((p) => ({ id: p.id, title: p.title, subtitle: snippet(p.content, q), link: `/share/${p.id}`, createdAt: p.createdAt }))])
      );
    }
    if (want.has('subjects')) {
      tasks.push(
        prisma.subject
          .findMany({ where: { userId, deletedAt: null, OR: [{ name: { contains: q } }, { code: { contains: q } }] }, select: { id: true, name: true, code: true, color: true }, take: limit })
          .then((rows) => ['subjects', rows.map((s) => ({ id: s.id, title: s.name, subtitle: s.code, color: s.color, link: `/schedule?subject=${s.id}` }))])
      );
    }
    if (want.has('workbooks')) {
      tasks.push(
        prisma.workbook
          .findMany({ where: { userId, deletedAt: null, title: { contains: q } }, select: { id: true, title: true, updatedAt: true }, take: limit })
          .then((rows) => ['workbooks', rows.map((w) => ({ id: w.id, title: w.title, link: `/sheets/${w.id}`, updatedAt: w.updatedAt }))])
      );
    }
    if (want.has('quizzes')) {
      tasks.push(
        prisma.quizSet
          .findMany({ where: { userId, deletedAt: null, OR: [{ title: { contains: q } }, { description: { contains: q } }] }, select: { id: true, title: true, chapter: true }, take: limit })
          .then((rows) => ['quizzes', rows.map((s) => ({ id: s.id, title: s.title, subtitle: s.chapter, link: `/quiz/${s.id}` }))])
      );
    }

    const results = Object.fromEntries(await Promise.all(tasks));
    const total = Object.values(results).reduce((a, list) => a + list.length, 0);
    ok(res, { q, total, results });
  }
);

module.exports = r;
