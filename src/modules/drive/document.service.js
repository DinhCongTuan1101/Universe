'use strict';
/**
 * Xử lý tài liệu UniDrive (chạy cục bộ, KHÔNG gửi lên AI):
 *   File storage -> Text extraction -> Chunking -> lưu DocumentChunk (phục vụ tìm kiếm nội dung).
 * Embedding chỉ được tạo khi người dùng CHỦ ĐỘNG yêu cầu (generateEmbeddings).
 *
 * Trạng thái Document: UPLOADED -> PROCESSING -> READY | FAILED (có thể thử lại).
 * PDF scan (không có lớp chữ) => FAILED với thông báo rõ ràng; OCR CHƯA được triển khai.
 */
const mammoth = require('mammoth');
const { Prisma } = require('@prisma/client');
const prisma = require('../../database/prisma');
const storage = require('../../services/storage.service');
const logger = require('../../utils/logger');
const ai = require('../../services/ai/ai.service');
const config = require('../../config');
const { notify } = require('../../services/notification.service');
const { badRequest, notFound } = require('../../utils/errors');

const EXTRACTABLE = new Set(['pdf', 'docx', 'txt', 'md', 'csv']);
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const MAX_TEXT_CHARS = 2_000_000;
const EMBED_BATCH = 64;

const processing = new Set();

function isExtractable(ext) {
  return EXTRACTABLE.has(ext);
}

/** @returns {Promise<{ pages: Array<{ page: number|null, text: string }>, pageCount: number|null }>} */
async function extractText(buffer, ext) {
  if (ext === 'pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const r = await parser.getText();
      const pages = (r.pages || []).map((p) => ({ page: p.num, text: (p.text || '').trim() }));
      return { pages, pageCount: r.total ?? pages.length };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (ext === 'docx') {
    const r = await mammoth.extractRawText({ buffer });
    return { pages: [{ page: null, text: r.value || '' }], pageCount: null };
  }
  return { pages: [{ page: null, text: buffer.toString('utf8').replace(/^﻿/, '') }], pageCount: null };
}

/** Chia văn bản thành đoạn ~1200 ký tự, chồng lấn 200, ưu tiên cắt ở ranh giới đoạn/câu. */
function chunkText(pages) {
  const chunks = [];
  let offset = 0;
  for (const { page, text } of pages) {
    const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    let start = 0;
    while (start < clean.length) {
      let end = Math.min(start + CHUNK_SIZE, clean.length);
      if (end < clean.length) {
        const window = clean.slice(start + Math.floor(CHUNK_SIZE * 0.6), end);
        const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
        if (cut > 0) end = start + Math.floor(CHUNK_SIZE * 0.6) + cut + 1;
      }
      const content = clean.slice(start, end).trim();
      if (content.length > 20 || (content && chunks.length === 0)) {
        chunks.push({ content, pageNumber: page, charStart: offset + start, charEnd: offset + end });
      }
      if (end >= clean.length) break;
      start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }
    offset += clean.length + 2;
  }
  return chunks;
}

async function processDocument(documentId) {
  if (processing.has(documentId)) return;
  processing.add(documentId);
  let doc;
  try {
    doc = await prisma.document.findUnique({ where: { id: documentId }, include: { file: true } });
    if (!doc || doc.file.deletedAt) return;
    await prisma.document.update({ where: { id: documentId }, data: { status: 'PROCESSING', errorMessage: null } });
    const buffer = await storage.read(doc.file.storedName);
    const { pages, pageCount } = await extractText(buffer, doc.file.extension);
    let total = pages.reduce((a, p) => a + p.text.length, 0);
    if (total === 0) {
      const msg =
        doc.file.extension === 'pdf'
          ? 'PDF không có lớp văn bản (có thể là bản scan). OCR chưa được hỗ trợ trong phiên bản này.'
          : 'Tài liệu không có nội dung văn bản.';
      await prisma.document.update({ where: { id: documentId }, data: { status: 'FAILED', errorMessage: msg, pageCount, processedAt: new Date() } });
      return;
    }
    if (total > MAX_TEXT_CHARS) {
      let budget = MAX_TEXT_CHARS;
      for (const p of pages) {
        p.text = p.text.slice(0, Math.max(0, budget));
        budget -= p.text.length;
      }
      total = MAX_TEXT_CHARS;
    }
    const chunks = chunkText(pages);
    await prisma.$transaction([
      prisma.documentChunk.deleteMany({ where: { documentId } }),
      prisma.documentChunk.createMany({
        data: chunks.map((c, i) => ({ documentId, userId: doc.file.userId, chunkIndex: i, ...c })),
      }),
      prisma.document.update({
        where: { id: documentId },
        data: { status: 'READY', charCount: total, pageCount, chunkCount: chunks.length, embeddedCount: 0, embeddingModel: null, processedAt: new Date() },
      }),
    ]);
  } catch (err) {
    logger.warn('Xử lý tài liệu thất bại', { documentId, error: err.message });
    await prisma.document
      .update({
        where: { id: documentId },
        data: { status: 'FAILED', errorMessage: 'Không đọc được nội dung tài liệu (file hỏng, có mật khẩu hoặc định dạng không hỗ trợ).', processedAt: new Date() },
      })
      .catch(() => {});
    if (doc) {
      await notify(doc.file.userId, {
        type: 'document.processed',
        title: `Không xử lý được "${doc.file.originalName}"`,
        body: 'Bạn có thể thử xử lý lại trong UniDrive.',
        link: `/drive?file=${doc.fileId}`,
      });
    }
  } finally {
    processing.delete(documentId);
  }
}

/** Đưa tài liệu vào hàng đợi xử lý nền (không chặn request upload). */
function enqueue(documentId) {
  setImmediate(() => processDocument(documentId).catch(() => {}));
}

/** Gọi định kỳ từ jobs.js: xử lý các tài liệu còn ở trạng thái UPLOADED (vd sau khi khởi động lại). */
async function processPending() {
  const stuckBefore = new Date(Date.now() - 10 * 60 * 1000);
  const docs = await prisma.document.findMany({
    where: { OR: [{ status: 'UPLOADED' }, { status: 'PROCESSING', updatedAt: { lt: stuckBefore } }], file: { deletedAt: null } },
    select: { id: true },
    take: 5,
  });
  for (const d of docs) await processDocument(d.id);
}

async function retry(userId, fileId) {
  const doc = await prisma.document.findFirst({ where: { fileId, file: { userId, deletedAt: null } } });
  if (!doc) throw notFound('Tài liệu không hỗ trợ trích xuất văn bản');
  if (doc.status === 'PROCESSING') throw badRequest('Tài liệu đang được xử lý');
  await prisma.document.update({ where: { id: doc.id }, data: { status: 'UPLOADED', errorMessage: null } });
  enqueue(doc.id);
  return { status: 'UPLOADED' };
}

/**
 * Tạo embedding cho các đoạn của tài liệu – CHỈ khi người dùng bấm "Bật hỏi đáp ngữ nghĩa".
 * Gửi nội dung các đoạn tới AI provider đã cấu hình để lấy vector.
 */
async function generateEmbeddings(userId, fileId) {
  const doc = await prisma.document.findFirst({ where: { fileId, file: { userId, deletedAt: null } } });
  if (!doc) throw notFound('Không tìm thấy tài liệu');
  if (doc.status !== 'READY') throw badRequest('Tài liệu chưa sẵn sàng (cần trích xuất văn bản xong trước)');
  ai.ensureConfigured();
  const model = config.ai.embeddingModel;
  // Đổi model embedding => vector cũ không còn so sánh được, xóa để tạo lại.
  if (doc.embeddingModel && doc.embeddingModel !== model) {
    await prisma.documentChunk.updateMany({ where: { documentId: doc.id }, data: { embedding: Prisma.DbNull } });
  }
  const pending = await prisma.documentChunk.findMany({
    where: { documentId: doc.id, embedding: { equals: Prisma.DbNull } },
    select: { id: true, content: true },
    orderBy: { chunkIndex: 'asc' },
  });
  let done = doc.chunkCount - pending.length;
  let first = true;
  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    const batch = pending.slice(i, i + EMBED_BATCH);
    // Chỉ lô đầu tiên tính vào hạn mức lượt/ngày; các lô sau thuộc cùng một yêu cầu của người dùng.
    const { vectors } = await ai.embed(userId, 'drive.embed', batch.map((c) => c.content), { countQuota: first });
    first = false;
    await prisma.$transaction(batch.map((c, j) => prisma.documentChunk.update({ where: { id: c.id }, data: { embedding: vectors[j] } })));
    done += batch.length;
    await prisma.document.update({ where: { id: doc.id }, data: { embeddedCount: Math.min(done, doc.chunkCount), embeddingModel: model } });
  }
  return prisma.document.findUnique({ where: { id: doc.id } });
}

module.exports = { isExtractable, extractText, chunkText, processDocument, enqueue, processPending, retry, generateEmbeddings };
