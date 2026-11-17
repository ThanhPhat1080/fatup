# Lộ trình

> Một phần của [SPEC](../../SPEC.md). Đây là **kế hoạch**, không phải trạng thái hiện tại: việc đã làm xong thì chuyển mô tả sang file spec của vùng đó.

## 13. Lộ trình

### Phase 1: hoàn thành (`v0.1.6`)

Android share target, app desktop (xem, tải lên, tải về, tìm kiếm, sắp xếp, chọn nhiều file), thùng rác, két sắt, thanh dung lượng, dark mode, kiểm tra cập nhật, **đổi tên, thẻ màu, Tải tất cả**, màn hình khóa có hoạt họa, và bản web PWA ở mức xem/quản lý (mục [10](web.md#10-bản-web-pwa)).

**Phần server cần chạy khi nâng cấp lên bản có thẻ màu:** `npm run db:migrate:remote` (áp dụng `0004`) rồi `npm run deploy`, theo thứ tự đó.

**Nâng cấp lên bản có liên kết:** `0005` **dựng lại bảng `files`**; nên sao lưu D1 trước, rồi `npm run db:migrate:remote` và `npm run deploy`, theo thứ tự đó.

### Phase 2: bản web PWA đầy đủ, cài lên Android và các thiết bị khác

Mục tiêu: bản web đủ dùng để **thay thế việc cài app** trên Android, máy tính hoặc iOS, với giao diện giống hệt app desktop.

- **Đã làm:** upload từ web ([10.1](web.md#101-upload-từ-web)), giao diện điện thoại ([10.2](web.md#102-giao-diện-điện-thoại)), CORS cho R2 (`npm run r2:cors`), **liên kết/bookmark** (share từ Android và PWA, nút Thêm liên kết, [mục 4.1](api.md#41-liên-kết-bookmark), [9.2c](desktop-ui.md#92c-liên-kết)), **két sắt mã hóa phía client** trên desktop và web ([mục 7.1](security.md#71-két-sắt-mã-hóa-phía-client-e2ee), [9.11](desktop-ui.md#911-két-sắt-mã-hóa), [10.3](web.md#103-két-sắt-trên-web)).
- **Chưa làm:** nhận **file** khi Chia sẻ vào PWA (Web Share Target mới nhận link), nút "Cài FatUp" và hướng dẫn cài iOS, màn hình offline. Icon PWA có cả bản `any` (hình vuông bo góc, nền trong) và bản `maskable` (gradient phủ kín, mũi tên trong vùng an toàn 80%) để Android cắt tròn mà không thấy nền trắng; vẽ lại bằng `node web/scripts/pwa-icons.mjs`.
- **Cần kiểm tra trên thiết bị thật:** cảm ứng (giữ lâu, chụm, vuốt) và upload qua mạng di động. Phần này mới được thử bằng giả lập.

### Hướng mở rộng khác

- Thả thư mục; tiếp tục upload bị gián đoạn.
- Android xem lại file đã gửi, có thùng rác/két sắt.
- Ký số macOS/Windows để cập nhật tự động trên mọi nền tảng.
- Test E2E cho giao diện mới; cập nhật lại ảnh chụp màn hình trong README.

### Nợ kỹ thuật

Các mục liên quan đến két sắt mã hóa (từ bản 0.5.0):

- **Android chưa mở được Két sắt mã hóa.** Phase mã hóa Két sắt (PIN 6 số + server đếm số lần sai) chỉ làm cho desktop và web. Android không thấy và không mở được két; muốn làm sau thì Android phải cài lại lõi mã hóa (FUV1, dẫn xuất khóa từ PIN, gọi endpoint `/vault/*`) theo đúng định dạng đã chốt.
- **Endpoint két kiểu cũ `PUT /files/:id/vault` còn giữ lại tạm thời.** Khi két chưa thiết lập, nó chạy như cũ để app bản cũ không hỏng; sau đó nó luôn trả `426 app_outdated`. Khi mọi máy đã lên bản có mã hóa thì xóa hẳn endpoint này (và nhánh xử lý `GET /files?vault=1` cho app cũ).
- **Chưa có "Tắt két sắt trên thiết bị này".** Máy bị soi HTTPS (ví dụ máy công ty có Zscaler) chỉ an toàn cho két nếu **không bao giờ mở két trên máy đó**, và hiện chỉ dựa vào việc người dùng tự nhớ. Hướng đã bàn: công tắc trong Cài đặt, lưu cục bộ (không đồng bộ), khi bật thì ẩn két và không gọi API két; bật lại cần PIN app (kiểm tra cục bộ, không qua server); trình thiết lập két hỏi "máy công ty/dùng chung?" để tắt sẵn.
- **Chạy thử với Worker và R2 thật (Task 14 của plan) đã bỏ qua** theo quyết định của người dùng. Thay bằng bước kiểm sau deploy trong mục Nâng cấp của [CHANGELOG 0.5.0](../../CHANGELOG.md). Việc này nên làm khi có thời gian.
- **Thiếu chuỗi lỗi cho một số mã mới.** Không có chuỗi `en`/`vi` riêng cho `item_busy`, `size_mismatch`, `not_uploaded`, `already_encrypted`, `not_encrypted`, `forbidden`, `bad_item`; các mã này rơi về thông báo chung ([mục 4.3](api.md#43-két-sắt-mã-hóa)).
- **Bản web và desktop khác nhau khi két chưa thiết lập.** Desktop đưa file vào két như cũ (chưa mã hóa); web báo `vault_locked`. Cần chọn một hành vi ([mục 5.2](lifecycle.md#52-két-sắt-secret-vault), [mục 10.3](web.md#103-két-sắt-trên-web)).
- **N2, thumbnail không kiểm ETag.** Ảnh xem trước của mục két không được kiểm bằng ETag như file. Nếu hai máy cùng cất (đã có claim chặn), thumbnail có thể không giải mã được; file vẫn đúng.
- **N6, hai `prepareSetup` chồng nhau.** Hai lần chuẩn bị thiết lập song song có thể lệch thứ tự. Giao diện đã chặn việc này, chưa chặn ở lớp session.
- **N8, D1 local phải reset.** `0009` đã bị sửa tại chỗ trước khi merge, nên D1 local đã migrate trước đó phải reset (xóa `worker/.wrangler/state`). Bản triển khai thật không bị ảnh hưởng vì chưa áp dụng ở đâu.
- **N10, màn khởi đầu lặp `vault_exists`.** Nếu `POST /vault/setup` đã thành công nhưng phản hồi bị mất, lần thử lại nhận `vault_exists` và màn khởi đầu hiện lại thông báo đó. Két đã có trên server; phiên chưa mở, cần mở bằng PIN.
- **M1, khe cron 03:00 UTC.** Giữa lúc cron nhả `out_started_at` và lúc xóa object, một lần lấy ra hợp lệ hoàn tất trong vài giây có thể bị cron xóa bản rõ. Xem [mục 7.7](security.md#77-giới-hạn-bảo-mật-còn-lại).
- **M2, thông điệp `item_busy` khi claim hết hạn.** `vault/in/complete` trả `item_busy` cả khi giữ chỗ của chính máy này đã hết hạn (máy hoàn tất quá 2 giờ); thông điệp hiện là "máy khác đang chuyển", không đúng.
- **M3, thumbnail hết hạn sau 1 giờ.** Thumbnail trong danh sách là presigned URL của lần liệt kê, sống 1 giờ. Danh sách mở lâu hơn thì ảnh không tải tới khi làm mới.
- **M6 / FUV2, AAD chưa gắn với id.** Gắn `enc_meta` và `DEK` với id mục (định dạng FUV2) để người ghi được cả D1 lẫn R2 không hoán đổi được hai mục ([mục 7.7](security.md#77-giới-hạn-bảo-mật-còn-lại)).
- **Số vòng KDF tối thiểu phía server.** Server không kiểm `kdfIterations`; chỉ kiểm là số nguyên dương. Đề xuất: từ chối dưới 100 000 vòng.
- **Checksum của recovery key chưa bắt được đổi chỗ 2 ký tự cách nhau 16 giá trị.** Checksum là tổng có trọng số lẻ mod 32, bắt được mọi lỗi một ký tự nhưng không bắt được hoán đổi kiểu này ([mục 7.4](security.md#74-recovery-key)).
- **Key object mỗi claim.** Ghi `vault/<id>.<claim>` thay vì ghi đè một key sẽ loại hẳn rủi ro PUT chậm vượt claim ([mục 7.7](security.md#77-giới-hạn-bảo-mật-còn-lại)).
- **Đóng két ngay sau cất từ danh sách chính** có thể cắt việc mã hóa nền; lần mở két sau tự chạy tiếp.
- **Chưa có ảnh chụp dòng "Đang tạo két sắt…"** trong bộ ảnh e2e.
- **E2E `vault` đôi khi timeout ở bước `.vault-key`** khi chạy cạnh việc khác. Chập chờn, chưa điều tra.
