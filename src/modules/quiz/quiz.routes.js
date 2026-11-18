'use strict';
const { Router } = require('express');
const service = require('./quiz.service');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { aiLimiter } = require('../../middlewares/rateLimiters');
const { ok, created } = require('../../utils/response');
const { z, id, idParams, optionalId, optionalText } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

const TYPE = z.enum(['SINGLE', 'MULTIPLE', 'TRUE_FALSE', 'SHORT']);
const DIFF = z.enum(['EASY', 'MEDIUM', 'HARD']);
const answerValue = z.union([z.string().max(1000), z.array(z.string().max(10)).max(10), z.boolean(), z.null()]);

const question = z.object({
  id: z.number().int().positive().optional(),
  type: TYPE,
  content: z.string().trim().min(1, 'Nội dung câu hỏi trống').max(5000),
  options: z.array(z.object({ id: z.string().min(1).max(4), text: z.string().trim().min(1, 'Lựa chọn trống').max(1000) })).max(8).nullable().optional(),
  correctAnswer: z.union([z.string().max(10), z.array(z.string().max(300)).max(10), z.boolean()]),
  explanation: optionalText(3000),
  difficulty: DIFF.default('MEDIUM'),
  topic: optionalText(120),
});

const setBody = z.object({
  title: z.string().trim().min(1).max(191),
  description: optionalText(5000),
  chapter: optionalText(120),
  subjectId: optionalId.optional(),
  sourceFileId: optionalId.optional(),
  questions: z.array(question).max(300).optional(),
});

r.get('/sets', validate({ query: z.object({ search: z.string().trim().max(100).optional(), subjectId: optionalId.optional() }) }), async (req, res) =>
  ok(res, await service.listSets(req.user.id, req.valid.query))
);
r.post('/sets', validate({ body: setBody }), async (req, res) => created(res, await service.createSet(req.user.id, req.valid.body), 'Đã tạo bộ câu hỏi'));
r.get('/sets/:id', validate({ params: idParams }), async (req, res) => ok(res, await service.getSet(req.user.id, req.valid.params.id)));
r.patch('/sets/:id', validate({ params: idParams, body: setBody.omit({ sourceFileId: true }).partial() }), async (req, res) =>
  ok(res, await service.updateSet(req.user.id, req.valid.params.id, req.valid.body), 'Đã lưu bộ câu hỏi')
);
r.delete('/sets/:id', validate({ params: idParams }), async (req, res) => {
  await service.deleteSet(req.user.id, req.valid.params.id);
  ok(res, null, 'Đã xóa bộ câu hỏi');
});

r.post(
  '/generate',
  aiLimiter,
  validate({
    body: z
      .object({
        fileId: optionalId.optional(),
        noteId: optionalId.optional(),
        text: z.string().max(30000).optional(),
        count: z.number().int().min(1).max(30).default(10),
        types: z.array(TYPE).min(1).default(['SINGLE']),
        difficulty: DIFF.default('MEDIUM'),
        chapter: z.string().trim().max(120).optional(),
      })
      .refine((b) => b.fileId || b.noteId || b.text, 'Cần chọn tài liệu, ghi chú hoặc nhập nội dung'),
  }),
  async (req, res) => ok(res, await service.generate(req.user.id, req.valid.body))
);

r.post(
  '/sets/:id/attempts',
  validate({
    params: idParams,
    body: z.object({
      mode: z.enum(['QUICK', 'PRACTICE', 'MOCK']),
      count: z.number().int().min(1).max(300).optional(),
      shuffle: z.boolean().optional(),
      timeLimitMin: z.number().int().min(1).max(300).optional(),
      topic: z.string().max(120).optional(),
      difficulty: DIFF.optional(),
    }),
  }),
  async (req, res) => created(res, await service.startAttempt(req.user.id, req.valid.params.id, req.valid.body), 'Bắt đầu làm bài')
);
r.get('/attempts', validate({ query: z.object({ setId: optionalId.optional() }) }), async (req, res) => ok(res, await service.history(req.user.id, req.valid.query)));
r.get('/stats', validate({ query: z.object({ setId: optionalId.optional() }) }), async (req, res) => ok(res, await service.stats(req.user.id, req.valid.query)));
r.get('/attempts/:id', validate({ params: idParams }), async (req, res) => ok(res, await service.getAttempt(req.user.id, req.valid.params.id)));
r.post('/attempts/:id/answer', validate({ params: idParams, body: z.object({ questionId: id, answer: answerValue }) }), async (req, res) =>
  ok(res, await service.answerPractice(req.user.id, req.valid.params.id, req.valid.body))
);
const answersBody = z.object({ answers: z.array(z.object({ questionId: id, answer: answerValue })).max(300).default([]) });
r.put('/attempts/:id/answers', validate({ params: idParams, body: answersBody }), async (req, res) =>
  ok(res, await service.saveAnswers(req.user.id, req.valid.params.id, req.valid.body.answers))
);
r.post('/attempts/:id/submit', validate({ params: idParams, body: answersBody }), async (req, res) =>
  ok(res, await service.submit(req.user.id, req.valid.params.id, req.valid.body.answers), 'Đã nộp bài')
);

r.get('/sets/:id/flashcards', validate({ params: idParams }), async (req, res) => ok(res, await service.flashcards(req.user.id, req.valid.params.id)));
r.post('/sets/:id/flashcards/:questionId/reveal', validate({ params: z.object({ id, questionId: id }) }), async (req, res) =>
  ok(res, await service.revealCard(req.user.id, req.valid.params.id, req.valid.params.questionId))
);

module.exports = r;
