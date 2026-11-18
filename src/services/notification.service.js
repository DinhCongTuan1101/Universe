'use strict';
const prisma = require('../database/prisma');
const logger = require('../utils/logger');

/** Loại thông báo -> khóa cài đặt của người dùng (user.notificationSettings). */
const TYPE_SETTING = {
  'task.reminder': 'taskReminders',
  'task.assigned': 'groupActivity',
  'group.invite': 'groupActivity',
  'group.activity': 'groupActivity',
  'group.comment': 'groupActivity',
  'share.comment': 'communityActivity',
  'share.moderation': 'communityActivity',
  'document.processed': 'documentProcessing',
};

const DEFAULT_SETTINGS = { taskReminders: true, groupActivity: true, communityActivity: true, documentProcessing: true };

function effectiveSettings(raw) {
  return { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

/**
 * Tạo thông báo cho 1 hoặc nhiều người dùng, tôn trọng cài đặt tắt/bật của từng người.
 * Lỗi không làm hỏng nghiệp vụ chính.
 */
async function notify(userIds, { type, title, body, link }) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))];
  if (!ids.length) return;
  try {
    const key = TYPE_SETTING[type];
    let targets = ids;
    if (key) {
      const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, notificationSettings: true } });
      targets = users.filter((u) => effectiveSettings(u.notificationSettings)[key]).map((u) => u.id);
    }
    if (!targets.length) return;
    await prisma.notification.createMany({
      data: targets.map((userId) => ({
        userId,
        type,
        title: String(title).slice(0, 191),
        body: body ? String(body).slice(0, 500) : null,
        link: link ? String(link).slice(0, 255) : null,
      })),
    });
  } catch (err) {
    logger.warn('Không tạo được thông báo', { type, error: err.message });
  }
}

module.exports = { notify, effectiveSettings, DEFAULT_SETTINGS };
