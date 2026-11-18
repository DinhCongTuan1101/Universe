'use strict';
/**
 * Favorites, Recently Viewed, Trash, Activity History – dùng chung cho mọi module.
 */
const prisma = require('../../database/prisma');
const { notFound, badRequest } = require('../../utils/errors');
const storage = require('../../services/storage.service');

const ENTITY_TYPES = ['FILE', 'FOLDER', 'NOTE', 'WORKBOOK', 'TASK', 'QUIZ_SET', 'GROUP', 'POST', 'SUBJECT', 'CONVERSATION'];

// ------------------------------------------------------------ Quyền truy cập theo loại đối tượng
/** Kiểm tra người dùng có quyền xem đối tượng và trả về {title, link, icon} để hiển thị. */
async function resolveEntity(userId, type, id) {
  switch (type) {
    case 'FILE': {
      const f = await prisma.driveFile.findFirst({
        where: {
          id,
          deletedAt: null,
          OR: [{ userId }, { groupResources: { some: { group: { deletedAt: null, members: { some: { userId } } } } } }],
        },
        select: { originalName: true, folderId: true, extension: true },
      });
      return f && { title: f.originalName, link: `/drive?file=${id}`, meta: f.extension };
    }
    case 'FOLDER': {
      const f = await prisma.folder.findFirst({ where: { id, userId, deletedAt: null }, select: { name: true } });
      return f && { title: f.name, link: `/drive?folder=${id}` };
    }
    case 'NOTE': {
      const n = await prisma.note.findFirst({
        where: { id, deletedAt: null, OR: [{ userId }, { groupResources: { some: { group: { deletedAt: null, members: { some: { userId } } } } } }] },
        select: { title: true, icon: true },
      });
      return n && { title: n.title || 'Trang không tiêu đề', link: `/notes/${id}`, meta: n.icon };
    }
    case 'WORKBOOK': {
      const w = await prisma.workbook.findFirst({ where: { id, userId, deletedAt: null }, select: { title: true } });
      return w && { title: w.title, link: `/sheets/${id}` };
    }
    case 'TASK': {
      const t = await prisma.task.findFirst({ where: { id, userId, deletedAt: null }, select: { title: true, groupId: true } });
      return t && { title: t.title, link: t.groupId ? `/groups/${t.groupId}?tab=tasks` : `/tasks?open=${id}` };
    }
    case 'QUIZ_SET': {
      const q = await prisma.quizSet.findFirst({ where: { id, userId, deletedAt: null }, select: { title: true } });
      return q && { title: q.title, link: `/quiz/${id}` };
    }
    case 'GROUP': {
      const g = await prisma.group.findFirst({ where: { id, deletedAt: null, members: { some: { userId } } }, select: { name: true } });
      return g && { title: g.name, link: `/groups/${id}` };
    }
    case 'POST': {
      const p = await prisma.post.findFirst({ where: { id, deletedAt: null, OR: [{ status: 'PUBLISHED' }, { authorId: userId }] }, select: { title: true } });
      return p && { title: p.title, link: `/share/${id}` };
    }
    case 'SUBJECT': {
      const s = await prisma.subject.findFirst({ where: { id, userId, deletedAt: null }, select: { name: true } });
      return s && { title: s.name, link: `/schedule?subject=${id}` };
    }
    case 'CONVERSATION': {
      const c = await prisma.aiConversation.findFirst({ where: { id, userId, deletedAt: null }, select: { title: true } });
      return c && { title: c.title, link: `/ai/${id}` };
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------ Favorites
async function favoriteIds(userId, entityType, ids) {
  if (!ids.length) return new Set();
  const rows = await prisma.favorite.findMany({ where: { userId, entityType, entityId: { in: ids } }, select: { entityId: true } });
  return new Set(rows.map((r) => r.entityId));
}

async function setFavorite(userId, entityType, entityId, value) {
  if (value) {
    const ok = await resolveEntity(userId, entityType, entityId);
    if (!ok) throw notFound('Không tìm thấy đối tượng');
    await prisma.favorite.upsert({
      where: { userId_entityType_entityId: { userId, entityType, entityId } },
      create: { userId, entityType, entityId },
      update: {},
    });
  } else {
    await prisma.favorite.deleteMany({ where: { userId, entityType, entityId } });
  }
  return { favorite: value };
}

async function listFavorites(userId, entityType) {
  const rows = await prisma.favorite.findMany({ where: { userId, ...(entityType ? { entityType } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
  const out = [];
  for (const r of rows) {
    const e = await resolveEntity(userId, r.entityType, r.entityId);
    if (e) out.push({ id: r.id, entityType: r.entityType, entityId: r.entityId, createdAt: r.createdAt, ...e });
  }
  return out;
}

// ------------------------------------------------------------ Recently viewed
async function touchRecent(userId, entityType, entityId) {
  try {
    await prisma.recentView.upsert({
      where: { userId_entityType_entityId: { userId, entityType, entityId } },
      create: { userId, entityType, entityId },
      update: { viewedAt: new Date() },
    });
  } catch {
    /* không quan trọng */
  }
}

async function listRecent(userId, { entityType, limit = 20 } = {}) {
  const rows = await prisma.recentView.findMany({
    where: { userId, ...(entityType ? { entityType } : {}) },
    orderBy: { viewedAt: 'desc' },
    take: Math.min(limit * 2, 100),
  });
  const out = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    const e = await resolveEntity(userId, r.entityType, r.entityId);
    if (e) out.push({ entityType: r.entityType, entityId: r.entityId, viewedAt: r.viewedAt, ...e });
  }
  return out;
}

// ------------------------------------------------------------ Trash
const TRASH_MODELS = {
  FILE: { model: 'driveFile', title: 'originalName', owner: 'userId' },
  FOLDER: { model: 'folder', title: 'name', owner: 'userId' },
  NOTE: { model: 'note', title: 'title', owner: 'userId' },
  WORKBOOK: { model: 'workbook', title: 'title', owner: 'userId' },
  TASK: { model: 'task', title: 'title', owner: 'userId' },
  QUIZ_SET: { model: 'quizSet', title: 'title', owner: 'userId' },
  SUBJECT: { model: 'subject', title: 'name', owner: 'userId' },
  SEMESTER: { model: 'semester', title: 'name', owner: 'userId' },
  CONVERSATION: { model: 'aiConversation', title: 'title', owner: 'userId' },
};

async function listTrash(userId) {
  const items = [];
  for (const [type, m] of Object.entries(TRASH_MODELS)) {
    const where = { [m.owner]: userId, deletedAt: { not: null } };
    if (type === 'TASK') where.groupId = null;
    const rows = await prisma[m.model].findMany({ where, select: { id: true, [m.title]: true, deletedAt: true }, orderBy: { deletedAt: 'desc' }, take: 200 });
    for (const r of rows) items.push({ entityType: type, entityId: r.id, title: r[m.title] || '(không tiêu đề)', deletedAt: r.deletedAt });
  }
  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

async function restore(userId, type, id) {
  const m = TRASH_MODELS[type];
  if (!m) throw badRequest('Loại dữ liệu không hỗ trợ khôi phục');
  const row = await prisma[m.model].findFirst({ where: { id, [m.owner]: userId, deletedAt: { not: null } } });
  if (!row) throw notFound('Không tìm thấy trong thùng rác');
  const data = { deletedAt: null };
  // Nếu thư mục cha đã bị xóa => đưa về gốc để không "mất tích"
  if (type === 'FILE' && row.folderId) {
    const parent = await prisma.folder.findFirst({ where: { id: row.folderId, deletedAt: null } });
    if (!parent) data.folderId = null;
  }
  if (type === 'FOLDER' && row.parentId) {
    const parent = await prisma.folder.findFirst({ where: { id: row.parentId, deletedAt: null } });
    if (!parent) data.parentId = null;
  }
  if (type === 'NOTE' && row.parentId) {
    const parent = await prisma.note.findFirst({ where: { id: row.parentId, deletedAt: null } });
    if (!parent) data.parentId = null;
  }
  await prisma[m.model].update({ where: { id }, data });
  if (type === 'FOLDER') {
    // khôi phục cả nội dung bị xóa cùng thời điểm
    await restoreFolderTree(userId, id, row.deletedAt);
  }
  if (type === 'SEMESTER') {
    await prisma.subject.updateMany({ where: { semesterId: id, userId, deletedAt: row.deletedAt }, data: { deletedAt: null } });
  }
  return { restored: true };
}

async function restoreFolderTree(userId, folderId, deletedAt) {
  const queue = [folderId];
  while (queue.length) {
    const id = queue.shift();
    await prisma.driveFile.updateMany({ where: { userId, folderId: id, deletedAt }, data: { deletedAt: null } });
    const children = await prisma.folder.findMany({ where: { userId, parentId: id, deletedAt }, select: { id: true } });
    if (children.length) {
      await prisma.folder.updateMany({ where: { id: { in: children.map((c) => c.id) } }, data: { deletedAt: null } });
      queue.push(...children.map((c) => c.id));
    }
  }
}

/** Xóa vĩnh viễn (không thể hoàn tác). File trên đĩa cũng bị xóa. */
async function purge(userId, type, id) {
  const m = TRASH_MODELS[type];
  if (!m) throw badRequest('Loại dữ liệu không hỗ trợ');
  const row = await prisma[m.model].findFirst({ where: { id, [m.owner]: userId, deletedAt: { not: null } } });
  if (!row) throw notFound('Không tìm thấy trong thùng rác');
  if (type === 'FILE') {
    await prisma.driveFile.delete({ where: { id } });
    await storage.remove(row.storedName).catch(() => {});
  } else if (type === 'FOLDER') {
    const files = await collectFolderFiles(userId, id);
    await prisma.folder.delete({ where: { id } }); // cascade thư mục con; file => folderId SetNull
    for (const f of files) {
      await prisma.driveFile.delete({ where: { id: f.id } }).catch(() => {});
      await storage.remove(f.storedName).catch(() => {});
    }
  } else {
    await prisma[m.model].delete({ where: { id } });
  }
  if (ENTITY_TYPES.includes(type)) {
    await prisma.favorite.deleteMany({ where: { userId, entityType: type, entityId: id } }).catch(() => {});
    await prisma.recentView.deleteMany({ where: { userId, entityType: type, entityId: id } }).catch(() => {});
  }
  return { purged: true };
}

async function collectFolderFiles(userId, folderId) {
  const files = [];
  const queue = [folderId];
  while (queue.length) {
    const id = queue.shift();
    files.push(...(await prisma.driveFile.findMany({ where: { userId, folderId: id }, select: { id: true, storedName: true } })));
    const children = await prisma.folder.findMany({ where: { userId, parentId: id }, select: { id: true } });
    queue.push(...children.map((c) => c.id));
  }
  return files;
}

async function emptyTrash(userId) {
  const items = await listTrash(userId);
  let count = 0;
  for (const it of items) {
    try {
      await purge(userId, it.entityType, it.entityId);
      count++;
    } catch {
      /* có thể đã bị xóa theo thư mục cha */
    }
  }
  return { purged: count };
}

module.exports = {
  ENTITY_TYPES,
  resolveEntity,
  favoriteIds,
  setFavorite,
  listFavorites,
  touchRecent,
  listRecent,
  listTrash,
  restore,
  purge,
  emptyTrash,
  TRASH_TYPES: Object.keys(TRASH_MODELS),
};
