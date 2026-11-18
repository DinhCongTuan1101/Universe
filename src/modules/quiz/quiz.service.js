'use strict';
const crypto = require('node:crypto');
const prisma = require('../../database/prisma');
const library = require('../library/library.service');
const activity = require('../../services/activity.service');
const ai = require('../../services/ai/ai.service');
const prompts = require('../../services/ai/prompts');
const retrieval = require('../../services/retrieval.service');
const drive = require('../drive/drive.service');
const config = require('../../config');
const { isCorrect, validateQuestion, sanitizeGenerated } = require('./quiz.grading');
const { notFound, badRequest, unprocessable } = require('../../utils/errors');

async function ownSet(userId, id) {
  const s = await prisma.quizSet.findFirst({ where: { id, userId, deletedAt: null } });
  if (!s) throw notFound('Không tìm thấy bộ câu hỏi');
  return s;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Câu hỏi gửi cho người làm bài – KHÔNG kèm đáp án/giải thích. */
function publicQuestion(q) {
  return { id: q.id, type: q.type, content: q.content, options: q.options, difficulty: q.difficulty, topic: q.topic };
}

// ------------------------------------------------------------------ Bộ câu hỏi
async function listSets(userId, { search, subjectId }) {
  const rows = await prisma.quizSet.findMany({
    where: { userId, deletedAt: null, ...(subjectId ? { subjectId } : {}), ...(search ? { OR: [{ title: { contains: search } }, { chapter: { contains: search } }] } : {}) },
    include: {
      subject: { select: { id: true, name: true, color: true } },
      _count: { select: { questions: true, attempts: { where: { status: 'SUBMITTED' } } } },
      attempts: { where: { status: 'SUBMITTED' }, orderBy: { submittedAt: 'desc' }, take: 1, select: { score: true, submittedAt: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(({ attempts, ...r }) => ({ ...r, lastAttempt: attempts[0] || null }));
}

async function getSet(userId, id) {
  await ownSet(userId, id);
  const s = await prisma.quizSet.findUnique({
    where: { id },
    include: {
      subject: { select: { id: true, name: true, color: true } },
      sourceFile: { select: { id: true, originalName: true } },
      questions: { orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }] },
    },
  });
  await library.touchRecent(userId, 'QUIZ_SET', id);
  return s; // chủ sở hữu được xem đáp án ở chế độ soạn câu hỏi
}

async function checkSubject(userId, subjectId) {
  if (!subjectId) return;
  const s = await prisma.subject.findFirst({ where: { id: subjectId, userId, deletedAt: null } });
  if (!s) throw badRequest('Môn học không hợp lệ');
}

function assertQuestions(questions) {
  questions.forEach((q, i) => {
    const e = validateQuestion(q);
    if (e) throw unprocessable(`Câu ${i + 1}: ${e}`);
  });
}

async function createSet(userId, { questions = [], sourceFileId, subjectId, ...data }) {
  await checkSubject(userId, subjectId);
  if (sourceFileId) await drive.readableFile(userId, sourceFileId);
  assertQuestions(questions);
  const s = await prisma.quizSet.create({
    data: {
      ...data,
      userId,
      subjectId: subjectId ?? null,
      sourceFileId: sourceFileId ?? null,
      questions: { create: questions.map((q, i) => ({ ...q, orderIndex: i })) },
    },
  });
  await activity.log(userId, 'quiz.create', `Tạo bộ câu hỏi "${s.title}" (${questions.length} câu)`, { entityType: 'QUIZ_SET', entityId: s.id });
  return getSet(userId, s.id);
}

async function updateSet(userId, id, { questions, subjectId, ...data }) {
  await ownSet(userId, id);
  if (subjectId !== undefined) {
    await checkSubject(userId, subjectId);
    data.subjectId = subjectId;
  }
  if (questions) assertQuestions(questions);
  await prisma.$transaction(async (tx) => {
    await tx.quizSet.update({ where: { id }, data });
    if (questions) {
      // Cập nhật câu có id, tạo câu mới, xóa câu bị bỏ (giữ lịch sử làm bài của câu còn lại)
      const keep = questions.filter((q) => q.id).map((q) => q.id);
      await tx.question.deleteMany({ where: { quizSetId: id, id: { notIn: keep.length ? keep : [0] } } });
      for (const [i, q] of questions.entries()) {
        const { id: qid, ...fields } = q;
        if (qid) {
          const r = await tx.question.updateMany({ where: { id: qid, quizSetId: id }, data: { ...fields, orderIndex: i } });
          if (!r.count) throw badRequest(`Câu hỏi #${qid} không thuộc bộ này`);
        } else {
          await tx.question.create({ data: { ...fields, quizSetId: id, orderIndex: i } });
        }
      }
    }
  });
  return getSet(userId, id);
}

async function deleteSet(userId, id) {
  const s = await ownSet(userId, id);
  await prisma.quizSet.update({ where: { id }, data: { deletedAt: new Date() } });
  await activity.log(userId, 'quiz.delete', `Xóa bộ câu hỏi "${s.title}"`, { entityType: 'QUIZ_SET', entityId: id });
}

// ------------------------------------------------------------------ Sinh câu hỏi bằng AI (xem trước, chưa lưu)
async function generate(userId, { fileId, noteId, text, count, types, difficulty, chapter }) {
  ai.ensureConfigured();
  let source = '';
  let label = '';
  if (fileId) {
    const file = await drive.readableFile(userId, fileId);
    label = `Tài liệu "${file.originalName}"`;
    if (chapter) {
      // Có chương/chủ đề => chỉ lấy các đoạn liên quan thay vì toàn bộ tài liệu
      const { chunks } = await retrieval.retrieve(userId, chapter, { fileIds: [fileId], limit: 12 });
      source = chunks.map((c) => c.content).join('\n\n');
    }
    if (!source) {
      const t = await drive.fileText(userId, fileId, { maxChars: config.ai.maxInputChars });
      if (t.status !== 'READY') throw badRequest('Tài liệu chưa xử lý xong hoặc không có nội dung văn bản');
      source = t.text;
    }
  } else if (noteId) {
    const notes = require('../notes/notes.service');
    const n = await notes.readableNote(userId, noteId);
    label = `Ghi chú "${n.title}"`;
    source = n.contentText;
  } else {
    label = 'Nội dung';
    source = text || '';
  }
  if (source.trim().length < 50) throw badRequest('Nội dung quá ngắn để tạo câu hỏi');
  const { data } = await ai.completeJson(userId, 'quiz.generate', {
    system: prompts.quizPrompt({ count, types, difficulty, chapter }),
    messages: [{ role: 'user', content: `${label}:\n\n${source}` }],
    maxTokens: Math.min(config.ai.maxOutputTokens, 400 + count * 220),
  });
  const raw = Array.isArray(data?.questions) ? data.questions : [];
  const questions = raw.map(sanitizeGenerated).filter((q) => q && types.includes(q.type)).slice(0, count);
  return { questions, requested: count, received: raw.length, discarded: raw.length - questions.length, note: 'Hãy xem lại, chỉnh sửa rồi bấm Lưu. Câu hỏi chưa được lưu.' };
}

// ------------------------------------------------------------------ Làm bài
async function startAttempt(userId, setId, { mode, count, shuffle: doShuffle = true, timeLimitMin, topic, difficulty }) {
  await ownSet(userId, setId);
  let questions = await prisma.question.findMany({
    where: { quizSetId: setId, ...(topic ? { topic } : {}), ...(difficulty ? { difficulty } : {}) },
    orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
  });
  if (!questions.length) throw badRequest('Bộ câu hỏi chưa có câu nào phù hợp');
  if (doShuffle || mode === 'QUICK') questions = shuffle(questions);
  const limit = mode === 'QUICK' ? Math.min(count || 10, questions.length) : count ? Math.min(count, questions.length) : questions.length;
  questions = questions.slice(0, limit);
  const attempt = await prisma.quizAttempt.create({
    data: {
      userId,
      quizSetId: setId,
      mode,
      questionIds: questions.map((q) => q.id),
      totalCount: questions.length,
      timeLimitSec: mode === 'MOCK' && timeLimitMin ? timeLimitMin * 60 : null,
    },
  });
  return { attempt, questions: questions.map(publicQuestion) };
}

async function ownAttempt(userId, id) {
  const a = await prisma.quizAttempt.findFirst({ where: { id, userId }, include: { quizSet: { select: { id: true, title: true } } } });
  if (!a) throw notFound('Không tìm thấy bài làm');
  return a;
}

function deadlinePassed(a) {
  return a.timeLimitSec && Date.now() > a.startedAt.getTime() + (a.timeLimitSec + 30) * 1000; // 30s dung sai mạng
}

async function getAttempt(userId, id) {
  const a = await ownAttempt(userId, id);
  const qs = await prisma.question.findMany({ where: { id: { in: a.questionIds } } });
  const byId = new Map(qs.map((q) => [q.id, q]));
  const ordered = a.questionIds.map((qid) => byId.get(qid)).filter(Boolean);
  const answers = await prisma.quizAnswer.findMany({ where: { attemptId: id } });
  const ansMap = new Map(answers.map((x) => [x.questionId, x]));
  if (a.status === 'SUBMITTED') {
    return {
      attempt: a,
      review: ordered.map((q) => ({ ...q, yourAnswer: ansMap.get(q.id)?.answer ?? null, isCorrect: ansMap.get(q.id)?.isCorrect ?? false })),
    };
  }
  return {
    attempt: a,
    questions: ordered.map((q) => {
      const ans = ansMap.get(q.id);
      const base = { ...publicQuestion(q), yourAnswer: ans?.answer ?? null };
      // Practice: câu đã trả lời được xem đáp án ngay
      if (a.mode === 'PRACTICE' && ans) return { ...base, locked: true, isCorrect: ans.isCorrect, correctAnswer: q.correctAnswer, explanation: q.explanation };
      return base;
    }),
    remainingSec: a.timeLimitSec ? Math.max(0, Math.round((a.startedAt.getTime() + a.timeLimitSec * 1000 - Date.now()) / 1000)) : null,
  };
}

/** Practice mode: trả lời từng câu, nhận phản hồi ngay cho CHÍNH câu đó. */
async function answerPractice(userId, id, { questionId, answer }) {
  const a = await ownAttempt(userId, id);
  if (a.status !== 'IN_PROGRESS') throw badRequest('Bài làm đã kết thúc');
  if (a.mode !== 'PRACTICE') throw badRequest('Chỉ chế độ Luyện tập mới chấm từng câu');
  if (!a.questionIds.includes(questionId)) throw badRequest('Câu hỏi không thuộc bài làm');
  const existing = await prisma.quizAnswer.findUnique({ where: { attemptId_questionId: { attemptId: id, questionId } } });
  if (existing) throw badRequest('Câu này đã được trả lời');
  const q = await prisma.question.findUnique({ where: { id: questionId } });
  const correct = isCorrect(q, answer);
  await prisma.quizAnswer.create({ data: { attemptId: id, questionId, answer, isCorrect: correct } });
  return { questionId, isCorrect: correct, correctAnswer: q.correctAnswer, explanation: q.explanation };
}

/** Lưu tạm câu trả lời (Quick/Mock) – không chấm, không trả đáp án. */
async function saveAnswers(userId, id, answers) {
  const a = await ownAttempt(userId, id);
  if (a.status !== 'IN_PROGRESS') throw badRequest('Bài làm đã kết thúc');
  if (a.mode === 'PRACTICE') throw badRequest('Chế độ Luyện tập trả lời từng câu');
  const valid = answers.filter((x) => a.questionIds.includes(x.questionId));
  await prisma.$transaction(
    valid.map((x) =>
      prisma.quizAnswer.upsert({
        where: { attemptId_questionId: { attemptId: id, questionId: x.questionId } },
        create: { attemptId: id, questionId: x.questionId, answer: x.answer ?? undefined },
        update: { answer: x.answer ?? undefined, answeredAt: new Date() },
      })
    )
  );
  return { saved: valid.length };
}

async function submit(userId, id, answers = []) {
  const a = await ownAttempt(userId, id);
  if (a.status === 'SUBMITTED') return getAttempt(userId, id);
  if (a.mode !== 'PRACTICE' && answers.length && !deadlinePassed(a)) await saveAnswers(userId, id, answers);
  const qs = await prisma.question.findMany({ where: { id: { in: a.questionIds } } });
  const saved = await prisma.quizAnswer.findMany({ where: { attemptId: id } });
  const ansMap = new Map(saved.map((x) => [x.questionId, x]));
  let correctCount = 0;
  const updates = [];
  for (const q of qs) {
    const ans = ansMap.get(q.id);
    const ok = ans ? isCorrect(q, ans.answer) : false;
    if (ok) correctCount++;
    if (ans) updates.push(prisma.quizAnswer.update({ where: { id: ans.id }, data: { isCorrect: ok } }));
    else updates.push(prisma.quizAnswer.create({ data: { attemptId: id, questionId: q.id, isCorrect: false } }));
  }
  const score = a.totalCount ? Math.round((correctCount / a.totalCount) * 100) / 10 : 0; // thang 10
  await prisma.$transaction([...updates, prisma.quizAttempt.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date(), correctCount, score } })]);
  await activity.log(userId, 'quiz.submit', `Hoàn thành "${a.quizSet.title}": ${correctCount}/${a.totalCount} câu đúng (${score}/10)`, {
    entityType: 'QUIZ_SET',
    entityId: a.quizSetId,
  });
  return getAttempt(userId, id);
}

async function history(userId, { setId }) {
  return prisma.quizAttempt.findMany({
    where: { userId, ...(setId ? { quizSetId: setId } : {}) },
    include: { quizSet: { select: { id: true, title: true } } },
    orderBy: { startedAt: 'desc' },
    take: 100,
  });
}

/** Thống kê kết quả + chủ đề còn yếu (tỉ lệ đúng < 60%, cần ≥ 3 lượt trả lời). */
async function stats(userId, { setId }) {
  const answers = await prisma.quizAnswer.findMany({
    where: { attempt: { userId, status: 'SUBMITTED', ...(setId ? { quizSetId: setId } : {}) } },
    select: { isCorrect: true, question: { select: { topic: true, difficulty: true, type: true, quizSet: { select: { id: true, title: true } } } } },
    take: 20000,
  });
  const by = (keyFn) => {
    const m = new Map();
    for (const a of answers) {
      const k = keyFn(a);
      if (!k) continue;
      const cur = m.get(k) || { key: k, total: 0, correct: 0 };
      cur.total++;
      if (a.isCorrect) cur.correct++;
      m.set(k, cur);
    }
    return [...m.values()].map((x) => ({ ...x, accuracy: Math.round((x.correct / x.total) * 100) })).sort((x, y) => x.accuracy - y.accuracy);
  };
  const attempts = await prisma.quizAttempt.findMany({
    where: { userId, status: 'SUBMITTED', ...(setId ? { quizSetId: setId } : {}) },
    select: { score: true, submittedAt: true, mode: true, quizSet: { select: { title: true } } },
    orderBy: { submittedAt: 'asc' },
    take: 200,
  });
  const byTopic = by((a) => a.question.topic || null);
  return {
    totalAttempts: attempts.length,
    averageScore: attempts.length ? Math.round((attempts.reduce((s, a) => s + (a.score || 0), 0) / attempts.length) * 10) / 10 : null,
    bestScore: attempts.length ? Math.max(...attempts.map((a) => a.score || 0)) : null,
    trend: attempts.slice(-20).map((a) => ({ score: a.score, date: a.submittedAt, title: a.quizSet.title, mode: a.mode })),
    byTopic,
    byDifficulty: by((a) => a.question.difficulty),
    byType: by((a) => a.question.type),
    weakTopics: byTopic.filter((t) => t.total >= 3 && t.accuracy < 60),
  };
}

// ------------------------------------------------------------------ Flashcards
async function flashcards(userId, setId) {
  await ownSet(userId, setId);
  const qs = await prisma.question.findMany({ where: { quizSetId: setId }, orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }] });
  return qs.map((q) => ({ id: q.id, front: q.content, type: q.type, options: q.options, topic: q.topic }));
}

async function revealCard(userId, setId, questionId) {
  await ownSet(userId, setId);
  const q = await prisma.question.findFirst({ where: { id: questionId, quizSetId: setId } });
  if (!q) throw notFound('Không tìm thấy thẻ');
  let back;
  if (q.type === 'SINGLE') back = q.options?.find((o) => o.id === q.correctAnswer)?.text ?? q.correctAnswer;
  else if (q.type === 'MULTIPLE') back = (q.options || []).filter((o) => q.correctAnswer.includes(o.id)).map((o) => o.text).join('; ');
  else if (q.type === 'TRUE_FALSE') back = q.correctAnswer ? 'Đúng' : 'Sai';
  else back = (q.correctAnswer || []).join(' / ');
  return { id: q.id, back, explanation: q.explanation };
}

module.exports = {
  listSets,
  getSet,
  createSet,
  updateSet,
  deleteSet,
  generate,
  startAttempt,
  getAttempt,
  answerPractice,
  saveAnswers,
  submit,
  history,
  stats,
  flashcards,
  revealCard,
};
