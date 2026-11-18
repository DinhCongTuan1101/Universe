'use strict';
/**
 * Lớp truy xuất ngữ cảnh cho RAG – tách biệt để có thể thay thế bằng vector DB sau này.
 *
 *  - "semantic": embedding câu hỏi + cosine similarity trên embedding đã lưu (tính trong Node, brute-force).
 *                Chỉ dùng khi AI đã cấu hình VÀ tài liệu đã được người dùng bật embedding.
 *  - "keyword":  chấm điểm theo từ khóa (TF có chuẩn hóa độ dài) – KHÔNG phải tìm kiếm ngữ nghĩa.
 * Kết quả luôn ghi rõ phương thức đã dùng.
 *
 * Chỉ truy xuất từ tài liệu mà người dùng có quyền đọc (của mình hoặc được chia sẻ trong nhóm).
 */
const { Prisma } = require('@prisma/client');
const prisma = require('../database/prisma');
const config = require('../config');
const ai = require('./ai/ai.service');
const { fold } = require('../modules/schedule/importers/sheetGrid');

const MAX_CANDIDATES = 4000;
const STOPWORDS = new Set(
  'la va cua co cho cac nhung mot trong duoc voi khong nay do thi the nao gi khi tai ve de tu den nhu hay hoac neu vi da se dang bi boi sau truoc tren duoi ra vao lai con nen phai rat cung chi moi cai nguoi viec the what is the a an of to in and or for on with how why'.split(
    ' '
  )
);

/** Danh sách fileId (đã có Document READY) mà người dùng được phép đọc. */
async function accessibleDocumentFileIds(userId, fileIds) {
  const where = {
    deletedAt: null,
    document: { status: 'READY' },
    OR: [{ userId }, { groupResources: { some: { group: { deletedAt: null, members: { some: { userId } } } } } }],
  };
  if (fileIds?.length) where.id = { in: fileIds };
  const files = await prisma.driveFile.findMany({ where, select: { id: true }, take: 500 });
  return files.map((f) => f.id);
}

function tokenize(text) {
  return fold(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function keywordScore(queryTokens, content) {
  const tokens = tokenize(content);
  if (!tokens.length) return 0;
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  let score = 0;
  let matched = 0;
  for (const q of new Set(queryTokens)) {
    const f = freq.get(q) || 0;
    if (f) {
      matched++;
      score += (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (tokens.length / 180)));
    }
  }
  // thưởng khi khớp nhiều từ khác nhau của câu hỏi
  return matched ? score * (matched / new Set(queryTokens).size) : 0;
}

/**
 * @returns {Promise<{ method: 'semantic'|'keyword'|'none', chunks: Array }>}
 */
async function retrieve(userId, query, { fileIds, limit = 6 } = {}) {
  const allowed = await accessibleDocumentFileIds(userId, fileIds);
  if (!allowed.length) return { method: 'none', chunks: [] };

  const select = {
    id: true,
    chunkIndex: true,
    content: true,
    pageNumber: true,
    document: { select: { fileId: true, embeddingModel: true, file: { select: { originalName: true } } } },
  };

  // ---- Semantic retrieval (nếu khả dụng) ----
  const embeddedDocs = await prisma.document.count({
    where: { fileId: { in: allowed }, embeddingModel: config.ai.embeddingModel || '__none__', embeddedCount: { gt: 0 } },
  });
  if (ai.embeddingsAvailable() && embeddedDocs > 0) {
    const { vectors } = await ai.embed(userId, 'rag.query', [query], { countQuota: false });
    const qv = vectors[0];
    const candidates = await prisma.documentChunk.findMany({
      where: { document: { fileId: { in: allowed }, embeddingModel: config.ai.embeddingModel }, NOT: { embedding: { equals: Prisma.DbNull } } },
      select: { ...select, embedding: true },
      take: MAX_CANDIDATES,
    });
    const scored = candidates
      .map((c) => ({ c, score: cosine(qv, Array.isArray(c.embedding) ? c.embedding : []) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { method: 'semantic', chunks: scored.map(({ c, score }) => shape(c, score)) };
  }

  // ---- Keyword retrieval ----
  const qTokens = tokenize(query);
  if (!qTokens.length) return { method: 'keyword', chunks: [] };
  const terms = [...new Set(query.split(/\s+/).filter((w) => w.length > 2))].slice(0, 8);
  const candidates = await prisma.documentChunk.findMany({
    where: {
      document: { fileId: { in: allowed } },
      ...(terms.length ? { OR: terms.map((t) => ({ content: { contains: t } })) } : {}),
    },
    select,
    take: MAX_CANDIDATES,
  });
  const scored = candidates
    .map((c) => ({ c, score: keywordScore(qTokens, c.content) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { method: 'keyword', chunks: scored.map(({ c, score }) => shape(c, score)) };
}

function shape(c, score) {
  return {
    chunkId: c.id,
    fileId: c.document.fileId,
    fileName: c.document.file.originalName,
    chunkIndex: c.chunkIndex,
    pageNumber: c.pageNumber,
    content: c.content,
    score: Math.round(score * 1000) / 1000,
  };
}

/** Định dạng các đoạn trích thành ngữ cảnh gửi AI kèm số thứ tự nguồn [n]. */
function formatContext(chunks) {
  return chunks
    .map((c, i) => `[${i + 1}] (${c.fileName}${c.pageNumber ? `, trang ${c.pageNumber}` : ''}, đoạn ${c.chunkIndex + 1})\n${c.content}`)
    .join('\n\n---\n\n');
}

module.exports = { retrieve, formatContext, accessibleDocumentFileIds, keywordScore, tokenize, cosine };
