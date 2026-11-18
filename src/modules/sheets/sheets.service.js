'use strict';
const XLSX = require('xlsx');
const { parse: parseCsv } = require('csv-parse/sync');
const prisma = require('../../database/prisma');
const library = require('../library/library.service');
const activity = require('../../services/activity.service');
const ai = require('../../services/ai/ai.service');
const prompts = require('../../services/ai/prompts');
const { detectFileType } = require('../../utils/fileType');
const { notFound, badRequest, conflict, unprocessable } = require('../../utils/errors');
const F = require('../../../public/js/shared/formula.js');

const LIMITS = { sheets: 20, rows: 5000, cols: 100 };

async function ownWorkbook(userId, id) {
  const w = await prisma.workbook.findFirst({ where: { id, userId, deletedAt: null } });
  if (!w) throw notFound('Không tìm thấy bảng tính');
  return w;
}

async function ownSheet(userId, workbookId, sheetId) {
  await ownWorkbook(userId, workbookId);
  const s = await prisma.worksheet.findFirst({ where: { id: sheetId, workbookId } });
  if (!s) throw notFound('Không tìm thấy trang tính');
  return s;
}

async function list(userId, { search, subjectId }) {
  const rows = await prisma.workbook.findMany({
    where: { userId, deletedAt: null, ...(search ? { title: { contains: search } } : {}), ...(subjectId ? { subjectId } : {}) },
    include: { subject: { select: { id: true, name: true, color: true } }, _count: { select: { sheets: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  const favs = await library.favoriteIds(userId, 'WORKBOOK', rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, favorite: favs.has(r.id) }));
}

async function create(userId, { title, subjectId }) {
  if (subjectId) {
    const s = await prisma.subject.findFirst({ where: { id: subjectId, userId, deletedAt: null } });
    if (!s) throw badRequest('Môn học không hợp lệ');
  }
  const w = await prisma.workbook.create({
    data: { userId, title, subjectId: subjectId ?? null, sheets: { create: [{ name: 'Sheet1', orderIndex: 0, cells: {} }] } },
  });
  await activity.log(userId, 'sheet.create', `Tạo bảng tính "${title}"`, { entityType: 'WORKBOOK', entityId: w.id });
  return get(userId, w.id);
}

async function get(userId, id) {
  const w = await prisma.workbook.findFirst({
    where: { id, userId, deletedAt: null },
    include: { sheets: { orderBy: { orderIndex: 'asc' } }, subject: { select: { id: true, name: true, color: true } } },
  });
  if (!w) throw notFound('Không tìm thấy bảng tính');
  await library.touchRecent(userId, 'WORKBOOK', id);
  const favs = await library.favoriteIds(userId, 'WORKBOOK', [id]);
  return { ...w, favorite: favs.has(id) };
}

async function update(userId, id, { title, subjectId }) {
  await ownWorkbook(userId, id);
  const data = {};
  if (title !== undefined) data.title = title;
  if (subjectId !== undefined) {
    if (subjectId) {
      const s = await prisma.subject.findFirst({ where: { id: subjectId, userId, deletedAt: null } });
      if (!s) throw badRequest('Môn học không hợp lệ');
    }
    data.subjectId = subjectId;
  }
  await prisma.workbook.update({ where: { id }, data });
  return get(userId, id);
}

async function remove(userId, id) {
  const w = await ownWorkbook(userId, id);
  await prisma.workbook.update({ where: { id }, data: { deletedAt: new Date() } });
  await activity.log(userId, 'sheet.delete', `Xóa bảng tính "${w.title}"`, { entityType: 'WORKBOOK', entityId: id });
}

// ------------------------------------------------------------------ Worksheet
async function addSheet(userId, workbookId, { name }) {
  await ownWorkbook(userId, workbookId);
  const count = await prisma.worksheet.count({ where: { workbookId } });
  if (count >= LIMITS.sheets) throw badRequest(`Tối đa ${LIMITS.sheets} trang tính`);
  const existing = await prisma.worksheet.findMany({ where: { workbookId }, select: { name: true } });
  let finalName = name || `Sheet${count + 1}`;
  let i = count + 1;
  while (existing.some((e) => e.name.toLowerCase() === finalName.toLowerCase())) finalName = `Sheet${++i}`;
  const s = await prisma.worksheet.create({ data: { workbookId, name: finalName, orderIndex: count, cells: {} } });
  await prisma.workbook.update({ where: { id: workbookId }, data: { updatedAt: new Date() } });
  return s;
}

/** Lưu trang tính (tự động lưu) có kiểm tra version để không ghi đè thay đổi mới hơn. */
async function saveSheet(userId, workbookId, sheetId, { version, cells, rowCount, colCount, colWidths, rowHeights, name }) {
  const s = await ownSheet(userId, workbookId, sheetId);
  if (version !== undefined && s.version !== version) {
    throw conflict('Trang tính đã được thay đổi ở nơi khác. Hãy tải lại.', { code: 'VERSION_CONFLICT' });
  }
  if (name !== undefined) {
    const dup = await prisma.worksheet.findFirst({ where: { workbookId, name, NOT: { id: sheetId } } });
    if (dup) throw conflict('Tên trang tính đã tồn tại');
  }
  const data = { version: { increment: 1 } };
  if (cells !== undefined) data.cells = cells;
  if (rowCount !== undefined) data.rowCount = rowCount;
  if (colCount !== undefined) data.colCount = colCount;
  if (colWidths !== undefined) data.colWidths = colWidths;
  if (rowHeights !== undefined) data.rowHeights = rowHeights;
  if (name !== undefined) data.name = name;
  const res = await prisma.worksheet.updateMany({ where: { id: sheetId, ...(version !== undefined ? { version } : {}) }, data });
  if (!res.count) throw conflict('Trang tính vừa được lưu ở nơi khác. Hãy tải lại.', { code: 'VERSION_CONFLICT' });
  await prisma.workbook.update({ where: { id: workbookId }, data: { updatedAt: new Date() } });
  return prisma.worksheet.findUnique({ where: { id: sheetId }, select: { id: true, version: true, updatedAt: true, name: true } });
}

async function deleteSheet(userId, workbookId, sheetId) {
  await ownSheet(userId, workbookId, sheetId);
  const count = await prisma.worksheet.count({ where: { workbookId } });
  if (count <= 1) throw badRequest('Bảng tính phải có ít nhất 1 trang tính');
  await prisma.worksheet.delete({ where: { id: sheetId } });
  const rest = await prisma.worksheet.findMany({ where: { workbookId }, orderBy: { orderIndex: 'asc' }, select: { id: true } });
  await prisma.$transaction(rest.map((r, i) => prisma.worksheet.update({ where: { id: r.id }, data: { orderIndex: i } })));
}

async function duplicateSheet(userId, workbookId, sheetId) {
  const s = await ownSheet(userId, workbookId, sheetId);
  const created = await addSheet(userId, workbookId, { name: `${s.name} (bản sao)`.slice(0, 60) });
  return prisma.worksheet.update({
    where: { id: created.id },
    data: { cells: s.cells, rowCount: s.rowCount, colCount: s.colCount, colWidths: s.colWidths ?? undefined, rowHeights: s.rowHeights ?? undefined },
  });
}

// ------------------------------------------------------------------ Import / Export
function sheetFromSheetJS(ws) {
  const cells = {};
  const ref = ws['!ref'];
  let rowCount = 100;
  let colCount = 26;
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    if (range.e.r + 1 > LIMITS.rows || range.e.c + 1 > LIMITS.cols) {
      throw unprocessable(`Trang tính quá lớn (tối đa ${LIMITS.rows} hàng × ${LIMITS.cols} cột)`);
    }
    rowCount = Math.max(100, range.e.r + 1);
    colCount = Math.max(26, range.e.c + 1);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        const key = F.refName(c, r);
        if (cell.f) cells[key] = { v: `=${cell.f}` };
        else if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
          cells[key] = { v: cell.t === 'd' ? cell.w || String(cell.v) : cell.t === 'n' ? String(cell.v) : String(cell.w ?? cell.v) };
        }
      }
    }
  }
  return { cells, rowCount, colCount };
}

async function importFile(userId, file, { title }) {
  if (!file) throw badRequest('Vui lòng chọn file');
  const type = detectFileType(file.buffer, file.originalname, ['xlsx', 'xls', 'csv', 'txt']);
  if (!type) throw badRequest('Chỉ hỗ trợ CSV, XLSX hoặc XLS');
  let sheets = [];
  if (type.ext === 'csv' || type.ext === 'txt') {
    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const first = text.split('\n')[0] || '';
    const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    let records;
    try {
      records = parseCsv(text, { delimiter, relax_column_count: true, bom: true });
    } catch (e) {
      throw unprocessable(`CSV không hợp lệ: ${e.message}`);
    }
    if (records.length > LIMITS.rows) throw unprocessable(`CSV quá lớn (tối đa ${LIMITS.rows} dòng)`);
    sheets = [{ name: 'Sheet1', ...sheetFromSheetJS(XLSX.utils.aoa_to_sheet(records)) }];
  } else {
    let wb;
    try {
      wb = XLSX.read(file.buffer, { type: 'buffer', cellFormula: true, cellDates: true });
    } catch {
      throw unprocessable('Không đọc được file Excel');
    }
    sheets = wb.SheetNames.slice(0, LIMITS.sheets).map((n) => ({ name: n.slice(0, 60), ...sheetFromSheetJS(wb.Sheets[n]) }));
  }
  const baseName = (title || file.originalname.replace(/\.[^.]+$/, '')).slice(0, 191);
  const w = await prisma.workbook.create({
    data: { userId, title: baseName, sheets: { create: sheets.map((s, i) => ({ ...s, orderIndex: i })) } },
  });
  await activity.log(userId, 'sheet.import', `Nhập bảng tính "${baseName}"`, { entityType: 'WORKBOOK', entityId: w.id });
  return get(userId, w.id);
}

async function exportFile(userId, id, { format, sheetId }) {
  const w = await get(userId, id);
  const wb = XLSX.utils.book_new();
  const targets = sheetId ? w.sheets.filter((s) => s.id === sheetId) : w.sheets;
  if (!targets.length) throw notFound('Không tìm thấy trang tính');
  for (const s of format === 'csv' ? targets.slice(0, 1) : targets) {
    const model = new F.SheetModel(JSON.parse(JSON.stringify(s.cells || {})));
    const values = model.computeAll();
    const ws = {};
    let maxR = 0;
    let maxC = 0;
    for (const [ref, cell] of Object.entries(s.cells || {})) {
      if (cell.v === undefined) continue;
      const p = F.parseRef(ref);
      if (!p) continue;
      maxR = Math.max(maxR, p.row);
      maxC = Math.max(maxC, p.col);
      const v = values[ref];
      const out = {};
      if (F.isError(v)) {
        out.t = 'e';
        out.v = 0x0f;
        out.w = v.code;
      } else if (typeof v === 'number') {
        out.t = 'n';
        out.v = v;
      } else if (typeof v === 'boolean') {
        out.t = 'b';
        out.v = v;
      } else {
        out.t = 's';
        out.v = v ?? '';
      }
      if (format !== 'csv' && typeof cell.v === 'string' && cell.v.startsWith('=')) out.f = cell.v.slice(1);
      ws[ref] = out;
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    if (s.colWidths && format !== 'csv') ws['!cols'] = Object.entries(s.colWidths).map(([, wpx]) => ({ wpx }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet');
  }
  const safe = w.title.replace(/[\\/:*?"<>|]/g, '_');
  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    return { buffer: Buffer.from(`﻿${csv}`, 'utf8'), name: `${safe}.csv`, mime: 'text/csv; charset=utf-8' };
  }
  return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), name: `${safe}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

// ------------------------------------------------------------------ AI
async function aiSuggestFormula(userId, { description, context }) {
  const { data } = await ai.completeJson(userId, 'sheet.formula', {
    system: prompts.SHEET_FORMULA,
    messages: [{ role: 'user', content: `Yêu cầu: ${description}\n${context ? `Ngữ cảnh dữ liệu (CSV, dòng đầu có thể là tiêu đề):\n${context}` : ''}` }],
    maxTokens: 500,
  });
  let formula = String(data?.formula || '').trim();
  if (formula && !formula.startsWith('=')) formula = `=${formula}`;
  // Kiểm tra công thức AI đề xuất bằng chính bộ phân tích của UniSheet
  let valid = false;
  let error = null;
  try {
    const ast = F.parseFormula(formula.slice(1));
    const unsupported = [];
    (function walk(n) {
      if (!n) return;
      if (n.type === 'func' && !F.SUPPORTED_FUNCTIONS.includes(n.name)) unsupported.push(n.name);
      if (n.args) n.args.forEach(walk);
      if (n.left) walk(n.left);
      if (n.right) walk(n.right);
      if (n.arg) walk(n.arg);
    })(ast);
    if (unsupported.length) error = `Công thức dùng hàm chưa hỗ trợ: ${unsupported.join(', ')}`;
    else valid = true;
  } catch (e) {
    error = e.message || 'Công thức không hợp lệ';
  }
  return { formula, explanation: data?.explanation || null, valid, error };
}

async function aiExplainFormula(userId, { formula }) {
  const r = await ai.complete(userId, 'sheet.explain', { system: prompts.SHEET_EXPLAIN, messages: [{ role: 'user', content: formula }], maxTokens: 600 });
  return { content: r.text };
}

async function aiAnalyze(userId, { csv }) {
  const r = await ai.complete(userId, 'sheet.analyze', { system: prompts.SHEET_ANALYZE, messages: [{ role: 'user', content: csv.slice(0, 12000) }] });
  return { content: r.text };
}

module.exports = { list, create, get, update, remove, addSheet, saveSheet, deleteSheet, duplicateSheet, importFile, exportFile, aiSuggestFormula, aiExplainFormula, aiAnalyze, LIMITS };
