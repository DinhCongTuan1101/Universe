'use strict';
const { z, optionalId } = require('../../utils/schemas');

const BLOCK_TYPES = ['paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'todo', 'quote', 'code', 'divider', 'table', 'image', 'link', 'callout'];

const block = z.object({
  id: z.string().max(40),
  type: z.enum(BLOCK_TYPES),
  text: z.string().max(20000).default(''),
  checked: z.boolean().optional(),
  language: z.string().max(30).optional(),
  url: z
    .string()
    .max(2000)
    .refine((u) => u === '' || /^https?:\/\//i.test(u), 'Liên kết phải bắt đầu bằng http:// hoặc https://')
    .optional(),
  fileId: z.number().int().positive().optional(),
  caption: z.string().max(500).optional(),
  rows: z.array(z.array(z.string().max(2000)).max(20)).max(100).optional(),
  indent: z.number().int().min(0).max(6).optional(),
});

const content = z.object({ blocks: z.array(block).max(3000) });

const createNote = z.object({
  title: z.string().trim().max(255).default(''),
  icon: z.string().max(16).nullable().optional(),
  parentId: optionalId.optional(),
  subjectId: optionalId.optional(),
  content: content.optional(),
});

const updateNote = z.object({
  title: z.string().max(255).optional(),
  icon: z.string().max(16).nullable().optional(),
  subjectId: optionalId.optional(),
  parentId: optionalId.optional(),
  content: content.optional(),
  version: z.number().int().positive(),
});

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  subjectId: optionalId.optional(),
});

const aiBody = z.object({
  action: z.enum(['summarize', 'rewrite', 'explain', 'explainCode', 'quiz', 'flashcards']),
  text: z.string().max(20000).optional(),
  count: z.number().int().min(1).max(20).optional(),
});

module.exports = { createNote, updateNote, listQuery, aiBody, BLOCK_TYPES };
