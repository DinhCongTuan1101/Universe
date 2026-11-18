'use strict';
/**
 * Lưu file riêng tư trong storage/ (KHÔNG nằm trong public/).
 * Tên file trên đĩa là chuỗi ngẫu nhiên, không chứa tên gốc do người dùng gửi.
 * Truy cập file chỉ qua API có kiểm tra quyền.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { badRequest } = require('../utils/errors');

for (const dir of [config.storage.uploadDir, config.storage.avatarDir]) fs.mkdirSync(dir, { recursive: true });

const SAFE_NAME = /^[a-f0-9]{32}\.[a-z0-9]{1,8}$/;

function resolveSafe(dir, storedName) {
  if (!SAFE_NAME.test(storedName)) throw badRequest('Tên file lưu trữ không hợp lệ');
  return path.join(dir, storedName);
}

async function save(buffer, ext, dir = config.storage.uploadDir) {
  const storedName = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await fsp.writeFile(resolveSafe(dir, storedName), buffer, { flag: 'wx' });
  return { storedName, checksum: crypto.createHash('sha256').update(buffer).digest('hex') };
}

async function copy(storedName, ext, dir = config.storage.uploadDir) {
  const newName = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await fsp.copyFile(resolveSafe(dir, storedName), resolveSafe(dir, newName), fs.constants.COPYFILE_EXCL);
  return newName;
}

async function remove(storedName, dir = config.storage.uploadDir) {
  await fsp.rm(resolveSafe(dir, storedName), { force: true });
}

function absolutePath(storedName, dir = config.storage.uploadDir) {
  return resolveSafe(dir, storedName);
}

async function read(storedName, dir = config.storage.uploadDir) {
  return fsp.readFile(resolveSafe(dir, storedName));
}

module.exports = { save, copy, remove, read, absolutePath };
