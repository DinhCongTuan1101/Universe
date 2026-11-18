'use strict';
/**
 * Registry các Import Adapter cho UniSchedule.
 *
 * Mỗi adapter: { id, name, detect(workbook) => 0..1, parse(workbook) => ParsedSchedule }
 * ParsedSchedule = {
 *   adapter, sheetName,
 *   meta: { semester: { term, academicYear, phase, label }, student: {...}, totalCredits, shifts, shiftNotes },
 *   subjects: [{ key, code, name, credits, classCode, lecturer, rawTimeText, warnings,
 *                periods: [{ startDate, endDate, rawText, invalid, sessions: [{ dayOfWeek, periods, startPeriod, endPeriod, room, note, rawText }] }] }],
 *   warnings: [], errors: []
 * }
 * Thêm trường mới: viết file xxx.adapter.js và đăng ký vào ADAPTERS – không cần sửa nghiệp vụ UniSchedule.
 */
const XLSX = require('xlsx');
const { parse: parseCsv } = require('csv-parse/sync');
const { readWorkbook } = require('./sheetGrid');
const { detectFileType } = require('../../../utils/fileType');
const { badRequest, unprocessable } = require('../../../utils/errors');

const ADAPTERS = [require('./kma.adapter'), require('./generic.adapter')];

function listAdapters() {
  return ADAPTERS.map((a) => ({ id: a.id, name: a.name }));
}

function loadWorkbook(buffer, originalName) {
  const type = detectFileType(buffer, originalName, ['xls', 'xlsx', 'csv', 'txt']);
  if (!type) throw badRequest('Chỉ hỗ trợ file .xls, .xlsx hoặc .csv (nội dung file không khớp định dạng).');
  if (type.ext === 'csv' || type.ext === 'txt') {
    let text = buffer.toString('utf8').replace(/^﻿/, '');
    const delimiter = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    let records;
    try {
      records = parseCsv(text, { delimiter, relax_column_count: true, skip_empty_lines: false, bom: true });
    } catch (err) {
      throw unprocessable(`CSV không hợp lệ: ${err.message}`);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(records), 'CSV');
    return { workbook: wb, format: 'csv' };
  }
  try {
    return { workbook: readWorkbook(buffer), format: type.ext };
  } catch {
    throw unprocessable('Không đọc được file bảng tính (file hỏng hoặc được bảo vệ bằng mật khẩu).');
  }
}

/**
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {string} [adapterId] chỉ định adapter; bỏ trống = tự nhận diện
 */
function parseScheduleFile(buffer, originalName, adapterId) {
  const { workbook, format } = loadWorkbook(buffer, originalName);
  let adapter;
  if (adapterId) {
    adapter = ADAPTERS.find((a) => a.id === adapterId);
    if (!adapter) throw badRequest('Định dạng import không được hỗ trợ');
  } else {
    const scored = ADAPTERS.map((a) => ({ a, score: a.detect(workbook) })).sort((x, y) => y.score - x.score);
    adapter = scored[0].score > 0 ? scored[0].a : ADAPTERS[0];
  }
  const result = adapter.parse(workbook);
  result.format = format;
  return result;
}

module.exports = { parseScheduleFile, listAdapters, ADAPTERS };
