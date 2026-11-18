'use strict';
/** Chuyển đổi giữa chuỗi "YYYY-MM-DD" và Date (UTC 00:00) dùng cho cột @db.Date. */
const toDbDate = (iso) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);
const fromDbDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Ngày hiện tại theo giờ Việt Nam (dạng YYYY-MM-DD) */
function todayVN() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

module.exports = { toDbDate, fromDbDate, todayVN };
