'use strict';
const { Router } = require('express');
const prisma = require('../../database/prisma');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { ok } = require('../../utils/response');
const { notFound } = require('../../utils/errors');
const { z, idParams, boolQuery } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

r.get(
  '/',
  validate({ query: z.object({ unread: boolQuery, limit: z.coerce.number().int().min(1).max(100).default(30), before: z.coerce.number().int().positive().optional() }) }),
  async (req, res) => {
    const { unread, limit, before } = req.valid.query;
    const where = { userId: req.user.id, ...(unread ? { readAt: null } : {}), ...(before ? { id: { lt: before } } : {}) };
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { id: 'desc' }, take: limit }),
      prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
    ]);
    ok(res, { items, unreadCount, hasMore: items.length === limit });
  }
);

r.get('/unread-count', async (req, res) => ok(res, { unreadCount: await prisma.notification.count({ where: { userId: req.user.id, readAt: null } }) }));

r.post('/read-all', async (req, res) => {
  const result = await prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
  ok(res, { updated: result.count }, 'Đã đánh dấu tất cả là đã đọc');
});

r.patch('/:id', validate({ params: idParams, body: z.object({ read: z.boolean() }) }), async (req, res) => {
  const n = await prisma.notification.findFirst({ where: { id: req.valid.params.id, userId: req.user.id } });
  if (!n) throw notFound('Không tìm thấy thông báo');
  ok(res, await prisma.notification.update({ where: { id: n.id }, data: { readAt: req.valid.body.read ? new Date() : null } }));
});

r.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const result = await prisma.notification.deleteMany({ where: { id: req.valid.params.id, userId: req.user.id } });
  if (!result.count) throw notFound('Không tìm thấy thông báo');
  ok(res, null, 'Đã xóa thông báo');
});

r.delete('/', async (req, res) => {
  const result = await prisma.notification.deleteMany({ where: { userId: req.user.id, readAt: { not: null } } });
  ok(res, { deleted: result.count }, 'Đã xóa các thông báo đã đọc');
});

module.exports = r;
