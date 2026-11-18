'use strict';
const bcrypt = require('bcrypt');
const prisma = require('../../database/prisma');
const config = require('../../config');
const { conflict, unauthorized, badRequest, notFound } = require('../../utils/errors');
const { PUBLIC_USER_SELECT } = require('../../middlewares/auth');
const activity = require('../../services/activity.service');

const BCRYPT_ROUNDS = config.isTest ? 4 : 12;
// Hash giả để so sánh khi email không tồn tại => thời gian phản hồi tương đương, tránh dò email.
const DUMMY_HASH = bcrypt.hashSync('universe-dummy-password', BCRYPT_ROUNDS);

async function register({ email, password, fullName }) {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw conflict('Email này đã được đăng ký');
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email, passwordHash, fullName, storageQuota: BigInt(config.storage.defaultQuotaBytes) },
    select: PUBLIC_USER_SELECT,
  });
  await activity.log(user.id, 'auth.register', 'Tạo tài khoản UniVerse');
  return user;
}

async function verifyCredentials({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Email hoặc mật khẩu không đúng');
  if (!user.isActive) throw unauthorized('Tài khoản đã bị khóa. Liên hệ quản trị viên.');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return prisma.user.findUnique({ where: { id: user.id }, select: PUBLIC_USER_SELECT });
}

async function recordSession(userId, sid, req) {
  await prisma.userSession.upsert({
    where: { sid },
    create: { sid, userId, userAgent: (req.get('user-agent') || '').slice(0, 255), ip: req.ip?.slice(0, 64) },
    update: { userId, lastSeenAt: new Date() },
  });
}

async function forgetSession(sid) {
  await prisma.userSession.deleteMany({ where: { sid } });
}

async function changePassword(userId, { currentPassword, newPassword }, currentSid) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound();
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw badRequest('Mật khẩu hiện tại không đúng');
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  // Đổi mật khẩu => đăng xuất mọi thiết bị khác (transaction để dữ liệu nhất quán).
  const others = await prisma.userSession.findMany({ where: { userId, NOT: { sid: currentSid } }, select: { sid: true } });
  const sids = others.map((s) => s.sid);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { session_id: { in: sids } } }),
    prisma.userSession.deleteMany({ where: { sid: { in: sids } } }),
  ]);
  await activity.log(userId, 'auth.password_changed', 'Đổi mật khẩu');
  return { revokedSessions: sids.length };
}

async function listSessions(userId, currentSid) {
  const rows = await prisma.userSession.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } });
  // Loại các phiên đã hết hạn trong store
  const alive = await prisma.session.findMany({
    where: { session_id: { in: rows.map((r) => r.sid) }, expires: { gt: Math.floor(Date.now() / 1000) } },
    select: { session_id: true },
  });
  const aliveSet = new Set(alive.map((a) => a.session_id));
  const stale = rows.filter((r) => !aliveSet.has(r.sid) && r.sid !== currentSid).map((r) => r.id);
  if (stale.length) await prisma.userSession.deleteMany({ where: { id: { in: stale } } });
  return rows
    .filter((r) => aliveSet.has(r.sid) || r.sid === currentSid)
    .map((r) => ({
      id: r.id,
      userAgent: r.userAgent,
      ip: r.ip,
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
      current: r.sid === currentSid,
    }));
}

async function revokeSession(userId, id, currentSid) {
  const row = await prisma.userSession.findFirst({ where: { id, userId } });
  if (!row) throw notFound('Không tìm thấy phiên đăng nhập');
  if (row.sid === currentSid) throw badRequest('Hãy dùng chức năng Đăng xuất cho phiên hiện tại');
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { session_id: row.sid } }),
    prisma.userSession.delete({ where: { id: row.id } }),
  ]);
}

module.exports = { register, verifyCredentials, recordSession, forgetSession, changePassword, listSessions, revokeSession };
