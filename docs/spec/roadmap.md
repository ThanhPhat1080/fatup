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
- **Đo hiệu năng khóa đơn giản trên điện thoại thật.** Người dùng tự test sau. Nếu vẫn giật thì làm phương án C của [ADR 0020](../decisions/0020-khoa-don-gian-mac-dinh.md): chụp sẵn cánh cửa thành một ảnh rồi phủ lớp sáng.

### Nợ kỹ thuật

Các mục liên quan đến két sắt mã hóa (từ bản 0.5.0):

- **Android chưa mở được Két sắt mã hóa.** Phase mã hóa Két sắt (PIN 6 số + server đếm số lần sai) chỉ làm cho desktop và web. Android không thấy và không mở được két; muốn làm sau thì Android phải cài lại lõi mã hóa (FUV1, dẫn xuất khóa từ PIN, gọi endpoint `/vault/*`) theo đúng định dạng đã chốt.
- **Endpoint két kiểu cũ `PUT /files/:id/vault` còn giữ lại tạm thời.** Khi két chưa thiết lập, nó chạy như cũ để app bản cũ không hỏng; sau đó nó luôn trả `426 app_outdated`. Khi mọi máy đã lên bản có mã hóa thì xóa hẳn endpoint này (và nhánh xử lý `GET /files?vault=1` cho app cũ).
- **Chưa có "Tắt két sắt trên thiết bị này".** Máy bị soi HTTPS (ví dụ máy công ty có Zscaler) chỉ an toàn cho két nếu **không bao giờ mở két trên máy đó**, và hiện chỉ dựa vào việc người dùng tự nhớ. Hướng đã bàn: công tắc trong Cài đặt, lưu cục bộ (không đồng bộ), khi bật thì ẩn két và không gọi API két; bật lại cần PIN app (kiểm tra cục bộ, không qua server); trình thiết lập két hỏi "máy công ty/dùng chung?" để tắt sẵn.
- **Chạy thử với Worker và R2 thật (Task 14 của plan) đã bỏ qua** theo quyết định của người dùng. Thay bằng bước kiểm sau deploy trong mục Nâng cấp của [CHANGELOG 0.5.0](../../CHANGELOG.md). Việc này nên làm khi có thời gian.
- **Thiếu chuỗi lỗi cho một số mã mới.** Không có chuỗi `en`/`vi` riêng cho `size_mismatch`, `not_uploaded`, `already_encrypted`, `not_encrypted`, `forbidden`, `bad_item`; các mã này rơi về thông báo chung. Chúng chỉ hiện dưới dạng số mục thất bại, nên ít khi tới người dùng ([mục 4.3](api.md#43-két-sắt-mã-hóa)).
- **N6, hai `prepareSetup` chồng nhau.** Hai lần chuẩn bị thiết lập song song có thể lệch thứ tự. Giao diện đã chặn việc này, chưa chặn ở lớp session.
- **N8, D1 local phải reset.** `0009` đã bị sửa tại chỗ trước khi merge, nên D1 local đã migrate trước đó phải reset (xóa `worker/.wrangler/state`). Bản triển khai thật không bị ảnh hưởng vì chưa áp dụng ở đâu.
- **N10, màn khởi đầu lặp `vault_exists`.** Nếu `POST /vault/setup` đã thành công nhưng phản hồi bị mất, lần thử lại nhận `vault_exists` và màn khởi đầu hiện lại thông báo đó. Két đã có trên server; phiên chưa mở, cần mở bằng PIN.
- **M1, khe cron 03:00 UTC.** Giữa lúc cron nhả `out_started_at` và lúc xóa object, một lần lấy ra hợp lệ hoàn tất trong vài giây có thể bị cron xóa bản rõ. Xem [mục 7.7](security.md#77-giới-hạn-bảo-mật-còn-lại).
- **M3, thumbnail hết hạn sau 1 giờ.** Thumbnail trong danh sách là presigned URL của lần liệt kê, sống 1 giờ. Danh sách mở lâu hơn thì ảnh không tải tới khi làm mới.
- **M6 / FUV2, AAD chưa gắn với id.** Gắn `enc_meta` và `DEK` với id mục (định dạng FUV2) để người ghi được cả D1 lẫn R2 không hoán đổi được hai mục ([mục 7.7](security.md#77-giới-hạn-bảo-mật-còn-lại)).
- **Số vòng KDF tối thiểu phía server.** Server không kiểm `kdfIterations`; chỉ kiểm là số nguyên dương. Đề xuất: từ chối dưới 100 000 vòng.
- **Checksum của recovery key chưa bắt được đổi chỗ 2 ký tự cách nhau 16 giá trị.** Checksum là tổng có trọng số lẻ mod 32, bắt được mọi lỗi một ký tự nhưng không bắt được hoán đổi kiểu này ([mục 7.4](security.md#74-recovery-key)).
- **Khóa đóng hẳn giữa lúc mã hóa nền** (khóa app, hết 6 giờ, hoặc đóng app) có thể cắt việc mã hóa nền; lần mở két sau tự chạy tiếp. Cất từ danh sách chính không còn đóng két ([ADR 0016](../decisions/0016-phien-ket-sat-6-gio.md)).
- **Chưa có ảnh chụp dòng "Đang tạo két sắt…"** trong bộ ảnh e2e.
- **E2E `vault` chập chờn.** Đôi khi timeout ở bước `.vault-key` khi chạy cạnh việc khác, và một lần treo ở máy của agent. Chưa điều tra.
- **N3, mục nhấp nháy ở trang chính.** Một lần làm mới bắt đầu trước `vault/in` mà trả về sau khi mục đã được ẩn có thể làm mục hiện lại một lúc. Cần bộ đếm thế hệ cho làm mới ([mục 9.11](desktop-ui.md#911-két-sắt-mã-hóa)).
- **N4, cất và chuyển đổi chạy đôi.** `migrateLegacy` (sau thiết lập, sau mở két, sau khôi phục, và khi danh sách két thấy mục đám mây mờ) và cất từ danh sách chính có thể cùng chạy trên một mục. Kết quả đúng nhưng tốn công. Rời màn Két sắt (`vaultLeave`) không cắt lượt chuyển đổi đang chạy, vì khóa vẫn được giữ ([ADR 0016](../decisions/0016-phien-ket-sat-6-gio.md)).
- **E2E chưa phủ luồng thiết lập rồi cất, khôi phục từ popup, và đếm ngược khóa của popup.** Vùng `vault` mới kiểm popup khi chưa giữ khóa, sai PIN, hủy, PIN đúng và thông báo cất lỗi; chưa kiểm luồng "chưa thiết lập → thiết lập → cất", "Quên PIN" từ popup sang khôi phục, và đếm ngược khi popup bị khóa tạm.
- **Chuỗi `vaultUnlockToMove` và prop `hint` của `VaultGate` đã thừa.** Popup thay màn cổng khi cất, nên không còn chỗ nào dùng `vaultUnlockToMove` (`en` và `vi` trong `i18n.ts`) hoặc prop `hint` của `VaultGate.tsx`. Xóa cả hai.
- **Popup PIN gửi `not_ready` sang khôi phục.** `VaultPinDialog.tsx` đi tới màn khôi phục khi nhận `not_ready`, trong khi két chưa thiết lập thì cần đi tới trình thiết lập. Hiện popup chỉ mở khi két đã thiết lập, nên gần như không gặp; sửa khi làm lại popup.
- **Thiếu kiểm tra thế hệ sau `fetchPlain` (`serve`, `plainBytes`).** Byte đã giải mã của lượt tải đang chạy khi rời màn Két sắt vẫn có thể được trả về. Chấp nhận có chủ ý trong [ADR 0016](../decisions/0016-phien-ket-sat-6-gio.md) (mục c); thêm kiểm tra thế hệ sau khi tải để đóng lỗ này.
- **N5, thiếu test cho cron.** Chưa có test chứng minh cron để yên các key `vault/` sai dạng (không khớp `VAULT_KEY`) ([mục 6](lifecycle.md#6-vòng-đời-file-thùng-rác-và-dọn-dẹp)).
- **Đổi tên lúc đang chuyển.** `PATCH` đổi tên một mục đang ở trạng thái đám mây, trong lúc chuyển đổi chạy, có thể bị `encMeta` cũ của lần cất ghi đè tên mới. Chưa kiểm chứng.
- **`r2-cors.json` còn `exposeHeaders: etag`.** Không còn cần cho két; vô hại. Bỏ khi cập nhật file đó lần sau.
- **Ảnh thu nhỏ mất sau khi mã hóa (trong mock e2e).** Trong dữ liệu mock, ảnh thu nhỏ của mục sau khi mã hóa thành 476 B (icon chung). Chưa biết do mock hay do chuyển đổi; cần kiểm trên R2 thật.
- **Icon trạng thái chưa kiểm bằng mắt ở chế độ tối.**
- **Cột "Tải lên" trong danh sách trên điện thoại bị xuống dòng.**
- **E2E `share` đôi khi hỏng ở bước `tooltip shows on hover`** (`desktop/e2e/areas/share.mjs`): bước rê chuột rồi chờ cố định 600 ms trước khi đọc độ mờ của tooltip. Quan sát 1 lần hỏng trong 4 lần chạy lại (3 lần pass), cả khi chạy toàn bộ lẫn khi chạy riêng. Chưa kiểm trên `main`, nên chưa biết lỗi có từ trước hay không. Nên chờ theo điều kiện (poll độ mờ) thay vì chờ cố định.

Lấy ra khỏi két, đổi giao diện ngay (chi tiết và các ngoại lệ: [ADR 0017](../decisions/0017-lay-ra-khoi-ket-doi-giao-dien-ngay.md)):

- **Bản giả bấm được trong lúc lấy ra.** Vài giây của lượt, bản giả trong danh sách chính vẫn mở, đổi tên, xóa và cất vào két được, và trả lỗi khó hiểu vì server còn ghi mục là trong két. Cần chặn các thao tác này trên bản giả đang lấy ra.
- **Tên đã giải mã của bản giả nằm trong danh sách chính suốt lượt, kể cả sau khi rời màn Két sắt.** Đây là chủ ý, không phải lỗi: không ghi xuống đâu, và khóa app đóng màn chính nên mất ngay ([ADR 0017](../decisions/0017-lay-ra-khoi-ket-doi-giao-dien-ngay.md) mục b). Ghi ở đây để không bị coi là rò rỉ.
- **Lỗi chung khi cả lượt bị từ chối.** Khi lượt lấy ra bị từ chối trước khi xử lý từng file, người dùng chỉ thấy thông báo lỗi chung, không thấy "Không đưa ra được N file khỏi Két sắt" (`movedOutOfVaultFailed`). `moveBetween` trả mã lỗi nhưng `removeFromVault` không dùng để đếm số file.
- **Khôi phục sau lỗi dùng sắp xếp mặc định.** `restoreAfterFailedMoveOut` đưa mục về theo `DEFAULT_SORT`, không theo sắp xếp mà người dùng đã chọn cho danh sách két.
- **`enteringVault` có cùng race làm mới đến muộn.** Lấy ra đã sửa bằng bộ đếm thế hệ cho làm mới và giữ các id đã xong tới làm mới cuối cùng. Cất vào két chưa có cách sửa tương tự, nên một làm mới bắt đầu trước khi cất xong có thể làm mục hiện lại (xem thêm mục N3).
- **Chưa có test tự động cho hai chỗ vừa sửa.** Không có test cho việc bỏ ảnh thu nhỏ của bản giả (`thumbUrl` null, `failedSrc` trong `Files.tsx`), cũng không có test cho thứ tự làm mới cũ và mới (bộ đếm thế hệ trong `Main.tsx`).
- **Seed e2e không có ảnh có ảnh thu nhỏ để lấy ra.** Nhánh bản giả hiện icon thay cho ảnh thu nhỏ chưa được e2e phủ bằng một ảnh thật có thumbnail.
- **E2E căn giữa ô PIN chỉ đo chiều rộng desktop.** Bước kiểm trong vùng `vault` chỉ đo ở màn rộng. Popup `VaultPinDialog` giữ ô PIN căn trái có chủ ý ([9.11](desktop-ui.md#911-két-sắt-mã-hóa)).

Nhập ảnh từ `d30/` (thiết kế: [2026-11-18-nhap-anh-tu-thu-muc-bucket-design.md](../superpowers/specs/2026-11-18-nhap-anh-tu-thu-muc-bucket-design.md), chưa cài đặt):

- **Hai máy làm mới cùng lúc, cùng nhập một ảnh.** Id của dòng được tính từ object nguồn (key + etag) nên `INSERT OR IGNORE` chặn dòng trùng, nhưng chưa có test với hai request song song thật trên D1/R2 thật, và các bước copy/xóa bản gốc của hai máy có thể chồng nhau (copy hai lần cùng một đích, xóa bản gốc hai lần). Người dùng cho phép để lại ở đây. Nếu thấy một ảnh ở bucket thành hai dòng ở Fatup thì đây là chỗ nghi đầu tiên.
- **Ảnh nhập lại sau khi đã xóa vĩnh viễn.** Nếu lần nhập bị ngắt giữa bước đánh dấu `ready` và bước xóa bản gốc, rồi người dùng xóa vĩnh viễn file đó trước khi lần quét sau chạy, bản gốc còn ở `d30/` sẽ được nhập lại.

Nhập ảnh từ `d30/` ([thiết kế](../superpowers/specs/2026-11-18-nhap-anh-tu-thu-muc-bucket-design.md)):

- **Hai máy làm mới cùng lúc, cùng nhập một ảnh.** Id của dòng được tính từ object nguồn (key + etag) nên khóa chính chặn dòng trùng, và test chạy hai request song song trên bucket giả lập đạt; nhưng chưa thử với S3 API và D1 thật, và các bước copy/xóa bản gốc của hai máy có thể chồng nhau (copy hai lần cùng một đích, xóa bản gốc hai lần). Người dùng cho phép để lại ở đây. Nếu thấy một ảnh ở bucket thành hai dòng ở Fatup thì đây là chỗ nghi đầu tiên.
- **Ảnh nhập lại sau khi đã xóa vĩnh viễn.** Nếu lần nhập bị ngắt giữa bước `ready` và bước xóa bản gốc, rồi người dùng xóa vĩnh viễn file đó trước lần quét sau, bản gốc còn ở `d30/` sẽ được nhập lại.
- **Ảnh chưa có thumbnail nào cũng hiện bằng ảnh gốc** (không riêng ảnh nhập), kể cả ảnh mà thumbnail lỗi lúc upload. Ảnh gốc tới 100 MB tải theo kiểu lazy (URL ổn định theo giờ nên không tải lại mỗi phút); ảnh HEIC trình duyệt không giải mã được thì rơi về biểu tượng file, và Lightbox chưa có `onError` cho `thumbUrl` nên hiện ảnh hỏng.
- **Thumbnail bù (desktop) tải trọn ảnh gốc tới 100 MB vào RAM và giải mã đồng bộ** trên main process; danh sách "đã thử" chỉ sống một phiên, nên một ảnh làm app sập sẽ bị thử lại ở lần mở sau. Cân nhắc chặn theo kích thước.
- **Key có đoạn `.` hoặc `..`** (ví dụ `d30/../a.png`) bị URL chuẩn hóa nên bản gốc không bao giờ bị xóa và chiếm một chỗ trong lô mỗi lần quét. Tham chiếu ký tự dạng số (`&#13;`) trong XML liệt kê chưa được giải mã. Còn một khe cỡ mili giây giữa `HEAD` và `DELETE` của bản gốc (chưa kiểm R2 có hỗ trợ DELETE có điều kiện).
- **Quét `d30/` liệt kê cả những object không phải ảnh ở mỗi lần.** Thư mục có hàng chục nghìn object không phải ảnh sẽ làm mỗi lần quét tốn vài lần gọi liệt kê.
