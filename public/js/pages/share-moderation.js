import { h, icon, btn } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, showError, promptDialog, emptyState, errorState, skeleton } from '../core/ui.js';
import { relativeTime, fmtDateTime } from '../core/format.js';

const STATUS = { OPEN: ['Chờ xử lý', 'warning'], RESOLVED: ['Đã xử lý', 'success'], REJECTED: ['Bác bỏ', ''] };

export function mount(container) {
  let status = 'OPEN';
  const tabs = h('div', { class: 'tabs mb-16' });
  const body = h('div', {}, skeleton(5));
  const renderTabs = () => tabs.replaceChildren(...Object.entries(STATUS).map(([k, [l]]) => h('button', { class: `tab ${status === k ? 'active' : ''}`, onclick: () => ((status = k), renderTabs(), load()) }, l)));
  container.append(h('div', { class: 'breadcrumb' }, h('a', { href: '/share' }, 'UniShare'), h('span', { class: 'sep' }, '/'), h('span', {}, 'Kiểm duyệt')), h('div', { class: 'page-header' }, h('div', { class: 'titles' }, h('h1', {}, 'Kiểm duyệt nội dung'), h('p', {}, 'Xử lý báo cáo vi phạm: spam, bản quyền, nội dung không phù hợp. Mọi thao tác được ghi lịch sử.'))), tabs, body);

  async function resolve(r, action) {
    const note = action === 'reject' ? '' : await promptDialog({ title: action === 'restore' ? 'Khôi phục nội dung' : 'Lý do xử lý', label: 'Ghi chú gửi tới người đăng', required: false, multiline: true, confirmText: 'Xác nhận' });
    if (note === null) return;
    try {
      await api.post(`/community/moderation/reports/${r.id}/resolve`, { action, note: note || undefined });
      toast('Đã xử lý báo cáo');
      load();
    } catch (e) {
      showError(e);
    }
  }

  async function load() {
    try {
      const list = await api.get('/community/moderation/reports', { status });
      if (!list.length) return body.replaceChildren(emptyState({ icon: 'check-circle', title: 'Không có báo cáo', compact: false }));
      body.replaceChildren(
        h(
          'div',
          { class: 'col gap-12' },
          list.map((r) => {
            const t = r.target;
            return h(
              'div',
              { class: 'card card-pad' },
              h('div', { class: 'row wrap mb-8' }, h('span', { class: `badge ${STATUS[r.status][1]}` }, STATUS[r.status][0]), h('span', { class: 'badge danger' }, r.reasonLabel), h('span', { class: 'badge' }, r.targetType === 'POST' ? 'Bài viết' : 'Bình luận'), h('span', { class: 'tiny muted' }, `Báo cáo bởi ${r.reporter.fullName} · ${relativeTime(r.createdAt)}`)),
              t
                ? r.targetType === 'POST'
                  ? h('div', { class: 'small' }, h('a', { href: `/share/${t.id}`, class: 'bold' }, t.title), ` – ${t.author.fullName}`, t.deletedAt ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'Đã xóa') : h('span', { class: 'badge', style: { marginLeft: '6px' } }, t.status))
                  : h('div', { class: 'small' }, h('div', { class: 'quote-box' }, t.content), h('div', { class: 'tiny muted' }, `– ${t.user.fullName} · `, h('a', { href: `/share/${t.targetId}` }, 'xem bài viết'), t.hidden ? ' · đang ẩn' : ''))
                : h('div', { class: 'small muted' }, 'Nội dung không còn tồn tại'),
              r.details ? h('p', { class: 'small muted mt-8' }, `“${r.details}”`) : null,
              r.handledBy ? h('p', { class: 'tiny muted mt-8' }, `Xử lý bởi ${r.handledBy.fullName} lúc ${fmtDateTime(r.handledAt)}: ${r.resolution || ''}`) : null,
              t
                ? h(
                    'div',
                    { class: 'row wrap mt-16' },
                    r.status === 'OPEN' ? btn('Bác bỏ báo cáo', { size: 'sm', onClick: () => resolve(r, 'reject') }) : null,
                    btn('Ẩn nội dung', { size: 'sm', icon: 'eye', onClick: () => resolve(r, 'hide') }),
                    btn(r.targetType === 'POST' ? 'Gỡ bài viết' : 'Gỡ bình luận', { size: 'sm', icon: 'trash', variant: 'danger', onClick: () => resolve(r, 'remove') }),
                    r.status !== 'OPEN' ? btn('Khôi phục', { size: 'sm', icon: 'restore', onClick: () => resolve(r, 'restore') }) : null
                  )
                : null
            );
          })
        )
      );
    } catch (e) {
      body.replaceChildren(errorState(e, load));
    }
  }
  renderTabs();
  load();
}

export { icon };
