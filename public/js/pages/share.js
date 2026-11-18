import { h, icon, btn, avatar, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate, query, setQuery } from '../core/router.js';
import { store } from '../core/store.js';
import { emptyState, errorState, skeleton, select } from '../core/ui.js';
import { relativeTime } from '../core/format.js';

export const POST_TYPES = {
  ARTICLE: { label: 'Bài viết', icon: 'file-text', color: '#2563eb' },
  DOCUMENT: { label: 'Tài liệu', icon: 'folder', color: '#0ea5e9' },
  NOTE: { label: 'Ghi chú', icon: 'note', color: '#0891b2' },
  OUTLINE: { label: 'Đề cương', icon: 'list', color: '#f59e0b' },
  RESOURCE: { label: 'Tài nguyên', icon: 'link', color: '#10b981' },
};

export function mount(container) {
  const q = query();
  const user = store.get().user;
  const state = { type: q.type || '', subject: q.subject || '', topic: q.topic || '', search: q.search || '', sort: q.sort || 'new', mine: Boolean(q.mine), bookmarked: Boolean(q.bookmarked), page: 1 };
  const searchInput = h('input', { class: 'input sm', placeholder: 'Tìm bài viết, môn học, chủ đề...', value: state.search, style: { width: '280px' } });
  searchInput.addEventListener('input', debounce(() => ((state.search = searchInput.value.trim()), (state.page = 1), load()), 350));
  const sortSel = select(
    [
      { value: 'new', label: 'Mới nhất' },
      { value: 'top', label: 'Xem nhiều' },
      { value: 'rated', label: 'Đánh giá cao' },
    ],
    state.sort,
    { size: 'sm', onchange: (e) => ((state.sort = e.target.value), load()) }
  );
  const subjSel = select([{ value: '', label: 'Mọi môn học' }], '', { size: 'sm', onchange: (e) => ((state.subject = e.target.value), load()) });
  const topicSel = select([{ value: '', label: 'Mọi chủ đề' }], '', { size: 'sm', onchange: (e) => ((state.topic = e.target.value), load()) });
  const chips = h('div', { class: 'row wrap mb-16' });
  const renderChips = () =>
    chips.replaceChildren(
      h('button', { class: `chip ${!state.type && !state.mine && !state.bookmarked ? 'active' : ''}`, onclick: () => setFilter({ type: '', mine: false, bookmarked: false }) }, 'Tất cả'),
      ...Object.entries(POST_TYPES).map(([k, t]) => h('button', { class: `chip ${state.type === k ? 'active' : ''}`, onclick: () => setFilter({ type: k, mine: false, bookmarked: false }) }, icon(t.icon, { size: 14 }), t.label)),
      h('button', { class: `chip ${state.bookmarked ? 'active' : ''}`, onclick: () => setFilter({ bookmarked: !state.bookmarked, mine: false }) }, icon('bookmark', { size: 14 }), 'Đã lưu'),
      h('button', { class: `chip ${state.mine ? 'active' : ''}`, onclick: () => setFilter({ mine: !state.mine, bookmarked: false }) }, icon('user', { size: 14 }), 'Bài của tôi')
    );
  const listEl = h('div', {}, skeleton(5, { avatar: true }));
  const pager = h('div', { class: 'row mt-16', style: { justifyContent: 'center' } });

  container.append(
    h(
      'div',
      { class: 'page-header' },
      h('div', { class: 'titles' }, h('h1', {}, 'UniShare'), h('p', {}, 'Cộng đồng chia sẻ kiến thức, tài liệu, ghi chú và đề cương – tôn trọng bản quyền.')),
      h('div', { class: 'actions' }, user.role !== 'STUDENT' ? btn('Kiểm duyệt', { icon: 'flag', onClick: () => navigate('/share/moderation') }) : null, btn('Đăng bài', { icon: 'plus', variant: 'primary', onClick: () => navigate('/share/new') }))
    ),
    chips,
    h('div', { class: 'toolbar' }, h('div', { class: 'input-icon' }, icon('search'), searchInput), subjSel, topicSel, sortSel),
    listEl,
    pager
  );

  function setFilter(p) {
    Object.assign(state, p, { page: 1 });
    renderChips();
    load();
  }

  async function loadFacets() {
    try {
      const f = await api.get('/community/facets');
      subjSel.replaceChildren(h('option', { value: '' }, 'Mọi môn học'), ...f.subjects.map((s) => h('option', { value: s.name, selected: s.name === state.subject }, `${s.name} (${s.count})`)));
      topicSel.replaceChildren(h('option', { value: '' }, 'Mọi chủ đề'), ...f.topics.map((s) => h('option', { value: s.name, selected: s.name === state.topic }, `${s.name} (${s.count})`)));
    } catch {
      /* ignore */
    }
  }

  async function load() {
    setQuery({ type: state.type, subject: state.subject, topic: state.topic, search: state.search, sort: state.sort === 'new' ? '' : state.sort, mine: state.mine ? 1 : '', bookmarked: state.bookmarked ? 1 : '' });
    try {
      const r = await api.get('/community/posts', { type: state.type, subject: state.subject, topic: state.topic, search: state.search, sort: state.sort, mine: state.mine || undefined, bookmarked: state.bookmarked || undefined, page: state.page, pageSize: 15 });
      if (!r.items.length) {
        listEl.replaceChildren(emptyState({ icon: 'share', title: 'Chưa có bài viết phù hợp', text: 'Hãy là người đầu tiên chia sẻ kiến thức!', action: btn('Đăng bài', { icon: 'plus', variant: 'primary', onClick: () => navigate('/share/new') }) }));
        pager.replaceChildren();
        return;
      }
      listEl.replaceChildren(h('div', { class: 'col gap-12' }, r.items.map(postCard)));
      const pages = Math.ceil(r.total / r.pageSize);
      pager.replaceChildren(
        ...(pages > 1
          ? [btn('', { icon: 'chevron-left', size: 'sm', disabled: state.page <= 1, onClick: () => (state.page--, load(), scrollTo(0, 0)) }), h('span', { class: 'small muted' }, `Trang ${state.page}/${pages}`), btn('', { icon: 'chevron-right', size: 'sm', disabled: state.page >= pages, onClick: () => (state.page++, load(), scrollTo(0, 0)) })]
          : [])
      );
    } catch (e) {
      listEl.replaceChildren(errorState(e, load));
    }
  }

  renderChips();
  loadFacets();
  load();
}

export function postCard(p) {
  const t = POST_TYPES[p.type];
  return h(
    'a',
    { class: 'card hoverable post-card', href: `/share/${p.id}` },
    h('div', { class: 'row' }, avatar(p.author, 'sm'), h('span', { class: 'small bold' }, p.author.fullName), p.author.role !== 'STUDENT' ? h('span', { class: 'badge violet' }, p.author.role === 'ADMIN' ? 'Admin' : 'Moderator') : null, h('span', { class: 'tiny muted' }, `· ${relativeTime(p.createdAt)}`), h('div', { class: 'spacer' }), p.status !== 'PUBLISHED' ? h('span', { class: 'badge danger' }, p.status === 'HIDDEN' ? 'Đã ẩn' : 'Đã gỡ') : null, p.bookmarked ? icon('bookmark', { size: 15, className: 'fav-star' }) : null),
    h('div', { class: 'row mt-8', style: { alignItems: 'flex-start' } }, h('div', { class: 'icon-box sm', style: { background: `${t.color}1a`, color: t.color } }, icon(t.icon)), h('div', { class: 'grow', style: { minWidth: 0 } }, h('h3', {}, p.title), h('p', { class: 'small muted post-excerpt' }, p.excerpt))),
    h(
      'div',
      { class: 'row wrap mt-8 tiny muted' },
      h('span', { class: 'badge', style: { background: `${t.color}1a`, color: t.color } }, t.label),
      p.subjectName ? h('span', { class: 'badge' }, p.subjectName) : null,
      p.topic ? h('span', { class: 'badge info' }, `#${p.topic}`) : null,
      p.file ? h('span', { class: 'badge' }, icon('file'), p.file.extension.toUpperCase()) : null,
      h('div', { class: 'spacer' }),
      h('span', {}, icon('star', { size: 12 }), ` ${p.ratingAvg || '–'} (${p.ratingCount})`),
      h('span', {}, icon('message', { size: 12 }), ` ${p.commentCount}`),
      h('span', {}, icon('eye', { size: 12 }), ` ${p.viewCount}`)
    )
  );
}
