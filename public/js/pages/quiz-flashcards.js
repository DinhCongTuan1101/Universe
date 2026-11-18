import { h, icon, btn } from '../core/dom.js';
import { api } from '../core/api.js';
import { showError, emptyState, errorState, loading } from '../core/ui.js';

export function mount(container, { params }) {
  const id = Number(params.id);
  let cards = [];
  let idx = 0;
  const known = new Set();
  const backs = new Map();
  container.append(loading());

  const onKey = (e) => {
    if (e.target.closest('input,textarea')) return;
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === ' ') {
      e.preventDefault();
      flip();
    }
  };
  document.addEventListener('keydown', onKey);

  async function load() {
    try {
      const [set, list] = await Promise.all([api.get(`/quiz/sets/${id}`), api.get(`/quiz/sets/${id}/flashcards`)]);
      cards = list;
      container.replaceChildren(h('div', { class: 'breadcrumb' }, h('a', { href: '/quiz' }, 'UniQuiz'), h('span', { class: 'sep' }, '/'), h('a', { href: `/quiz/${id}` }, set.title), h('span', { class: 'sep' }, '/'), h('span', {}, 'Flashcards')), h('h1', { class: 'mb-16' }, `Flashcards · ${set.title}`), stage);
      render();
    } catch (e) {
      container.replaceChildren(errorState(e, load));
    }
  }

  const stage = h('div', { class: 'flash-stage' });
  let flipped = false;

  async function flip() {
    const c = cards[idx];
    if (!c) return;
    if (!backs.has(c.id)) {
      try {
        backs.set(c.id, await api.post(`/quiz/sets/${id}/flashcards/${c.id}/reveal`));
      } catch (e) {
        return showError(e);
      }
    }
    flipped = !flipped;
    render();
  }
  function go(d) {
    if (!cards.length) return;
    idx = (idx + d + cards.length) % cards.length;
    flipped = false;
    render();
  }

  function render() {
    if (!cards.length) return stage.replaceChildren(emptyState({ icon: 'layers', title: 'Bộ câu hỏi chưa có thẻ nào' }));
    const c = cards[idx];
    const back = backs.get(c.id);
    stage.replaceChildren(
      h('div', { class: 'row mb-8' }, h('span', { class: 'muted small grow' }, `Thẻ ${idx + 1}/${cards.length} · Đã thuộc ${known.size}`), c.topic ? h('span', { class: 'badge violet' }, c.topic) : null),
      h('div', { class: 'progress sm mb-16' }, h('span', { style: { width: `${((idx + 1) / cards.length) * 100}%` } })),
      h(
        'button',
        { class: `flashcard ${flipped ? 'flipped' : ''} ${known.has(c.id) ? 'known' : ''}`, onclick: flip, 'aria-label': 'Lật thẻ' },
        h('div', { class: 'face' }, flipped && back ? [h('div', { class: 'tiny muted mb-8' }, 'Đáp án'), h('div', { class: 'flash-text' }, back.back), back.explanation ? h('div', { class: 'small muted mt-16' }, back.explanation) : null] : [h('div', { class: 'tiny muted mb-8' }, 'Câu hỏi'), h('div', { class: 'flash-text' }, c.front), c.options?.length ? h('div', { class: 'small muted mt-16' }, c.options.map((o) => `${o.id}. ${o.text}`).join('   ')) : null, h('div', { class: 'tiny faint mt-16' }, 'Bấm để lật (phím Space)')])
      ),
      h(
        'div',
        { class: 'row mt-16', style: { justifyContent: 'center' } },
        btn('', { icon: 'chevron-left', title: 'Thẻ trước', onClick: () => go(-1) }),
        btn(known.has(c.id) ? 'Bỏ đánh dấu' : 'Đã thuộc', { icon: 'check', variant: known.has(c.id) ? '' : 'soft', onClick: () => (known.has(c.id) ? known.delete(c.id) : known.add(c.id), go(1)) }),
        btn('Xáo trộn', {
          icon: 'refresh',
          onClick: () => {
            cards.sort(() => Math.random() - 0.5);
            idx = 0;
            flipped = false;
            render();
          },
        }),
        btn('', { icon: 'chevron-right', title: 'Thẻ sau', onClick: () => go(1) })
      )
    );
  }

  load();
  return () => document.removeEventListener('keydown', onKey);
}

export { icon };
