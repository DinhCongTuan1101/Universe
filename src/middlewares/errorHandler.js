'use strict';
const { ZodError } = require('zod');
const multer = require('multer');
const { Prisma } = require('@prisma/client');
const config = require('../config');
const logger = require('../utils/logger');
const { ApiError } = require('../utils/errors');

function notFoundApi(req, res) {
  res.status(404).json({ success: false, message: `Không tìm thấy API ${req.method} ${req.originalUrl}`, data: null });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.';
  let code;
  let details;

  if (err instanceof ApiError) {
    ({ status, message, code, details } = err);
  } else if (err instanceof ZodError) {
    status = 422;
    message = 'Dữ liệu không hợp lệ';
    code = 'VALIDATION';
    details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File vượt quá dung lượng cho phép (${Math.round(config.storage.maxUploadBytes / 1048576)} MB)`
        : 'Upload file không hợp lệ';
    code = err.code;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      message = 'Dữ liệu đã tồn tại';
    } else if (err.code === 'P2025') {
      status = 404;
      message = 'Không tìm thấy dữ liệu';
    } else if (err.code === 'P2003') {
      status = 400;
      message = 'Dữ liệu liên kết không hợp lệ';
    }
    code = err.code;
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    status = 503;
    message = 'Không kết nối được cơ sở dữ liệu';
    code = 'DB_UNAVAILABLE';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    message = 'JSON không hợp lệ';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    message = 'Dữ liệu gửi lên quá lớn';
  }

  if (status >= 500 && err instanceof ApiError) {
    // Lỗi nghiệp vụ dự kiến (vd AI chưa cấu hình, provider lỗi) – không cần stack trace
    logger.warn(`${req.method} ${req.baseUrl}${req.path} -> ${status} ${code || ''}: ${message}`, { userId: req.user?.id });
  } else if (status >= 500) {
    logger.error(`${req.method} ${req.baseUrl}${req.path} -> ${status}`, { error: err, userId: req.user?.id });
  } else if (status !== 401 && status !== 404) {
    logger.debug(`${req.method} ${req.originalUrl} -> ${status}: ${message}`);
  }

  const body = { success: false, message, data: null };
  if (code) body.code = code;
  if (details) body.details = details;
  // Chỉ hiển thị chi tiết lỗi nội bộ khi phát triển – không bao giờ ở production.
  if (!config.isProd && status >= 500) body.debug = { name: err?.name, message: err?.message };
  res.status(status).json(body);
}

module.exports = { errorHandler, notFoundApi };
