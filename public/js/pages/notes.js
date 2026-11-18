import { h, icon, btn, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate, query, addLeaveGuard } from '../core/router.js';
import { store, pref, setPref } from '../core/store.js';
import { toast, showError, modal, confirmDialog, menu, emptyState, errorState, skeleton, select, withLoading } from '../core/ui.js';
import { relativeTime } from '../core/format.js';
import { renderMarkdown } from '../core/markdown.js';

const TYPES = {
  paragraph: { label: 'Văn bản', icon: 'align-left' },
  heading1: { label: 'Tiêu đề 1', icon: 'heading', md: '# ' },
  heading2: { label: 'Tiêu đề 2', icon: 'heading', md: '## ' },
  heading3: { label: 'Tiêu đề 3', icon: 'heading', md: '### ' },
  bullet: { label: 'Danh sách', icon: 'list', md: '- ' },
  numbered: { label: 'Danh sách số', icon: 'list-ordered', md: '1. ' },
  todo: { label: 'Checklist', icon: 'check-circle', md: '[] ' },
  quote: { label: 'Trích dẫn', icon: 'quote', md: '> ' },
  callout: { label: 'Ghi chú nổi bật', icon: 'info' },
  code: { label: 'Code', icon: 'code', md: '```' },
  table: { label: 'Bảng', icon: 'table' },
  image: { label: 'Hình ảnh', icon: 'image' },
  link: { label: 'Liên kết', icon: 'link' },
  divider: { label: 'Đường kẻ', icon: 'minus', md: '---' },
};
const TEXT_TYPES = new Set(['paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'code']);
const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function mount(container, { params }) {
  const q = query();
  const currentId = params.id ? Number(params.id) : null;
  const state = { notes: [], subjects: [], search: '', expanded: new Set(pref('notes.expanded', [])) };
  let editor = null;

  const searchInput = h('input', { class: 'input sm', placeholder: 'Tìm ghi chú...' });
  searchInput.addEventListener('input', debounce(() => ((state.search = searchInput.value.trim()), loadTree()), 300));
  const tree = h('div', { class: 'note-tree' }, skeleton(6));
  const main = h('div', { class: 'note-main' });
  const sidebarEl = h(
    'aside',
    { class: 'note-sidebar' },
    h('div', { class: 'row mb-8' }, h('h2', { class: 'grow' }, 'UniNote'), btn('', { icon: 'plus', size: 'sm', variant: 'primary', title: 'Trang mới', onClick: () => createNote() })),
    h('div', { class: 'input-icon mb-8' }, icon('search'), searchInput),
    tree
  );
  container.append(h('div', { class: 'notes-layout' }, sidebarEl, main));

  async function loadTree() {
    try {
      state.notes = await api.get('/notes', { search: state.search || undefined, subjectId: q.subject });
      renderTree();
    } catch (e) {
      tree.replaceChildren(errorState(e, loadTree));
    }
  }

  function renderTree() {
    if (!state.notes.length) {
      tree.replaceChildren(emptyState({ icon: 'note', title: state.search ? 'Không tìm thấy' : 'Chưa có ghi chú', compact: true, action: state.search ? null : btn('Tạo trang đầu tiên', { size: 'sm', variant: 'soft', icon: 'plus', onClick: () => createNote() }) }));
      return;
    }
    if (state.search) {
      tree.replaceChildren(...state.notes.map((n) => h('a', { class: `tree-item ${n.id === currentId ? 'active' : ''}`, href: `/notes/${n.id}` }, h('span', { class: 'tree-icon' }, n.icon || '📄'), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'truncate' }, n.title || 'Không tiêu đề'), n.snippet ? h('div', { class: 'tiny muted truncate' }, n.snippet) : null))));
      return;
    }
    const byParent = new Map();
    for (const n of state.notes) {
      const k = n.parentId ?? 0;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(n);
    }
    // Ghi chú có cha không nằm trong danh sách (vd lọc theo môn) => hiển thị ở gốc
    const ids = new Set(state.notes.map((n) => n.id));
    for (const n of state.notes) if (n.parentId && !ids.has(n.parentId)) byParent.get(0)?.push(n) ?? byParent.set(0, [n]);
    // Mở rộng tổ tiên của trang hiện tại
    let cur = state.notes.find((n) => n.id === currentId);
    while (cur?.parentId) {
      state.expanded.add(cur.parentId);
      cur = state.notes.find((n) => n.id === cur.parentId);
    }
    const favs = state.notes.filter((n) => n.favorite);
    const renderLevel = (pid, depth) =>
      (byParent.get(pid) || []).flatMap((n) => {
        const kids = byParent.get(n.id) || [];
        const open = state.expanded.has(n.id);
        const row = h(
          'div',
          { class: `tree-item ${n.id === currentId ? 'active' : ''}`, style: { paddingLeft: `${6 + depth * 14}px` } },
          h(
            'button',
            {
              class: `tree-toggle ${kids.length ? '' : 'invisible'}`,
              'aria-label': open ? 'Thu gọn' : 'Mở rộng',
              onclick: (e) => {
                e.stopPropagation();
                open ? state.expanded.delete(n.id) : state.expanded.add(n.id);
                setPref('notes.expanded', [...state.expanded]);
                renderTree();
              },
            },
            icon(open ? 'chevron-down' : 'chevron-right', { size: 13 })
          ),
          h('a', { class: 'grow row', href: `/notes/${n.id}`, style: { minWidth: 0, gap: '6px', color: 'inherit', textDecoration: 'none' } }, h('span', { class: 'tree-icon' }, n.icon || '📄'), h('span', { class: 'truncate' }, n.title || 'Không tiêu đề')),
          h(
            'button',
            { class: 'tree-add', title: 'Thêm trang con', onclick: (e) => (e.stopPropagation(), createNote(n.id)) },
            icon('plus', { size: 13 })
          )
        );
        return [row, ...(open ? renderLevel(n.id, depth + 1) : [])];
      });
    tree.replaceChildren(
      favs.length ? h('div', { class: 'tree-section' }, 'Yêu thích') : '',
      ...favs.map((n) => h('a', { class: `tree-item ${n.id === currentId ? 'active' : ''}`, href: `/notes/${n.id}` }, h('span', { class: 'tree-icon' }, n.icon || '📄'), h('span', { class: 'truncate' }, n.title || 'Không tiêu đề'))),
      h('div', { class: 'tree-section' }, 'Tất cả trang'),
      ...renderLevel(0, 0)
    );
  }

  async function createNote(parentId) {
    try {
      const n = await api.post('/notes', { title: '', parentId: parentId ?? null, subjectId: q.subject || undefined });
      if (parentId) state.expanded.add(parentId);
      navigate(`/notes/${n.id}`);
    } catch (e) {
      showError(e);
    }
  }

  async function loadNote() {
    if (!currentId) {
      main.replaceChildren(emptyState({ icon: 'note', title: 'Chọn hoặc tạo một trang', text: 'Ghi chú dạng khối: tiêu đề, danh sách, checklist, bảng, code, hình ảnh... Gõ "/" để chèn khối, tự động lưu.', action: btn('Trang mới', { icon: 'plus', variant: 'primary', onClick: () => createNote() }) }));
      if (q.new) createNote();
      return;
    }
    main.replaceChildren(h('div', { class: 'note-editor-wrap' }, skeleton(8)));
    try {
      const [note, subjects] = await Promise.all([api.get(`/notes/${currentId}`), api.get('/schedules/subjects/options').catch(() => [])]);
      state.subjects = subjects;
      editor = createEditor(note);
      main.replaceChildren(editor.el);
    } catch (e) {
      main.replaceChildren(errorState(e, loadNote));
    }
  }

  // =====================================================================
  // Editor
  // =====================================================================
  function createEditor(note) {
    const canEdit = note.canEdit;
    let blocks = (note.content?.blocks || []).map((b) => ({ ...b }));
    if (!blocks.length) blocks = [{ id: uid(), type: 'paragraph', text: '' }];
    let version = note.version;
    let dirty = false;
    let saving = false;
    let pendingAgain = false;
    const draftKey = `universe.noteDraft.${note.id}`;

    const statusEl = h('span', { class: 'save-status tiny muted' }, canEdit ? 'Đã lưu' : 'Chỉ xem');
    const setStatus = (t, tone = '') => {
      statusEl.textContent = t;
      statusEl.className = `save-status tiny ${tone || 'muted'}`;
    };

    const iconBtn = h('button', { class: 'note-icon-btn', title: 'Đổi biểu tượng', disabled: !canEdit, onclick: () => pickIcon() }, note.icon || '📄');
    const title = h('textarea', { class: 'note-title', rows: 1, placeholder: 'Không tiêu đề', value: note.title || '', readOnly: !canEdit, maxlength: 255 });
    const autoGrow = () => {
      title.style.height = 'auto';
      title.style.height = `${title.scrollHeight}px`;
    };
    title.addEventListener('input', () => (autoGrow(), changed()));
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        focusBlock(0, 'start');
      }
    });
    const blocksEl = h('div', { class: 'note-blocks' });

    // ------------------------------------------------- Save
    function snapshot() {
      return { title: title.value, icon: note.icon || null, content: { blocks: blocks.map(clean) } };
    }
    function clean(b) {
      const o = { id: b.id, type: b.type, text: b.text || '' };
      if (b.type === 'todo') o.checked = Boolean(b.checked);
      if (b.type === 'code' && b.language) o.language = b.language;
      if (b.type === 'link') o.url = b.url || '';
      if (b.type === 'image') {
        if (b.fileId) o.fileId = b.fileId;
        o.caption = b.caption || '';
      }
      if (b.type === 'table') o.rows = b.rows || [['', ''], ['', '']];
      return o;
    }
    function changed() {
      if (!canEdit) return;
      dirty = true;
      setStatus('Chưa lưu...', 'muted');
      try {
        localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), version, data: snapshot() }));
      } catch {
        /* ignore */
      }
      saveSoon();
    }
    const saveSoon = debounce(() => save(), 900);
    async function save() {
      if (!dirty || !canEdit) return;
      if (saving) {
        pendingAgain = true;
        return;
      }
      saving = true;
      dirty = false;
      setStatus('Đang lưu...', 'muted');
      try {
        const r = await api.patch(`/notes/${note.id}`, { ...snapshot(), version });
        version = r.version;
        setStatus(`Đã lưu ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`, 'success-text');
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* ignore */
        }
        const item = state.notes.find((n) => n.id === note.id);
        if (item && (item.title !== r.title || item.icon !== r.icon)) {
          item.title = r.title;
          item.icon = r.icon;
          renderTree();
        }
      } catch (e) {
        dirty = true;
        if (e.code === 'VERSION_CONFLICT') {
          setStatus('Xung đột phiên bản', 'danger-text');
          resolveConflict();
        } else {
          setStatus('Lưu thất bại – sẽ thử lại', 'danger-text');
          setTimeout(save, 5000);
        }
      } finally {
        saving = false;
        if (pendingAgain) {
          pendingAgain = false;
          save();
        }
      }
    }
    async function resolveConflict() {
      const m = modal({
        title: 'Ghi chú đã thay đổi ở nơi khác',
        icon: 'alert',
        body: h('p', { class: 'muted' }, 'Trang này vừa được lưu từ một tab hoặc thiết bị khác. Bạn muốn giữ bản nào? (Bản đang soạn đã được sao lưu tạm trên trình duyệt.)'),
        dismissible: false,
        footer: (close) => [btn('Tải bản mới nhất', { onClick: () => close('reload') }), btn('Ghi đè bằng bản của tôi', { variant: 'danger', onClick: () => close('overwrite') })],
      });
      const choice = await m.promise;
      if (choice === 'reload') {
        dirty = false;
        loadNote();
      } else {
        const latest = await api.get(`/notes/${note.id}`);
        version = latest.version;
        dirty = true;
        save();
      }
    }

    // Khôi phục bản nháp cục bộ nếu lần trước lưu thất bại
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw && canEdit) {
        const draft = JSON.parse(raw);
        if (draft.version === note.version && JSON.stringify(draft.data.content) !== JSON.stringify({ blocks: blocks.map(clean) })) {
          setTimeout(async () => {
            if (await confirmDialog({ title: 'Khôi phục bản nháp chưa lưu?', message: `Có nội dung chưa được lưu lên máy chủ từ ${relativeTime(draft.at)}. Khôi phục bản nháp này?`, confirmText: 'Khôi phục', cancelText: 'Bỏ qua' })) {
              title.value = draft.data.title;
              blocks = draft.data.content.blocks;
              renderBlocks();
              changed();
            } else localStorage.removeItem(draftKey);
          }, 200);
        } else if (draft.version !== note.version) localStorage.removeItem(draftKey);
      }
    } catch {
      /* ignore */
    }

    // ------------------------------------------------- Blocks render
    function renderBlocks() {
      let num = 0;
      blocksEl.replaceChildren(
        ...blocks.map((b, i) => {
          num = b.type === 'numbered' ? num + 1 : 0;
          return renderBlock(b, i, num);
        })
      );
    }

    function renderBlock(b, i, num) {
      const row = h('div', { class: `nb nb-${b.type}`, 'data-id': b.id });
      const handle = canEdit ? h('button', { class: 'nb-handle', title: 'Thao tác khối', 'aria-label': 'Thao tác khối', onclick: (e) => blockMenu(e.currentTarget, b) }, icon('grip', { size: 14 })) : null;
      let content;
      if (TEXT_TYPES.has(b.type)) {
        content = h('div', { class: 'nb-text', contenteditable: canEdit ? 'true' : 'false', spellcheck: b.type !== 'code', 'data-placeholder': i === 0 && blocks.length === 1 ? 'Gõ "/" để chèn khối, hoặc bắt đầu viết...' : b.type === 'paragraph' ? '' : TYPES[b.type].label });
        content.textContent = b.text || '';
        attachTextHandlers(content, b);
        if (b.type === 'todo') {
          const cb = h('input', { type: 'checkbox', checked: b.checked, disabled: !canEdit, onchange: (e) => ((b.checked = e.target.checked), row.classList.toggle('done', b.checked), changed()) });
          row.classList.toggle('done', Boolean(b.checked));
          content = h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '8px' } }, cb, content);
        } else if (b.type === 'bullet') content = h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '8px' } }, h('span', { class: 'nb-bullet' }, '•'), content);
        else if (b.type === 'numbered') content = h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '8px' } }, h('span', { class: 'nb-num' }, `${num}.`), content);
        else if (b.type === 'code') {
          const lang = h('input', { class: 'nb-lang', value: b.language || '', placeholder: 'ngôn ngữ', readOnly: !canEdit, oninput: (e) => ((b.language = e.target.value.slice(0, 30)), changed()) });
          content = h('div', { class: 'nb-code-wrap' }, h('div', { class: 'row nb-code-bar' }, lang, h('div', { class: 'spacer' }), btn('Sao chép', { size: 'xs', variant: 'ghost', onClick: () => navigator.clipboard.writeText(b.text || '').then(() => toast('Đã sao chép')) }), store.get().aiConfigured ? btn('Giải thích code', { size: 'xs', variant: 'ghost', icon: 'sparkles', onClick: () => runAi('explainCode', b.text) }) : null), content);
        }
      } else if (b.type === 'divider') content = h('hr', { class: 'nb-hr' });
      else if (b.type === 'table') content = renderTable(b);
      else if (b.type === 'image') content = renderImage(b);
      else if (b.type === 'link') content = renderLink(b);
      row.append(handle || '', h('div', { class: 'nb-body' }, content));
      return row;
    }

    function renderTable(b) {
      b.rows = b.rows?.length ? b.rows : [['', ''], ['', '']];
      const table = h(
        'table',
        { class: 'nb-table' },
        h(
          'tbody',
          {},
          b.rows.map((r, ri) =>
            h(
              'tr',
              {},
              r.map((c, ci) => {
                const td = h('td', { contenteditable: canEdit ? 'true' : 'false', class: ri === 0 ? 'th' : '' });
                td.textContent = c;
                td.addEventListener('input', () => ((b.rows[ri][ci] = td.innerText.replace(/\n$/, '')), changed()));
                td.addEventListener('paste', pastePlain);
                return td;
              })
            )
          )
        )
      );
      const tools = canEdit
        ? h(
            'div',
            { class: 'row nb-table-tools' },
            btn('Hàng', { icon: 'plus', size: 'xs', variant: 'ghost', onClick: () => (b.rows.push(b.rows[0].map(() => '')), changed(), renderBlocks()) }),
            btn('Cột', { icon: 'plus', size: 'xs', variant: 'ghost', onClick: () => (b.rows.forEach((r) => r.length < 20 && r.push('')), changed(), renderBlocks()) }),
            b.rows.length > 1 ? btn('Bỏ hàng cuối', { size: 'xs', variant: 'ghost', onClick: () => (b.rows.pop(), changed(), renderBlocks()) }) : null,
            b.rows[0].length > 1 ? btn('Bỏ cột cuối', { size: 'xs', variant: 'ghost', onClick: () => (b.rows.forEach((r) => r.pop()), changed(), renderBlocks()) }) : null
          )
        : null;
      return h('div', { class: 'nb-table-wrap' }, table, tools);
    }

    function renderImage(b) {
      if (!b.fileId) {
        const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
        const zone = h('div', { class: 'dropzone', onclick: () => canEdit && input.click() }, icon('image'), h('div', { class: 'small' }, canEdit ? 'Bấm để chọn ảnh (PNG, JPG, GIF, WEBP – tối đa 8 MB)' : 'Ảnh trống'));
        input.addEventListener('change', async () => {
          if (!input.files[0]) return;
          const fd = new FormData();
          fd.append('image', input.files[0]);
          zone.replaceChildren(h('div', { class: 'spinner', style: { margin: '0 auto' } }));
          try {
            const r = await api.upload(`/notes/${note.id}/images`, fd);
            b.fileId = r.data.fileId;
            changed();
            renderBlocks();
          } catch (e) {
            showError(e);
            renderBlocks();
          }
        });
        return h('div', {}, zone, input);
      }
      const cap = h('input', { class: 'nb-caption', value: b.caption || '', placeholder: 'Chú thích ảnh...', readOnly: !canEdit, oninput: (e) => ((b.caption = e.target.value.slice(0, 500)), changed()) });
      return h('figure', { class: 'nb-figure' }, h('img', { src: `/api/v1/notes/${note.id}/images/${b.fileId}`, alt: b.caption || 'Ảnh trong ghi chú', loading: 'lazy' }), cap);
    }

    function renderLink(b) {
      if (!canEdit || (b.url && !b._editing)) {
        let host = '';
        try {
          host = new URL(b.url).host;
        } catch {
          /* ignore */
        }
        return h('div', { class: 'nb-link-card' }, icon('external'), h('a', { href: b.url || '#', target: '_blank', rel: 'noopener noreferrer', class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'bold truncate' }, b.text || b.url), h('div', { class: 'tiny muted truncate' }, host)), canEdit ? btn('', { icon: 'edit', size: 'xs', variant: 'ghost', title: 'Sửa liên kết', onClick: () => ((b._editing = true), renderBlocks()) }) : null);
      }
      const text = h('input', { class: 'input sm', placeholder: 'Tiêu đề liên kết', value: b.text || '' });
      const url = h('input', { class: 'input sm', placeholder: 'https://...', value: b.url || '' });
      const ok = () => {
        if (url.value && !/^https?:\/\//i.test(url.value)) return toast.error('Liên kết phải bắt đầu bằng http:// hoặc https://');
        b.text = text.value;
        b.url = url.value;
        delete b._editing;
        changed();
        renderBlocks();
      };
      url.addEventListener('keydown', (e) => e.key === 'Enter' && ok());
      setTimeout(() => url.focus(), 20);
      return h('div', { class: 'row wrap nb-link-edit' }, h('div', { class: 'grow', style: { minWidth: '160px' } }, text), h('div', { class: 'grow', style: { minWidth: '200px' } }, url), btn('Xong', { size: 'sm', variant: 'primary', onClick: ok }));
    }

    function pastePlain(e) {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    }

    // ------------------------------------------------- Keyboard & markdown shortcuts
    function attachTextHandlers(el, b) {
      el.addEventListener('paste', (e) => {
        const text = e.clipboardData.getData('text/plain');
        if (b.type !== 'code' && text.includes('\n') && text.split('\n').length > 1) {
          // Dán nhiều dòng => tạo nhiều khối
          e.preventDefault();
          const lines = text.replace(/\r/g, '').split('\n');
          document.execCommand('insertText', false, lines[0]);
          b.text = el.innerText;
          const idx = blocks.indexOf(b);
          const extra = lines.slice(1).map((l) => mdLineToBlock(l));
          blocks.splice(idx + 1, 0, ...extra);
          changed();
          renderBlocks();
          focusBlock(idx + extra.length, 'end');
          return;
        }
        pastePlain(e);
      });
      el.addEventListener('input', () => {
        b.text = el.innerText.replace(/\n$/, '');
        if (b.type === 'paragraph') {
          for (const [type, def] of Object.entries(TYPES)) {
            if (!def.md) continue;
            if (b.text === def.md.trimEnd() + (def.md.endsWith(' ') ? ' ' : '') || b.text.startsWith(def.md) || (def.md.endsWith(' ') && b.text.startsWith(def.md.trimEnd() + ' '))) {
              if (type === 'divider' && b.text !== '---') continue;
              if (type === 'code' && !b.text.startsWith('```')) continue;
              const rest = b.text.slice(def.md.length).replace(/^ /, '');
              convert(b, type, type === 'divider' ? '' : rest);
              return;
            }
          }
        }
        changed();
      });
      el.addEventListener('keydown', (e) => onKey(e, el, b));
    }

    function onKey(e, el, b) {
      const idx = blocks.indexOf(b);
      const sel = window.getSelection();
      const atStart = sel.rangeCount && sel.getRangeAt(0).collapsed && caretOffset(el) === 0;
      const atEnd = sel.rangeCount && caretOffset(el) >= el.innerText.replace(/\n$/, '').length;
      if (e.key === '/' && !el.innerText.trim()) {
        e.preventDefault();
        slashMenu(el, b);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !(b.type === 'code' && !e.ctrlKey)) {
        e.preventDefault();
        if (['bullet', 'numbered', 'todo'].includes(b.type) && !b.text.trim()) return convert(b, 'paragraph', '');
        const { before, after } = splitAtCaret(el);
        b.text = before;
        const nextType = ['bullet', 'numbered', 'todo'].includes(b.type) ? b.type : 'paragraph';
        blocks.splice(idx + 1, 0, { id: uid(), type: nextType, text: after, checked: false });
        changed();
        renderBlocks();
        focusBlock(idx + 1, 'start');
        return;
      }
      if (e.key === 'Backspace' && atStart) {
        if (b.type !== 'paragraph') {
          e.preventDefault();
          return convert(b, 'paragraph', b.text);
        }
        if (idx > 0) {
          const prev = blocks[idx - 1];
          e.preventDefault();
          if (TEXT_TYPES.has(prev.type)) {
            const pos = (prev.text || '').length;
            prev.text = (prev.text || '') + (b.text || '');
            blocks.splice(idx, 1);
            changed();
            renderBlocks();
            focusBlock(idx - 1, pos);
          } else {
            blocks.splice(idx - 1, 1);
            changed();
            renderBlocks();
            focusBlock(idx - 1, 'start');
          }
        }
        return;
      }
      if (e.key === 'ArrowUp' && atStart && idx > 0) {
        e.preventDefault();
        focusBlock(idx - 1, 'end');
      }
      if (e.key === 'ArrowDown' && atEnd && idx < blocks.length - 1) {
        e.preventDefault();
        focusBlock(idx + 1, 'start');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveSoon.flush();
      }
      if (b.type === 'code' && e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      }
    }

    function caretOffset(el) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return 0;
      const r = sel.getRangeAt(0).cloneRange();
      r.selectNodeContents(el);
      r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
      return r.toString().length;
    }
    function splitAtCaret(el) {
      const full = el.innerText.replace(/\n$/, '');
      const off = caretOffset(el);
      return { before: full.slice(0, off), after: full.slice(off) };
    }
    function focusBlock(i, where = 'end') {
      const b = blocks[i];
      if (!b) return;
      const el = blocksEl.querySelector(`[data-id="${b.id}"] .nb-text`);
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      if (typeof where === 'number') {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let remaining = where;
        let node;
        while ((node = walker.nextNode())) {
          if (remaining <= node.length) {
            range.setStart(node, remaining);
            break;
          }
          remaining -= node.length;
        }
        if (!node) {
          range.selectNodeContents(el);
          range.collapse(false);
        }
      } else {
        range.selectNodeContents(el);
        range.collapse(where === 'start');
      }
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function convert(b, type, text) {
      b.type = type;
      b.text = text ?? b.text;
      const idx = blocks.indexOf(b);
      if (type === 'divider') blocks.splice(idx + 1, 0, { id: uid(), type: 'paragraph', text: '' });
      if (type === 'table') b.rows = [['', '', ''], ['', '', ''], ['', '', '']];
      changed();
      renderBlocks();
      if (TEXT_TYPES.has(type)) focusBlock(idx, 'end');
      else if (type === 'divider') focusBlock(idx + 1, 'start');
    }

    function slashMenu(el, b) {
      menu(
        el,
        [{ header: 'Chèn khối' }, ...Object.entries(TYPES).map(([type, def]) => ({ label: def.label, icon: def.icon, hint: def.md?.trim(), onClick: () => convert(b, type, '') }))],
        {}
      );
    }

    function blockMenu(anchor, b) {
      const idx = blocks.indexOf(b);
      menu(anchor, [
        { header: 'Chuyển thành' },
        ...['paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'code']
          .filter((t) => TEXT_TYPES.has(b.type) && t !== b.type)
          .map((t) => ({ label: TYPES[t].label, icon: TYPES[t].icon, onClick: () => convert(b, t, b.text) })),
        'sep',
        { label: 'Chèn khối bên dưới', icon: 'plus', onClick: () => (blocks.splice(idx + 1, 0, { id: uid(), type: 'paragraph', text: '' }), changed(), renderBlocks(), focusBlock(idx + 1)) },
        { label: 'Lên trên', icon: 'chevron-up', disabled: idx === 0, onClick: () => ([blocks[idx - 1], blocks[idx]] = [blocks[idx], blocks[idx - 1]], changed(), renderBlocks()) },
        { label: 'Xuống dưới', icon: 'chevron-down', disabled: idx === blocks.length - 1, onClick: () => ([blocks[idx + 1], blocks[idx]] = [blocks[idx], blocks[idx + 1]], changed(), renderBlocks()) },
        { label: 'Nhân bản', icon: 'copy', onClick: () => (blocks.splice(idx + 1, 0, { ...JSON.parse(JSON.stringify(b)), id: uid() }), changed(), renderBlocks()) },
        'sep',
        {
          label: 'Xóa khối',
          icon: 'trash',
          danger: true,
          onClick: () => {
            blocks.splice(idx, 1);
            if (!blocks.length) blocks.push({ id: uid(), type: 'paragraph', text: '' });
            changed();
            renderBlocks();
          },
        },
      ]);
    }

    // ------------------------------------------------- Header toolbar
    const subjSel = select([{ value: '', label: 'Không gắn môn' }, ...state.subjects.map((s) => ({ value: s.id, label: s.name }))], note.subjectId || '', {
      size: 'sm',
      disabled: !canEdit,
      style: { width: 'auto', maxWidth: '200px' },
      onchange: async (e) => {
        await saveSoon.flush();
        try {
          const r = await api.patch(`/notes/${note.id}`, { subjectId: e.target.value || null, version });
          version = r.version;
          toast('Đã gắn môn học');
        } catch (err) {
          showError(err);
        }
      },
    });
    let favorite = note.favorite;
    const favBtn = btn('', { icon: 'star', size: 'sm', variant: favorite ? 'soft' : 'ghost', title: 'Yêu thích', onClick: async () => {
      try {
        await api.put('/library/favorites', { entityType: 'NOTE', entityId: note.id, favorite: !favorite });
        favorite = !favorite;
        favBtn.className = `btn sm icon ${favorite ? 'soft' : 'ghost'}`;
        const it = state.notes.find((n) => n.id === note.id);
        if (it) it.favorite = favorite;
        renderTree();
      } catch (e) {
        showError(e);
      }
    } });
    const aiBtn = btn('UniAI', { icon: 'sparkles', size: 'sm', variant: 'soft', onClick: (e) => aiMenu(e.currentTarget) });
    const moreBtn = btn('', { icon: 'more', size: 'sm', variant: 'ghost', title: 'Thêm', onClick: (e) => moreMenu(e.currentTarget) });

    function aiMenu(anchor) {
      if (!store.get().aiConfigured) return toast.warning('AI chưa được cấu hình trên máy chủ');
      const selection = window.getSelection().toString().trim();
      menu(anchor, [
        { header: selection ? 'Áp dụng cho đoạn đang chọn' : 'Áp dụng cho cả trang' },
        { label: 'Tóm tắt', icon: 'list', onClick: () => runAi('summarize', selection) },
        { label: 'Viết lại cho mạch lạc', icon: 'edit', onClick: () => runAi('rewrite', selection) },
        { label: 'Giải thích nội dung khó', icon: 'info', onClick: () => runAi('explain', selection) },
        'sep',
        { label: 'Tạo câu hỏi ôn tập', icon: 'quiz', onClick: () => runAi('quiz', selection) },
        { label: 'Tạo flashcard', icon: 'layers', onClick: () => runAi('flashcards', selection) },
      ], { align: 'right' });
    }

    async function runAi(action, text) {
      await saveSoon.flush();
      const m = modal({ title: 'UniAI', icon: 'sparkles', size: 'wide', body: h('div', { class: 'loading-center' }, h('div', { class: 'spinner' }), h('p', { class: 'muted small mt-8' }, 'AI đang xử lý...')) });
      try {
        const r = await api.post(`/notes/${note.id}/ai`, { action, text: text || undefined });
        if (action === 'quiz') return showQuiz(m, r);
        if (action === 'flashcards') return showFlashcards(m, r);
        m.body.replaceChildren(renderMarkdown(r.content));
        m.footer.replaceChildren(
          btn('Sao chép', { icon: 'copy', onClick: () => navigator.clipboard.writeText(r.content).then(() => toast('Đã sao chép')) }),
          canEdit ? btn('Chèn vào cuối trang', { icon: 'plus', variant: 'primary', onClick: () => (insertMarkdown(r.content, r.title), m.close()) }) : null
        );
        m.el.append(m.footer);
      } catch (e) {
        m.close();
        showError(e);
      }
    }

    function showQuiz(m, r) {
      if (!r.questions.length) {
        m.body.replaceChildren(h('p', { class: 'muted' }, 'AI không tạo được câu hỏi hợp lệ. Hãy thử lại.'));
        return;
      }
      m.body.replaceChildren(h('p', { class: 'muted small mb-8' }, r.note), ...r.questions.map((qq, i) => h('div', { class: 'card card-pad mb-8' }, h('div', { class: 'bold small' }, `${i + 1}. ${qq.content}`), qq.options ? h('ul', { class: 'small', style: { margin: '6px 0 0', paddingLeft: '18px' } }, qq.options.map((o) => h('li', {}, `${o.id}. ${o.text}`))) : null)));
      m.footer.replaceChildren(btn('Lưu thành bộ câu hỏi', { icon: 'quiz', variant: 'primary', onClick: async (e) => withLoading(e.currentTarget, async () => {
        try {
          const set = await api.post('/quiz/sets', { title: `Ôn tập: ${title.value || 'Ghi chú'}`.slice(0, 191), subjectId: note.subjectId || null, questions: r.questions.map(normQ) });
          m.close();
          toast('Đã lưu bộ câu hỏi – bạn có thể chỉnh sửa trong UniQuiz');
          navigate(`/quiz/${set.id}`);
        } catch (err) {
          showError(err);
        }
      }) }));
      m.el.append(m.footer);
    }

    function showFlashcards(m, r) {
      if (!r.cards.length) {
        m.body.replaceChildren(h('p', { class: 'muted' }, 'AI không tạo được flashcard. Hãy thử lại.'));
        return;
      }
      m.body.replaceChildren(h('div', { class: 'grid cols-2' }, r.cards.map((c) => h('div', { class: 'card card-pad' }, h('div', { class: 'bold small' }, c.front), h('div', { class: 'small muted mt-8' }, c.back)))));
      m.footer.replaceChildren(btn('Lưu thành bộ flashcard', { icon: 'layers', variant: 'primary', onClick: async (e) => withLoading(e.currentTarget, async () => {
        try {
          const set = await api.post('/quiz/sets', { title: `Flashcard: ${title.value || 'Ghi chú'}`.slice(0, 191), subjectId: note.subjectId || null, questions: r.cards.map((c) => ({ type: 'SHORT', content: String(c.front).slice(0, 5000), correctAnswer: [String(c.back).slice(0, 300)], difficulty: 'MEDIUM' })) });
          m.close();
          toast('Đã lưu bộ flashcard');
          navigate(`/quiz/${set.id}/flashcards`);
        } catch (err) {
          showError(err);
        }
      }) }));
      m.el.append(m.footer);
    }

    function insertMarkdown(md, heading) {
      const lines = md.replace(/\r/g, '').split('\n');
      const out = [{ id: uid(), type: 'heading3', text: `✨ ${heading} (UniAI)` }];
      let inCode = null;
      for (const l of lines) {
        if (/^\s*```/.test(l)) {
          if (inCode) {
            out.push(inCode);
            inCode = null;
          } else inCode = { id: uid(), type: 'code', text: '', language: l.replace(/`/g, '').trim() };
          continue;
        }
        if (inCode) {
          inCode.text += (inCode.text ? '\n' : '') + l;
          continue;
        }
        if (!l.trim()) continue;
        out.push(mdLineToBlock(l));
      }
      if (inCode) out.push(inCode);
      blocks.push(...out);
      changed();
      renderBlocks();
      toast('Đã chèn nội dung AI');
    }

    function moreMenu(anchor) {
      menu(anchor, [
        canEdit ? { label: 'Thêm trang con', icon: 'plus', onClick: () => createNote(note.id) } : null,
        canEdit ? { label: 'Di chuyển tới...', icon: 'move', onClick: movePage } : null,
        { label: 'Sao chép dạng Markdown', icon: 'copy', onClick: () => navigator.clipboard.writeText(toMarkdown()).then(() => toast('Đã sao chép Markdown')) },
        canEdit ? { label: 'Chia sẻ lên UniShare', icon: 'share', onClick: () => navigate(`/share/new?noteId=${note.id}`) } : null,
        canEdit ? 'sep' : null,
        canEdit
          ? {
              label: 'Chuyển vào thùng rác',
              icon: 'trash',
              danger: true,
              onClick: async () => {
                if (!(await confirmDialog({ title: 'Xóa trang này?', message: 'Trang và mọi trang con sẽ được chuyển vào Thùng rác.', danger: true, confirmText: 'Xóa' }))) return;
                try {
                  await saveSoon.flush();
                  dirty = false;
                  await api.del(`/notes/${note.id}`);
                  toast('Đã chuyển vào thùng rác');
                  navigate(note.parentId ? `/notes/${note.parentId}` : '/notes');
                } catch (e) {
                  showError(e);
                }
              },
            }
          : null,
      ], { align: 'right' });
    }

    async function movePage() {
      const options = [{ value: '', label: '— Trang gốc —' }, ...state.notes.filter((n) => n.id !== note.id).map((n) => ({ value: n.id, label: n.title || 'Không tiêu đề' }))];
      const sel = select(options, note.parentId || '');
      const m = modal({ title: 'Di chuyển trang', body: sel, footer: (close) => [btn('Hủy', { onClick: () => close() }), btn('Di chuyển', { variant: 'primary', onClick: () => close('ok') })] });
      if ((await m.promise) !== 'ok') return;
      try {
        await saveSoon.flush();
        const r = await api.patch(`/notes/${note.id}`, { parentId: sel.value ? Number(sel.value) : null, version });
        version = r.version;
        note.parentId = r.parentId;
        toast('Đã di chuyển');
        loadTree();
      } catch (e) {
        showError(e);
      }
    }

    function toMarkdown() {
      const md = [`# ${title.value}`];
      let n = 0;
      for (const b of blocks) {
        n = b.type === 'numbered' ? n + 1 : 0;
        const t = b.text || '';
        md.push(
          {
            heading1: `# ${t}`,
            heading2: `## ${t}`,
            heading3: `### ${t}`,
            bullet: `- ${t}`,
            numbered: `${n}. ${t}`,
            todo: `- [${b.checked ? 'x' : ' '}] ${t}`,
            quote: `> ${t}`,
            callout: `> 💡 ${t}`,
            code: `\`\`\`${b.language || ''}\n${t}\n\`\`\``,
            divider: '---',
            link: `[${t || b.url}](${b.url})`,
            image: `![${b.caption || ''}](ảnh)`,
            table: (b.rows || []).map((r, i) => `| ${r.join(' | ')} |${i === 0 ? `\n|${r.map(() => ' --- ').join('|')}|` : ''}`).join('\n'),
          }[b.type] ?? t
        );
      }
      return md.join('\n\n');
    }

    async function pickIcon() {
      const emojis = ['📄', '📘', '📗', '📕', '📙', '📓', '📝', '🧠', '💡', '📐', '🧮', '🔬', '🧪', '💻', '🖥️', '📊', '📈', '🗂️', '📌', '⭐', '🎯', '🚀', '✅', '❓', '🔐', '🌐', '🎓', '📅', '🧾', '🎨'];
      const m = modal({
        title: 'Chọn biểu tượng',
        body: h('div', { class: 'emoji-grid' }, emojis.map((em) => h('button', { class: 'emoji-btn', onclick: () => m.close(em) }, em))),
        footer: (close) => [btn('Bỏ biểu tượng', { onClick: () => close('') })],
      });
      const v = await m.promise;
      if (v === undefined) return;
      note.icon = v || null;
      iconBtn.textContent = v || '📄';
      changed();
    }

    // ------------------------------------------------- Layout
    renderBlocks();
    const el = h(
      'div',
      { class: 'note-editor-wrap' },
      h(
        'div',
        { class: 'note-topbar' },
        h('div', { class: 'breadcrumb grow', style: { margin: 0 } }, h('a', { href: '/notes' }, 'UniNote'), ...(note.breadcrumb || []).flatMap((b) => [h('span', { class: 'sep' }, '/'), h('a', { href: `/notes/${b.id}` }, `${b.icon || ''} ${b.title || 'Không tiêu đề'}`)])),
        statusEl,
        canEdit ? subjSel : note.subject ? h('span', { class: 'badge' }, note.subject.name) : null,
        canEdit ? favBtn : null,
        aiBtn,
        moreBtn
      ),
      !canEdit ? h('div', { class: 'alert info', style: { margin: '0 auto 12px', maxWidth: '820px' } }, icon('lock'), `Bạn đang xem ghi chú được chia sẻ bởi ${note.user?.fullName || 'thành viên nhóm'} (chỉ đọc).`) : null,
      h(
        'div',
        { class: 'note-page' },
        iconBtn,
        title,
        blocksEl,
        canEdit ? h('button', { class: 'note-add-block', onclick: () => (blocks.push({ id: uid(), type: 'paragraph', text: '' }), renderBlocks(), focusBlock(blocks.length - 1)) }, icon('plus', { size: 14 }), 'Thêm khối') : null,
        note.children?.length ? h('div', { class: 'note-children' }, h('div', { class: 'section-title' }, 'Trang con'), note.children.map((c) => h('a', { class: 'list-item', href: `/notes/${c.id}` }, h('span', {}, c.icon || '📄'), h('span', {}, c.title || 'Không tiêu đề')))) : null
      )
    );
    setTimeout(autoGrow);
    if (canEdit && !note.title) setTimeout(() => title.focus(), 50);

    const beforeUnload = (e) => {
      if (dirty || saving) {
        saveSoon.flush();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    const removeGuard = addLeaveGuard(async () => {
      if (dirty) {
        saveSoon.cancel();
        await save();
      }
      return true;
    });
    return {
      el,
      destroy: () => {
        window.removeEventListener('beforeunload', beforeUnload);
        removeGuard();
        if (dirty) save();
      },
    };
  }

  loadTree();
  loadNote();
  return () => editor?.destroy();
}

function mdLineToBlock(l) {
  const id = uid();
  let m;
  if ((m = /^#{1}\s+(.*)/.exec(l))) return { id, type: 'heading1', text: m[1] };
  if ((m = /^#{2}\s+(.*)/.exec(l))) return { id, type: 'heading2', text: m[1] };
  if ((m = /^#{3,}\s+(.*)/.exec(l))) return { id, type: 'heading3', text: m[1] };
  if ((m = /^\s*[-*+]\s+\[( |x)\]\s+(.*)/i.exec(l))) return { id, type: 'todo', text: m[2], checked: m[1] !== ' ' };
  if ((m = /^\s*[-*+]\s+(.*)/.exec(l))) return { id, type: 'bullet', text: m[1].replace(/\*\*/g, '') };
  if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) return { id, type: 'numbered', text: m[1].replace(/\*\*/g, '') };
  if ((m = /^\s*>\s?(.*)/.exec(l))) return { id, type: 'quote', text: m[1] };
  if (/^\s*-{3,}\s*$/.test(l)) return { id, type: 'divider', text: '' };
  return { id, type: 'paragraph', text: l.replace(/\*\*/g, '') };
}

function normQ(q) {
  return { type: q.type, content: q.content, options: q.options || null, correctAnswer: q.correctAnswer, explanation: q.explanation || null, difficulty: q.difficulty || 'MEDIUM', topic: q.topic || null };
}
