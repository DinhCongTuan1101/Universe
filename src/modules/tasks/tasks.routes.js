'use strict';
const { Router } = require('express');
const service = require('./tasks.service');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { aiLimiter } = require('../../middlewares/rateLimiters');
const { ok, created } = require('../../utils/response');
const { z, idParams, optionalId, optionalText, optionalDateTime, boolQuery } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

const STATUS = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
const PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

const taskBody = z.object({
  title: z.string().trim().min(1, 'Vui lòng nhập tiêu đề').max(255),
  description: optionalText(10000),
  subjectId: optionalId.optional(),
  classMeetingId: optionalId.optional(),
  parentId: optionalId.optional(),
  dueAt: optionalDateTime.optional(),
  remindAt: optionalDateTime.optional(),
  priority: PRIORITY.optional(),
  status: STATUS.optional(),
});

const listQuery = z.object({
  status: STATUS.optional(),
  priority: PRIORITY.optional(),
  subjectId: optionalId.optional(),
  parentId: optionalId.optional(),
  search: z.string().trim().max(100).optional(),
  from: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  sort: z.enum(['due', 'priority', 'created', 'manual']).default('due'),
  overdue: boolQuery,
  includeGroup: boolQuery.default(true),
  includeSubtasks: boolQuery,
});

r.get('/', validate({ query: listQuery }), async (req, res) => ok(res, await service.list(req.user.id, req.valid.query)));
r.get('/stats', async (req, res) => ok(res, await service.stats(req.user.id)));
r.post('/', validate({ body: taskBody }), async (req, res) => created(res, await service.create(req.user.id, req.valid.body), 'Đã tạo công việc'));
r.post(
  '/reorder',
  validate({ body: z.object({ status: STATUS, orderedIds: z.array(z.number().int().positive()).max(500) }) }),
  async (req, res) => ok(res, await service.reorder(req.user.id, req.valid.body))
);

// AI – chỉ đề xuất, không tự thay đổi dữ liệu
r.post('/ai/priorities', aiLimiter, async (req, res) => ok(res, await service.aiPriorities(req.user.id)));
r.post('/ai/study-plan', aiLimiter, async (req, res) => ok(res, await service.aiStudyPlan(req.user.id)));
r.post('/ai/progress', aiLimiter, async (req, res) => ok(res, await service.aiProgress(req.user.id)));

r.get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await service.get(req.user.id, req.valid.params.id)));
r.patch('/:id', validate({ params: idParams, body: taskBody.partial() }), async (req, res) =>
  ok(res, await service.update(req.user.id, req.valid.params.id, req.valid.body), 'Đã cập nhật công việc')
);
r.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await service.remove(req.user.id, req.valid.params.id);
  ok(res, null, 'Đã xóa công việc');
});
r.post('/:id/ai/breakdown', aiLimiter, validate({ params: idParams }), async (req, res) => ok(res, await service.aiBreakdown(req.user.id, req.valid.params.id)));
r.post(
  '/:id/subtasks',
  validate({
    params: idParams,
    body: z.object({ items: z.array(z.object({ title: z.string().trim().min(1).max(255), description: optionalText(2000), dueAt: optionalDateTime.optional() })).min(1).max(20) }),
  }),
  async (req, res) => created(res, await service.createSubtasks(req.user.id, req.valid.params.id, req.valid.body.items), 'Đã thêm các bước nhỏ')
);

module.exports = r;
