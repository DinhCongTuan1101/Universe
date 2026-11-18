'use strict';

/** Lỗi nghiệp vụ có mã HTTP – được errorHandler chuyển thành response chuẩn. */
class ApiError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (m = 'Yêu cầu không hợp lệ', o) => new ApiError(400, m, o);
const unauthorized = (m = 'Bạn cần đăng nhập', o) => new ApiError(401, m, o);
const forbidden = (m = 'Bạn không có quyền thực hiện thao tác này', o) => new ApiError(403, m, o);
const notFound = (m = 'Không tìm thấy dữ liệu', o) => new ApiError(404, m, o);
const conflict = (m = 'Dữ liệu bị xung đột', o) => new ApiError(409, m, o);
const unprocessable = (m = 'Dữ liệu không hợp lệ', o) => new ApiError(422, m, o);
const tooMany = (m = 'Bạn thao tác quá nhanh, vui lòng thử lại sau', o) => new ApiError(429, m, o);
const serviceUnavailable = (m = 'Dịch vụ tạm thời không khả dụng', o) => new ApiError(503, m, o);

module.exports = {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  tooMany,
  serviceUnavailable,
};
