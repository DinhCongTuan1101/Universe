'use strict';
const { Router } = require('express');
const c = require('./auth.controller');
const v = require('./auth.validators');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { authLimiter, sensitiveLimiter } = require('../../middlewares/rateLimiters');
const { idParams } = require('../../utils/schemas');

const r = Router();

r.get('/csrf', c.csrf);
r.get('/status', c.status);
r.post('/register', authLimiter, validate({ body: v.register }), c.register);
r.post('/login', authLimiter, validate({ body: v.login }), c.login);
r.post('/logout', c.logout);
r.post('/change-password', requireAuth, sensitiveLimiter, validate({ body: v.changePassword }), c.changePassword);
r.get('/sessions', requireAuth, c.listSessions);
r.delete('/sessions/:id', requireAuth, validate({ params: idParams }), c.revokeSession);

module.exports = r;
