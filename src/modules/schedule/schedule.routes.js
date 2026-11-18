'use strict';
const { Router } = require('express');
const c = require('./schedule.controller');
const v = require('./schedule.validators');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { uploader } = require('../../middlewares/upload');
const { uploadLimiter } = require('../../middlewares/rateLimiters');
const { z, idParams, optionalId } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

r.get('/semesters', c.listSemesters);
r.post('/semesters', validate({ body: v.semesterBody }), c.createSemester);
r.patch('/semesters/:id', validate({ params: idParams, body: v.semesterBody.partial() }), c.updateSemester);
r.delete('/semesters/:id', validate({ params: idParams }), c.deleteSemester);

r.get('/subjects', validate({ query: z.object({ semesterId: optionalId.optional() }) }), c.listSubjects);
r.get('/subjects/options', c.subjectOptions);
r.get('/subjects/:id', validate({ params: idParams }), c.getSubject);
r.post('/subjects', validate({ body: v.subjectBody }), c.createSubject);
r.patch('/subjects/:id', validate({ params: idParams, body: v.subjectBody.partial() }), c.updateSubject);
r.delete('/subjects/:id', validate({ params: idParams }), c.deleteSubject);

r.get('/meetings', validate({ query: v.meetingsQuery }), c.listMeetings);
r.get('/meetings/:id', validate({ params: idParams }), c.getMeeting);
r.patch('/meetings/:id', validate({ params: idParams, body: v.meetingUpdate }), c.updateMeeting);
r.get('/conflicts', validate({ query: v.meetingsQuery }), c.conflicts);

const importUpload = uploader({ maxBytes: 5 * 1024 * 1024, maxFiles: 1 }).single('file');
r.get('/import/adapters', c.adapters);
r.get('/import/template', c.template);
r.get('/imports', c.listImports);
r.post('/import/preview', uploadLimiter, importUpload, c.previewImport);
r.post('/import/:id/revalidate', validate({ params: idParams, body: v.importConfirm.pick({ subjects: true }) }), c.revalidateImport);
r.post('/import/:id/confirm', validate({ params: idParams, body: v.importConfirm }), c.confirmImport);
r.delete('/import/:id', validate({ params: idParams }), c.cancelImport);

module.exports = r;
