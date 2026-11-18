/** Thư viện cá nhân: Favorites, Recently Viewed, Trash, Activity History */
import { h, icon, btn } from '../core/dom.js';
import { api } from '../core/api.js';
import { query, setQuery } from '../core/router.js';
import { toast, showError, confirmDialog, emptyState, errorState, skeleton } from '../core/ui.js';
import { relativeTime, fmtDateTime } from '../core/format.js';

const TYPE = {
  FILE: ['Tài liệu', 'file'],
  FOLDER: ['Thư mục', 'folder'],
  NOTE: ['Ghi chú', 'note'],
  WORKBOOK: ['Bảng tính', 'sheet'],
  TASK: ['Công việc', 'task'],
  QUIZ_SET: ['Bộ câu hỏi', 'quiz'],
  GROUP: ['Nhóm', 'users'],
  POST: ['Bài viết', 'share'],
  SUBJECT: ['Môn học', 'calendar'],
  SEMESTER: ['Học kỳ', 'graduation'],
  CONVERSATION: ['Hội thoại AI', 'sparkles'],
};

export function mount(container) {
  let tab = query().tab || 'favorites';
  const tabs = h('div', { class: 'tabs mb-16' });
  const body = h('div');
  const renderTabs = () =>
    tabs.replaceChildren(
      ...[
        ['favorites', 'Yêu thích', 'star'],
        ['recent', 'Xem gần đây', 'clock'],
        ['trash', 'Thùng rác', 'trash'],
        ['activity', 'Lịch sử hoạt động', 'history'],
      ].map(([k, l, ic]) => h('button', { class: `tab ${tab === k ? 'active' : ''}`, onclick: () => ((tab = k), setQuery({ tab: k }), renderTabs(), load()) }, icon(ic), l))
    );
  container.append(h('div', { class: 'page-header' }, h('div', { class: 'titles' }, h('h1', {}, 'Thư viện'), h('p', {}, 'Mục yêu thích, nội dung đã xem gần đây, thùng rác và lịch sử hoạt động của bạn.'))), tabs, body);

  const itemRow = (it, extra) =>
    h(
      it.link ? 'a' : 'div',
      { class: 'list-item', href: it.link },
      h('div', { class: 'icon-box sm' }, icon(TYPE[it.entityType]?.[1] || 'file')),
      h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'bold small truncate' }, it.title), h('div', { class: 'tiny muted' }, `${TYPE[it.entityType]?.[0] || it.entityType} · ${relativeTime(it.viewedAt || it.createdAt || it.deletedAt)}`)),
      extra || null
    );

  async function load() {
    body.replaceChildren(skeleton(6, { avatar: true }));
    try {
      if (tab === 'favorites') {
        const list = await api.get('/library/favorites');
        body.replaceChildren(list.length ? h('div', { class: 'card' }, h('div', { class: 'list', style: { padding: '6px' } }, list.map((it) => itemRow(it, btn('', { icon: 'x', size: 'xs', variant: 'ghost', title: 'Bỏ yêu thích', onClick: async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            await api.put('/library/favorites', { entityType: it.entityType, entityId: it.entityId, favorite: false });
            load();
          } catch (err) {
            showError(err);
          }
        } }))))) : emptyState({ icon: 'star', title: 'Chưa có mục yêu thích', text: 'Bấm biểu tượng ngôi sao ở tài liệu, ghi chú, bảng tính, bài viết... để lưu vào đây.' }));
      } else if (tab === 'recent') {
        const list = await api.get('/library/recent', { limit: 40 });
        body.replaceChildren(list.length ? h('div', { class: 'card' }, h('div', { class: 'list', style: { padding: '6px' } }, list.map((it) => itemRow(it)))) : emptyState({ icon: 'clock', title: 'Chưa có lịch sử xem' }));
      } else if (tab === 'trash') {
        const list = await api.get('/library/trash');
        body.replaceChildren(
          h('div', { class: 'row mb-16' }, h('p', { class: 'small muted grow' }, 'Dữ liệu trong thùng rác có thể khôi phục. Xóa vĩnh viễn sẽ không thể hoàn tác (file trên đĩa cũng bị xóa).'), list.length ? btn('Dọn sạch thùng rác', { icon: 'trash', variant: 'danger', size: 'sm', onClick: emptyTrash }) : null),
          list.length
            ? h('div', { class: 'card' }, h('div', { class: 'list', style: { padding: '6px' } }, list.map((it) => itemRow({ ...it, link: null }, h('div', { class: 'row' }, btn('Khôi phục', { size: 'xs', icon: 'restore', onClick: () => restore(it) }), btn('', { size: 'xs', icon: 'trash', variant: 'ghost', title: 'Xóa vĩnh viễn', onClick: () => purge(it) }))))))
            : emptyState({ icon: 'trash', title: 'Thùng rác trống' })
        );
      } else {
        const r = await api.get('/library/activity', { page: 1, pageSize: 100 });
        body.replaceChildren(r.items.length ? h('div', { class: 'card card-pad timeline' }, r.items.map((a) => h('div', { class: 'timeline-item' }, h('span', { class: 'timeline-dot' }), h('div', {}, h('div', { class: 'small' }, a.summary), h('div', { class: 'tiny muted' }, `${fmtDateTime(a.createdAt)} · ${a.action}`))))) : emptyState({ icon: 'history', title: 'Chưa có hoạt động' }));
      }
    } catch (e) {
      body.replaceChildren(errorState(e, load));
    }
  }

  async function restore(it) {
    try {
      await api.post('/library/trash/restore', { entityType: it.entityType, entityId: it.entityId });
      toast(`Đã khôi phục "${it.title}"`);
      load();
    } catch (e) {
      showError(e);
    }
  }
  async function purge(it) {
    if (!(await confirmDialog({ title: 'Xóa vĩnh viễn?', message: `"${it.title}" sẽ bị xóa hoàn toàn và không thể khôi phục.`, danger: true, confirmText: 'Xóa vĩnh viễn' }))) return;
    try {
      await api.post('/library/trash/purge', { entityType: it.entityType, entityId: it.entityId });
      toast('Đã xóa vĩnh viễn');
      load();
    } catch (e) {
      showError(e);
    }
  }
  async function emptyTrash() {
    if (!(await confirmDialog({ title: 'Dọn sạch thùng rác?', message: 'Toàn bộ dữ liệu trong thùng rác sẽ bị xóa vĩnh viễn.', danger: true, confirmText: 'Dọn sạch' }))) return;
    try {
      const r = await api.post('/library/trash/empty');
      toast(`Đã xóa vĩnh viễn ${r.purged} mục`);
      load();
    } catch (e) {
      showError(e);
    }
  }

  renderTabs();
  load();
}
