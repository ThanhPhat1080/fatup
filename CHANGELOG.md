# Changelog

Mọi thay đổi đáng chú ý của FatUp. Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), số phiên bản theo `x.y.z` (khớp với tag `v*` trên GitHub; app desktop kiểm tra cập nhật bằng cách so số này).

Mục **Nâng cấp** ở mỗi phiên bản nói rõ phần server cần chạy. Thứ tự luôn là: **migrate trước, deploy sau** (`npm run db:migrate:remote` rồi `npm run deploy` trong `worker/`).

## [0.5.9] — 2026-11-23

### Sửa
- **Khóa đơn giản hết lag trên điện thoại.** Bản 0.5.8 vẫn giật vì trình duyệt phải vẽ lại SVG (có `mask`) mỗi nhịp sáng.

### Đổi
- Cánh cửa của khóa đơn giản giờ là hai ảnh WebP vẽ sẵn (nền tĩnh và hình khắc sáng, mỗi ảnh < 150 KB); chỉ độ sáng của ảnh sáng đổi chậm (3 giây mỗi nhịp), không còn gì vẽ lại lúc chạy. Hình ảnh giữ nguyên. Ảnh tạo bằng `desktop/scripts/render-door.mjs`. Chi tiết: [ADR 0020](docs/decisions/0020-khoa-don-gian-mac-dinh.md).

### Nâng cấp
Không có migration, không đổi server. Phát hành app máy tính mới và deploy lại PWA.

## [0.5.8] — 2026-11-23

### Thêm
- **Tùy chọn "Dùng khóa LOTR"** trong Cài đặt. Bật thì màn khóa và cổng Két sắt như trước: cảnh cổng Moria đầy đủ trên máy tính, cửa Moria có hai cây trên điện thoại, và ông phù thủy ở cổng Két sắt.

### Đổi
- **Màn khóa mặc định là khóa đơn giản, nhẹ hơn.** Khi tắt tùy chọn (mặc định), màn khóa app là một cánh cửa Moria với ánh sáng đổi chậm, không có hoạt họa; cổng Két sắt là cánh cửa đó có chữ **VAULT**. Nhằm giảm giật và lag trên điện thoại. PIN đúng ở cổng Két sắt mở két ngay; nút ← Quay lại thoát ngay. Chi tiết: [ADR 0020](docs/decisions/0020-khoa-don-gian-mac-dinh.md).

### Nâng cấp
Không có migration, không đổi server. Phát hành app máy tính mới và deploy lại PWA. Người dùng cũ sẽ thấy khóa đơn giản ngay sau khi cập nhật, vì mặc định là tắt; muốn lại cảnh đầy đủ thì tick **Dùng khóa LOTR** trong Cài đặt.

## [0.5.7] — 2026-11-23

### Sửa
- **Làm mới theo yêu cầu nhập ảnh từ bucket ngay.** Nút làm mới và `Ctrl+R`/`Cmd+R` không còn bị giới hạn 30 giây của bước nhập ảnh từ thư mục bucket (`importSync`); file mới thấy ngay. Làm mới tự động (theo chu kỳ, lấy lại focus) vẫn giữ giới hạn đó.

### Nâng cấp
Không có migration, không đổi server. Phát hành app máy tính mới và deploy lại PWA.

## [0.5.6] — 2026-11-19

### Đổi
- **Bút chì, nút copy link và nút Tải về chỉ hiện khi rê chuột** (cả lưới lẫn danh sách; màn cảm ứng vẫn luôn hiện). Sửa lại 0.5.4, khi bút chì bị làm luôn hiện nhầm. Nút Tải về to hơn.

### Nâng cấp
Không có migration, không đổi server. Phát hành app máy tính mới và deploy lại PWA.

## [0.5.5] — 2026-11-19

### Đổi
- **Dạng danh sách có nút Tải về** (hiện khi rê chuột vào hàng) cho ảnh và file, như dạng lưới.

### Nâng cấp
Không có migration, không đổi server. Phát hành app máy tính mới và deploy lại PWA.

## [0.5.4] — 2026-11-19

### Sửa
- **PWA: tải nhiều file chỉ được một file.** Trình duyệt chặn các lần tải tự động liên tiếp; nay **Tải tất cả** gói các file đã chọn thành một `fatup.zip`. App máy tính làm giống hệt (ghi `fatup.zip` vào thư mục Tải về) để hai bản đồng nhất. Tổng một lần tải tối đa 1 GB.

### Đổi
- **Bút chì (và nút copy link) ở dạng lưới luôn hiện**, không còn chỉ hiện khi rê chuột.
- **Ảnh cũng có nút Tải về khi rê chuột** ở dạng lưới (trước chỉ file).

### Nâng cấp
Không có migration, không đổi server. Chỉ cần phát hành app máy tính mới và deploy lại PWA.

## [0.5.3] — 2026-11-18

### Đổi
- **Biểu tượng file dễ phân biệt hơn:** ảnh đổi sang màu xanh ngọc (trước đây đỏ, giống PDF); video màu hồng và nhận cả video có `mime` chung (`.mov`, `.mkv`...); thêm biểu tượng riêng có dải chữ cho **Markdown (MD)**, **HTML** và **văn bản (TXT)**.
- **Két sắt không còn hiện thumbnail** của bất kỳ ảnh nào (ảnh trong két thường là ảnh nhạy cảm). Danh sách két chỉ hiện biểu tượng file và tên; ảnh chỉ được tải và giải mã khi bạn mở nó (trình xem ảnh, Tải về, Sao chép ảnh), vẫn sau PIN két. Mở két nhanh hơn vì không tải thumbnail nào. Danh sách chính không đổi, và ảnh lấy ra khỏi két vẫn có thumbnail như cũ. Chi tiết: [ADR 0019](docs/decisions/0019-ket-sat-khong-hien-thumbnail.md).

### Nâng cấp
Không có migration, không đổi server. Chỉ cần phát hành app máy tính mới và deploy lại PWA.

## [0.5.2] — 2026-11-18

### Sửa
- **Cổng Két sắt trên điện thoại không còn giật.** Trên điện thoại (cửa sổ hẹp ≤ 720 px, hoặc màn cảm ứng nằm ngang) cổng là **bức tranh tĩnh**: không lửa ở đáy, tro, tia lửa, sao băng hay ánh lửa trên cầu, ông phù thủy đứng yên. PIN đúng mở két ngay (không còn bom), nút Quay lại thoát ngay. Máy tính để bàn giữ nguyên cảnh hoạt họa.
- **Hàng sáu ô PIN trong popup "Mở Két sắt" được căn giữa** (trước đây lệch trái so với hộp thoại).

### Nâng cấp
Không có migration, không đổi server. Chỉ cần phát hành app máy tính mới và deploy lại PWA (mở lại PWA hai lần để service worker nhận bản mới).

## [0.5.1] — 2026-11-18

### Thêm
- **Ảnh app khác bỏ vào bucket hiện ngay ở Fatup.** Ảnh nằm trong thư mục `d30/` của bucket (đổi bằng biến `IMPORT_PREFIX` trong `worker/wrangler.toml`; để trống thì tắt) được **di chuyển** sang `files/<id>` mỗi khi mở hoặc làm mới danh sách (tối đa 10 ảnh mỗi lần, cách nhau ≥ 30 giây). Chỉ nhập ảnh (`png jpg jpeg gif webp bmp heic heif avif`, ≤ 100 MB); mọi thứ khác bị bỏ qua và để nguyên. Một ảnh ở bucket không bao giờ thành hai dòng ở Fatup (id tính từ object nguồn), và bản gốc chỉ bị xóa sau khi bản copy đã đủ. Xóa trong Fatup là xóa hẳn khỏi bucket. Chi tiết: [api.md 4.4](docs/spec/api.md#44-nhập-ảnh-từ-thư-mục-của-bucket), [ADR 0018](docs/decisions/0018-nhap-anh-tu-thu-muc-bucket.md).
- **Thumbnail bù (desktop):** ảnh chưa có thumbnail được app desktop tạo và tải lên ở nền. Trong lúc chưa có, mọi client hiện ảnh gốc (`thumbUrl`; `FileItem` thêm `hasThumb`).

### Nâng cấp
**Không có migration.** Chỉ cần `npm run deploy:worker`. Biến `IMPORT_PREFIX = "d30/"` đã nằm trong `worker/wrangler.toml`; đặt thành `""` nếu không muốn nhập. Việc nhập dùng khóa R2 sẵn có (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) qua S3 API; khóa đó phải có quyền ghi và xóa trên bucket (đã cần cho upload). Phát hành app máy tính mới để có thumbnail bù và gọi đồng bộ khi làm mới; deploy lại PWA để web cũng gọi đồng bộ (mở lại PWA hai lần để service worker nhận bản mới). App cũ vẫn chạy; chỉ là không tự gọi đồng bộ, nên ảnh chỉ vào khi có máy bản mới làm mới.

## [0.5.0] — 2026-11-18

### Thêm
- **Két sắt mã hóa đầu cuối** (máy tính và bản web). File trong két được mã hóa trên máy trước khi rời máy: nội dung, ảnh xem trước, tên, loại và địa chỉ liên kết. Server và R2 chỉ thấy bản mã, nên người có API token không đọc được file trong két.
  - Mở két bằng **PIN két 6 số**, khác PIN app 4 số. Nhập sai nhiều lần thì két bị khóa tạm; sai 10 lần thì két bị đặt lại và chỉ **recovery key** mở được.
  - Thiết lập lần đầu theo hai bước: đặt PIN, rồi nhận **recovery key** (hiện một lần, có nút sao chép) và gõ lại hai nhóm ngẫu nhiên để xác nhận. Các file đã có trong két được mã hóa dần, có tiến trình.
  - **Recovery key** dùng khi quên PIN: màn khôi phục đặt PIN mới, không mã hóa lại file. Đổi PIN két trong Cài đặt (cần PIN cũ hoặc recovery key).
  - **Thùng rác riêng của két**: khôi phục, xóa vĩnh viễn, dọn sạch, Hoàn tác 8 giây; file tự xóa sau 30 ngày.
  - **Giữ khóa 6 giờ:** sau khi nhập đúng PIN két, app giữ két mở để cất file trong **6 giờ** kể từ lần nhập đúng gần nhất (cố định, không gia hạn khi dùng). Trong thời gian đó cất file vào két không hỏi PIN nữa. Hết 6 giờ, khóa app hoặc đăng xuất thì két đóng hẳn.
  - **Cất vào két từ danh sách chính:** nếu két chưa mở, một popup nhỏ hiện ngay trên danh sách để hỏi PIN két, không chuyển sang màn Két sắt; nhập đúng thì file được cất và danh sách vẫn ở nguyên. Popup có nút Hủy và "Quên PIN" (sang khôi phục). Mục vừa cất rời danh sách chính ngay. Trong két, mục chưa mã hóa xong hiện **biểu tượng đám mây mờ**, và đổi thành **dấu tick xanh** khi đã mã hóa xong; các máy khác thấy đổi khi làm mới. File không đọc được hiện "Không đọc được trên thiết bị này".
  - **Thông báo khi cất lỗi** nói rõ lý do: file đã vào két sẽ hiện đám mây mờ và được mã hóa lại tự động; file còn ở danh sách chính thì cất lại sau. Không còn chỉ báo "N lỗi".
  - Vào màn Két sắt luôn hỏi PIN két, kể cả khi đang giữ khóa. Đổi PIN két trong Cài đặt không cần mở két.
  - Tải file lên thẳng vào két khi két đang giữ khóa (trong 6 giờ sau PIN đúng).
  - Bản web: két chạy trong bộ nhớ trang. Khóa và dữ liệu két không ghi vào `localStorage`, IndexedDB hay Cache Storage.
  - Tài liệu: [mục 7.1–7.7 của security](docs/spec/security.md), [ADR 0013](docs/decisions/0013-ket-sat-ma-hoa-phia-client.md) và [ADR 0015](docs/decisions/0015-mot-object-rieng-moi-lan-ma-hoa.md).

### Đổi
- **Xóa một file trong két** đưa nó vào **thùng rác của két**, không còn vào thùng rác thường. File vẫn ở trong két.
- **Thùng rác thường không hiện file của két.** **Dọn sạch** thùng rác thường không đụng tới thùng rác của két.
- **PIN két là 6 số**, tách khỏi PIN app. PIN app vẫn là 4 số và vẫn không rời khỏi thiết bị.
- **Két sắt không còn chỉ là lớp che giao diện.** File trong két không đọc được bằng API token nữa.
- **Ứng dụng cũ** (không gửi header `X-FatUp-Vault: 2`): khi két đã được thiết lập, các thao tác với két trả lỗi "Cần cập nhật app" (HTTP 426). Cập nhật app để dùng két.
- **Chuyển vào Két sắt khi két chưa thiết lập** (máy tính và bản web): app mở trình thiết lập trước, rồi mới cất file. File được mã hóa ngay khi két được thiết lập.
- **Hai máy cùng cất một file** không còn chặn nhau hay báo lỗi "đang được chuyển ở máy khác". Mỗi lần cất được làm riêng; cất dở thì lần mở két sau làm lại.
- **Giao diện điện thoại:** thanh trên gồm hai hàng (logo và các nút; ô tìm kiếm và dung lượng). Biểu tượng trạng thái két nằm ở góc ảnh thu nhỏ để tên không bị chật. Cổng PIN két có tấm gỗ rộng hơn cho đủ 6 ô.
- **Android chưa thấy và chưa mở được két.** File trong két không hiện trên Android. Đây là nợ kỹ thuật, xem [roadmap](docs/spec/roadmap.md).
- **Lấy ra khỏi Két sắt đổi giao diện ngay.** File rời danh sách két và hiện ở danh sách chính ngay khi bấm, không chờ server. Nếu lấy ra thất bại, file quay về két kèm thông báo lỗi.
- **Sáu ô PIN** ở màn thiết lập và khôi phục két nằm giữa thẻ.

### Nâng cấp
Thứ tự: **migrate trước, deploy sau**. Có một migration mới, `0009_vault_e2ee.sql`: thêm cột vào `files` và tạo bảng `vault_keys`. Migration không đổi dữ liệu cũ.

1. Sao lưu D1 trước khi làm bước nào khác.
2. Trong `worker/`: `npm run db:migrate:remote` (gõ `y` khi được hỏi).
3. Sau đó mới deploy Worker: `npm run deploy` trong `worker/`.
4. Không bắt buộc: két không còn đọc header `ETag` nên không cần `npm run r2:cors` cho két. Chỉ chạy `npm run r2:cors` (trong `worker/`, áp dụng `worker/r2-cors.json`) nếu bucket R2 chưa có CORS cho bản web tải file lên, như các bản trước.
5. Cập nhật app máy tính lên bản mới trên **mọi** máy (Cài đặt → Kiểm tra cập nhật, hoặc tải bản mới). Mở lại bản web (PWA) hai lần để service worker nhận bản mới.
6. Trên máy cá nhân: mở két → thiết lập → **cất recovery key vào trình quản lý mật khẩu** → chờ tới khi mọi mục trong két đều có dấu tick xanh (không còn đám mây mờ).
7. **Kiểm sau deploy** (thay cho bước chạy thử với Worker và R2 thật, đã bỏ qua theo quyết định của người dùng). Tên object của một mục là `vault/<id>.<enc_object>` (lấy `enc_object` của mục từ D1):
   - Object `vault/<id>.<enc_object>` trên R2 bắt đầu bằng 4 byte `FUV1`.
   - Object `files/<id>` (bản rõ) của mục đó đã bị xóa khi mục có tick xanh.
   - Một mục có ảnh thu nhỏ, sau khi mã hóa, vẫn có ảnh thu nhỏ trong két (object `vault/<id>.<enc_object>.thumb` tồn tại, và ảnh hiện trong danh sách).
   - Gọi `GET /vault` và `GET /files?vault=1` bằng token: không có giá trị nào đủ để thử PIN. `GET /vault` chỉ trả muối, số vòng, số lần sai và trạng thái.
8. **Không mở két trên máy công ty hoặc qua mạng bị soi HTTPS (ví dụ Zscaler).** Mở két ở đó sẽ lộ khóa và cho phép thử PIN offline.
9. App bản cũ, sau khi két đã được thiết lập, báo "Cần cập nhật app" khi dùng két. Đó là đúng; cập nhật app là xong.
10. Dev: D1 local đã chạy `npm run dev:worker` trên nhánh này trước đó phải reset (xóa `worker/.wrangler/state`), vì `0009` đã được sửa tại chỗ trước khi merge.

**Lưu ý:** file đưa vào két trước bản này vẫn ở dạng chưa mã hóa cho tới khi được mã hóa ở bước 6. Nếu những file đó từng đi qua máy công ty có Zscaler thì admin mạng có thể đã thấy nội dung. Mã hóa không lấy lại được điều đó.

## [0.4.2] — 2026-11-16

### Thêm
- **Chia sẻ file bằng link công khai.** Menu `⋮` → **Chia sẻ…** (hoặc chọn nhiều file → **Chia sẻ**) tạo một link `/s/<mã>` cho ảnh hoặc file; người nhận mở bằng bất kỳ trình duyệt nào, không cần token, chỉ **xem và tải về**. Hạn: không hết hạn (mặc định), 1, 7 hoặc 30 ngày; đổi hạn hoặc **Dừng chia sẻ** bất cứ lúc nào; xem số lượt tải và lần mở gần nhất.
  - **Hết hiệu lực ngay** khi file vào Két sắt hoặc thùng rác (và khi hết hạn, dừng chia sẻ, xóa vĩnh viễn), và **không sống lại** khi khôi phục hay lấy ra khỏi két: chia sẻ lại là một link mới. Worker kiểm tra database ở mỗi lượt truy cập và truyền file từ R2 (không dùng presigned URL vì không thu hồi được); một trigger SQL xóa link khi file bị ẩn, bất kể đường nào.
  - Giao diện: nút lọc **Đã chia sẻ** (xanh lá) sau nhóm Liên kết / File / Ảnh; file đang chia sẻ có biểu tượng nhiều người cạnh bút chì (tooltip bên trái, bấm để mở cài đặt nhanh).
  - An toàn: chỉ ảnh raster được xem trực tiếp; SVG, HTML và mọi loại khác luôn là tải về (không chạy trên origin của app); trang người nhận không có JS, không bị công cụ tìm kiếm đánh chỉ mục; mọi lý do link chết cho cùng một trang 404.
  - Service worker của PWA bỏ qua `/s/` để không lưu trang chia sẻ hay file vào bộ nhớ thiết bị và không ghi đè bản app đã lưu.

### Sửa
- **File ngoài thùng rác không còn bị tự xóa sau 30 ngày.** Cron dọn dẹp (03:00 UTC mỗi ngày) trước đây xóa cả file đã tải xong khi file đó quá 30 ngày kể từ lúc tải lên (link thì không), trái với quy tắc dự định: chỉ file **trong thùng rác** mới bị xóa vĩnh viễn sau 30 ngày. Giờ cron chỉ còn xóa (1) file đã nằm trong thùng rác quá 30 ngày và (2) lượt tải lên dở dang quá 24 giờ. File ngoài thùng rác, kể cả trong Két sắt hoặc có nhãn quan trọng, được giữ mãi.

### Đổi
- **Nút Tất cả** (tím, có icon) ở đầu island, cạnh nút quan trọng. **Tất cả giờ gồm cả liên kết** (ảnh, file, liên kết xếp phẳng theo ngày, không nhóm theo tên miền); Ảnh / File / Liên kết vẫn chỉ hiện loại của mình.
- **Tiêu đề phía trên bảng** cho biết đang ở đâu (Tất cả, Ảnh, File, Liên kết, Két sắt, Thùng rác, kèm icon); bộ lọc Quan trọng thêm ngôi sao, bộ lọc Đã chia sẻ thêm nhãn xanh. Ở tab Liên kết, tiêu đề nằm cùng hàng với các nút lọc nền tảng. Vào Két sắt hoặc Thùng rác thì mở ở Tất cả, và island không còn lặp tên hai nơi này.
- Khôi phục file khỏi thùng rác không còn "tính lại 30 ngày" (không còn hạn nào để tính lại). Cột `retain_from` không còn được ghi; cột vẫn nằm trong bảng nên không cần migration. Hằng `RETENTION_DAYS` bị bỏ khỏi `@fatup/shared`.
- Thêm hook của Claude Code (`.claude/hooks/block-test-edits.sh`) chặn sửa file test khi tồn tại `.claude/tests-frozen`, dùng khi sửa lỗi theo kiểu viết test thất bại trước.

### Nâng cấp
Có **1 migration** (`0008_shares.sql`: bảng `shares` và trigger `shares_revoke_on_hide`, không dựng lại bảng `files`). Thứ tự: `npm run db:migrate` rồi `npm run deploy:worker` (hoặc `npm run release:worker`). Sau khi migrate, kiểm tra trigger đã có trên D1 thật: `wrangler d1 execute fatup --remote --command "SELECT name FROM sqlite_master WHERE type='trigger'"` phải ra `shares_revoke_on_hide`. Giao diện chia sẻ cần phát hành app máy tính mới và deploy lại PWA (mở lại PWA hai lần để service worker nhận bản mới); app cũ vẫn chạy, chỉ không thấy nút Chia sẻ. Cron cũng xóa dòng `shares` đã hết hạn. Phần sửa lỗi hạn 30 ngày: chỉ cần `npm run deploy:worker` (trong thư mục gốc) hoặc `npm run deploy` trong `worker/`. **File đã bị cron xóa trước khi deploy bản này thì không lấy lại được**; nên deploy sớm. Vì file không còn tự hết hạn, dung lượng R2 (gói miễn phí 10 GB) sẽ đầy dần; thanh dung lượng cảnh báo cam từ 70% và đỏ từ 90%.

## [0.4.1] — 2026-11-15

### Đổi
- **Thứ tự tab:** Liên kết → File → Ảnh.
- **Nút sửa (bút chì) và sao chép ở danh sách:** file và ảnh giờ nằm ở cột bên phải, thẳng hàng với link, thay vì nằm ngay sau tên.

### Nâng cấp
Không có migration và API không đổi. Chỉ thay đổi giao diện app desktop, cập nhật qua bản release.

## [0.4.0] — 2026-11-14

### Thêm
- **Xem ngay trong app, không mở tab mới:** bấm một link là mở khung xem trước (nền tối như khi xem ảnh, `←`/`→` chuyển link, `Esc` đóng, bảng **Chi tiết** bật/tắt bằng `i`):
  - **YouTube** (cả Shorts, giữ mốc `?t=`), **TikTok**, **Instagram**, **Threads**, **X**: trình phát / bài đăng nhúng chính thức.
  - **Facebook**: thẻ tiêu đề + ảnh `og:image` (Facebook chặn nhúng), nút **Mở trong trình duyệt**.
  - **Trang web khác:** app desktop mở **nguyên trang** ngay trong khung (thanh lùi / tiến / tải lại / địa chỉ; phiên riêng không lưu cookie hay đăng nhập; chặn camera, vị trí, thông báo, tải file). PWA hỏi Worker xem trang có cho nhúng không: cho thì hiện trang, không thì hiện thẻ xem trước với ô "Lần sau mở thẳng link …".
  - `Ctrl/⌘` + bấm vẫn mở link ra trình duyệt như trước.
- **Xem PDF ngay trong app** bằng trình xem PDF của trình duyệt (trang, zoom, tìm, in). File > 100 MB hoặc trình duyệt không có trình xem PDF (Chrome Android) thì hiện thẻ **Tải về**. `Ctrl/⌘` + bấm tải về ngay như cũ.
- **Đánh dấu quan trọng** (nhãn vàng kiểu Gmail) ngay sau checkbox của mọi file, ảnh, link; nút lọc nhanh có nhãn vàng ở đầu thanh công cụ chỉ hiện mục quan trọng.
- **Nhóm link theo nền tảng / tên miền** khi xem Tất cả trong tab Liên kết: mỗi nền tảng một nhóm (`youtu.be` và `youtube.com` chung nhóm YouTube), trang web khác nhóm theo tên miền; tiêu đề nhóm có icon và số lượng, gập/mở từng nhóm hoặc tất cả bằng công tắc trên thanh công cụ. Mục quan trọng lên đầu nhóm (tính lúc tải danh sách, nên đánh dấu xong item không nhảy chỗ).
- **Favicon cho link Internet:** Worker đọc `apple-touch-icon` / `rel="icon"` của trang; không có thì thử `/favicon.ico`, cuối cùng mới là quả địa cầu.
- **Lưới:** rê chuột hoặc `Tab` tới thẻ của một file hiện nút **Tải về** ở giữa.
- **Lệnh dev ở thư mục gốc:** `dev:web` (Vite chuyển API sang Worker thật nếu có `FATUP_SERVER` trong `web/.env.local`), `dev:desktop`, `dev:desktop:fresh`, `db:migrate`, `deploy:worker`, `release:worker`.

### Đổi
- Thanh công cụ thành một "đảo" bo tròn tách khỏi bảng; thanh "đã chọn" dùng đúng khung đó nên chọn file không làm trang nhảy. Bỏ tab **Tất cả**: **Ảnh / File / Liên kết** là nút bật/tắt có số lượng. Lưới / danh sách là công tắc như công tắc giao diện sáng/tối.
- Danh sách: bỏ cột **Từ** ở mọi bảng; danh sách link bỏ cột Dung lượng, các nút sửa / sao chép thẳng hàng bên phải, rê chuột hiện thêm nút **mở trong trình duyệt**.
- Bộ lọc nền tảng: nút tròn; **X** và **Threads** vào hộp **Mạng xã hội** cùng Facebook, Instagram, TikTok (icon hộp nằm ngang, mở sang phải).
- **Shopee** tạm bỏ khỏi danh sách nền tảng: link Shopee thuộc nhóm Internet (hiện favicon Shopee).
- Nút **Thêm liên kết** có nền riêng và dấu "+". Icon PDF có chữ "PDF". Không có kết quả tìm kiếm thì con bò cowsay báo "Không có gì khớp".
- Worker đọc trang Facebook bằng User-Agent của trình xem trước link của Facebook để lấy được `og:` (trang Facebook đã lưu trước đây: bấm **Tải lại xem trước**).

### Nâng cấp
Có **2 migration** (`0006_link_icon.sql`: cột `icon_url`; `0007_important.sql`: cột `important`), chỉ thêm cột, không dựng lại bảng. Thứ tự: `npm run db:migrate` rồi `npm run deploy:worker` (hoặc gộp: `npm run release:worker`). Worker có thêm `GET /links/:id/frame` và `PATCH /files/:id` nhận `important`. App desktop cập nhật qua bản release; PWA cập nhật sau khi deploy (mở lại PWA hai lần để service worker nhận bản mới). Android không đổi.

## [0.3.3] — 2026-11-14

### Đổi
- **Màn hình khóa trên điện thoại nhẹ hơn:** ở màn hình hẹp (≤ 720px, hoặc điện thoại xoay ngang) chỉ vẽ **đúng cánh cửa hầm Moria** (vòm khắc chữ rune, hai cây, vương miện, ngôi sao tám cánh), vẽ **dài hơn** một chút, với **ô PIN nằm trên thân cửa, dưới ngôi sao**, **chân cửa có phiến đá ngưỡng và những viên đá thô, với ánh sáng hắt từ cửa ra nền đá** (nháy cùng đèn của cửa). Không còn cây hai bên, bạch tuộc, đoàn người, hồ nước; các rune đứng yên và ánh sáng nhấp nháy bằng cách đổi độ trong suốt của các lớp đã vẽ sẵn (rất nhẹ, nên PWA không còn giật lag). **Sai PIN:** ô PIN lắc và đèn của cửa nháy giật. **Đúng PIN:** cửa mở như ở bản đầy đủ rồi mới vào app. Màn hình rộng (desktop, máy tính bảng) vẫn giữ cảnh Moria đầy đủ. Cổng két sắt (ông phù thủy) chưa đổi.
- Dòng báo "Sai PIN" của lần nhập trước không còn lơ lửng khi cửa đang mở (cả bản đầy đủ lẫn bản điện thoại).

### Nâng cấp
Không có migration và API không đổi. Thay đổi nằm ở giao diện: **PWA** chỉ cập nhật khi chạy `npm run deploy` trong `worker/` (lệnh này build lại PWA); mở lại PWA hai lần để service worker nhận bản mới. App desktop cập nhật qua bản release. Android không đổi. Muốn thử màn hình khóa điện thoại ở local: `npm run build -w @fatup/web`, `npm run -w @fatup/worker dev`, mở `http://localhost:8787` ở khung rộng dưới 720px (kiểm tra tự động: `npm run -w @fatup/desktop e2e:lock`).

## [0.3.2] — 2026-11-14

### Sửa
- **Ảnh xem trước của Instagram (và mọi trang có địa chỉ ảnh chứa `&`):** Worker lấy `og:image` thô từ HTML mà không giải mã `&amp;`, nên địa chỉ ảnh sai chữ ký và Instagram trả 403 "Bad URL hash". Đã giải mã thực thể HTML ở địa chỉ ảnh. Cần deploy Worker; link đã thử trước đó bị nhớ là thất bại 24 giờ, bấm **Tải lại xem trước** (menu `⋮`) để thử lại ngay.
- **Icon PWA trên Android:** trước đây icon là hình vuông bo góc nằm trên nền tròn trắng (Android tự thêm vì icon chưa khai báo `maskable`). Giờ có thêm icon maskable phủ kín gradient, nên trên màn hình chính icon là hình tròn gradient với mũi tên ở giữa. `apple-touch-icon` cũng được vẽ phủ kín (iOS tự bo góc và tô đen phần trong suốt). Android cập nhật icon của PWA đã cài trong vòng vài ngày; muốn thấy ngay thì gỡ rồi cài lại.

### Nâng cấp
Không có migration. Chỉ Worker (`npm run deploy` trong `worker/`) mới có tác dụng với cả hai bản sửa: ảnh Instagram cần Worker mới, icon cần PWA mới (lệnh deploy build lại PWA). App desktop và Android không đổi so với 0.3.1, bản này chỉ ghi nhận lại cho khớp phiên bản. Ảnh xem trước của các link Instagram đã thất bại được nhớ 24 giờ trên mỗi thiết bị; bấm **Tải lại xem trước** (menu `⋮`) để thử lại ngay.

## [0.3.1] — 2026-11-13

### Thêm
- **Nút copy trên từng link** (biểu tượng sao chép cạnh bút chì): bấm là chép URL, báo "Đã sao chép link". Ở dạng danh sách luôn hiện; ở dạng lưới hiện khi rê chuột, nổi đè lên đuôi tên nên tên không bị cắt ngắn đi.

### Đổi

**Ảnh xem trước của link giờ do từng thiết bị giữ, server không lưu nữa**
- Worker chỉ đọc trang để lấy tiêu đề và **địa chỉ ảnh** (`previewImage`), không tải ảnh, không ghi R2. Nhờ vậy hết lỗi timeout khi trang nặng, và không còn ảnh nằm trên R2 cho link mới.
- App tải ảnh **một lần** rồi giữ bản sao trên máy: file trong thư mục dữ liệu của app (desktop), hoặc Cache Storage của trình duyệt (PWA). Địa chỉ ảnh của Instagram/Facebook hết hạn sau vài ngày nhưng bản đã lưu thì không.
- Chỉ nhận ảnh JPEG/PNG/WebP/GIF/AVIF ≤ 2 MB từ địa chỉ công khai. Giữ tối đa 300 ảnh / 50 MB. Trang chặn hoặc không có ảnh thì được nhớ 24 giờ, không bị hỏi lại mỗi lần mở app.
- **Link trong Két sắt không được lưu ảnh** trên máy. Ảnh cũng bị xóa khi xóa vĩnh viễn link, đổi URL, chuyển vào Két sắt hoặc ngắt kết nối.
- PWA: nếu trang khác không cho đọc ảnh (thiếu CORS) thì trong phiên đó hiện thẳng từ địa chỉ gốc, không lưu.
- Link cũ vẫn dùng ảnh đã có trên R2. `POST /links/:id/preview` giờ đọc lại trang mỗi lần được gọi (`?force=1` không còn tác dụng).

### Nâng cấp
Không có migration. Deploy Worker (`npm run deploy` trong `worker/`) **cùng lúc** với cập nhật app: app cũ vẫn chạy với Worker mới nhưng sẽ không thấy ảnh của link mới, vì nó chờ `thumbUrl` còn Worker giờ chỉ trả `previewImage`. Link đã có ảnh trên R2 vẫn dùng ảnh đó; link chưa có ảnh được thử lại khi mở app.

## [0.3.0] — 2026-11-13

### Đổi

**Tab Liên kết gọn hơn, dễ nhận ra hơn**
- **Logo thật** của Facebook, YouTube, Instagram, Threads, X, Shopee, TikTok thay cho huy hiệu chữ cái (Internet vẫn là quả địa cầu). Logo lấy từ [Simple Icons](https://simpleicons.org) (CC0), chép thành đường vẽ SVG trong app nên không thêm thư viện.
- **Hàng lọc chỉ còn icon:** nút **Tất cả**, icon **Internet**, **YouTube**, **X**, **Threads** (luôn hiện), một đường kẻ, rồi nút **chia sẻ** bấm vào để Facebook, Instagram, Shopee, TikTok nhảy ra (cùng kiểu nhảy với hộp thẻ màu, nút to hơn). Tên và số lượng hiện khi rê chuột. Đóng nút không bỏ lọc; nút hiện logo nền tảng đang chọn.
- **Danh sách link:** có cột **Nguồn** ngay sau checkbox, bấm tiêu đề cột để sắp xếp theo nền tảng (A→Z). Bỏ con bò và bỏ tên miền sau tiêu đề; con bò chỉ còn ở dạng lưới.

### Nâng cấp
Không có migration và API không đổi. Bản **PWA** được Worker phục vụ nên chỉ cập nhật khi chạy `npm run deploy` trong `worker/` (lệnh này tự build lại PWA); mở lại PWA hai lần để service worker nhận bản mới. App desktop cập nhật qua bản release. Android không đổi.

## [0.2.1] — 2026-11-13

### Thêm

- **Liên kết X:** link từ `x.com`, `twitter.com` và link rút gọn `t.co` được nhận là loại **X** (chip lọc và huy hiệu riêng). Link X đã lưu trước đây (đang ở Internet) tự chuyển sang loại mới, không cần migrate vì loại được tính khi đọc. Xem trước của X thường trống (trang đòi đăng nhập hoặc render bằng JavaScript) nên sẽ hiện con bò.

### Nâng cấp
Không có migration. Trong `worker/` chỉ cần `npm run deploy` (cần vì code dùng chung `shared` đổi). Cập nhật app desktop (hoặc tải lại bản web) để thấy chip và huy hiệu X; Android không phân loại link nên không đổi; link X đã lưu tự chuyển loại.

## [0.2.0] — 2026-11-13

**Phase 2: lưu liên kết (bookmark).** Chia sẻ một link từ Android hoặc từ PWA lên FatUp (hoặc bấm "Thêm liên kết") để lưu lâu dài và đọc lại ở máy khác.

### Thêm

**Liên kết (loại file mới `link`)**
- Ba đường đưa link vào:
  - **Android:** **Chia sẻ → FatUp** từ trình duyệt hoặc app bất kỳ. App tách link đầu tiên khỏi đoạn text được chia sẻ (ví dụ "Xem cái này https://… nhé"), lấy tiêu đề từ nơi chia sẻ nếu có, gửi qua WorkManager (cần mạng, tự thử lại tối đa 8 lần). Chia sẻ text không có link thì báo "Không tìm thấy liên kết".
  - **PWA:** FatUp xuất hiện trong menu Chia sẻ của Android (Web Share Target). Link được giữ qua màn hình khóa PIN và được lưu ngay khi bạn mở khóa, sau đó app chuyển sang tab Liên kết.
  - **Nút Thêm liên kết** (biểu tượng sợi xích cạnh Tải lên) trên desktop và web: dán URL, tiêu đề tùy chọn; tự điền sẵn nếu clipboard đang có link; dán cả đoạn text cũng được. Đang mở Két sắt thì link vào thẳng két.
- **Tab Liên kết** cạnh Tất cả / Ảnh / File. Các tab cũ chỉ gồm file.
- **Phân loại theo tên miền:** Facebook, YouTube, Instagram, Threads, Shopee, TikTok và **Internet** (mọi tên miền còn lại). Hàng chip lọc loại kèm số lượng, kết hợp được với lọc theo màu và tìm kiếm (theo tiêu đề và URL). Link rút gọn (`fb.me`, `youtu.be`, `shp.ee`…) được nhận đúng; tên miền giả dạng như `notfacebook.com` thì không.
- **Sửa liên kết:** bút chì mở popover có ô Tiêu đề, ô URL và chấm màu. URL sai thì báo lỗi, URL đã lưu rồi thì báo "Liên kết này đã có". Đổi URL thì xem trước được tải lại. Đổi tên link không khóa phần mở rộng như với file.
- **Xem trước tải khi mở app:** link được lưu ngay lập tức; tiêu đề và ảnh xem trước được Worker tải khi bạn mở app (mới nhất trước, 2 link cùng lúc, tối đa 20 link mỗi lần mở; link vừa thêm được tải ngay). YouTube và TikTok dùng oEmbed chính thức. Tiêu đề bạn hoặc nơi chia sẻ đã đặt không bao giờ bị ghi đè. Menu `⋮` có **Tải lại xem trước**.
- **Con bò cowsay SVG nhỏ** thay ảnh khi link không có ảnh xem trước. Facebook, Instagram, Threads, Shopee thường đòi đăng nhập nên hay rơi vào trường hợp này; đó là hành vi chấp nhận được.
- **Huy hiệu loại** vẽ bằng SVG, màu gợi nhớ thương hiệu (không dùng logo thật).
- Bấm vào link mở URL ở tab mới (desktop: trình duyệt mặc định, chỉ `http`/`https`). Menu `⋮`/chuột phải: Mở liên kết, Sao chép link, Sửa liên kết, Tải lại xem trước, Chuyển vào Két sắt, Chuyển vào thùng rác. **Tải tất cả** bỏ qua link.
- Link **không bao giờ tự hết hạn** (file vẫn hết hạn sau 30 ngày). Link vào được thùng rác và két sắt như file; ở thùng rác quá 30 ngày thì bị xóa vĩnh viễn. Link không tính vào thanh dung lượng.
- Màn hình trống của tab Liên kết có con bò riêng ("Chưa có link").

**Server (Worker)**
- `POST /links` — lưu link. Chỉ nhận `http`/`https` (tối đa 2048 ký tự), chuẩn hóa URL (bỏ fragment, hạ chữ thường tên miền). Lưu lại một URL đã có (không ở thùng rác) thì trả bản cũ thay vì tạo bản sao.
- `POST /links/:id/preview` — Worker tải trang đích để lấy tiêu đề và ảnh. Timeout 4 giây, tối đa 3 lần redirect, đọc ≤ 512 KB HTML, ảnh ≤ 1,5 MB và phải là `image/*`; từ chối localhost và dải IP nội bộ (kiểm tra lại ở từng lần redirect). Không bao giờ báo lỗi chỉ vì trang đích chậm hoặc chặn truy cập. Chỉ tải một lần; `?force=1` để tải lại.
- `PATCH /files/:id` nhận thêm `url` cho link (xóa xem trước cũ, `409 duplicate_url` nếu trùng, `400` nếu gửi cho file thường).
- `GET /files?kind=link`; `kind=all` **không trả link** nên bản app cũ ở các máy khác không hiển thị link như một file tải được. `GET /files/:id/download` với link trả `400 not_a_file`.
- Cron bỏ qua link ở nhóm hết hạn 30 ngày.
- Migration **`0005_links.sql`**: dựng lại bảng `files` (SQLite không sửa được ràng buộc `CHECK`) để `kind` nhận `'link'`, thêm cột `url`, `previewed_at`, `title_set`. Dữ liệu cũ giữ nguyên.

**Android**
- `ShareActivity` nhận link; `LinkWorker` (mới) gửi `POST /links`; `Links.extractUrl` tách link khỏi text. Thông báo lỗi khi gửi thất bại, chuỗi mới có đủ En/Vi. Màn hình hướng dẫn nhắc cách lưu link.

**Mã nguồn dùng chung**
- `shared/`: `siteOf`, `normalizeUrl`, `extractUrl`, kiểu `SiteCategory`, `CreateLinkRequest`; `FileItem` có thêm `url`, `site`, `previewed`.
- Bridge `window.fatup` có thêm `addLink`, `previewLink`, `openExternal` (và `takePendingLink` cho bản web).

**Tài liệu**
- [SPEC.md](SPEC.md) lên **v4** (mục 4.1 API link, 9.2c giao diện, 10 share target). README có mục Liên kết. Thiết kế và kế hoạch ở `docs/superpowers/`.

### Thay đổi
- `Tab` thêm `link`; mặc định tab Liên kết xem dạng danh sách. Cài đặt đã lưu từ bản cũ vẫn dùng được (thiếu khóa thì lấy mặc định).
- Popover đổi tên và popover sửa link dùng chung phần định vị và bộ chọn màu.
- Thêm 62 test mới: Worker 33 → 60, desktop 43 → 71, web 10 → 17; test Android (`LinksTest`) chạy trên CI.

### Nâng cấp
1. **Sao lưu D1** (migration `0005` dựng lại bảng `files`).
2. Trong `worker/`: `npm run db:migrate:remote`, rồi `npm run deploy`.
3. Cài app Android mới (APK trong release) nếu muốn chia sẻ link từ app Android. **App Android bản cũ không hiểu link**: nó chỉ đọc file đính kèm nên bỏ qua việc chia sẻ link mà không báo gì.
4. PWA đã cài từ trước: Android cập nhật mục Chia sẻ chậm (tới khoảng một ngày), có thể phải gỡ rồi cài lại PWA.

### Giới hạn đã biết
- Xem trước của Facebook, Instagram, Threads, Shopee có thể trống hoặc chỉ có tiêu đề chung chung (trang đòi đăng nhập hoặc chỉ render bằng JavaScript).
- Ảnh `og:image` dạng đường dẫn tương đối sau một lần redirect được ghép với địa chỉ ban đầu.
- Chưa có bản build Android được chạy thử trên thiết bị thật tại thời điểm phát hành; phần Android được kiểm bằng unit test và CI.

## [0.1.9] — 2026-11-13

### Thay đổi
- Bỏ bản **macOS Intel** và gói **`.deb`** khỏi release để giảm kích thước và thời gian build. Release còn: macOS (arm64 `.dmg`), Windows (`.exe`), Ubuntu (`AppImage`) và APK Android.

## [0.1.8] — 2026-11-13

### Thay đổi
- Vẽ lại ông phù thủy ở cổng Két sắt: tỉ lệ đẹp hơn, tóc và râu dài, mũ sờn, áo choàng có đổ bóng và thắt dây, gậy xù xì có vầng sáng.
- Lửa sống động hơn: tường nền tối, lưỡi lửa bập bùng với lõi nóng, tia lửa bay lên, ánh lửa chập chờn trên bầu trời, cây cầu và ông phù thủy.

### Thêm
- Danh sách, Két sắt và Thùng rác khi trống hiện con bò `cowsay` kiểu Linux ("Empty" / "Empty vault" / "Clean"; tiếng Việt: "Rỗng túi" / "Không có gì là bí mật!" / "Sạch sẽ rồi").

## [0.1.7] — 2026-11-13

### Thêm
- **Upload từ bản web:** chọn file (trên Android có cả chụp ảnh) hoặc kéo-thả; hàng đợi 2 file cùng lúc, tiến độ, hủy từng file, thumbnail 400px vẽ bằng canvas.
- **Giao diện điện thoại:** bố cục thanh trên hai hàng, lưới 2 cột, nút bấm đủ lớn, tôn trọng tai thỏ; **giữ lâu** để chọn file; trình xem ảnh **chụm hai ngón** để zoom, **vuốt ngang** chuyển ảnh, **vuốt xuống** để đóng; màn hình khóa dọc.
- Cấu hình CORS cho R2 (`npm run r2:cors`), cần thiết để web upload và "Copy ảnh".

### Sửa
- Lỗi "Illegal invocation" trên trình duyệt: `ApiClient` gọi `fetch` như một method của chính nó.
- Token dán từ điện thoại hay bị lẫn ký tự vô hình (khoảng trắng độ rộng 0, xuống dòng, dấu câu "thông minh"); nay được làm sạch trước khi dùng.
- Thông báo lỗi upload rõ hơn khi thiếu CORS của R2.

### Tài liệu
- SPEC lên **v3**, README cập nhật cho Phase 1 và upload từ web.

## [0.1.6] — 2026-11-13

### Thay đổi
- **Màn hình khóa mới: cổng Moria (Doors of Durin).** Ánh sáng quét qua vòm cổng, rune nhấp nháy, cây phát sáng, đoàn người đi bộ, Gollum ẩn giữa đá rêu và vòi bạch tuộc khổng lồ. PIN đúng thì cổng mở; sai thì Gollum rụt xuống và ô PIN rung. Bấm vào Gollum hoặc vòi bạch tuộc để xem phản ứng.
- **Cổng Két sắt:** ông phù thủy trên cây cầu đá, có nút **← Quay lại** ("GO BACK TO THE SHADOW!").
- Bỏ cảnh tên trộm/thuốc nổ cũ của Két sắt.

## [0.1.5] — 2026-11-13

### Thay đổi
- Vẽ lại cây cầu ở màn hình khóa nhìn từ phía dưới, với ông phù thủy nhún nhảy và giơ gậy.

## [0.1.4] — 2026-11-13

### Thêm
- **Thẻ màu (tag):** 7 màu, tối đa 3 màu mỗi file; chấm màu cạnh tên ở lưới và danh sách; nút hình chiếc hộp để **lọc theo màu** (chọn nhiều màu = file có bất kỳ màu nào). Migration `0004`.
- **Đổi tên file** bằng bút chì trong cả hai chế độ xem, giữ nguyên phần mở rộng. Popover kiểu Finder, `Enter` hoặc bấm ra ngoài để lưu, `Esc` để bỏ. `PATCH /files/:id` nhận `name` và/hoặc `tags`.
- Nút **Tải tất cả** khi chọn nhiều file.
- Màn hình khóa và cổng Két sắt có hoạt họa (ông phù thủy trên cây cầu nứt giữa lửa, tro, tia lửa và sao băng; cảnh tên trộm và thuốc nổ cho Két sắt, về sau được thay thế).
- Biểu tượng thùng rác có nắp mở được; thành phần popover thông tin.
- Biến môi trường `FATUP_DEVICE_NAME` đổi tên thiết bị hiển thị ở cột "Từ" (tiện khi demo).

### Sửa
- Ubuntu không hiện icon app: gói `.deb` chỉ cài icon 1024×1024 mà theme không tra cứu. Nay có bộ icon 16–512px và đặt icon cửa sổ Linux một cách tường minh.
- Màu nền khi rê chuột vào dòng đang được chọn.

### Tài liệu
- SPEC lên **v2**, viết lại README.

## [0.1.3] — 2026-11-12

### Thêm
- **Upload từ máy tính** (desktop và web): nút Tải lên, `Ctrl/⌘+U` hoặc kéo-thả; bảng tiến trình kiểu Google Drive.
- **Chọn nhiều file:** checkbox, `Shift`+bấm chọn dãy, `Ctrl/⌘+A`, xóa hàng loạt; **sắp xếp** theo Tên / Tải lên / Dung lượng.
- **Thùng rác:** xóa là chuyển vào thùng rác, có Hoàn tác 8 giây, khôi phục, xóa vĩnh viễn, dọn sạch; tự dọn sau 30 ngày. Migration `0002` (`deleted_at`, `retain_from`).
- **Két sắt (Secret Vault):** cất file ra khỏi danh sách chính, mỗi lần mở phải nhập lại PIN (dùng chung giới hạn 5 lần sai / khóa 30 giây). Migration `0003` (`in_vault`).
- **Thanh dung lượng (Store)** (`GET /usage`) đổi màu xanh/cam/đỏ theo mức dùng.
- **Chế độ tối** có công tắc trong Cài đặt; bấm logo FatUp để về trang chủ.

### Sửa
- Các lỗi bố cục và trình xem ảnh đi kèm.

## [0.1.2] — 2026-11-12

### Sửa
- Trình xem ảnh: kích thước vừa khung và hiện tượng nháy khi chuyển ảnh.

### Thêm
- Zoom xuống tới 10%; phím ↓ phóng to, ↑ thu nhỏ.

## [0.1.1] — 2026-11-12

### Thêm
- **Trình xem ảnh (Lightbox):** zoom, kéo, vừa khung, bảng Chi tiết (tên, loại, dung lượng, kích thước, thời gian, thiết bị).
- **Kiểm tra cập nhật** trong Cài đặt: Windows và Linux AppImage tự tải và cài; macOS mở trang release.
- **Bản web (PWA)** dùng chung giao diện với desktop, được Worker phục vụ cùng origin.

## [0.1.0] — 2026-11-12

Bản đầu tiên.

### Thêm
- **Worker** (Hono) với **D1** (metadata) và **R2**: cấp presigned URL (SigV4) để file đi thẳng giữa thiết bị và R2, không qua Worker; xác thực bằng bearer token so sánh constant-time; cron mỗi ngày (03:00 UTC) xóa file hết hạn sau 30 ngày và upload dở dang. File ≤ 100 MB.
- **App desktop** (Electron + React): khóa PIN 4 số (`scrypt`, sai 5 lần thì khóa 30 giây), token mã hóa bằng `safeStorage`, giao diện kiểu Drive, tab Tất cả/Ảnh/File, tìm kiếm không phân biệt dấu, tải về `~/Downloads`, En/Vi.
- **App Android** (Kotlin): Chia sẻ → FatUp, WorkManager tự thử lại khi mất mạng, thông báo tiến độ, ghép nối bằng quét QR hoặc nhập tay.
- **CI** (typecheck, test, smoke test desktop, build Android) và **workflow release** (build không ký cho macOS, Windows, Ubuntu và APK Android, tạo draft release khi push tag `v*`).
- README có hướng dẫn triển khai trên Cloudflare; SPEC v1.

[0.2.0]: https://github.com/ThanhPhat1080/fatup/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/ThanhPhat1080/fatup/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/ThanhPhat1080/fatup/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/ThanhPhat1080/fatup/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/ThanhPhat1080/fatup/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/ThanhPhat1080/fatup/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/ThanhPhat1080/fatup/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ThanhPhat1080/fatup/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ThanhPhat1080/fatup/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ThanhPhat1080/fatup/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ThanhPhat1080/fatup/releases/tag/v0.1.0
