# 0009. Chỉ file trong thùng rác mới hết hạn

- Trạng thái: Đã chốt
- Ngày: 2026-11-15
- Nguồn: `CHANGELOG.md` 0.4.2 "Sửa"; commits `fe1a80b` (test thất bại), `b185a37` (sửa)
- Phạm vi: worker

## Bối cảnh

Cron cũ xóa cả file đã tải xong khi quá 30 ngày kể từ lúc tải lên, trái ý định. File đã mất thì không lấy lại được.

## Quyết định

Cron (03:00 UTC) chỉ xóa: (1) file nằm trong thùng rác quá 30 ngày, (2) upload dở dang quá 24 giờ, (3) dòng `shares` hết hạn. File ngoài thùng rác, kể cả trong két hay có nhãn quan trọng, giữ mãi. Cột `retain_from` không còn được ghi (vẫn còn trong bảng, không cần migration).

## Hệ quả

- R2 (10 GB free) sẽ đầy dần; thanh dung lượng cảnh báo từ 70%.
- Đừng thêm hạn cho file ngoài thùng rác mà không hỏi người dùng. Test "files outside the trash must never expire" giữ quy tắc này.
