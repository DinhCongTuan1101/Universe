'use strict';
const prisma = require('../../database/prisma');
const library = require('../library/library.service');
const activity = require('../../services/activity.service');
const ai = require('../../services/ai/ai.service');
const prompts = require('../../services/ai/prompts');
const storage = require('../../services/storage.service');
const { detectFileType } = require('../../utils/fileType');
const { decodeOriginalName } = require('../../middlewares/upload');
const { notFound, badRequest, conflict } = require('../../utils/errors');

const EMPTY = { blocks: [{ id: 'b1', type: 'paragraph', text: '' }] };

function plainText(content) {
  return (content?.blocks || [])
    .map((b) => {
      if (b.type === 'table') return (b.rows || []).map((r) => r.join(' | ')).join('\n');
      if (b.type === 'link') return `${b.text || ''} ${b.url || ''}`;
      if (b.type === 'image') return b.caption || '';
      return b.text || '';
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 5_000_000);
}

async function ownNote(userId, id) {
  const n = await prisma.note.findFirst({ where: { id, userId, deletedAt: null } });
  if (!n) throw notFound('Không tìm thấy ghi chú');
  return n;
}

/** Ghi chú đọc được: của mình, hoặc được chia sẻ trong nhóm mình tham gia (chỉ đọc). */
async function readableNote(userId, id) {
  const n = await prisma.note.findFirst({
    where: {
      id,
      deletedAt: null,
      OR: [
        { userId },
        { groupResources: { some: { group: { deletedAt: null, members: { some: { userId } } } } } },
        { posts: { some: { status: 'PUBLISHED', deletedAt: null } } },
      ],
    },
    include: { user: { select: { id: true, fullName: true } }, subject: { select: { id: true, name: true, color: true } } },
  });
  if (!n) throw notFound('Không tìm thấy ghi chú hoặc bạn không có quyền xem');
  return n;
}

async function checkSubject(userId, subjectId) {
  if (!subjectId) return;
  const s = await prisma.subject.findFirst({ where: { id: subjectId, userId, deletedAt: null } });
  if (!s) throw badRequest('Môn học không hợp lệ');
}

async function checkParent(userId, parentId, selfId) {
  if (!parentId) return;
  await ownNote(userId, parentId);
  // chống vòng lặp cây
  let id = parentId;
  let guard = 0;
  while (id && guard++ < 100) {
    if (id === selfId) throw badRequest('Không thể chuyển trang vào chính nó hoặc trang con của nó');
    const n = await prisma.note.findUnique({ where: { id }, select: { parentId: true } });
    id = n?.parentId;
  }
}

async function list(userId, { search, subjectId }) {
  const where = { userId, deletedAt: null };
  if (subjectId) where.subjectId = subjectId;
  if (search) where.OR = [{ title: { contains: search } }, { contentText: { contains: search } }];
  const rows = await prisma.note.findMany({
    where,
    select: { id: true, title: true, icon: true, parentId: true, subjectId: true, updatedAt: true, createdAt: true, sortOrder: true, contentText: Boolean(search) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 2000,
  });
  const favs = await library.favoriteIds(userId, 'NOTE', rows.map((r) => r.id));
  return rows.map((r) => {
    const out = { ...r, favorite: favs.has(r.id) };
    if (search && r.contentText) {
      const idx = r.contentText.toLowerCase().indexOf(search.toLowerCase());
      out.snippet = idx >= 0 ? r.contentText.slice(Math.max(0, idx - 50), idx + search.length + 70).replace(/\s+/g, ' ') : null;
    }
    delete out.contentText;
    return out;
  });
}

async function breadcrumb(userId, note) {
  const trail = [];
  let id = note.parentId;
  let guard = 0;
  while (id && guard++ < 50) {
    const p = await prisma.note.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true, title: true, icon: true, parentId: true } });
    if (!p) break;
    trail.unshift({ id: p.id, title: p.title, icon: p.icon });
    id = p.parentId;
  }
  return trail;
}

async function get(userId, id) {
  const n = await readableNote(userId, id);
  const canEdit = n.userId === userId;
  const [children, favs] = await Promise.all([
    prisma.note.findMany({ where: { parentId: id, deletedAt: null, userId: n.userId }, select: { id: true, title: true, icon: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    library.favoriteIds(userId, 'NOTE', [id]),
  ]);
  if (canEdit) await library.touchRecent(userId, 'NOTE', id);
  const { contentText, ...rest } = n;
  return { ...rest, canEdit, favorite: favs.has(id), children, breadcrumb: canEdit ? await breadcrumb(userId, n) : [] };
}

async function create(userId, { title, icon, parentId, subjectId, content }) {
  await checkParent(userId, parentId);
  await checkSubject(userId, subjectId);
  const c = content || EMPTY;
  const n = await prisma.note.create({ data: { userId, title, icon: icon ?? null, parentId: parentId ?? null, subjectId: subjectId ?? null, content: c, contentText: plainText(c) } });
  await activity.log(userId, 'note.create', `Tạo ghi chú "${title || 'Không tiêu đề'}"`, { entityType: 'NOTE', entityId: n.id });
  return get(userId, n.id);
}

/**
 * Tự động lưu có kiểm soát phiên bản (optimistic concurrency):
 * client gửi version đang giữ; nếu server đã có bản mới hơn (tab khác vừa lưu) => 409 kèm bản mới nhất,
 * tránh ghi đè mất dữ liệu.
 */
async function update(userId, id, { version, content, parentId, subjectId, ...fields }) {
  const n = await ownNote(userId, id);
  if (n.version !== version) {
    throw conflict('Ghi chú đã được thay đổi ở nơi khác. Hãy tải lại để xem bản mới nhất.', {
      code: 'VERSION_CONFLICT',
      details: { serverVersion: n.version, updatedAt: n.updatedAt },
    });
  }
  const data = { ...fields, version: { increment: 1 } };
  if (content) {
    data.content = content;
    data.contentText = plainText(content);
  }
  if (parentId !== undefined) {
    await checkParent(userId, parentId, id);
    data.parentId = parentId;
  }
  if (subjectId !== undefined) {
    await checkSubject(userId, subjectId);
    data.subjectId = subjectId;
  }
  // updateMany + điều kiện version để chống ghi đè đồng thời giữa 2 request gần như cùng lúc
  const res = await prisma.note.updateMany({ where: { id, userId, version }, data });
  if (res.count === 0) throw conflict('Ghi chú vừa được lưu ở nơi khác. Hãy tải lại.', { code: 'VERSION_CONFLICT' });
  const saved = await prisma.note.findUnique({ where: { id }, select: { id: true, version: true, updatedAt: true, title: true, icon: true, parentId: true, subjectId: true } });
  return saved;
}

async function remove(userId, id) {
  const n = await ownNote(userId, id);
  const now = new Date();
  const all = [id];
  for (let i = 0; i < all.length; i++) {
    const kids = await prisma.note.findMany({ where: { parentId: all[i], userId, deletedAt: null }, select: { id: true } });
    all.push(...kids.map((k) => k.id));
  }
  await prisma.note.updateMany({ where: { id: { in: all } }, data: { deletedAt: now } });
  await activity.log(userId, 'note.delete', `Chuyển ghi chú "${n.title || 'Không tiêu đề'}" vào thùng rác`, { entityType: 'NOTE', entityId: id });
  return { deleted: all.length };
}

/** Ảnh trong ghi chú được lưu vào UniDrive (thư mục "Ảnh ghi chú") để dùng chung cơ chế bảo vệ quyền. */
async function uploadImage(userId, noteId, file) {
  await ownNote(userId, noteId);
  if (!file) throw badRequest('Vui lòng chọn ảnh');
  const name = decodeOriginalName(file.originalname).slice(0, 200);
  const type = detectFileType(file.buffer, name, ['png', 'jpg', 'gif', 'webp']);
  if (!type) throw badRequest('Chỉ hỗ trợ ảnh PNG, JPG, GIF, WEBP');
  const [user, used] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { storageQuota: true } }),
    prisma.driveFile.aggregate({ where: { userId }, _sum: { size: true } }),
  ]);
  if (Number(used._sum.size || 0) + file.size > Number(user.storageQuota)) throw badRequest('Không đủ dung lượng lưu trữ');
  let folder = await prisma.folder.findFirst({ where: { userId, parentId: null, name: 'Ảnh ghi chú', deletedAt: null } });
  if (!folder) folder = await prisma.folder.create({ data: { userId, name: 'Ảnh ghi chú', color: '#0891B2' } });
  const { storedName, checksum } = await storage.save(file.buffer, type.ext);
  const rec = await prisma.driveFile.create({
    data: { userId, folderId: folder.id, originalName: name, storedName, mimeType: type.mime, extension: type.ext, size: BigInt(file.size), checksum },
  });
  return { fileId: rec.id, url: `/api/v1/notes/${noteId}/images/${rec.id}` };
}

/** Ảnh hiển thị trong ghi chú: người đọc được ghi chú => xem được ảnh mà ghi chú tham chiếu. */
async function imageFile(userId, noteId, fileId) {
  const n = await readableNote(userId, noteId);
  const referenced = (n.content?.blocks || []).some((b) => b.type === 'image' && b.fileId === fileId);
  const file = await prisma.driveFile.findFirst({ where: { id: fileId, userId: n.userId, deletedAt: null } });
  if (!file || (!referenced && n.userId !== userId)) throw notFound('Không tìm thấy ảnh');
  return { path: storage.absolutePath(file.storedName), mime: file.mimeType };
}

async function aiAction(userId, id, { action, text, count = 8 }) {
  const n = await readableNote(userId, id);
  ai.ensureConfigured();
  const source = (text && text.trim()) || n.contentText;
  if (!source.trim()) throw badRequest('Ghi chú chưa có nội dung');
  const label = `Ghi chú "${n.title || 'Không tiêu đề'}"`;
  if (action === 'quiz') {
    const { data } = await ai.completeJson(userId, 'note.quiz', {
      system: prompts.quizPrompt({ count, types: ['SINGLE', 'MULTIPLE', 'TRUE_FALSE', 'SHORT'], difficulty: 'MEDIUM' }),
      messages: [{ role: 'user', content: `${label}:\n\n${source}` }],
    });
    return { action, questions: Array.isArray(data?.questions) ? data.questions : [], note: 'Xem lại và chỉnh sửa trước khi lưu thành bộ câu hỏi.' };
  }
  if (action === 'flashcards') {
    const { data } = await ai.completeJson(userId, 'note.flashcards', { system: prompts.FLASHCARDS, messages: [{ role: 'user', content: `${label}:\n\n${source}` }] });
    return { action, cards: Array.isArray(data?.cards) ? data.cards.filter((c) => c?.front && c?.back) : [] };
  }
  const spec = prompts.TEXT_ACTIONS[action];
  const result = await ai.complete(userId, `note.${action}`, {
    system: prompts.BASE,
    messages: [{ role: 'user', content: `${spec.instruction}\n\n${text ? 'Đoạn được chọn' : label}:\n\n${source}` }],
  });
  return { action, title: spec.title, content: result.text };
}

module.exports = { list, get, create, update, remove, uploadImage, imageFile, aiAction, readableNote, plainText };
