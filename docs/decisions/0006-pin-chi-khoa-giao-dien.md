# 0006. PIN chỉ khóa giao diện; token web mã hóa bằng PIN

- Trạng thái: Đã chốt
- Ngày: 2026-11-16 (ghi lại; quyết định có từ v1/v2)
- Nguồn: `docs/spec/security.md` (§7)
- Phạm vi: desktop, web

## Bối cảnh

App một người dùng, một token API toàn quyền. Cần chặn người qua đường mở app, không cần hệ thống tài khoản.

## Quyết định

- PIN 4 số **không bao giờ gửi lên server**. Desktop lưu `scrypt(pin, salt)`; sai 5 lần khóa 30 giây (lưu ra đĩa). Dùng chung bộ đếm cho màn khóa và cổng két sắt.
- Desktop: token mã hóa bằng `safeStorage`, chỉ main process đọc; renderer không bao giờ thấy token.
- Web: không có keychain, token mã hóa AES-GCM bằng khóa dẫn xuất từ PIN (PBKDF2-SHA256, 310 000 vòng). Đây là chống người qua đường, **không** chống người đọc được dữ liệu trình duyệt.

## Hệ quả

Đừng đưa token vào renderer, đừng gửi PIN lên server, đừng quảng cáo PIN web là bảo mật mạnh.
