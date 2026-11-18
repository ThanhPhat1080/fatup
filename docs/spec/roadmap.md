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

Nhập ảnh từ `d30/` ([thiết kế](../superpowers/specs/2026-11-18-nhap-anh-tu-thu-muc-bucket-design.md)):

- **Hai máy làm mới cùng lúc, cùng nhập một ảnh.** Id của dòng được tính từ object nguồn (key + etag) nên khóa chính chặn dòng trùng, và test chạy hai request song song trên bucket giả lập đạt; nhưng chưa thử với S3 API và D1 thật, và các bước copy/xóa bản gốc của hai máy có thể chồng nhau (copy hai lần cùng một đích, xóa bản gốc hai lần). Người dùng cho phép để lại ở đây. Nếu thấy một ảnh ở bucket thành hai dòng ở Fatup thì đây là chỗ nghi đầu tiên.
- **Ảnh nhập lại sau khi đã xóa vĩnh viễn.** Nếu lần nhập bị ngắt giữa bước `ready` và bước xóa bản gốc, rồi người dùng xóa vĩnh viễn file đó trước lần quét sau, bản gốc còn ở `d30/` sẽ được nhập lại.
- **Khi hợp nhất với nhánh Két sắt mã hóa (`feat/vault-e2ee`):** nhánh này thêm cột `encrypted`. Ba chỗ phải thêm điều kiện `encrypted = 0` (đang có `TODO(vault-e2ee)`): `thumbUrl` dự phòng của `toItem`, hai route `/files/:id/thumb[/complete]` (trả `409 encrypted`), và bộ lọc của `createThumbBackfill` ở desktop. Quên thì mục mã hóa không có thumbnail sẽ trỏ `thumbUrl` vào `files/<id>` không tồn tại.
- **Ảnh chưa có thumbnail nào cũng hiện bằng ảnh gốc** (không riêng ảnh nhập), kể cả ảnh mà thumbnail lỗi lúc upload. Ảnh gốc tới 100 MB tải theo kiểu lazy (URL ổn định theo giờ nên không tải lại mỗi phút); ảnh HEIC trình duyệt không giải mã được thì rơi về biểu tượng file, và Lightbox chưa có `onError` cho `thumbUrl` nên hiện ảnh hỏng.
- **Thumbnail bù (desktop) tải trọn ảnh gốc tới 100 MB vào RAM và giải mã đồng bộ** trên main process; danh sách "đã thử" chỉ sống một phiên, nên một ảnh làm app sập sẽ bị thử lại ở lần mở sau. Cân nhắc chặn theo kích thước.
- **Key có đoạn `.` hoặc `..`** (ví dụ `d30/../a.png`) bị URL chuẩn hóa nên bản gốc không bao giờ bị xóa và chiếm một chỗ trong lô mỗi lần quét. Tham chiếu ký tự dạng số (`&#13;`) trong XML liệt kê chưa được giải mã. Còn một khe cỡ mili giây giữa `HEAD` và `DELETE` của bản gốc (chưa kiểm R2 có hỗ trợ DELETE có điều kiện).
- **Quét `d30/` liệt kê cả những object không phải ảnh ở mỗi lần.** Thư mục có hàng chục nghìn object không phải ảnh sẽ làm mỗi lần quét tốn vài lần gọi liệt kê.
