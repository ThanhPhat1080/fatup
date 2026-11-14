# Changelog

Mọi thay đổi đáng chú ý của FatUp. Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), số phiên bản theo `x.y.z` (khớp với tag `v*` trên GitHub; app desktop kiểm tra cập nhật bằng cách so số này).

Mục **Nâng cấp** ở mỗi phiên bản nói rõ phần server cần chạy. Thứ tự luôn là: **migrate trước, deploy sau** (`npm run db:migrate:remote` rồi `npm run deploy` trong `worker/`).

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
