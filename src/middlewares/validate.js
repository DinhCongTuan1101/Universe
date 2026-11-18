'use strict';
/**
 * validate({ body, query, params }) – kiểm tra dữ liệu đầu vào bằng Zod.
 * Kết quả đã chuẩn hóa nằm ở req.valid.body / req.valid.query / req.valid.params.
 * (Express 5 không cho gán lại req.query nên dùng req.valid.)
 */
function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid || {};
    for (const key of ['params', 'query', 'body']) {
      if (!schemas[key]) continue;
      const result = schemas[key].safeParse(req[key] ?? {});
      if (!result.success) return next(result.error);
      req.valid[key] = result.data;
    }
    next();
  };
}

module.exports = { validate };
