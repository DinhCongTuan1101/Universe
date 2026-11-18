'use strict';
const logger = require('../utils/logger');

/** Ghi log request API: method, đường dẫn (không có query string), status, thời gian. Không ghi body/cookie. */
function requestLogger(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const line = `${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${ms.toFixed(1)}ms`;
    const meta = req.user ? { userId: req.user.id } : undefined;
    if (res.statusCode === 500) logger.error(line, meta);
    else if (res.statusCode > 500) logger.warn(line, meta);
    else if (res.statusCode >= 400) logger.info(line, meta);
    else logger.debug(line, meta);
  });
  next();
}

module.exports = { requestLogger };
