/**
 * Trình soạn thảo UniSheet: lưới ảo hóa theo hàng, chọn vùng, copy/paste, đổi kích thước hàng/cột,
 * định dạng, sắp xếp, lọc, thêm/xóa hàng cột (tự dịch tham chiếu công thức), undo/redo, tự động lưu.
 * Công thức được tính bằng bộ xử lý riêng (shared/formula.js) – không dùng eval().
 */
import { h, icon, btn, debounce } from '../core/dom.js';
import { api, download } from '../core/api.js';
import { navigate, addLeaveGuard } from '../core/router.js';
import { store } from '../core/store.js';
import { toast, showError, modal, confirmDialog, promptDialog, menu, drawer, errorState, loading, field, withLoading } from '../core/ui.js';
import { renderMarkdown } from '../core/markdown.js';
import { SheetModel, formatValue, isError, indexToCol, parseRef, refName, SUPPORTED_FUNCTIONS } from '../shared/formula.js';

const DEFAULT_W = 100;
const DEFAULT_H = 26;
const HEADER_W = 48;

export function mount(container, { params }) {
  const id = Number(params.id);
  container.append(loading());
  let ctl = null;
  api
    .get(`/sheets/${id}`)
    .then((wb) => {
      ctl = createEditor(container, wb);
    })
    .catch((e) => container.replaceChildren(errorState(e)));
  return () => ctl?.destroy();
}

function shiftFormula(raw, axis, at, delta) {
  if (typeof raw !== 'string' || !raw.startsWith('=')) return raw;
  return raw
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/(?<![A-Za-z_\d])(\$?)([A-Z]{1,3})(\$?)(\d{1,6})(?![A-Za-z_(\d])/g, (m, d1, col, d2, row) => {
            let c = colIndex(col);
            let r = Number(row) - 1;
            const v = axis === 'row' ? r : c;
            if (delta < 0 && v >= at && v < at - delta) return '#REF!';
            if (v >= at) {
              if (axis === 'row') r += delta;
              else c += delta;
            }
            return `${d1}${indexToCol(c)}${d2}${r + 1}`;
          })
    )
    .join('');
}
function colIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function createEditor(container, wb) {
  let sheetIdx = 0;
  let sheet = wb.sheets[0];
  let model = new SheetModel(clone(sheet.cells || {}));
  let values = model.computeAll();
  let sel = { r1: 0, c1: 0, r2: 0, c2: 0, ar: 0, ac: 0 };
  let editing = null;
  let dirty = false;
  let saving = false;
  let filters = {};
  let undoStack = [];
  let redoStack = [];
  let visibleRows = [];
  let offsets = [];

  // ------------------------------------------------------------ DOM
  const titleInput = h('input', { class: 'sheet-title', value: wb.title, maxlength: 191, 'aria-label': 'Tên bảng tính' });
  titleInput.addEventListener('change', () => api.patch(`/sheets/${wb.id}`, { title: titleInput.value.trim() || wb.title }).then(() => toast('Đã đổi tên')).catch(showError));
  const status = h('span', { class: 'tiny muted' }, 'Đã lưu');
  const refLabel = h('div', { class: 'ref-label' }, 'A1');
  const formulaInput = h('input', { class: 'formula-input', placeholder: 'Nhập giá trị hoặc công thức, vd =SUM(A1:A10)', spellcheck: false });
  const errorHint = h('div', { class: 'formula-error', hidden: true });
  const gridWrap = h('div', { class: 'sheet-grid-wrap', tabindex: 0 });
  const table = h('table', { class: 'sheet-grid' });
  gridWrap.append(table);
  const tabsEl = h('div', { class: 'sheet-tabs' });

  const tb = (ic, title, onClick) => btn('', { icon: ic, size: 'sm', variant: 'ghost', title, onClick });
  const textColor = h('input', { type: 'color', class: 'color-pick', title: 'Màu chữ', value: '#1e293b', onchange: (e) => applyStyle({ color: e.target.value }) });
  const bgColor = h('input', { type: 'color', class: 'color-pick', title: 'Màu nền', value: '#fff7ed', onchange: (e) => applyStyle({ bg: e.target.value }) });
  const toolbar = h(
    'div',
    { class: 'sheet-toolbar' },
    tb('chevron-left', 'Hoàn tác (Ctrl+Z)', undo),
    h('span', { style: { transform: 'scaleX(-1)', display: 'inline-flex' } }, tb('chevron-left', 'Làm lại (Ctrl+Y)', redo)),
    h('span', { class: 'tb-sep' }),
    tb('bold', 'Đậm (Ctrl+B)', () => toggleStyle('b')),
    tb('italic', 'Nghiêng (Ctrl+I)', () => toggleStyle('i')),
    tb('underline', 'Gạch chân (Ctrl+U)', () => toggleStyle('u')),
    h('label', { class: 'color-wrap', title: 'Màu chữ' }, 'A', textColor),
    h('label', { class: 'color-wrap bg', title: 'Màu nền' }, icon('layers', { size: 14 }), bgColor),
    btn('', { icon: 'x', size: 'sm', variant: 'ghost', title: 'Xóa định dạng', onClick: () => applyStyle(null) }),
    h('span', { class: 'tb-sep' }),
    tb('align-left', 'Căn trái', () => applyStyle({ align: 'left' })),
    tb('align-center', 'Căn giữa', () => applyStyle({ align: 'center' })),
    tb('align-right', 'Căn phải', () => applyStyle({ align: 'right' })),
    h('span', { class: 'tb-sep' }),
    btn('123', { size: 'sm', variant: 'ghost', title: 'Định dạng số', onClick: (e) => formatMenu(e.currentTarget) }),
    btn('Σ', { size: 'sm', variant: 'ghost', title: 'Chèn hàm', onClick: (e) => functionMenu(e.currentTarget) }),
    h('span', { class: 'tb-sep' }),
    btn('Hàng/Cột', { icon: 'rows', size: 'sm', variant: 'ghost', onClick: (e) => structureMenu(e.currentTarget) }),
    tb('sort', 'Sắp xếp', (e) => sortMenu(e.currentTarget)),
    tb('filter', 'Lọc theo cột hiện tại', () => openFilter(sel.ac)),
    h('div', { class: 'spacer' }),
    btn('UniAI', { icon: 'sparkles', size: 'sm', variant: 'soft', onClick: openAi }),
    btn('Xuất', { icon: 'download', size: 'sm', onClick: (e) => exportMenu(e.currentTarget) })
  );

  container.replaceChildren(
    h(
      'div',
      { class: 'sheet-editor' },
      h('div', { class: 'sheet-header' }, h('a', { class: 'btn ghost sm icon', href: '/sheets', title: 'Quay lại', 'aria-label': 'Quay lại' }, icon('chevron-left')), h('div', { class: 'icon-box sm', style: { background: '#16a34a1a', color: '#16a34a' } }, icon('sheet')), titleInput, status),
      toolbar,
      h('div', { class: 'formula-bar' }, refLabel, h('span', { class: 'fx' }, 'fx'), formulaInput),
      errorHint,
      gridWrap,
      tabsEl
    )
  );

  // ------------------------------------------------------------ Helpers
  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }
  const cw = (c) => sheet.colWidths?.[c] || DEFAULT_W;
  const rh = (r) => sheet.rowHeights?.[r] || DEFAULT_H;
  const rng = () => ({ r1: Math.min(sel.r1, sel.r2), r2: Math.max(sel.r1, sel.r2), c1: Math.min(sel.c1, sel.c2), c2: Math.max(sel.c1, sel.c2) });
  const activeRef = () => refName(sel.ac, sel.ar);

  function usedBounds() {
    let maxR = -1;
    let maxC = -1;
    for (const k of Object.keys(model.cells)) {
      const p = parseRef(k);
      if (p && model.cells[k].v !== undefined) {
        maxR = Math.max(maxR, p.row);
        maxC = Math.max(maxC, p.col);
      }
    }
    return { maxR, maxC };
  }

  function recompute() {
    values = model.computeAll();
  }

  function snapshot() {
    return { idx: sheetIdx, cells: clone(model.cells), rowCount: sheet.rowCount, colCount: sheet.colCount, colWidths: clone(sheet.colWidths || {}), rowHeights: clone(sheet.rowHeights || {}) };
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }
  function restore(s) {
    if (s.idx !== sheetIdx) return;
    model = new SheetModel(clone(s.cells));
    Object.assign(sheet, { rowCount: s.rowCount, colCount: s.colCount, colWidths: s.colWidths, rowHeights: s.rowHeights });
    recompute();
    markDirty();
    renderGrid();
  }
  function undo() {
    const s = undoStack.pop();
    if (!s) return;
    redoStack.push(snapshot());
    restore(s);
  }
  function redo() {
    const s = redoStack.pop();
    if (!s) return;
    undoStack.push(snapshot());
    restore(s);
  }

  // ------------------------------------------------------------ Save
  const saveSoon = debounce(() => save(), 1000);
  function markDirty() {
    dirty = true;
    status.textContent = 'Chưa lưu...';
    status.className = 'tiny muted';
    saveSoon();
  }
  async function save() {
    if (!dirty) return;
    if (saving) return saveSoon();
    saving = true;
    dirty = false;
    status.textContent = 'Đang lưu...';
    const target = sheet;
    try {
      const r = await api.patch(`/sheets/${wb.id}/sheets/${target.id}`, { version: target.version, cells: model.cells, rowCount: target.rowCount, colCount: target.colCount, colWidths: target.colWidths || {}, rowHeights: target.rowHeights || {} });
      target.version = r.version;
      target.cells = clone(model.cells);
      status.textContent = 'Đã lưu';
      status.className = 'tiny success-text';
    } catch (e) {
      dirty = true;
      status.textContent = e.code === 'VERSION_CONFLICT' ? 'Xung đột phiên bản' : 'Lưu thất bại';
      status.className = 'tiny danger-text';
      if (e.code === 'VERSION_CONFLICT') {
        if (await confirmDialog({ title: 'Trang tính đã thay đổi ở nơi khác', message: 'Tải lại bản mới nhất (thay đổi chưa lưu sẽ mất) hay ghi đè bằng bản của bạn?', confirmText: 'Ghi đè bản của tôi', cancelText: 'Tải lại', danger: true })) {
          const fresh = await api.get(`/sheets/${wb.id}`);
          target.version = fresh.sheets.find((s) => s.id === target.id)?.version;
          saving = false;
          return save();
        }
        dirty = false;
        location.reload();
      } else showError(e);
    } finally {
      saving = false;
    }
  }

  // ------------------------------------------------------------ Filter / visible rows
  function computeVisible() {
    const cols = Object.keys(filters).map(Number);
    visibleRows = [];
    for (let r = 0; r < sheet.rowCount; r++) {
      if (r > 0 && cols.length) {
        const ok = cols.every((c) => filters[c].has(displayText(r, c)));
        if (!ok) continue;
      }
      visibleRows.push(r);
    }
    offsets = [0];
    for (const r of visibleRows) offsets.push(offsets[offsets.length - 1] + rh(r));
  }

  function displayText(r, c) {
    const ref = refName(c, r);
    const v = values[ref] ?? null;
    return formatValue(v, model.cells[ref]?.s?.fmt);
  }

  // ------------------------------------------------------------ Render
  let lastRange = null;
  function renderGrid() {
    computeVisible();
    lastRange = null;
    renderRows(true);
    renderTabs();
    updateFormulaBar();
  }

  function renderRows(force = false) {
    const top = gridWrap.scrollTop;
    const height = gridWrap.clientHeight || 600;
    let start = 0;
    while (start < visibleRows.length && offsets[start + 1] < top) start++;
    let end = start;
    while (end < visibleRows.length && offsets[end] < top + height) end++;
    start = Math.max(0, start - 15);
    end = Math.min(visibleRows.length, end + 15);
    if (!force && lastRange && lastRange[0] === start && lastRange[1] === end) return;
    lastRange = [start, end];
    const r = rng();
    const colgroup = h('colgroup', {}, h('col', { style: { width: `${HEADER_W}px` } }), Array.from({ length: sheet.colCount }, (_, c) => h('col', { style: { width: `${cw(c)}px` } })));
    const head = h(
      'thead',
      {},
      h(
        'tr',
        { style: { height: `${DEFAULT_H}px` } },
        h('th', { class: 'corner', onclick: () => selectAll() }),
        Array.from({ length: sheet.colCount }, (_, c) =>
          h(
            'th',
            { class: `col-head ${c >= r.c1 && c <= r.c2 ? 'hl' : ''} ${filters[c] ? 'filtered' : ''}`, onmousedown: (e) => selectCol(c, e), oncontextmenu: (e) => (e.preventDefault(), selectCol(c, e), structureMenu({ x: e.clientX, y: e.clientY })) },
            indexToCol(c),
            filters[c] ? icon('filter', { size: 10 }) : null,
            h('span', { class: 'col-resize', onmousedown: (e) => startResize(e, 'col', c) })
          )
        )
      )
    );
    const rows = [];
    if (offsets[start]) rows.push(h('tr', { class: 'spacer-row', style: { height: `${offsets[start]}px` } }, h('td', { colspan: sheet.colCount + 1 })));
    for (let i = start; i < end; i++) {
      const row = visibleRows[i];
      const tr = h('tr', { style: { height: `${rh(row)}px` } });
      tr.append(h('th', { class: `row-head ${row >= r.r1 && row <= r.r2 ? 'hl' : ''}`, onmousedown: (e) => selectRow(row, e), oncontextmenu: (e) => (e.preventDefault(), selectRow(row, e), structureMenu({ x: e.clientX, y: e.clientY })) }, row + 1, h('span', { class: 'row-resize', onmousedown: (e) => startResize(e, 'row', row) })));
      for (let c = 0; c < sheet.colCount; c++) tr.append(cellTd(row, c, r));
      rows.push(tr);
    }
    const rest = offsets[visibleRows.length] - offsets[end];
    if (rest > 0) rows.push(h('tr', { class: 'spacer-row', style: { height: `${rest}px` } }, h('td', { colspan: sheet.colCount + 1 })));
    table.replaceChildren(colgroup, head, h('tbody', {}, rows));
    table.style.width = `${HEADER_W + Array.from({ length: sheet.colCount }, (_, c) => cw(c)).reduce((a, b) => a + b, 0)}px`;
    if (editing) placeEditor();
  }

  function cellTd(row, c, r) {
    const ref = refName(c, row);
    const cell = model.cells[ref];
    const v = values[ref] ?? null;
    const s = cell?.s || {};
    const inRange = row >= r.r1 && row <= r.r2 && c >= r.c1 && c <= r.c2;
    const active = row === sel.ar && c === sel.ac;
    const td = h('td', {
      class: [inRange ? 'in-range' : '', active ? 'active' : '', isError(v) ? 'err' : '', typeof v === 'number' ? 'num' : ''].filter(Boolean).join(' '),
      'data-r': row,
      'data-c': c,
      title: isError(v) ? v.message : undefined,
    });
    td.textContent = formatValue(v, s.fmt);
    const st = td.style;
    if (s.b) st.fontWeight = '700';
    if (s.i) st.fontStyle = 'italic';
    if (s.u) st.textDecoration = 'underline';
    if (s.align) st.textAlign = s.align;
    if (s.color) st.color = s.color;
    if (s.bg) st.background = s.bg;
    return td;
  }

  function renderTabs() {
    tabsEl.replaceChildren(
      ...wb.sheets.map((s, i) =>
        h(
          'button',
          {
            class: `sheet-tab ${i === sheetIdx ? 'active' : ''}`,
            onclick: () => switchSheet(i),
            ondblclick: () => renameSheet(s),
            oncontextmenu: (e) => (e.preventDefault(), tabMenu(e, s, i)),
          },
          s.name,
          i === sheetIdx ? h('span', { class: 'tab-more', onclick: (e) => (e.stopPropagation(), tabMenu(e, s, i)) }, icon('chevron-down', { size: 12 })) : null
        )
      ),
      btn('', {
        icon: 'plus',
        size: 'xs',
        variant: 'ghost',
        title: 'Thêm trang tính',
        onClick: async () => {
          try {
            const s = await api.post(`/sheets/${wb.id}/sheets`, {});
            wb.sheets.push(s);
            switchSheet(wb.sheets.length - 1);
          } catch (e) {
            showError(e);
          }
        },
      })
    );
  }

  async function switchSheet(i) {
    if (i === sheetIdx) return;
    commitEdit();
    await saveSoon.flush();
    sheetIdx = i;
    sheet = wb.sheets[i];
    model = new SheetModel(clone(sheet.cells || {}));
    recompute();
    sel = { r1: 0, c1: 0, r2: 0, c2: 0, ar: 0, ac: 0 };
    filters = {};
    undoStack = [];
    redoStack = [];
    gridWrap.scrollTo(0, 0);
    renderGrid();
  }

  async function renameSheet(s) {
    const name = await promptDialog({ title: 'Đổi tên trang tính', value: s.name, maxLength: 60 });
    if (!name) return;
    try {
      const r = await api.patch(`/sheets/${wb.id}/sheets/${s.id}`, { name, version: s.version });
      s.name = r.name;
      s.version = r.version;
      renderTabs();
    } catch (e) {
      showError(e);
    }
  }

  function tabMenu(e, s, i) {
    menu(e.currentTarget?.getBoundingClientRect ? e.currentTarget : { x: e.clientX, y: e.clientY }, [
      { label: 'Đổi tên', icon: 'edit', onClick: () => renameSheet(s) },
      {
        label: 'Nhân bản',
        icon: 'copy',
        onClick: async () => {
          await saveSoon.flush();
          try {
            const c = await api.post(`/sheets/${wb.id}/sheets/${s.id}/duplicate`);
            wb.sheets.push(c);
            switchSheet(wb.sheets.length - 1);
          } catch (err) {
            showError(err);
          }
        },
      },
      'sep',
      {
        label: 'Xóa trang tính',
        icon: 'trash',
        danger: true,
        disabled: wb.sheets.length <= 1,
        onClick: async () => {
          if (!(await confirmDialog({ title: `Xóa "${s.name}"?`, message: 'Trang tính sẽ bị xóa vĩnh viễn.', danger: true, confirmText: 'Xóa' }))) return;
          try {
            dirty = false;
            await api.del(`/sheets/${wb.id}/sheets/${s.id}`);
            wb.sheets.splice(i, 1);
            sheetIdx = -1;
            switchSheet(Math.max(0, i - 1));
          } catch (err) {
            showError(err);
          }
        },
      },
    ]);
  }

  // ------------------------------------------------------------ Selection
  function updateFormulaBar() {
    const r = rng();
    refLabel.textContent = r.r1 === r.r2 && r.c1 === r.c2 ? activeRef() : `${refName(r.c1, r.r1)}:${refName(r.c2, r.r2)}`;
    if (document.activeElement !== formulaInput) formulaInput.value = model.raw(activeRef());
    const v = values[activeRef()];
    errorHint.hidden = !isError(v);
    if (isError(v)) errorHint.replaceChildren(icon('alert', { size: 13 }), ` ${v.code} – ${v.message}`);
  }

  function refreshSelection() {
    const r = rng();
    table.querySelectorAll('td.in-range, td.active').forEach((td) => td.classList.remove('in-range', 'active'));
    table.querySelectorAll('th.hl').forEach((th) => th.classList.remove('hl'));
    table.querySelectorAll('tbody td[data-r]').forEach((td) => {
      const row = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      if (row >= r.r1 && row <= r.r2 && c >= r.c1 && c <= r.c2) td.classList.add('in-range');
      if (row === sel.ar && c === sel.ac) td.classList.add('active');
    });
    const heads = table.querySelectorAll('thead th.col-head');
    for (let c = r.c1; c <= r.c2; c++) heads[c]?.classList.add('hl');
    table.querySelectorAll('th.row-head').forEach((th) => {
      const n = Number(th.firstChild.textContent) - 1;
      if (n >= r.r1 && n <= r.r2) th.classList.add('hl');
    });
    updateFormulaBar();
  }

  function setActive(r, c, extend = false) {
    r = Math.max(0, Math.min(sheet.rowCount - 1, r));
    c = Math.max(0, Math.min(sheet.colCount - 1, c));
    if (extend) {
      sel.r2 = r;
      sel.c2 = c;
    } else sel = { r1: r, c1: c, r2: r, c2: c, ar: r, ac: c };
    refreshSelection();
    scrollIntoView(extend ? r : sel.ar, extend ? c : sel.ac);
  }

  function scrollIntoView(r, c) {
    const vi = visibleRows.indexOf(r);
    if (vi >= 0) {
      const top = offsets[vi];
      const bottom = offsets[vi + 1];
      const headerH = DEFAULT_H;
      if (top < gridWrap.scrollTop) gridWrap.scrollTop = top;
      else if (bottom + headerH > gridWrap.scrollTop + gridWrap.clientHeight) gridWrap.scrollTop = bottom + headerH - gridWrap.clientHeight;
    }
    let left = HEADER_W;
    for (let i = 0; i < c; i++) left += cw(i);
    const right = left + cw(c);
    if (left - HEADER_W < gridWrap.scrollLeft) gridWrap.scrollLeft = left - HEADER_W;
    else if (right > gridWrap.scrollLeft + gridWrap.clientWidth) gridWrap.scrollLeft = right - gridWrap.clientWidth;
  }

  function selectAll() {
    sel = { r1: 0, c1: 0, r2: sheet.rowCount - 1, c2: sheet.colCount - 1, ar: 0, ac: 0 };
    refreshSelection();
  }
  function selectCol(c, e) {
    if (e.target.classList.contains('col-resize')) return;
    if (e.shiftKey) {
      sel.c2 = c;
      sel.r1 = 0;
      sel.r2 = sheet.rowCount - 1;
    } else sel = { r1: 0, r2: sheet.rowCount - 1, c1: c, c2: c, ar: 0, ac: c };
    refreshSelection();
  }
  function selectRow(r, e) {
    if (e.target.classList.contains('row-resize')) return;
    if (e.shiftKey) {
      sel.r2 = r;
      sel.c1 = 0;
      sel.c2 = sheet.colCount - 1;
    } else sel = { r1: r, r2: r, c1: 0, c2: sheet.colCount - 1, ar: r, ac: 0 };
    refreshSelection();
  }

  let dragging = false;
  gridWrap.addEventListener('mousedown', (e) => {
    const td = e.target.closest('td[data-r]');
    if (!td || e.button !== 0) return;
    if (editing && editing.td === td) return;
    commitEdit();
    const r = Number(td.dataset.r);
    const c = Number(td.dataset.c);
    if (e.shiftKey) setActive(r, c, true);
    else setActive(r, c);
    dragging = true;
    gridWrap.focus({ preventScroll: true });
    e.preventDefault();
  });
  gridWrap.addEventListener('mouseover', (e) => {
    if (!dragging) return;
    const td = e.target.closest('td[data-r]');
    if (td) {
      sel.r2 = Number(td.dataset.r);
      sel.c2 = Number(td.dataset.c);
      refreshSelection();
    }
  });
  const stopDrag = () => (dragging = false);
  window.addEventListener('mouseup', stopDrag);
  gridWrap.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td[data-r]');
    if (td) startEdit(model.raw(activeRef()));
  });
  gridWrap.addEventListener('scroll', () => renderRows());
  gridWrap.addEventListener('contextmenu', (e) => {
    const td = e.target.closest('td[data-r]');
    if (!td) return;
    e.preventDefault();
    const r = Number(td.dataset.r);
    const c = Number(td.dataset.c);
    const rr = rng();
    if (!(r >= rr.r1 && r <= rr.r2 && c >= rr.c1 && c <= rr.c2)) setActive(r, c);
    menu({ x: e.clientX, y: e.clientY }, [
      { label: 'Sao chép', icon: 'copy', hint: 'Ctrl+C', onClick: () => copySelection(false) },
      { label: 'Cắt', icon: 'x', hint: 'Ctrl+X', onClick: () => copySelection(true) },
      { label: 'Dán', icon: 'download', hint: 'Ctrl+V', onClick: pasteFromClipboard },
      { label: 'Xóa nội dung', icon: 'trash', hint: 'Del', onClick: clearSelection },
      'sep',
      { label: 'Chèn hàng phía trên', icon: 'plus', onClick: () => insertRows(rng().r1, 1) },
      { label: 'Chèn cột bên trái', icon: 'plus', onClick: () => insertCols(rng().c1, 1) },
      { label: 'Xóa hàng', icon: 'minus', onClick: () => deleteRows() },
      { label: 'Xóa cột', icon: 'minus', onClick: () => deleteCols() },
    ]);
  });

  // ------------------------------------------------------------ Editing
  function startEdit(initial, replace = false) {
    if (editing) return;
    const ref = activeRef();
    const td = table.querySelector(`td[data-r="${sel.ar}"][data-c="${sel.ac}"]`);
    if (!td) return;
    const input = h('input', { class: 'cell-editor', spellcheck: false });
    input.value = replace ? initial : model.raw(ref);
    editing = { ref, td, input, r: sel.ar, c: sel.ac };
    placeEditor();
    input.focus();
    if (!replace) input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('input', () => (formulaInput.value = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
        setActive(sel.ar + (e.shiftKey ? -1 : 1), sel.ac);
        gridWrap.focus({ preventScroll: true });
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit();
        setActive(sel.ar, sel.ac + (e.shiftKey ? -1 : 1));
        gridWrap.focus({ preventScroll: true });
      } else if (e.key === 'Escape') {
        cancelEdit();
        gridWrap.focus({ preventScroll: true });
      }
    });
    input.addEventListener('blur', () => setTimeout(() => editing?.input === input && document.activeElement !== formulaInput && commitEdit(), 0));
  }
  function placeEditor() {
    if (!editing) return;
    const td = table.querySelector(`td[data-r="${editing.r}"][data-c="${editing.c}"]`);
    if (!td) return;
    const rect = td.getBoundingClientRect();
    const wrapRect = gridWrap.getBoundingClientRect();
    Object.assign(editing.input.style, {
      left: `${rect.left - wrapRect.left + gridWrap.scrollLeft}px`,
      top: `${rect.top - wrapRect.top + gridWrap.scrollTop}px`,
      width: `${Math.max(rect.width, 120)}px`,
      height: `${rect.height}px`,
    });
    if (!editing.input.isConnected) gridWrap.append(editing.input);
  }
  function commitEdit(valueOverride) {
    if (!editing && valueOverride === undefined) return;
    const ref = editing ? editing.ref : activeRef();
    const value = valueOverride !== undefined ? valueOverride : editing.input.value;
    editing?.input.remove();
    editing = null;
    if (value !== model.raw(ref)) {
      pushUndo();
      model.setRaw(ref, value);
      recompute();
      markDirty();
    }
    renderRows(true);
    updateFormulaBar();
  }
  function cancelEdit() {
    editing?.input.remove();
    editing = null;
    updateFormulaBar();
  }

  formulaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editing?.input.remove();
      editing = null;
      commitEdit(formulaInput.value);
      setActive(sel.ar + 1, sel.ac);
      gridWrap.focus({ preventScroll: true });
    } else if (e.key === 'Escape') {
      formulaInput.value = model.raw(activeRef());
      gridWrap.focus({ preventScroll: true });
    }
  });

  gridWrap.addEventListener('keydown', (e) => {
    if (editing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[k]) {
      e.preventDefault();
      const [dr, dc] = moves[k];
      if (e.shiftKey) setActive(sel.r2 + dr, sel.c2 + dc, true);
      else {
        let nr = sel.ar + dr;
        while (dr && nr > 0 && nr < sheet.rowCount && !visibleRows.includes(nr)) nr += dr;
        setActive(nr, sel.ac + dc);
      }
    } else if (k === 'Enter' || k === 'F2') {
      e.preventDefault();
      startEdit(model.raw(activeRef()));
    } else if (k === 'Tab') {
      e.preventDefault();
      setActive(sel.ar, sel.ac + (e.shiftKey ? -1 : 1));
    } else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      clearSelection();
    } else if (ctrl && k.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if (ctrl && k.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (ctrl && k.toLowerCase() === 'b') {
      e.preventDefault();
      toggleStyle('b');
    } else if (ctrl && k.toLowerCase() === 'i') {
      e.preventDefault();
      toggleStyle('i');
    } else if (ctrl && k.toLowerCase() === 'u') {
      e.preventDefault();
      toggleStyle('u');
    } else if (ctrl && k.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
    } else if (ctrl && k.toLowerCase() === 's') {
      e.preventDefault();
      saveSoon.flush();
    } else if (k.length === 1 && !ctrl && !e.altKey) {
      e.preventDefault();
      startEdit(k, true);
    }
  });

  // ------------------------------------------------------------ Clipboard
  function selectionTsv(raw = true) {
    const r = rng();
    const lines = [];
    for (let row = r.r1; row <= r.r2; row++) {
      if (!visibleRows.includes(row)) continue;
      const cols = [];
      for (let c = r.c1; c <= r.c2; c++) {
        const ref = refName(c, row);
        const t = raw ? model.raw(ref) : displayText(row, c);
        cols.push(/[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      }
      lines.push(cols.join('\t'));
    }
    return lines.join('\n');
  }
  async function copySelection(cut) {
    try {
      await navigator.clipboard.writeText(selectionTsv());
      toast(cut ? 'Đã cắt' : 'Đã sao chép', 'info', { timeout: 1500 });
      if (cut) clearSelection();
    } catch {
      toast.error('Trình duyệt không cho phép truy cập clipboard');
    }
  }
  function parseTsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') inQ = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') inQ = true;
      else if (ch === '\t') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }
  function pasteText(text) {
    const rows = parseTsv(text.replace(/\n$/, ''));
    if (!rows.length) return;
    pushUndo();
    const needRows = sel.ar + rows.length;
    const needCols = sel.ac + Math.max(...rows.map((r) => r.length));
    if (needRows > sheet.rowCount) sheet.rowCount = Math.min(5000, needRows);
    if (needCols > sheet.colCount) sheet.colCount = Math.min(100, needCols);
    rows.forEach((r, i) => r.forEach((v, j) => sel.ar + i < sheet.rowCount && sel.ac + j < sheet.colCount && model.setRaw(refName(sel.ac + j, sel.ar + i), v)));
    sel.r1 = sel.ar;
    sel.c1 = sel.ac;
    sel.r2 = Math.min(sheet.rowCount - 1, sel.ar + rows.length - 1);
    sel.c2 = Math.min(sheet.colCount - 1, sel.ac + Math.max(...rows.map((r) => r.length)) - 1);
    recompute();
    markDirty();
    renderGrid();
  }
  async function pasteFromClipboard() {
    try {
      pasteText(await navigator.clipboard.readText());
    } catch {
      toast.info('Hãy dùng Ctrl+V để dán');
    }
  }
  gridWrap.addEventListener('copy', (e) => {
    if (editing) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', selectionTsv());
  });
  gridWrap.addEventListener('cut', (e) => {
    if (editing) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', selectionTsv());
    clearSelection();
  });
  gridWrap.addEventListener('paste', (e) => {
    if (editing) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  });

  function clearSelection() {
    const r = rng();
    pushUndo();
    for (let row = r.r1; row <= r.r2; row++) for (let c = r.c1; c <= r.c2; c++) model.setRaw(refName(c, row), '');
    recompute();
    markDirty();
    renderRows(true);
    updateFormulaBar();
  }

  // ------------------------------------------------------------ Format
  function eachSelected(fn) {
    const r = rng();
    const { maxR, maxC } = usedBounds();
    const r2 = Math.min(r.r2, Math.max(maxR, r.r1));
    const c2 = Math.min(r.c2, Math.max(maxC, r.c1));
    for (let row = r.r1; row <= r2; row++) for (let c = r.c1; c <= c2; c++) fn(refName(c, row));
  }
  function applyStyle(patch) {
    pushUndo();
    eachSelected((ref) => {
      const cell = model.cells[ref] || {};
      if (patch === null) delete cell.s;
      else cell.s = { ...(cell.s || {}), ...patch };
      if (cell.v === undefined && !cell.s) delete model.cells[ref];
      else model.cells[ref] = cell;
    });
    markDirty();
    renderRows(true);
  }
  function toggleStyle(key) {
    const cur = model.cells[activeRef()]?.s?.[key];
    applyStyle({ [key]: !cur });
  }
  function formatMenu(anchor) {
    const cur = model.cells[activeRef()]?.s?.fmt || { type: 'general' };
    const set = (fmt) => applyStyle({ fmt });
    menu(anchor, [
      { label: 'Tổng quát', onClick: () => set({ type: 'general' }) },
      { label: 'Số (1.234,56)', onClick: () => set({ type: 'number', decimals: 2 }) },
      { label: 'Phần trăm (12%)', onClick: () => set({ type: 'percent', decimals: 0 }) },
      { label: 'Tiền tệ (₫)', onClick: () => set({ type: 'currency', decimals: 0 }) },
      'sep',
      { label: 'Tăng số thập phân', icon: 'plus', onClick: () => set({ ...cur, type: cur.type === 'general' ? 'number' : cur.type, decimals: Math.min(10, (cur.decimals ?? 0) + 1) }) },
      { label: 'Giảm số thập phân', icon: 'minus', onClick: () => set({ ...cur, type: cur.type === 'general' ? 'number' : cur.type, decimals: Math.max(0, (cur.decimals ?? 2) - 1) }) },
    ]);
  }
  function functionMenu(anchor) {
    const r = rng();
    const multi = r.r1 !== r.r2 || r.c1 !== r.c2;
    const rangeText = multi ? `${refName(r.c1, r.r1)}:${refName(r.c2, r.r2)}` : '';
    const insert = (fn) => {
      if (multi) {
        // Đặt kết quả ngay dưới vùng chọn
        const target = refName(r.c1, r.r2 + 1);
        if (r.r2 + 1 >= sheet.rowCount) sheet.rowCount++;
        pushUndo();
        model.setRaw(target, `=${fn}(${rangeText})`);
        recompute();
        markDirty();
        setActive(r.r2 + 1, r.c1);
        renderRows(true);
      } else startEdit(`=${fn}(`, true);
    };
    menu(anchor, [
      { header: multi ? `Áp dụng cho ${rangeText}` : 'Chèn hàm vào ô' },
      ...['SUM', 'AVERAGE', 'MAX', 'MIN', 'COUNT'].map((f) => ({ label: f, onClick: () => insert(f) })),
      'sep',
      { label: 'IF(điều_kiện, đúng, sai)', onClick: () => startEdit('=IF(', true) },
      { label: 'SUMIF(vùng, điều_kiện, [vùng_tổng])', onClick: () => startEdit('=SUMIF(', true) },
      { label: 'COUNTIF(vùng, điều_kiện)', onClick: () => startEdit('=COUNTIF(', true) },
      'sep',
      { label: 'Hàm được hỗ trợ: ' + SUPPORTED_FUNCTIONS.join(', '), disabled: true },
    ]);
  }

  // ------------------------------------------------------------ Structure (rows/cols)
  function remap(axis, at, delta) {
    const out = {};
    for (const [ref, cell] of Object.entries(model.cells)) {
      const p = parseRef(ref);
      const v = axis === 'row' ? p.row : p.col;
      if (delta < 0 && v >= at && v < at - delta) continue;
      const nv = v >= at ? v + delta : v;
      const nref = axis === 'row' ? refName(p.col, nv) : refName(nv, p.row);
      out[nref] = { ...cell, ...(cell.v !== undefined ? { v: shiftFormula(cell.v, axis, at, delta) } : {}) };
    }
    const dims = axis === 'row' ? 'rowHeights' : 'colWidths';
    const nd = {};
    for (const [k, val] of Object.entries(sheet[dims] || {})) {
      const n = Number(k);
      if (delta < 0 && n >= at && n < at - delta) continue;
      nd[n >= at ? n + delta : n] = val;
    }
    sheet[dims] = nd;
    model = new SheetModel(out);
    recompute();
    markDirty();
    renderGrid();
  }
  function insertRows(at, n) {
    if (sheet.rowCount + n > 5000) return toast.error('Tối đa 5000 hàng');
    pushUndo();
    sheet.rowCount += n;
    remap('row', at, n);
  }
  function insertCols(at, n) {
    if (sheet.colCount + n > 100) return toast.error('Tối đa 100 cột');
    pushUndo();
    sheet.colCount += n;
    remap('col', at, n);
  }
  function deleteRows() {
    const r = rng();
    const n = r.r2 - r.r1 + 1;
    if (n >= sheet.rowCount) return toast.error('Không thể xóa tất cả hàng');
    pushUndo();
    remap('row', r.r1, -n);
    sheet.rowCount -= n;
    setActive(Math.min(r.r1, sheet.rowCount - 1), sel.ac);
    renderGrid();
  }
  function deleteCols() {
    const r = rng();
    const n = r.c2 - r.c1 + 1;
    if (n >= sheet.colCount) return toast.error('Không thể xóa tất cả cột');
    pushUndo();
    remap('col', r.c1, -n);
    sheet.colCount -= n;
    filters = {};
    setActive(sel.ar, Math.min(r.c1, sheet.colCount - 1));
    renderGrid();
  }
  function structureMenu(anchor) {
    const r = rng();
    menu(anchor, [
      { label: 'Chèn hàng phía trên', icon: 'plus', onClick: () => insertRows(r.r1, 1) },
      { label: 'Chèn hàng phía dưới', icon: 'plus', onClick: () => insertRows(r.r2 + 1, 1) },
      { label: `Xóa ${r.r2 - r.r1 + 1} hàng`, icon: 'minus', onClick: deleteRows },
      'sep',
      { label: 'Chèn cột bên trái', icon: 'plus', onClick: () => insertCols(r.c1, 1) },
      { label: 'Chèn cột bên phải', icon: 'plus', onClick: () => insertCols(r.c2 + 1, 1) },
      { label: `Xóa ${r.c2 - r.c1 + 1} cột`, icon: 'minus', onClick: deleteCols },
      'sep',
      { label: 'Thêm 50 hàng ở cuối', icon: 'rows', onClick: () => ((sheet.rowCount = Math.min(5000, sheet.rowCount + 50)), markDirty(), renderGrid()) },
    ]);
  }

  // Resize
  function startResize(e, axis, idx) {
    e.preventDefault();
    e.stopPropagation();
    const start = axis === 'col' ? e.clientX : e.clientY;
    const orig = axis === 'col' ? cw(idx) : rh(idx);
    pushUndo();
    const move = (ev) => {
      const size = Math.max(axis === 'col' ? 30 : 18, Math.min(800, orig + ((axis === 'col' ? ev.clientX : ev.clientY) - start)));
      const key = axis === 'col' ? 'colWidths' : 'rowHeights';
      sheet[key] = { ...(sheet[key] || {}), [idx]: Math.round(size) };
      if (axis === 'row') computeVisible();
      renderRows(true);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      markDirty();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // ------------------------------------------------------------ Sort & filter
  function sortMenu(anchor) {
    menu(anchor, [
      { header: `Theo cột ${indexToCol(sel.ac)}` },
      { label: 'Tăng dần (A → Z, 0 → 9)', onClick: () => sortBy(sel.ac, 1) },
      { label: 'Giảm dần (Z → A, 9 → 0)', onClick: () => sortBy(sel.ac, -1) },
    ]);
  }
  function sortBy(col, dir) {
    const r = rng();
    let r1;
    let r2;
    if (r.r2 > r.r1) {
      r1 = r.r1;
      r2 = r.r2;
    } else {
      const { maxR } = usedBounds();
      r1 = 1; // coi hàng 1 là tiêu đề
      r2 = maxR;
    }
    if (r2 <= r1) return toast.info('Không có đủ dữ liệu để sắp xếp');
    pushUndo();
    const { maxC } = usedBounds();
    const rows = [];
    for (let row = r1; row <= r2; row++) {
      const cells = {};
      for (let c = 0; c <= Math.max(maxC, col); c++) if (model.cells[refName(c, row)]) cells[c] = model.cells[refName(c, row)];
      rows.push({ key: values[refName(col, row)] ?? null, cells });
    }
    const rank = (v) => (v === null || v === '' ? 3 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
    rows.sort((a, b) => {
      const ra = rank(a.key);
      const rb = rank(b.key);
      if (ra === 3 || rb === 3) return ra - rb; // ô trống luôn ở cuối
      if (ra !== rb) return (ra - rb) * dir;
      if (ra === 0) return (a.key - b.key) * dir;
      return String(a.key).localeCompare(String(b.key), 'vi', { sensitivity: 'base' }) * dir;
    });
    for (let row = r1; row <= r2; row++) for (let c = 0; c <= Math.max(maxC, col); c++) delete model.cells[refName(c, row)];
    rows.forEach((rw, i) => {
      for (const [c, cell] of Object.entries(rw.cells)) model.cells[refName(Number(c), r1 + i)] = cell;
    });
    model = new SheetModel(model.cells);
    recompute();
    markDirty();
    renderGrid();
    toast(`Đã sắp xếp hàng ${r1 + 1}–${r2 + 1} theo cột ${indexToCol(col)}${r.r2 > r.r1 ? '' : ' (hàng 1 được giữ làm tiêu đề)'}`, 'info');
  }

  function openFilter(col) {
    const { maxR } = usedBounds();
    const counts = new Map();
    for (let r = 1; r <= Math.max(maxR, 1); r++) {
      const t = displayText(r, col);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const valuesList = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'vi'));
    const current = filters[col];
    const checks = valuesList.map((v) => ({ v, cb: h('input', { type: 'checkbox', checked: !current || current.has(v) }) }));
    const search = h('input', { class: 'input sm mb-8', placeholder: 'Tìm giá trị...' });
    const listEl = h('div', { class: 'filter-list' }, checks.map(({ v, cb }) => h('label', { class: 'checkbox small' }, cb, v === '' ? h('i', { class: 'muted' }, '(Trống)') : v, h('span', { class: 'tiny faint' }, ` (${counts.get(v)})`))));
    search.addEventListener('input', () => [...listEl.children].forEach((el, i) => (el.hidden = !checks[i].v.toLowerCase().includes(search.value.toLowerCase()))));
    modal({
      title: `Lọc cột ${indexToCol(col)} (hàng 1 là tiêu đề)`,
      icon: 'filter',
      body: [search, h('div', { class: 'row mb-8' }, btn('Chọn tất cả', { size: 'xs', onClick: () => checks.forEach((c) => (c.cb.checked = true)) }), btn('Bỏ chọn', { size: 'xs', onClick: () => checks.forEach((c) => (c.cb.checked = false)) })), listEl],
      footer: (close) => [
        btn('Xóa bộ lọc', {
          onClick: () => {
            delete filters[col];
            close();
            renderGrid();
          },
        }),
        btn('Áp dụng', {
          variant: 'primary',
          onClick: () => {
            const allowed = new Set(checks.filter((c) => c.cb.checked).map((c) => c.v));
            if (allowed.size === valuesList.length) delete filters[col];
            else filters[col] = allowed;
            close();
            renderGrid();
          },
        }),
      ],
    });
  }

  // ------------------------------------------------------------ Export / AI
  function exportMenu(anchor) {
    menu(anchor, [
      { label: 'Excel (.xlsx) – tất cả trang', icon: 'download', onClick: async () => (await saveSoon.flush(), download(`/sheets/${wb.id}/export?format=xlsx`, `${wb.title}.xlsx`).catch(showError)) },
      { label: 'CSV – trang hiện tại', icon: 'download', onClick: async () => (await saveSoon.flush(), download(`/sheets/${wb.id}/export?format=csv&sheetId=${sheet.id}`, `${wb.title}.csv`).catch(showError)) },
    ]);
  }

  function selectionCsv() {
    let r = rng();
    if (r.r1 === r.r2 && r.c1 === r.c2) {
      const { maxR, maxC } = usedBounds();
      r = { r1: 0, c1: 0, r2: Math.min(maxR, 200), c2: Math.min(maxC, 30) };
    }
    const lines = [];
    for (let row = r.r1; row <= Math.min(r.r2, r.r1 + 200); row++) {
      const cols = [];
      for (let c = r.c1; c <= r.c2; c++) {
        const t = displayText(row, c);
        cols.push(/[,"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      }
      lines.push(`${row + 1}: ${cols.join(',')}`);
    }
    return { csv: lines.join('\n'), range: `${refName(r.c1, r.r1)}:${refName(r.c2, r.r2)}` };
  }

  function openAi() {
    if (!store.get().aiConfigured) return toast.warning('AI chưa được cấu hình trên máy chủ');
    const out = h('div', { class: 'mt-16' });
    const desc = h('textarea', { class: 'textarea', rows: 3, placeholder: 'vd: Tính điểm trung bình cột B nếu cột C là "Đạt"' });
    const { range } = selectionCsv();
    drawer({
      title: 'UniAI cho bảng tính',
      body: [
        h('div', { class: 'ai-box' }, h('div', { class: 'ai-tag mb-8' }, icon('sparkles'), 'Gợi ý công thức'), field('Mô tả điều bạn muốn tính', desc), btn('Gợi ý', { size: 'sm', variant: 'primary', onClick: (e) => withLoading(e.currentTarget, suggest) })),
        h('div', { class: 'row wrap mt-16' }, btn(`Giải thích công thức ở ${activeRef()}`, { size: 'sm', onClick: (e) => withLoading(e.currentTarget, explain) }), btn(`Phân tích dữ liệu (${range})`, { size: 'sm', onClick: (e) => withLoading(e.currentTarget, analyze) })),
        h('p', { class: 'tiny muted mt-8' }, 'Khi bạn bấm, dữ liệu của vùng đang chọn (tối đa 200 hàng) được gửi tới AI provider. AI chỉ gợi ý – bạn quyết định có áp dụng hay không.'),
        out,
      ],
    });
    async function suggest() {
      if (desc.value.trim().length < 3) return toast.error('Hãy mô tả yêu cầu');
      try {
        const r = await api.post('/sheets/ai/formula', { description: desc.value.trim(), context: selectionCsv().csv.slice(0, 6000) });
        out.replaceChildren(
          h(
            'div',
            { class: 'card card-pad' },
            h('div', { class: 'mono bold' }, r.formula || '(không có)'),
            r.explanation ? h('p', { class: 'small muted mt-8' }, r.explanation) : null,
            !r.valid ? h('div', { class: 'alert warning mt-8' }, icon('alert'), r.error || 'Công thức không hợp lệ với UniSheet') : null,
            r.valid ? btn(`Chèn vào ô ${activeRef()}`, { size: 'sm', variant: 'primary', icon: 'check', onClick: () => (commitEdit(r.formula), toast('Đã chèn công thức')) }) : null
          )
        );
      } catch (e) {
        showError(e);
      }
    }
    async function explain() {
      const f = model.raw(activeRef());
      if (!f.startsWith('=')) return toast.info(`Ô ${activeRef()} không chứa công thức`);
      try {
        const r = await api.post('/sheets/ai/explain', { formula: f });
        out.replaceChildren(h('div', { class: 'card card-pad' }, h('div', { class: 'mono small mb-8' }, f), renderMarkdown(r.content)));
      } catch (e) {
        showError(e);
      }
    }
    async function analyze() {
      try {
        const r = await api.post('/sheets/ai/analyze', { csv: selectionCsv().csv });
        out.replaceChildren(h('div', { class: 'card card-pad' }, renderMarkdown(r.content)));
      } catch (e) {
        showError(e);
      }
    }
  }

  // ------------------------------------------------------------ Init
  renderGrid();
  setTimeout(() => {
    renderRows(true);
    gridWrap.focus({ preventScroll: true });
  }, 30);
  const onResize = debounce(() => renderRows(true), 100);
  window.addEventListener('resize', onResize);
  const beforeUnload = (e) => {
    if (dirty || saving) {
      saveSoon.flush();
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  const removeGuard = addLeaveGuard(async () => {
    commitEdit();
    if (dirty) {
      saveSoon.cancel();
      await save();
    }
    return true;
  });

  return {
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('mouseup', stopDrag);
      removeGuard();
      if (dirty) save();
    },
  };
}

export { navigate };
