import { h, icon, btn } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate, query, addLeaveGuard } from '../core/router.js';
import { toast, showError, modal, confirmDialog, emptyState, errorState, loading, select, field, withLoading } from '../core/ui.js';
import { fmtDateTime } from '../core/format.js';
import { TYPE_LABELS, DIFF_LABELS, trendChart } from './quiz.js';

const MODE_LABELS = { QUICK: 'Quick Quiz', PRACTICE: 'Luyện tập', MOCK: 'Thi thử' };

/** Hiển thị 1 câu hỏi kèm đáp án (dùng cho bản xem trước / chế độ soạn) */
export function questionPreview(q, i) {
  const correct = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
  return h(
    'div',
    {},
    h('div', { class: 'row wrap mb-8' }, h('span', { class: 'badge primary' }, TYPE_LABELS[q.type]), h('span', { class: 'badge' }, DIFF_LABELS[q.difficulty] || ''), q.topic ? h('span', { class: 'badge violet' }, q.topic) : null),
    h('div', { class: 'bold small' }, `${i + 1}. ${q.content}`),
    q.options?.length ? h('ul', { class: 'small', style: { margin: '6px 0 0', paddingLeft: '18px' } }, q.options.map((o) => h('li', { class: correct.includes(o.id) ? 'success-text bold' : '' }, `${o.id}. ${o.text}`, correct.includes(o.id) ? ' ✓' : ''))) : null,
    q.type === 'TRUE_FALSE' ? h('div', { class: 'small success-text mt-8' }, `Đáp án: ${q.correctAnswer ? 'Đúng' : 'Sai'}`) : null,
    q.type === 'SHORT' ? h('div', { class: 'small success-text mt-8' }, `Đáp án chấp nhận: ${correct.join(' / ')}`) : null,
    q.explanation ? h('div', { class: 'tiny muted mt-8' }, `💡 ${q.explanation}`) : null
  );
}

export function mount(container, { params }) {
  const id = Number(params.id);
  const q = query();
  let set = null;
  let editMode = Boolean(q.edit);
  let draft = [];
  let dirty = false;
  container.append(loading());

  async function load() {
    try {
      const [s, history] = await Promise.all([api.get(`/quiz/sets/${id}`), api.get('/quiz/attempts', { setId: id })]);
      set = s;
      draft = JSON.parse(JSON.stringify(s.questions));
      render(history);
    } catch (e) {
      container.replaceChildren(errorState(e, load));
    }
  }

  function render(history = []) {
    const topics = [...new Set(set.questions.map((x) => x.topic).filter(Boolean))];
    container.replaceChildren(
      h('div', { class: 'breadcrumb' }, h('a', { href: '/quiz' }, 'UniQuiz'), h('span', { class: 'sep' }, '/'), h('span', {}, set.title)),
      h(
        'div',
        { class: 'page-header' },
        h('div', { class: 'titles' }, h('h1', {}, set.title), h('p', {}, [set.subject?.name, set.chapter, `${set.questions.length} câu hỏi`, set.sourceFile ? `Nguồn: ${set.sourceFile.originalName}` : null].filter(Boolean).join(' · '))),
        h(
          'div',
          { class: 'actions' },
          editMode ? null : btn('Chỉnh sửa câu hỏi', { icon: 'edit', onClick: () => ((editMode = true), render(history)) }),
          editMode ? null : btn('Flashcards', { icon: 'layers', onClick: () => navigate(`/quiz/${id}/flashcards`), disabled: !set.questions.length }),
          editMode ? null : btn('Bắt đầu làm bài', { icon: 'play', variant: 'primary', onClick: () => startDialog(topics), disabled: !set.questions.length }),
          btn('', {
            icon: 'trash',
            title: 'Xóa bộ câu hỏi',
            onClick: async () => {
              if (!(await confirmDialog({ title: 'Xóa bộ câu hỏi?', message: 'Bộ câu hỏi sẽ được chuyển vào Thùng rác.', danger: true, confirmText: 'Xóa' }))) return;
              try {
                await api.del(`/quiz/sets/${id}`);
                toast('Đã xóa');
                navigate('/quiz');
              } catch (e) {
                showError(e);
              }
            },
          })
        )
      ),
      editMode ? renderEditor(history) : renderOverview(history)
    );
  }

  function renderOverview(history) {
    const submitted = history.filter((a) => a.status === 'SUBMITTED');
    return h(
      'div',
      { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' }, id: 'quiz-overview' },
      h(
        'div',
        { class: 'col gap-12' },
        set.questions.length
          ? set.questions.map((qq, i) => h('div', { class: 'card card-pad' }, questionPreview(qq, i)))
          : emptyState({ icon: 'quiz', title: 'Chưa có câu hỏi', action: btn('Thêm câu hỏi', { icon: 'plus', variant: 'primary', onClick: () => ((editMode = true), render(history)) }) })
      ),
      h(
        'div',
        { class: 'col gap-12' },
        h(
          'div',
          { class: 'card card-pad' },
          h('div', { class: 'section-title' }, 'Lịch sử làm bài'),
          submitted.length > 1 ? trendChart(submitted.slice(0, 15).reverse().map((a) => ({ score: a.score, date: a.submittedAt, title: MODE_LABELS[a.mode] }))) : null,
          history.length
            ? h(
                'div',
                { class: 'list' },
                history.slice(0, 15).map((a) => h('a', { class: 'list-item', href: `/quiz/attempt/${a.id}` }, h('span', { class: `badge ${a.status !== 'SUBMITTED' ? 'info' : a.score >= 8 ? 'success' : a.score >= 5 ? 'warning' : 'danger'}` }, a.status === 'SUBMITTED' ? `${a.score}/10` : 'Đang làm'), h('div', { class: 'grow' }, h('div', { class: 'small bold' }, MODE_LABELS[a.mode]), h('div', { class: 'tiny muted' }, `${a.status === 'SUBMITTED' ? `${a.correctCount}/${a.totalCount} đúng · ` : ''}${fmtDateTime(a.startedAt)}`))))
              )
            : h('p', { class: 'small muted' }, 'Chưa làm bài lần nào.')
        )
      )
    );
  }

  // ---------------------------------------------------------------- Editor
  function renderEditor(history) {
    const listEl = h('div', { class: 'col gap-12' });
    const renderList = () => listEl.replaceChildren(...(draft.length ? draft.map((qq, i) => questionEditor(qq, i)) : [emptyState({ icon: 'quiz', title: 'Chưa có câu hỏi', text: 'Thêm câu hỏi bằng các nút bên dưới.', compact: true })]));
    const addBtns = h('div', { class: 'row wrap' }, Object.entries(TYPE_LABELS).map(([t, l]) => btn(l, { icon: 'plus', size: 'sm', onClick: () => (draft.push(blank(t)), (dirty = true), renderList(), listEl.lastChild?.scrollIntoView({ behavior: 'smooth' })) })));

    function blank(type) {
      return {
        type,
        content: '',
        options: type === 'SINGLE' || type === 'MULTIPLE' ? ['a', 'b', 'c', 'd'].map((id) => ({ id, text: '' })) : null,
        correctAnswer: type === 'SINGLE' ? 'a' : type === 'MULTIPLE' ? ['a'] : type === 'TRUE_FALSE' ? true : [''],
        explanation: '',
        difficulty: 'MEDIUM',
        topic: '',
      };
    }

    function questionEditor(qq, i) {
      const mark = () => (dirty = true);
      const content = h('textarea', { class: 'textarea', rows: 2, value: qq.content, placeholder: 'Nội dung câu hỏi', oninput: (e) => ((qq.content = e.target.value), mark()) });
      const optionsEl = h('div', { class: 'col', style: { gap: '6px' } });
      const renderOptions = () => {
        if (qq.type === 'SINGLE' || qq.type === 'MULTIPLE') {
          optionsEl.replaceChildren(
            ...qq.options.map((o, oi) => {
              const isCorrect = qq.type === 'SINGLE' ? qq.correctAnswer === o.id : qq.correctAnswer.includes(o.id);
              const mk = h('input', {
                type: qq.type === 'SINGLE' ? 'radio' : 'checkbox',
                name: `correct-${i}`,
                checked: isCorrect,
                title: 'Đáp án đúng',
                onchange: (e) => {
                  if (qq.type === 'SINGLE') qq.correctAnswer = o.id;
                  else qq.correctAnswer = e.target.checked ? [...new Set([...qq.correctAnswer, o.id])] : qq.correctAnswer.filter((x) => x !== o.id);
                  mark();
                },
              });
              return h(
                'div',
                { class: 'row' },
                mk,
                h('span', { class: 'bold small', style: { width: '18px' } }, o.id),
                h('input', { class: 'input sm grow', value: o.text, placeholder: `Lựa chọn ${o.id}`, oninput: (e) => ((o.text = e.target.value), mark()) }),
                qq.options.length > 2
                  ? btn('', {
                      icon: 'x',
                      size: 'xs',
                      variant: 'ghost',
                      title: 'Xóa lựa chọn',
                      onClick: () => {
                        qq.options.splice(oi, 1);
                        qq.options.forEach((op, k) => {
                          const old = op.id;
                          op.id = String.fromCharCode(97 + k);
                          if (qq.type === 'SINGLE' && qq.correctAnswer === old) qq.correctAnswer = op.id;
                          if (qq.type === 'MULTIPLE') qq.correctAnswer = qq.correctAnswer.map((c) => (c === old ? op.id : c));
                        });
                        if (qq.type === 'SINGLE' && !qq.options.some((op) => op.id === qq.correctAnswer)) qq.correctAnswer = 'a';
                        if (qq.type === 'MULTIPLE') qq.correctAnswer = qq.correctAnswer.filter((c) => qq.options.some((op) => op.id === c));
                        mark();
                        renderOptions();
                      },
                    })
                  : null
              );
            }),
            qq.options.length < 8 ? btn('Thêm lựa chọn', { icon: 'plus', size: 'xs', variant: 'ghost', onClick: () => (qq.options.push({ id: String.fromCharCode(97 + qq.options.length), text: '' }), mark(), renderOptions()) }) : ''
          );
        } else if (qq.type === 'TRUE_FALSE') {
          optionsEl.replaceChildren(h('div', { class: 'row' }, ...[true, false].map((v) => h('label', { class: 'checkbox' }, h('input', { type: 'radio', name: `tf-${i}`, checked: qq.correctAnswer === v, onchange: () => ((qq.correctAnswer = v), mark()) }), v ? 'Đúng' : 'Sai'))));
        } else {
          optionsEl.replaceChildren(field('Đáp án chấp nhận (mỗi dòng một đáp án, không phân biệt hoa thường/dấu)', h('textarea', { class: 'textarea', rows: 2, value: (qq.correctAnswer || []).join('\n'), oninput: (e) => ((qq.correctAnswer = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)), mark()) })));
        }
      };
      renderOptions();
      return h(
        'div',
        { class: 'card card-pad' },
        h(
          'div',
          { class: 'row mb-8' },
          h('span', { class: 'bold' }, `Câu ${i + 1}`),
          h('span', { class: 'badge primary' }, TYPE_LABELS[qq.type]),
          h('div', { class: 'spacer' }),
          btn('', { icon: 'chevron-up', size: 'xs', variant: 'ghost', title: 'Lên', disabled: i === 0, onClick: () => ([draft[i - 1], draft[i]] = [draft[i], draft[i - 1]], mark(), renderList()) }),
          btn('', { icon: 'chevron-down', size: 'xs', variant: 'ghost', title: 'Xuống', disabled: i === draft.length - 1, onClick: () => ([draft[i + 1], draft[i]] = [draft[i], draft[i + 1]], mark(), renderList()) }),
          btn('', { icon: 'trash', size: 'xs', variant: 'ghost', title: 'Xóa câu', onClick: () => (draft.splice(i, 1), mark(), renderList()) })
        ),
        content,
        h('div', { class: 'mt-8' }, optionsEl),
        h(
          'div',
          { class: 'grid cols-3 mt-8', style: { gap: '8px' } },
          field('Độ khó', select(Object.entries(DIFF_LABELS).map(([v, l]) => ({ value: v, label: l })), qq.difficulty, { size: 'sm', onchange: (e) => ((qq.difficulty = e.target.value), mark()) })),
          field('Chủ đề', h('input', { class: 'input sm', value: qq.topic || '', placeholder: 'vd: Định tuyến', oninput: (e) => ((qq.topic = e.target.value), mark()) })),
          field('Giải thích', h('input', { class: 'input sm', value: qq.explanation || '', placeholder: 'Giải thích đáp án', oninput: (e) => ((qq.explanation = e.target.value), mark()) }))
        )
      );
    }

    renderList();
    const save = btn('Lưu bộ câu hỏi', {
      icon: 'check',
      variant: 'primary',
      onClick: async (e) =>
        withLoading(e.currentTarget, async () => {
          const bad = draft.findIndex((x) => !x.content.trim() || (x.options && x.options.some((o) => !o.text.trim())));
          if (bad >= 0) return toast.error(`Câu ${bad + 1}: còn nội dung hoặc lựa chọn trống`);
          try {
            const questions = draft.map((x) => ({ ...(x.id ? { id: x.id } : {}), type: x.type, content: x.content, options: x.options, correctAnswer: x.correctAnswer, explanation: x.explanation || null, difficulty: x.difficulty, topic: x.topic || null }));
            set = await api.patch(`/quiz/sets/${id}`, { questions });
            draft = JSON.parse(JSON.stringify(set.questions));
            dirty = false;
            editMode = false;
            toast('Đã lưu bộ câu hỏi');
            render(history);
          } catch (err) {
            showError(err);
          }
        }),
    });
    return h(
      'div',
      {},
      h('div', { class: 'alert info mb-16' }, icon('info'), 'Chế độ soạn: đánh dấu đáp án đúng bằng ô chọn bên trái mỗi lựa chọn. Đáp án chỉ hiển thị với bạn – người làm bài chỉ thấy sau khi nộp.'),
      listEl,
      h('div', { class: 'card card-pad mt-16' }, h('div', { class: 'section-title' }, 'Thêm câu hỏi'), addBtns),
      h('div', { class: 'import-actions' }, btn('Hủy', { onClick: async () => {
        if (dirty && !(await confirmDialog({ title: 'Bỏ thay đổi?', message: 'Các thay đổi chưa lưu sẽ mất.', confirmText: 'Bỏ thay đổi', danger: true }))) return;
        draft = JSON.parse(JSON.stringify(set.questions));
        dirty = false;
        editMode = false;
        render(history);
      } }), h('div', { class: 'spacer' }), save)
    );
  }

  // ---------------------------------------------------------------- Start
  function startDialog(topics) {
    const mode = select(
      [
        { value: 'QUICK', label: 'Quick Quiz – ngẫu nhiên vài câu, chấm khi nộp' },
        { value: 'PRACTICE', label: 'Luyện tập – xem đáp án ngay sau mỗi câu' },
        { value: 'MOCK', label: 'Thi thử – có giới hạn thời gian' },
      ],
      'QUICK'
    );
    const count = h('input', { class: 'input', type: 'number', min: 1, max: set.questions.length, value: Math.min(10, set.questions.length) });
    const minutes = h('input', { class: 'input', type: 'number', min: 1, max: 300, value: Math.max(5, Math.round(set.questions.length * 1.5)) });
    const topic = select([{ value: '', label: 'Tất cả chủ đề' }, ...topics.map((t) => ({ value: t, label: t }))], '');
    const diff = select([{ value: '', label: 'Mọi độ khó' }, ...Object.entries(DIFF_LABELS).map(([v, l]) => ({ value: v, label: l }))], '');
    const shuffle = h('input', { type: 'checkbox', checked: true });
    const timeField = field('Thời gian (phút)', minutes);
    const sync = () => (timeField.hidden = mode.value !== 'MOCK');
    mode.addEventListener('change', sync);
    sync();
    modal({
      title: 'Bắt đầu làm bài',
      icon: 'play',
      body: [field('Chế độ', mode), h('div', { class: 'form-grid' }, field('Số câu', count), timeField, field('Chủ đề', topic), field('Độ khó', diff)), h('label', { class: 'checkbox small' }, shuffle, 'Xáo trộn thứ tự câu hỏi')],
      footer: (close) => [
        btn('Hủy', { onClick: () => close() }),
        btn('Bắt đầu', {
          icon: 'play',
          variant: 'primary',
          onClick: async (e) =>
            withLoading(e.currentTarget, async () => {
              try {
                const r = await api.post(`/quiz/sets/${id}/attempts`, { mode: mode.value, count: Number(count.value) || undefined, timeLimitMin: mode.value === 'MOCK' ? Number(minutes.value) : undefined, topic: topic.value || undefined, difficulty: diff.value || undefined, shuffle: shuffle.checked });
                close();
                navigate(`/quiz/attempt/${r.attempt.id}`);
              } catch (err) {
                showError(err);
              }
            }),
        }),
      ],
    });
  }

  const removeGuard = addLeaveGuard(async () => !dirty || confirmDialog({ title: 'Rời trang?', message: 'Câu hỏi đang soạn chưa được lưu.', confirmText: 'Rời trang', danger: true }));
  load();
  return () => removeGuard();
}
