# File tham chiếu thời khóa biểu KMA

Đặt 2 file gốc vào thư mục này:

- `ThoiKhoaBieuSinhVien (1).xls` – file mẫu chưa có học phần
- `ThoiKhoaBieuSinhVien(1).xls` – file có dữ liệu học phần thực tế

Các file này chứa họ tên / mã sinh viên nên **đã được .gitignore** (chỉ README này được commit).

Bộ test `tests/unit/kma-parser.test.js` sẽ:

1. Chạy trên file thật nếu có (bỏ qua – `skip` – nếu chưa có).
2. Luôn chạy trên fixture đã ẩn danh `tests/fixtures/kma-anonymized.xls`
   (được sinh ra bằng `node tests/fixtures/build-anonymized-fixture.js`, mô phỏng đúng cấu trúc file KMA thật,
   không chứa thông tin cá nhân).
