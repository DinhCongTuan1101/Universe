'use strict';
/**
 * Kiểm thử parser thời khóa biểu KMA.
 *  - Fixture ẩn danh (luôn chạy): tests/fixtures/kma-*.xls(x) – mô phỏng cấu trúc file thật.
 *  - File thật (nếu có trong tests/fixtures/kma/): chỉ kiểm tra cấu trúc, KHÔNG in thông tin cá nhân.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const { parseScheduleFile } = require('../../src/modules/schedule/importers');
const { parseTimeLocation, parsePeriodList } = require('../../src/modules/schedule/importers/timeText');
const { expandSubject, detectConflicts } = require('../../src/modules/schedule/schedule.logic');

const FIX = path.join(__dirname, '..', 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f));

test('fixture ẩn danh tồn tại (chạy build-anonymized-fixture.js nếu thiếu)', () => {
  if (!fs.existsSync(path.join(FIX, 'kma-anonymized.xls'))) require('../fixtures/build-anonymized-fixture').build();
  assert.ok(fs.existsSync(path.join(FIX, 'kma-anonymized.xls')));
});

for (const file of ['kma-anonymized.xls', 'kma-anonymized.xlsx']) {
  test(`[${file}] đọc thông tin học kỳ, sinh viên và danh sách học phần`, () => {
    const r = parseScheduleFile(read(file), file);
    assert.equal(r.adapter, 'kma');
    assert.equal(r.sheetName, 'ThoiKhoaBieuSV');
    assert.deepEqual(r.errors, []);
    assert.equal(r.meta.semester.term, '1');
    assert.equal(r.meta.semester.academicYear, '2026-2027');
    assert.equal(r.meta.semester.phase, '1');
    assert.equal(r.meta.student.className, 'LOP-TEST');
    assert.equal(r.meta.student.major, 'Ngành Kiểm Thử');
    assert.equal(r.subjects.length, 7);
    assert.equal(r.meta.totalCredits, 21);
    assert.equal(r.meta.declaredTotalCredits, 21);
    assert.deepEqual(
      r.subjects.map((s) => s.code),
      ['HP001', 'HP002', 'HP003', 'HP004', 'HP005', 'HP006', 'HP007']
    );
    assert.deepEqual(r.subjects.map((s) => s.credits), [3, 3, 2, 3, 4, 3, 3]);
    assert.equal(r.subjects[0].classCode, 'HP001-L01');
    assert.equal(r.subjects[0].fee, 1500000);
  });

  test(`[${file}] nhiều khoảng lịch + nhiều thứ trong một môn`, () => {
    const r = parseScheduleFile(read(file), file);
    const hp1 = r.subjects[0];
    assert.equal(hp1.periods.length, 3);
    assert.deepEqual(
      hp1.periods.map((p) => [p.startDate, p.endDate, p.sessions.map((s) => s.dayOfWeek)]),
      [
        ['2026-08-10', '2026-08-23', [2, 4]],
        ['2026-08-24', '2026-08-30', [2, 3, 4]],
        ['2026-08-31', '2026-09-06', [4]],
      ]
    );
    for (const p of hp1.periods) {
      for (const s of p.sessions) {
        assert.deepEqual(s.periods, [1, 2, 3]);
        assert.equal(s.startPeriod, 1);
        assert.equal(s.endPeriod, 3);
        assert.equal(s.room, '604-TA1');
      }
    }
  });

  test(`[${file}] học phần kéo dài 2 dòng do ô gộp được ghép đúng`, () => {
    const r = parseScheduleFile(read(file), file);
    const hp4 = r.subjects.find((s) => s.code === 'HP004');
    assert.equal(hp4.periods.length, 2);
    assert.deepEqual(hp4.periods[1].sessions.map((s) => [s.dayOfWeek, s.startPeriod, s.endPeriod, s.room]), [
      [6, 1, 3, '406-TA1'],
      [2, 9, 10, '406-TA1'],
    ]);
    // Không sinh học phần "ma" từ dòng tiếp nối
    assert.equal(r.subjects.filter((s) => s.name === 'Học phần Kiểm thử Bốn').length, 1);
  });

  test(`[${file}] ghi nhận ghi chú buổi sáng/chiều nhưng không đoán giờ`, () => {
    const r = parseScheduleFile(read(file), file);
    assert.deepEqual(r.meta.shifts, [
      { shift: 'MORNING', fromPeriod: 1, toPeriod: 5 },
      { shift: 'AFTERNOON', fromPeriod: 6, toPeriod: 10 },
    ]);
  });
}

test('tạo đúng ngày học cụ thể, không tạo ngoài khoảng ngày', () => {
  const r = parseScheduleFile(read('kma-anonymized.xls'), 'kma-anonymized.xls');
  const { meetings } = expandSubject(r.subjects[0]);
  const dates = meetings.map((m) => m.date);
  assert.deepEqual(dates, [
    // 10/08–23/08: Thứ 3 & Thứ 5
    '2026-08-11', '2026-08-18', '2026-08-13', '2026-08-20',
    // 24/08–30/08: Thứ 3, 4, 5
    '2026-08-25', '2026-08-26', '2026-08-27',
    // 31/08–06/09: Thứ 5
    '2026-09-03',
  ]);
  for (const m of meetings) {
    assert.ok(m.date >= '2026-08-10' && m.date <= '2026-09-06');
  }
  // Mỗi ngày đúng thứ yêu cầu
  for (const m of meetings) {
    const wd = new Date(`${m.date}T00:00:00Z`).getUTCDay() || 7;
    assert.equal(wd, m.dayOfWeek);
  }
});

test('phát hiện xung đột giữa HP001 và HP006 (Thứ 3 11/08, tiết 1-3 vs 2-4)', () => {
  const r = parseScheduleFile(read('kma-anonymized.xls'), 'kma-anonymized.xls');
  const all = r.subjects.flatMap((s) => expandSubject(s).meetings);
  const conflicts = detectConflicts(all);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].date, '2026-08-11');
  assert.equal(conflicts[0].type, 'overlap');
  assert.equal(conflicts[0].sameRoom, false);
  assert.deepEqual([conflicts[0].a.subjectName, conflicts[0].b.subjectName].sort(), ['Học phần Kiểm thử Một', 'Học phần Kiểm thử Sáu']);
});

test('phát hiện buổi học trùng lặp do lỗi import', () => {
  const m = { subjectKey: 's1', subjectName: 'A', date: '2026-09-01', startPeriod: 1, endPeriod: 3, room: 'P1' };
  const conflicts = detectConflicts([m, { ...m }]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, 'duplicate');
  // expandSubject tự loại trùng khi cùng ngày + tiết + phòng
  const { meetings, duplicates } = expandSubject({
    key: 's1',
    name: 'A',
    periods: [
      { startDate: '2026-09-01', endDate: '2026-09-07', sessions: [{ dayOfWeek: 2, startPeriod: 1, endPeriod: 3, room: 'P1' }] },
      { startDate: '2026-09-01', endDate: '2026-09-07', sessions: [{ dayOfWeek: 2, startPeriod: 1, endPeriod: 3, room: 'P1' }] },
    ],
  });
  assert.equal(meetings.length, 1);
  assert.equal(duplicates.length, 1);
});

test('file mẫu chưa có học phần: không lỗi, 0 môn, có cảnh báo', () => {
  const r = parseScheduleFile(read('kma-empty.xls'), 'kma-empty.xls');
  assert.deepEqual(r.errors, []);
  assert.equal(r.subjects.length, 0);
  assert.equal(r.meta.semester.academicYear, '2026-2027');
  assert.ok(r.warnings.some((w) => w.includes('không có học phần')));
});

test('file thiếu cột Thời gian địa điểm: báo lỗi rõ ràng', () => {
  const r = parseScheduleFile(read('kma-missing-column.xls'), 'kma-missing-column.xls');
  assert.equal(r.subjects.length, 0);
  assert.match(r.errors[0], /thiếu cột Thời gian địa điểm/);
});

test('file không phải bảng tính bị từ chối (kiểm tra nội dung, không tin phần mở rộng)', () => {
  assert.throws(() => parseScheduleFile(Buffer.from('%PDF-1.4 fake'), 'tkb.xls'), /Chỉ hỗ trợ/);
  assert.throws(() => parseScheduleFile(Buffer.from([0, 1, 2, 3, 4, 5]), 'tkb.csv'), /Chỉ hỗ trợ/);
});

test('vị trí bảng thay đổi (thêm dòng/cột trống phía trước) vẫn nhận diện được', () => {
  const rows = [
    [],
    [],
    ['', 'Học kỳ 2 - Năm học 2027-2028'],
    [],
    ['', '', 'Tên học phần', 'Mã học phần', 'Thời gian địa điểm', 'Số tín chỉ'],
    ['', '', 'Môn X', 'MX1', 'Từ 01/03/2028 đến 14/03/2028:\nThứ 2 tiết 6-8 tại A101', '2'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const r = parseScheduleFile(buf, 'x.xlsx', 'kma');
  assert.equal(r.subjects.length, 1);
  assert.equal(r.subjects[0].code, 'MX1');
  assert.equal(r.subjects[0].credits, 2);
  assert.equal(r.meta.semester.term, '2');
  assert.deepEqual(r.subjects[0].periods[0].sessions[0].periods, [6, 7, 8]);
});

test('parseTimeLocation: dữ liệu không hợp lệ sinh cảnh báo, không đoán', () => {
  const r = parseTimeLocation('Từ 31/02/2026 đến 06/03/2026:\nThứ 2 tiết 1,2\nabc xyz\nThứ 9 tiết 1');
  assert.equal(r.periods[0].invalid, true);
  assert.ok(r.warnings.some((w) => w.includes('Ngày không hợp lệ')));
  assert.ok(r.warnings.some((w) => w.includes('Không nhận diện được')));
});

test('parseTimeLocation: marker (n) ánh xạ địa điểm; CN-A không bị hiểu là Chủ nhật', () => {
  const r = parseTimeLocation('Từ 01/09/2026 đến 07/09/2026: (1)\n  Thứ 4 tiết 1,2,3 (LT)\n(1) 302-TA2\nTừ 08/09/2026 đến 14/09/2026:\n Chủ nhật tiết 6-8 tại CN-A');
  assert.equal(r.periods[0].sessions[0].room, '302-TA2');
  assert.equal(r.periods[0].sessions[0].note, 'LT');
  assert.equal(r.periods[1].sessions.length, 1);
  assert.equal(r.periods[1].sessions[0].dayOfWeek, 7);
  assert.equal(r.periods[1].sessions[0].room, 'CN-A');
});

test('parsePeriodList', () => {
  assert.deepEqual(parsePeriodList('1,2,3'), [1, 2, 3]);
  assert.deepEqual(parsePeriodList('6-8'), [6, 7, 8]);
  assert.deepEqual(parsePeriodList('1 đến 3'), [1, 2, 3]);
  assert.equal(parsePeriodList('1,2,60'), null);
  assert.equal(parsePeriodList('a'), null);
});

// ---------- File thật (nếu người dùng đã đặt vào tests/fixtures/kma/) ----------
const REAL_DIR = path.join(FIX, 'kma');
const realFiles = fs.existsSync(REAL_DIR) ? fs.readdirSync(REAL_DIR).filter((f) => /\.xlsx?$/i.test(f)) : [];

test('file KMA thật: cấu trúc đọc được', { skip: realFiles.length ? false : 'Chưa có file thật trong tests/fixtures/kma/' }, () => {
  for (const f of realFiles) {
    const r = parseScheduleFile(fs.readFileSync(path.join(REAL_DIR, f)), f);
    assert.equal(r.adapter, 'kma', f);
    assert.deepEqual(r.errors, [], f);
    assert.ok(r.meta.semester.academicYear, `${f}: thiếu năm học`);
    for (const s of r.subjects) {
      assert.ok(s.name, `${f}: học phần thiếu tên`);
      assert.ok(s.periods.length > 0, `${f}: ${s.code} không có khoảng lịch`);
      for (const p of s.periods) {
        assert.equal(p.invalid, false, `${f}: ${s.code} khoảng ngày lỗi`);
        assert.ok(p.sessions.length > 0, `${f}: ${s.code} khoảng ngày không có buổi`);
      }
    }
  }
  // File có dữ liệu thực tế: 7 học phần / 21 tín chỉ (theo mô tả của người dùng)
  const withData = realFiles
    .map((f) => parseScheduleFile(fs.readFileSync(path.join(REAL_DIR, f)), f))
    .find((r) => r.subjects.length > 0);
  if (withData) {
    assert.equal(withData.subjects.length, 7);
    assert.equal(withData.meta.totalCredits, 21);
  }
});
