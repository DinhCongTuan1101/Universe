'use strict';
const prisma = require('../../database/prisma');
const storage = require('../../services/storage.service');
const documents = require('./document.service');
const library = require('../library/library.service');
const activity = require('../../services/activity.service');
const ai = require('../../services/ai/ai.service');
const prompts = require('../../services/ai/prompts');
const retrieval = require('../../services/retrieval.service');
const config = require('../../config');
const { detectFileType, extOf } = require('../../utils/fileType');
const { decodeOriginalName } = require('../../middlewares/upload');
const { notFound, badRequest, conflict, forbidden } = require('../../utils/errors');

const ALLOWED_EXT = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'md', 'csv', 'png', 'jpg', 'gif', 'webp', 'zip'];
const INLINE_EXT = new Set(['pdf', 'png', 'jpg', 'gif', 'webp', 'txt', 'md', 'csv']);

const FILE_SELECT = {
  id: true,
  userId: true,
  folderId: true,
  subjectId: true,
  originalName: true,
  mimeType: true,
  extension: true,
  size: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  subject: { select: { id: true, name: true, color: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  document: { select: { status: true, errorMessage: true, charCount: true, pageCount: true, chunkCount: true, embeddedCount: true, embeddingModel: true } },
  user: { select: { id: true, fullName: true } },
};

function shapeFile(f, favs) {
  return {
    ...f,
    size: Number(f.size),
    tags: f.tags.map((t) => t.tag),
    favorite: favs ? favs.has(f.id) : undefined,
    previewable: INLINE_EXT.has(f.extension) || f.extension === 'docx',
  };
}

// ------------------------------------------------------------------ Quyền truy cập
async function ownFile(userId, id, { includeDeleted = false } = {}) {
  const f = await prisma.driveFile.findFirst({ where: { id, userId, ...(includeDeleted ? {} : { deletedAt: null }) } });
  if (!f) throw notFound('Không tìm thấy file');
  return f;
}

/**
 * Người dùng được đọc file khi: là chủ sở hữu, HOẶC file được chia sẻ trong nhóm mà họ là thành viên,
 * HOẶC file đính kèm một bài viết UniShare đang công khai.
 */
async function readableFile(userId, id) {
  const f = await prisma.driveFile.findFirst({
    where: {
      id,
      deletedAt: null,
      OR: [
        { userId },
        { groupResources: { some: { group: { deletedAt: null, members: { some: { userId } } } } } },
        { posts: { some: { status: 'PUBLISHED', deletedAt: null } } },
      ],
    },
  });
  if (!f) throw notFound('Không tìm thấy file hoặc bạn không có quyền truy cập');
  return f;
}

async function ownFolder(userId, id) {
  const f = await prisma.folder.findFirst({ where: { id, userId, deletedAt: null } });
  if (!f) throw notFound('Không tìm thấy thư mục');
  return f;
}

async function ownSubjectId(userId, subjectId) {
  if (!subjectId) return subjectId;
  const s = await prisma.subject.findFirst({ where: { id: subjectId, userId, deletedAt: null }, select: { id: true } });
  if (!s) throw badRequest('Môn học không hợp lệ');
  return subjectId;
}

// ------------------------------------------------------------------ Danh sách
async function breadcrumb(userId, folderId) {
  const trail = [];
  let id = folderId;
  let guard = 0;
  while (id && guard++ < 50) {
    const f = await prisma.folder.findFirst({ where: { id, userId }, select: { id: true, name: true, parentId: true } });
    if (!f) break;
    trail.unshift({ id: f.id, name: f.name });
    id = f.parentId;
  }
  return trail;
}

async function list(userId, q) {
  const { view = 'my', folderId = null, subjectId, tagId, search, sort = 'name', type } = q;
  const orderBy = sort === 'date' ? { updatedAt: 'desc' } : sort === 'size' ? { size: 'desc' } : { originalName: 'asc' };
  const typeFilter = type ? fileTypeFilter(type) : {};

  if (view === 'shared') {
    const rows = await prisma.groupResource.findMany({
      where: { type: 'FILE', group: { deletedAt: null, members: { some: { userId } } }, file: { deletedAt: null, NOT: { userId } } },
      include: { group: { select: { id: true, name: true } }, file: { select: FILE_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { view, folders: [], files: rows.map((r) => ({ ...shapeFile(r.file), sharedIn: r.group, sharedAt: r.createdAt })), breadcrumb: [] };
  }

  if (view === 'favorites') {
    const favs = await prisma.favorite.findMany({ where: { userId, entityType: { in: ['FILE', 'FOLDER'] } } });
    const fileIds = favs.filter((f) => f.entityType === 'FILE').map((f) => f.entityId);
    const folderIds = favs.filter((f) => f.entityType === 'FOLDER').map((f) => f.entityId);
    const [files, folders] = await Promise.all([
      prisma.driveFile.findMany({ where: { id: { in: fileIds }, userId, deletedAt: null }, select: FILE_SELECT, orderBy }),
      prisma.folder.findMany({ where: { id: { in: folderIds }, userId, deletedAt: null }, orderBy: { name: 'asc' } }),
    ]);
    const set = new Set(fileIds);
    return { view, folders: folders.map((f) => ({ ...f, favorite: true })), files: files.map((f) => shapeFile(f, set)), breadcrumb: [] };
  }

  if (view === 'recent') {
    const recents = await prisma.recentView.findMany({ where: { userId, entityType: 'FILE' }, orderBy: { viewedAt: 'desc' }, take: 50 });
    const files = await prisma.driveFile.findMany({ where: { id: { in: recents.map((r) => r.entityId) }, userId, deletedAt: null }, select: FILE_SELECT });
    const byId = new Map(files.map((f) => [f.id, f]));
    const ordered = recents.map((r) => byId.get(r.entityId)).filter(Boolean);
    const favs = await library.favoriteIds(userId, 'FILE', ordered.map((f) => f.id));
    return { view, folders: [], files: ordered.map((f) => shapeFile(f, favs)), breadcrumb: [] };
  }

  // view "my": duyệt thư mục hoặc tìm kiếm/lọc toàn bộ
  const filtering = Boolean(search || subjectId || tagId || type);
  if (folderId) await ownFolder(userId, folderId);
  const fileWhere = { userId, deletedAt: null, ...typeFilter };
  if (!filtering) fileWhere.folderId = folderId;
  if (subjectId) fileWhere.subjectId = subjectId;
  if (tagId) fileWhere.tags = { some: { tagId } };

  let contentMatches = new Map();
  if (search) {
    // Tìm theo tên + mô tả + NỘI DUNG đã trích xuất (tìm kiếm từ khóa)
    const chunks = await prisma.documentChunk.findMany({
      where: { userId, content: { contains: search }, document: { file: { deletedAt: null } } },
      select: { content: true, pageNumber: true, document: { select: { fileId: true } } },
      take: 300,
    });
    for (const c of chunks) {
      if (contentMatches.has(c.document.fileId)) continue;
      const idx = c.content.toLowerCase().indexOf(search.toLowerCase());
      const snippet = c.content.slice(Math.max(0, idx - 60), idx + search.length + 80).replace(/\s+/g, ' ');
      contentMatches.set(c.document.fileId, { snippet, pageNumber: c.pageNumber });
    }
    fileWhere.OR = [{ originalName: { contains: search } }, { description: { contains: search } }, { id: { in: [...contentMatches.keys()] } }];
  }

  const [files, folders] = await Promise.all([
    prisma.driveFile.findMany({ where: fileWhere, select: FILE_SELECT, orderBy, take: 500 }),
    filtering
      ? search
        ? prisma.folder.findMany({ where: { userId, deletedAt: null, name: { contains: search } }, orderBy: { name: 'asc' }, take: 100 })
        : []
      : prisma.folder.findMany({
          where: { userId, deletedAt: null, parentId: folderId },
          orderBy: { name: 'asc' },
          include: { _count: { select: { files: { where: { deletedAt: null } }, children: { where: { deletedAt: null } } } } },
        }),
  ]);
  const [favFiles, favFolders] = await Promise.all([
    library.favoriteIds(userId, 'FILE', files.map((f) => f.id)),
    library.favoriteIds(userId, 'FOLDER', folders.map((f) => f.id)),
  ]);
  return {
    view,
    filtering,
    folder: folderId ? await prisma.folder.findUnique({ where: { id: folderId } }) : null,
    breadcrumb: folderId ? await breadcrumb(userId, folderId) : [],
    folders: folders.map((f) => ({ ...f, favorite: favFolders.has(f.id) })),
    files: files.map((f) => ({ ...shapeFile(f, favFiles), match: contentMatches.get(f.id) })),
  };
}

function fileTypeFilter(type) {
  const groups = {
    document: ['pdf', 'docx', 'doc', 'txt', 'md'],
    spreadsheet: ['xlsx', 'xls', 'csv'],
    presentation: ['pptx', 'ppt'],
    image: ['png', 'jpg', 'gif', 'webp'],
    archive: ['zip'],
  };
  return groups[type] ? { extension: { in: groups[type] } } : {};
}

async function folderTree(userId) {
  return prisma.folder.findMany({ where: { userId, deletedAt: null }, select: { id: true, name: true, parentId: true }, orderBy: { name: 'asc' } });
}

// ------------------------------------------------------------------ Thư mục
async function createFolder(userId, { name, parentId = null, color }) {
  if (parentId) await ownFolder(userId, parentId);
  const dup = await prisma.folder.findFirst({ where: { userId, parentId, name, deletedAt: null } });
  if (dup) throw conflict('Đã có thư mục cùng tên ở vị trí này');
  const f = await prisma.folder.create({ data: { userId, parentId, name, color } });
  await activity.log(userId, 'drive.folder_create', `Tạo thư mục "${name}"`, { entityType: 'FOLDER', entityId: f.id });
  return f;
}

async function isDescendant(userId, candidateId, ancestorId) {
  let id = candidateId;
  let guard = 0;
  while (id && guard++ < 100) {
    if (id === ancestorId) return true;
    const f = await prisma.folder.findFirst({ where: { id, userId }, select: { parentId: true } });
    id = f?.parentId;
  }
  return false;
}

async function updateFolder(userId, id, { name, parentId, color }) {
  const folder = await ownFolder(userId, id);
  const data = {};
  if (name !== undefined) data.name = name;
  if (color !== undefined) data.color = color;
  if (parentId !== undefined) {
    if (parentId) {
      await ownFolder(userId, parentId);
      if (await isDescendant(userId, parentId, id)) throw badRequest('Không thể chuyển thư mục vào chính nó hoặc thư mục con của nó');
    }
    data.parentId = parentId;
  }
  const targetParent = data.parentId !== undefined ? data.parentId : folder.parentId;
  const targetName = data.name ?? folder.name;
  const dup = await prisma.folder.findFirst({ where: { userId, parentId: targetParent, name: targetName, deletedAt: null, NOT: { id } } });
  if (dup) throw conflict('Đã có thư mục cùng tên ở vị trí này');
  return prisma.folder.update({ where: { id }, data });
}

async function deleteFolder(userId, id) {
  const folder = await ownFolder(userId, id);
  const now = new Date();
  // Xóa mềm toàn bộ cây con cùng một mốc thời gian (để khôi phục chính xác)
  const queue = [id];
  const all = [];
  while (queue.length) {
    const cur = queue.shift();
    all.push(cur);
    const children = await prisma.folder.findMany({ where: { userId, parentId: cur, deletedAt: null }, select: { id: true } });
    queue.push(...children.map((c) => c.id));
  }
  await prisma.$transaction([
    prisma.folder.updateMany({ where: { id: { in: all } }, data: { deletedAt: now } }),
    prisma.driveFile.updateMany({ where: { userId, folderId: { in: all }, deletedAt: null }, data: { deletedAt: now } }),
  ]);
  await activity.log(userId, 'drive.folder_delete', `Chuyển thư mục "${folder.name}" vào thùng rác`, { entityType: 'FOLDER', entityId: id });
}

// ------------------------------------------------------------------ File
async function upload(userId, files, { folderId = null, subjectId = null }) {
  if (!files?.length) throw badRequest('Vui lòng chọn file');
  if (folderId) await ownFolder(userId, folderId);
  await ownSubjectId(userId, subjectId);
  const [user, used] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { storageQuota: true } }),
    prisma.driveFile.aggregate({ where: { userId }, _sum: { size: true } }),
  ]);
  const incoming = files.reduce((a, f) => a + f.size, 0);
  if (Number(used._sum.size || 0) + incoming > Number(user.storageQuota)) {
    throw badRequest('Không đủ dung lượng lưu trữ. Hãy xóa bớt file (kể cả trong thùng rác).', { code: 'QUOTA_EXCEEDED' });
  }
  const results = [];
  const rejected = [];
  for (const f of files) {
    const name = decodeOriginalName(f.originalname).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 255) || 'file';
    const type = detectFileType(f.buffer, name, ALLOWED_EXT);
    if (!type) {
      rejected.push({ name, reason: 'Định dạng không được hỗ trợ hoặc nội dung không khớp phần mở rộng' });
      continue;
    }
    const { storedName, checksum } = await storage.save(f.buffer, type.ext);
    try {
      const rec = await prisma.driveFile.create({
        data: {
          userId,
          folderId,
          subjectId,
          originalName: name,
          storedName,
          mimeType: type.mime,
          extension: type.ext,
          size: BigInt(f.size),
          checksum,
          ...(documents.isExtractable(type.ext) ? { document: { create: { status: 'UPLOADED' } } } : {}),
        },
        select: { ...FILE_SELECT, document: { select: { id: true, status: true } } },
      });
      if (rec.document) documents.enqueue(rec.document.id);
      results.push(shapeFile({ ...rec, tags: [] }));
    } catch (err) {
      await storage.remove(storedName).catch(() => {});
      throw err;
    }
  }
  if (results.length) {
    await activity.log(userId, 'drive.upload', `Tải lên ${results.length} file${results.length === 1 ? ` "${results[0].originalName}"` : ''}`, {
      entityType: 'FILE',
      entityId: results[0].id,
    });
  }
  return { files: results, rejected };
}

async function getFile(userId, id) {
  const f = await readableFile(userId, id);
  const full = await prisma.driveFile.findUnique({ where: { id: f.id }, select: FILE_SELECT });
  const favs = await library.favoriteIds(userId, 'FILE', [id]);
  await library.touchRecent(userId, 'FILE', id);
  return { ...shapeFile(full, favs), isOwner: f.userId === userId, breadcrumb: f.userId === userId && f.folderId ? await breadcrumb(userId, f.folderId) : [] };
}

async function setTags(userId, fileId, names) {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 10);
  const tags = [];
  for (const name of clean) {
    tags.push(await prisma.tag.upsert({ where: { userId_name: { userId, name } }, create: { userId, name }, update: {} }));
  }
  await prisma.$transaction([
    prisma.fileTag.deleteMany({ where: { fileId } }),
    prisma.fileTag.createMany({ data: tags.map((t) => ({ fileId, tagId: t.id })) }),
  ]);
}

async function updateFile(userId, id, { name, folderId, subjectId, description, tags }) {
  const file = await ownFile(userId, id);
  const data = {};
  if (name !== undefined) {
    let n = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
    // Giữ nguyên phần mở rộng thật của file
    if (extOf(n) !== file.extension && !(file.extension === 'jpg' && extOf(n) === 'jpg')) n = `${n}.${file.extension}`;
    data.originalName = n.slice(0, 255);
  }
  if (folderId !== undefined) {
    if (folderId) await ownFolder(userId, folderId);
    data.folderId = folderId;
  }
  if (subjectId !== undefined) data.subjectId = await ownSubjectId(userId, subjectId);
  if (description !== undefined) data.description = description;
  await prisma.driveFile.update({ where: { id }, data });
  if (tags) await setTags(userId, id, tags);
  return getFile(userId, id);
}

async function copyFile(userId, id, { folderId }) {
  const file = await ownFile(userId, id);
  const target = folderId === undefined ? file.folderId : folderId;
  if (target) await ownFolder(userId, target);
  const [user, used] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { storageQuota: true } }),
    prisma.driveFile.aggregate({ where: { userId }, _sum: { size: true } }),
  ]);
  if (Number(used._sum.size || 0) + Number(file.size) > Number(user.storageQuota)) throw badRequest('Không đủ dung lượng lưu trữ');
  const storedName = await storage.copy(file.storedName, file.extension);
  const dot = file.originalName.lastIndexOf('.');
  const copyName = dot > 0 ? `${file.originalName.slice(0, dot)} (bản sao)${file.originalName.slice(dot)}` : `${file.originalName} (bản sao)`;
  const rec = await prisma.driveFile.create({
    data: {
      userId,
      folderId: target,
      subjectId: file.subjectId,
      originalName: copyName.slice(0, 255),
      storedName,
      mimeType: file.mimeType,
      extension: file.extension,
      size: file.size,
      checksum: file.checksum,
      description: file.description,
      ...(documents.isExtractable(file.extension) ? { document: { create: { status: 'UPLOADED' } } } : {}),
    },
    include: { document: true },
  });
  if (rec.document) documents.enqueue(rec.document.id);
  return getFile(userId, rec.id);
}

async function deleteFile(userId, id) {
  const f = await ownFile(userId, id);
  await prisma.driveFile.update({ where: { id }, data: { deletedAt: new Date() } });
  await activity.log(userId, 'drive.delete', `Chuyển "${f.originalName}" vào thùng rác`, { entityType: 'FILE', entityId: id });
}

/** Trả về thông tin để controller stream file. */
async function fileForDownload(userId, id, { inline }) {
  const f = await readableFile(userId, id);
  if (f.userId === userId) await library.touchRecent(userId, 'FILE', id);
  return {
    path: storage.absolutePath(f.storedName),
    name: f.originalName,
    mime: f.mimeType,
    inline: inline && INLINE_EXT.has(f.extension),
    ext: f.extension,
  };
}

/** Văn bản đã trích xuất (dùng xem trước DOCX/TXT và đọc nội dung). */
async function fileText(userId, id, { maxChars = 200000 } = {}) {
  const f = await readableFile(userId, id);
  const doc = await prisma.document.findUnique({ where: { fileId: f.id } });
  if (!doc) throw badRequest('Định dạng này không hỗ trợ trích xuất văn bản');
  if (doc.status !== 'READY') return { status: doc.status, errorMessage: doc.errorMessage, text: '' };
  const chunks = await prisma.documentChunk.findMany({ where: { documentId: doc.id }, orderBy: { chunkIndex: 'asc' }, select: { content: true, charStart: true, charEnd: true, pageNumber: true } });
  // Ghép lại các đoạn, bỏ phần chồng lấn
  let text = '';
  let lastEnd = 0;
  for (const c of chunks) {
    const skip = Math.max(0, lastEnd - c.charStart);
    text += (text && skip === 0 ? '\n\n' : '') + c.content.slice(skip);
    lastEnd = c.charEnd;
    if (text.length > maxChars) break;
  }
  return { status: doc.status, pageCount: doc.pageCount, charCount: doc.charCount, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

async function listTags(userId) {
  return prisma.tag.findMany({ where: { userId }, orderBy: { name: 'asc' }, include: { _count: { select: { files: true } } } });
}

// ------------------------------------------------------------------ AI cho tài liệu
async function docTextForAi(userId, id) {
  const t = await fileText(userId, id, { maxChars: config.ai.maxInputChars });
  if (t.status !== 'READY') throw badRequest('Tài liệu chưa được xử lý xong hoặc không có nội dung văn bản');
  return t;
}

async function aiAction(userId, id, action) {
  const file = await readableFile(userId, id);
  ai.ensureConfigured();
  if (action === 'classify') {
    if (file.userId !== userId) throw forbidden('Chỉ chủ sở hữu mới phân loại được tài liệu');
    const t = await docTextForAi(userId, id);
    const subjects = await prisma.subject.findMany({ where: { userId, deletedAt: null }, select: { id: true, name: true } });
    const { data } = await ai.completeJson(userId, 'drive.classify', {
      system: prompts.CLASSIFY,
      messages: [
        {
          role: 'user',
          content: `Tên file: ${file.originalName}\nDanh sách môn học: ${subjects.map((s) => s.name).join('; ') || '(chưa có)'}\n\nNội dung (trích đầu tài liệu):\n${t.text.slice(0, 6000)}`,
        },
      ],
      maxTokens: 400,
    });
    const match = subjects.find((s) => data?.subject && s.name.toLowerCase() === String(data.subject).toLowerCase());
    return {
      suggestion: {
        subjectId: match?.id ?? null,
        subjectName: data?.subject ?? null,
        tags: Array.isArray(data?.tags) ? data.tags.slice(0, 5).map(String) : [],
        documentType: data?.documentType ?? null,
        reason: data?.reason ?? null,
      },
      note: 'Đây chỉ là gợi ý – bấm "Áp dụng" để lưu.',
    };
  }
  const spec = prompts.TEXT_ACTIONS[action];
  if (!spec) throw badRequest('Thao tác AI không hợp lệ');
  const t = await docTextForAi(userId, id);
  const result = await ai.complete(userId, `drive.${action}`, {
    system: prompts.BASE,
    messages: [{ role: 'user', content: `${spec.instruction}\n\nTài liệu "${file.originalName}"${t.truncated ? ' (đã cắt bớt vì quá dài)' : ''}:\n\n${t.text}` }],
  });
  return { action, title: spec.title, content: result.text, truncated: t.truncated };
}

/** Hỏi đáp dựa trên tài liệu (RAG): chỉ gửi các đoạn liên quan, không gửi toàn bộ tài liệu. */
async function ask(userId, fileIds, question) {
  ai.ensureConfigured();
  for (const id of fileIds) await readableFile(userId, id);
  const { method, chunks } = await retrieval.retrieve(userId, question, { fileIds, limit: 6 });
  if (!chunks.length) {
    return { answer: 'Không tìm thấy đoạn nào trong tài liệu liên quan tới câu hỏi. Hãy thử diễn đạt khác hoặc dùng từ khóa có trong tài liệu.', sources: [], method };
  }
  const result = await ai.complete(userId, 'drive.ask', {
    system: `${prompts.BASE}\n${prompts.DOC_RULES}`,
    messages: [{ role: 'user', content: `ĐOẠN TRÍCH TÀI LIỆU:\n${retrieval.formatContext(chunks)}\n\nCÂU HỎI: ${question}` }],
  });
  return { answer: result.text, method, sources: chunks.map((c, i) => ({ ref: i + 1, fileId: c.fileId, fileName: c.fileName, pageNumber: c.pageNumber, chunkIndex: c.chunkIndex, excerpt: c.content.slice(0, 300), score: c.score })) };
}

module.exports = {
  ALLOWED_EXT,
  list,
  folderTree,
  createFolder,
  updateFolder,
  deleteFolder,
  upload,
  getFile,
  updateFile,
  copyFile,
  deleteFile,
  fileForDownload,
  fileText,
  listTags,
  aiAction,
  ask,
  readableFile,
  ownFile,
};
