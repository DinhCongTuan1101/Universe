'use strict';
/**
 * Tạo Express app (tách khỏi server.js để bộ test dùng lại được với Supertest).
 * Một server duy nhất phục vụ cả API (/api/v1) và frontend tĩnh (public/).
 */
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');

const config = require('./config');
const { requestLogger } = require('./middlewares/requestLogger');
const { loadUser } = require('./middlewares/auth');
const { verifyCsrf } = require('./middlewares/csrf');
const { apiLimiter } = require('./middlewares/rateLimiters');
const { errorHandler, notFoundApi } = require('./middlewares/errorHandler');
const apiRouter = require('./routes');

function createApp({ sessionStore } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-src': ["'self'", 'blob:'],
          'object-src': ["'none'"],
          'frame-ancestors': ["'self'"],
          'upgrade-insecure-requests': config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use(
    session({
      name: config.session.cookieName,
      secret: config.session.secret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd,
        maxAge: config.session.ttlMs,
      },
    })
  );

  app.use(requestLogger);

  // ---------- API ----------
  app.use('/api/v1', apiLimiter, loadUser, verifyCsrf, apiRouter);
  app.use('/api', notFoundApi);

  // ---------- Frontend tĩnh ----------
  const publicDir = path.join(config.rootDir, 'public');
  app.use(express.static(publicDir, { index: false, maxAge: config.isProd ? '1h' : 0 }));

  // SPA fallback: mọi đường dẫn không phải file/API trả về app shell, router phía client xử lý tiếp.
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (path.extname(req.path)) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((req, res) => {
    res.status(404).sendFile(path.join(publicDir, 'pages', '404.html'));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
