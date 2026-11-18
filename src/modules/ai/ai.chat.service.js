'use strict';
const prisma = require('../../database/prisma');
const ai = require('../../services/ai/ai.service');
const prompts = require('../../services/ai/prompts');
const retrieval = require('../../services/retrieval.service');
const library = require('../library/library.service');
const config = require('../../config');
const { notFound } = require('../../utils/errors');

const HISTORY_LIMIT = 20;

async function own(userId, id) {
  const c = await prisma.aiConversation.findFirst({ where: { id, userId, deletedAt: null } });
  if (!c) throw notFound('Không tìm thấy cuộc hội thoại');
  return c;
}

async function validDocIds(userId, ids) {
  if (!ids?.length) return [];
  // Chỉ giữ tài liệu người dùng có quyền đọc
  const files = await prisma.driveFile.findMany({
    where: {
      id: { in: ids },
      deletedAt: null,
      OR: [{ userId }, { groupResources: { some: { group: { deletedAt: null, members: { some: { userId } } } } } }],
    },
    select: { id: true },
  });
  return files.map((f) => f.id);
}

async function attachedDocs(ids) {
  if (!ids?.length) return [];
  return prisma.driveFile.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, originalName: true, extension: true, document: { select: { status: true, embeddedCount: true, embeddingModel: true } } },
  });
}

async function list(userId, { search }) {
  return prisma.aiConversation.findMany({
    where: { userId, deletedAt: null, ...(search ? { title: { contains: search } } : {}) },
    select: { id: true, title: true, updatedAt: true, createdAt: true, _count: { select: { messages: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
}

async function create(userId, { title, documentIds }) {
  const ids = await validDocIds(userId, documentIds);
  const c = await prisma.aiConversation.create({ data: { userId, title: title || 'Cuộc hội thoại mới', documentIds: ids } });
  return get(userId, c.id);
}

async function get(userId, id) {
  const c = await own(userId, id);
  const messages = await prisma.aiMessage.findMany({ where: { conversationId: id }, orderBy: { id: 'asc' } });
  await library.touchRecent(userId, 'CONVERSATION', id);
  return { ...c, documents: await attachedDocs(c.documentIds), messages, ai: ai.status() };
}

async function update(userId, id, { title, documentIds }) {
  await own(userId, id);
  const data = {};
  if (title) data.title = title;
  if (documentIds) data.documentIds = await validDocIds(userId, documentIds);
  await prisma.aiConversation.update({ where: { id }, data });
  return get(userId, id);
}

async function remove(userId, id) {
  await own(userId, id);
  await prisma.aiConversation.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Gửi tin nhắn: lưu câu hỏi, (nếu có tài liệu đính kèm) truy xuất đoạn liên quan, gọi AI, lưu câu trả lời + nguồn.
 * AI chưa cấu hình => báo lỗi 503 rõ ràng, KHÔNG tạo câu trả lời giả và không lưu tin nhắn.
 */
async function send(userId, id, content) {
  const conv = await own(userId, id);
  ai.ensureConfigured();

  const history = await prisma.aiMessage.findMany({ where: { conversationId: id }, orderBy: { id: 'desc' }, take: HISTORY_LIMIT });
  const userMsg = await prisma.aiMessage.create({ data: { conversationId: id, role: 'USER', content } });

  let system = prompts.BASE;
  let sources = null;
  let method = null;
  const docIds = await validDocIds(userId, conv.documentIds);
  if (docIds.length) {
    const r = await retrieval.retrieve(userId, content, { fileIds: docIds, limit: 6 });
    method = r.method;
    if (r.chunks.length) {
      system += `\n\nNgười dùng đã đính kèm tài liệu. ${prompts.DOC_RULES}\nNếu câu hỏi không liên quan tới tài liệu, có thể trả lời bằng kiến thức chung nhưng nói rõ điều đó.\n\nĐOẠN TRÍCH TÀI LIỆU:\n${retrieval.formatContext(r.chunks)}`;
      sources = {
        method: r.method,
        items: r.chunks.map((c, i) => ({ ref: i + 1, fileId: c.fileId, fileName: c.fileName, pageNumber: c.pageNumber, chunkIndex: c.chunkIndex, excerpt: c.content.slice(0, 280) })),
      };
    } else {
      sources = { method: r.method, items: [] };
    }
  }

  let result;
  try {
    result = await ai.complete(userId, 'chat', {
      system,
      messages: [...history.reverse().map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content })), { role: 'user', content }],
    });
  } catch (err) {
    // Không lưu câu hỏi "mồ côi" khi AI lỗi – người dùng có thể gửi lại.
    await prisma.aiMessage.delete({ where: { id: userMsg.id } }).catch(() => {});
    throw err;
  }

  const assistant = await prisma.aiMessage.create({
    data: { conversationId: id, role: 'ASSISTANT', content: result.text, sources: sources ?? undefined, provider: config.ai.provider, model: result.model },
  });
  const data = { updatedAt: new Date() };
  if (conv.title === 'Cuộc hội thoại mới' && history.length === 0) data.title = content.replace(/\s+/g, ' ').slice(0, 60);
  await prisma.aiConversation.update({ where: { id }, data });
  return { userMessage: userMsg, assistantMessage: assistant, retrieval: method, title: data.title || conv.title };
}

module.exports = { list, create, get, update, remove, send };
