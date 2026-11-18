/** Định dạng ngày giờ, dung lượng… theo tiếng Việt. */

export const DAY_NAMES = ['', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
export const DAY_SHORT = ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const pad = (n) => String(n).padStart(2, '0');

/** Date -> "YYYY-MM-DD" theo giờ địa phương của trình duyệt */
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseIsoDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
/** Thứ 2 đầu tuần */
export function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = x.getDay() || 7;
  x.setDate(x.getDate() - (wd - 1));
  return x;
}
export function isoWeekday(d) {
  return d.getDay() || 7;
}

export function fmtDate(v, opts = {}) {
  if (!v) return '';
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseIsoDate(v) : new Date(v);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', ...opts });
}
export function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  return `${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtTime(v) {
  const d = new Date(v);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtDayLabel(iso) {
  const d = parseIsoDate(iso);
  return `${DAY_NAMES[isoWeekday(d)]}, ${fmtDate(iso)}`;
}

export function relativeTime(v) {
  if (!v) return '';
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const unit = abs < 60 ? null : abs < 3600 ? [Math.round(abs / 60), 'phút'] : abs < 86400 ? [Math.round(abs / 3600), 'giờ'] : abs < 86400 * 30 ? [Math.round(abs / 86400), 'ngày'] : null;
  if (!unit) return abs < 60 ? 'vừa xong' : fmtDate(v);
  return future ? `${unit[0]} ${unit[1]} nữa` : `${unit[0]} ${unit[1]} trước`;
}

/** Hạn chót: "Quá hạn 2 ngày", "Hôm nay 17:00", "Ngày mai", ... */
export function dueLabel(v) {
  if (!v) return { text: 'Không có hạn', tone: '' };
  const d = new Date(v);
  const now = new Date();
  const days = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d < now) return { text: days === 0 ? `Quá hạn (hôm nay ${time})` : `Quá hạn ${Math.abs(days)} ngày`, tone: 'danger' };
  if (days === 0) return { text: `Hôm nay ${time}`, tone: 'warning' };
  if (days === 1) return { text: `Ngày mai ${time}`, tone: 'warning' };
  if (days < 7) return { text: `${DAY_NAMES[isoWeekday(d)]} ${time}`, tone: 'info' };
  return { text: fmtDateTime(v), tone: '' };
}

export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/** datetime-local value <-> ISO */
export function toLocalInput(v) {
  if (!v) return '';
  const d = new Date(v);
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(s) {
  return s ? new Date(s).toISOString() : null;
}

export const PRIORITY = {
  LOW: { label: 'Thấp', tone: '' },
  MEDIUM: { label: 'Trung bình', tone: 'info' },
  HIGH: { label: 'Cao', tone: 'warning' },
  URGENT: { label: 'Khẩn cấp', tone: 'danger' },
};
export const STATUS = {
  TODO: { label: 'Cần làm', tone: '' },
  IN_PROGRESS: { label: 'Đang làm', tone: 'primary' },
  DONE: { label: 'Hoàn thành', tone: 'success' },
};

export function periodLabel(start, end) {
  return start === end ? `Tiết ${start}` : `Tiết ${start}–${end}`;
}

/** Giờ học theo cấu hình Class Periods (nếu quản trị viên đã nhập) */
export function periodTime(classPeriods, start, end) {
  const s = classPeriods?.find((p) => p.periodNumber === start)?.startTime;
  const e = classPeriods?.find((p) => p.periodNumber === end)?.endTime;
  return s && e ? `${s}–${e}` : null;
}

export const FILE_ICONS = {
  pdf: { icon: 'file-text', color: '#ef4444' },
  docx: { icon: 'file-text', color: '#2563eb' },
  doc: { icon: 'file-text', color: '#2563eb' },
  xlsx: { icon: 'sheet', color: '#16a34a' },
  xls: { icon: 'sheet', color: '#16a34a' },
  csv: { icon: 'sheet', color: '#16a34a' },
  pptx: { icon: 'layout', color: '#ea580c' },
  ppt: { icon: 'layout', color: '#ea580c' },
  png: { icon: 'image', color: '#db2777' },
  jpg: { icon: 'image', color: '#db2777' },
  gif: { icon: 'image', color: '#db2777' },
  webp: { icon: 'image', color: '#db2777' },
  txt: { icon: 'file', color: '#64748b' },
  md: { icon: 'file', color: '#64748b' },
  zip: { icon: 'layers', color: '#a16207' },
};
