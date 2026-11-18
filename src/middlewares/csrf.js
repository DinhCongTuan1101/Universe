'use strict';
/**
 * CSRF protection kiểu "synchronizer token" cho mô hình session-cookie:
 *  - Token ngẫu nhiên lưu trong session (phía server).
 *  - Frontend lấy token qua GET /api/v1/auth/csrf và gửi lại trong header X-CSRF-Token
 *    cho mọi request thay đổi dữ liệu (POST/PUT/PATCH/DELETE).
 *  - Trang web khác không đọc được token (Same-Origin Policy) nên không giả mạo được request.
 */
const crypto = require('node:crypto');
const { forbidden } = require('../utils/errors');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function issueCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  }
  return req.session.csrfToken;
}

function verifyCsrf(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session?.csrfToken;
  const actual = req.get('x-csrf-token');
  if (!expected || !actual) return next(forbidden('Thiếu CSRF token. Hãy tải lại trang.', { code: 'CSRF' }));
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(forbidden('CSRF token không hợp lệ. Hãy tải lại trang.', { code: 'CSRF' }));
  }
  next();
}

module.exports = { issueCsrfToken, verifyCsrf };
