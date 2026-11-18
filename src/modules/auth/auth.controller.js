'use strict';
const service = require('./auth.service');
const { issueCsrfToken } = require('../../middlewares/csrf');
const { ok, created } = require('../../utils/response');
const config = require('../../config');

/** Tạo session mới sau khi đăng nhập (chống session fixation), sau đó cấp CSRF token mới. */
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.seenAt = Date.now();
      const csrfToken = issueCsrfToken(req);
      req.session.save(async (err2) => {
        if (err2) return reject(err2);
        try {
          await service.recordSession(user.id, req.sessionID, req);
          resolve(csrfToken);
        } catch (e) {
          reject(e);
        }
      });
    });
  });
}

async function csrf(req, res) {
  ok(res, { csrfToken: issueCsrfToken(req) });
}

async function status(req, res) {
  ok(res, { authenticated: Boolean(req.user), user: req.user || null, csrfToken: issueCsrfToken(req), aiConfigured: config.ai.configured });
}

async function register(req, res) {
  const user = await service.register(req.valid.body);
  const csrfToken = await startSession(req, user);
  created(res, { user, csrfToken }, 'Đăng ký thành công');
}

async function login(req, res) {
  const user = await service.verifyCredentials(req.valid.body);
  const csrfToken = await startSession(req, user);
  ok(res, { user, csrfToken }, 'Đăng nhập thành công');
}

async function logout(req, res) {
  const sid = req.sessionID;
  await service.forgetSession(sid);
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie(config.session.cookieName, { httpOnly: true, sameSite: 'lax', secure: config.isProd });
  ok(res, null, 'Đã đăng xuất');
}

async function changePassword(req, res) {
  const result = await service.changePassword(req.user.id, req.valid.body, req.sessionID);
  ok(res, result, 'Đổi mật khẩu thành công');
}

async function listSessions(req, res) {
  ok(res, await service.listSessions(req.user.id, req.sessionID));
}

async function revokeSession(req, res) {
  await service.revokeSession(req.user.id, req.valid.params.id, req.sessionID);
  ok(res, null, 'Đã đăng xuất thiết bị');
}

module.exports = { csrf, status, register, login, logout, changePassword, listSessions, revokeSession };
