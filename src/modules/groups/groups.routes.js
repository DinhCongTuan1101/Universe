'use strict';
const { Router } = require('express');
const s = require('./groups.service');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { aiLimiter, sensitiveLimiter } = require('../../middlewares/rateLimiters');
const { ok, created } = require('../../utils/response');
const { z, id, idParams, optionalId, optionalText, optionalDateTime, color, pagination } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

const gid = (req) => req.valid.params.id;
const groupBody = z.object({ name: z.string().trim().min(2).max(120), description: optionalText(5000), color: color.optional() });
const taskBody = z.object({
  title: z.string().trim().min(1).max(255),
  description: optionalText(10000),
  assigneeId: optionalId.optional(),
  dueAt: optionalDateTime.optional(),
  remindAt: optionalDateTime.optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
});
const sub = (extra) => z.object({ id, ...extra });

r.get('/', async (req, res) => ok(res, await s.list(req.user.id)));
r.post('/', validate({ body: groupBody }), async (req, res) => created(res, await s.create(req.user.id, req.valid.body), 'Đã tạo nhóm'));
r.post('/join', sensitiveLimiter, validate({ body: z.object({ code: z.string().trim().min(6).max(12) }) }), async (req, res) =>
  ok(res, await s.joinByCode(req.user.id, req.valid.body.code), 'Đã tham gia nhóm')
);
r.post('/invites/:id/respond', validate({ params: idParams, body: z.object({ accept: z.boolean() }) }), async (req, res) =>
  ok(res, await s.respondInvite(req.user.id, req.valid.params.id, req.valid.body.accept), req.valid.body.accept ? 'Đã tham gia nhóm' : 'Đã từ chối lời mời')
);

r.get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await s.get(req.user.id, gid(req))));
r.patch('/:id', validate({ params: idParams, body: groupBody.partial() }), async (req, res) => ok(res, await s.update(req.user.id, gid(req), req.valid.body), 'Đã cập nhật nhóm'));
r.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await s.remove(req.user.id, gid(req));
  ok(res, null, 'Đã giải tán nhóm');
});
r.post('/:id/join-code', validate({ params: idParams }), async (req, res) => ok(res, await s.regenerateCode(req.user.id, gid(req)), 'Đã tạo mã mới'));
r.post('/:id/leave', validate({ params: idParams }), async (req, res) => {
  await s.leave(req.user.id, gid(req));
  ok(res, null, 'Đã rời nhóm');
});
r.post('/:id/transfer', validate({ params: idParams, body: z.object({ userId: id }) }), async (req, res) =>
  ok(res, await s.transferOwnership(req.user.id, gid(req), req.valid.body.userId), 'Đã chuyển quyền sở hữu')
);

// Thành viên & lời mời
r.post('/:id/invites', validate({ params: idParams, body: z.object({ email: z.string().trim().toLowerCase().email() }) }), async (req, res) =>
  created(res, await s.invite(req.user.id, gid(req), req.valid.body.email), 'Đã gửi lời mời')
);
r.delete('/:id/invites/:inviteId', validate({ params: sub({ inviteId: id }) }), async (req, res) => {
  await s.cancelInvite(req.user.id, gid(req), req.valid.params.inviteId);
  ok(res, null, 'Đã hủy lời mời');
});
r.patch('/:id/members/:userId', validate({ params: sub({ userId: id }), body: z.object({ role: z.enum(['LEADER', 'MEMBER']) }) }), async (req, res) =>
  ok(res, await s.updateMember(req.user.id, gid(req), req.valid.params.userId, req.valid.body), 'Đã cập nhật vai trò')
);
r.delete('/:id/members/:userId', validate({ params: sub({ userId: id }) }), async (req, res) => {
  await s.removeMember(req.user.id, gid(req), req.valid.params.userId);
  ok(res, null, 'Đã xóa thành viên');
});

// Nhiệm vụ
r.get('/:id/tasks', validate({ params: idParams, query: z.object({ status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(), assigneeId: optionalId.optional() }) }), async (req, res) =>
  ok(res, await s.listTasks(req.user.id, gid(req), req.valid.query))
);
r.post('/:id/tasks', validate({ params: idParams, body: taskBody }), async (req, res) => created(res, await s.createTask(req.user.id, gid(req), req.valid.body), 'Đã tạo nhiệm vụ'));
r.post('/:id/tasks/bulk', validate({ params: idParams, body: z.object({ items: z.array(taskBody).min(1).max(20) }) }), async (req, res) =>
  created(res, await s.createTasksBulk(req.user.id, gid(req), req.valid.body.items), 'Đã tạo các nhiệm vụ')
);
r.patch('/:id/tasks/:taskId', validate({ params: sub({ taskId: id }), body: taskBody.partial() }), async (req, res) =>
  ok(res, await s.updateTask(req.user.id, gid(req), req.valid.params.taskId, req.valid.body), 'Đã cập nhật nhiệm vụ')
);
r.delete('/:id/tasks/:taskId', validate({ params: sub({ taskId: id }) }), async (req, res) => {
  await s.deleteTask(req.user.id, gid(req), req.valid.params.taskId);
  ok(res, null, 'Đã xóa nhiệm vụ');
});

// Tài nguyên chia sẻ
r.get('/:id/resources', validate({ params: idParams }), async (req, res) => ok(res, await s.listResources(req.user.id, gid(req))));
r.post(
  '/:id/resources',
  validate({
    params: idParams,
    body: z
      .object({ type: z.enum(['FILE', 'NOTE']), fileId: optionalId.optional(), noteId: optionalId.optional() })
      .refine((b) => (b.type === 'FILE' ? b.fileId : b.noteId), 'Thiếu file hoặc ghi chú'),
  }),
  async (req, res) => created(res, await s.shareResource(req.user.id, gid(req), req.valid.body), 'Đã chia sẻ với nhóm')
);
r.delete('/:id/resources/:resourceId', validate({ params: sub({ resourceId: id }) }), async (req, res) => {
  await s.unshareResource(req.user.id, gid(req), req.valid.params.resourceId);
  ok(res, null, 'Đã gỡ chia sẻ');
});

// Bình luận
const commentTarget = z.object({ targetType: z.enum(['GROUP', 'TASK']), targetId: id });
r.get('/:id/comments', validate({ params: idParams, query: commentTarget }), async (req, res) => ok(res, await s.listComments(req.user.id, gid(req), req.valid.query)));
r.post('/:id/comments', validate({ params: idParams, body: commentTarget.extend({ content: z.string().trim().min(1).max(5000) }) }), async (req, res) =>
  created(res, await s.addComment(req.user.id, gid(req), req.valid.body), 'Đã gửi bình luận')
);
r.delete('/:id/comments/:commentId', validate({ params: sub({ commentId: id }) }), async (req, res) => {
  await s.deleteComment(req.user.id, gid(req), req.valid.params.commentId);
  ok(res, null, 'Đã xóa bình luận');
});

r.get('/:id/activity', validate({ params: idParams, query: pagination }), async (req, res) => ok(res, await s.activityLog(req.user.id, gid(req), req.valid.query)));

// AI
r.post('/:id/ai/plan', aiLimiter, validate({ params: idParams, body: z.object({ goal: z.string().trim().min(5).max(3000) }) }), async (req, res) =>
  ok(res, await s.aiPlan(req.user.id, gid(req), req.valid.body))
);
r.post('/:id/ai/progress', aiLimiter, validate({ params: idParams }), async (req, res) => ok(res, await s.aiProgress(req.user.id, gid(req))));

module.exports = r;
