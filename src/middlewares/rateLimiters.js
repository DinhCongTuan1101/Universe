'use strict';
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');

const handler = (_req, res, _next, options) =>
  res.status(429).json({ success: false, message: options.message, data: null, code: 'RATE_LIMIT' });

const userOrIp = (req) => (req.user ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`);

// Khi chạy test thì nới giới hạn để bộ test không bị chặn.
const scale = (n) => (config.isTest ? n * 100 : n);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: scale(600),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIp,
  message: 'Bạn gửi quá nhiều yêu cầu, vui lòng thử lại sau ít phút.',
  handler,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: scale(20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Bạn đã thử đăng nhập/đăng ký quá nhiều lần. Vui lòng đợi 15 phút.',
  handler,
});

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: scale(10),
  keyGenerator: userOrIp,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Bạn đã thử quá nhiều lần. Vui lòng đợi 15 phút.',
  handler,
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: scale(15),
  keyGenerator: userOrIp,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Bạn gửi yêu cầu AI quá nhanh. Vui lòng đợi một phút.',
  handler,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: scale(30),
  keyGenerator: userOrIp,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Bạn tải lên quá nhiều file trong thời gian ngắn.',
  handler,
});

module.exports = { apiLimiter, authLimiter, sensitiveLimiter, aiLimiter, uploadLimiter };
