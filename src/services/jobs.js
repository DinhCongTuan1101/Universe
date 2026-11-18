'use strict';
/**
 * Tác vụ nền chạy trong cùng tiến trình (không cần Redis/queue ngoài):
 *  - Gửi thông báo nhắc nhở công việc (Task.remindAt) mỗi phút.
 *  - Xử lý tài liệu UniDrive đang chờ (trích xuất văn bản / embedding) – xem document.service.
 */
const prisma = require('../database/prisma');
const logger = require('../utils/logger');
const { notify } = require('./notification.service');

let timer = null;
let running = false;

async function sendTaskReminders() {
  const now = new Date();
  const due = await prisma.task.findMany({
    where: { remindAt: { lte: now }, reminderSentAt: null, deletedAt: null, status: { not: 'DONE' } },
    select: { id: true, title: true, userId: true, assigneeId: true, groupId: true, dueAt: true },
    take: 200,
  });
  for (const t of due) {
    const target = t.groupId ? t.assigneeId || t.userId : t.userId;
    await notify(target, {
      type: 'task.reminder',
      title: `Nhắc nhở: ${t.title}`,
      body: t.dueAt ? `Hạn chót: ${t.dueAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` : null,
      link: t.groupId ? `/groups/${t.groupId}?tab=tasks` : `/tasks?open=${t.id}`,
    });
    await prisma.task.update({ where: { id: t.id }, data: { reminderSentAt: now } });
  }
  return due.length;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await sendTaskReminders();
    const documents = require('../modules/drive/document.service');
    await documents.processPending();
  } catch (err) {
    logger.error('Lỗi tác vụ nền', { error: err });
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, 60 * 1000);
  timer.unref();
  setTimeout(tick, 5000).unref();
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, sendTaskReminders };
