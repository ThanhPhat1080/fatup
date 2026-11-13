# Phase 2: Lưu liên kết (bookmark) — thiết kế

Trạng thái: **đã duyệt, đã triển khai** (2026-11-13). Viết ngày 2026-11-13. Thay đổi quyết định thì sửa file này trước, code sau; khi làm xong phải cập nhật `SPEC.md` (mục 2, 3, 4, 8, 9, 10, 12, 13).

## 1. Mục đích

FatUp hiện chuyển **file** giữa điện thoại và máy tính, và mọi thứ tự xóa sau 30 ngày. Phase 2 cho FatUp lưu **liên kết**: người dùng chia sẻ một URL từ Android hoặc từ PWA (hoặc bấm "Thêm liên kết" và dán URL), FatUp lưu nó thành một bookmark.

**Vì sao:** để lưu lâu dài rồi đọc lại ở máy khác. Vì vậy link **không bao giờ hết hạn** và danh sách phải dễ đọc, không chỉ là một dãy URL.

## 2. Mục tiêu, không phải mục tiêu, điều phải tránh

**Mục tiêu**

- Ba đường đưa link vào: nút "Thêm liên kết" (desktop và web), share target của PWA, `ShareActivity` của app Android.
- Link là một loại file mới tên `link`, nằm cùng danh sách với file, có tab riêng "Liên kết".
- Phân loại tự động theo tên miền: Facebook, YouTube, Instagram, Threads, Shopee, TikTok, và **Internet** cho mọi tên miền còn lại. Lọc được theo loại.
- Gán thẻ màu cho link như file (dùng lại cơ chế hiện có).
- Xem trước (tiêu đề và ảnh) được tải **khi người dùng mở app**, không phải lúc lưu.
- **Sửa được tiêu đề và URL** của link sau khi lưu.
- Link không có ảnh xem trước thì hiện **một con bò cowsay nhỏ vẽ bằng SVG** (cho vui, và nhất quán với các màn hình trống của app).

**Không làm**

- Không lưu bản sao nội dung trang, không chụp màn hình trang.
- Không nhập bookmark từ trình duyệt, không có extension trình duyệt, không có thư mục.
- Không có đăng nhập vào Facebook, Instagram, Shopee... để lấy xem trước.

**Điều phải tránh (thất bại dù code chạy)**

- Link bị cron xóa sau 30 ngày.
- Bản FatUp cũ ở máy khác hiển thị link như một file tải được và bấm vào thì lỗi.
- Lưu link bị chậm hoặc thất bại chỉ vì trang đích chậm hoặc chặn truy cập.

## 3. Các cách làm đã cân nhắc

Quyết định của người dùng: **app chỉ gửi URL (kèm tiêu đề nếu share sheet có)**, Worker không tải trang lúc lưu.

| Cách | Đánh đổi | Kết quả |
|---|---|---|
| 1. Worker tải trang ngay lúc lưu | Tiêu đề luôn có, nhưng lưu chậm tới 4 giây và hỏng khi trang chặn | Không chọn |
| **2. Lưu ngay, xem trước tải lúc mở app** | Lưu tức thì; xem trước tải một lần, sau đó có sẵn | **Chọn** |
| 3. App tự tải trang | Trình duyệt bị CORS chặn nên PWA không làm được | Loại |

Cách 2 vẫn cần Worker tải trang (vì chỉ Worker không bị CORS), nhưng việc này tách khỏi lúc lưu: client gọi `POST /links/:id/preview` cho các link chưa có xem trước khi người dùng mở app.

## 4. Thiết kế

### 4.1 Dữ liệu

Migration `0005_links.sql`. SQLite không sửa được ràng buộc `CHECK (kind IN ...)`, nên **dựng lại bảng `files`**: tạo `files_new` với `kind IN ('image','file','text','link')`, thêm hai cột, chép dữ liệu, xóa bảng cũ, đổi tên, tạo lại `idx_files_ready` và `idx_files_trash`.

- `url TEXT` — URL đã chuẩn hóa, chỉ có giá trị khi `kind = 'link'`.
- `previewed_at INTEGER` — mốc đã thử tải xem trước (kể cả thất bại); NULL nghĩa là chưa thử.
- `title_set INTEGER NOT NULL DEFAULT 0` — 1 khi tiêu đề do người dùng hoặc share sheet đặt (xem tải xem trước không được ghi đè).

Một link là một row `files`: `kind = 'link'`, `mime = 'text/uri-list'`, `size = 0` (không ảnh hưởng thanh dung lượng), `status = 'ready'`, `name` = tiêu đề hiển thị, `has_thumb = 1` khi có ảnh xem trước (lưu ở `thumbs/<id>.jpg` như thumbnail ảnh). Không có object `files/<id>` trong R2.

`FileItem` (ở `shared`) thêm `url: string | null` và `site: SiteCategory`. `FileKind` thêm `'link'`.

### 4.2 Phân loại theo tên miền

Hàm thuần `siteOf(url): SiteCategory` ở `shared/`, dùng chung cho mọi client, **không lưu vào D1** (suy ra từ `url`). So khớp theo tên miền gốc và mọi subdomain của nó:

| Loại | Tên miền |
|---|---|
| `facebook` | facebook.com, fb.com, fb.me, fb.watch |
| `youtube` | youtube.com, youtu.be |
| `instagram` | instagram.com |
| `threads` | threads.net, threads.com |
| `shopee` | shopee.vn, shopee.com, shp.ee |
| `tiktok` | tiktok.com |
| `internet` | tất cả còn lại |

### 4.3 API (Worker)

| Method | Path | Mô tả |
|---|---|---|
| `POST` | `/links` | Body `{ url, title?, device? }`. Chỉ nhận `http`/`https`, tối đa 2048 ký tự. Chuẩn hóa URL (bỏ fragment, hạ chữ thường tên miền). Nếu đã có link cùng URL **không ở thùng rác** thì trả bản cũ, không tạo bản sao. Tên = `title` đã làm sạch (khi có thì `title_set = 1`), thiếu thì dùng tên miền (`title_set = 0`). Trả `FileItem`. |
| `PATCH` | `/files/:id` | Với link, ngoài `name` và `tags` nhận thêm **`url`** (cùng quy tắc kiểm tra và chuẩn hóa như `POST /links`). Đổi `name` đặt `title_set = 1`. Đổi `url` thì `previewed_at = NULL`, `has_thumb = 0`, xóa `thumbs/<id>.jpg` trong R2, và nếu `title_set = 0` thì tên quay về tên miền mới (xem trước sẽ điền lại). URL mới trùng một link khác không ở thùng rác thì `409 duplicate_url`. Gửi `url` cho file thường thì `400`. |
| `POST` | `/links/:id/preview` | Tải trang đích, cập nhật tên và ảnh xem trước, đặt `previewed_at`. Gọi lại với `?force=1` để tải lại. Trả `FileItem`. 404 nếu không phải link. |

Các route hiện có:

- `GET /files`: `kind` nhận thêm `link`. **`kind=all` chỉ trả image và file, không trả link**, để bản app cũ không thấy link. Thùng rác trả mọi loại. Két sắt nhận `kind=link` như thường.
- `GET /files/:id/download`: link trả `400 not_a_file`.
- két sắt, thùng rác, khôi phục, xóa vĩnh viễn: dùng nguyên, áp dụng cho link. `PATCH` xem hàng riêng ở trên.
- `cleanup`: nhóm 1 (hết hạn 30 ngày) thêm `AND kind != 'link'`. Link ở thùng rác quá 30 ngày vẫn bị xóa (nhóm 2), vì đó là chủ ý của người dùng. `purge` bỏ qua việc xóa `files/<id>` không tồn tại (R2 delete không lỗi với key thiếu).

**Tải xem trước (`/links/:id/preview`):**

- Timeout 4 giây, tối đa 3 lần redirect, chỉ đọc 512 KB HTML đầu, chỉ `http`/`https`, từ chối host là IP nội bộ hoặc `localhost`.
- Lấy theo thứ tự: `og:title` → `twitter:title` → `<title>`; ảnh từ `og:image` → `twitter:image`. Ảnh chỉ nhận nếu ≤ 1.5 MB và `content-type` là ảnh; lưu vào `thumbs/<id>.jpg`.
- **YouTube và TikTok** dùng oEmbed chính thức của họ (trả tiêu đề và ảnh ổn định, không cần đăng nhập).
- Facebook, Instagram, Threads, Shopee thường đòi đăng nhập hoặc render bằng JS, nên xem trước có thể trống. Đây là **hành vi chấp nhận được**: link vẫn lưu, UI hiện con bò cowsay thay ảnh, cùng huy hiệu loại và tên miền.
- **Không ghi đè tiêu đề** mà người dùng hoặc share sheet đã đặt (chỉ ghi khi `title_set = 0`). Thất bại không ném lỗi: vẫn đặt `previewed_at`.

### 4.4 Client

**Chung (`shared-ipc.ts`, desktop và web):** thêm `addLink(url, title?)` và `previewLink(id)` vào `FatupApi`; cài ở `desktop/src/main/api.ts` + IPC và `web/src/browser-api.ts`.

**UI (tái dùng trên desktop và web):**

- Tab **Liên kết** cạnh Tất cả/Ảnh/File. "Tất cả" chỉ gồm file. Tab có chế độ xem riêng (thêm khóa `link` cho `viewModes`, mặc định danh sách).
- Trong tab Liên kết có hàng **lọc loại**: Tất cả · Facebook · YouTube · Instagram · Threads · Shopee · TikTok · Internet, kèm số lượng. Kết hợp được với bộ lọc thẻ màu và ô tìm kiếm (tìm theo tiêu đề và URL).
- Mỗi link: ảnh xem trước, tiêu đề, **huy hiệu nhỏ của loại** cạnh tên miền, thời gian lưu, chấm màu. Khi không có ảnh (chưa tải, đang tải, hoặc trang không có) thì thay ảnh bằng **con bò cowsay SVG nhỏ** (component `CowThumb`, vẽ theo con bò ASCII kinh điển, dùng `currentColor` và token màu nên đúng cả sáng/tối, kích thước theo ô thumbnail ở chế độ lưới và danh sách). Huy hiệu loại là SVG tự vẽ, màu gợi nhớ thương hiệu, **không dùng logo thật**; Internet dùng icon quả cầu.
- Bấm vào link mở URL trong tab mới (desktop: trình duyệt mặc định qua `shell.openExternal`, chỉ với `http`/`https`). Menu `⋮`: Mở, Sao chép link, **Sửa liên kết**, Tải lại xem trước, Chuyển vào Két sắt, Chuyển vào thùng rác. Chọn nhiều, xóa hàng loạt dùng nguyên.
- **Sửa liên kết** (bút chì, và mục trong menu) mở popover giống popover đổi tên của file nhưng có hai ô: **Tiêu đề** và **Liên kết (URL)**, cộng hàng chấm màu như cũ. `Enter` hoặc bấm ra ngoài thì lưu, `Esc` bỏ. URL sai định dạng thì ô đỏ và không lưu; URL trùng link khác thì báo "Liên kết này đã có". Đổi URL xong xem trước được tải lại ngay. Đổi tên link **không** khóa phần mở rộng (khác với file).
- Nút **Thêm liên kết** trên thanh trên: hộp thoại có ô URL (tự điền nếu clipboard chứa URL hợp lệ khi người dùng bấm vào ô) và ô tiêu đề tùy chọn. Đang mở Két sắt thì link vào thẳng két (giống upload).
- **Tải xem trước khi mở app:** sau khi danh sách link tải xong, các link có `previewed_at` rỗng được gọi `previewLink` **mới nhất trước, 2 link cùng lúc**, tối đa 20 link mỗi lần mở; xong mỗi link thì cập nhật dòng tại chỗ. Link thêm mới cũng được tải ngay sau khi lưu.

**PWA share target (`web/public/manifest.webmanifest`):**

```json
"share_target": { "action": "/", "method": "GET", "params": { "title": "title", "text": "text", "url": "url" } }
```

- Khi mở với `title`/`text`/`url`, `entry.ts` tách URL đầu tiên (Chrome trên Android thường để URL trong `text`), lưu vào `sessionStorage`, rồi `history.replaceState` xóa tham số khỏi thanh địa chỉ. Link nằm đó **qua màn hình khóa PIN**; khi app mở khóa mới gọi `addLink`, hiện toast "Đã lưu liên kết" và chuyển sang tab Liên kết.
- Chưa cấu hình (màn hình Setup) thì giữ nguyên đến khi mở khóa lần đầu. Không tìm thấy URL thì hiện toast thông báo và bỏ qua.
- Android cập nhật share target của PWA đã cài chậm (tới khoảng một ngày sau khi manifest đổi), và có thể phải cài lại PWA. Ghi chú này vào README.

**Android native (`ShareActivity`):**

- `ACTION_SEND` có `EXTRA_TEXT` (và không có `EXTRA_STREAM`): tách URL đầu tiên, tiêu đề từ `EXTRA_SUBJECT`/`EXTRA_TITLE` nếu có. Gửi qua WorkManager (có retry, giống upload) tới `POST /links`; toast "Đã gửi liên kết".
- Có text nhưng không có URL: toast "Không tìm thấy liên kết" rồi đóng.
- Chuỗi mới thêm vào cả `values/` và `values-vi/`. Không đổi intent filter (`*/*` đã bắt `text/plain`).

### 4.5 Kiểm thử

- **Worker:** `PATCH` link (đổi tên đặt `title_set`, đổi URL xóa xem trước và thumbnail, URL trùng 409, URL xấu 400, gửi `url` cho file thường 400); `POST /links` (hợp lệ, URL xấu, `ftp:`, trùng URL, trùng URL nhưng bản cũ ở thùng rác, tên dự phòng); `/files` (`kind=all` không có link, `kind=link`, két sắt); `/links/:id/preview` với `fetch` giả (og tags, oEmbed, timeout, không phải ảnh, host nội bộ, không ghi đè tên đã đặt hay tên sau khi đổi URL khi `title_set = 1`, ghi đè khi `title_set = 0`, `force`); cron **không xóa link cũ hơn 30 ngày** nhưng xóa link ở thùng rác quá 30 ngày; `download` link trả 400; migration giữ nguyên dữ liệu cũ.
- **Shared/desktop:** `siteOf` (tên miền gốc, subdomain, link rút gọn, tên miền giống nhưng khác như `notfacebook.com`, URL lỗi); tách URL từ đoạn text; bộ lọc loại + thẻ màu.
- **Web:** luồng share target giữ URL qua khóa PIN và lưu đúng một lần.
- **Android:** unit test cho hàm tách URL (logic thuần).
- Sau khi làm: chạy thử UI thật trên desktop/web (thêm link, lọc loại, gán thẻ màu, mở link) vì chưa có test tự động cho UI.

## 5. Rủi ro và ghi chú triển khai

- **Thứ tự nâng cấp:** `npm run db:migrate:remote` (áp dụng `0005`, **dựng lại bảng, nên nên sao lưu D1 trước**) rồi `npm run deploy`, như mọi lần.
- Bản app desktop/Android cũ vẫn chạy vì `kind=all` không trả link; chúng chỉ không thấy tính năng mới.
- Xem trước Facebook/Instagram/Threads/Shopee có thể không bao giờ có ảnh. Thiết kế chấp nhận điều này; không dùng mẹo giả User-Agent của bot mạng xã hội.
- Worker tải URL do người dùng cung cấp, nên giới hạn host, kích thước và thời gian ở 4.3 là bắt buộc. API chỉ dùng được với token nên không phải bề mặt công khai.

## 6. Quyết định do Claude tự đưa ra (cần xem lại)

1. `kind=all` **loại** link để tương thích ngược; client mới tải link bằng một request `kind=link` riêng.
2. "Tất cả" chỉ gồm file, link chỉ ở tab Liên kết.
3. Phân loại tính từ URL ở client (không có cột `site` trong D1).
4. Link trùng URL trả bản cũ thay vì tạo bản sao.
5. Xem trước: tối đa 20 link mỗi lần mở app, 2 link cùng lúc; hạn mức 4 giây, 512 KB HTML, 1.5 MB ảnh.
6. Huy hiệu loại tự vẽ, không dùng logo thương hiệu thật. Con bò cowsay là component SVG mới (con bò hiện có trong app là text `<pre>`).
7. Danh sách tên miền ở 4.2 (ví dụ `fb.me`, `shp.ee` coi là Facebook, Shopee).

## 7. Việc để người làm quyết định

Cách chia file và component, thứ tự giữa các bước, màu cụ thể của huy hiệu, câu chữ toast và chuỗi i18n, cách đặt tên hàm, cách mô phỏng `fetch` trong test.
