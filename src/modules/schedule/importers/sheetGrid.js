'use strict';
/**
 * Tiện ích đọc bảng tính cho các Import Adapter.
 *  - toGrid(): chuyển worksheet SheetJS thành mảng 2 chiều chuỗi + thông tin ô gộp.
 *  - fold(): chuẩn hóa tiếng Việt (bỏ dấu, chữ thường) GIỮ NGUYÊN độ dài chuỗi,
 *    nhờ vậy vị trí tìm được trên chuỗi đã fold dùng lại được để cắt chuỗi gốc.
 */
const XLSX = require('xlsx');

function foldChar(ch) {
  if (ch.length !== 1) return ch; // ký tự ngoài BMP (emoji...) – giữ nguyên để không lệch độ dài
  if (ch === 'đ' || ch === 'Đ') return 'd';
  const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const lower = (base || ch).toLowerCase();
  return lower.length === 1 ? lower : ch.toLowerCase().charAt(0) || ch;
}

/** Chuẩn hóa NFC + thay khoảng trắng đặc biệt; KHÔNG đổi độ dài sau bước này. */
function clean(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[   \t]/g, ' ');
}

function fold(s) {
  const c = clean(s);
  let out = '';
  for (const ch of c) out += foldChar(ch);
  return out;
}

/** fold + gộp khoảng trắng – dùng để so sánh tiêu đề cột/nhãn. */
function key(s) {
  return fold(s).replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').trim();
}

/**
 * @returns {{ rows: string[][], copy: boolean[][], merges: object[] }}
 *   copy[r][c] = true nếu ô là bản sao từ ô gộp (không phải ô gốc trên-trái)
 */
function toGrid(ws) {
  const ref = ws['!ref'];
  if (!ref) return { rows: [], copy: [], merges: [] };
  const range = XLSX.utils.decode_range(ref);
  const rows = [];
  const copy = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    const crow = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      let v = '';
      if (cell) v = cell.w !== undefined && cell.t !== 's' ? cell.w : cell.v;
      row.push(clean(v ?? '').trim());
      crow.push(false);
    }
    rows.push(row);
    copy.push(crow);
  }
  const merges = ws['!merges'] || [];
  for (const m of merges) {
    const top = rows[m.s.r - range.s.r]?.[m.s.c - range.s.c] ?? '';
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        const rr = r - range.s.r;
        const cc = c - range.s.c;
        if (rows[rr] && !rows[rr][cc]) {
          rows[rr][cc] = top;
          copy[rr][cc] = true;
        }
      }
    }
  }
  return { rows, copy, merges };
}

function readWorkbook(buffer) {
  return XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: false, dense: false });
}

module.exports = { toGrid, fold, key, clean, readWorkbook };
