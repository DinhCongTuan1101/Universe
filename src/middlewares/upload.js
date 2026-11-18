'use strict';
/**
 * Multer lưu file tạm trong RAM (memoryStorage) để backend kiểm tra nội dung (magic bytes)
 * TRƯỚC khi ghi xuống đĩa với tên ngẫu nhiên. Không tin tên file / MIME từ trình duyệt.
 */
const multer = require('multer');
const config = require('../config');

function uploader({ maxBytes = config.storage.maxUploadBytes, maxFiles = 10 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: maxFiles, fields: 20, fieldSize: 64 * 1024 },
  });
}

/** Multer giải mã tên file theo latin1 – chuyển lại UTF-8 để giữ tên tiếng Việt. */
function decodeOriginalName(name) {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('�') ? name : decoded;
  } catch {
    return name;
  }
}

module.exports = { uploader, decodeOriginalName };
