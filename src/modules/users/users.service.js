'use strict';
const prisma = require('../../database/prisma');
const config = require('../../config');
const storage = require('../../services/storage.service');
const { detectFileType } = require('../../utils/fileType');
const { PUBLIC_USER_SELECT } = require('../../middlewares/auth');
const { badRequest, notFound } = require('../../utils/errors');
const { effectiveSettings } = require('../../services/notification.service');
const activity = require('../../services/activity.service');

async function updateProfile(userId, data) {
  return prisma.user.update({ where: { id: userId }, data, select: PUBLIC_USER_SELECT });
}

async function updateSettings(userId, { theme, notificationSettings }) {
  const data = {};
  if (theme) data.theme = theme;
  if (notificationSettings) {
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { notificationSettings: true } });
    data.notificationSettings = { ...effectiveSettings(current?.notificationSettings), ...notificationSettings };
  }
  return prisma.user.update({ where: { id: userId }, data, select: PUBLIC_USER_SELECT });
}

async function storageUsage(userId) {
  const [user, agg, byType] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { storageQuota: true } }),
    prisma.driveFile.aggregate({ where: { userId }, _sum: { size: true }, _count: true }),
    prisma.driveFile.groupBy({ by: ['extension'], where: { userId }, _sum: { size: true }, _count: true }),
  ]);
  return {
    quota: Number(user.storageQuota),
    used: Number(agg._sum.size || 0),
    fileCount: agg._count,
    byType: byType.map((t) => ({ extension: t.extension, size: Number(t._sum.size || 0), count: t._count })),
  };
}

async function setAvatar(userId, file) {
  const type = detectFileType(file.buffer, file.originalname, ['png', 'jpg', 'webp', 'gif']);
  if (!type) throw badRequest('Ảnh đại diện phải là PNG, JPG, WEBP hoặc GIF');
  const { storedName } = await storage.save(file.buffer, type.ext, config.storage.avatarDir);
  const old = await prisma.user.findUnique({ where: { id: userId }, select: { avatarPath: true } });
  const user = await prisma.user.update({ where: { id: userId }, data: { avatarPath: storedName }, select: PUBLIC_USER_SELECT });
  if (old?.avatarPath) await storage.remove(old.avatarPath, config.storage.avatarDir).catch(() => {});
  return user;
}

async function removeAvatar(userId) {
  const old = await prisma.user.findUnique({ where: { id: userId }, select: { avatarPath: true } });
  const user = await prisma.user.update({ where: { id: userId }, data: { avatarPath: null }, select: PUBLIC_USER_SELECT });
  if (old?.avatarPath) await storage.remove(old.avatarPath, config.storage.avatarDir).catch(() => {});
  return user;
}

const AVATAR_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

async function avatarFile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { avatarPath: true } });
  if (!user?.avatarPath) throw notFound('Người dùng chưa có ảnh đại diện');
  const ext = user.avatarPath.split('.').pop();
  return { path: storage.absolutePath(user.avatarPath, config.storage.avatarDir), mime: AVATAR_MIME[ext] || 'application/octet-stream' };
}

async function lookupByEmail(email) {
  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    select: { id: true, fullName: true, email: true, avatarPath: true },
  });
  if (!user) throw notFound('Không tìm thấy người dùng với email này');
  return user;
}

async function adminList({ page, pageSize, q }) {
  const where = q ? { OR: [{ email: { contains: q } }, { fullName: { contains: q } }] } : {};
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, email: true, fullName: true, role: true, isActive: true, isDemo: true, createdAt: true, lastLoginAt: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

async function adminUpdate(adminId, userId, data) {
  if (adminId === userId && (data.role && data.role !== 'ADMIN' || data.isActive === false)) {
    throw badRequest('Không thể tự hạ quyền hoặc khóa tài khoản của chính mình');
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });
  if (data.isActive === false) {
    // Khóa tài khoản => thu hồi mọi phiên đăng nhập
    const sessions = await prisma.userSession.findMany({ where: { userId }, select: { sid: true } });
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { session_id: { in: sessions.map((s) => s.sid) } } }),
      prisma.userSession.deleteMany({ where: { userId } }),
    ]);
  }
  await activity.log(adminId, 'admin.user_update', `Cập nhật tài khoản ${user.email}`, { entityType: 'USER', entityId: userId, metadata: data });
  return user;
}

module.exports = { updateProfile, updateSettings, storageUsage, setAvatar, removeAvatar, avatarFile, lookupByEmail, adminList, adminUpdate };
