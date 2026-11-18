-- Đổi màu mặc định từ tông tím sang xanh dương / cyan (chỉ đổi DEFAULT, không sửa dữ liệu đang có)
-- AlterTable
ALTER TABLE `Group` MODIFY `color` VARCHAR(9) NOT NULL DEFAULT '#2563EB';

-- AlterTable
ALTER TABLE `Subject` MODIFY `color` VARCHAR(9) NOT NULL DEFAULT '#2563EB';

-- AlterTable
ALTER TABLE `Tag` MODIFY `color` VARCHAR(9) NOT NULL DEFAULT '#0891B2';
