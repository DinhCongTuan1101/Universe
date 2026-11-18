'use strict';
const { Router } = require('express');
const service = require('./ai.chat.service');
const aiService = require('../../services/ai/ai.service');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { aiLimiter } = require('../../middlewares/rateLimiters');
const { ok, created } = require('../../utils/response');
const { z, idParams } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

const docIds = z.array(z.coerce.number().int().positive()).max(10);

r.get('/status', (_req, res) => ok(res, aiService.status()));
r.get('/usage', async (req, res) => ok(res, await aiService.usageSummary(req.user.id)));

r.get('/conversations', validate({ query: z.object({ search: z.string().trim().max(100).optional() }) }), async (req, res) =>
  ok(res, await service.list(req.user.id, req.valid.query))
);
r.post('/conversations', validate({ body: z.object({ title: z.string().trim().max(191).optional(), documentIds: docIds.optional() }) }), async (req, res) =>
  created(res, await service.create(req.user.id, req.valid.body), 'Đã tạo cuộc hội thoại')
);
r.get('/conversations/:id', validate({ params: idParams }), async (req, res) => ok(res, await service.get(req.user.id, req.valid.params.id)));
r.patch(
  '/conversations/:id',
  validate({ params: idParams, body: z.object({ title: z.string().trim().min(1).max(191).optional(), documentIds: docIds.optional() }) }),
  async (req, res) => ok(res, await service.update(req.user.id, req.valid.params.id, req.valid.body), 'Đã cập nhật')
);
r.delete('/conversations/:id', validate({ params: idParams }), async (req, res) => {
  await service.remove(req.user.id, req.valid.params.id);
  ok(res, null, 'Đã xóa cuộc hội thoại');
});
r.post(
  '/conversations/:id/messages',
  aiLimiter,
  validate({ params: idParams, body: z.object({ content: z.string().trim().min(1, 'Hãy nhập câu hỏi').max(8000) }) }),
  async (req, res) => ok(res, await service.send(req.user.id, req.valid.params.id, req.valid.body.content))
);

module.exports = r;
