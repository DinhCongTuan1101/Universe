'use strict';
/**
 * Sinh các fixture thời khóa biểu KMA ĐÃ ẨN DANH (không có thông tin cá nhân thật).
 * Mô phỏng cấu trúc file "ThoiKhoaBieuSinhVien.xls": sheet ThoiKhoaBieuSV, phần đầu trang,
 * tiêu đề 2 dòng có ô gộp, ô nhiều dòng, học phần kéo dài 2 dòng, dòng trống, dòng tổng, ghi chú tiết.
 *
 * Chạy: node tests/fixtures/build-anonymized-fixture.js
 */
const path = require('node:path');
const XLSX = require('xlsx');

const OUT = __dirname;

const HEADER_ROWS = [
  ['BAN CƠ YẾU CHÍNH PHỦ', '', '', '', 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', '', '', ''],
  ['HỌC VIỆN KỸ THUẬT MẬT MÃ', '', '', '', 'Độc lập - Tự do - Hạnh phúc', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['THỜI KHÓA BIỂU SINH VIÊN', '', '', '', '', '', '', ''],
  ['Học kỳ 1 - Năm học 2026 - 2027 - Đợt học 1', '', '', '', '', '', '', ''],
  ['Họ tên:', 'Sinh Viên Ẩn Danh', '', '', 'Mã SV:', 'XX000000', '', ''],
  ['Lớp:', 'LOP-TEST', '', 'Khóa:', 'K00', 'Ngành:', 'Ngành Kiểm Thử', ''],
  ['', '', '', '', '', '', '', ''],
  ['STT', 'Mã học phần', 'Tên học phần', 'Số TC', 'Lớp học phần', 'Ghế', 'Thời gian địa điểm', 'Học phí'],
  ['', '', '', '', '', '', '', ''], // dòng thứ 2 của tiêu đề (ô gộp dọc)
];

function t(...lines) {
  return lines.join('\n');
}

const COURSES = [
  [
    1, 'HP001', 'Học phần Kiểm thử Một', 3, 'HP001-L01', '12',
    t(
      'Từ 10/08/2026 đến 23/08/2026:',
      '    Thứ 3 tiết 1,2,3 tại 604-TA1',
      '    Thứ 5 tiết 1,2,3 tại 604-TA1',
      'Từ 24/08/2026 đến 30/08/2026:',
      '    Thứ 3 tiết 1,2,3 tại 604-TA1',
      '    Thứ 4 tiết 1,2,3 tại 604-TA1',
      '    Thứ 5 tiết 1,2,3 tại 604-TA1',
      'Từ 31/08/2026 đến 06/09/2026:',
      '    Thứ 5 tiết 1,2,3 tại 604-TA1'
    ),
    '1.500.000',
  ],
  [2, 'HP002', 'Học phần Kiểm thử Hai', 3, 'HP002-L02', '30', t('Từ 10/08/2026 đến 27/09/2026:', '    Thứ 2 tiết 6,7,8 tại 302-TA2', '    Thứ 6 tiết 6,7,8 tại 302-TA2'), '1.500.000'],
  [3, 'HP003', 'Học phần Kiểm thử Ba', 2, 'HP003-L01', '45', t('Từ 17/08/2026 đến 13/09/2026:', '    Thứ 4 tiết 4,5 tại 201-TA1'), '1.000.000'],
  // Học phần 4 kéo dài 2 dòng: dòng sau chỉ có phần tiếp theo của cột Thời gian địa điểm
  [4, 'HP004', 'Học phần Kiểm thử Bốn', 3, 'HP004-L03', '50', t('Từ 10/08/2026 đến 06/09/2026:', '    Thứ 7 tiết 1,2,3 tại 405-TA1'), '1.500.000'],
  ['', '', '', '', '', '', t('Từ 07/09/2026 đến 04/10/2026:', '    Thứ 7 tiết 1,2,3 tại 406-TA1', '    Thứ 3 tiết 9,10 tại 406-TA1'), ''],
  [5, 'HP005', 'Học phần Kiểm thử Năm', 4, 'HP005-L01', '60', t('Từ 10/08/2026 đến 20/09/2026:', '    Thứ 2 tiết 1,2,3 tại 101-TB', '    Thứ 4 tiết 6,7,8 tại 101-TB'), '2.000.000'],
  // Học phần 6 cố ý trùng lịch với HP001 (Thứ 3 tiết 1-3 tuần 10/08–16/08) để kiểm thử phát hiện xung đột
  [6, 'HP006', 'Học phần Kiểm thử Sáu', 3, 'HP006-L02', '40', t('Từ 10/08/2026 đến 16/08/2026:', '    Thứ 3 tiết 2,3,4 tại 702-TA1'), '1.500.000'],
  ['', '', '', '', '', '', '', ''], // dòng trống giữa bảng
  [7, 'HP007', 'Học phần Kiểm thử Bảy', 3, 'HP007-L01', '35', t('Từ 14/09/2026 đến 11/10/2026:', '    Thứ 6 tiết 1,2,3 tại 305-TA2'), '1.500.000'],
];

const FOOTER = [
  ['', '', '', '', '', '', '', ''],
  ['', '', 'Tổng cộng: 21 tín chỉ', '', '', '', '', '19.000.000'],
  ['', '', '', '', '', '', '', ''],
  ['Ghi chú: Buổi sáng từ tiết 1 đến tiết 5, buổi chiều từ tiết 6 đến tiết 10', '', '', '', '', '', '', ''],
];

function merges(courseStart) {
  const m = [
    { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 7 } },
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 0, c: 4 }, e: { r: 0, c: 7 } },
  ];
  // Tiêu đề gộp dọc 2 dòng
  for (let c = 0; c < 8; c++) m.push({ s: { r: 8, c }, e: { r: 9, c } });
  // Học phần 4 (dòng courseStart+3) gộp dọc các cột STT..Ghế, Học phí với dòng tiếp nối
  const r4 = courseStart + 3;
  for (const c of [0, 1, 2, 3, 4, 5, 7]) m.push({ s: { r: r4, c }, e: { r: r4 + 1, c } });
  return m;
}

function writeSheet(rows, merge, file, sheetName = 'ThoiKhoaBieuSV') {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = merge;
  ws['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 30 }, { wch: 6 }, { wch: 14 }, { wch: 6 }, { wch: 45 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  // bookSST: lưu chuỗi trong Shared String Table như file thật (bản ghi LABEL của BIFF8 giới hạn 255 ký tự)
  XLSX.writeFile(wb, path.join(OUT, file), { bookType: file.endsWith('.xls') ? 'biff8' : 'xlsx', bookSST: true });
}

function build() {
  const courseStart = HEADER_ROWS.length;
  writeSheet([...HEADER_ROWS, ...COURSES, ...FOOTER], merges(courseStart), 'kma-anonymized.xls');
  writeSheet([...HEADER_ROWS, ...COURSES, ...FOOTER], merges(courseStart), 'kma-anonymized.xlsx');
  // File mẫu chưa có học phần
  writeSheet(
    [...HEADER_ROWS, ['', '', 'Tổng cộng: 0 tín chỉ', '', '', '', '', '']],
    merges(courseStart).filter((m) => m.s.r < courseStart),
    'kma-empty.xls'
  );
  // File thiếu cột "Thời gian địa điểm"
  const missing = [...HEADER_ROWS.slice(0, 8), ['STT', 'Mã học phần', 'Tên học phần', 'Số TC', 'Lớp học phần'], [1, 'HP001', 'Môn A', 3, 'L01']];
  writeSheet(missing, [], 'kma-missing-column.xls');
}

if (require.main === module) {
  build();
  console.log('Đã tạo fixture trong', OUT);
}

module.exports = { build };
