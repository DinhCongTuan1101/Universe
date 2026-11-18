/** Làm bài & xem lại kết quả. Đáp án chỉ được server trả về sau khi nộp (hoặc sau mỗi câu ở chế độ Luyện tập). */
import { h, icon, btn } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate, addLeaveGuard } from '../core/router.js';
import { toast, showError, confirmDialog, errorState, loading, withLoading } from '../core/ui.js';
import { TYPE_LABELS } from './quiz.js';

const MODE_LABELS = { QUICK: 'Quick Quiz', PRACTICE: 'Luyện tập', MOCK: 'Thi thử' };

export function mount(container, { params }) {
  const id = Number(params.id);
  let timer = null;
  let saveTimer = null;
  let data = null;
  const answers = new Map();
  container.append(loading());

  async function load() {
    try {
      data = await api.get(`/quiz/attempts/${id}`);
      if (data.attempt.status === 'SUBMITTED') renderReview();
      else renderPlay();
    } catch (e) {
      container.replaceChildren(errorState(e, load));
    }
  }

  function renderPlay() {
    const a = data.attempt;
    data.questions.forEach((q) => q.yourAnswer !== null && q.yourAnswer !== undefined && answers.set(q.id, q.yourAnswer));
    const progressBar = h('span', { style: { width: '0%' } });
    const counter = h('span', { class: 'small muted' });
    const clock = h('span', { class: 'badge info', hidden: !data.remainingSec });
    const updateProgress = () => {
      const done = a.mode === 'PRACTICE' ? data.questions.filter((q) => q.locked).length : answers.size;
      progressBar.style.width = `${(done / data.questions.length) * 100}%`;
      counter.textContent = `${done}/${data.questions.length} câu đã trả lời`;
    };
    const persist = () => {
      if (a.mode === 'PRACTICE') return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => api.put(`/quiz/attempts/${id}/answers`, { answers: [...answers].map(([questionId, answer]) => ({ questionId, answer })) }).catch(() => {}), 800);
    };

    const cards = data.questions.map((q, i) => questionCard(q, i));
    function questionCard(q, i) {
      const feedback = h('div');
      const card = h('div', { class: `card card-pad quiz-q ${q.locked ? (q.isCorrect ? 'correct' : 'wrong') : ''}`, id: `q-${q.id}` });
      const lock = (res) => {
        q.locked = true;
        q.isCorrect = res.isCorrect;
        q.correctAnswer = res.correctAnswer;
        q.explanation = res.explanation;
        card.replaceWith(questionCard(q, i));
        updateProgress();
      };
      const choose = (value) => {
        answers.set(q.id, value);
        persist();
        updateProgress();
      };
      let inputEl;
      const disabled = Boolean(q.locked);
      if (q.type === 'SINGLE' || q.type === 'MULTIPLE') {
        inputEl = h(
          'div',
          { class: 'col', style: { gap: '6px' } },
          q.options.map((o) => {
            const cur = answers.get(q.id);
            const checked = q.type === 'SINGLE' ? cur === o.id : Array.isArray(cur) && cur.includes(o.id);
            const correct = q.locked && (Array.isArray(q.correctAnswer) ? q.correctAnswer.includes(o.id) : q.correctAnswer === o.id);
            return h(
              'label',
              { class: `quiz-option ${checked ? 'selected' : ''} ${correct ? 'is-correct' : ''} ${q.locked && checked && !correct ? 'is-wrong' : ''}` },
              h('input', {
                type: q.type === 'SINGLE' ? 'radio' : 'checkbox',
                name: `q${q.id}`,
                checked,
                disabled,
                onchange: (e) => {
                  if (q.type === 'SINGLE') choose(o.id);
                  else {
                    const set = new Set(answers.get(q.id) || []);
                    e.target.checked ? set.add(o.id) : set.delete(o.id);
                    choose([...set]);
                  }
                  card.querySelectorAll('.quiz-option').forEach((l) => l.classList.toggle('selected', l.querySelector('input').checked));
                },
              }),
              h('span', { class: 'bold' }, `${o.id}.`),
              h('span', {}, o.text)
            );
          })
        );
      } else if (q.type === 'TRUE_FALSE') {
        inputEl = h(
          'div',
          { class: 'row' },
          [true, false].map((v) => {
            const checked = answers.get(q.id) === v;
            const correct = q.locked && q.correctAnswer === v;
            return h('label', { class: `quiz-option ${checked ? 'selected' : ''} ${correct ? 'is-correct' : ''} ${q.locked && checked && !correct ? 'is-wrong' : ''}`, style: { flex: 1 } }, h('input', { type: 'radio', name: `q${q.id}`, checked, disabled, onchange: () => (choose(v), card.querySelectorAll('.quiz-option').forEach((l) => l.classList.toggle('selected', l.querySelector('input').checked))) }), v ? 'Đúng' : 'Sai');
          })
        );
      } else {
        inputEl = h('input', { class: 'input', value: answers.get(q.id) || '', placeholder: 'Nhập câu trả lời...', disabled, oninput: (e) => (e.target.value.trim() ? choose(e.target.value) : (answers.delete(q.id), persist(), updateProgress())) });
      }
      if (q.locked) {
        feedback.append(
          h('div', { class: `alert ${q.isCorrect ? 'success' : 'danger'} mt-8` }, icon(q.isCorrect ? 'check-circle' : 'x'), h('div', { class: 'small' }, h('b', {}, q.isCorrect ? 'Chính xác!' : 'Chưa đúng.'), q.type === 'SHORT' ? ` Đáp án: ${(q.correctAnswer || []).join(' / ')}` : q.type === 'TRUE_FALSE' ? ` Đáp án: ${q.correctAnswer ? 'Đúng' : 'Sai'}` : '', q.explanation ? h('div', { class: 'mt-8' }, `💡 ${q.explanation}`) : null))
        );
      }
      card.append(
        h('div', { class: 'row mb-8' }, h('span', { class: 'badge primary' }, `Câu ${i + 1}`), h('span', { class: 'badge' }, TYPE_LABELS[q.type]), q.topic ? h('span', { class: 'badge violet' }, q.topic) : null),
        h('div', { class: 'quiz-content' }, q.content),
        inputEl,
        a.mode === 'PRACTICE' && !q.locked
          ? btn('Kiểm tra', {
              size: 'sm',
              variant: 'primary',
              icon: 'check',
              onClick: async (e) =>
                withLoading(e.currentTarget, async () => {
                  if (!answers.has(q.id)) return toast.error('Hãy chọn/nhập câu trả lời');
                  try {
                    lock(await api.post(`/quiz/attempts/${id}/answer`, { questionId: q.id, answer: answers.get(q.id) }));
                  } catch (err) {
                    showError(err);
                  }
                }),
            })
          : null,
        feedback
      );
      return card;
    }

    const submitBtn = btn(a.mode === 'PRACTICE' ? 'Kết thúc & xem kết quả' : 'Nộp bài', { icon: 'check', variant: 'primary', size: 'lg' });
    submitBtn.addEventListener('click', () => submit(false));
    async function submit(auto) {
      const unanswered = a.mode === 'PRACTICE' ? data.questions.filter((q) => !q.locked).length : data.questions.length - answers.size;
      if (!auto && unanswered && !(await confirmDialog({ title: 'Nộp bài?', message: `Còn ${unanswered} câu chưa trả lời – các câu này sẽ tính là sai.`, confirmText: 'Nộp bài' }))) return;
      clearTimeout(saveTimer);
      await withLoading(submitBtn, async () => {
        try {
          data = await api.post(`/quiz/attempts/${id}/submit`, { answers: a.mode === 'PRACTICE' ? [] : [...answers].map(([questionId, answer]) => ({ questionId, answer })) });
          clearInterval(timer);
          toast(auto ? 'Hết giờ – bài đã được nộp tự động' : 'Đã nộp bài', auto ? 'warning' : 'success');
          renderReview();
        } catch (e) {
          showError(e);
        }
      });
    }

    if (data.remainingSec) {
      let left = data.remainingSec;
      const tick = () => {
        const m = Math.floor(left / 60);
        const s = left % 60;
        clock.replaceChildren(icon('clock'), ` ${m}:${String(s).padStart(2, '0')}`);
        clock.className = `badge ${left < 60 ? 'danger' : left < 300 ? 'warning' : 'info'}`;
        if (left <= 0) {
          clearInterval(timer);
          submit(true);
        }
        left--;
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    container.replaceChildren(
      h('div', { class: 'quiz-play' }, h('div', { class: 'quiz-sticky card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'bold' }, a.quizSet.title), h('div', { class: 'tiny muted' }, MODE_LABELS[a.mode])), clock, counter), h('div', { class: 'progress sm mt-8' }, progressBar)), h('div', { class: 'col gap-12 mt-16' }, cards), h('div', { class: 'import-actions' }, btn('Để sau', { onClick: () => navigate(`/quiz/${a.quizSetId}`) }), h('div', { class: 'spacer' }), submitBtn))
    );
    updateProgress();
  }

  function renderReview() {
    const a = data.attempt;
    const score = a.score ?? 0;
    const tone = score >= 8 ? 'success' : score >= 5 ? 'warning' : 'danger';
    const byTopic = new Map();
    for (const q of data.review) {
      const t = q.topic || 'Khác';
      const cur = byTopic.get(t) || { total: 0, correct: 0 };
      cur.total++;
      if (q.isCorrect) cur.correct++;
      byTopic.set(t, cur);
    }
    const fmtAns = (q, v) => {
      if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return 'Không trả lời';
      if (q.type === 'TRUE_FALSE') return v ? 'Đúng' : 'Sai';
      if (q.type === 'SHORT') return Array.isArray(v) ? v.join(' / ') : String(v);
      const ids = Array.isArray(v) ? v : [v];
      return ids.map((x) => `${x}. ${q.options?.find((o) => o.id === x)?.text || ''}`).join('; ');
    };
    container.replaceChildren(
      h('div', { class: 'breadcrumb' }, h('a', { href: '/quiz' }, 'UniQuiz'), h('span', { class: 'sep' }, '/'), h('a', { href: `/quiz/${a.quizSetId}` }, a.quizSet.title), h('span', { class: 'sep' }, '/'), h('span', {}, 'Kết quả')),
      h(
        'div',
        { class: 'card card-pad result-hero' },
        h('div', { class: `score-ring ${tone}` }, h('div', { class: 'score' }, score), h('div', { class: 'tiny' }, '/ 10')),
        h(
          'div',
          { class: 'grow' },
          h('h2', {}, score >= 8 ? 'Xuất sắc! 🎉' : score >= 5 ? 'Khá tốt – tiếp tục cố gắng!' : 'Cần ôn tập thêm'),
          h('p', { class: 'muted' }, `${a.correctCount}/${a.totalCount} câu đúng · ${MODE_LABELS[a.mode]}`),
          h('div', { class: 'row wrap mt-8' }, [...byTopic].map(([t, v]) => h('span', { class: `badge ${v.correct / v.total >= 0.6 ? 'success' : 'danger'}` }, `${t}: ${v.correct}/${v.total}`))),
          h('div', { class: 'row mt-16' }, btn('Làm lại', { icon: 'refresh', onClick: () => navigate(`/quiz/${a.quizSetId}`) }), btn('Flashcards', { icon: 'layers', onClick: () => navigate(`/quiz/${a.quizSetId}/flashcards`) }))
        )
      ),
      h('div', { class: 'section-title mt-16' }, 'Xem lại câu trả lời'),
      h(
        'div',
        { class: 'col gap-12' },
        data.review.map((q, i) =>
          h(
            'div',
            { class: `card card-pad quiz-q ${q.isCorrect ? 'correct' : 'wrong'}` },
            h('div', { class: 'row mb-8' }, h('span', { class: `badge ${q.isCorrect ? 'success' : 'danger'}` }, icon(q.isCorrect ? 'check' : 'x'), `Câu ${i + 1}`), h('span', { class: 'badge' }, TYPE_LABELS[q.type]), q.topic ? h('span', { class: 'badge violet' }, q.topic) : null),
            h('div', { class: 'quiz-content' }, q.content),
            h('div', { class: 'small' }, h('b', {}, 'Bạn trả lời: '), h('span', { class: q.isCorrect ? 'success-text' : 'danger-text' }, fmtAns(q, q.yourAnswer))),
            !q.isCorrect ? h('div', { class: 'small' }, h('b', {}, 'Đáp án đúng: '), h('span', { class: 'success-text' }, fmtAns(q, q.correctAnswer))) : null,
            q.explanation ? h('div', { class: 'small muted mt-8' }, `💡 ${q.explanation}`) : null
          )
        )
      )
    );
  }

  const removeGuard = addLeaveGuard(async () => {
    if (data?.attempt?.status === 'IN_PROGRESS' && data.attempt.mode !== 'PRACTICE' && answers.size) {
      clearTimeout(saveTimer);
      await api.put(`/quiz/attempts/${id}/answers`, { answers: [...answers].map(([questionId, answer]) => ({ questionId, answer })) }).catch(() => {});
    }
    return true;
  });
  load();
  return () => {
    clearInterval(timer);
    removeGuard();
  };
}
