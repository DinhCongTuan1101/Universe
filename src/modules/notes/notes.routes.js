'use strict';
const { Router } = require('express');
const service = require('./notes.service');
const v = require('./notes.validators');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { uploader } = require('../../middlewares/upload');
const { uploadLimiter, aiLimiter } = require('../../middlewares/rateLimiters');
const { ok, created } = require('../../utils/response');
const { z, id, idParams } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

r.get('/', validate({ query: v.listQuery }), async (req, res) => ok(res, await service.list(req.user.id, req.valid.query)));
r.post('/', validate({ body: v.createNote }), async (req, res) => created(res, await service.create(req.user.id, req.valid.body), 'Đã tạo ghi chú'));
r.get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await service.get(req.user.id, req.valid.params.id)));
r.patch('/:id', validate({ params: idParams, body: v.updateNote }), async (req, res) =>
  ok(res, await service.update(req.user.id, req.valid.params.id, req.valid.body), 'Đã lưu')
);
r.delete('/:id', validate({ params: idParams }), async (req, res) => ok(res, await service.remove(req.user.id, req.valid.params.id), 'Đã chuyển vào thùng rác'));

const imageUpload = uploader({ maxBytes: 8 * 1024 * 1024, maxFiles: 1 }).single('image');
r.post('/:id/images', uploadLimiter, validate({ params: idParams }), imageUpload, async (req, res) =>
  created(res, await service.uploadImage(req.user.id, req.valid.params.id, req.file), 'Đã tải ảnh lên')
);
r.get('/:id/images/:fileId', validate({ params: z.object({ id, fileId: id }) }), async (req, res) => {
  const f = await service.imageFile(req.user.id, req.valid.params.id, req.valid.params.fileId);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=600');
  res.type(f.mime).sendFile(f.path);
});
r.post('/:id/ai', aiLimiter, validate({ params: idParams, body: v.aiBody }), async (req, res) =>
  ok(res, await service.aiAction(req.user.id, req.valid.params.id, req.valid.body))
);

module.exports = r;
