'use strict';
const { Router } = require('express');
const service = require('./drive.service');
const documents = require('./document.service');
const { validate } = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { uploader } = require('../../middlewares/upload');
const { uploadLimiter, aiLimiter } = require('../../middlewares/rateLimiters');
const { ok, created } = require('../../utils/response');
const { z, idParams, optionalId, optionalText, color } = require('../../utils/schemas');

const r = Router();
r.use(requireAuth);

const listQuery = z.object({
  view: z.enum(['my', 'shared', 'favorites', 'recent']).default('my'),
  folderId: optionalId.optional(),
  subjectId: optionalId.optional(),
  tagId: optionalId.optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['name', 'date', 'size']).default('name'),
  type: z.enum(['document', 'spreadsheet', 'presentation', 'image', 'archive']).optional(),
});

const folderBody = z.object({ name: z.string().trim().min(1).max(191), parentId: optionalId.optional(), color: color.optional() });
const fileUpdate = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  folderId: optionalId.optional(),
  subjectId: optionalId.optional(),
  description: optionalText(5000),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

// ---------- Danh sách / thư mục ----------
r.get('/', validate({ query: listQuery }), async (req, res) => ok(res, await service.list(req.user.id, req.valid.query)));
r.get('/folders/tree', async (req, res) => ok(res, await service.folderTree(req.user.id)));
r.get('/tags', async (req, res) => ok(res, await service.listTags(req.user.id)));
r.post('/folders', validate({ body: folderBody }), async (req, res) => created(res, await service.createFolder(req.user.id, req.valid.body), 'Đã tạo thư mục'));
r.patch('/folders/:id', validate({ params: idParams, body: folderBody.partial() }), async (req, res) =>
  ok(res, await service.updateFolder(req.user.id, req.valid.params.id, req.valid.body), 'Đã cập nhật thư mục')
);
r.delete('/folders/:id', validate({ params: idParams }), async (req, res) => {
  await service.deleteFolder(req.user.id, req.valid.params.id);
  ok(res, null, 'Đã chuyển thư mục vào thùng rác');
});

// ---------- Upload ----------
const upload = uploader({ maxFiles: 10 }).array('files', 10);
r.post('/upload', uploadLimiter, upload, validate({ body: z.object({ folderId: optionalId.optional(), subjectId: optionalId.optional() }) }), async (req, res) => {
  const result = await service.upload(req.user.id, req.files, req.valid.body);
  const msg = result.rejected.length ? `Đã tải lên ${result.files.length} file, ${result.rejected.length} file bị từ chối` : `Đã tải lên ${result.files.length} file`;
  created(res, result, msg);
});

// ---------- File ----------
r.get('/files/:id', validate({ params: idParams }), async (req, res) => ok(res, await service.getFile(req.user.id, req.valid.params.id)));
r.patch('/files/:id', validate({ params: idParams, body: fileUpdate }), async (req, res) =>
  ok(res, await service.updateFile(req.user.id, req.valid.params.id, req.valid.body), 'Đã cập nhật file')
);
r.post('/files/:id/copy', validate({ params: idParams, body: z.object({ folderId: optionalId.optional() }) }), async (req, res) =>
  created(res, await service.copyFile(req.user.id, req.valid.params.id, req.valid.body), 'Đã sao chép file')
);
r.delete('/files/:id', validate({ params: idParams }), async (req, res) => {
  await service.deleteFile(req.user.id, req.valid.params.id);
  ok(res, null, 'Đã chuyển file vào thùng rác');
});

async function sendFile(req, res, inline) {
  const f = await service.fileForDownload(req.user.id, req.valid.params.id, { inline });
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, no-store');
  // Nội dung do người dùng tải lên: cô lập bằng CSP sandbox, không cho chạy script.
  // (PDF ngoại lệ: trình xem PDF của Chrome từ chối hiển thị trong sandbox; PDF không chạy script của trang.)
  if (f.ext !== 'pdf') res.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  else res.set('Content-Security-Policy', "default-src 'none'; object-src 'self'");
  const encoded = encodeURIComponent(f.name);
  const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.set('Content-Disposition', `${f.inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`);
  const mime = ['txt', 'md', 'csv'].includes(f.ext) ? 'text/plain; charset=utf-8' : f.mime;
  res.type(mime).sendFile(f.path);
}
r.get('/files/:id/download', validate({ params: idParams }), (req, res) => sendFile(req, res, false));
r.get('/files/:id/preview', validate({ params: idParams }), (req, res) => sendFile(req, res, true));
r.get('/files/:id/text', validate({ params: idParams }), async (req, res) => ok(res, await service.fileText(req.user.id, req.valid.params.id)));

// ---------- Xử lý tài liệu / AI ----------
r.post('/files/:id/reprocess', validate({ params: idParams }), async (req, res) =>
  ok(res, await documents.retry(req.user.id, req.valid.params.id), 'Đã đưa tài liệu vào hàng đợi xử lý')
);
r.post('/files/:id/embeddings', aiLimiter, validate({ params: idParams }), async (req, res) =>
  ok(res, await documents.generateEmbeddings(req.user.id, req.valid.params.id), 'Đã tạo embedding cho tài liệu')
);
r.post(
  '/files/:id/ai',
  aiLimiter,
  validate({ params: idParams, body: z.object({ action: z.enum(['summarize', 'keypoints', 'explain', 'classify']) }) }),
  async (req, res) => ok(res, await service.aiAction(req.user.id, req.valid.params.id, req.valid.body.action))
);
r.post(
  '/ask',
  aiLimiter,
  validate({ body: z.object({ fileIds: z.array(z.coerce.number().int().positive()).min(1).max(10), question: z.string().trim().min(2).max(2000) }) }),
  async (req, res) => ok(res, await service.ask(req.user.id, req.valid.body.fileIds, req.valid.body.question))
);

module.exports = r;
