'use strict';
/**
 * Logger tối giản: in ra console (định dạng 1 dòng) và ghi lỗi vào logs/error.log.
 * Tự động che (redact) các khóa nhạy cảm: password, cookie, token, apiKey, secret...
 */
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const SENSITIVE = /pass(word)?|cookie|token|secret|api[-_]?key|authorization|session/i;

let currentLevel = 'info';
let logDir = null;

function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 4) return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

function write(level, message, meta) {
  if (LEVELS[level] > LEVELS[currentLevel]) return;
  const time = new Date().toISOString();
  const safeMeta = meta === undefined ? undefined : redact(meta);
  const line = `${time} ${level.toUpperCase().padEnd(5)} ${message}${safeMeta ? ' ' + JSON.stringify(safeMeta) : ''}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  if (level === 'error' && logDir) {
    fs.appendFile(path.join(logDir, 'error.log'), line + '\n', () => {});
  }
}

module.exports = {
  init({ level, dir }) {
    currentLevel = level in LEVELS ? level : 'info';
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      logDir = dir;
    }
  },
  error: (m, meta) => write('error', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  info: (m, meta) => write('info', m, meta),
  debug: (m, meta) => write('debug', m, meta),
  redact,
};
