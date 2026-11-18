'use strict';
const crypto = require('node:crypto');
const prisma = require('../../database/prisma');
const activity = require('../../services/activity.service');
const { notify } = require('../../services/notification.service');
const library = require('../library/library.service');
const ai = require('../../services/ai/ai.service');
const prompts = require('../../services/ai/prompts');
const { notFound, forbidden, badRequest, conflict } = require('../../utils/errors');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');

const MEMBER_SELECT = { id: true, role: true, joinedAt: true, user: { select: { id: true, fullName: true, email: true, avatarPath: true } } };

// ------------------------------------------------------------------ Phân quyền
/** Trả về { group, member } nếu người dùng là thành viên, ngược lại 404 (không tiết lộ nhóm tồn tại). */
async function membership(userId, groupId) {
  const member = await prisma.groupMember.findFirst({ where: { groupId, userId, group: { deletedAt: null } }, include: { group: true } });
  if (!member) throw notFound('Không tìm thấy nhóm hoặc bạn không phải thành viên');
  return { group: member.group, member, isLeader: member.role === 'LEADER', isOwner: member.group.ownerId === userId };
}

async function requireLeader(userId, groupId) {
  const m = await membership(userId, groupId);
  if (!m.isLeader) throw forbidden('Chỉ trưởng nhóm mới được thực hiện thao tác này');
  return m;
}

async function groupLog(userId, groupId, action, summary, opts = {}) {
  await activity.log(userId, action, summary, { ...opts, groupId });
}

async function memberIds(groupId, exceptUserId) {
  const rows = await prisma.groupMember.findMany({ where: { groupId, ...(exceptUserId ? { NOT: { userId: exceptUserId } } : {}) }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

// ------------------------------------------------------------------ Nhóm
async function list(userId) {
  const rows = await prisma.group.findMany({
    where: { deletedAt: null, members: { some: { userId } } },
    include: {
      _count: { select: { members: true, resources: true, tasks: { where: { deletedAt: null } } } },
      members: { where: { userId }, select: { role: true } },
      owner: { select: { id: true, fullName: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  const invites = await prisma.groupInvite.findMany({
    where: { inviteeId: userId, status: 'PENDING', group: { deletedAt: null } },
    include: { group: { select: { id: true, name: true, color: true } }, inviter: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { groups: rows.map(({ members, ...g }) => ({ ...g, myRole: members[0]?.role })), invites };
}

async function create(userId, { name, description, color }) {
  let joinCode = newCode();
  for (let i = 0; i < 5 && (await prisma.group.findUnique({ where: { joinCode } })); i++) joinCode = newCode();
  const g = await prisma.group.create({
    data: { name, description, color, ownerId: userId, joinCode, members: { create: { userId, role: 'LEADER' } } },
  });
  await groupLog(userId, g.id, 'group.create', `Tạo nhóm "${name}"`, { entityType: 'GROUP', entityId: g.id });
  return get(userId, g.id);
}

async function get(userId, groupId) {
  const { isLeader, isOwner } = await membership(userId, groupId);
  const g = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: { select: MEMBER_SELECT, orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }] },
      owner: { select: { id: true, fullName: true } },
      _count: { select: { resources: true, tasks: { where: { deletedAt: null } } } },
    },
  });
  const [taskCounts, pendingInvites] = await Promise.all([
    prisma.task.groupBy({ by: ['status'], where: { groupId, deletedAt: null, parentId: null }, _count: true }),
    isLeader
      ? prisma.groupInvite.findMany({ where: { groupId, status: 'PENDING' }, include: { invitee: { select: { id: true, fullName: true, email: true } } } })
      : [],
  ]);
  const progress = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
  for (const t of taskCounts) progress[t.status] = t._count;
  const total = progress.TODO + progress.IN_PROGRESS + progress.DONE;
  await library.touchRecent(userId, 'GROUP', groupId);
  return {
    ...g,
    joinCode: isLeader ? g.joinCode : undefined, // chỉ trưởng nhóm thấy mã mời
    myRole: isLeader ? 'LEADER' : 'MEMBER',
    isOwner,
    progress: { ...progress, total, percent: total ? Math.round((progress.DONE / total) * 100) : 0 },
    pendingInvites,
  };
}

async function update(userId, groupId, data) {
  await requireLeader(userId, groupId);
  await prisma.group.update({ where: { id: groupId }, data });
  await groupLog(userId, groupId, 'group.update', 'Cập nhật thông tin nhóm', { entityType: 'GROUP', entityId: groupId });
  return get(userId, groupId);
}

async function remove(userId, groupId) {
  const { isOwner, group } = await membership(userId, groupId);
  if (!isOwner) throw forbidden('Chỉ người tạo nhóm mới được xóa nhóm');
  await prisma.group.update({ where: { id: groupId }, data: { deletedAt: new Date() } });
  await notify(await memberIds(groupId, userId), { type: 'group.activity', title: `Nhóm "${group.name}" đã bị giải tán`, link: '/groups' });
}

async function regenerateCode(userId, groupId) {
  await requireLeader(userId, groupId);
  const g = await prisma.group.update({ where: { id: groupId }, data: { joinCode: newCode() } });
  return { joinCode: g.joinCode };
}

async function joinByCode(userId, code) {
  const g = await prisma.group.findFirst({ where: { joinCode: code.toUpperCase(), deletedAt: null } });
  if (!g) throw notFound('Mã tham gia không đúng');
  const exists = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId } } });
  if (exists) throw conflict('Bạn đã là thành viên của nhóm này');
  await addMember(userId, g);
  return get(userId, g.id);
}

async function addMember(userId, group) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  await prisma.$transaction([
    prisma.groupMember.create({ data: { groupId: group.id, userId, role: 'MEMBER' } }),
    prisma.groupInvite.updateMany({ where: { groupId: group.id, inviteeId: userId, status: 'PENDING' }, data: { status: 'ACCEPTED' } }),
  ]);
  await groupLog(userId, group.id, 'group.join', `${user.fullName} đã tham gia nhóm`, { entityType: 'GROUP', entityId: group.id });
  await notify(await memberIds(group.id, userId), { type: 'group.activity', title: `${user.fullName} đã tham gia "${group.name}"`, link: `/groups/${group.id}` });
}

async function invite(userId, groupId, email) {
  const { group } = await requireLeader(userId, groupId);
  const invitee = await prisma.user.findFirst({ where: { email, isActive: true }, select: { id: true, fullName: true } });
  if (!invitee) throw notFound('Không tìm thấy người dùng với email này');
  const isMember = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: invitee.id } } });
  if (isMember) throw conflict('Người này đã là thành viên');
  const pending = await prisma.groupInvite.findFirst({ where: { groupId, inviteeId: invitee.id, status: 'PENDING' } });
  if (pending) throw conflict('Đã gửi lời mời cho người này');
  const inv = await prisma.groupInvite.create({ data: { groupId, inviterId: userId, inviteeId: invitee.id } });
  const inviter = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  await notify(invitee.id, { type: 'group.invite', title: `${inviter.fullName} mời bạn vào nhóm "${group.name}"`, body: 'Mở UniGroup để chấp nhận hoặc từ chối.', link: '/groups?tab=invites' });
  await groupLog(userId, groupId, 'group.invite', `Mời ${invitee.fullName} vào nhóm`);
  return inv;
}

async function respondInvite(userId, inviteId, accept) {
  const inv = await prisma.groupInvite.findFirst({ where: { id: inviteId, inviteeId: userId, status: 'PENDING' }, include: { group: true } });
  if (!inv || inv.group.deletedAt) throw notFound('Lời mời không còn hiệu lực');
  if (accept) {
    const exists = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: inv.groupId, userId } } });
    if (!exists) await addMember(userId, inv.group);
    else await prisma.groupInvite.update({ where: { id: inviteId }, data: { status: 'ACCEPTED' } });
    return { groupId: inv.groupId, status: 'ACCEPTED' };
  }
  await prisma.groupInvite.update({ where: { id: inviteId }, data: { status: 'DECLINED' } });
  return { groupId: inv.groupId, status: 'DECLINED' };
}

async function cancelInvite(userId, groupId, inviteId) {
  await requireLeader(userId, groupId);
  const r = await prisma.groupInvite.updateMany({ where: { id: inviteId, groupId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  if (!r.count) throw notFound('Không tìm thấy lời mời');
}

async function leave(userId, groupId) {
  const { isOwner, group } = await membership(userId, groupId);
  if (isOwner) throw badRequest('Người tạo nhóm không thể rời nhóm. Hãy chuyển quyền sở hữu hoặc giải tán nhóm.');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  await prisma.$transaction([
    prisma.groupMember.delete({ where: { groupId_userId: { groupId, userId } } }),
    prisma.task.updateMany({ where: { groupId, assigneeId: userId, status: { not: 'DONE' } }, data: { assigneeId: null } }),
  ]);
  await groupLog(userId, groupId, 'group.leave', `${user.fullName} đã rời nhóm`);
  await notify(await memberIds(groupId), { type: 'group.activity', title: `${user.fullName} đã rời "${group.name}"`, link: `/groups/${groupId}` });
}

async function updateMember(userId, groupId, memberUserId, { role }) {
  const { group } = await requireLeader(userId, groupId);
  if (memberUserId === group.ownerId) throw badRequest('Không thể thay đổi vai trò của người tạo nhóm');
  const m = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: memberUserId } }, include: { user: { select: { fullName: true } } } });
  if (!m) throw notFound('Không tìm thấy thành viên');
  await prisma.groupMember.update({ where: { id: m.id }, data: { role } });
  await groupLog(userId, groupId, 'group.role', `Đặt ${m.user.fullName} làm ${role === 'LEADER' ? 'trưởng nhóm' : 'thành viên'}`);
  return get(userId, groupId);
}

async function removeMember(userId, groupId, memberUserId) {
  const { group } = await requireLeader(userId, groupId);
  if (memberUserId === group.ownerId) throw badRequest('Không thể xóa người tạo nhóm');
  if (memberUserId === userId) throw badRequest('Hãy dùng chức năng Rời nhóm');
  const m = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: memberUserId } }, include: { user: { select: { fullName: true } } } });
  if (!m) throw notFound('Không tìm thấy thành viên');
  await prisma.$transaction([
    prisma.groupMember.delete({ where: { id: m.id } }),
    prisma.task.updateMany({ where: { groupId, assigneeId: memberUserId, status: { not: 'DONE' } }, data: { assigneeId: null } }),
  ]);
  await groupLog(userId, groupId, 'group.remove_member', `Xóa ${m.user.fullName} khỏi nhóm`);
  await notify(memberUserId, { type: 'group.activity', title: `Bạn đã bị xóa khỏi nhóm "${group.name}"`, link: '/groups' });
}

async function transferOwnership(userId, groupId, newOwnerId) {
  const { isOwner } = await membership(userId, groupId);
  if (!isOwner) throw forbidden('Chỉ người tạo nhóm mới chuyển được quyền sở hữu');
  const target = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: newOwnerId } } });
  if (!target) throw notFound('Người nhận không phải thành viên nhóm');
  await prisma.$transaction([
    prisma.group.update({ where: { id: groupId }, data: { ownerId: newOwnerId } }),
    prisma.groupMember.update({ where: { id: target.id }, data: { role: 'LEADER' } }),
  ]);
  await groupLog(userId, groupId, 'group.transfer', 'Chuyển quyền sở hữu nhóm');
  return get(userId, groupId);
}

// ------------------------------------------------------------------ Nhiệm vụ nhóm
const TASK_INCLUDE = {
  assignee: { select: { id: true, fullName: true } },
  user: { select: { id: true, fullName: true } },
  _count: { select: { subtasks: { where: { deletedAt: null } } } },
};

async function listTasks(userId, groupId, { status, assigneeId }) {
  await membership(userId, groupId);
  const rows = await prisma.task.findMany({
    where: { groupId, deletedAt: null, parentId: null, ...(status ? { status } : {}), ...(assigneeId ? { assigneeId } : {}) },
    include: TASK_INCLUDE,
    orderBy: [{ status: 'asc' }, { dueAt: { sort: 'asc', nulls: 'last' } }],
  });
  const commentCounts = await prisma.comment.groupBy({ by: ['targetId'], where: { targetType: 'TASK', targetId: { in: rows.map((r) => r.id) }, deletedAt: null }, _count: true });
  const cc = new Map(commentCounts.map((c) => [c.targetId, c._count]));
  return rows.map((t) => ({ ...t, commentCount: cc.get(t.id) || 0 }));
}

async function checkAssignee(groupId, assigneeId) {
  if (!assigneeId) return;
  const m = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: assigneeId } } });
  if (!m) throw badRequest('Người được giao không phải thành viên nhóm');
}

async function createTask(userId, groupId, data) {
  const { isLeader, group } = await membership(userId, groupId);
  if (data.assigneeId && data.assigneeId !== userId && !isLeader) throw forbidden('Chỉ trưởng nhóm mới giao việc cho người khác');
  await checkAssignee(groupId, data.assigneeId);
  const t = await prisma.task.create({ data: { ...data, groupId, userId }, include: TASK_INCLUDE });
  await groupLog(userId, groupId, 'group.task_create', `Tạo nhiệm vụ "${t.title}"${t.assignee ? ` – giao cho ${t.assignee.fullName}` : ''}`, { entityType: 'TASK', entityId: t.id });
  if (t.assigneeId && t.assigneeId !== userId) {
    await notify(t.assigneeId, { type: 'task.assigned', title: `Bạn được giao "${t.title}"`, body: `Nhóm ${group.name}`, link: `/groups/${groupId}?tab=tasks` });
  }
  return t;
}

async function groupTask(groupId, taskId) {
  const t = await prisma.task.findFirst({ where: { id: taskId, groupId, deletedAt: null } });
  if (!t) throw notFound('Không tìm thấy nhiệm vụ');
  return t;
}

/** Trưởng nhóm: sửa toàn bộ. Người tạo: sửa nội dung. Người được giao: chỉ đổi trạng thái. */
async function updateTask(userId, groupId, taskId, data) {
  const { isLeader, group } = await membership(userId, groupId);
  const t = await groupTask(groupId, taskId);
  const isCreator = t.userId === userId;
  const isAssignee = t.assigneeId === userId;
  const keys = Object.keys(data);
  if (!isLeader) {
    if (isAssignee && !isCreator && keys.some((k) => k !== 'status')) throw forbidden('Bạn chỉ được cập nhật trạng thái nhiệm vụ được giao');
    if (!isAssignee && !isCreator) throw forbidden('Bạn không có quyền sửa nhiệm vụ này');
    if ('assigneeId' in data && data.assigneeId && data.assigneeId !== userId) throw forbidden('Chỉ trưởng nhóm mới giao việc cho người khác');
  }
  await checkAssignee(groupId, data.assigneeId);
  const extra = {};
  if (data.status && data.status !== t.status) extra.completedAt = data.status === 'DONE' ? new Date() : null;
  if ('remindAt' in data) extra.reminderSentAt = null;
  const updated = await prisma.task.update({ where: { id: taskId }, data: { ...data, ...extra }, include: TASK_INCLUDE });
  if (data.status && data.status !== t.status) {
    const label = { TODO: 'Cần làm', IN_PROGRESS: 'Đang làm', DONE: 'Hoàn thành' }[data.status];
    await groupLog(userId, groupId, 'group.task_status', `Chuyển "${t.title}" sang ${label}`, { entityType: 'TASK', entityId: taskId });
  }
  if (data.assigneeId && data.assigneeId !== t.assigneeId && data.assigneeId !== userId) {
    await notify(data.assigneeId, { type: 'task.assigned', title: `Bạn được giao "${updated.title}"`, body: `Nhóm ${group.name}`, link: `/groups/${groupId}?tab=tasks` });
  }
  return updated;
}

async function deleteTask(userId, groupId, taskId) {
  const { isLeader } = await membership(userId, groupId);
  const t = await groupTask(groupId, taskId);
  if (!isLeader && t.userId !== userId) throw forbidden('Chỉ trưởng nhóm hoặc người tạo mới xóa được nhiệm vụ');
  await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
  await groupLog(userId, groupId, 'group.task_delete', `Xóa nhiệm vụ "${t.title}"`);
}

// ------------------------------------------------------------------ Tài liệu & ghi chú chia sẻ
async function listResources(userId, groupId) {
  await membership(userId, groupId);
  return prisma.groupResource.findMany({
    where: { groupId, OR: [{ file: { deletedAt: null } }, { note: { deletedAt: null } }] },
    include: {
      sharedBy: { select: { id: true, fullName: true } },
      file: { select: { id: true, originalName: true, extension: true, size: true, updatedAt: true } },
      note: { select: { id: true, title: true, icon: true, updatedAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function shareResource(userId, groupId, { type, fileId, noteId }) {
  const { group } = await membership(userId, groupId);
  let title;
  if (type === 'FILE') {
    const f = await prisma.driveFile.findFirst({ where: { id: fileId, userId, deletedAt: null } });
    if (!f) throw notFound('Chỉ chia sẻ được file của chính bạn');
    title = f.originalName;
  } else {
    const n = await prisma.note.findFirst({ where: { id: noteId, userId, deletedAt: null } });
    if (!n) throw notFound('Chỉ chia sẻ được ghi chú của chính bạn');
    title = n.title || 'Ghi chú';
  }
  try {
    const r = await prisma.groupResource.create({ data: { groupId, type, fileId: type === 'FILE' ? fileId : null, noteId: type === 'NOTE' ? noteId : null, sharedById: userId } });
    await groupLog(userId, groupId, 'group.share', `Chia sẻ ${type === 'FILE' ? 'tài liệu' : 'ghi chú'} "${title}"`, { entityType: type, entityId: fileId || noteId });
    await notify(await memberIds(groupId, userId), { type: 'group.activity', title: `Tài liệu mới trong "${group.name}"`, body: title, link: `/groups/${groupId}?tab=resources` });
    return r;
  } catch (e) {
    if (e.code === 'P2002') throw conflict('Đã chia sẻ mục này trong nhóm');
    throw e;
  }
}

async function unshareResource(userId, groupId, resourceId) {
  const { isLeader } = await membership(userId, groupId);
  const r = await prisma.groupResource.findFirst({ where: { id: resourceId, groupId } });
  if (!r) throw notFound('Không tìm thấy mục chia sẻ');
  if (!isLeader && r.sharedById !== userId) throw forbidden('Chỉ người chia sẻ hoặc trưởng nhóm mới gỡ được');
  await prisma.groupResource.delete({ where: { id: resourceId } });
  await groupLog(userId, groupId, 'group.unshare', 'Gỡ một mục chia sẻ');
}

// ------------------------------------------------------------------ Bình luận
async function assertCommentTarget(userId, groupId, targetType, targetId) {
  await membership(userId, groupId);
  if (targetType === 'GROUP' && targetId !== groupId) throw badRequest('Đối tượng bình luận không hợp lệ');
  if (targetType === 'TASK') await groupTask(groupId, targetId);
}

async function listComments(userId, groupId, { targetType, targetId }) {
  await assertCommentTarget(userId, groupId, targetType, targetId);
  return prisma.comment.findMany({
    where: { targetType, targetId, deletedAt: null },
    include: { user: { select: { id: true, fullName: true, avatarPath: true } } },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
}

async function addComment(userId, groupId, { targetType, targetId, content }) {
  await assertCommentTarget(userId, groupId, targetType, targetId);
  const c = await prisma.comment.create({ data: { userId, targetType, targetId, content }, include: { user: { select: { id: true, fullName: true, avatarPath: true } } } });
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true } });
  let recipients = await memberIds(groupId, userId);
  if (targetType === 'TASK') {
    const t = await groupTask(groupId, targetId);
    recipients = [t.userId, t.assigneeId].filter((id) => id && id !== userId);
  }
  await notify(recipients, { type: 'group.comment', title: `${c.user.fullName} bình luận trong "${group.name}"`, body: content.slice(0, 120), link: `/groups/${groupId}?tab=${targetType === 'TASK' ? 'tasks' : 'discussion'}` });
  await groupLog(userId, groupId, 'group.comment', `${c.user.fullName} đã bình luận`);
  return c;
}

async function deleteComment(userId, groupId, commentId) {
  const { isLeader } = await membership(userId, groupId);
  const c = await prisma.comment.findFirst({ where: { id: commentId, deletedAt: null, targetType: { in: ['GROUP', 'TASK'] } } });
  if (!c) throw notFound('Không tìm thấy bình luận');
  // Bình luận phải thuộc nhóm này
  if (c.targetType === 'GROUP' && c.targetId !== groupId) throw notFound('Không tìm thấy bình luận');
  if (c.targetType === 'TASK') await groupTask(groupId, c.targetId);
  if (!isLeader && c.userId !== userId) throw forbidden('Bạn chỉ xóa được bình luận của mình');
  await prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
}

async function activityLog(userId, groupId, { page, pageSize }) {
  await membership(userId, groupId);
  const where = { groupId };
  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({ where, include: { user: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.activityLog.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

// ------------------------------------------------------------------ AI (đề xuất)
async function aiPlan(userId, groupId, { goal }) {
  const { group } = await membership(userId, groupId);
  const [members, tasks] = await Promise.all([
    prisma.groupMember.findMany({ where: { groupId }, select: { user: { select: { id: true, fullName: true } }, role: true } }),
    prisma.task.findMany({ where: { groupId, deletedAt: null, parentId: null }, select: { id: true, title: true, status: true, dueAt: true, assigneeId: true }, take: 60 }),
  ]);
  const { data } = await ai.completeJson(userId, 'group.plan', {
    system: prompts.GROUP_PLAN,
    messages: [
      {
        role: 'user',
        content: `Nhóm: ${group.name}\nMô tả: ${group.description || '(không có)'}\nMục tiêu/yêu cầu: ${goal}\nThành viên: ${members.map((m) => `#${m.user.id} ${m.user.fullName} (${m.role})`).join(', ')}\nNhiệm vụ hiện có:\n${tasks.map((t) => `- ${t.title} [${t.status}]${t.assigneeId ? ` giao #${t.assigneeId}` : ''}`).join('\n') || '(chưa có)'}`,
      },
    ],
  });
  const valid = new Set(members.map((m) => m.user.id));
  const suggested = (Array.isArray(data?.tasks) ? data.tasks : [])
    .filter((t) => t?.title)
    .slice(0, 15)
    .map((t) => ({
      title: String(t.title).slice(0, 255),
      description: t.description ? String(t.description).slice(0, 3000) : null,
      assigneeId: valid.has(Number(t.assigneeId)) ? Number(t.assigneeId) : null,
      dueInDays: Number.isFinite(Number(t.dueInDays)) ? Math.max(0, Math.min(365, Number(t.dueInDays))) : null,
    }));
  return { plan: data?.plan ? String(data.plan) : '', tasks: suggested, note: 'Đây là đề xuất – trưởng nhóm chọn nhiệm vụ muốn tạo rồi xác nhận.' };
}

async function aiProgress(userId, groupId) {
  const { group } = await membership(userId, groupId);
  const tasks = await prisma.task.findMany({
    where: { groupId, deletedAt: null, parentId: null },
    include: { assignee: { select: { fullName: true } } },
    take: 80,
  });
  const r = await ai.complete(userId, 'group.progress', {
    system: prompts.PROGRESS,
    messages: [
      {
        role: 'user',
        content: `Nhóm "${group.name}". Hôm nay: ${new Date().toISOString().slice(0, 10)}\n${tasks
          .map((t) => `- ${t.title} [${t.status}] ${t.assignee ? `– ${t.assignee.fullName}` : '– chưa giao'}${t.dueAt ? ` – hạn ${t.dueAt.toISOString().slice(0, 10)}` : ''}`)
          .join('\n') || '(chưa có nhiệm vụ)'}`,
      },
    ],
  });
  return { content: r.text };
}

async function createTasksBulk(userId, groupId, items) {
  await requireLeader(userId, groupId);
  const created = [];
  for (const it of items) created.push(await createTask(userId, groupId, it));
  return created;
}

module.exports = {
  membership,
  list,
  create,
  get,
  update,
  remove,
  regenerateCode,
  joinByCode,
  invite,
  respondInvite,
  cancelInvite,
  leave,
  updateMember,
  removeMember,
  transferOwnership,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  listResources,
  shareResource,
  unshareResource,
  listComments,
  addComment,
  deleteComment,
  activityLog,
  aiPlan,
  aiProgress,
  createTasksBulk,
};
