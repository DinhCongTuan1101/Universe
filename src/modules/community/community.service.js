'use strict';
const prisma = require('../../database/prisma');
const activity = require('../../services/activity.service');
const library = require('../library/library.service');
const { notify } = require('../../services/notification.service');
const { notFound, forbidden, badRequest, conflict } = require('../../utils/errors');

const isMod = (user) => user.role === 'MODERATOR' || user.role === 'ADMIN';
const AUTHOR = { select: { id: true, fullName: true, avatarPath: true, university: true, role: true } };

const REPORT_REASONS = {
  spam: 'Spam / quảng cáo',
  copyright: 'Vi phạm bản quyền',
  inappropriate: 'Nội dung không phù hợp',
  misinformation: 'Thông tin sai lệch',
  harassment: 'Quấy rối / xúc phạm',
  other: 'Khác',
};

function visibleWhere(user) {
  // Người thường thấy bài PUBLISHED + bài của chính mình; moderator thấy mọi bài chưa xóa
  return isMod(user) ? { deletedAt: null } : { deletedAt: null, OR: [{ status: 'PUBLISHED' }, { authorId: user.id }] };
}

async function list(user, q) {
  const where = { AND: [visibleWhere(user)] };
  if (q.type) where.AND.push({ type: q.type });
  if (q.subject) where.AND.push({ subjectName: { contains: q.subject } });
  if (q.topic) where.AND.push({ topic: { contains: q.topic } });
  if (q.mine) where.AND.push({ authorId: user.id });
  if (q.status && isMod(user)) where.AND.push({ status: q.status });
  if (q.search) where.AND.push({ OR: [{ title: { contains: q.search } }, { content: { contains: q.search } }, { subjectName: { contains: q.search } }, { topic: { contains: q.search } }] });
  if (q.bookmarked) {
    const favs = await prisma.favorite.findMany({ where: { userId: user.id, entityType: 'POST' }, select: { entityId: true } });
    where.AND.push({ id: { in: favs.map((f) => f.entityId) } });
  }
  const orderBy =
    q.sort === 'top' ? [{ viewCount: 'desc' }, { createdAt: 'desc' }] : q.sort === 'rated' ? [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }] : [{ createdAt: 'desc' }];
  const [items, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        subjectName: true,
        topic: true,
        status: true,
        viewCount: true,
        ratingAvg: true,
        ratingCount: true,
        commentCount: true,
        createdAt: true,
        fileId: true,
        noteId: true,
        externalUrl: true,
        author: AUTHOR,
        file: { select: { originalName: true, extension: true } },
      },
    }),
    prisma.post.count({ where }),
  ]);
  const favs = await library.favoriteIds(user.id, 'POST', items.map((i) => i.id));
  return {
    items: items.map((p) => ({ ...p, excerpt: p.content.replace(/[#*_`>\[\]()!-]/g, '').replace(/\s+/g, ' ').slice(0, 220), content: undefined, bookmarked: favs.has(p.id) })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

async function visiblePost(user, id) {
  const p = await prisma.post.findFirst({ where: { id, ...visibleWhere(user) } });
  if (!p) throw notFound('Không tìm thấy bài viết');
  return p;
}

async function get(user, id) {
  await visiblePost(user, id);
  await prisma.post.update({ where: { id }, data: { viewCount: { increment: 1 } } });
  const p = await prisma.post.findUnique({
    where: { id },
    include: {
      author: AUTHOR,
      file: { select: { id: true, originalName: true, extension: true, size: true, deletedAt: true } },
      note: { select: { id: true, title: true, icon: true, deletedAt: true } },
    },
  });
  const [myRating, favs, myReport] = await Promise.all([
    prisma.postRating.findUnique({ where: { postId_userId: { postId: id, userId: user.id } } }),
    library.favoriteIds(user.id, 'POST', [id]),
    prisma.report.findUnique({ where: { reporterId_targetType_targetId: { reporterId: user.id, targetType: 'POST', targetId: id } } }),
  ]);
  await library.touchRecent(user.id, 'POST', id);
  return {
    ...p,
    file: p.file && !p.file.deletedAt ? { ...p.file, size: Number(p.file.size) } : null,
    note: p.note && !p.note.deletedAt ? p.note : null,
    myRating: myRating?.value ?? null,
    bookmarked: favs.has(id),
    reported: Boolean(myReport),
    canEdit: p.authorId === user.id,
    canModerate: isMod(user),
  };
}

async function checkAttachments(userId, { fileId, noteId }) {
  if (fileId) {
    const f = await prisma.driveFile.findFirst({ where: { id: fileId, userId, deletedAt: null } });
    if (!f) throw badRequest('Chỉ đính kèm được file của chính bạn');
  }
  if (noteId) {
    const n = await prisma.note.findFirst({ where: { id: noteId, userId, deletedAt: null } });
    if (!n) throw badRequest('Chỉ đính kèm được ghi chú của chính bạn');
  }
}

async function create(user, data) {
  await checkAttachments(user.id, data);
  if ((data.fileId || data.type === 'DOCUMENT' || data.type === 'OUTLINE') && !data.copyrightConfirmed) {
    throw badRequest('Bạn cần xác nhận có quyền chia sẻ tài liệu này (tôn trọng bản quyền)');
  }
  const p = await prisma.post.create({ data: { ...data, authorId: user.id } });
  await activity.log(user.id, 'share.post', `Đăng bài "${p.title}"`, { entityType: 'POST', entityId: p.id });
  return get(user, p.id);
}

async function update(user, id, data) {
  const p = await visiblePost(user, id);
  if (p.authorId !== user.id) throw forbidden('Bạn chỉ sửa được bài viết của mình');
  if (p.status === 'REMOVED') throw forbidden('Bài viết đã bị gỡ bởi kiểm duyệt viên');
  await checkAttachments(user.id, data);
  const fileAfter = data.fileId !== undefined ? data.fileId : p.fileId;
  const confirmed = data.copyrightConfirmed !== undefined ? data.copyrightConfirmed : p.copyrightConfirmed;
  if (fileAfter && !confirmed) throw badRequest('Bạn cần xác nhận có quyền chia sẻ tài liệu này');
  await prisma.post.update({ where: { id }, data });
  return get(user, id);
}

async function remove(user, id) {
  const p = await visiblePost(user, id);
  if (p.authorId !== user.id && !isMod(user)) throw forbidden('Bạn không có quyền xóa bài viết này');
  await prisma.post.update({ where: { id }, data: { deletedAt: new Date() } });
  if (p.authorId !== user.id) {
    await activity.log(user.id, 'moderation.delete_post', `Xóa bài "${p.title}"`, { entityType: 'POST', entityId: id });
    await notify(p.authorId, { type: 'share.moderation', title: `Bài viết "${p.title}" đã bị xóa bởi kiểm duyệt viên`, link: '/share?mine=1' });
  }
}

async function rate(user, id, value) {
  const p = await visiblePost(user, id);
  if (p.status !== 'PUBLISHED') throw badRequest('Không thể đánh giá bài viết này');
  if (p.authorId === user.id) throw badRequest('Bạn không thể tự đánh giá bài của mình');
  await prisma.$transaction(async (tx) => {
    await tx.postRating.upsert({ where: { postId_userId: { postId: id, userId: user.id } }, create: { postId: id, userId: user.id, value }, update: { value } });
    const agg = await tx.postRating.aggregate({ where: { postId: id }, _avg: { value: true }, _count: true });
    await tx.post.update({ where: { id }, data: { ratingAvg: Math.round((agg._avg.value || 0) * 10) / 10, ratingCount: agg._count } });
  });
  const post = await prisma.post.findUnique({ where: { id }, select: { ratingAvg: true, ratingCount: true } });
  return { ...post, myRating: value };
}

// ------------------------------------------------------------------ Bình luận
async function listComments(user, postId) {
  await visiblePost(user, postId);
  return prisma.comment.findMany({
    where: { targetType: 'POST', targetId: postId, deletedAt: null, ...(isMod(user) ? {} : { OR: [{ hidden: false }, { userId: user.id }] }) },
    include: { user: { select: { id: true, fullName: true, avatarPath: true, role: true } } },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
}

async function addComment(user, postId, content) {
  const p = await visiblePost(user, postId);
  if (p.status !== 'PUBLISHED') throw badRequest('Bài viết không nhận bình luận');
  const c = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({ data: { userId: user.id, targetType: 'POST', targetId: postId, content }, include: { user: { select: { id: true, fullName: true, avatarPath: true, role: true } } } });
    await tx.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
    return created;
  });
  if (p.authorId !== user.id) {
    await notify(p.authorId, { type: 'share.comment', title: `${user.fullName} đã bình luận bài "${p.title}"`, body: content.slice(0, 120), link: `/share/${postId}` });
  }
  return c;
}

async function deleteComment(user, commentId) {
  const c = await prisma.comment.findFirst({ where: { id: commentId, targetType: 'POST', deletedAt: null } });
  if (!c) throw notFound('Không tìm thấy bình luận');
  if (c.userId !== user.id && !isMod(user)) throw forbidden('Bạn chỉ xóa được bình luận của mình');
  await prisma.$transaction([
    prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } }),
    prisma.post.update({ where: { id: c.targetId }, data: { commentCount: { decrement: 1 } } }),
  ]);
}

// ------------------------------------------------------------------ Báo cáo & kiểm duyệt
async function report(user, { targetType, targetId, reason, details }) {
  if (targetType === 'POST') {
    const p = await visiblePost(user, targetId);
    if (p.authorId === user.id) throw badRequest('Không thể báo cáo bài của chính bạn');
  } else {
    const c = await prisma.comment.findFirst({ where: { id: targetId, targetType: 'POST', deletedAt: null } });
    if (!c) throw notFound('Không tìm thấy bình luận');
    await visiblePost(user, c.targetId);
  }
  try {
    const r = await prisma.report.create({ data: { reporterId: user.id, targetType, targetId, reason, details } });
    const mods = await prisma.user.findMany({ where: { role: { in: ['MODERATOR', 'ADMIN'] }, isActive: true }, select: { id: true } });
    await notify(mods.map((m) => m.id), { type: 'share.moderation', title: `Báo cáo mới: ${REPORT_REASONS[reason]}`, link: '/share/moderation' });
    return r;
  } catch (e) {
    if (e.code === 'P2002') throw conflict('Bạn đã báo cáo nội dung này');
    throw e;
  }
}

async function listReports({ status }) {
  const reports = await prisma.report.findMany({
    where: status ? { status } : {},
    include: { reporter: { select: { id: true, fullName: true } }, handledBy: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const postIds = reports.filter((r) => r.targetType === 'POST').map((r) => r.targetId);
  const commentIds = reports.filter((r) => r.targetType === 'COMMENT').map((r) => r.targetId);
  const [posts, comments] = await Promise.all([
    prisma.post.findMany({ where: { id: { in: postIds } }, select: { id: true, title: true, status: true, deletedAt: true, author: { select: { id: true, fullName: true } } } }),
    prisma.comment.findMany({ where: { id: { in: commentIds } }, select: { id: true, content: true, hidden: true, deletedAt: true, targetId: true, user: { select: { id: true, fullName: true } } } }),
  ]);
  const pm = new Map(posts.map((p) => [p.id, p]));
  const cm = new Map(comments.map((c) => [c.id, c]));
  return reports.map((r) => ({ ...r, reasonLabel: REPORT_REASONS[r.reason] || r.reason, target: r.targetType === 'POST' ? pm.get(r.targetId) || null : cm.get(r.targetId) || null }));
}

/**
 * Xử lý báo cáo: action = "reject" (giữ nguyên), "hide" (ẩn tạm), "remove" (gỡ bài / xóa bình luận), "restore" (khôi phục).
 */
async function resolveReport(moderator, reportId, { action, note }) {
  const r = await prisma.report.findUnique({ where: { id: reportId } });
  if (!r) throw notFound('Không tìm thấy báo cáo');
  let authorId = null;
  let title = '';
  if (r.targetType === 'POST') {
    const p = await prisma.post.findUnique({ where: { id: r.targetId } });
    if (p) {
      authorId = p.authorId;
      title = p.title;
      const status = action === 'hide' ? 'HIDDEN' : action === 'remove' ? 'REMOVED' : action === 'restore' ? 'PUBLISHED' : null;
      if (status) await prisma.post.update({ where: { id: p.id }, data: { status, moderationNote: note ?? null } });
    }
  } else {
    const c = await prisma.comment.findUnique({ where: { id: r.targetId } });
    if (c) {
      authorId = c.userId;
      title = 'bình luận của bạn';
      if (action === 'hide' || action === 'remove') await prisma.comment.update({ where: { id: c.id }, data: { hidden: true } });
      if (action === 'restore') await prisma.comment.update({ where: { id: c.id }, data: { hidden: false } });
    }
  }
  const status = action === 'reject' || action === 'restore' ? 'REJECTED' : 'RESOLVED';
  // Giải quyết mọi báo cáo khác cho cùng đối tượng
  await prisma.report.updateMany({
    where: { targetType: r.targetType, targetId: r.targetId, status: 'OPEN' },
    data: { status, handledById: moderator.id, handledAt: new Date(), resolution: note ?? action },
  });
  await prisma.report.update({ where: { id: reportId }, data: { status, handledById: moderator.id, handledAt: new Date(), resolution: note ?? action } });
  await activity.log(moderator.id, 'moderation.resolve', `Xử lý báo cáo #${reportId}: ${action}`, { entityType: r.targetType, entityId: r.targetId });
  if (authorId && ['hide', 'remove'].includes(action)) {
    await notify(authorId, {
      type: 'share.moderation',
      title: `Nội dung "${title}" đã bị ${action === 'hide' ? 'ẩn' : 'gỡ'} do vi phạm`,
      body: note || REPORT_REASONS[r.reason],
      link: r.targetType === 'POST' ? `/share/${r.targetId}` : '/share',
    });
  }
  return { status };
}

async function moderatePost(moderator, id, { status, note }) {
  const p = await prisma.post.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw notFound('Không tìm thấy bài viết');
  await prisma.post.update({ where: { id }, data: { status, moderationNote: note ?? null } });
  await activity.log(moderator.id, 'moderation.post_status', `Đổi trạng thái bài "${p.title}" thành ${status}`, { entityType: 'POST', entityId: id });
  if (status !== 'PUBLISHED') await notify(p.authorId, { type: 'share.moderation', title: `Bài viết "${p.title}" đã bị ${status === 'HIDDEN' ? 'ẩn' : 'gỡ'}`, body: note, link: `/share/${id}` });
  return { status };
}

async function facets() {
  const [subjects, topics] = await Promise.all([
    prisma.post.groupBy({ by: ['subjectName'], where: { status: 'PUBLISHED', deletedAt: null, subjectName: { not: null } }, _count: true, orderBy: { _count: { subjectName: 'desc' } }, take: 30 }),
    prisma.post.groupBy({ by: ['topic'], where: { status: 'PUBLISHED', deletedAt: null, topic: { not: null } }, _count: true, orderBy: { _count: { topic: 'desc' } }, take: 30 }),
  ]);
  return { subjects: subjects.map((s) => ({ name: s.subjectName, count: s._count })), topics: topics.map((t) => ({ name: t.topic, count: t._count })), reasons: REPORT_REASONS };
}

module.exports = { list, get, create, update, remove, rate, listComments, addComment, deleteComment, report, listReports, resolveReport, moderatePost, facets, REPORT_REASONS, isMod };
