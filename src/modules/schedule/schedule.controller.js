'use strict';
const service = require('./schedule.service');
const { parseScheduleFile, listAdapters } = require('./importers');
const { TEMPLATE_CSV } = require('./importers/generic.adapter');
const { decodeOriginalName } = require('../../middlewares/upload');
const { ok, created } = require('../../utils/response');
const { badRequest } = require('../../utils/errors');

const uid = (req) => req.user.id;
const pid = (req) => req.valid.params.id;

module.exports = {
  listSemesters: async (req, res) => ok(res, await service.listSemesters(uid(req))),
  createSemester: async (req, res) => created(res, await service.createSemester(uid(req), req.valid.body), 'Đã tạo học kỳ'),
  updateSemester: async (req, res) => ok(res, await service.updateSemester(uid(req), pid(req), req.valid.body), 'Đã cập nhật học kỳ'),
  deleteSemester: async (req, res) => {
    await service.deleteSemester(uid(req), pid(req));
    ok(res, null, 'Đã xóa học kỳ');
  },

  listSubjects: async (req, res) => ok(res, await service.listSubjects(uid(req), req.valid.query)),
  subjectOptions: async (req, res) => ok(res, await service.subjectOptions(uid(req))),
  getSubject: async (req, res) => ok(res, await service.getSubject(uid(req), pid(req))),
  createSubject: async (req, res) => created(res, await service.createSubject(uid(req), req.valid.body), 'Đã thêm môn học'),
  updateSubject: async (req, res) =>
    ok(res, await service.updateSubject(uid(req), pid(req), req.valid.body, { replacePeriods: 'periods' in req.body }), 'Đã cập nhật môn học'),
  deleteSubject: async (req, res) => {
    await service.deleteSubject(uid(req), pid(req));
    ok(res, null, 'Đã xóa môn học');
  },

  listMeetings: async (req, res) => ok(res, await service.listMeetings(uid(req), req.valid.query)),
  getMeeting: async (req, res) => ok(res, await service.getMeeting(uid(req), pid(req))),
  updateMeeting: async (req, res) => ok(res, await service.updateMeeting(uid(req), pid(req), req.valid.body), 'Đã cập nhật buổi học'),
  conflicts: async (req, res) => ok(res, await service.conflicts(uid(req), req.valid.query)),

  adapters: (_req, res) => ok(res, listAdapters()),
  template: (_req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="universe-mau-thoi-khoa-bieu.csv"');
    res.send(TEMPLATE_CSV);
  },
  previewImport: async (req, res) => {
    if (!req.file) throw badRequest('Vui lòng chọn file thời khóa biểu');
    const name = decodeOriginalName(req.file.originalname);
    const parsed = parseScheduleFile(req.file.buffer, name, req.body.adapter || undefined);
    ok(res, await service.previewImport(uid(req), parsed, name), 'Đã đọc file – hãy kiểm tra trước khi lưu');
  },
  revalidateImport: async (req, res) => ok(res, await service.revalidateImport(uid(req), pid(req), req.valid.body.subjects)),
  confirmImport: async (req, res) => ok(res, await service.confirmImport(uid(req), pid(req), req.valid.body), 'Đã nhập thời khóa biểu'),
  cancelImport: async (req, res) => {
    await service.cancelImport(uid(req), pid(req));
    ok(res, null, 'Đã hủy phiên import');
  },
  listImports: async (req, res) => ok(res, await service.listImports(uid(req))),
};
