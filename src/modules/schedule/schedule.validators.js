'use strict';
const { z, isoDate, color, optionalText, optionalId, id } = require('../../utils/schemas');

const session = z
  .object({
    dayOfWeek: z.coerce.number().int().min(1).max(7),
    startPeriod: z.coerce.number().int().min(1).max(20),
    endPeriod: z.coerce.number().int().min(1).max(20),
    periods: z
      .union([z.string().max(60), z.array(z.coerce.number().int().min(1).max(20)).max(20)])
      .transform((v) => (Array.isArray(v) ? v.join(',') : v))
      .optional(),
    room: optionalText(80),
    location: optionalText(191),
    lecturer: optionalText(120),
  })
  .refine((s) => s.endPeriod >= s.startPeriod, { message: 'Tiết kết thúc phải ≥ tiết bắt đầu', path: ['endPeriod'] });

const period = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    rawText: optionalText(5000),
    sessions: z.array(session).min(1, 'Mỗi khoảng ngày cần ít nhất 1 buổi học').max(14),
  })
  .refine((p) => p.startDate <= p.endDate, { message: 'Ngày bắt đầu phải trước ngày kết thúc', path: ['endDate'] });

const subjectBody = z.object({
  name: z.string().trim().min(1, 'Vui lòng nhập tên môn').max(191),
  code: optionalText(40),
  credits: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(0).max(30).nullable().optional()),
  classCode: optionalText(120),
  lecturer: optionalText(120),
  color: color.optional(),
  note: optionalText(5000),
  semesterId: optionalId.optional(),
  periods: z.array(period).max(40).default([]),
});

const semesterBody = z.object({
  name: z.string().trim().min(1).max(120),
  academicYear: optionalText(20),
  term: optionalText(20),
  phase: optionalText(20),
  startDate: z.preprocess((v) => (v === '' ? null : v), isoDate.nullable().optional()),
  endDate: z.preprocess((v) => (v === '' ? null : v), isoDate.nullable().optional()),
  isCurrent: z.boolean().optional(),
});

const meetingsQuery = z
  .object({
    from: isoDate,
    to: isoDate,
    semesterId: optionalId.optional(),
    subjectId: optionalId.optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'Khoảng ngày không hợp lệ' });

const meetingUpdate = z.object({
  status: z.enum(['SCHEDULED', 'CANCELLED']).optional(),
  note: optionalText(2000),
  room: optionalText(80),
});

const importConfirm = z.object({
  semesterId: optionalId.optional(),
  newSemester: semesterBody.optional(),
  duplicateMode: z.enum(['skip', 'replace']).default('skip'),
  applyProfile: z.boolean().default(false),
  subjects: z
    .array(subjectBody.omit({ semesterId: true }).extend({ include: z.boolean().default(true), key: z.string().max(20).optional() }))
    .min(1, 'Không có môn học nào để nhập')
    .max(60),
});

module.exports = { subjectBody, semesterBody, meetingsQuery, meetingUpdate, importConfirm, idOnly: z.object({ id }) };
