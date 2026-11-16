# 0003. Thu hồi link chia sẻ bằng trigger SQL

- Trạng thái: Đã chốt
- Ngày: 2026-11-16
- Nguồn: `docs/superpowers/specs/2026-11-16-share-links-design.md` §4.2, §4.6, §7 (1, 2, 13); migration `worker/migrations/0008_shares.sql`
- Phạm vi: worker

## Bối cảnh

Quy tắc người dùng nêu: file vào Két sắt hoặc thùng rác thì mọi link chia sẻ **chết ngay** và **không sống lại** khi khôi phục. Có nhiều đường làm file bị ẩn (xóa, vào két, xóa hàng loạt, sau này có thể thêm). Kiểm tra trong từng route thì dễ sót một đường.

## Quyết định

Trigger `shares_revoke_on_hide` trên bảng `files` xóa dòng `shares` khi `deleted_at` được đặt hoặc `in_vault` thành 1. Mỗi request công khai vẫn chạy một truy vấn JOIN kiểm tra file còn hợp lệ. Khôi phục/lấy khỏi két không tạo lại link; chia sẻ lại sinh token mới. `purge` vẫn xóa `shares` tường minh, không dựa vào `ON DELETE CASCADE` (D1 có thể không bật khóa ngoại).

## Hệ quả

- Đừng chuyển việc thu hồi vào code route; đừng bỏ JOIN kiểm tra ở `/s/`.
- Sau migrate trên D1 thật phải kiểm tra trigger tồn tại (lệnh trong `CHANGELOG.md` 0.4.2).
