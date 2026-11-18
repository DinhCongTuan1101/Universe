# Backup & phục hồi UniVerse

> UniVerse **chưa triển khai backup tự động**. Các bước dưới đây cần được chạy thủ công hoặc lên lịch bằng Windows Task Scheduler / cron.

Dữ liệu cần sao lưu gồm 2 phần và nên sao lưu **cùng thời điểm**:

1. **Database MySQL** `universe` – toàn bộ dữ liệu nghiệp vụ, phiên đăng nhập, metadata file.
2. **Thư mục `storage/`** – nội dung file người dùng (`storage/uploads`) và ảnh đại diện (`storage/avatars`). Tên file trên đĩa là chuỗi ngẫu nhiên, ánh xạ qua bảng `DriveFile.storedName`.

## 1. Backup database

Windows PowerShell (MySQL 8.0 mặc định):

```powershell
$ts = Get-Date -Format "yyyyMMdd_HHmm"
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" -u USER -p --single-transaction --routines --triggers --default-character-set=utf8mb4 universe > "D:\Backups\universe_$ts.sql"
```

Linux/macOS:

```bash
mysqldump -u USER -p --single-transaction --routines --triggers --default-character-set=utf8mb4 universe | gzip > universe_$(date +%Y%m%d_%H%M).sql.gz
```

`--single-transaction` cho phép backup khi ứng dụng vẫn chạy (InnoDB).

## 2. Backup file upload

```powershell
Compress-Archive -Path D:\UniVerse\storage\* -DestinationPath "D:\Backups\universe_storage_$ts.zip"
```

```bash
tar -czf universe_storage_$(date +%Y%m%d_%H%M).tar.gz -C /path/to/UniVerse storage
```

## 3. Phục hồi

1. Dừng server UniVerse.
2. Tạo database trống (nếu cần): `CREATE DATABASE universe CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
3. Nạp dữ liệu:
   ```powershell
   Get-Content D:\Backups\universe_20261118_0200.sql | & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u USER -p universe
   ```
   ```bash
   gunzip < universe_20261118_0200.sql.gz | mysql -u USER -p universe
   ```
4. Giải nén bản sao `storage/` vào đúng thư mục dự án (ghi đè `storage/uploads`, `storage/avatars`).
5. Chạy `npm run db:deploy` để chắc chắn schema đã ở phiên bản mới nhất.
6. Khởi động lại server và kiểm tra `GET /api/v1/system/health`.

## 4. Khuyến nghị

- Giữ ít nhất 7 bản backup hằng ngày + 4 bản hằng tuần, lưu ở ổ đĩa/máy khác.
- Thử phục hồi định kỳ trên máy thử nghiệm để chắc chắn backup dùng được.
- File backup chứa dữ liệu cá nhân của sinh viên – cần bảo vệ (mã hóa ổ đĩa, phân quyền thư mục).
- Không lưu file `.env` cùng backup công khai.
