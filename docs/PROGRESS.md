# Tiến độ UniVerse

Cập nhật: 18/11/2026

Chú thích: **Done** · **In Progress** · **Not Started** · **Blocked**
Các mức hoàn thiện: UI Complete · Backend Complete · Database Complete · Integration Complete · Tested · Fully Complete

> **Cập nhật 18/11/2026:** MySQL đã được cấu hình. Migration `20261118000000_init` đã áp dụng (39 bảng), seed chạy thành công, server khởi động với MySQL session store, **47/48 test pass** (1 test skip: chưa có file KMA thật). Giao diện **chưa được kiểm tra trực quan trên trình duyệt** trong phiên này (không có công cụ trình duyệt) – cần người dùng mở thử và báo lỗi nếu có.

## Đã kiểm chứng (không cần DB)

| Hạng mục | Kết quả |
|---|---|
| Parser KMA (fixture ẩn danh .xls & .xlsx, file mẫu rỗng, thiếu cột, ô gộp, dòng trống, nhiều khoảng lịch, marker địa điểm) | 19 test pass |
| Logic lịch (sinh ngày cụ thể, không vượt khoảng, phát hiện xung đột/trùng lặp) | pass (trong bộ test trên) |
| Bộ xử lý công thức UniSheet (toán tử, tham chiếu, SUM/AVERAGE/MAX/MIN/COUNT/IF/SUMIF/COUNTIF, lỗi, chống thực thi mã) | 8 test pass |
| File KMA thật | **Blocked** – chưa có file trong `tests/fixtures/kma/` (test tự skip) |
| Nạp toàn bộ module backend, CSRF/401/404, phục vụ frontend, header bảo mật, không lộ `.env`/mã nguồn | Đã chạy thử bằng Supertest |
| Cú pháp 36 module frontend + kiểm tra import/export/icon | Không lỗi |
| Migration SQL khởi tạo (39 bảng) | Đã áp dụng lên MySQL 8.0.46 |
| 21 test API tích hợp trên MySQL thật (auth, CSRF, phân quyền, import KMA end-to-end, Drive, Note, Sheet, Task, AI chưa cấu hình, Quiz, Group, Share, thông báo, dashboard) | pass |

## Theo module

| Module | UI | Backend | Database | Integration | Tested | Trạng thái |
|---|---|---|---|---|---|---|
| Authentication & Session & Phân quyền | ✔ | ✔ | schema ✔ | ✔ API | ✔ API | In Progress (chờ kiểm tra UI trên trình duyệt) |
| Dashboard | ✔ | ✔ | — | ✔ API | test API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| UniSchedule (+ import KMA) | ✔ | ✔ | schema ✔ | ✔ API | parser ✔, API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| UniDrive (+ trích xuất văn bản) | ✔ | ✔ | schema ✔ | ✔ API | API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| UniNote | ✔ | ✔ | schema ✔ | ✔ API | API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| UniSheet | ✔ | ✔ | schema ✔ | ✔ API | công thức ✔, API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| UniTask | ✔ | ✔ | schema ✔ | ✔ API | API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| UniAI (chat, RAG) | ✔ | ✔ | schema ✔ | ✔ API (AI thật chờ API key) | trạng thái "chưa cấu hình" có test, gọi AI thật chưa kiểm thử | In Progress (chờ kiểm tra UI trên trình duyệt) |
| UniQuiz | ✔ | ✔ | schema ✔ | ✔ API | API ✔; sinh câu hỏi AI cần API key | In Progress (chờ kiểm tra UI trên trình duyệt) |
| UniGroup | ✔ | ✔ | schema ✔ | ✔ API | API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| UniShare (+ kiểm duyệt) | ✔ | ✔ | schema ✔ | ✔ API | API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| Notification Center | ✔ | ✔ | schema ✔ | ✔ API | API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| UniSearch | ✔ | ✔ | — | ✔ API | API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| Favorites / Recently Viewed / Trash / Activity | ✔ | ✔ | schema ✔ | ✔ API | API ✔ | In Progress (chờ kiểm tra UI trên trình duyệt) |
| Profile & Settings, Admin (người dùng, Class Periods) | ✔ | ✔ | schema ✔ | ✔ API | một phần | In Progress (chờ kiểm tra UI trên trình duyệt) |
| Responsive / Dark Mode | ✔ (CSS) | — | — | — | chưa kiểm tra trên trình duyệt | In Progress |
| Logging / Backup docs | ✔ | ✔ | — | — | — | Done (backup tự động: Not Started – ngoài phạm vi) |

## Giới hạn đã biết (ghi rõ, không tuyên bố quá)

- **OCR:** chưa hỗ trợ – PDF scan sẽ báo `FAILED` với thông báo rõ ràng.
- **Semantic search:** brute-force cosine trong Node trên embedding lưu ở MySQL (không phải vector database); khi chưa bật embedding thì RAG dùng **tìm kiếm từ khóa** và giao diện ghi rõ phương thức.
- **Backup tự động:** chưa triển khai – xem `docs/BACKUP.md`.
- **Xem trước file Office** (DOCX hiển thị văn bản đã trích xuất; XLSX/PPTX cần tải về).
- **UniSheet:** chỉ 8 hàm đã chốt; hàm khác trả `#NAME?` kèm thông báo "chưa được hỗ trợ". Sắp xếp giữ nguyên công thức (không dịch tham chiếu tương đối).
- **Parser KMA** được xây theo mô tả cấu trúc; cần kiểm chứng lại với 2 file thật.
