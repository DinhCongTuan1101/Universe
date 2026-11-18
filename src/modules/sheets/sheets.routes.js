'use strict';
const { Router } = require('express');
const service = require('./sheets.service');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { uploader } = require('../../middlewares/upload');
const { uploadLimiter, aiLimiter } = require('../../middlewares/rateLimiters');
const { ok, created } = require('../../utils/response');
const { z, id, idParams, optionalId } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

const sheetParams = z.object({ id, sheetId: id });
const cellStyle = z
  .object({
    b: z.boolean().optional(),
    i: z.boolean().optional(),
    u: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    bg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    fmt: z.object({ type: z.enum(['general', 'number', 'percent', 'currency']), decimals: z.number().int().min(0).max(10).optional() }).optional(),
  })
  .strict();
const cells = z
  .record(z.string().regex(/^[A-Z]{1,3}\d{1,5}$/), z.object({ v: z.string().max(5000).optional(), s: cellStyle.optional() }).strict())
  .refine((o) => Object.keys(o).length <= 100000, 'Quá nhiều ô');
const dims = z.record(z.string().regex(/^\d{1,5}$/), z.number().int().min(16).max(800));

r.get('/', validate({ query: z.object({ search: z.string().trim().max(100).optional(), subjectId: optionalId.optional() }) }), async (req, res) =>
  ok(res, await service.list(req.user.id, req.valid.query))
);
r.post('/', validate({ body: z.object({ title: z.string().trim().min(1).max(191), subjectId: optionalId.optional() }) }), async (req, res) =>
  created(res, await service.create(req.user.id, req.valid.body), 'Đã tạo bảng tính')
);
const importUpload = uploader({ maxBytes: 10 * 1024 * 1024, maxFiles: 1 }).single('file');
r.post('/import', uploadLimiter, importUpload, validate({ body: z.object({ title: z.string().trim().max(191).optional() }) }), async (req, res) =>
  created(res, await service.importFile(req.user.id, req.file, req.valid.body), 'Đã nhập bảng tính')
);

r.post('/ai/formula', aiLimiter, validate({ body: z.object({ description: z.string().trim().min(3).max(1000), context: z.string().max(6000).optional() }) }), async (req, res) =>
  ok(res, await service.aiSuggestFormula(req.user.id, req.valid.body))
);
r.post('/ai/explain', aiLimiter, validate({ body: z.object({ formula: z.string().trim().min(2).max(2000) }) }), async (req, res) =>
  ok(res, await service.aiExplainFormula(req.user.id, req.valid.body))
);
r.post('/ai/analyze', aiLimiter, validate({ body: z.object({ csv: z.string().min(1).max(20000) }) }), async (req, res) =>
  ok(res, await service.aiAnalyze(req.user.id, req.valid.body))
);

r.get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await service.get(req.user.id, req.valid.params.id)));
r.patch('/:id', validate({ params: idParams, body: z.object({ title: z.string().trim().min(1).max(191).optional(), subjectId: optionalId.optional() }) }), async (req, res) =>
  ok(res, await service.update(req.user.id, req.valid.params.id, req.valid.body), 'Đã cập nhật')
);
r.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await service.remove(req.user.id, req.valid.params.id);
  ok(res, null, 'Đã chuyển bảng tính vào thùng rác');
});
r.get('/:id/export', validate({ params: idParams, query: z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx'), sheetId: optionalId.optional() }) }), async (req, res) => {
  const f = await service.exportFile(req.user.id, req.valid.params.id, req.valid.query);
  res.set('Content-Disposition', `attachment; filename="export.${req.valid.query.format}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.type(f.mime).send(f.buffer);
});

r.post('/:id/sheets', validate({ params: idParams, body: z.object({ name: z.string().trim().max(60).optional() }) }), async (req, res) =>
  created(res, await service.addSheet(req.user.id, req.valid.params.id, req.valid.body), 'Đã thêm trang tính')
);
r.patch(
  '/:id/sheets/:sheetId',
  validate({
    params: sheetParams,
    body: z.object({
      version: z.number().int().positive().optional(),
      name: z.string().trim().min(1).max(60).optional(),
      cells: cells.optional(),
      rowCount: z.number().int().min(1).max(service.LIMITS.rows).optional(),
      colCount: z.number().int().min(1).max(service.LIMITS.cols).optional(),
      colWidths: dims.optional(),
      rowHeights: dims.optional(),
    }),
  }),
  async (req, res) => ok(res, await service.saveSheet(req.user.id, req.valid.params.id, req.valid.params.sheetId, req.valid.body), 'Đã lưu')
);
r.post('/:id/sheets/:sheetId/duplicate', validate({ params: sheetParams }), async (req, res) =>
  created(res, await service.duplicateSheet(req.user.id, req.valid.params.id, req.valid.params.sheetId), 'Đã nhân bản trang tính')
);
r.delete('/:id/sheets/:sheetId', validate({ params: sheetParams }), async (req, res) => {
  await service.deleteSheet(req.user.id, req.valid.params.id, req.valid.params.sheetId);
  ok(res, null, 'Đã xóa trang tính');
});

module.exports = r;
