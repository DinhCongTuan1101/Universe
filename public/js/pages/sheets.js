import { h, icon, btn, debounce } from '../core/dom.js';
import { api, download } from '../core/api.js';
import { navigate, query } from '../core/router.js';
import { toast, showError, modal, confirmDialog, promptDialog, menu, emptyState, errorState, skeletonCards, select, field, withLoading } from '../core/ui.js';
import { relativeTime } from '../core/format.js';

export function mount(container) {
  const q = query();
  let search = '';
  const body = h('div', {}, skeletonCards(6));
  const fileInput = h('input', { type: 'file', accept: '.csv,.xlsx,.xls', hidden: true, onchange: () => importFile(fileInput.files[0]) });
  const searchInput = h('input', { class: 'input sm', placeholder: 'Tìm bảng tính...', style: { width: '260px' } });
  searchInput.addEventListener('input', debounce(() => ((search = searchInput.value.trim()), load()), 300));

  container.append(
    fileInput,
    h(
      'div',
      { class: 'page-header' },
      h('div', { class: 'titles' }, h('h1', {}, 'UniSheet'), h('p', {}, 'Bảng tính học tập: công thức SUM, AVERAGE, MAX, MIN, COUNT, IF, SUMIF, COUNTIF – nhập/xuất CSV & XLSX.')),
      h('div', { class: 'actions' }, btn('Nhập CSV/XLSX', { icon: 'upload', onClick: () => fileInput.click() }), btn('Bảng tính mới', { icon: 'plus', variant: 'primary', onClick: () => create() }))
    ),
    h('div', { class: 'toolbar' }, h('div', { class: 'input-icon' }, icon('search'), searchInput)),
    body
  );

  async function load() {
    try {
      const list = await api.get('/sheets', { search: search || undefined, subjectId: q.subject });
      if (!list.length) {
        body.replaceChildren(emptyState({ icon: 'sheet', title: search ? 'Không tìm thấy bảng tính' : 'Chưa có bảng tính', text: 'Tạo bảng điểm, bảng theo dõi chi tiêu học tập, thống kê thí nghiệm...', action: search ? null : btn('Tạo bảng tính', { icon: 'plus', variant: 'primary', onClick: () => create() }) }));
        return;
      }
      body.replaceChildren(
        h(
          'div',
          { class: 'grid auto' },
          list.map((w) =>
            h(
              'div',
              { class: 'card hoverable card-pad', onclick: () => navigate(`/sheets/${w.id}`) },
              h('div', { class: 'row' }, h('div', { class: 'icon-box', style: { background: '#16a34a1a', color: '#16a34a' } }, icon('sheet')), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'bold truncate' }, w.title), h('div', { class: 'tiny muted' }, `${w._count.sheets} trang tính · ${relativeTime(w.updatedAt)}`)), btn('', { icon: 'more', size: 'xs', variant: 'ghost', title: 'Thao tác', onClick: (e) => (e.stopPropagation(), itemMenu(e.currentTarget, w)) })),
              h('div', { class: 'row wrap mt-8' }, w.subject ? h('span', { class: 'badge', style: { background: `${w.subject.color}1f`, color: w.subject.color } }, w.subject.name) : null, w.favorite ? h('span', { class: 'badge warning' }, icon('star'), 'Yêu thích') : null)
            )
          )
        )
      );
    } catch (e) {
      body.replaceChildren(errorState(e, load));
    }
  }

  function itemMenu(anchor, w) {
    menu(anchor, [
      { label: 'Mở', icon: 'sheet', onClick: () => navigate(`/sheets/${w.id}`) },
      {
        label: 'Đổi tên',
        icon: 'edit',
        onClick: async () => {
          const title = await promptDialog({ title: 'Đổi tên bảng tính', value: w.title });
          if (title) api.patch(`/sheets/${w.id}`, { title }).then(() => (toast('Đã đổi tên'), load())).catch(showError);
        },
      },
      { label: w.favorite ? 'Bỏ yêu thích' : 'Yêu thích', icon: 'star', onClick: () => api.put('/library/favorites', { entityType: 'WORKBOOK', entityId: w.id, favorite: !w.favorite }).then(load).catch(showError) },
      { label: 'Xuất XLSX', icon: 'download', onClick: () => download(`/sheets/${w.id}/export?format=xlsx`, `${w.title}.xlsx`).catch(showError) },
      { label: 'Xuất CSV (trang đầu)', icon: 'download', onClick: () => download(`/sheets/${w.id}/export?format=csv`, `${w.title}.csv`).catch(showError) },
      'sep',
      {
        label: 'Xóa',
        icon: 'trash',
        danger: true,
        onClick: async () => {
          if (!(await confirmDialog({ title: 'Xóa bảng tính?', message: `"${w.title}" sẽ được chuyển vào Thùng rác.`, danger: true, confirmText: 'Xóa' }))) return;
          api.del(`/sheets/${w.id}`).then(() => (toast('Đã xóa'), load())).catch(showError);
        },
      },
    ]);
  }

  async function create() {
    const subjects = await api.get('/schedules/subjects/options').catch(() => []);
    const title = h('input', { class: 'input', placeholder: 'vd: Bảng điểm học kỳ 1', autofocus: true });
    const subj = select([{ value: '', label: '— Không gắn môn —' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))], q.subject || '');
    modal({
      title: 'Bảng tính mới',
      body: [field('Tên bảng tính', title), field('Môn học', subj)],
      footer: (close) => [
        btn('Hủy', { onClick: () => close() }),
        btn('Tạo', {
          variant: 'primary',
          onClick: async (e) => {
            if (!title.value.trim()) return toast.error('Nhập tên bảng tính');
            await withLoading(e.currentTarget, async () => {
              try {
                const w = await api.post('/sheets', { title: title.value.trim(), subjectId: subj.value || null });
                close();
                navigate(`/sheets/${w.id}`);
              } catch (err) {
                showError(err);
              }
            });
          },
        }),
      ],
    });
  }

  async function importFile(file) {
    fileInput.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const close = toast('Đang nhập bảng tính...', 'info', { timeout: 0 });
    try {
      const r = await api.upload('/sheets/import', fd);
      close();
      toast('Đã nhập bảng tính');
      navigate(`/sheets/${r.data.id}`);
    } catch (e) {
      close();
      showError(e);
    }
  }

  load();
  if (q.new) create();
}
