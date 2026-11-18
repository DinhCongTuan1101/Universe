'use strict';
/** Chấm điểm câu hỏi – logic thuần để kiểm thử độc lập. */
const { fold } = require('../schedule/importers/sheetGrid');

function normalizeShort(s) {
  return fold(String(s ?? ''))
    .replace(/[.,;:!?"'()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {{type:string, correctAnswer:any}} q
 * @param {any} answer câu trả lời của người dùng
 * @returns {boolean}
 */
function isCorrect(q, answer) {
  if (answer === undefined || answer === null) return false;
  switch (q.type) {
    case 'SINGLE':
      return typeof answer === 'string' && answer === q.correctAnswer;
    case 'MULTIPLE': {
      if (!Array.isArray(answer) || !Array.isArray(q.correctAnswer)) return false;
      const a = new Set(answer);
      const c = new Set(q.correctAnswer);
      return a.size === c.size && [...c].every((x) => a.has(x));
    }
    case 'TRUE_FALSE':
      return typeof answer === 'boolean' && answer === q.correctAnswer;
    case 'SHORT': {
      const accepted = (Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer]).map(normalizeShort).filter(Boolean);
      return accepted.includes(normalizeShort(answer));
    }
    default:
      return false;
  }
}

/** Kiểm tra câu hỏi hợp lệ về cấu trúc đáp án. Trả về thông báo lỗi hoặc null. */
function validateQuestion(q) {
  const ids = (q.options || []).map((o) => o.id);
  if (new Set(ids).size !== ids.length) return 'Mã lựa chọn bị trùng';
  switch (q.type) {
    case 'SINGLE':
      if (ids.length < 2) return 'Câu một đáp án cần ít nhất 2 lựa chọn';
      if (typeof q.correctAnswer !== 'string' || !ids.includes(q.correctAnswer)) return 'Chưa chọn đáp án đúng';
      return null;
    case 'MULTIPLE':
      if (ids.length < 2) return 'Câu nhiều đáp án cần ít nhất 2 lựa chọn';
      if (!Array.isArray(q.correctAnswer) || q.correctAnswer.length < 1 || !q.correctAnswer.every((a) => ids.includes(a))) return 'Đáp án đúng không hợp lệ';
      return null;
    case 'TRUE_FALSE':
      return typeof q.correctAnswer === 'boolean' ? null : 'Chưa chọn Đúng/Sai';
    case 'SHORT':
      return Array.isArray(q.correctAnswer) && q.correctAnswer.some((a) => String(a).trim()) ? null : 'Cần ít nhất một đáp án chấp nhận';
    default:
      return 'Loại câu hỏi không hợp lệ';
  }
}

/** Chuẩn hóa câu hỏi do AI sinh ra; trả về null nếu không dùng được. */
function sanitizeGenerated(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = ['SINGLE', 'MULTIPLE', 'TRUE_FALSE', 'SHORT'].includes(raw.type) ? raw.type : null;
  if (!type || !raw.content) return null;
  const q = {
    type,
    content: String(raw.content).slice(0, 5000),
    explanation: raw.explanation ? String(raw.explanation).slice(0, 3000) : null,
    difficulty: ['EASY', 'MEDIUM', 'HARD'].includes(raw.difficulty) ? raw.difficulty : 'MEDIUM',
    topic: raw.topic ? String(raw.topic).slice(0, 120) : null,
    options: null,
    correctAnswer: null,
  };
  if (type === 'SINGLE' || type === 'MULTIPLE') {
    q.options = (Array.isArray(raw.options) ? raw.options : []).slice(0, 8).map((o, i) => ({ id: String(o?.id ?? String.fromCharCode(97 + i)).slice(0, 4), text: String(o?.text ?? o ?? '').slice(0, 1000) }));
    q.correctAnswer = type === 'SINGLE' ? String(Array.isArray(raw.correctAnswer) ? raw.correctAnswer[0] : raw.correctAnswer) : (Array.isArray(raw.correctAnswer) ? raw.correctAnswer : [raw.correctAnswer]).map(String);
  } else if (type === 'TRUE_FALSE') {
    q.correctAnswer = raw.correctAnswer === true || String(raw.correctAnswer).toLowerCase() === 'true';
  } else {
    q.correctAnswer = (Array.isArray(raw.correctAnswer) ? raw.correctAnswer : [raw.correctAnswer]).map((a) => String(a).slice(0, 300)).filter(Boolean);
  }
  return validateQuestion(q) ? null : q;
}

module.exports = { isCorrect, validateQuestion, sanitizeGenerated, normalizeShort };
