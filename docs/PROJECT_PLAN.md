# Kế hoạch triển khai UniVerse

## Giai đoạn 0 – Kiểm tra & lập kế hoạch (17/11/2026)

Kết quả kiểm tra môi trường:

| Hạng mục | Kết quả |
|---|---|
| Workspace | `d:\UniVerse` trống, chưa có git → đã `git init` (chưa commit, chưa có remote) |
| Node.js / npm | v26.13.1 / 11.20.0 |
| Git | 2.56 |
| MySQL | Server 8.0.46, service `MySQL80` đang chạy cổng 3306; `mysql.exe` chưa có trong PATH |
| Thông tin đăng nhập MySQL | Người dùng tự điền vào `.env` |
| File KMA tham chiếu | Chưa có – người dùng sẽ đặt vào `tests/fixtures/kma/` |
| API key AI | Chưa có → AI ở trạng thái "chưa cấu hình" |

Quyết định công nghệ chính (giải thích chi tiết trong ARCHITECTURE.md):

- **Express 5**: tự chuyển lỗi của hàm async sang error handler.
- **Prisma 6.19** thay vì 7/8: Prisma 7+ yêu cầu driver adapter & hướng ESM; Prisma 6 ổn định với CommonJS + MySQL.
- **SheetJS CE 0.20.3** (CDN chính thức, Apache-2.0) để đọc cả `.xls` lẫn `.xlsx`; không dùng bản npm 0.18.5 có lỗ hổng, không dùng ExcelJS (không đọc `.xls`).
- **pdf-parse 2.x** (theo trang) + **mammoth** cho DOCX.
- Tự viết nhận diện magic bytes (gói `file-type` chỉ hỗ trợ ESM).
- Test bằng `node:test` có sẵn + Supertest.
- Migration đầu tiên sinh bằng `prisma migrate diff` để áp dụng được mà không cần quyền shadow database.

## Thứ tự ưu tiên

**Mức 1 – Core MVP:** Authentication, Dashboard, UniSchedule (+ import KMA), UniDrive, UniNote, UniTask, UniAI cơ bản.
**Mức 2 – Advanced:** UniSheet, UniQuiz, RAG, Notification Center, UniSearch.
**Mức 3 – Collaboration & Community:** UniGroup, UniShare, Favorites, Recently Viewed, Trash, Activity History, AI nâng cao.

## Giai đoạn

| GĐ | Nội dung | Trạng thái |
|---|---|---|
| 0 | Kiểm tra môi trường, kế hoạch, tài liệu | Done |
| 1 | Khởi tạo dự án, dependencies, cấu trúc, Express, Prisma schema + migration, frontend cơ bản, README, .env.example | Done – server chạy với MySQL |
| 2 | UI foundation (layout, sidebar, topbar, dark mode, modal, toast, skeleton, empty state) + Auth/Session/CSRF/phân quyền | Done – test API auth/CSRF/phân quyền pass |
| 3 | UniSchedule, UniDrive, UniNote, UniSheet, UniTask | Done – unit + API test pass |
| 4 | UniAI, AI Provider, RAG, UniQuiz | Done (code) – chạy AI thật cần API key |
| 5 | UniGroup, UniShare, thông báo, bình luận, kiểm duyệt | Done (code) |
| 6 | UniSearch, Favorites, Recent, Trash, Activity, responsive, bảo mật, test API | Done – 47/48 test pass; UI chưa kiểm tra trên trình duyệt |

## Việc tiếp theo

1. ~~Cấu hình MySQL, migration, seed, test API~~ – xong 18/11/2026 (47/48 pass).
2. Kiểm tra giao diện trên trình duyệt (desktop/tablet/mobile) và sửa lỗi phát sinh.
3. Đặt 2 file KMA thật vào `tests/fixtures/kma/`, chạy `npm run test:unit` và tinh chỉnh parser nếu định dạng thật khác fixture.
4. (Tùy chọn) Cấu hình API key AI và kiểm thử các chức năng AI/RAG.
