# UniVerse – Student Super App

UniVerse là nền tảng web dành cho sinh viên đại học, gồm **9 phân hệ** liên kết dữ liệu với nhau:

| Phân hệ | Chức năng chính |
|---|---|
| **UniSchedule** | Học kỳ, môn học, lịch học nhiều khoảng ngày, **import thời khóa biểu KMA (.xls/.xlsx)** và CSV, xem tuần/tháng, phát hiện trùng lịch, cấu hình tiết học |
| **UniDrive** | Upload/download, thư mục, di chuyển, sao chép, thùng rác, nhãn, môn học, yêu thích, xem trước, trích xuất văn bản PDF/DOCX/TXT, tìm kiếm nội dung |
| **UniNote** | Ghi chú dạng khối (heading, danh sách, checklist, bảng, code, ảnh, liên kết), trang con, tự động lưu có kiểm soát phiên bản |
| **UniSheet** | Bảng tính nhiều trang, bộ xử lý công thức riêng (SUM, AVERAGE, MAX, MIN, COUNT, IF, SUMIF, COUNTIF), định dạng, sắp xếp, lọc, import/export CSV/XLSX |
| **UniTask** | Công việc, deadline, ưu tiên, nhắc nhở, List / Kanban / Calendar, liên kết môn học & buổi học |
| **UniAI** | Chat AI (OpenAI hoặc Gemini qua backend), lịch sử hội thoại, hỏi đáp dựa trên tài liệu (RAG) kèm nguồn trích dẫn |
| **UniQuiz** | Bộ câu hỏi 4 dạng, sinh câu hỏi từ tài liệu bằng AI, Quick Quiz / Practice / Mock Test / Flashcards, thống kê chủ đề yếu |
| **UniGroup** | Nhóm học tập, mời / mã tham gia, phân quyền trưởng nhóm, giao nhiệm vụ, chia sẻ tài liệu & ghi chú, thảo luận, lịch sử hoạt động |
| **UniShare** | Bài viết / tài liệu / đề cương cộng đồng, bình luận, đánh giá, bookmark, báo cáo vi phạm, kiểm duyệt (Moderator/Admin) |

Chức năng dùng chung: Dashboard (dữ liệu thật), Notification Center, UniSearch (Ctrl+K), Favorites, Recently Viewed, Trash, Activity History, Profile & Settings, Dark Mode.

---

## 1. Công nghệ

- **Backend:** Node.js (≥ 22.12, đã kiểm tra trên Node 26) · Express 5 · JavaScript (CommonJS) · Prisma ORM 6 · MySQL 8
- **Frontend:** HTML5 · CSS3 · Vanilla JavaScript (ES Modules) · Fetch API – không framework
- **Thư viện:** zod (validation), bcrypt, express-session + express-mysql-session, helmet, express-rate-limit, multer, SheetJS CE 0.20.3 (đọc `.xls` & `.xlsx`), csv-parse, pdf-parse, mammoth, supertest
- **Kiểm thử:** `node:test` (có sẵn trong Node) + Supertest

> **Vì sao SheetJS từ cdn.sheetjs.com?** Bản `xlsx` trên npm (0.18.5) đã cũ và có lỗ hổng bảo mật đã công bố. SheetJS Community Edition 0.20.3 (giấy phép Apache-2.0) chỉ phát hành qua CDN chính thức – `package.json` trỏ thẳng tới tarball đó. ExcelJS **không** đọc được `.xls` nên không được dùng.

## 2. Yêu cầu môi trường

- Node.js 22.12+ và npm
- MySQL Server 8.x đang chạy (Windows: service `MySQL80`)
- (Tùy chọn) API key OpenAI hoặc Gemini để bật tính năng AI

## 3. Cài đặt

```bash
npm install
```

npm 11 yêu cầu duyệt install script. Nếu thấy cảnh báo `install-scripts`, chạy:

```bash
npm install-scripts approve bcrypt @prisma/client @prisma/engines prisma
npm rebuild bcrypt @prisma/engines prisma
```

## 4. Cấu hình MySQL

Tạo database và (khuyến nghị) một user riêng cho ứng dụng – chạy trong MySQL client với tài khoản quản trị:

```sql
CREATE DATABASE universe CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'universe_app'@'localhost' IDENTIFIED BY 'mat-khau-cua-ban';
GRANT ALL PRIVILEGES ON universe.* TO 'universe_app'@'localhost';
FLUSH PRIVILEGES;
```

Trên Windows, `mysql.exe` nằm ở `C:\Program Files\MySQL\MySQL Server 8.0\bin\` (có thể chưa có trong PATH).

## 5. Cấu hình `.env`

```bash
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
```

Các biến quan trọng:

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | `mysql://USER:PASSWORD@localhost:3306/universe` (ký tự đặc biệt trong mật khẩu phải URL-encode, vd `@` → `%40`) |
| `SESSION_SECRET` | Chuỗi ngẫu nhiên ≥ 32 ký tự: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PORT` | Mặc định `3000` |
| `UPLOAD_MAX_MB`, `USER_STORAGE_QUOTA_MB` | Giới hạn upload & dung lượng mỗi người dùng |
| `AI_*` | Xem mục 9 |

`.env` đã nằm trong `.gitignore` – **không commit file này**.

## 6. Migration

```bash
npm run db:deploy     # áp dụng migration có sẵn (prisma/migrations) – không xóa dữ liệu
```

Khi phát triển và thay đổi `prisma/schema.prisma`: `npm run db:migrate` (user MySQL cần quyền tạo database tạm "shadow").

## 7. Seed dữ liệu

```bash
npm run db:seed
```

- Tạo cấu hình tiết 1–10 (sáng 1–5, chiều 6–10) **chưa có giờ** – chỉ khi bảng đang trống.
- Chỉ khi `NODE_ENV=development`: tạo dữ liệu **DEMO** (gắn nhãn `[Demo]`, cờ `isDemo`, banner cảnh báo trên giao diện). Seed **không** xóa hoặc ghi đè dữ liệu đang có.

### Tài khoản demo (chỉ môi trường phát triển)

| Email | Vai trò |
|---|---|
| `demo.student@universe.local` | Student |
| `demo.moderator@universe.local` | Moderator |
| `demo.admin@universe.local` | Admin |

Mật khẩu: giá trị `SEED_DEMO_PASSWORD` nếu có, mặc định `Demo@2026`. **Không dùng tài khoản demo trên môi trường thật.**

## 8. Khởi chạy

```bash
npm run dev     # tự khởi động lại khi sửa code
npm start       # chạy thường
```

Mở `http://localhost:3000`. Một server Express duy nhất phục vụ cả frontend (thư mục `public/`) và API (`/api/v1`). Kiểm tra sức khỏe: `GET /api/v1/system/health`.

## 9. Cấu hình AI Provider

```env
AI_PROVIDER=gemini            # hoặc openai; để trống = AI "chưa cấu hình"
GEMINI_API_KEY=AIza...        # nếu dùng Gemini (https://aistudio.google.com/apikey)
OPENAI_API_KEY=sk-...         # nếu dùng OpenAI (https://platform.openai.com/api-keys, cần billing)
AI_API_KEY=                   # (tùy chọn) key chung cho provider đang chọn
AI_CHAT_MODEL=                # bỏ trống = mặc định: gemini-flash-latest / gpt-4o-mini
AI_EMBEDDING_MODEL=           # bỏ trống = gemini-embedding-001 / text-embedding-3-small
AI_EMBEDDINGS_ENABLED=true
AI_MAX_OUTPUT_TOKENS=2048
AI_DAILY_REQUEST_LIMIT=100
```

Kiểm tra kết nối (không cần chạy server): `npm run ai:check` – in model khả dụng với key của bạn và gọi thử chat/embedding. Admin cũng có nút **Kiểm tra kết nối AI** trong trang Quản trị. Sau khi sửa `.env` phải **khởi động lại server** (`--watch` không theo dõi file `.env`).

- API key chỉ tồn tại phía server; frontend không bao giờ nhận key.
- Khi chưa có key: giao diện hiển thị "AI chưa được cấu hình", API trả `503 AI_NOT_CONFIGURED`. **Không có câu trả lời giả lập.** Các module khác vẫn hoạt động.
- Có timeout, rate limit theo người dùng, hạn mức lượt/ngày, giới hạn độ dài vào/ra, ghi nhận token (bảng `AiUsage`).
- Nội dung tài liệu chỉ được gửi tới AI khi người dùng **chủ động** bấm (tóm tắt, hỏi đáp, tạo quiz, bật embedding).
- Tên model mặc định nằm duy nhất ở `src/config/index.js` – hãy đổi theo model mà tài khoản của bạn được phép dùng.

## 10. Chạy test

```bash
npm test            # toàn bộ
npm run test:unit   # parser KMA, logic lịch, bộ công thức (không cần DB)
npm run test:api    # luồng API trên MySQL thật (tự bỏ qua nếu chưa kết nối DB)
```

Test API tạo người dùng email ngẫu nhiên `*@test.universe` và xóa chúng khi kết thúc.

**File thời khóa biểu KMA thật:** đặt 2 file `.xls` vào `tests/fixtures/kma/` (đã gitignore vì chứa thông tin cá nhân). Test sẽ tự kiểm tra cấu trúc file thật; khi chưa có, test dùng fixture ẩn danh `tests/fixtures/kma-anonymized.xls` (sinh bằng `node tests/fixtures/build-anonymized-fixture.js`).

## 11. Cấu trúc thư mục

```
UniVerse/
├── src/
│   ├── app.js / server.js     # tạo Express app / khởi động server + session store + tác vụ nền
│   ├── routes.js              # gắn router các module vào /api/v1
│   ├── config/                # đọc & kiểm tra biến môi trường (zod)
│   ├── database/              # Prisma client dùng chung
│   ├── middlewares/           # auth, csrf, validate, rate limit, upload, error handler, request log
│   ├── services/              # AI provider adapter, retrieval (RAG), storage, notification, activity, jobs
│   ├── utils/                 # lỗi chuẩn, response chuẩn, logger (che dữ liệu nhạy cảm), nhận diện file
│   └── modules/<module>/      # routes / controller / service / validators của từng phân hệ
│       └── schedule/importers # Import Adapter: kma.adapter.js, generic.adapter.js, timeText.js
├── public/                    # frontend tĩnh (index.html, css/, js/core, js/layout, js/pages, js/shared)
│   └── js/shared/formula.js   # bộ xử lý công thức dùng chung frontend + backend
├── prisma/                    # schema.prisma, migrations/, seed.js
├── storage/uploads, avatars   # file người dùng – KHÔNG nằm trong public, truy cập qua API có kiểm tra quyền
├── tests/                     # unit/, api/, fixtures/
└── docs/                      # ARCHITECTURE, PROJECT_PLAN, PROGRESS, BACKUP
```

## 12. Backup & Restore

Xem chi tiết tại [docs/BACKUP.md](docs/BACKUP.md). Tóm tắt:

```bash
# Backup database (Windows: dùng đường dẫn đầy đủ tới mysqldump.exe)
mysqldump -u USER -p --single-transaction --routines --default-character-set=utf8mb4 universe > backup_universe.sql
# Restore
mysql -u USER -p universe < backup_universe.sql
# Backup file upload: sao chép thư mục storage/ (uploads + avatars) cùng thời điểm với database
```

UniVerse **chưa** có backup tự động – cần lên lịch thủ công (Task Scheduler / cron).
