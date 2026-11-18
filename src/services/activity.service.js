'use strict';
const prisma = require('../database/prisma');
const logger = require('../utils/logger');

/**
 * Ghi lịch sử hoạt động. Không bao giờ làm hỏng nghiệp vụ chính nếu ghi log lỗi.
 * @param {number} userId
 * @param {string} action   vd: "note.create"
 * @param {string} summary  mô tả ngắn cho người dùng đọc
 * @param {{entityType?:string, entityId?:number, groupId?:number, metadata?:object}} [opts]
 */
async function log(userId, action, summary, opts = {}) {
  try {
    await prisma.activityLog.create({
      data: {
        userId,
        action,
        summary: String(summary).slice(0, 255),
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
        groupId: opts.groupId ?? null,
        metadata: opts.metadata ?? undefined,
      },
    });
  } catch (err) {
    logger.warn('Không ghi được activity log', { action, error: err.message });
  }
}

async function listForUser(userId, { page, pageSize }) {
  const where = { userId };
  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.activityLog.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

module.exports = { log, listForUser };
