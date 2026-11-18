'use strict';
/** Health check, trạng thái AI, cấu hình tiết học (Class Periods). */
const { Router } = require('express');
const prisma = require('../../database/prisma');
const config = require('../../config');
const { ok } = require('../../utils/response');
const { validate } = require('../../middlewares/validate');
const { requireAuth, requireRole } = require('../../middlewares/auth');
const { z } = require('../../utils/schemas');
const { badRequest } = require('../../utils/errors');
const { aiLimiter } = require('../../middlewares/rateLimiters');

const r = Router();

r.get('/health', async (_req, res) => {
  let database = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'unavailable';
  }
  res.status(database === 'ok' ? 200 : 503).json({
    success: database === 'ok',
    message: database === 'ok' ? 'UniVerse hoạt động bình thường' : 'Cơ sở dữ liệu không khả dụng',
    data: { status: database === 'ok' ? 'ok' : 'degraded', database, time: new Date().toISOString() },
  });
});

// Kiểm tra kết nối AI thật (gọi provider) – chỉ Admin, có rate limit AI
r.post('/ai-test', requireRole('ADMIN'), aiLimiter, async (req, res) => {
  ok(res, await require('../../services/ai/ai.service').testConnection(req.user.id), 'Đã kiểm tra kết nối AI');
});

r.get('/ai-status', requireAuth, (req, res) => {
  ok(res, {
    problem: req.user.role === 'ADMIN' && !config.ai.configured ? config.ai.problem : undefined,
    configured: config.ai.configured,
    provider: config.ai.configured ? config.ai.provider : null,
    chatModel: config.ai.configured ? config.ai.chatModel : null,
    embeddings: config.ai.configured && config.ai.embeddingsEnabled,
    dailyLimit: config.ai.dailyRequestLimit,
  });
});

// ---------- Class Periods (giờ học theo tiết) ----------
r.get('/class-periods', requireAuth, async (_req, res) => {
  ok(res, await prisma.classPeriod.findMany({ orderBy: { periodNumber: 'asc' } }));
});

const time = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ dạng HH:MM').nullable());
const periodsSchema = z.object({
  periods: z
    .array(
      z.object({
        periodNumber: z.number().int().min(1).max(20),
        shift: z.enum(['MORNING', 'AFTERNOON', 'EVENING']),
        startTime: time.optional(),
        endTime: time.optional(),
      })
    )
    .min(1)
    .max(20),
});

r.put('/class-periods', requireRole('ADMIN'), validate({ body: periodsSchema }), async (req, res) => {
  const { periods } = req.valid.body;
  const numbers = periods.map((p) => p.periodNumber);
  if (new Set(numbers).size !== numbers.length) throw badRequest('Số tiết bị trùng');
  for (const p of periods) {
    if (p.startTime && p.endTime && p.startTime >= p.endTime) throw badRequest(`Tiết ${p.periodNumber}: giờ kết thúc phải sau giờ bắt đầu`);
  }
  await prisma.$transaction([
    prisma.classPeriod.deleteMany({ where: { periodNumber: { notIn: numbers } } }),
    ...periods.map((p) =>
      prisma.classPeriod.upsert({
        where: { periodNumber: p.periodNumber },
        create: { periodNumber: p.periodNumber, shift: p.shift, startTime: p.startTime ?? null, endTime: p.endTime ?? null },
        update: { shift: p.shift, startTime: p.startTime ?? null, endTime: p.endTime ?? null },
      })
    ),
  ]);
  ok(res, await prisma.classPeriod.findMany({ orderBy: { periodNumber: 'asc' } }), 'Đã lưu cấu hình tiết học');
});

module.exports = r;
