# Kiến trúc UniVerse

## 1. Tổng quan

UniVerse là **Modular Monolith**: một tiến trình Node.js/Express duy nhất phục vụ cả frontend tĩnh và REST API `/api/v1`. Mỗi phân hệ là một module độc lập trong `src/modules/<tên>` và chỉ giao tiếp với nhau qua service đã export (không truy cập route của nhau).

```
Trình duyệt (Vanilla JS SPA, History API router)
        │  fetch + cookie phiên (HttpOnly) + header X-CSRF-Token
        ▼
Express app (src/app.js)
  helmet (CSP) → json parser → express-session (MySQL store) → request logger
  /api/v1 → rate limit → loadUser → verifyCsrf → router module
                                         │
                     routes → (validate zod) → controller → service → Prisma → MySQL 8
                                                        │
                                   services dùng chung: storage, ai, retrieval, notification, activity
  static public/  +  SPA fallback index.html  +  error handler chuẩn hóa
```

## 2. Các tầng

| Tầng | Vị trí | Trách nhiệm |
|---|---|---|
| Routes | `modules/*/*.routes.js` | Khai báo endpoint, middleware xác thực/phân quyền, validation |
| Controllers | `*.controller.js` (module lớn) hoặc handler ngắn trong routes (module nhỏ) | Đọc `req.valid`, gọi service, trả response chuẩn |
| Services | `*.service.js` | Nghiệp vụ, **kiểm tra quyền sở hữu dữ liệu**, transaction |
| Data access | Prisma Client (`src/database/prisma.js`) | Prisma đóng vai trò repository; truy vấn luôn lọc theo `userId` / quyền thành viên |
| Validators | `*.validators.js`, `utils/schemas.js` | Schema Zod cho body/query/params |
| Middlewares | `src/middlewares` | auth, CSRF, validate, upload, rate limit, error |
| Logic thuần | `schedule.logic.js`, `importers/*`, `quiz.grading.js`, `public/js/shared/formula.js` | Không phụ thuộc DB – kiểm thử đơn vị trực tiếp |

**Quyết định:** không tạo thêm lớp repository riêng cho mọi model vì Prisma đã cung cấp API truy cập dữ liệu có kiểu rõ ràng; thêm lớp bọc sẽ chỉ lặp lại code. Logic phức tạp được tách thành module thuần để dễ test.

## 3. Response & lỗi

```json
{ "success": true, "message": "Thành công", "data": {} }
{ "success": false, "message": "Dữ liệu không hợp lệ", "data": null, "code": "VALIDATION", "details": [{ "field": "email", "message": "..." }] }
```

`errorHandler` ánh xạ: ApiError → status riêng; ZodError → 422; Multer → 400/413; Prisma P2002 → 409, P2025 → 404; JSON hỏng → 400; còn lại → 500. Production không bao giờ trả stack trace; development chỉ trả `debug.message` cho lỗi 500.

## 4. Bảo mật

- **Mật khẩu:** bcrypt (12 rounds), so sánh hash giả khi email không tồn tại để tránh dò tài khoản.
- **Session:** cookie `universe.sid` HttpOnly, SameSite=Lax, Secure khi production; lưu MySQL (`sessions`), `session.regenerate()` khi đăng nhập (chống session fixation). Bảng `UserSession` cho phép xem & thu hồi thiết bị; đổi mật khẩu / khóa tài khoản thu hồi các phiên khác.
- **CSRF:** synchronizer token lưu trong session, gửi qua header `X-CSRF-Token` cho mọi request thay đổi dữ liệu.
- **Phân quyền:** vai trò `STUDENT | MODERATOR | ADMIN` (`requireRole`); quyền dữ liệu kiểm tra trong service (sở hữu, thành viên nhóm, bài công khai). Truy cập trái phép trả 404 để không tiết lộ dữ liệu tồn tại.
- **XSS:** frontend tạo DOM bằng `textContent`, không chèn HTML người dùng; Markdown được render thành DOM an toàn; URL lọc chặn `javascript:`; CSP `script-src 'self'`.
- **SQL Injection:** chỉ dùng Prisma (truy vấn tham số hóa) + validation Zod.
- **Upload:** Multer memory storage → nhận diện loại file bằng *magic bytes* (không tin tên/MIME từ trình duyệt) → lưu với tên ngẫu nhiên 128-bit trong `storage/` (ngoài `public/`) → tải về qua API kiểm tra quyền, `Content-Disposition`, `nosniff`, CSP `sandbox` cho nội dung xem inline. Có hạn mức dung lượng mỗi người dùng.
- **Rate limit:** toàn API (600/phút), đăng nhập/đăng ký (20/15 phút/IP), thao tác nhạy cảm, AI (15/phút/người), upload.
- **Log:** logger tự che khóa chứa `password|token|cookie|secret|apiKey|session`; request log không ghi body/query.

## 5. UniSchedule & Import Adapter

Mô hình 3 cấp bắt buộc + buổi học cụ thể:

```
Semester ─┬─ Subject (mã HP, tên, tín chỉ, lớp HP)
          │     └─ SchedulePeriod (startDate, endDate, rawText gốc)
          │           └─ ClassSession (thứ, tiết bắt đầu/kết thúc, danh sách tiết gốc, phòng)
          │                 └─ ClassMeeting (ngày cụ thể; UNIQUE(sessionId, date) chống trùng)
ClassPeriod (cấu hình tiết → giờ; giờ có thể để trống)
ScheduleImport (bản xem trước lưu phía server; trạng thái PREVIEW → CONFIRMED/CANCELLED)
```

Luồng import: `upload → importers.parseScheduleFile()` (chọn adapter bằng `detect()`), `→ ParsedSchedule` chung, `→ schedule.service.buildPreview()` (sinh ngày cụ thể + xung đột trong file và với lịch đã có), `→ người dùng sửa`, `→ revalidate (tùy chọn)`, `→ confirm` (transaction tạo học kỳ, môn, khoảng lịch, buổi học).

- `importers/sheetGrid.js`: đọc worksheet thành lưới, điền giá trị ô gộp và đánh dấu "bản sao", chuẩn hóa tiếng Việt **giữ nguyên độ dài** để cắt chuỗi gốc theo vị trí tìm được.
- `importers/kma.adapter.js`: tìm dòng tiêu đề theo tên cột (hỗ trợ tiêu đề 2 dòng), đọc nhãn đầu trang (học kỳ, năm học, đợt, họ tên, MSSV, lớp, khóa, ngành), ghép dòng tiếp nối do ô gộp, đọc dòng tổng tín chỉ và ghi chú buổi sáng/chiều.
- `importers/timeText.js`: tách cột "Thời gian địa điểm" → khoảng ngày → thứ → tiết → phòng; hỗ trợ marker `(n)` ánh xạ địa điểm; mọi phần không nhận diện được trở thành cảnh báo (không đoán).
- `importers/generic.adapter.js`: mẫu CSV/Excel chung. Thêm trường mới = viết `xxx.adapter.js` + đăng ký trong `importers/index.js`.
- `schedule.logic.js`: `expandDates` (chỉ ngày đúng thứ trong khoảng, chặn khoảng > 400 ngày), `detectConflicts` (chồng tiết cùng ngày; phân biệt trùng lặp / khác phòng).

## 6. UniDrive, trích xuất văn bản & RAG

Tách biệt rõ các bước:

| Bước | Thành phần | Ghi chú |
|---|---|---|
| File storage | `services/storage.service.js` | đĩa cục bộ `storage/uploads` |
| File metadata | bảng `DriveFile`, `Folder`, `Tag` | soft delete |
| Text extraction | `drive/document.service.js` | pdf-parse (theo trang), mammoth (DOCX), UTF-8 (TXT/MD/CSV); chạy nền, trạng thái `UPLOADED → PROCESSING → READY/FAILED`, có thử lại |
| Chunking | `chunkText()` | ~1200 ký tự, chồng lấn 200, lưu số trang |
| Keyword search | `DocumentChunk.content contains` + chấm điểm TF | dùng cho UniSearch và RAG khi chưa có embedding |
| Embedding generation | `generateEmbeddings()` | **chỉ khi người dùng bấm**; vector lưu JSON trong MySQL |
| Semantic retrieval | `services/retrieval.service.js` | cosine similarity tính trong Node (brute-force, tối đa 4000 đoạn) – **không phải vector database** |
| AI question answering | `drive.service.ask`, `ai.chat.service.send` | chỉ gửi các đoạn liên quan, trả về nguồn (file, trang, đoạn) và phương thức đã dùng |

PDF scan không có lớp chữ → `FAILED` với thông báo "OCR chưa được hỗ trợ". Lớp retrieval có giao diện `retrieve(userId, query, { fileIds, limit })` để có thể thay bằng vector DB sau này.

## 7. AI Provider Adapter

`services/ai/providers.js` cài đặt cùng giao diện `chat()` / `embed()` cho **OpenAI** và **Gemini** bằng `fetch` (không SDK). `services/ai/ai.service.js` bọc: kiểm tra cấu hình, hạn mức/ngày, timeout (`AbortSignal.timeout`), cắt độ dài đầu vào, giới hạn token đầu ra, ghi `AiUsage`, chuẩn hóa lỗi provider (không trả nguyên văn lỗi nội bộ). Prompt tập trung tại `services/ai/prompts.js`. AI chỉ **đề xuất** với Task/Group/Sheet – thay đổi dữ liệu luôn cần người dùng xác nhận.

## 8. UniSheet – bộ xử lý công thức

`public/js/shared/formula.js` (ES module dùng chung frontend & backend): tokenizer → Pratt parser (AST) → evaluator; không dùng `eval/Function`. Lỗi kiểu Excel: `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?` (hàm chưa hỗ trợ – thông báo rõ), `#CYCLE!`, `#ERROR!`. `SheetModel` có cache và `dependents()` để biết ô cần tính lại. Thêm/xóa hàng cột tự dịch tham chiếu trong công thức (tham chiếu tới hàng/cột bị xóa → `#REF!`). Export XLSX ghi cả công thức và giá trị đã tính.

## 9. Frontend

- `public/js/core`: `dom.js` (tạo DOM an toàn), `api.js` (fetch + CSRF + chuẩn hóa lỗi), `router.js` (History API, guard rời trang), `ui.js` (toast, modal, confirm, prompt, dropdown, drawer, skeleton, empty/error state – thay alert/confirm trình duyệt), `markdown.js`, `format.js`, `icons.js`, `store.js`.
- `public/js/layout/shell.js`: sidebar thu gọn được, topbar, UniSearch palette (Ctrl+K), Notification Center, menu tài khoản, chuyển theme.
- `public/js/pages/*`: mỗi trang export `mount(container, ctx)` trả về hàm dọn dẹp.
- CSS: design tokens trên `:root` (sáng/tối, theo hệ thống), `components.css`, `layout.css`, `modules.css`; responsive ở 1100/900/640px.

## 10. Tác vụ nền

`services/jobs.js` chạy mỗi phút trong cùng tiến trình: gửi thông báo nhắc việc (`Task.remindAt`) và xử lý lại tài liệu đang chờ (sau khi khởi động lại). Không cần Redis/queue ngoài.

## 11. Mở rộng về sau

- Thêm parser trường khác: `src/modules/schedule/importers/<truong>.adapter.js`.
- OCR: thêm bước trong `extractText()` cho PDF không có lớp chữ.
- Vector DB: thay phần semantic trong `retrieval.service.js`.
- Lưu trữ đám mây: thay `storage.service.js` (giữ nguyên giao diện `save/read/copy/remove/absolutePath`).
