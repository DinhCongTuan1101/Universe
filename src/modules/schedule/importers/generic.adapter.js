'use strict';
/**
 * Import Adapter: mẫu CSV/Excel chung của UniVerse – MỖI DÒNG LÀ MỘT BUỔI HỌC LẶP.
 * Dùng cho trường không có adapter riêng. Tải mẫu tại GET /api/v1/schedules/import/template.
 *
 * Cột (không phân biệt hoa thường/dấu):
 *   Mã học phần | Tên học phần* | Số tín chỉ | Lớp học phần | Giảng viên |
 *   Từ ngày* | Đến ngày* | Thứ* (2..7, CN) | Tiết* (1,2,3 hoặc 1-3) | Phòng
 */
const { toGrid, key } = require('./sheetGrid');
const { toIsoDate, parsePeriodList, dayFromToken } = require('./timeText');
const { fold } = require('./sheetGrid');

const ID = 'generic';

const COLUMNS = [
  ['code', /^(ma hoc phan|ma hp|ma mon|code|subject code)$/],
  ['name', /^(ten hoc phan|ten mon|ten mon hoc|name|subject|subject name)$/],
  ['credits', /^(so tin chi|tin chi|credits)$/],
  ['classCode', /^(lop hoc phan|lop hp|class|class code)$/],
  ['lecturer', /^(giang vien|lecturer|teacher)$/],
  ['startDate', /^(tu ngay|ngay bat dau|start date|start)$/],
  ['endDate', /^(den ngay|ngay ket thuc|end date|end)$/],
  ['day', /^(thu|thu trong tuan|day|weekday)$/],
  ['periods', /^(tiet|tiet hoc|periods)$/],
  ['room', /^(phong|phong hoc|room)$/],
];
const REQUIRED = ['name', 'startDate', 'endDate', 'day', 'periods'];

function headerOf(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cols = {};
    rows[r].forEach((cell, c) => {
      const k = key(cell);
      for (const [f, re] of COLUMNS) if (re.test(k) && cols[f] === undefined) cols[f] = c;
    });
    if (REQUIRED.every((f) => cols[f] !== undefined)) return { row: r, cols };
  }
  return null;
}

function parseDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return toIsoDate(m[1], m[2], m[3]);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return toIsoDate(m[3], m[2], m[1]);
  return null;
}

function parseDay(v) {
  const s = fold(String(v || '')).trim();
  if (/^[2-7]$/.test(s)) return Number(s) - 1;
  if (/^(cn|8|chu nhat|sun|sunday)$/.test(s)) return 7;
  const en = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[s.slice(0, 3)];
  if (en && s.length <= 9 && !/^thu\s/.test(s)) return en;
  return dayFromToken(s);
}

function detect(workbook) {
  const first = workbook.SheetNames?.[0];
  if (!first) return 0;
  return headerOf(toGrid(workbook.Sheets[first]).rows) ? 0.9 : 0;
}

function parse(workbook) {
  const result = { adapter: ID, sheetName: null, meta: { semester: {}, student: {} }, subjects: [], warnings: [], errors: [] };
  const first = workbook.SheetNames?.[0];
  const rows = first ? toGrid(workbook.Sheets[first]).rows : [];
  const h = headerOf(rows);
  if (!h) {
    result.errors.push('File không đúng mẫu: cần các cột Tên học phần, Từ ngày, Đến ngày, Thứ, Tiết.');
    return result;
  }
  result.sheetName = first;
  const subjects = new Map();
  for (let r = h.row + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some(Boolean)) continue;
    const get = (f) => (h.cols[f] === undefined ? '' : String(row[h.cols[f]] || '').trim());
    const name = get('name');
    if (!name) {
      result.warnings.push(`Dòng ${r + 1}: thiếu tên học phần – đã bỏ qua.`);
      continue;
    }
    const sk = `${get('code')}|${name}|${get('classCode')}`;
    if (!subjects.has(sk)) {
      subjects.set(sk, {
        key: `s${subjects.size + 1}`,
        rowNumber: r + 1,
        code: get('code') || null,
        name,
        credits: /^\d+$/.test(get('credits')) ? Number(get('credits')) : null,
        classCode: get('classCode') || null,
        lecturer: get('lecturer') || null,
        rawTimeText: '',
        periods: [],
        warnings: [],
      });
    }
    const subject = subjects.get(sk);
    const rawText = `Dòng ${r + 1}: ${row.filter(Boolean).join(' | ')}`;
    subject.rawTimeText += (subject.rawTimeText ? '\n' : '') + rawText;
    const startDate = parseDate(get('startDate'));
    const endDate = parseDate(get('endDate'));
    const dayOfWeek = parseDay(get('day'));
    const periods = parsePeriodList(get('periods'));
    if (!startDate || !endDate || startDate > endDate) {
      subject.warnings.push(`Dòng ${r + 1}: ngày không hợp lệ`);
      continue;
    }
    if (!dayOfWeek) {
      subject.warnings.push(`Dòng ${r + 1}: thứ không hợp lệ "${get('day')}"`);
      continue;
    }
    if (!periods) {
      subject.warnings.push(`Dòng ${r + 1}: tiết không hợp lệ "${get('periods')}"`);
      continue;
    }
    let period = subject.periods.find((p) => p.startDate === startDate && p.endDate === endDate);
    if (!period) {
      period = { startDate, endDate, rawText: `Từ ${startDate} đến ${endDate}`, invalid: false, sessions: [] };
      subject.periods.push(period);
    }
    const room = get('room') || null;
    if (!room) subject.warnings.push(`Dòng ${r + 1}: chưa có phòng học`);
    period.sessions.push({
      dayOfWeek,
      periods,
      startPeriod: periods[0],
      endPeriod: periods[periods.length - 1],
      room,
      note: null,
      rawText,
    });
  }
  result.subjects = [...subjects.values()];
  result.meta.totalCredits = result.subjects.reduce((s, x) => s + (x.credits || 0), 0);
  result.meta.subjectCount = result.subjects.length;
  if (!result.subjects.length) result.warnings.push('File không có dòng dữ liệu nào.');
  return result;
}

const TEMPLATE_CSV =
  '﻿Mã học phần,Tên học phần,Số tín chỉ,Lớp học phần,Giảng viên,Từ ngày,Đến ngày,Thứ,Tiết,Phòng\n' +
  'MH001,Tên môn học ví dụ,3,MH001-01,,01/09/2026,30/09/2026,2,"1,2,3",101-A1\n' +
  'MH001,Tên môn học ví dụ,3,MH001-01,,01/09/2026,30/09/2026,4,"6,7,8",101-A1\n';

module.exports = { id: ID, name: 'Mẫu CSV/Excel chung của UniVerse', detect, parse, TEMPLATE_CSV };
