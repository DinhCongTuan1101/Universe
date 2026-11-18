'use strict';
/**
 * Phân tích văn bản "Thời gian địa điểm" (định dạng KMA và các biến thể gần giống).
 *
 * Ví dụ đầu vào:
 *   Từ 10/08/2026 đến 23/08/2026:
 *       Thứ 3 tiết 1,2,3 tại 604-TA1
 *       Thứ 5 tiết 1,2,3 tại 604-TA1
 *   Từ 24/08/2026 đến 30/08/2026: (2)
 *       Thứ 4 tiết 6,7,8 (LT)
 *   (2) 302-TA2
 *
 * Kết quả: { periods: [{ startDate, endDate, rawText, sessions: [...] }], warnings: [...] }
 * Không dùng AI – chỉ quy tắc có kiểm soát; phần không nhận diện được trả về warnings để người dùng sửa.
 */
const { fold, clean } = require('./sheetGrid');

// Lưu ý: KHÔNG dùng cờ /g cho các regex dùng chung (tránh lỗi lastIndex khi gọi .test/.exec nhiều lần).
const DATE_RANGE = /t[uư]\s*(?:ngay\s*)?(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})\s*(?:den|->|→|~|–|-)\s*(?:ngay\s*)?(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/;
// "CN" chỉ được hiểu là Chủ nhật khi đứng ngay trước "tiết" (tránh nhầm với tên phòng như "CN-A").
const DAY_SRC = String.raw`thu\s*[2-7]\b|thu\s*(?:hai|ba|tu|nam|sau|bay)\b|chu\s*nhat|\bcn\b(?=\s*[,:]?\s*tiet)`;
const DAY_TOKEN = new RegExp(DAY_SRC);
const PERIODS = /tiet\s*:?\s*(\d{1,2}(?:\s*(?:,|-|–|->|→|den)\s*\d{1,2})*)(?!\d)/;
const MARKER_LINE = /^\s*\((\d{1,2})\)\s*(.*)$/;
const WORD_DAY = { hai: 2, ba: 3, tu: 4, nam: 5, sau: 6, bay: 7 };

function pad(n) {
  return String(n).padStart(2, '0');
}

/** dd/mm/yyyy -> "yyyy-mm-dd" (kiểm tra ngày có thật) hoặc null */
function toIsoDate(d, m, y) {
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "1,2,3" | "1-3" | "1 đến 3" -> [1,2,3] */
function parsePeriodList(raw) {
  const f = fold(raw).replace(/\s+/g, ' ').trim();
  const out = new Set();
  for (const part of f.split(/\s*,\s*/)) {
    const range = /^(\d{1,2})\s*(?:-|–|->|→|den)\s*(\d{1,2})$/.exec(part.trim());
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a > b || b - a > 15) return null;
      for (let i = a; i <= b; i++) out.add(i);
      continue;
    }
    const nums = part.trim().split(/\s+/).filter(Boolean);
    for (const n of nums) {
      if (!/^\d{1,2}$/.test(n)) return null;
      out.add(Number(n));
    }
  }
  const list = [...out].sort((a, b) => a - b);
  return list.length && list.every((n) => n >= 1 && n <= 20) ? list : null;
}

/** ISO weekday: Thứ 2 -> 1 ... Thứ 7 -> 6, Chủ nhật -> 7 */
function dayFromToken(folded) {
  const m = /thu\s*([2-7])/.exec(folded);
  if (m) return Number(m[1]) - 1;
  const w = /thu\s*(hai|ba|tu|nam|sau|bay)/.exec(folded);
  if (w) return WORD_DAY[w[1]] - 1;
  if (/chu\s*nhat|\bcn\b/.test(folded)) return 7;
  return null;
}

/** Tách văn bản thành các "dòng logic": xuống dòng, ';' và trước mỗi "Từ dd/mm" hoặc "Thứ n". */
function splitLogicalLines(text) {
  const src = clean(text);
  const f = fold(src);
  const cuts = new Set();
  const re = new RegExp(String.raw`t[uư]\s*(?:ngay\s*)?\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{4}|` + DAY_SRC, 'g');
  let m;
  while ((m = re.exec(f))) {
    if (m.index > 0) cuts.add(m.index);
  }
  const lines = [];
  let last = 0;
  for (const idx of [...cuts].sort((a, b) => a - b)) {
    lines.push(src.slice(last, idx));
    last = idx;
  }
  lines.push(src.slice(last));
  return lines
    .flatMap((l) => l.split(/[\n;]/))
    .map((l) => l.trim())
    .filter((l) => l && !/^[-–:,.]+$/.test(l));
}

function extractRoom(originalTail) {
  let t = originalTail.trim().replace(/^[,:;.\-–]+/, '').trim();
  const f = fold(t);
  const m = /^(tai|phong|p\.|o|dia diem)\s*:?\s*/.exec(f);
  if (m) t = t.slice(m[0].length).trim();
  t = t.replace(/^[:\-–]+/, '').replace(/[,;.]+$/, '').trim();
  return t || null;
}

function parseSessionLine(line) {
  const f = fold(line);
  const dm = DAY_TOKEN.exec(f);
  if (!dm) return null;
  const dayOfWeek = dayFromToken(dm[0]);
  const rest = f.slice(dm.index + dm[0].length);
  const pm = PERIODS.exec(rest);
  if (!pm) return { error: 'Không xác định được tiết học', dayOfWeek };
  const periods = parsePeriodList(pm[1]);
  if (!periods) return { error: `Danh sách tiết không hợp lệ: "${pm[1].trim()}"`, dayOfWeek };

  let tailStart = dm.index + dm[0].length + pm.index + pm[0].length;
  let tail = line.slice(tailStart);
  let marker = null;
  let note = null;
  // Ghi chú trong ngoặc: (LT), (TH), (1)...
  const notes = [];
  tail = tail.replace(/\(([^)]{1,30})\)/g, (_all, inner) => {
    const trimmed = inner.trim();
    if (/^\d{1,2}$/.test(trimmed)) marker = Number(trimmed);
    else notes.push(trimmed);
    return ' ';
  });
  if (notes.length) note = notes.join(', ');
  const room = extractRoom(tail);
  const contiguous = periods[periods.length - 1] - periods[0] + 1 === periods.length;
  return {
    dayOfWeek,
    periods,
    startPeriod: periods[0],
    endPeriod: periods[periods.length - 1],
    room,
    note,
    marker,
    contiguous,
    rawText: line,
  };
}

/**
 * @param {string} text  nội dung ô "Thời gian địa điểm" (có thể gồm nhiều dòng)
 */
function parseTimeLocation(text) {
  const warnings = [];
  const periods = [];
  const locationByMarker = new Map();
  let current = null;

  for (const line of splitLogicalLines(text)) {
    const f = fold(line);
    const dr = DATE_RANGE.exec(f);
    if (dr) {
      const startDate = toIsoDate(dr[1], dr[2], dr[3]);
      const endDate = toIsoDate(dr[4], dr[5], dr[6]);
      current = { startDate, endDate, rawText: line, sessions: [], marker: null, invalid: false };
      if (!startDate || !endDate) {
        warnings.push(`Ngày không hợp lệ: "${line}"`);
        current.invalid = true;
      } else if (startDate > endDate) {
        warnings.push(`Ngày bắt đầu sau ngày kết thúc: "${line}"`);
        current.invalid = true;
      }
      const tail = line.slice(dr.index + dr[0].length);
      const mk = /\((\d{1,2})\)/.exec(tail);
      if (mk) current.marker = Number(mk[1]);
      periods.push(current);
      // Có thể có buổi học trên cùng dòng: "Từ ... đến ...: Thứ 3 tiết 1,2,3"
      const sameLine = tail.replace(/^\s*:?\s*(\(\d{1,2}\))?\s*:?/, '');
      if (sameLine.trim() && parseSessionLine(sameLine)) {
        addSession(sameLine);
      }
      continue;
    }

    const mk = MARKER_LINE.exec(line);
    if (mk && !/thu\s*[2-7]|chu\s*nhat|tiet/.test(f)) {
      // "(1) 604-TA1" => địa điểm cho marker 1
      const loc = extractRoom(mk[2]);
      if (loc) locationByMarker.set(Number(mk[1]), loc);
      continue;
    }

    if (DAY_TOKEN.test(f)) {
      addSession(line);
      continue;
    }
    warnings.push(`Không nhận diện được: "${line}"`);
  }

  function addSession(line) {
    const s = parseSessionLine(line);
    if (!s) return;
    if (s.error) {
      warnings.push(`${s.error}: "${line}"`);
      return;
    }
    if (!current) {
      warnings.push(`Buổi học không thuộc khoảng ngày nào: "${line}"`);
      return;
    }
    if (!s.contiguous) warnings.push(`Tiết học không liên tục (${s.periods.join(',')}): "${line}"`);
    current.sessions.push(s);
  }

  // Gán địa điểm theo marker "(n)" nếu buổi học chưa có phòng
  for (const p of periods) {
    for (const s of p.sessions) {
      const m = s.marker ?? p.marker;
      if (!s.room && m && locationByMarker.has(m)) s.room = locationByMarker.get(m);
      if (!s.room) warnings.push(`Chưa xác định phòng học: "${s.rawText}"`);
    }
    if (!p.sessions.length && !p.invalid) warnings.push(`Khoảng ngày không có buổi học: "${p.rawText}"`);
  }

  // Loại trùng lặp (cùng thứ + cùng tiết + cùng phòng trong một khoảng ngày)
  for (const p of periods) {
    const seen = new Set();
    p.sessions = p.sessions.filter((s) => {
      const k = `${s.dayOfWeek}|${s.periods.join(',')}|${s.room || ''}`;
      if (seen.has(k)) {
        warnings.push(`Bỏ buổi học trùng lặp: "${s.rawText}"`);
        return false;
      }
      seen.add(k);
      return true;
    });
  }

  return {
    periods: periods.map(({ startDate, endDate, rawText, sessions, invalid }) => ({
      startDate,
      endDate,
      rawText,
      invalid,
      sessions: sessions.map(({ dayOfWeek, periods: list, startPeriod, endPeriod, room, note, rawText: raw }) => ({
        dayOfWeek,
        periods: list,
        startPeriod,
        endPeriod,
        room,
        note,
        rawText: raw,
      })),
    })),
    warnings,
  };
}

module.exports = { parseTimeLocation, parsePeriodList, toIsoDate, splitLogicalLines, dayFromToken };
