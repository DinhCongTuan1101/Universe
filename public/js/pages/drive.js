import { h, icon, btn, debounce } from '../core/dom.js';
import { api, download } from '../core/api.js';
import { query, setQuery } from '../core/router.js';
import { store } from '../core/store.js';
import { toast, showError, modal, confirmDialog, promptDialog, drawer, menu, emptyState, errorState, skeleton, select, field, withLoading } from '../core/ui.js';
import { fileSize, relativeTime, fmtDateTime, FILE_ICONS } from '../core/format.js';
import { renderMarkdown } from '../core/markdown.js';

const DOC_STATUS = {
  UPLOADED: ['Chờ xử lý', 'info'],
  PROCESSING: ['Đang xử lý', 'info'],
  READY: ['Đã trích xuất', 'success'],
  FAILED: ['Lỗi xử lý', 'danger'],
};

export function mount(container) {
  const q = query();
  const state = { view: q.view || 'my', folderId: q.folder ? Number(q.folder) : null, subjectId: q.subject || '', type: '', search: '', sort: 'name', data: null, subjects: [], tags: [] };
  let pollTimer = null;

  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => uploadFiles([...fileInput.files]) });
  const searchInput = h('input', { class: 'input sm', placeholder: 'Tìm theo tên hoặc nội dung tài liệu...', style: { width: '280px' } });
  searchInput.addEventListener('input', debounce(() => ((state.search = searchInput.value.trim()), load()), 350));
  const subjSel = select([{ value: '', label: 'Mọi môn học' }], '', { size: 'sm', onchange: (e) => ((state.subjectId = e.target.value), load()) });
  const typeSel = select(
    [
      { value: '', label: 'Mọi loại file' },
      { value: 'document', label: 'Tài liệu' },
      { value: 'spreadsheet', label: 'Bảng tính' },
      { value: 'presentation', label: 'Trình chiếu' },
      { value: 'image', label: 'Hình ảnh' },
      { value: 'archive', label: 'File nén' },
    ],
    '',
    { size: 'sm', onchange: (e) => ((state.type = e.target.value), load()) }
  );
  const sortSel = select(
    [
      { value: 'name', label: 'Tên A→Z' },
      { value: 'date', label: 'Mới cập nhật' },
      { value: 'size', label: 'Dung lượng' },
    ],
    'name',
    { size: 'sm', onchange: (e) => ((state.sort = e.target.value), load()) }
  );
  const tabs = h(
    'div',
    { class: 'tabs mb-16' },
    [
      ['my', 'Tài liệu của tôi', 'folder'],
      ['shared', 'Được chia sẻ', 'users'],
      ['favorites', 'Yêu thích', 'star'],
      ['recent', 'Gần đây', 'clock'],
    ].map(([v, l, ic]) => h('button', { class: `tab ${state.view === v ? 'active' : ''}`, 'data-v': v, onclick: () => setView(v) }, icon(ic), l))
  );
  const storageBox = h('div', { class: 'storage-meter' });
  const body = h('div', {}, skeleton(6, { avatar: true }));

  const dropOverlay = h('div', { class: 'drop-overlay', hidden: true }, icon('upload', { size: 40 }), h('div', {}, 'Thả file để tải lên'));
  container.append(
    fileInput,
    dropOverlay,
    h(
      'div',
      { class: 'page-header' },
      h('div', { class: 'titles' }, h('h1', {}, 'UniDrive'), h('p', {}, 'Lưu trữ tài liệu học tập an toàn, trích xuất nội dung để tìm kiếm & hỏi đáp AI.')),
      h('div', { class: 'actions' }, storageBox, btn('Thư mục mới', { icon: 'folder-plus', onClick: newFolder }), btn('Tải lên', { icon: 'upload', variant: 'primary', onClick: () => fileInput.click() }))
    ),
    tabs,
    h('div', { class: 'toolbar' }, h('div', { class: 'input-icon' }, icon('search'), searchInput), subjSel, typeSel, sortSel, h('div', { class: 'spacer' }), btn('Hỏi đáp tài liệu', { icon: 'sparkles', variant: 'soft', size: 'sm', onClick: () => askDocs() })),
    body
  );

  // Kéo thả upload
  let dragDepth = 0;
  const onDragEnter = (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    dragDepth++;
    dropOverlay.hidden = false;
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.hidden = true;
  };
  const onDrop = (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    uploadFiles([...e.dataTransfer.files]);
  };
  const onDragOver = (e) => e.dataTransfer?.types?.includes('Files') && e.preventDefault();
  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);

  function setView(v) {
    state.view = v;
    if (v !== 'my') state.folderId = null;
    tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.v === v));
    load();
  }

  async function loadMeta() {
    try {
      const [subjects, usage, tags] = await Promise.all([api.get('/schedules/subjects/options'), api.get('/users/me/storage'), api.get('/drive/tags')]);
      state.subjects = subjects;
      state.tags = tags;
      subjSel.replaceChildren(...[{ id: '', name: 'Mọi môn học' }, ...subjects].map((s) => h('option', { value: s.id, selected: String(s.id) === String(state.subjectId) }, s.name)));
      const pct = Math.min(100, Math.round((usage.used / usage.quota) * 100));
      storageBox.replaceChildren(h('div', { class: 'tiny muted' }, `${fileSize(usage.used)} / ${fileSize(usage.quota)}`), h('div', { class: 'progress sm', style: { width: '140px' } }, h('span', { style: { width: `${pct}%`, background: pct > 90 ? 'var(--danger)' : undefined } })));
    } catch {
      /* không chặn trang */
    }
  }

  async function load() {
    setQuery({ view: state.view === 'my' ? '' : state.view, folder: state.folderId, subject: state.subjectId });
    try {
      const data = await api.get('/drive', { view: state.view, folderId: state.folderId, subjectId: state.subjectId, type: state.type, search: state.search, sort: state.sort });
      state.data = data;
      render();
      schedulePoll();
    } catch (e) {
      body.replaceChildren(errorState(e, load));
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    const pending = state.data?.files.some((f) => ['UPLOADED', 'PROCESSING'].includes(f.document?.status));
    if (pending) pollTimer = setTimeout(load, 3000);
  }

  function render() {
    const d = state.data;
    const crumbs = state.view === 'my' && !d.filtering ? h('div', { class: 'breadcrumb mb-8' }, h('button', { onclick: () => openFolder(null) }, icon('folder', { size: 14 }), ' Tài liệu của tôi'), ...d.breadcrumb.flatMap((b) => [h('span', { class: 'sep' }, '/'), h('button', { onclick: () => openFolder(b.id) }, b.name)])) : null;
    if (!d.folders.length && !d.files.length) {
      const empty = {
        my: d.filtering ? { icon: 'search', title: 'Không tìm thấy tài liệu', text: 'Thử từ khóa khác hoặc bỏ bộ lọc.' } : { icon: 'folder', title: state.folderId ? 'Thư mục trống' : 'Chưa có tài liệu', text: 'Kéo thả file vào trang hoặc bấm Tải lên. Hỗ trợ PDF, DOCX, TXT, Excel, PowerPoint, hình ảnh...', action: btn('Tải lên', { icon: 'upload', variant: 'primary', onClick: () => fileInput.click() }) },
        shared: { icon: 'users', title: 'Chưa có tài liệu được chia sẻ', text: 'Tài liệu thành viên chia sẻ trong nhóm UniGroup của bạn sẽ hiển thị ở đây.' },
        favorites: { icon: 'star', title: 'Chưa có mục yêu thích' },
        recent: { icon: 'clock', title: 'Chưa xem tài liệu nào gần đây' },
      }[state.view];
      body.replaceChildren(crumbs || '', emptyState(empty));
      return;
    }
    const rows = [
      ...d.folders.map((f) =>
        h(
          'tr',
          { class: 'clickable', ondblclick: () => openFolder(f.id), onclick: () => openFolder(f.id), oncontextmenu: (e) => (e.preventDefault(), folderMenu(e, f)) },
          h('td', {}, h('div', { class: 'row' }, h('div', { class: 'icon-box sm', style: { background: `${f.color || '#f59e0b'}22`, color: f.color || '#f59e0b' } }, icon('folder')), h('span', { class: 'bold truncate' }, f.name), f.favorite ? icon('star', { size: 13, className: 'fav-star' }) : null)),
          h('td', { class: 'muted small hide-sm' }, f._count ? `${f._count.files} file, ${f._count.children} thư mục` : 'Thư mục'),
          h('td', { class: 'muted small hide-sm' }, relativeTime(f.updatedAt)),
          h('td', { class: 'muted small hide-sm' }, '—'),
          h('td', { style: { width: '40px' } }, btn('', { icon: 'more', size: 'xs', variant: 'ghost', title: 'Thao tác', onClick: (e) => (e.stopPropagation(), folderMenu(e, f)) }))
        )
      ),
      ...d.files.map((f) => {
        const fi = FILE_ICONS[f.extension] || FILE_ICONS.txt;
        const ds = f.document && DOC_STATUS[f.document.status];
        return h(
          'tr',
          { class: 'clickable', onclick: () => openFile(f.id), oncontextmenu: (e) => (e.preventDefault(), fileMenu(e, f)) },
          h(
            'td',
            {},
            h(
              'div',
              { class: 'row' },
              h('div', { class: 'icon-box sm', style: { background: `${fi.color}1a`, color: fi.color } }, icon(fi.icon)),
              h(
                'div',
                { class: 'grow', style: { minWidth: 0 } },
                h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'bold truncate' }, f.originalName), f.favorite ? icon('star', { size: 13, className: 'fav-star' }) : null),
                h('div', { class: 'row wrap', style: { gap: '4px' } }, f.subject ? h('span', { class: 'badge', style: { background: `${f.subject.color}1f`, color: f.subject.color } }, f.subject.name) : null, ...f.tags.map((t) => h('span', { class: 'badge violet' }, `#${t.name}`)), ds ? h('span', { class: `badge ${ds[1]}` }, ds[0]) : null, f.sharedIn ? h('span', { class: 'badge info' }, `Nhóm ${f.sharedIn.name} · ${f.user.fullName}`) : null),
                f.match ? h('div', { class: 'tiny muted truncate' }, `…${f.match.snippet}…${f.match.pageNumber ? ` (trang ${f.match.pageNumber})` : ''}`) : null
              )
            )
          ),
          h('td', { class: 'muted small hide-sm' }, f.extension.toUpperCase()),
          h('td', { class: 'muted small hide-sm' }, relativeTime(f.updatedAt)),
          h('td', { class: 'muted small hide-sm' }, fileSize(f.size)),
          h('td', { style: { width: '40px' } }, btn('', { icon: 'more', size: 'xs', variant: 'ghost', title: 'Thao tác', onClick: (e) => (e.stopPropagation(), fileMenu(e, f)) }))
        );
      }),
    ];
    body.replaceChildren(crumbs || '', h('div', { class: 'card table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tên'), h('th', { class: 'hide-sm' }, 'Loại'), h('th', { class: 'hide-sm' }, 'Cập nhật'), h('th', { class: 'hide-sm' }, 'Kích thước'), h('th', {}, ''))), h('tbody', {}, rows))));
  }

  function openFolder(id) {
    state.folderId = id;
    state.search = '';
    searchInput.value = '';
    if (state.view !== 'my') setView('my');
    else load();
  }

  // ---------------------------------------------------------------- Upload
  async function uploadFiles(files) {
    if (!files.length) return;
    fileInput.value = '';
    const fd = new FormData();
    files.slice(0, 10).forEach((f) => fd.append('files', f));
    if (state.folderId && state.view === 'my') fd.append('folderId', state.folderId);
    if (state.subjectId) fd.append('subjectId', state.subjectId);
    const close = toast(`Đang tải lên ${files.length} file...`, 'info', { timeout: 0 });
    try {
      const res = await api.upload('/drive/upload', fd);
      close();
      toast(res.message);
      for (const r of res.data.rejected) toast.warning(`${r.name}: ${r.reason}`);
      if (files.length > 10) toast.warning('Mỗi lần chỉ tải tối đa 10 file');
      load();
      loadMeta();
    } catch (e) {
      close();
      showError(e);
    }
  }

  async function newFolder() {
    const name = await promptDialog({ title: 'Thư mục mới', label: 'Tên thư mục', placeholder: 'vd: Giải tích 1' });
    if (!name) return;
    try {
      await api.post('/drive/folders', { name, parentId: state.view === 'my' ? state.folderId : null });
      toast('Đã tạo thư mục');
      load();
    } catch (e) {
      showError(e);
    }
  }

  // ---------------------------------------------------------------- Menus
  function favToggle(type, id, current) {
    return api
      .put('/library/favorites', { entityType: type, entityId: id, favorite: !current })
      .then(() => (toast(!current ? 'Đã thêm vào yêu thích' : 'Đã bỏ yêu thích'), load()))
      .catch(showError);
  }

  function folderMenu(e, f) {
    menu(e.currentTarget?.getBoundingClientRect ? e.currentTarget : { x: e.clientX, y: e.clientY }, [
      { label: 'Mở', icon: 'folder', onClick: () => openFolder(f.id) },
      { label: f.favorite ? 'Bỏ yêu thích' : 'Yêu thích', icon: 'star', onClick: () => favToggle('FOLDER', f.id, f.favorite) },
      {
        label: 'Đổi tên',
        icon: 'edit',
        onClick: async () => {
          const name = await promptDialog({ title: 'Đổi tên thư mục', value: f.name });
          if (name) api.patch(`/drive/folders/${f.id}`, { name }).then(() => (toast('Đã đổi tên'), load())).catch(showError);
        },
      },
      { label: 'Di chuyển', icon: 'move', onClick: () => pickFolder('Di chuyển thư mục', f.id).then((target) => target !== undefined && api.patch(`/drive/folders/${f.id}`, { parentId: target }).then(() => (toast('Đã di chuyển'), load())).catch(showError)) },
      'sep',
      {
        label: 'Xóa',
        icon: 'trash',
        danger: true,
        onClick: async () => {
          if (!(await confirmDialog({ title: 'Xóa thư mục?', message: `"${f.name}" và toàn bộ nội dung bên trong sẽ được chuyển vào Thùng rác.`, danger: true, confirmText: 'Xóa' }))) return;
          api.del(`/drive/folders/${f.id}`).then(() => (toast('Đã chuyển vào thùng rác'), load())).catch(showError);
        },
      },
    ]);
  }

  function fileMenu(e, f) {
    const own = f.userId === store.get().user.id;
    menu(e.currentTarget?.getBoundingClientRect ? e.currentTarget : { x: e.clientX, y: e.clientY }, [
      { label: 'Xem chi tiết', icon: 'eye', onClick: () => openFile(f.id) },
      { label: 'Tải xuống', icon: 'download', onClick: () => download(`/drive/files/${f.id}/download`, f.originalName).catch(showError) },
      own ? { label: f.favorite ? 'Bỏ yêu thích' : 'Yêu thích', icon: 'star', onClick: () => favToggle('FILE', f.id, f.favorite) } : null,
      own ? { label: 'Đổi tên', icon: 'edit', onClick: () => renameFile(f) } : null,
      own ? { label: 'Di chuyển', icon: 'move', onClick: () => moveFile(f) } : null,
      own ? { label: 'Tạo bản sao', icon: 'copy', onClick: () => api.post(`/drive/files/${f.id}/copy`, {}).then(() => (toast('Đã sao chép'), load(), loadMeta())).catch(showError) } : null,
      own ? 'sep' : null,
      own ? { label: 'Xóa', icon: 'trash', danger: true, onClick: () => deleteFile(f) } : null,
    ]);
  }

  async function renameFile(f) {
    const name = await promptDialog({ title: 'Đổi tên file', value: f.originalName, maxLength: 255 });
    if (name) api.patch(`/drive/files/${f.id}`, { name }).then(() => (toast('Đã đổi tên'), load())).catch(showError);
  }
  async function moveFile(f) {
    const target = await pickFolder('Di chuyển file');
    if (target !== undefined) api.patch(`/drive/files/${f.id}`, { folderId: target }).then(() => (toast('Đã di chuyển'), load())).catch(showError);
  }
  async function deleteFile(f, after) {
    if (!(await confirmDialog({ title: 'Xóa file?', message: `"${f.originalName}" sẽ được chuyển vào Thùng rác. Bạn có thể khôi phục trong mục Thư viện.`, danger: true, confirmText: 'Xóa' }))) return;
    try {
      await api.del(`/drive/files/${f.id}`);
      toast('Đã chuyển vào thùng rác');
      after?.();
      load();
    } catch (e) {
      showError(e);
    }
  }

  /** Chọn thư mục đích. Trả về id | null (gốc) | undefined (hủy). */
  async function pickFolder(title, excludeId) {
    const tree = await api.get('/drive/folders/tree').catch(() => []);
    const children = (pid) => tree.filter((f) => f.parentId === pid && f.id !== excludeId);
    let chosen = null;
    const list = h('div', { class: 'list folder-pick' });
    const items = [];
    const addLevel = (pid, depth) => {
      for (const f of children(pid)) {
        const el = h('button', { class: 'list-item', style: { paddingLeft: `${12 + depth * 18}px`, width: '100%', border: 'none', background: 'none', textAlign: 'left' }, onclick: () => choose(f.id, el) }, icon('folder'), h('span', {}, f.name));
        items.push(el);
        list.append(el);
        addLevel(f.id, depth + 1);
      }
    };
    const rootEl = h('button', { class: 'list-item active-pick', style: { width: '100%', border: 'none', background: 'none', textAlign: 'left' }, onclick: () => choose(null, rootEl) }, icon('folder'), h('span', { class: 'bold' }, 'Tài liệu của tôi (gốc)'));
    items.push(rootEl);
    list.append(rootEl);
    addLevel(null, 1);
    function choose(id, el) {
      chosen = id;
      items.forEach((i) => i.classList.toggle('active-pick', i === el));
    }
    const m = modal({ title, body: list, footer: (close) => [btn('Hủy', { onClick: () => close(undefined) }), btn('Chọn', { variant: 'primary', onClick: () => close('ok') })] });
    const v = await m.promise;
    return v === 'ok' ? chosen : undefined;
  }

  // ---------------------------------------------------------------- File detail drawer
  async function openFile(id) {
    setQuery({ file: id });
    let f;
    try {
      f = await api.get(`/drive/files/${id}`);
    } catch (e) {
      setQuery({ file: null });
      return showError(e);
    }
    const own = f.isOwner;
    const previewBox = h('div', { class: 'file-preview' });
    const aiBox = h('div');
    const d = drawer({
      title: f.originalName,
      wide: true,
      onClose: () => setQuery({ file: null }),
      body: [
        h('div', { class: 'row wrap mb-16' }, h('span', { class: 'badge' }, f.extension.toUpperCase()), h('span', { class: 'badge' }, fileSize(f.size)), h('span', { class: 'badge' }, `Cập nhật ${fmtDateTime(f.updatedAt)}`), !own ? h('span', { class: 'badge info' }, `Chủ sở hữu: ${f.user.fullName}`) : null),
        f.breadcrumb?.length ? h('div', { class: 'breadcrumb' }, icon('folder', { size: 13 }), f.breadcrumb.map((b) => b.name).join(' / ')) : null,
        previewBox,
        docStatusBox(f),
        aiBox,
        own ? metaEditor(f) : null,
      ],
      footer: () => [
        btn('Tải xuống', { icon: 'download', onClick: () => download(`/drive/files/${f.id}/download`, f.originalName).catch(showError) }),
        own ? btn('', { icon: 'star', title: f.favorite ? 'Bỏ yêu thích' : 'Yêu thích', variant: f.favorite ? 'soft' : '', onClick: () => favToggle('FILE', f.id, f.favorite).then(() => d.close()) }) : null,
        own ? btn('', { icon: 'trash', title: 'Xóa', onClick: () => deleteFile(f, () => d.close()) }) : null,
        h('div', { class: 'spacer' }),
        own ? btn('Đổi tên', { icon: 'edit', onClick: () => (d.close(), renameFile(f)) }) : null,
      ],
    });
    renderPreview(f, previewBox);
    renderAi(f, aiBox);
  }

  function renderPreview(f, box) {
    const url = `/api/v1/drive/files/${f.id}/preview`;
    if (['png', 'jpg', 'gif', 'webp'].includes(f.extension)) box.append(h('img', { src: url, alt: f.originalName, style: { maxHeight: '420px', display: 'block', margin: '0 auto', borderRadius: '8px' } }));
    else if (f.extension === 'pdf') box.append(h('iframe', { src: url, title: f.originalName, style: { width: '100%', height: '460px', border: '1px solid var(--border)', borderRadius: '8px' } }));
    else if (['txt', 'md', 'csv', 'docx'].includes(f.extension)) {
      const pre = h('div', { class: 'text-preview' }, h('div', { class: 'spinner' }));
      box.append(pre);
      api
        .get(`/drive/files/${f.id}/text`)
        .then((t) => {
          if (t.status !== 'READY') pre.replaceChildren(h('div', { class: 'muted small' }, t.errorMessage || 'Nội dung đang được xử lý, hãy mở lại sau ít giây.'));
          else if (f.extension === 'md') pre.replaceChildren(renderMarkdown(t.text.slice(0, 30000)));
          else pre.replaceChildren(h('pre', {}, t.text.slice(0, 30000)), t.text.length > 30000 || t.truncated ? h('div', { class: 'tiny muted' }, '… (đã rút gọn bản xem trước)') : null);
        })
        .catch((e) => pre.replaceChildren(h('div', { class: 'muted small' }, e.message)));
    } else box.append(h('div', { class: 'alert info' }, icon('info'), 'Định dạng này chưa hỗ trợ xem trước – hãy tải xuống để mở.'));
  }

  function docStatusBox(f) {
    if (!f.document) return null;
    const s = f.document;
    const [label, tone] = DOC_STATUS[s.status] || ['—', ''];
    return h(
      'div',
      { class: 'card card-pad mt-16' },
      h('div', { class: 'row' }, h('div', { class: 'section-title', style: { margin: 0 } }, 'Xử lý văn bản'), h('span', { class: `badge ${tone}` }, label), h('div', { class: 'spacer' }), s.status === 'FAILED' && f.isOwner ? btn('Thử lại', { icon: 'refresh', size: 'xs', onClick: () => api.post(`/drive/files/${f.id}/reprocess`).then(() => (toast('Đã đưa vào hàng đợi'), load())).catch(showError) }) : null),
      s.status === 'READY' ? h('div', { class: 'small muted mt-8' }, `${s.charCount.toLocaleString('vi-VN')} ký tự${s.pageCount ? ` · ${s.pageCount} trang` : ''} · ${s.chunkCount} đoạn · ${s.embeddedCount ? `đã tạo embedding ${s.embeddedCount}/${s.chunkCount} đoạn (${s.embeddingModel})` : 'chưa tạo embedding (tìm kiếm theo từ khóa)'}`) : null,
      s.errorMessage ? h('div', { class: 'small danger-text mt-8' }, s.errorMessage) : null
    );
  }

  function renderAi(f, box) {
    const ai = store.get().aiConfigured;
    const ready = f.document?.status === 'READY';
    const out = h('div', { class: 'mt-8' });
    if (!f.document) return;
    const run = (action) => async (e) => {
      await withLoading(e.currentTarget, async () => {
        try {
          const r = await api.post(`/drive/files/${f.id}/ai`, { action });
          if (action === 'classify') {
            const sg = r.suggestion;
            out.replaceChildren(
              h(
                'div',
                { class: 'card card-pad' },
                h('div', { class: 'bold mb-8' }, 'Gợi ý phân loại'),
                h('div', { class: 'small' }, 'Môn học: ', h('b', {}, sg.subjectName || 'Không xác định'), sg.subjectId ? '' : ' (chưa có trong danh sách môn của bạn)'),
                h('div', { class: 'small' }, 'Loại tài liệu: ', sg.documentType || '—'),
                h('div', { class: 'row wrap mt-8' }, sg.tags.map((t) => h('span', { class: 'badge violet' }, `#${t}`))),
                sg.reason ? h('div', { class: 'tiny muted mt-8' }, sg.reason) : null,
                h('div', { class: 'tiny muted mt-8' }, r.note),
                btn('Áp dụng', {
                  size: 'sm',
                  variant: 'primary',
                  icon: 'check',
                  onClick: async () => {
                    try {
                      await api.patch(`/drive/files/${f.id}`, { ...(sg.subjectId ? { subjectId: sg.subjectId } : {}), tags: [...new Set([...f.tags.map((t) => t.name), ...sg.tags])].slice(0, 10) });
                      toast('Đã áp dụng phân loại');
                      load();
                    } catch (err) {
                      showError(err);
                    }
                  },
                })
              )
            );
          } else out.replaceChildren(h('div', { class: 'card card-pad' }, h('div', { class: 'ai-tag mb-8' }, icon('sparkles'), r.title), renderMarkdown(r.content), r.truncated ? h('div', { class: 'tiny muted mt-8' }, 'Tài liệu dài – AI chỉ đọc phần đầu tài liệu.') : null));
        } catch (err) {
          showError(err);
        }
      });
    };
    const question = h('input', { class: 'input sm grow', placeholder: 'Đặt câu hỏi về tài liệu này...' });
    const askBtn = btn('Hỏi', { icon: 'send', size: 'sm', variant: 'primary' });
    const ask = () =>
      withLoading(askBtn, async () => {
        if (question.value.trim().length < 2) return;
        try {
          const r = await api.post('/drive/ask', { fileIds: [f.id], question: question.value.trim() });
          out.replaceChildren(answerCard(r));
        } catch (err) {
          showError(err);
        }
      });
    askBtn.addEventListener('click', ask);
    question.addEventListener('keydown', (e) => e.key === 'Enter' && ask());
    box.replaceChildren(
      h(
        'div',
        { class: 'ai-box mt-16' },
        h('div', { class: 'row mb-8' }, h('span', { class: 'ai-tag' }, icon('sparkles'), 'UniAI cho tài liệu'), h('div', { class: 'spacer' }), f.isOwner && ai && ready && !f.document.embeddedCount ? btn('Bật hỏi đáp ngữ nghĩa', { size: 'xs', icon: 'zap', title: 'Gửi nội dung các đoạn tới AI provider để tạo embedding', onClick: (e) => enableEmbeddings(e, f) }) : null),
        !ai
          ? h('div', { class: 'small muted' }, 'AI chưa được cấu hình trên máy chủ. Các chức năng AI tạm thời không khả dụng.')
          : !ready
            ? h('div', { class: 'small muted' }, 'Tài liệu cần được trích xuất văn bản xong trước khi dùng AI.')
            : [
                h('div', { class: 'row wrap' }, btn('Tóm tắt', { size: 'sm', onClick: run('summarize') }), btn('Ý chính', { size: 'sm', onClick: run('keypoints') }), btn('Giải thích', { size: 'sm', onClick: run('explain') }), f.isOwner ? btn('Phân loại', { size: 'sm', onClick: run('classify') }) : null, btn('Tạo quiz', { size: 'sm', icon: 'quiz', onClick: () => import('../core/router.js').then((r) => r.navigate(`/quiz?generate=${f.id}`)) })),
                h('div', { class: 'row mt-8' }, question, askBtn),
                h('div', { class: 'tiny muted mt-8' }, 'Chỉ khi bạn bấm, nội dung tài liệu (hoặc các đoạn liên quan) mới được gửi tới AI provider đã cấu hình.'),
                out,
              ]
      )
    );
  }

  async function enableEmbeddings(e, f) {
    if (!(await confirmDialog({ title: 'Tạo embedding cho tài liệu?', message: `Nội dung ${f.document.chunkCount} đoạn văn bản sẽ được gửi tới AI provider để tạo vector, giúp hỏi đáp theo ngữ nghĩa chính xác hơn. Thao tác tính vào hạn mức AI.`, confirmText: 'Tạo embedding' }))) return;
    const b = e.target.closest('button');
    await withLoading(b, async () => {
      try {
        await api.post(`/drive/files/${f.id}/embeddings`);
        toast('Đã tạo embedding – hỏi đáp sẽ dùng tìm kiếm ngữ nghĩa');
        load();
      } catch (err) {
        showError(err);
      }
    });
  }

  function metaEditor(f) {
    const subj = select([{ value: '', label: '— Không gắn môn —' }, ...state.subjects.map((s) => ({ value: s.id, label: s.name }))], f.subjectId || '');
    const tags = h('input', { class: 'input', value: f.tags.map((t) => t.name).join(', '), placeholder: 'vd: chương1, đề cương' });
    const desc = h('textarea', { class: 'textarea', rows: 2, value: f.description || '' });
    return h(
      'div',
      { class: 'card card-pad mt-16' },
      h('div', { class: 'section-title' }, 'Phân loại'),
      field('Môn học', subj),
      field('Nhãn (phân tách bằng dấu phẩy)', tags),
      field('Mô tả', desc),
      btn('Lưu phân loại', {
        size: 'sm',
        variant: 'primary',
        onClick: async (e) =>
          withLoading(e.currentTarget, async () => {
            try {
              await api.patch(`/drive/files/${f.id}`, { subjectId: subj.value || null, tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean), description: desc.value });
              toast('Đã lưu');
              load();
              loadMeta();
            } catch (err) {
              showError(err);
            }
          }),
      })
    );
  }

  // ---------------------------------------------------------------- Hỏi đáp nhiều tài liệu
  async function askDocs() {
    if (!store.get().aiConfigured) return toast.warning('AI chưa được cấu hình trên máy chủ');
    const data = await api.get('/drive', { view: 'my', sort: 'date', type: 'document' }).catch(() => ({ files: [] }));
    const ready = (await api.get('/drive', { view: 'shared' }).catch(() => ({ files: [] }))).files.concat(data.files).filter((f) => f.document?.status === 'READY');
    const allFiles = [];
    const seen = new Set();
    for (const f of ready) if (!seen.has(f.id)) seen.add(f.id) && allFiles.push(f);
    if (!allFiles.length) return toast.warning('Chưa có tài liệu nào đã trích xuất văn bản (PDF/DOCX/TXT)');
    const checks = allFiles.slice(0, 50).map((f) => ({ f, cb: h('input', { type: 'checkbox' }) }));
    const question = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Câu hỏi của bạn...' });
    const out = h('div', { class: 'mt-16' });
    modal({
      title: 'Hỏi đáp dựa trên tài liệu',
      icon: 'sparkles',
      size: 'wide',
      body: [h('div', { class: 'section-title' }, 'Chọn tài liệu (tối đa 10)'), h('div', { class: 'doc-pick' }, checks.map(({ f, cb }) => h('label', { class: 'checkbox small' }, cb, f.originalName))), field('Câu hỏi', question), out],
      footer: (close) => [
        btn('Đóng', { onClick: () => close() }),
        btn('Hỏi', {
          icon: 'send',
          variant: 'primary',
          onClick: async (e) => {
            const ids = checks.filter((c) => c.cb.checked).map((c) => c.f.id).slice(0, 10);
            if (!ids.length) return toast.error('Chọn ít nhất 1 tài liệu');
            if (question.value.trim().length < 2) return toast.error('Nhập câu hỏi');
            await withLoading(e.currentTarget, async () => {
              try {
                out.replaceChildren(answerCard(await api.post('/drive/ask', { fileIds: ids, question: question.value.trim() })));
              } catch (err) {
                showError(err);
              }
            });
          },
        }),
      ],
    });
  }

  loadMeta();
  load().then(() => {
    if (q.file) openFile(Number(q.file));
    if (q.upload) fileInput.click();
  });

  return () => {
    clearTimeout(pollTimer);
    window.removeEventListener('dragenter', onDragEnter);
    window.removeEventListener('dragleave', onDragLeave);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('drop', onDrop);
  };
}

/** Thẻ câu trả lời RAG kèm nguồn tham chiếu */
export function answerCard(r) {
  const sources = h('div', { class: 'col', style: { gap: '6px' } });
  const highlight = (n) => sources.querySelector(`[data-ref="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return h(
    'div',
    { class: 'card card-pad' },
    h('div', { class: 'row mb-8' }, h('span', { class: 'ai-tag' }, icon('sparkles'), 'Câu trả lời'), h('span', { class: `badge ${r.method === 'semantic' ? 'violet' : ''}` }, r.method === 'semantic' ? 'Truy xuất ngữ nghĩa (embedding)' : 'Truy xuất theo từ khóa')),
    renderMarkdown(r.answer, { onCite: highlight }),
    r.sources?.length
      ? [
          h('div', { class: 'section-title mt-16' }, 'Nguồn tham chiếu'),
          sources,
          ...r.sources.map((s) => {
            sources.append(h('div', { class: 'source-item', 'data-ref': s.ref }, h('div', { class: 'row small' }, h('span', { class: 'badge primary' }, s.ref), h('a', { href: `/drive?file=${s.fileId}`, class: 'bold truncate' }, s.fileName), h('span', { class: 'muted tiny' }, [s.pageNumber ? `trang ${s.pageNumber}` : null, `đoạn ${s.chunkIndex + 1}`].filter(Boolean).join(' · '))), h('div', { class: 'tiny muted' }, `“${s.excerpt}…”`)));
            return null;
          }),
        ]
      : null
  );
}
