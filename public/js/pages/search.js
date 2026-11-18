import { h, icon, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { query, setQuery } from '../core/router.js';
import { emptyState, errorState, skeleton } from '../core/ui.js';

const GROUPS = { files: ['Tài liệu', 'file'], notes: ['Ghi chú', 'note'], tasks: ['Công việc', 'task'], groups: ['Nhóm', 'users'], posts: ['UniShare', 'share'], subjects: ['Môn học', 'calendar'], workbooks: ['Bảng tính', 'sheet'], quizzes: ['Bộ câu hỏi', 'quiz'] };

export function mount(container) {
  const input = h('input', { class: 'input', placeholder: 'Tìm trên toàn UniVerse...', value: query().q || '', autofocus: true, style: { height: '46px', fontSize: '15px' } });
  const body = h('div', { class: 'mt-16' });
  container.append(h('h1', { class: 'mb-16' }, 'UniSearch'), h('div', { class: 'input-icon' }, icon('search'), input), h('p', { class: 'tiny muted mt-8' }, 'Tìm theo từ khóa trong tên, mô tả và nội dung tài liệu đã trích xuất. Chỉ hiển thị dữ liệu bạn có quyền xem.'), body);

  const run = debounce(async () => {
    const q = input.value.trim();
    setQuery({ q });
    if (!q) return body.replaceChildren(emptyState({ icon: 'search', title: 'Nhập từ khóa để tìm kiếm' }));
    body.replaceChildren(skeleton(6, { avatar: true }));
    try {
      const r = await api.get('/search', { q, limit: 20 });
      if (!r.total) return body.replaceChildren(emptyState({ icon: 'search', title: 'Không tìm thấy kết quả', text: `Không có dữ liệu khớp "${q}".` }));
      body.replaceChildren(
        h('p', { class: 'muted small mb-16' }, `${r.total} kết quả`),
        ...Object.entries(r.results)
          .filter(([, list]) => list.length)
          .map(([k, list]) =>
            h(
              'section',
              { class: 'card mb-16' },
              h('div', { class: 'card-header' }, h('div', { class: 'icon-box sm' }, icon(GROUPS[k][1])), h('h3', {}, `${GROUPS[k][0]} (${list.length})`)),
              h('div', { class: 'list', style: { padding: '6px' } }, list.map((it) => h('a', { class: 'list-item', href: it.link }, it.icon ? h('span', {}, it.icon) : it.color ? h('span', { class: 'dot', style: { background: it.color } }) : null, h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'bold small truncate' }, it.title), it.subtitle ? h('div', { class: 'tiny muted truncate' }, it.subtitle) : null), it.shared ? h('span', { class: 'badge' }, 'Được chia sẻ') : null)))
            )
          )
      );
    } catch (e) {
      body.replaceChildren(errorState(e, run));
    }
  }, 300);
  input.addEventListener('input', run);
  run();
}
