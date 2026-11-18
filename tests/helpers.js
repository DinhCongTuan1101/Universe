'use strict';
/**
 * Tiện ích cho bộ test API (dùng database MySQL thật từ DATABASE_URL trong .env).
 * Mỗi lần chạy tạo người dùng với email ngẫu nhiên và XÓA chúng khi kết thúc – không đụng dữ liệu khác.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.AI_PROVIDER = ''; // test luôn chạy với AI "chưa cấu hình" – không gọi dịch vụ trả phí

const request = require('supertest');
const { createApp } = require('../src/app');
const prisma = require('../src/database/prisma');

const app = createApp();
const RUN = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const createdEmails = [];

async function dbAvailable() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.user.count();
    return true;
  } catch {
    return false;
  }
}

/** Client có cookie + CSRF token */
async function client() {
  const agent = request.agent(app);
  const r = await agent.get('/api/v1/auth/csrf');
  let token = r.body.data.csrfToken;
  const wrap = (method) => (url, body) => {
    let req = agent[method](url).set('X-CSRF-Token', token);
    if (body !== undefined && !(body instanceof Function)) req = req.send(body);
    return req.then((res) => {
      if (res.body?.data?.csrfToken) token = res.body.data.csrfToken;
      return res;
    });
  };
  return {
    agent,
    get: (url) => agent.get(url),
    post: wrap('post'),
    patch: wrap('patch'),
    put: wrap('put'),
    del: wrap('delete'),
    upload: (url, field, buffer, filename, fields = {}) => {
      let req = agent.post(url).set('X-CSRF-Token', token);
      for (const [k, v] of Object.entries(fields)) req = req.field(k, String(v));
      return req.attach(field, buffer, filename);
    },
    token: () => token,
  };
}

async function registeredUser(name = 'user') {
  const c = await client();
  const email = `${RUN}.${name}@test.universe`;
  createdEmails.push(email);
  const res = await c.post('/api/v1/auth/register', { email, password: 'Passw0rd!x', fullName: `Test ${name}` });
  if (res.status !== 201) throw new Error(`Đăng ký thất bại: ${res.status} ${JSON.stringify(res.body)}`);
  c.user = res.body.data.user;
  c.email = email;
  return c;
}

async function cleanup() {
  if (!createdEmails.length) return;
  const users = await prisma.user.findMany({ where: { email: { in: createdEmails } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  // File trên đĩa của user test
  const files = await prisma.driveFile.findMany({ where: { userId: { in: ids } }, select: { storedName: true } });
  const storage = require('../src/services/storage.service');
  for (const f of files) await storage.remove(f.storedName).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); // cascade toàn bộ dữ liệu liên quan
}

async function waitFor(fn, { timeout = 15000, interval = 300 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('Hết thời gian chờ');
    await new Promise((r) => setTimeout(r, interval));
  }
}

module.exports = { app, prisma, client, registeredUser, cleanup, dbAvailable, waitFor, RUN };
