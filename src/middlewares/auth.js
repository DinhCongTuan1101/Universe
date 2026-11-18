'use strict';
const prisma = require('../database/prisma');
const { unauthorized, forbidden } = require('../utils/errors');

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  avatarPath: true,
  university: true,
  major: true,
  className: true,
  studentCode: true,
  bio: true,
  theme: true,
  notificationSettings: true,
  storageQuota: true,
  isDemo: true,
  createdAt: true,
};

/**
 * Nạp người dùng hiện tại từ session (nếu có) vào req.user.
 * Tài khoản bị khóa => hủy session.
 */
async function loadUser(req, _res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { ...PUBLIC_USER_SELECT, isActive: true } });
  if (!user || !user.isActive) {
    req.session.userId = undefined;
    return next();
  }
  delete user.isActive;
  req.user = user;
  // Cập nhật "lần cuối hoạt động" của phiên, tối đa 1 lần / 5 phút để giảm ghi DB.
  const now = Date.now();
  if (!req.session.seenAt || now - req.session.seenAt > 5 * 60 * 1000) {
    req.session.seenAt = now;
    prisma.userSession.updateMany({ where: { sid: req.sessionID }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Chỉ cho phép các vai trò được liệt kê (ADMIN luôn có toàn quyền). */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role === 'ADMIN' || roles.includes(req.user.role)) return next();
    next(forbidden());
  };
}

module.exports = { loadUser, requireAuth, requireRole, PUBLIC_USER_SELECT };
