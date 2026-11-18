'use strict';
const path = require('node:path');
const config = require('./config');
const logger = require('./utils/logger');

logger.init({ level: config.logLevel, dir: path.join(config.rootDir, 'logs') });

const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const prisma = require('./database/prisma');
const { createApp } = require('./app');
const jobs = require('./services/jobs');

function mysqlOptionsFromUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

async function main() {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.error('Không kết nối được MySQL. Kiểm tra DATABASE_URL trong .env và đã chạy "npm run db:deploy" chưa.', {
      error: err.message,
    });
    process.exit(1);
  }

  const MySQLStore = MySQLStoreFactory(session);
  const sessionStore = new MySQLStore({
    ...mysqlOptionsFromUrl(config.databaseUrl),
    createDatabaseTable: false, // bảng `sessions` do Prisma migration tạo
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: config.session.ttlMs,
    schema: { tableName: 'sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
  });

  const app = createApp({ sessionStore });
  const server = app.listen(config.port, () => {
    logger.info(`UniVerse đang chạy tại http://localhost:${config.port} (môi trường: ${config.env})`);
    logger.info(
      config.ai.configured
        ? `AI provider: ${config.ai.provider} – model: ${config.ai.chatModel}`
        : `AI chưa được cấu hình: ${config.ai.problem} – các tính năng AI sẽ bị tắt.`
    );
  });

  jobs.start();

  const shutdown = async (signal) => {
    logger.info(`Nhận tín hiệu ${signal}, đang dừng server...`);
    jobs.stop();
    server.close(async () => {
      await sessionStore.close().catch(() => {});
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', { error: reason }));

main();
