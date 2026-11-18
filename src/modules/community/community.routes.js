'use strict';
const { Router } = require('express');
const s = require('./community.service');
const { validate } = require('../../middlewares/validate');
const { requireAuth, requireRole } = require('../../middlewares/auth');
const { sensitiveLimiter } = require('../../middlewares/rateLimiters');
const { ok, created } = require('../../utils/response');
const { z, id, idParams, optionalId, optionalText, pagination, boolQuery } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

const TYPE = z.enum(['ARTICLE', 'DOCUMENT', 'NOTE', 'OUTLINE', 'RESOURCE']);
const postBody = z.object({
  type: TYPE,
  title: z.string().trim().min(5, 'Tiêu đề tối thiểu 5 ký tự').max(191),
  content: z.string().trim().min(10, 'Nội dung tối thiểu 10 ký tự').max(100000),
  subjectName: optionalText(191),
  topic: optionalText(120),
  fileId: optionalId.optional(),
  noteId: optionalId.optional(),
  externalUrl: z.preprocess((v) => (v === '' ? null : v), z.string().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'Liên kết phải là http(s)').nullable().optional()),
  license: optionalText(60),
  copyrightConfirmed: z.boolean().optional(),
});

r.get(
  '/posts',
  validate({
    query: pagination.extend({
      type: TYPE.optional(),
      subject: z.string().trim().max(191).optional(),
      topic: z.string().trim().max(120).optional(),
      search: z.string().trim().max(100).optional(),
      sort: z.enum(['new', 'top', 'rated']).default('new'),
      mine: boolQuery,
      bookmarked: boolQuery,
      status: z.enum(['PUBLISHED', 'HIDDEN', 'REMOVED']).optional(),
    }),
  }),
  async (req, res) => ok(res, await s.list(req.user, req.valid.query))
);
r.get('/facets', async (_req, res) => ok(res, await s.facets()));
r.post('/posts', validate({ body: postBody }), async (req, res) => created(res, await s.create(req.user, req.valid.body), 'Đã đăng bài'));
r.get('/posts/:id', validate({ params: idParams }), async (req, res) => ok(res, await s.get(req.user, req.valid.params.id)));
r.patch('/posts/:id', validate({ params: idParams, body: postBody.partial() }), async (req, res) => ok(res, await s.update(req.user, req.valid.params.id, req.valid.body), 'Đã cập nhật bài viết'));
r.delete('/posts/:id', validate({ params: idParams }), async (req, res) => {
  await s.remove(req.user, req.valid.params.id);
  ok(res, null, 'Đã xóa bài viết');
});
r.put('/posts/:id/rating', validate({ params: idParams, body: z.object({ value: z.number().int().min(1).max(5) }) }), async (req, res) =>
  ok(res, await s.rate(req.user, req.valid.params.id, req.valid.body.value), 'Cảm ơn bạn đã đánh giá')
);

r.get('/posts/:id/comments', validate({ params: idParams }), async (req, res) => ok(res, await s.listComments(req.user, req.valid.params.id)));
r.post('/posts/:id/comments', validate({ params: idParams, body: z.object({ content: z.string().trim().min(1).max(5000) }) }), async (req, res) =>
  created(res, await s.addComment(req.user, req.valid.params.id, req.valid.body.content), 'Đã gửi bình luận')
);
r.delete('/comments/:id', validate({ params: idParams }), async (req, res) => {
  await s.deleteComment(req.user, req.valid.params.id);
  ok(res, null, 'Đã xóa bình luận');
});

r.post(
  '/reports',
  sensitiveLimiter,
  validate({ body: z.object({ targetType: z.enum(['POST', 'COMMENT']), targetId: id, reason: z.enum(Object.keys(s.REPORT_REASONS)), details: optionalText(2000) }) }),
  async (req, res) => created(res, await s.report(req.user, req.valid.body), 'Đã gửi báo cáo – cảm ơn bạn')
);

// ---------- Kiểm duyệt (Moderator / Admin) ----------
r.get('/moderation/reports', requireRole('MODERATOR'), validate({ query: z.object({ status: z.enum(['OPEN', 'RESOLVED', 'REJECTED']).optional() }) }), async (req, res) =>
  ok(res, await s.listReports(req.valid.query))
);
r.post(
  '/moderation/reports/:id/resolve',
  requireRole('MODERATOR'),
  validate({ params: idParams, body: z.object({ action: z.enum(['reject', 'hide', 'remove', 'restore']), note: optionalText(500) }) }),
  async (req, res) => ok(res, await s.resolveReport(req.user, req.valid.params.id, req.valid.body), 'Đã xử lý báo cáo')
);
r.patch(
  '/moderation/posts/:id',
  requireRole('MODERATOR'),
  validate({ params: idParams, body: z.object({ status: z.enum(['PUBLISHED', 'HIDDEN', 'REMOVED']), note: optionalText(500) }) }),
  async (req, res) => ok(res, await s.moderatePost(req.user, req.valid.params.id, req.valid.body), 'Đã cập nhật trạng thái bài viết')
);

module.exports = r;
