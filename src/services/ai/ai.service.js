'use strict';
/**
 * Lớp dịch vụ AI dùng chung cho mọi module:
 *  - Kiểm tra đã cấu hình (không có key => lỗi 503 AI_NOT_CONFIGURED, KHÔNG giả lập câu trả lời).
 *  - Hạn mức theo người dùng/ngày, timeout, giới hạn độ dài vào/ra.
 *  - Ghi nhận usage (token) vào bảng AiUsage.
 */
const config = require('../../config');
const prisma = require('../../database/prisma');
const logger = require('../../utils/logger');
const { ApiError, serviceUnavailable, tooMany } = require('../../utils/errors');
const { createProvider, ProviderError } = require('./providers');

let provider = null;
function getProvider() {
  if (!config.ai.configured) return null;
  if (!provider) provider = createProvider(config.ai);
  return provider;
}

function status() {
  return {
    configured: config.ai.configured,
    problem: config.ai.configured ? null : config.ai.problem,
    provider: config.ai.configured ? config.ai.provider : null,
    chatModel: config.ai.configured ? config.ai.chatModel : null,
    embeddings: config.ai.configured && config.ai.embeddingsEnabled,
  };
}

function ensureConfigured() {
  if (!getProvider()) {
    throw serviceUnavailable(`AI chưa được cấu hình (${config.ai.problem || 'thiếu cấu hình'}). Quản trị viên cần đặt AI_PROVIDER và API key trong file .env rồi khởi động lại server.`, {
      code: 'AI_NOT_CONFIGURED',
    });
  }
}

/**
 * Kiểm tra kết nối AI (dùng cho nút "Kiểm tra kết nối" của Admin và script ai:check).
 * Trả về kết quả từng bước, kèm thông điệp lỗi gốc của provider để quản trị viên tự xử lý.
 */
async function testConnection(userId, { includeModels = true } = {}) {
  const result = { provider: config.ai.provider || null, chatModel: config.ai.chatModel || null, embeddingModel: config.ai.embeddingModel || null, configured: config.ai.configured, problem: config.ai.problem, steps: [] };
  if (!getProvider()) return result;
  const p = getProvider();
  const step = async (name, fn) => {
    const started = Date.now();
    try {
      const detail = await fn();
      result.steps.push({ name, ok: true, ms: Date.now() - started, detail });
    } catch (err) {
      result.steps.push({ name, ok: false, ms: Date.now() - started, code: err.code, message: err.message, providerStatus: err.providerStatus, providerMessage: err.providerMessage });
    }
  };
  if (includeModels) {
    await step('Liệt kê model khả dụng', async () => {
      const models = await p.listModels({ signal: AbortSignal.timeout(config.ai.timeoutMs) });
      const has = models.some((m) => m === config.ai.chatModel || m.startsWith(`${config.ai.chatModel} `));
      return { count: models.length, chatModelListed: has, sample: models.slice(0, 80) };
    });
  }
  await step(`Chat với model ${config.ai.chatModel}`, async () => {
    const r = await p.chat({ messages: [{ role: 'user', content: 'Trả lời đúng một từ: "OK".' }], maxTokens: 256, signal: AbortSignal.timeout(config.ai.timeoutMs) });
    if (userId) await recordUsage(userId, 'system.ai_test', r.model, r.usage, true, null, 0);
    return { reply: r.text.trim().slice(0, 100), model: r.model, usage: r.usage };
  });
  if (config.ai.embeddingsEnabled) {
    await step(`Embedding với model ${config.ai.embeddingModel}`, async () => {
      const r = await p.embed({ texts: ['kiểm tra kết nối'], signal: AbortSignal.timeout(config.ai.timeoutMs) });
      return { dimensions: r.vectors[0]?.length || 0 };
    });
  }
  result.ok = result.steps.filter((s) => !s.name.startsWith('Liệt kê')).every((s) => s.ok);
  return result;
}

function startOfTodayVN() {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 3600 * 1000);
  vn.setUTCHours(0, 0, 0, 0);
  return new Date(vn.getTime() - 7 * 3600 * 1000);
}

async function usageToday(userId) {
  return prisma.aiUsage.count({ where: { userId, createdAt: { gte: startOfTodayVN() } } });
}

async function checkQuota(userId) {
  const used = await usageToday(userId);
  if (used >= config.ai.dailyRequestLimit) {
    throw tooMany(`Bạn đã dùng hết ${config.ai.dailyRequestLimit} lượt AI hôm nay. Hãy quay lại vào ngày mai.`, { code: 'AI_DAILY_LIMIT' });
  }
}

async function recordUsage(userId, feature, model, usage, success, errorCode, durationMs) {
  try {
    await prisma.aiUsage.create({
      data: {
        userId,
        feature: feature.slice(0, 40),
        provider: config.ai.provider,
        model: String(model || '').slice(0, 80),
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        success,
        errorCode: errorCode ?? null,
        durationMs,
      },
    });
  } catch (err) {
    logger.warn('Không ghi được AI usage', { error: err.message });
  }
}

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}\n…[đã cắt bớt do vượt giới hạn độ dài]` : s;
}

function toApiError(err) {
  if (err instanceof ApiError) return err;
  if (err instanceof ProviderError) {
    if (err.providerMessage) logger.warn(`AI provider error ${err.code}`, { detail: err.providerMessage });
    return new ApiError(err.status || 502, err.message, { code: err.code });
  }
  logger.error('Lỗi AI không xác định', { error: err });
  return new ApiError(502, 'Dịch vụ AI gặp lỗi, vui lòng thử lại sau', { code: 'AI_ERROR' });
}

/**
 * Gọi AI tạo văn bản.
 * @param {number} userId
 * @param {string} feature  tên tính năng để thống kê (vd "note.summarize")
 * @param {{system?:string, messages:Array<{role:string,content:string}>, maxTokens?:number, json?:boolean}} input
 */
async function complete(userId, feature, { system, messages, maxTokens, json = false }) {
  ensureConfigured();
  await checkQuota(userId);
  // Giới hạn tổng độ dài đầu vào: ưu tiên giữ tin nhắn mới nhất.
  let budget = config.ai.maxInputChars;
  const trimmed = [];
  for (const m of [...messages].reverse()) {
    if (budget <= 0) break;
    const content = truncate(m.content, budget);
    budget -= content.length;
    trimmed.unshift({ role: m.role, content });
  }
  const started = Date.now();
  try {
    const result = await getProvider().chat({
      system,
      messages: trimmed,
      maxTokens: Math.min(maxTokens || config.ai.maxOutputTokens, config.ai.maxOutputTokens),
      json,
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });
    await recordUsage(userId, feature, result.model, result.usage, true, null, Date.now() - started);
    if (!result.text.trim()) throw new ApiError(502, 'AI không trả về nội dung', { code: 'AI_EMPTY' });
    return result;
  } catch (err) {
    const apiErr = toApiError(err);
    await recordUsage(userId, feature, config.ai.chatModel, null, false, apiErr.code, Date.now() - started);
    throw apiErr;
  }
}

/** Gọi AI và phân tích kết quả JSON. */
async function completeJson(userId, feature, input) {
  const result = await complete(userId, feature, { ...input, json: true });
  const data = parseJsonLoose(result.text);
  if (data === undefined) throw new ApiError(502, 'AI trả về dữ liệu không đúng định dạng, vui lòng thử lại', { code: 'AI_BAD_JSON' });
  return { ...result, data };
}

function parseJsonLoose(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    return undefined;
  }
}

function embeddingsAvailable() {
  return Boolean(getProvider()) && config.ai.embeddingsEnabled;
}

/** Tạo embedding theo lô. Mỗi lô tính là 1 lượt dùng AI. */
async function embed(userId, feature, texts, { countQuota = true } = {}) {
  ensureConfigured();
  if (!config.ai.embeddingsEnabled) throw serviceUnavailable('Tính năng embedding đang tắt (AI_EMBEDDINGS_ENABLED=false)', { code: 'AI_EMBEDDINGS_DISABLED' });
  if (countQuota) await checkQuota(userId);
  const started = Date.now();
  try {
    const result = await getProvider().embed({ texts: texts.map((t) => truncate(t, 8000)), signal: AbortSignal.timeout(config.ai.timeoutMs) });
    await recordUsage(userId, feature, result.model, result.usage, true, null, Date.now() - started);
    if (result.vectors.length !== texts.length) throw new ApiError(502, 'AI trả về số embedding không khớp', { code: 'AI_EMBED_MISMATCH' });
    return result;
  } catch (err) {
    const apiErr = toApiError(err);
    await recordUsage(userId, feature, config.ai.embeddingModel, null, false, apiErr.code, Date.now() - started);
    throw apiErr;
  }
}

async function usageSummary(userId) {
  const since = new Date(Date.now() - 30 * 86400000);
  const [today, month, byFeature] = await Promise.all([
    usageToday(userId),
    prisma.aiUsage.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { totalTokens: true }, _count: true }),
    prisma.aiUsage.groupBy({ by: ['feature'], where: { userId, createdAt: { gte: since } }, _count: true, _sum: { totalTokens: true } }),
  ]);
  return {
    today,
    dailyLimit: config.ai.dailyRequestLimit,
    last30Days: { requests: month._count, totalTokens: month._sum.totalTokens || 0 },
    byFeature: byFeature.map((f) => ({ feature: f.feature, requests: f._count, totalTokens: f._sum.totalTokens || 0 })),
  };
}

module.exports = { status, ensureConfigured, testConnection, complete, completeJson, embed, embeddingsAvailable, usageSummary, parseJsonLoose, truncate };
