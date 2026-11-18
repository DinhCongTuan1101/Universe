'use strict';
const { PrismaClient } = require('@prisma/client');
const config = require('../config');

// Một instance PrismaClient dùng chung cho toàn ứng dụng (tránh mở quá nhiều kết nối).
const prisma = new PrismaClient({
  datasources: { db: { url: config.databaseUrl } },
  log: config.isProd ? ['error'] : ['warn', 'error'],
});

module.exports = prisma;
