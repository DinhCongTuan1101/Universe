'use strict';
/**
 * Đọc và kiểm tra biến môi trường MỘT lần duy nhất.
 * Mọi nơi khác trong code chỉ import `config`, không đọc process.env trực tiếp.
 */
const path = require('node:path');
const fs = require('node:fs');
const { z } = require('zod');

// Nạp .env bằng tính năng có sẵn của Node (>= 20.12) – không cần thư viện dotenv.
const envFile = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function' && !process.env.UNIVERSE_SKIP_ENV_FILE) {
  process.loadEnvFile(envFile);
}

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int().positive());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: int(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL chưa được cấu hình'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET phải dài ít nhất 32 ký tự'),
  SESSION_TTL_HOURS: int(168),
  UPLOAD_MAX_MB: int(25),
  USER_STORAGE_QUOTA_MB: int(1024),
  AI_PROVIDER: z
    .string()
    .optional()
    .transform((v) => (v ? v.trim().toLowerCase() : ''))
    .pipe(z.enum(['', 'openai', 'gemini'])),
  OPENAI_API_KEY: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
  AI_API_KEY: z.string().optional().default(''),
  AI_CHAT_MODEL: z.string().optional().default(''),
  AI_EMBEDDING_MODEL: z.string().optional().default(''),
  AI_EMBEDDINGS_ENABLED: bool(true),
  AI_TIMEOUT_MS: int(60000),
  AI_MAX_INPUT_CHARS: int(24000),
  AI_MAX_OUTPUT_TOKENS: int(2048),
  AI_DAILY_REQUEST_LIMIT: int(100),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // Không in giá trị biến môi trường – chỉ in tên và lỗi.
  console.error(`\n[config] Cấu hình môi trường không hợp lệ:\n${issues}\n\nXem hướng dẫn trong .env.example\n`);
  process.exit(1);
}
const env = parsed.data;

// Model mặc định cho từng provider – nơi DUY NHẤT khai báo tên model.
// Tên model của các hãng thay đổi thường xuyên: nếu model bị ngừng, đặt AI_CHAT_MODEL trong .env
// và chạy "npm run ai:check" để xem danh sách model mà API key của bạn được dùng.
const AI_DEFAULTS = {
  openai: { chatModel: 'gpt-4o-mini', embeddingModel: 'text-embedding-3-small' },
  // "gemini-flash-latest" là alias của Google luôn trỏ tới bản Flash mới nhất
  gemini: { chatModel: 'gemini-flash-latest', embeddingModel: 'gemini-embedding-001' },
};

const cleanKey = (k) => String(k || '').trim().replace(/^["']|["']$/g, '');
const provider = env.AI_PROVIDER;
// Ưu tiên key riêng của provider; AI_API_KEY dùng chung cho provider đang chọn.
const apiKey = cleanKey(provider === 'openai' ? env.OPENAI_API_KEY || env.AI_API_KEY : provider === 'gemini' ? env.GEMINI_API_KEY || env.AI_API_KEY : '');
const aiProblem = !provider
  ? 'Chưa đặt AI_PROVIDER (openai | gemini)'
  : !apiKey
    ? `Đã chọn AI_PROVIDER=${provider} nhưng chưa có ${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} (hoặc AI_API_KEY)`
    : null;

const rootDir = path.resolve(__dirname, '../..');

const config = Object.freeze({
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  rootDir,
  databaseUrl: env.DATABASE_URL,
  session: {
    secret: env.SESSION_SECRET,
    ttlMs: env.SESSION_TTL_HOURS * 3600 * 1000,
    cookieName: 'universe.sid',
  },
  storage: {
    uploadDir: path.join(rootDir, 'storage', 'uploads'),
    avatarDir: path.join(rootDir, 'storage', 'avatars'),
    maxUploadBytes: env.UPLOAD_MAX_MB * 1024 * 1024,
    defaultQuotaBytes: env.USER_STORAGE_QUOTA_MB * 1024 * 1024,
  },
  ai: Object.freeze({
    provider,
    apiKey,
    configured: Boolean(provider && apiKey),
    problem: aiProblem,
    chatModel: env.AI_CHAT_MODEL || (provider ? AI_DEFAULTS[provider].chatModel : ''),
    embeddingModel: env.AI_EMBEDDING_MODEL || (provider ? AI_DEFAULTS[provider].embeddingModel : ''),
    embeddingsEnabled: env.AI_EMBEDDINGS_ENABLED,
    timeoutMs: env.AI_TIMEOUT_MS,
    maxInputChars: env.AI_MAX_INPUT_CHARS,
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    dailyRequestLimit: env.AI_DAILY_REQUEST_LIMIT,
  }),
  logLevel: env.LOG_LEVEL,
});

module.exports = config;
