'use strict';
/**
 * Logic thuần (không truy cập DB) của UniSchedule – dễ kiểm thử:
 *  - expandDates: sinh các ngày cụ thể trong [startDate, endDate] đúng thứ chỉ định.
 *  - detectConflicts: tìm các buổi học chồng tiết trong cùng ngày.
 * Ngày luôn ở dạng "YYYY-MM-DD" và tính theo UTC để tránh lệch múi giờ.
 */

const MAX_RANGE_DAYS = 400; // chặn khoảng ngày bất thường (tránh sinh lịch "vô hạn")
const DAY_NAMES = ['', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO weekday của ngày: 1 = Thứ 2 ... 7 = Chủ nhật */
function isoWeekday(iso) {
  const d = new Date(parseIso(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

function daysBetween(a, b) {
  return Math.round((parseIso(b) - parseIso(a)) / 86400000);
}

/**
 * @returns {string[]} các ngày (ISO) trong khoảng [startDate, endDate] có thứ = dayOfWeek
 */
function expandDates(startDate, endDate, dayOfWeek) {
  if (!startDate || !endDate || startDate > endDate) return [];
  if (!(dayOfWeek >= 1 && dayOfWeek <= 7)) return [];
  const span = daysBetween(startDate, endDate);
  if (span > MAX_RANGE_DAYS) throw new RangeError(`Khoảng ngày ${startDate} → ${endDate} dài bất thường (> ${MAX_RANGE_DAYS} ngày)`);
  const out = [];
  let cur = parseIso(startDate);
  const end = parseIso(endDate);
  // nhảy tới ngày đầu tiên đúng thứ
  const offset = (dayOfWeek - isoWeekday(startDate) + 7) % 7;
  cur += offset * 86400000;
  while (cur <= end) {
    out.push(toIso(cur));
    cur += 7 * 86400000;
  }
  return out;
}

/**
 * Sinh danh sách buổi học cụ thể cho 1 môn (cấu trúc Subject -> periods -> sessions).
 * Loại trùng (cùng ngày + cùng tiết + cùng phòng) để không tạo buổi trùng do lỗi import.
 */
function expandSubject(subject) {
  const meetings = [];
  const seen = new Set();
  const duplicates = [];
  (subject.periods || []).forEach((p, pi) => {
    if (p.invalid) return;
    (p.sessions || []).forEach((s, si) => {
      for (const date of expandDates(p.startDate, p.endDate, s.dayOfWeek)) {
        const k = `${date}|${s.startPeriod}-${s.endPeriod}|${s.room || ''}`;
        if (seen.has(k)) {
          duplicates.push({ date, startPeriod: s.startPeriod, endPeriod: s.endPeriod, room: s.room || null });
          continue;
        }
        seen.add(k);
        meetings.push({
          subjectKey: subject.key ?? subject.id,
          subjectName: subject.name,
          periodIndex: pi,
          sessionIndex: si,
          date,
          dayOfWeek: s.dayOfWeek,
          startPeriod: s.startPeriod,
          endPeriod: s.endPeriod,
          room: s.room || null,
        });
      }
    });
  });
  return { meetings, duplicates };
}

/**
 * @param {Array<{subjectKey, subjectName, date, startPeriod, endPeriod, room, id?, source?}>} meetings
 * @returns {Array<{ date, type, a, b, sameRoom }>}
 *   type: "duplicate" (cùng môn, cùng tiết, cùng phòng) | "overlap" (chồng tiết)
 */
function detectConflicts(meetings) {
  const byDate = new Map();
  for (const m of meetings) {
    if (m.status === 'CANCELLED') continue;
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date).push(m);
  }
  const conflicts = [];
  for (const [date, list] of byDate) {
    list.sort((x, y) => x.startPeriod - y.startPeriod);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (b.startPeriod > a.endPeriod) break; // đã sắp xếp => không còn chồng
        const sameSubject = a.subjectKey === b.subjectKey && a.source === b.source;
        const sameSlot = a.startPeriod === b.startPeriod && a.endPeriod === b.endPeriod;
        const sameRoom = (a.room || '') === (b.room || '');
        conflicts.push({
          date,
          type: sameSubject && sameSlot && sameRoom ? 'duplicate' : 'overlap',
          sameRoom,
          a: pick(a),
          b: pick(b),
          message: describe(date, a, b, sameRoom),
        });
      }
    }
  }
  return conflicts;
}

function pick(m) {
  return {
    id: m.id ?? null,
    subjectKey: m.subjectKey,
    subjectName: m.subjectName,
    startPeriod: m.startPeriod,
    endPeriod: m.endPeriod,
    room: m.room ?? null,
    source: m.source ?? 'new',
  };
}

function describe(date, a, b, sameRoom) {
  const d = `${DAY_NAMES[isoWeekday(date)]} ${date.split('-').reverse().join('/')}`;
  const room = sameRoom ? ` (cùng phòng ${a.room || '—'})` : ` (phòng ${a.room || '—'} / ${b.room || '—'})`;
  return `${d}: "${a.subjectName}" tiết ${a.startPeriod}-${a.endPeriod} trùng với "${b.subjectName}" tiết ${b.startPeriod}-${b.endPeriod}${room}`;
}

module.exports = { expandDates, expandSubject, detectConflicts, isoWeekday, toIso, parseIso, daysBetween, DAY_NAMES, MAX_RANGE_DAYS };
