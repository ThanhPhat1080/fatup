# Desktop và giao diện

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 9. Desktop (Electron)

**Stack:** electron-vite + React + TS, icon `lucide-react` (riêng icon két sắt tự vẽ SVG), CSS thuần với design token.

### 9.1 Màn hình

1. **Setup** (lần đầu): URL Worker + token → "Kiểm tra kết nối" → đặt PIN (nhập 2 lần).
2. **Khóa**: 4 ô PIN, tự submit khi đủ 4 số; "Quên PIN? Đặt lại". Mặc định là khóa đơn giản, nhẹ; khi bật **Dùng khóa LOTR** trong Cài đặt thì có cảnh hoạt họa. Xem [9.10](#910-màn-hình-khóa-có-hoạt-họa).
3. **Chính**: danh sách file (xem dưới).
4. **Thùng rác** và **Két sắt**: thùng rác thường; két sắt có thiết lập lần đầu (hai bước, kèm recovery key), cổng PIN 6 số, rồi danh sách và thùng rác của két. Xem [mục 5](lifecycle.md#5-hai-tính-năng-riêng-tư-thùng-rác-và-két-sắt) và [9.11](#911-két-sắt-mã-hóa).
5. **Cài đặt**: ngôn ngữ, **giao diện sáng/tối** (công tắc mặt trời/mặt trăng), **Dùng khóa LOTR** (checkbox, mặc định tắt; [9.10](#910-màn-hình-khóa-có-hoạt-họa)), server, QR kết nối Android (nhập lại PIN), đổi PIN app, **Đổi PIN két** (khi két đã được thiết lập), khóa ngay, đăng xuất, **phiên bản + kiểm tra cập nhật**.

### 9.2 Màn hình chính

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ ⬆ FatUp  [ 🔍 Tìm theo tên…     ]  Store ▓▓░░ 0.01 / 10.00 GB  [Tải lên] 🗄 🗑 ⚙ │
│ ( Tất cả )( Ảnh )( File )                                          ↻  ▦/☰ │
├───────────────────────────────────────────────────────────────────────────┤
│ Hôm nay                                                                   │
│ ☐ ┌─────┐ ☐ ┌─────┐ ☐ ┌─────┐   …  (lưới)                                  │
│ Hôm qua                                                                   │
│ ☐ 📄 report.pdf       Pixel 8     14:02     2.1 MB      ⋮   (danh sách)    │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Logo FatUp**: bấm để về trang chủ (thoát két/thùng rác, về tab Tất cả, xóa tìm kiếm và lựa chọn, đóng viewer/menu/cài đặt).
- **Tab Tất cả / Ảnh / File**; ảnh mặc định lưới, hai tab kia list; nút ▦/☰ đổi chế độ cho tab hiện tại và được nhớ. Hai nút ↻ và ▦/☰ nằm bên phải hàng tab.
- Tải toàn bộ danh sách (tối đa 20 trang × 200), tab/tìm kiếm lọc ở phía client. Tìm kiếm không phân biệt hoa thường và dấu tiếng Việt.
- **Sắp xếp** (chế độ danh sách): bấm tiêu đề cột Tên / Tải lên / Dung lượng, bấm lần nữa để đảo chiều. Tên sắp theo thứ tự tự nhiên và bỏ qua dấu ("img2" trước "img10"). Mặc định: mới tải lên trước. Nhóm theo ngày ("Hôm nay", "Hôm qua", `dd/MM/yyyy`) chỉ áp dụng khi sắp theo thời gian tải lên.
- **Chọn nhiều file:** mỗi file có checkbox (lưới: hiện khi rê chuột hoặc khi đã chọn; danh sách: cột đầu, kèm checkbox chọn tất cả ở tiêu đề). `Shift`+bấm chọn một dãy, `Ctrl/⌘+A` chọn tất cả, `Esc` bỏ chọn. Khi có file được chọn, thanh tab đổi thành thanh chọn: "Đã chọn N", Chọn tất cả, **Chuyển vào Két sắt**, **Chuyển vào thùng rác**. Thao tác chỉ áp dụng cho file **đang hiển thị**, nên bộ lọc không thể che file khỏi thao tác hàng loạt.
- **Click ảnh** mở viewer; **click file khác** thì tải về. Menu `⋮`/chuột phải: Tải về, Copy ảnh (HEIC copy thumbnail JPEG), Chuyển vào Két sắt, Chuyển vào thùng rác.
- **Biểu tượng theo loại file** (`FileIcon`, chọn bằng `fileVisual` trong `lib/format.ts`, theo `mime` rồi theo đuôi tên): ảnh **xanh ngọc**, PDF **đỏ** (dải chữ PDF), Word xanh dương, bảng tính xanh lá, slide cam, nén xám, **video hồng** (nhận cả khi `mime` chỉ là `application/octet-stream`: `mp4 mov m4v mkv avi webm 3gp wmv mpg mpeg`), âm thanh tím, và ba loại có dải chữ như PDF: **MD** (xanh dương; `md`, `markdown`, `text/markdown`), **HTML** (cam; `html`, `htm`, `text/html`), **TXT** (xám; `txt`, `text/plain`). Văn bản khác (`json`, `log`, `text/*`) giữ biểu tượng văn bản xám; còn lại là biểu tượng file trống. Màu có bản sáng và tối (`--tone-teal`, `--tone-pink` thêm vào `--tone-*`).
- **Phím tắt:** `Ctrl/⌘+R` làm mới, `Ctrl/⌘+F` tìm, `Ctrl/⌘+U` tải lên, `Delete` chuyển file đang chọn vào thùng rác (trong thùng rác: xóa vĩnh viễn, có xác nhận).
- **Tải về**: main process tải vào `~/Downloads`, trùng tên thì thêm hậu tố (1), (2)…, xong `shell.showItemInFolder`.
- **Làm mới:** polling 60s, tự làm mới khi cửa sổ focus (cách nhau ≥ 5s) và sau mỗi thao tác.

### 9.2b Đổi tên, thẻ màu và Tải tất cả

- **Đổi tên:** biểu tượng bút chì ở cả chế độ lưới và danh sách mở một popover kiểu Finder: ô tên ở trên (**phần mở rộng cố định**, chỉ sửa phần tên), hàng chấm màu ở dưới. `Enter` hoặc bấm ra ngoài thì lưu tên đã đổi; `Esc` bỏ thay đổi. Gọi `PATCH /files/:id`.
- **Thẻ màu:** 7 màu (đỏ, cam, vàng, xanh lá, xanh dương, tím, xám), **tối đa 3 màu mỗi file**. Bấm chấm màu để gắn/bỏ ngay (không cần lưu); đủ 3 màu thì các chấm còn lại mờ đi và dòng chú thích báo đã đủ. Chấm màu hiện cạnh tên file ở lưới và danh sách.
- **Lọc theo màu:** nút hình **chiếc hộp** cạnh nút làm mới. Mở hộp thì các chấm màu nhảy ra bên trái từng chấm một; chấm đang chọn **phình to và nhích cao hơn**. Chọn nhiều màu = file có **bất kỳ** màu nào trong số đó. Đóng hộp thì bộ lọc được xóa.
- **Tải tất cả:** khi chọn nhiều file, thanh chọn có thêm nút **Tải tất cả** (viền outline, không có trong thùng rác), tải lần lượt mọi file đang chọn. Từ 2 file trở lên, mọi file được gói vào **một file `fatup.zip`** (`downloadZip`, `src/zip.ts`; không nén, dựng trong bộ nhớ nên **tổng tối đa 1 GB**: vượt thì báo lỗi, không tải gì; tên trùng thành `tên (1).ext`), ở **cả desktop lẫn web** cho đồng nhất (trình duyệt còn chặn nhiều lần tải liên tiếp). Desktop ghi `fatup.zip` vào thư mục Tải về (trùng tên thì thêm hậu tố) rồi mở thư mục. Chọn đúng một file thì tải file đó như thường. Dạng danh sách: nút **Tải về** nhỏ trong cột hành động, hiện khi rê chuột vào hàng cùng bút chì và nút copy (chiếm chỗ sẵn nên cột không xê dịch; màn cảm ứng: luôn hiện). Dạng lưới: nút **Tải về** tròn đè lên thumbnail hiện khi rê chuột/focus, có ở **ảnh và file** (không có ở link).

### 9.2c Liên kết

*Tiêu đề trên bảng:* phía trên bảng luôn có một tiêu đề cho biết đang ở đâu: **Tất cả** khi không bật loại nào, hoặc **Ảnh / File / Liên kết**, hoặc **Két sắt**, **Thùng rác** (kèm icon). Khi bộ lọc **Quan trọng** bật thì có thêm ngôi sao vàng cạnh tiêu đề, khi bộ lọc **Đã chia sẻ** bật thì có thêm nhãn xanh. Ở tab Liên kết, tiêu đề nằm cùng hàng với các nút lọc nền tảng, ngăn bằng đường kẻ dọc nhẹ. Vào Két sắt hoặc Thùng rác thì loại đang bật bị bỏ (mở ở Tất cả); island của hai nơi này không lặp lại tên.

- **Tab Liên kết** cạnh Ảnh/File. **Tất cả** (nút tím đầu island, biểu tượng các lớp xếp chồng, có số lượng) hiện **cả ảnh, file và liên kết**, phẳng theo ngày (không nhóm theo tên miền; dòng link có thêm nút sao chép, các nút bút chì vẫn thẳng hàng nhờ một ô trống ở dòng không phải link); Ảnh, File, Liên kết chỉ hiện loại của mình. Tab Liên kết có chế độ xem riêng (mặc định danh sách) và hàng lọc nền tảng: nút **Tất cả**, icon **Internet**, **YouTube**, **X**, **Threads** (luôn hiện), một đường kẻ dọc, rồi nút **chia sẻ** (icon Share2, to hơn hộp thẻ màu); bấm nút thì các nền tảng còn lại (Facebook, Instagram, Shopee, TikTok) nhảy ra bên phải, bấm lần nữa thì nhảy vào. Chỉ có icon, không chữ; tên và số lượng hiện khi rê chuột. Bấm lại nền tảng đang chọn thì bỏ lọc; đóng hộp không bỏ lọc (nút hiện logo nền tảng đang chọn). Kết hợp được với lọc màu và ô tìm kiếm (theo tiêu đề và URL). Icon là logo thật (Simple Icons, CC0; logo là nhãn hiệu của chủ sở hữu), chép thành đường vẽ SVG trong `siteLogos.ts`; Internet là quả địa cầu. Logo màu đen dùng màu chữ để vẫn thấy ở chế độ tối.
- Mỗi link ở **dạng lưới**: logo nền tảng trước tiêu đề, ảnh xem trước, chấm màu; **không có ảnh thì hiện con bò cowsay SVG nhỏ** (`CowThumb`), con bò chỉ có ở dạng lưới. Ở **dạng danh sách**: cột **Nguồn** (logo, ngay sau checkbox, bấm tiêu đề cột để sắp xếp theo tên nền tảng A→Z, cùng nền tảng thì theo tên), tiêu đề, thời gian, chấm màu; không có con bò và không in tên miền sau tiêu đề (rê chuột vào tiêu đề để xem URL).
- **Nút copy trên từng link:** biểu tượng sao chép cạnh bút chì, bấm một cái là chép URL và báo "Đã sao chép link". Cả hai dạng: hiện khi rê chuột hoặc focus, nổi đè lên đuôi tên (không chiếm chỗ của tên); màn hình cảm ứng thì luôn hiện. Không có trong thùng rác.
- **Bấm vào link** mở URL ở tab mới (desktop: trình duyệt mặc định, chỉ `http`/`https`). Menu `⋮`/chuột phải: Mở liên kết, Sao chép link, **Sửa liên kết**, Tải lại xem trước, Chuyển vào Két sắt, Chuyển vào thùng rác. "Tải tất cả" bỏ qua link.
- **Sửa liên kết:** bút chì mở popover có ô **Tiêu đề**, ô **Liên kết (URL)** và chấm màu. `Enter` lưu (URL sai hoặc trùng thì ô đỏ và hiện lý do, popover vẫn mở); bấm ra ngoài lưu phần hợp lệ; `Esc` bỏ.
- **Nút Thêm liên kết** (sợi xích, cạnh Tải lên): hộp thoại URL + tiêu đề tùy chọn; tự điền link nếu clipboard có link; dán cả đoạn text cũng được (tách link đầu tiên). Đang mở Két sắt thì link vào thẳng két.
- **Xem trước tải khi mở app:** sau khi danh sách tải xong, các link **chưa có ảnh trên thiết bị này** (và không thất bại trong 24 giờ qua) được gọi `POST /links/:id/preview` mới nhất trước, **2 link cùng lúc, tối đa 20 link mỗi lần mở app**; link vừa thêm được tải ngay. Cờ `previewed` mà app thấy do client tính (có ảnh hoặc vừa thất bại), không phải giá trị của server.
- **Ảnh xem trước giữ trên thiết bị (`desktop/src/preview-cache.ts`):** server chỉ trả địa chỉ ảnh (thường hết hạn sau vài ngày), nên app tải ảnh một lần rồi giữ bản sao theo id link. Chỉ nhận ảnh JPEG/PNG/WebP/GIF/AVIF ≤ 2 MB từ địa chỉ công khai (kiểm tra cả sau redirect; không nhận SVG). **Desktop:** file trong `userData/previews/`, hiện qua giao thức `fatup-preview://p/<id>` (main process tải, không bị CORS). **PWA:** Cache Storage `fatup-previews-v1`, hiện qua object URL; nếu trang khác không cho đọc ảnh (thiếu CORS) thì trong phiên đó hiện thẳng địa chỉ gốc và không lưu. Tối đa 300 ảnh / 50 MB, xóa cái cũ nhất. Thất bại (chặn, không có ảnh) được nhớ 24 giờ. Ảnh bị xóa khi link bị xóa vĩnh viễn, đổi URL, chuyển vào Két sắt, hoặc ngắt kết nối. **Link trong Két sắt không bao giờ được lưu ảnh** (chỉ hiện từ địa chỉ gốc trong phiên). Máy khác hoặc máy xóa dữ liệu sẽ tự tải lại. Facebook, Instagram, Threads, X, Shopee thường không cho đọc nên có thể không có ảnh (hiện con bò).

### 9.2d Chia sẻ link

*(Form cấu hình: popover neo vào icon khi bấm icon nhiều người, hộp thoại khi chọn Chia sẻ… từ menu. Prototype: `docs/superpowers/prototypes/share-links/index.html`.)* Có ở desktop và PWA, không có ở Android.

- Menu `⋮`/chuột phải: **Chia sẻ…** (thành **Quản lý chia sẻ…** khi đang chia sẻ); ẩn với link/text và trong Két sắt, thùng rác.
- Hộp thoại: chọn hạn (không hết hạn mặc định, 1/7/30 ngày) → **Tạo link và sao chép**. Khi đang chia sẻ: ô link + Sao chép, đổi hạn, số lượt tải, lần mở gần nhất, ghi chú về Két sắt/thùng rác, **Dừng chia sẻ**.
- Nút lọc **Đã chia sẻ** trên island (sau nhóm Liên kết/File/Ảnh, tách bằng đường kẻ, màu xanh lá, có số lượng), lọc kiểu VÀ với tab loại; không hiện trong Két sắt/thùng rác.
- File đang chia sẻ có **icon nhiều người** (không chữ) bên trái bút chì: ở danh sách nằm trong cột hành động sẵn có, ở lưới nổi đè đuôi tên và luôn hiện. Rê chuột thấy tooltip **bên trái** ("Đang chia sẻ · bấm để quản lý link"); bấm thì mở form cấu hình chia sẻ (hạn và số lượt tải xem trong form).
- Thanh chọn nhiều file có nút **Chia sẻ**: tạo mỗi file một link (không hết hạn) và liệt kê *tên + link* để sao chép từng dòng hoặc **Sao chép tất cả**.

### 9.2e Ảnh nhập từ bucket và thumbnail bù

- Mỗi lần **làm mới** danh sách (mở app, nút làm mới, `Ctrl+R`, theo chu kỳ, khi cửa sổ lấy lại focus), app còn hỏi server nhập ảnh từ thư mục của bucket (`importSync`, [api.md 4.4](api.md#44-nhập-ảnh-từ-thư-mục-của-bucket)), **không quá một lần mỗi 30 giây** (`IMPORT_SYNC_MIN_GAP_MS`) cho làm mới tự động (theo chu kỳ, lấy lại focus); nút làm mới và `Ctrl+R`/`Cmd+R` là làm mới theo yêu cầu nên **bỏ qua khoảng cách này** và nhập ngay ( hàm thuần `shouldSyncImport` trong `lib/import-sync.ts`). Nếu có ảnh mới (`imported > 0`) thì danh sách được tải lại. Lỗi thì bỏ qua, không báo gì, và thử lại ở lần làm mới sau. Không có tab hay nhãn riêng: ảnh nhập vào lẫn trong danh sách theo thời gian upload của nó, thiết bị là tên thư mục (ví dụ `d30`).
- **Thumbnail bù (chỉ desktop):** với ảnh `hasThumb === false` (ngoài thùng rác và két), main process tải ảnh gốc, tạo JPEG 400 px q80 bằng `nativeImage`, PUT lên URL từ `POST /files/:id/thumb` rồi gọi `thumb/complete`. Làm nền, **từng ảnh một**, mỗi ảnh tối đa một lần mỗi phiên (thành công hay không); ảnh không giải mã được (ví dụ HEIC) thì bỏ qua. Danh sách thấy thumbnail mới ở lần làm mới sau. Bản web/PWA và client khác không tạo thumbnail, hiện ảnh gốc qua `thumbUrl`.

### 9.3 Trình xem ảnh (Lightbox)

- Ảnh mở ra **vừa khung** (contain theo chiều cao/rộng của vùng xem). Zoom **10% – 800%**: nút zoom, lăn chuột, `+`/`-`, **phím ↓ phóng to, ↑ thu nhỏ**, nhấp đúp (2,5×); `0` về vừa khung. Kéo chuột để di chuyển khi đã phóng to.
- `←`/`→` chuyển ảnh, `Esc` đóng; ảnh kề được tải trước và ảnh gốc hiện đè lên thumbnail khi giải mã xong, nên không bị nháy.
- Nút ⓘ (hoặc `I`) mở bảng **Chi tiết**: tên, loại, dung lượng, kích thước ảnh, thời gian tải lên, thiết bị gửi.

### 9.4 Upload từ máy tính

- Nút **Tải lên** (hoặc `Ctrl/⌘+U`) mở hộp chọn nhiều file; hoặc **kéo-thả** vào cửa sổ. Thả thư mục thì báo "không tải thư mục lên được".
- Hàng đợi chạy ở main process, **2 file cùng lúc**, stream từ đĩa lên presigned URL (đếm byte để báo tiến độ), có hủy từng file. Thumbnail 400px JPEG q80 tạo bằng `nativeImage` (định dạng không giải mã được vẫn upload, chỉ thiếu thumbnail). Trường `device` là hostname máy.
- **Bảng tiến trình** góc dưới phải kiểu Google Drive: tên, % và dung lượng, thanh tiến độ, hủy, tick khi xong, lỗi; thu gọn/đóng được. Danh sách tự làm mới khi có file xong.
- Khóa app hoặc đăng xuất sẽ hủy các upload đang chạy. Đang giữ khóa két sắt thì file được mã hóa trên máy và vào thẳng két ([9.11](#911-két-sắt-mã-hóa)).

### 9.5 Thanh dung lượng (Store)

- Cạnh ô tìm kiếm: chữ **Store**, thanh tiến độ và `đã dùng / tổng GB` (2 chữ số thập phân, GB thập phân 10⁹ byte). **Xanh** dưới 70%, **cam** từ 70%, **đỏ** từ 90%. Tooltip: "Đã dùng X% · còn trống Y GB".
- Nguồn số liệu là `GET /usage`. Nếu server chưa có endpoint này (server cũ), app tự cộng `size` các file đã tải về danh sách rồi so với 10 GB.
- Ô tìm kiếm co ngắn trước tiên khi cửa sổ hẹp; icon FatUp và dòng số GB không bao giờ bị ẩn.
- Số liệu lấy từ database nên **không gồm thumbnail** và có thể lệch nhẹ so với dashboard Cloudflare.

### 9.6 Theme

- Token màu là CSS custom properties trên `:root`. Bộ tối áp dụng khi OS ưa tối (trừ khi người dùng chọn sáng), hoặc khi người dùng chọn tối.
- Preference `theme: 'system' | 'light' | 'dark'`: lần đầu là `system`; gạt công tắc ở Cài đặt thì lưu lựa chọn rõ ràng. Trên Electron, main process cũng đặt `nativeTheme.themeSource` để thanh cuộn, hộp thoại và `prefers-color-scheme` khớp với lựa chọn.
- Màu cảnh báo (cam/đỏ), nút hành động trong toast, v.v. đều là token, có bản riêng cho tối. Viewer ảnh luôn nền đen; mã QR luôn nền trắng.

### 9.7 Kiểm tra cập nhật

- Cài đặt → **Kiểm tra cập nhật** hỏi GitHub Releases (`/releases/latest`, bỏ qua bản draft) và so `x.y.z` với phiên bản hiện tại.
- Có bản mới → nút **Cập nhật**. **Windows (NSIS) và Linux AppImage** tự tải và cài bằng `electron-updater` (cần `latest*.yml` và `.blockmap` đính kèm trong release), hiện % tiến độ rồi tự khởi động lại. **macOS** chỉ mở trang release để tải tay: app chưa ký số nên macOS không cho thay app tại chỗ.
- Chỉ bản **publish** (không phải draft) mới được app nhìn thấy.

### 9.8 i18n

Dictionary `en` / `vi` tự viết (không thư viện), mặc định theo `app.getLocale()`.

### 9.9 Kiến trúc Electron

- `main/`: config store (JSON trong `userData`, ghi nguyên tử), `safeStorage`, `ApiClient` (fetch), download manager, `UploadManager`, kiểm tra cập nhật, IPC handlers.
- `preload/`: `contextBridge` expose `window.fatup.*` (một interface `FatupApi` trong `shared-ipc.ts`).
- `renderer/`: React, không có quyền Node (`contextIsolation`, `sandbox`). Thumbnail và ảnh viewer tải thẳng từ presigned URL bằng `<img>`, trừ mục két sắt (không có thumbnail; ảnh mở ra đi qua `fatup-vault://file/<id>`, xem [9.11](#911-két-sắt-mã-hóa)).
- Két sắt mã hóa: `vault-session.ts` (khóa trong bộ nhớ, 6 giờ cố định kể từ PIN đúng, dùng chung với PWA), `vault-handlers.ts` (logic gọi két, quyền xem `viewOpen` tách khỏi khóa, không import Electron), `main/vault-mover.ts` (cất vào, lấy ra, chuyển đổi file cũ) và `main/vault-ipc.ts` (lớp mỏng của IPC và scheme `fatup-vault://`). Renderer không bao giờ nhận khóa.

### 9.10 Màn hình khóa có hoạt họa

Các màn nhập PIN vẽ hoàn toàn bằng **SVG + CSS** (không có file ảnh), nằm ở `desktop/src/renderer/src/components/`. Có hai bộ cảnh, chọn theo tùy chọn **Dùng khóa LOTR** (`Prefs.lotrLock`, mặc định tắt) qua `lockScene(lotr, phone)` và `vaultGateStill(lotr, still)` trong `lib/lock-scene.ts`:

- **Khóa đơn giản** (tắt LOTR, mặc định; `SimpleDoor.tsx`): dùng cho màn khóa app trên **mọi kích thước màn hình** và cho cổng két sắt. Cánh cửa Moria là **hai ảnh WebP vẽ sẵn** (`src/assets/door-base.webp`: tường, thân cửa, hình khắc mờ, rìa mờ dần nằm trong alpha; `door-lit.webp`: trong suốt, chỉ hình khắc sáng có vầng sáng nướng sẵn), tạo bởi `desktop/scripts/render-door.mjs` từ `DoorBody`/`DoorDefs` của `MoriaDoor.tsx`. Ảnh nền đứng yên; chỉ **một** hoạt họa: `opacity` của ảnh sáng, 3 giây mỗi nhịp, giữa 0,5 và 1 (`prefers-reduced-motion`: đứng yên). Chữ VAULT (cổng két) là một SVG `<text>` nhỏ trên vòm cửa, đứng yên. Không có `<use>`, `filter`, `mask`, gradient, `halo`, đá, vệt sáng hắt, lá cửa, lóe sáng, đoàn người, bạch tuộc, ông phù thủy hay quả bom; không lớp nào khác chạy hoạt họa ([ADR 0020](../decisions/0020-khoa-don-gian-mac-dinh.md), phương án C). Ô PIN nằm trên thân cửa; dòng báo lỗi và nút ("Quên PIN? Đặt lại" ở màn khóa, "← Quay lại" ở cổng két) nằm dưới cửa.
  - **Sai PIN:** chỉ ô PIN lắc (`.pin--shake`); đèn không giật.
  - **Đúng PIN (màn khóa app):** cửa mờ dần khoảng 0,3 giây rồi vào app; không có cánh cửa xoay hay lóe sáng. **Đúng PIN (cổng két):** két mở ngay, không có nổ.
  - **Cổng két sắt** thêm chữ **VAULT** cố định, không dịch, ở trên đỉnh cửa. Chỉ có ô PIN 6 số và nút ← Quay lại (thoát ngay, không chờ 3,4 giây).
  - `prefers-reduced-motion`: lớp sáng đứng yên, PIN đúng vào ngay.
- **Khi bật Dùng khóa LOTR**, các cảnh đầy đủ dưới đây được dùng như trước.
- **Màn hình khóa app** (`Lock.tsx` + `LockMoria.tsx`, khi bật LOTR, trên máy tính): cảnh **cổng Moria (Doors of Durin)**. Cổng ở giữa, hai cây phát sáng hai bên, tường núi, bậc thềm và hồ nước. Đoàn người (`Fellowship.tsx`, 9 nhân vật tự vẽ) đi bên trái, Gollum ẩn giữa đá rêu bên phải, vòi bạch tuộc khổng lồ ở đáy màn hình. Ánh sáng quét từ chân trái qua vòm cổng sang chân phải, rồi hoa văn trên cánh cổng sáng dần từ ngưỡng cửa lên; các ký tự rune nhấp nháy theo sóng như đèn sân khấu. 4 ô PIN nằm trên cánh cổng, nút "Quên PIN? Đặt lại" ở dưới.
  - **PIN đúng:** cổng mở ra kèm chớp sáng, khoảng 1,7 giây sau vào app.
  - **PIN sai:** ánh sáng chập chờn, Gollum rụt xuống, các ô PIN rung.
  - **Bấm vào Gollum:** nó nhảy lên. **Bấm vào vòi bạch tuộc:** vòi duỗi thẳng và cả đoàn nhảy lên.
- **Cổng két sắt khi bật LOTR** (`VaultGate.tsx` + `LockWizard.tsx`, toàn màn hình): ông phù thủy đứng trên cây cầu đá, gậy giơ lên nhún nhảy, râu bay, tro, tia lửa và sao băng rơi, lửa bập bùng từ đáy màn hình. Có nút **← Quay lại**: ông hạ gậy và nói "GO BACK TO THE SHADOW!" nhẹ nhàng, giữ màn hình đủ lâu để đọc rồi mới thoát. **PIN đúng:** "Fire in the hole!", quả bom, vụ nổ, ông bay đi (`Boom.tsx` dùng chung).
- `prefers-reduced-motion`: tắt hoạt họa, mở khóa ngay, vòi bạch tuộc chỉ vẽ một lần.
- **Trên điện thoại, khi bật LOTR** (cùng định nghĩa với màn hình khóa: cửa sổ hẹp ≤ 720 px, hoặc màn cảm ứng nằm ngang cao ≤ 520 px; `PHONE_QUERY` trong `lib/media.ts`), **cổng két sắt là một bức tranh tĩnh**: không lửa, tro, tia lửa hay sao băng (các phần tử bị ẩn hẳn, nên không vẽ và không chạy hoạt họa; trước đây chúng làm cổng giật trên điện thoại), không ánh lửa trên cầu và người, bầu trời chỉ là nền tối trơn; ông phù thủy đứng yên. Nhập PIN như thường; **PIN đúng mở két ngay**, không bom và không chờ; nút **← Quay lại** thoát ngay, không chờ ông nói xong. `stillGate()` (`lib/motion.ts`) gom hai trường hợp: màn điện thoại và `prefers-reduced-motion`. Chỉ áp dụng cho cổng két, không phải màn hình khóa app.
- **Màn hình điện thoại khi bật LOTR** (`max-width: 720px`, hoặc màn cảm ứng nằm ngang cao ≤ 520px; `lib/media.ts`): cảnh Moria quá nặng cho trình duyệt điện thoại (giật, lag) nên chỉ vẽ **đúng cánh cửa hầm Moria** (`LockGate.tsx`, dùng chung hình vẽ với cảnh đầy đủ qua `MoriaDoor.tsx`): vòm đá khắc chữ rune, hai cột, hai cánh cửa có hai cây, vương miện, đe và ngôi sao tám cánh, trên nền tường núi mờ dần vào nền tối. Không có cây hai bên, bạch tuộc, đoàn người, hồ. Cửa được vẽ **dài hơn** cảnh gốc một chút (SVG kéo dãn theo chiều dọc) và **ô PIN nằm trên thân cửa, dưới ngôi sao**. **Chân cửa:** phiến đá ngưỡng mòn và những viên đá thô góc cạnh rải hai bên và trước cửa (vẽ tĩnh, đa giác bất quy tắc sinh từ `noise`), cùng **ánh sáng hắt từ cửa ra nền đá** (hình nón mở rộng và một vệt sáng sát ngưỡng, nằm trong lớp sáng nên nháy và giật cùng đèn của cửa, không thêm hoạt họa nào). Các rune đứng yên; ánh sáng nhấp nháy bằng hai lớp chỉ đổi độ trong suốt (`opacity`): lớp nét khắc sáng (vẽ một lần, kèm bộ lọc phát sáng, nằm trong một SVG riêng, hoạt họa `moria-stage` của cảnh gốc) và vầng sáng quanh cửa, nên không phải vẽ lại. **Sai PIN:** ô PIN lắc (`.pin--shake`), đèn của cửa nháy giật (`gate-stutter`, 0,9 giây) rồi trở lại nhịp thở. **Đúng PIN:** hiệu ứng mở cửa như cảnh đầy đủ (hai cánh khép lại `moria-leaf`, nét khắc tắt dần, ánh sáng tràn ra rồi lóe trắng, 1,7 giây) trước khi vào app; dòng báo lỗi cũ được xóa. `prefers-reduced-motion`: tắt hoạt họa và vào app ngay. Đổi kích thước/xoay màn hình thì đổi cảnh tương ứng. Cổng két sắt (ông phù thủy) chưa đổi.
- Các cảnh là tác phẩm tự vẽ theo phong cách riêng, không sao chép hình ảnh nào; chữ rune chỉ là nét trang trí.

### 9.11 Két sắt mã hóa

Giao diện của két là một bộ React dùng chung cho desktop và PWA ([mục 10](web.md#10-bản-web-pwa)). Logic nằm ở `lib/vault.ts` (hàm thuần, có test) và ở `VaultSession`. Mô hình mã hóa: [mục 7.1](security.md#71-két-sắt-mã-hóa-phía-client-e2ee).

- **Thiết lập (lần đầu)**, `VaultSetup.tsx`, toàn màn hình, ba bước:
  1. Nhập PIN két 6 số hai lần. PIN sai định dạng, quá dễ, hoặc trùng 4 số đầu/cuối của PIN app thì báo ngay. Sáu ô PIN nằm giữa thẻ tối của màn hình (căn giữa trong `.vault-card`).
  2. Hiện **recovery key** một lần, nhóm theo nhóm 4 ký tự, có nút **Sao chép** (chữ đọc được trên thẻ tối), kèm cảnh báo "Hãy cất key này ở nơi an toàn".
  3. Gõ lại **2 nhóm ngẫu nhiên** để xác nhận. Sai thì báo và giữ nguyên màn hình.

  Xác nhận xong thì két được tạo ("Đang tạo két sắt…") và mở để xem. Việc mã hóa các file cũ chạy nền, có dòng "Đang mã hóa các file cũ trong két…". Đóng trước bước 3 thì không có gì được gửi lên server. Nếu người dùng thoát trong lúc đang gửi lên server thì két vẫn được tạo và giữ khóa 6 giờ, nhưng không mở để xem ([7.7](security.md#77-giới-hạn-bảo-mật-còn-lại)).
- **Cổng 6 số**, `VaultGate.tsx`, hiện **mỗi lần vào màn Két sắt**, kể cả khi đang giữ khóa và app đang mở khóa. Khi bật LOTR, sáu ô nhập nằm trên một tấm gỗ đủ rộng, căn giữa; khi tắt LOTR (mặc định) là cửa đơn giản có chữ VAULT ([9.10](#910-màn-hình-khóa-có-hoạt-họa)). Dòng báo lỗi nằm dưới tấm gỗ (hoặc dưới cửa), không đè lên. Các quy tắc PIN dưới đây giữ nguyên ở cả hai cách.
  - Sai: "Sai PIN. Còn N lần thử." (N là số lần còn lại từ server).
  - Đang khóa: "Sai quá nhiều lần. Thử lại sau N giây.", đếm ngược mỗi 0,5 giây; trong lúc khóa không nhận PIN.
  - Két đã bị xóa bí mật: báo "Nhập sai quá nhiều lần nên két đã bị đặt lại…" và chuyển sang màn khôi phục.
  - Đúng: hiệu ứng nổ ("Fire in the hole", [9.10](#910-màn-hình-khóa-có-hoạt-họa)) rồi két mở; khi tắt LOTR thì két mở ngay.
  - "← Quay lại" thoát màn Két sắt: bỏ quyền xem nhưng giữ khóa 6 giờ ([9.11](#911-két-sắt-mã-hóa), mục 5.2 của [lifecycle](lifecycle.md#52-két-sắt-secret-vault)). Không có chuyển hướng sang màn khác khi cất file. Khi tắt LOTR thì thoát ngay, không chờ.
- **Khôi phục**, `VaultRecover.tsx`: nhập recovery key, rồi PIN mới hai lần (kiểm tra như thiết lập; sáu ô PIN căn giữa thẻ như ở thiết lập). Recovery key sai: "Recovery key không đúng…". Thành công thì két mở để xem. Không file nào được mã hóa lại.
- **Đổi PIN két**, `VaultPinChange.tsx`, trong Cài đặt (khi két đã được thiết lập): nhập PIN hiện tại, hoặc chọn "Dùng recovery key thay thế"; rồi nhập PIN mới hai lần. **Không cần mở két:** làm được khi app đang mở khóa, kể cả khi két đang đóng. Lỗi được báo theo bước (PIN cũ, PIN mới, két đóng). Thành công: "Đã đổi PIN két sắt". Không file nào được mã hóa lại.
- **Chế độ két:** khi đang xem két, khung app có class `vault-mode`: viền trên thanh trên cùng 3 px **vàng đồng**, nền panel ngả vàng rất nhẹ, và nhãn "🔒 Két sắt · đã mã hóa" trên thanh. Có bản tối. Thoát màn Két sắt thì chế độ này tắt (khóa vẫn được giữ).
- **Thùng rác của két**, `VaultTrash.tsx` và `VaultTrashIcon.tsx`: nút icon chỉ hiện khi két đang mở, cạnh nút đóng két. Mở bằng nút này **không đóng két**.
  - Trên màn hình rộng hơn 720 px: **sidebar rộng 70%** bên phải, phía sau là nền phủ tối. Bấm ra ngoài hoặc Esc thì đóng. Sidebar này che phần phải của thanh trên cùng; đây là quyết định đã chốt của người dùng, giữ nguyên.
  - Từ 720 px trở xuống: trang phủ toàn màn hình có nút ←.
  - Header vàng đồng, **vạch đỏ** bên trái (`--danger`), icon két nhỏ đè lên icon thùng rác, tiêu đề "Thùng rác của Két sắt", dòng phụ "File đã xóa trong két · mã hóa · tự xóa sau 30 ngày". Có bản tối.
  - Danh sách sắp theo thời điểm xóa, mới xóa trước. Mỗi mục: **Khôi phục** (về lại két) và **Xóa vĩnh viễn** (có xác nhận). **Dọn sạch** (có xác nhận) chỉ xóa các mục của két.
  - Xóa một file trong két đưa nó vào thùng rác của két. Toast có **Hoàn tác** trong 8 giây; Hoàn tác khôi phục file về két, không đưa file ra khỏi két.
- **Cất vào và lấy ra:**
  - Menu `⋮`, chuột phải, hoặc nút trên thanh chọn nhiều file: "Chuyển vào Két sắt" (từ danh sách chính) và "Đưa ra khỏi Két sắt" (trong két).
  - Từ danh sách chính, không giữ khóa: hiện **popup nhỏ** `VaultPinDialog.tsx` ngay trên danh sách (không chuyển màn hình, không có hoạt họa), với dòng "Nhập PIN két sắt để cất N mục." Đúng PIN thì cất tiếp và két giữ khóa 6 giờ; sai PIN thì báo như cổng (kèm đếm ngược khi bị khóa tạm), có "Quên PIN?" sang màn khôi phục và nút Hủy. Đang giữ khóa thì cất ngay, không có popup. Két chưa thiết lập thì mở trình thiết lập và cất khi thiết lập xong (cả máy tính và bản web); két đã bị xóa bí mật thì mở màn khôi phục. Cất xong **két không đóng**.
  - Mục vừa cất biến mất khỏi danh sách chính ngay khi bắt đầu, và bị ẩn tạm tới khi việc cất kết thúc. Lỗi đã biết: một lần làm mới bắt đầu trước đó có thể làm mục nhấp nháy trên trang chính ([Nợ kỹ thuật](roadmap.md#nợ-kỹ-thuật)).
  - Toast hiện tiến trình "Đang chuyển N / M…". Lỗi một file không dừng các file còn lại. Khi có file không cất được, toast nói rõ: file đã vào két sẽ hiện đám mây mờ và được mã hóa lại tự động; file còn ở danh sách chính thì thử cất lại sau. File lỗi không tự thử lại trong lượt đó. Lần mở két sau thì cất lại với lần thử mới.
  - Lấy ra chỉ làm được khi đang xem két (sau PIN ở màn Két sắt). Mục không đọc được, hoặc đang ở trạng thái đám mây (chưa mã hóa xong), không có "Đưa ra khỏi Két sắt".
  - **Lấy ra đổi giao diện ngay** (plan `2026-11-18-vault-lay-ra-optimistic`, [ADR 0017](../decisions/0017-lay-ra-khoi-ket-doi-giao-dien-ngay.md)): bấm "Đưa ra khỏi Két sắt" thì các mục đã chọn rời danh sách két ngay và hiện ở danh sách chính như **bản giả** (`inVault: false`, tên đã giải mã giữ nguyên, ảnh thu nhỏ bỏ đi nên hiện icon loại file, hoặc logo trang với liên kết). Bản giả nằm đầu danh sách chính và không có trong danh sách két.
    - Khi lượt lấy ra thành công, làm mới thay bản giả bằng mục thật (có ảnh thu nhỏ của chính nó, vì thumbnail đi theo mục khi lấy ra). Toast "Đã đưa N file ra khỏi Két sắt" hiện khi lượt xong.
    - Khi lấy ra thất bại (mục nằm trong `failed`, hoặc cả lượt bị từ chối): bản giả bị bỏ khỏi danh sách chính và mục quay lại danh sách két, kèm toast lỗi. Việc đưa lại bằng tay chỉ làm khi két đang mở và đang xem; nếu không, làm mới kế tiếp nạp lại từ server. Lỗi `locked` và `vault_locked` không đưa lại bằng tay (két đã đóng).
    - Trong lúc lượt đang chạy, một làm mới đến sớm (poll, focus, nút làm mới) không làm mục nhảy ngược: danh sách két không hiện các id đang lấy ra, danh sách chính giữ bản giả. Mỗi lần làm mới có số thế hệ; câu trả lời của một lần làm mới đã bị lần mới hơn thay thế thì bị bỏ, để câu trả lời cũ không ghi đè trạng thái mới.
    - Hàm thuần trong `lib/vault.ts`: `leavingGhost`, `withoutIds`, `mergeGhosts`, `restoreAfterFailedMoveOut` (có unit test).
  - Popup cất vào két (`VaultPinDialog`) **căn giữa hàng sáu ô PIN**, như thẻ thiết lập và khôi phục (trước đây căn trái có chủ ý; đổi ngày 2026-11-18 theo yêu cầu của người dùng vì hàng ô lệch trái trông như lỗi). Chữ hướng dẫn phía trên vẫn căn trái.
- **Mục trong két:** tên, loại, và URL/tiêu đề liên kết được giải mã trên máy; tìm kiếm và sắp xếp theo tên chạy trên máy.
  - Trạng thái mã hóa là một biểu tượng cạnh tên: **đám mây mờ** (tooltip "Chưa mã hóa xong") khi mục đã vào két mà chưa mã hóa xong; **dấu tick xanh** (tooltip "Đã mã hóa") khi đã mã hóa. Mục không đọc được không có biểu tượng này.
  - Trên điện thoại, biểu tượng nằm ở góc ảnh thu nhỏ, để tên có chỗ.
  - Cập nhật: danh sách két làm mới khi mở két, mỗi 60 giây và khi cửa sổ lấy lại focus, nên thiết bị khác thấy đổi trạng thái sau tối đa một phút khi két đang mở. Không có kênh thông báo thời gian thực.
  - Mục không giải mã được (dữ liệu hỏng, hoặc khóa khác) hiện "Không đọc được trên thiết bị này" thay cho tên. Bấm vào thì báo, không xem được và không đưa ra được. Các mục khác trong danh sách không bị ảnh hưởng.
  - **Két không hiện thumbnail của mục nào** ([ADR 0019](../decisions/0019-ket-sat-khong-hien-thumbnail.md)): thẻ lưới và dòng danh sách trong két là biểu tượng file, không tải và không giải mã gì cho tới khi người dùng mở ảnh (trình xem ảnh, Tải về, Sao chép ảnh). Danh sách chính không đổi.
  - Ảnh và file trong két xem qua `fatup-vault://` trên desktop (phục vụ từ bộ nhớ, không ghi đĩa) hoặc qua `blob:` trên web.
  - Liên kết trong két có thể giữ ảnh xem trước đã mã hóa. Ảnh xem trước do app tự tải về không bao giờ được lưu cho link trong két ([9.2c](#92c-liên-kết)).
- **Tải về** mục két: giải mã và ghi vào thư mục tải về như mục thường; tên file lấy từ bản đã giải mã.
