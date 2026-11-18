'use strict';
/** Các schema Zod dùng chung giữa các module. */
const { z } = require('zod');

const id = z.coerce.number().int().positive();
const idParams = z.object({ id });

// '' | 'null' | null => null (gỡ liên kết); undefined => giữ undefined (không thay đổi khi PATCH)
const optionalId = z.preprocess(
  (v) => (v === '' || v === 'null' ? null : v),
  z.coerce.number().int().positive().nullable().optional()
);

const trimmed = (max, min = 0) => z.string().trim().min(min).max(max);
const optionalText = (max) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Màu phải có dạng #RRGGBB');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD');

const optionalDateTime = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.coerce.date().nullable()
);

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const boolQuery = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean().optional());

module.exports = { z, id, idParams, optionalId, trimmed, optionalText, color, isoDate, optionalDateTime, pagination, boolQuery };
