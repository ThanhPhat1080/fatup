# 0006. PIN chỉ khóa giao diện; token web mã hóa bằng PIN

- Trạng thái: Đã chốt; một phần bị thay bởi [0013](0013-ket-sat-ma-hoa-phia-client.md)
- Ngày: 2026-11-16 (ghi lại; quyết định có từ v1/v2)
- Nguồn: `docs/spec/security.md` (§7)
- Phạm vi: desktop, web

## Bối cảnh

App một người dùng, một token API toàn quyền. Cần chặn người qua đường mở app, không cần hệ thống tài khoản.

## Quyết định

- PIN 4 số **không bao giờ gửi lên server**. Desktop lưu `scrypt(pin, salt)`; sai 5 lần khóa 30 giây (lưu ra đĩa). Dùng chung bộ đếm cho màn khóa và cổng két sắt. *(Đã thay bởi 0013: két có bộ đếm riêng trên server.)*
- Desktop: token mã hóa bằng `safeStorage`, chỉ main process đọc; renderer không bao giờ thấy token.
- Web: không có keychain, token mã hóa AES-GCM bằng khóa dẫn xuất từ PIN (PBKDF2-SHA256, 310 000 vòng). Đây là chống người qua đường, **không** chống người đọc được dữ liệu trình duyệt.

**Cập nhật 2026-11-17, một phần bị thay bởi [0013](0013-ket-sat-ma-hoa-phia-client.md):**

- PIN app 4 số **vẫn chỉ khóa giao diện và không bao giờ lên server**. Bộ đếm sai của màn khóa app là cục bộ.
- Két sắt có PIN riêng 6 số. PIN két tham gia kiểm tra phía server (qua `authKey` dẫn xuất, bộ đếm sai nằm trên server), nhưng **không bao giờ gửi dạng đọc được**.
- Két sắt không còn là lớp che giao diện: nội dung và metadata được mã hóa trên máy.

## Hệ quả

Đừng đưa token vào renderer, đừng gửi PIN app lên server, đừng quảng cáo PIN web là bảo mật mạnh. Đừng gửi PIN két, `MK`, `DEK`, `S` lên server (xem 0013).
