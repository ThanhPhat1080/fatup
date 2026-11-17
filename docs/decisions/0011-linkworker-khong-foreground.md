# 0011. `LinkWorker` Android là worker thường, không foreground

- Trạng thái: Đã chốt
- Ngày: 2026-11-13
- Nguồn: ledger SDD link-bookmarks, Task 7 (Ruling)
- Phạm vi: android

## Bối cảnh

`UploadWorker` chạy foreground với thông báo tiến độ vì upload file lớn mất thời gian.

## Quyết định

`LinkWorker` (gửi một link qua `POST /links`) là `CoroutineWorker` thường, không thông báo foreground: request chỉ mất vài mili giây.

## Hệ quả

Không hiện thông báo tiến độ khi share link. Nếu sau này link cần việc nặng (tải ảnh xem trước trên máy), xem lại quyết định này.
