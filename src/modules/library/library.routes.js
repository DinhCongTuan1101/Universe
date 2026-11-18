'use strict';
/** /api/v1/library: Favorites, Recently Viewed, Trash, Activity History */
const { Router } = require('express');
const service = require('./library.service');
const activity = require('../../services/activity.service');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { ok } = require('../../utils/response');
const { z, id, pagination } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

const entityType = z.enum(service.ENTITY_TYPES);
const trashType = z.enum(service.TRASH_TYPES);

r.get('/favorites', validate({ query: z.object({ type: entityType.optional() }) }), async (req, res) =>
  ok(res, await service.listFavorites(req.user.id, req.valid.query.type))
);
r.put('/favorites', validate({ body: z.object({ entityType, entityId: id, favorite: z.boolean() }) }), async (req, res) => {
  const { entityType: t, entityId, favorite } = req.valid.body;
  ok(res, await service.setFavorite(req.user.id, t, entityId, favorite), favorite ? 'Đã thêm vào yêu thích' : 'Đã bỏ yêu thích');
});

r.get('/recent', validate({ query: z.object({ type: entityType.optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }) }), async (req, res) =>
  ok(res, await service.listRecent(req.user.id, { entityType: req.valid.query.type, limit: req.valid.query.limit }))
);

r.get('/trash', async (req, res) => ok(res, await service.listTrash(req.user.id)));
r.post('/trash/restore', validate({ body: z.object({ entityType: trashType, entityId: id }) }), async (req, res) =>
  ok(res, await service.restore(req.user.id, req.valid.body.entityType, req.valid.body.entityId), 'Đã khôi phục')
);
r.post('/trash/purge', validate({ body: z.object({ entityType: trashType, entityId: id }) }), async (req, res) =>
  ok(res, await service.purge(req.user.id, req.valid.body.entityType, req.valid.body.entityId), 'Đã xóa vĩnh viễn')
);
r.post('/trash/empty', async (req, res) => ok(res, await service.emptyTrash(req.user.id), 'Đã dọn sạch thùng rác'));

r.get('/activity', validate({ query: pagination }), async (req, res) => ok(res, await activity.listForUser(req.user.id, req.valid.query)));

module.exports = r;
