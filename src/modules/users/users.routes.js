'use strict';
/**
 * Hồ sơ cá nhân, cài đặt, avatar và quản trị người dùng (Admin).
 * Module nhỏ nên gộp controller vào routes; nghiệp vụ nằm ở users.service.js.
 */
const { Router } = require('express');
const service = require('./users.service');
const { validate } = require('../../middlewares/validate');
const { requireAuth, requireRole } = require('../../middlewares/auth');
const { uploader } = require('../../middlewares/upload');
const { uploadLimiter } = require('../../middlewares/rateLimiters');
const { ok } = require('../../utils/response');
const { z, idParams, optionalText, pagination } = require('../../utils/schemas');
const { badRequest } = require('../../utils/errors');

const r = Router();
r.use(requireAuth);

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  university: optionalText(191),
  major: optionalText(191),
  className: optionalText(60),
  studentCode: optionalText(40),
  bio: optionalText(500),
});

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  notificationSettings: z
    .object({
      taskReminders: z.boolean().optional(),
      groupActivity: z.boolean().optional(),
      communityActivity: z.boolean().optional(),
      documentProcessing: z.boolean().optional(),
    })
    .optional(),
});

r.get('/me', (req, res) => ok(res, req.user));

r.patch('/me', validate({ body: profileSchema }), async (req, res) => {
  ok(res, await service.updateProfile(req.user.id, req.valid.body), 'Đã cập nhật hồ sơ');
});

r.patch('/me/settings', validate({ body: settingsSchema }), async (req, res) => {
  ok(res, await service.updateSettings(req.user.id, req.valid.body), 'Đã lưu cài đặt');
});

r.get('/me/storage', async (req, res) => ok(res, await service.storageUsage(req.user.id)));

const avatarUpload = uploader({ maxBytes: 2 * 1024 * 1024, maxFiles: 1 }).single('avatar');
r.post('/me/avatar', uploadLimiter, avatarUpload, async (req, res) => {
  if (!req.file) throw badRequest('Vui lòng chọn ảnh');
  ok(res, await service.setAvatar(req.user.id, req.file), 'Đã cập nhật ảnh đại diện');
});
r.delete('/me/avatar', async (req, res) => ok(res, await service.removeAvatar(req.user.id), 'Đã xóa ảnh đại diện'));

// Ảnh đại diện chỉ người dùng đã đăng nhập mới xem được (không public).
r.get('/:id/avatar', validate({ params: idParams }), async (req, res) => {
  const file = await service.avatarFile(req.valid.params.id);
  res.set('Cache-Control', 'private, max-age=300');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(file.mime).sendFile(file.path);
});

// Tìm người dùng để mời vào nhóm (chỉ trả về thông tin công khai tối thiểu)
r.get('/lookup', validate({ query: z.object({ email: z.string().trim().toLowerCase().email() }) }), async (req, res) => {
  ok(res, await service.lookupByEmail(req.valid.query.email));
});

// ---------- Admin ----------
r.get(
  '/',
  requireRole('ADMIN'),
  validate({ query: pagination.extend({ q: z.string().trim().max(100).optional() }) }),
  async (req, res) => ok(res, await service.adminList(req.valid.query))
);

r.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParams, body: z.object({ role: z.enum(['STUDENT', 'MODERATOR', 'ADMIN']).optional(), isActive: z.boolean().optional() }) }),
  async (req, res) => ok(res, await service.adminUpdate(req.user.id, req.valid.params.id, req.valid.body), 'Đã cập nhật người dùng')
);

module.exports = r;
