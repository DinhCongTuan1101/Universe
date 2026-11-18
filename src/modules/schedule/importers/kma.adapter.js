'use strict';
/**
 * Import Adapter: Thời khóa biểu sinh viên KMA (Học viện Kỹ thuật Mật mã), file .xls/.xlsx.
 *
 * Nguyên tắc:
 *  - Nhận diện bằng TIÊU ĐỀ CỘT và nhãn, không phụ thuộc số dòng/cột cố định.
 *  - Xử lý ô gộp (merged cells) và học phần kéo dài nhiều dòng.
 *  - Không đoán dữ liệu: phần không nhận diện được => cảnh báo để người dùng sửa ở bước xem trước.
 *
 * Đầu ra theo "ParsedSchedule" chung (xem importers/index.js) – độc lập với nghiệp vụ UniSchedule.
 */
const { toGrid, key, fold } = require('./sheetGrid');
const { parseTimeLocation } = require('./timeText');

const ID = 'kma';
const PREFERRED_SHEET = 'thoikhoabieusv';

// Tiêu đề cột (đã fold) -> trường. Thứ tự quan trọng: mẫu dài/cụ thể hơn đứng trước.
const COLUMN_PATTERNS = [
  ['stt', /^(stt|tt|so tt)$/],
  ['code', /^(ma hoc phan|ma hp|ma mon( hoc)?|ma lop hoc phan cu)$/],
  ['name', /^(ten hoc phan|ten hp|ten mon( hoc)?)$/],
  ['credits', /^(so tin chi|tin chi|so tc|stc|tc)$/],
  ['classCode', /^(lop hoc phan|lop hp|ma lop hoc phan|lop)$/],
  ['seats', /^(ghe|si so|so ghe|cho)$/],
  ['timeLocation', /^(thoi gian ?(-|,|va)? ?dia diem|thoi gian dia diem hoc|lich hoc|thoi gian)$/],
  ['lecturer', /^(giang vien|gv|giao vien)$/],
  ['fee', /^(hoc phi|so tien)$/],
];
const REQUIRED = ['name', 'timeLocation'];
const LABELS = {
  code: 'Mã học phần',
  name: 'Tên học phần',
  credits: 'Số tín chỉ',
  classCode: 'Lớp học phần',
  timeLocation: 'Thời gian địa điểm',
};

function matchColumn(cellKey) {
  for (const [field, re] of COLUMN_PATTERNS) if (re.test(cellKey)) return field;
  return null;
}

/** Tìm dòng tiêu đề: dòng có nhiều cột khớp nhất (cần có name + timeLocation). Hỗ trợ tiêu đề 2 dòng. */
function findHeader(rows) {
  let best = null;
  const limit = Math.min(rows.length, 60);
  for (let r = 0; r < limit; r++) {
    const cols = {};
    rows[r].forEach((cell, c) => {
      const f = matchColumn(key(cell));
      if (f && cols[f] === undefined) cols[f] = c;
    });
    if (Object.keys(cols).length < 2) continue; // bản thân dòng phải là tiêu đề
    // Tiêu đề gộp 2 dòng: bổ sung cột còn thiếu từ dòng ngay dưới
    if (rows[r + 1]) {
      rows[r + 1].forEach((cell, c) => {
        const f = matchColumn(key(cell));
        if (f && cols[f] === undefined && !Object.values(cols).includes(c)) cols[f] = c;
      });
    }
    const score = Object.keys(cols).length;
    if (REQUIRED.every((f) => cols[f] !== undefined) && (!best || score > best.score)) {
      // Nếu dòng dưới cũng là tiêu đề, dữ liệu bắt đầu sau nó
      const nextIsHeader = rows[r + 1] && rows[r + 1].filter((cell) => matchColumn(key(cell))).length >= 2;
      best = { row: r, dataStart: nextIsHeader ? r + 2 : r + 1, cols, score };
    }
  }
  return best;
}

// ---------- Thông tin đầu trang ----------
const META_PATTERNS = [
  ['term', /hoc\s*ky\s*:?\s*([0-9ivx]+|he|phu)\b/],
  ['academicYear', /nam\s*hoc\s*:?\s*(\d{4})\s*[-–/]\s*(\d{4})/],
  ['phase', /dot\s*(?:hoc)?\s*:?\s*(\d+)/],
];
const STUDENT_LABELS = [
  ['fullName', /^(ho (va )?ten( sinh vien)?|ten sinh vien|sinh vien)$/],
  ['studentCode', /^(ma (so )?sinh vien|ma sv|mssv|ma so sv)$/],
  ['className', /^(lop( hanh chinh| sinh hoat)?)$/],
  ['cohort', /^(khoa( hoc)?|nien khoa)$/],
  ['major', /^(nganh( hoc)?|chuyen nganh)$/],
];

function parseMeta(rows, headerRow) {
  const meta = { semester: {}, student: {} };
  const texts = [];
  for (let r = 0; r < headerRow; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      texts.push(cell);
      // Nhãn và giá trị có thể nằm chung ô ("Lớp: AT20A") hoặc khác ô ("Lớp:" | "AT20A")
      const segments = cell.split(/\s{2,}|\n/).map((s) => s.trim()).filter(Boolean);
      for (const seg of segments) {
        const colon = seg.search(/[:：]/);
        const labelPart = colon >= 0 ? seg.slice(0, colon) : seg;
        const valuePart = colon >= 0 ? seg.slice(colon + 1).trim() : '';
        const k = key(labelPart);
        for (const [field, re] of STUDENT_LABELS) {
          if (!re.test(k) || meta.student[field]) continue;
          let value = valuePart;
          if (!value) {
            // giá trị ở ô kế tiếp không rỗng (bỏ qua ô bản sao do gộp ô)
            for (let cc = c + 1; cc < row.length; cc++) {
              if (row[cc] && row[cc] !== cell) {
                value = row[cc];
                break;
              }
            }
          }
          if (value && !STUDENT_LABELS.some(([, re2]) => re2.test(key(value.split(':')[0])))) meta.student[field] = value.trim();
        }
      }
    }
  }
  const all = fold(texts.join(' \n '));
  for (const [field, re] of META_PATTERNS) {
    const m = re.exec(all);
    if (!m) continue;
    if (field === 'academicYear') meta.semester.academicYear = `${m[1]}-${m[2]}`;
    else meta.semester[field] = m[1].toUpperCase();
  }
  const s = meta.semester;
  if (s.term || s.academicYear) {
    s.label = [s.term && `Học kỳ ${s.term}`, s.academicYear && `Năm học ${s.academicYear}`, s.phase && `Đợt ${s.phase}`]
      .filter(Boolean)
      .join(' – ');
  }
  return meta;
}

/** Ghi chú về tiết học ở cuối file, vd "Buổi sáng từ tiết 1 đến tiết 5" – chỉ ghi nhận, không đoán giờ. */
function parseShiftNotes(rows, fromRow) {
  const shifts = [];
  const notes = [];
  for (let r = fromRow; r < rows.length; r++) {
    for (const cell of rows[r]) {
      if (!cell) continue;
      const f = fold(cell);
      const re = /buoi\s*(sang|chieu|toi)\s*(?:tu|:)?\s*tiet\s*(\d{1,2})\s*(?:den|-|–)\s*(?:tiet\s*)?(\d{1,2})/g;
      let m;
      let hit = false;
      while ((m = re.exec(f))) {
        hit = true;
        const shift = m[1] === 'sang' ? 'MORNING' : m[1] === 'chieu' ? 'AFTERNOON' : 'EVENING';
        if (!shifts.some((s) => s.shift === shift)) shifts.push({ shift, fromPeriod: Number(m[2]), toPeriod: Number(m[3]) });
      }
      if (hit && !notes.includes(cell)) notes.push(cell);
    }
  }
  return { shifts, notes };
}

function toInt(v) {
  const m = /-?\d+/.exec(String(v ?? '').replace(/[.,](?=\d{3}\b)/g, ''));
  return m ? Number(m[0]) : null;
}

function parseFee(v) {
  const digits = String(v ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

/** Điểm nhận diện (0..1) – dùng để chọn adapter tự động. */
function detect(workbook) {
  const names = workbook.SheetNames || [];
  let score = names.some((n) => key(n).replace(/\s/g, '') === PREFERRED_SHEET) ? 0.5 : 0;
  for (const n of names.slice(0, 5)) {
    const { rows } = toGrid(workbook.Sheets[n]);
    const h = findHeader(rows);
    if (h && h.cols.timeLocation !== undefined) {
      score += 0.4;
      const text = fold(rows.slice(0, h.row).flat().join(' '));
      if (/thoi khoa bieu|hoc vien ky thuat mat ma|ky thuat mat ma/.test(text)) score += 0.1;
      break;
    }
  }
  return Math.min(score, 1);
}

function pickSheet(workbook) {
  const names = workbook.SheetNames || [];
  const preferred = names.find((n) => key(n).replace(/\s/g, '') === PREFERRED_SHEET);
  const ordered = preferred ? [preferred, ...names.filter((n) => n !== preferred)] : names;
  for (const n of ordered) {
    const grid = toGrid(workbook.Sheets[n]);
    const header = findHeader(grid.rows);
    if (header) return { name: n, grid, header };
  }
  return null;
}

/**
 * @param {import('xlsx').WorkBook} workbook
 * @returns {ParsedSchedule}
 */
function parse(workbook) {
  const result = { adapter: ID, sheetName: null, meta: { semester: {}, student: {} }, subjects: [], warnings: [], errors: [] };
  const picked = pickSheet(workbook);
  if (!picked) {
    // Báo rõ cột nào thiếu
    const first = workbook.SheetNames?.[0];
    const rows = first ? toGrid(workbook.Sheets[first]).rows : [];
    const found = new Set(rows.slice(0, 60).flat().map((c) => matchColumn(key(c))).filter(Boolean));
    const missing = REQUIRED.filter((f) => !found.has(f)).map((f) => LABELS[f]);
    result.errors.push(
      missing.length
        ? `Không tìm thấy bảng học phần: file thiếu cột ${missing.join(', ')}.`
        : 'Không tìm thấy bảng học phần trong file.'
    );
    return result;
  }
  const { name, grid, header } = picked;
  const { rows, copy } = grid;
  const { cols } = header;
  result.sheetName = name;
  result.meta = parseMeta(rows, header.row);
  for (const f of ['code', 'credits', 'classCode']) {
    if (cols[f] === undefined) result.warnings.push(`File không có cột "${LABELS[f]}" – trường này sẽ để trống.`);
  }

  const get = (r, field) => (cols[field] === undefined ? '' : rows[r][cols[field]] || '');
  const isCopy = (r, field) => cols[field] !== undefined && copy[r][cols[field]];

  let current = null;
  let endRow = rows.length;
  let declaredTotalCredits = null;

  for (let r = header.dataStart; r < rows.length; r++) {
    const row = rows[r];
    const rowKey = key(row.filter(Boolean).join(' '));
    if (!rowKey) continue; // dòng trống
    if (/^(tong( cong| so)?|cong)\b/.test(rowKey) || /tong (so )?tin chi/.test(rowKey)) {
      const m = /(\d+)\s*(?:tin chi|tc)/.exec(rowKey) || /tong[^\d]*(\d+)/.exec(rowKey);
      if (m) declaredTotalCredits = Number(m[1]);
      endRow = r;
      break;
    }
    if (/^(ghi chu|chu y|luu y)\b/.test(rowKey) || /buoi\s*(sang|chieu)/.test(rowKey)) {
      endRow = r;
      break;
    }

    const stt = get(r, 'stt');
    const nameVal = get(r, 'name');
    const startsNew =
      (nameVal && !isCopy(r, 'name') && (!current || nameVal !== current.name || (stt && !isCopy(r, 'stt')))) ||
      (stt && /^\d+$/.test(stt) && !isCopy(r, 'stt'));

    if (startsNew && nameVal) {
      current = {
        rowNumber: r + 1,
        stt: toInt(stt),
        code: get(r, 'code') || null,
        name: nameVal,
        credits: toInt(get(r, 'credits')),
        classCode: get(r, 'classCode') || null,
        seats: get(r, 'seats') || null,
        lecturer: get(r, 'lecturer') || null,
        fee: parseFee(get(r, 'fee')),
        timeTexts: [],
      };
      result.subjects.push(current);
      const t = get(r, 'timeLocation');
      if (t) current.timeTexts.push(t);
    } else if (current) {
      // Dòng tiếp nối của học phần (do ô gộp hoặc lịch kéo dài nhiều dòng)
      const t = get(r, 'timeLocation');
      if (t && !isCopy(r, 'timeLocation') && !current.timeTexts.includes(t)) current.timeTexts.push(t);
    } else {
      result.warnings.push(`Dòng ${r + 1}: không xác định được học phần – đã bỏ qua.`);
    }
  }

  const shiftInfo = parseShiftNotes(rows, Math.min(endRow, rows.length));
  result.meta.shifts = shiftInfo.shifts;
  result.meta.shiftNotes = shiftInfo.notes;

  // Phân tích cột Thời gian địa điểm cho từng học phần
  result.subjects = result.subjects.map((s, index) => {
    const rawTimeText = s.timeTexts.join('\n');
    const parsed = parseTimeLocation(rawTimeText);
    const warnings = [...parsed.warnings];
    if (!s.code) warnings.push('Thiếu mã học phần');
    if (s.credits === null) warnings.push('Thiếu số tín chỉ');
    if (!rawTimeText) warnings.push('Không có thông tin thời gian/địa điểm');
    else if (!parsed.periods.length) warnings.push('Không nhận diện được khoảng ngày học nào');
    const { timeTexts, ...rest } = s;
    return { key: `s${index + 1}`, ...rest, rawTimeText, periods: parsed.periods, warnings };
  });

  const total = result.subjects.reduce((sum, s) => sum + (s.credits || 0), 0);
  result.meta.totalCredits = total;
  result.meta.subjectCount = result.subjects.length;
  if (declaredTotalCredits !== null) {
    result.meta.declaredTotalCredits = declaredTotalCredits;
    if (declaredTotalCredits !== total) {
      result.warnings.push(`Tổng tín chỉ trong file (${declaredTotalCredits}) khác tổng đã đọc (${total}).`);
    }
  }
  if (!result.subjects.length) result.warnings.push('File không có học phần nào (có thể là file mẫu chưa đăng ký môn học).');
  return result;
}

module.exports = { id: ID, name: 'Thời khóa biểu sinh viên KMA (.xls/.xlsx)', detect, parse, _internals: { findHeader, parseMeta, matchColumn } };
