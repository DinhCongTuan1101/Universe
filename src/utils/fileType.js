'use strict';
/**
 * Nhận diện loại file dựa trên NỘI DUNG (magic bytes), không tin tên/MIME từ trình duyệt.
 * Trả về { ext, mime, kind } hoặc null nếu không hỗ trợ / nội dung không khớp phần mở rộng.
 */

const TYPES = {
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'docx' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'spreadsheet' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'office' },
  doc: { mime: 'application/msword', kind: 'office' },
  xls: { mime: 'application/vnd.ms-excel', kind: 'spreadsheet' },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'office' },
  zip: { mime: 'application/zip', kind: 'archive' },
  png: { mime: 'image/png', kind: 'image' },
  jpg: { mime: 'image/jpeg', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  txt: { mime: 'text/plain', kind: 'text' },
  md: { mime: 'text/markdown', kind: 'text' },
  csv: { mime: 'text/csv', kind: 'text' },
};

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

function sniffBinary(buf) {
  if (buf.length < 4) return null;
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (buf.length >= 12 && startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole'; // doc/xls/ppt
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    // ZIP: phân biệt OOXML bằng tên entry (lưu dạng văn bản trong central directory)
    const s = buf.toString('latin1');
    if (s.includes('word/')) return 'docx';
    if (s.includes('xl/')) return 'xlsx';
    if (s.includes('ppt/')) return 'pptx';
    return 'zip';
  }
  return null;
}

function isProbablyText(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  if (sample.includes(0)) return false;
  try {
    // stream: true => không báo lỗi nếu mẫu bị cắt giữa một ký tự nhiều byte
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: sample.length < buf.length });
    return true;
  } catch {
    return false;
  }
}

function extOf(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name || '');
  const ext = m ? m[1].toLowerCase() : '';
  return ext === 'jpeg' ? 'jpg' : ext;
}

/**
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {string[]} [allowed] danh sách ext cho phép (mặc định: tất cả TYPES)
 */
function detectFileType(buffer, originalName, allowed = Object.keys(TYPES)) {
  const claimed = extOf(originalName);
  const sniffed = sniffBinary(buffer);
  let ext = null;
  if (sniffed === 'ole') {
    if (['doc', 'xls', 'ppt'].includes(claimed)) ext = claimed;
  } else if (sniffed) {
    ext = sniffed;
  } else if (['txt', 'md', 'csv'].includes(claimed) && isProbablyText(buffer)) {
    ext = claimed;
  }
  if (!ext || !allowed.includes(ext)) return null;
  return { ext, ...TYPES[ext] };
}

module.exports = { detectFileType, extOf, TYPES };
