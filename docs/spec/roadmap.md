# Lộ trình

> Một phần của [SPEC](../../SPEC.md). Đây là **kế hoạch**, không phải trạng thái hiện tại: việc đã làm xong thì chuyển mô tả sang file spec của vùng đó.

## 13. Lộ trình

### Phase 1: hoàn thành (`v0.1.6`)

Android share target, app desktop (xem, tải lên, tải về, tìm kiếm, sắp xếp, chọn nhiều file), thùng rác, két sắt, thanh dung lượng, dark mode, kiểm tra cập nhật, **đổi tên, thẻ màu, Tải tất cả**, màn hình khóa có hoạt họa, và bản web PWA ở mức xem/quản lý (mục [10](web.md#10-bản-web-pwa)).

**Phần server cần chạy khi nâng cấp lên bản có thẻ màu:** `npm run db:migrate:remote` (áp dụng `0004`) rồi `npm run deploy`, theo thứ tự đó.

**Nâng cấp lên bản có liên kết:** `0005` **dựng lại bảng `files`**; nên sao lưu D1 trước, rồi `npm run db:migrate:remote` và `npm run deploy`, theo thứ tự đó.

### Phase 2: bản web PWA đầy đủ, cài lên Android và các thiết bị khác

Mục tiêu: bản web đủ dùng để **thay thế việc cài app** trên Android, máy tính hoặc iOS, với giao diện giống hệt app desktop.

- **Đã làm:** upload từ web ([10.1](web.md#101-upload-từ-web)), giao diện điện thoại ([10.2](web.md#102-giao-diện-điện-thoại)), CORS cho R2 (`npm run r2:cors`), **liên kết/bookmark** (share từ Android và PWA, nút Thêm liên kết, [mục 4.1](api.md#41-liên-kết-bookmark), [9.2c](desktop-ui.md#92c-liên-kết)).
- **Chưa làm:** nhận **file** khi Chia sẻ vào PWA (Web Share Target mới nhận link), nút "Cài FatUp" và hướng dẫn cài iOS, màn hình offline. Icon PWA có cả bản `any` (hình vuông bo góc, nền trong) và bản `maskable` (gradient phủ kín, mũi tên trong vùng an toàn 80%) để Android cắt tròn mà không thấy nền trắng; vẽ lại bằng `node web/scripts/pwa-icons.mjs`.
- **Cần kiểm tra trên thiết bị thật:** cảm ứng (giữ lâu, chụm, vuốt) và upload qua mạng di động. Phần này mới được thử bằng giả lập.

### Hướng mở rộng khác

- Mã hóa phía client cho Két sắt (khóa dẫn xuất từ PIN/passphrase mạnh hơn), để file trong két không đọc được dù lộ token.
- Thả thư mục; tiếp tục upload bị gián đoạn.
- Android xem lại file đã gửi, có thùng rác/két sắt.
- Ký số macOS/Windows để cập nhật tự động trên mọi nền tảng.
- Test E2E cho giao diện mới; cập nhật lại ảnh chụp màn hình trong README.

### Nợ kỹ thuật

- **Android chưa mở được Két sắt mã hóa.** Phase mã hóa Két sắt (E2EE, PIN 6 số + server đếm số lần sai) chỉ làm cho desktop và web. Android không thấy và không mở được két; muốn làm sau thì Android phải cài lại lõi mã hóa (giải mã theo khối AES-256-GCM, dẫn xuất khóa từ PIN, gọi endpoint mở két) theo đúng định dạng đã chốt cho desktop/web.
- **Endpoint két kiểu cũ `PUT /files/:id/vault` còn giữ lại tạm thời.** Trước khi két được thiết lập mã hóa, nó chạy như cũ để app bản cũ không hỏng; sau đó nó luôn trả lỗi "Cần cập nhật app". Khi mọi máy đã lên bản có mã hóa thì xóa hẳn endpoint này (và nhánh xử lý `GET /files?vault=1` cho app cũ).
- **Chưa có "Tắt két sắt trên thiết bị này".** Máy bị soi HTTPS (ví dụ máy công ty có Zscaler) chỉ an toàn cho két nếu **không bao giờ mở két trên máy đó**, và hiện chỉ dựa vào việc người dùng tự nhớ. Hướng đã bàn: công tắc trong Cài đặt, lưu cục bộ (không đồng bộ), khi bật thì ẩn két và không gọi API két; bật lại cần PIN app (kiểm tra cục bộ, không qua server); trình thiết lập két hỏi "máy công ty/dùng chung?" để tắt sẵn.
