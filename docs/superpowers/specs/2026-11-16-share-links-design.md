# Chia sẻ file bằng link công khai: thiết kế

Trạng thái: **đã duyệt và đang triển khai** (nhánh `feat/share-links`; chưa phát hành). Viết ngày 2026-11-16 sau một buổi hỏi đáp thiết kế; người dùng đã đồng ý các câu Q1 đến Q7 ở mục 3. Các quyết định kỹ thuật ở mục 4 do Claude đề xuất và nằm ở mục 7 để người dùng xem lại. Thay đổi quyết định thì sửa file này trước, code sau; khi làm xong phải cập nhật `SPEC.md` (mục 2, 3, 4.2, 5.1, 5.2, 6, 7, 9.2d, 12).

Prototype giao diện dashboard: `docs/superpowers/prototypes/share-links/index.html` (bấm đúp để mở; ba biến thể A/B/C cho **form cấu hình chia sẻ**). Đã chỉnh theo góp ý của người dùng: không vẽ trang người nhận trong prototype (người dùng sẽ mở link bằng trình duyệt khác khi làm xong), thêm nút lọc **Đã chia sẻ** vào island, và icon nhiều người cạnh bút chì.

## 1. Mục đích

Hiện nay mọi thứ trong FatUp chỉ người có token mới đọc được. Người dùng muốn **gửi một đường link cho người khác** (bạn bè, người nhà, đối tác) để họ **xem và tải một ảnh hoặc một file về**, mà không phải cài FatUp hay có token.

**Vì sao:** gửi một file lớn qua chat thì bị nén hoặc giới hạn dung lượng; FatUp đã giữ file sẵn trên R2, nên chỉ cần một đường dẫn.

**Quy tắc cốt lõi (người dùng nêu):** chỉ file đang ở **ngoài** (danh sách chính) mới chia sẻ được. Khi file vào **Két sắt** hoặc **thùng rác**, mọi link chia sẻ của nó **hết hiệu lực ngay lập tức**.

## 2. Mục tiêu, không phải mục tiêu, điều phải tránh

**Mục tiêu**

- Mỗi ảnh/file có thể có **một link chia sẻ**. Ai có link đều xem (ảnh) và tải về được, **chỉ đọc**: không sửa, xóa, hay thấy file khác.
- Người nhận không cần đăng nhập, không cần app. Mở link thấy một trang nhỏ: tên, dung lượng, ảnh xem trước (nếu là ảnh), nút **Tải về**.
- Hạn tùy chọn khi tạo: **không hết hạn** (mặc định), 1 ngày, 7 ngày, 30 ngày; đổi được sau; luôn có **Dừng chia sẻ**.
- Link chết ngay khi: file vào Két sắt, file vào thùng rác, người dùng bấm Dừng chia sẻ, hết hạn, hoặc file bị xóa vĩnh viễn.
- Nút lọc **Đã chia sẻ** trên island (cạnh nhóm Ảnh/File/Liên kết, ngăn bằng đường kẻ, màu khác) để xem riêng các file đang chia sẻ.
- File đang chia sẻ có **icon nhiều người** (không chữ) cạnh bút chì; rê chuột thấy tooltip bên trái, bấm thì mở form cấu hình chia sẻ (sao chép link, đổi hạn, dừng, số lượt tải, lần mở gần nhất) như một lối tắt.
- Chọn nhiều file rồi bấm **Chia sẻ** thì tạo mỗi file một link riêng và hiện danh sách để sao chép.
- Có trên **desktop và PWA**.

**Không làm**

- Không mật khẩu, không đăng nhập cho người nhận, không giới hạn theo người/email.
- Không link chung cho nhóm file, không album, không thư mục; không chia sẻ **liên kết (bookmark)** hay text.
- Không quyền ghi: người nhận không tải lên, không xóa, không đổi tên.
- Android chưa có nút Chia sẻ (app Android chưa có màn hình danh sách).
- Không trang liệt kê tất cả link đang sống.
- Không đếm theo từng người nhận, không địa chỉ IP, không phân tích truy cập.
- Không giới hạn số lượt tải mỗi link.

**Điều phải tránh (thất bại dù code chạy)**

- **Link còn mở được sau khi file vào Két sắt hoặc thùng rác**, dù chỉ vài giây. Đây là yêu cầu cứng.
- Link tự sống lại khi người dùng khôi phục hoặc đưa file ra khỏi Két sắt.
- Một file người dùng tải lên (HTML, SVG...) được phục vụ **cùng origin với PWA** theo cách chạy được script, từ đó đọc được dữ liệu của app.
- Người ngoài đoán ra link, hoặc dùng link để chạm tới bất cứ route nào của API (chỉ có token).
- Tên file chứa `<script>` hay ký tự lạ làm hỏng trang hoặc chèn mã.

## 3. Các quyết định đã chốt với người dùng

| # | Câu hỏi | Chốt |
|---|---|---|
| Q1 | Theo từng file hay theo nhóm? | Từng file. Chọn nhiều file thì tạo N link riêng và liệt kê để sao chép. |
| Q2 | Link sống bao lâu? | Mặc định không hết hạn; chọn được không hạn / 1 / 7 / 30 ngày khi tạo và đổi sau; luôn có Dừng chia sẻ. |
| Q3 | Ai mở được? | Bất kỳ ai có link (token ngẫu nhiên dài), không mật khẩu. |
| Q4 | Khôi phục / đưa ra khỏi Két thì link sống lại? | **Chết hẳn.** Muốn chia sẻ lại phải tạo link mới (token mới). Hoàn tác xóa nhầm cũng không cứu được link. |
| Q5 | Người nhận thấy gì? | Một trang nhỏ do Worker dựng (tên, dung lượng, ảnh xem trước nếu là ảnh, nút Tải về), không đăng nhập, không PWA. Có thêm đường tải thẳng `/s/<token>/file`. |
| Q6 | Phạm vi | Chỉ ảnh và file (không bookmark, không text). Chỉ desktop và PWA có nút Chia sẻ. |
| Q7 | Quản lý | Biểu tượng "đang chia sẻ" trên dòng + hộp thoại Chia sẻ của file (sao chép, đổi hạn, Dừng, lượt tải, lần mở gần nhất). Không có trang liệt kê. |

## 4. Thiết kế kỹ thuật

### 4.1 Cách làm đã cân nhắc: "hết hiệu lực ngay"

Link tải hiện có là presigned URL của R2, **không thu hồi được** và sống tới 1 giờ. Nếu dùng nó cho người nhận thì file vào thùng rác rồi vẫn tải được tới 1 giờ, vi phạm yêu cầu cứng.

| Cách | Đánh đổi | Kết quả |
|---|---|---|
| 1. Chuyển hướng tới presigned URL 60 giây | Rẻ, nhưng vẫn còn tải được tối đa 60 giây sau khi thu hồi | Loại |
| **2. Worker truyền file từ R2 (streaming), kiểm tra D1 ở mỗi request** | Thu hồi tức thì với mọi lượt tải mới; Worker nằm trên đường truyền (chỉ tốn request, R2 không tính phí egress) | **Chọn** |
| 3. Dùng Cloudflare Access / URL ký bằng KV | Thêm dịch vụ, phức tạp hơn nhiều cho một người dùng | Loại |

Cách 2: mọi request của người nhận đi qua Worker, Worker tra `shares` JOIN `files` rồi mới đọc R2 qua binding `BUCKET`. Một lượt tải **đang chạy dở** khi thu hồi có thể chạy tiếp cho tới hết (kết nối đã mở); lượt mới thì bị từ chối ngay. Chấp nhận được.

### 4.2 Dữ liệu

Migration `0008_shares.sql`:

```sql
CREATE TABLE shares (
  token          TEXT PRIMARY KEY,                       -- 24 byte ngẫu nhiên, base64url (32 ký tự, 192 bit)
  file_id        TEXT NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,  -- tối đa một link mỗi file
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER,                                -- NULL = không hết hạn
  downloads      INTEGER NOT NULL DEFAULT 0,
  last_access_at INTEGER                                 -- lần cuối có người mở trang hoặc tải
);

-- Hết hiệu lực "chết hẳn" bằng cấu trúc: bất kể route nào đưa file vào thùng rác hoặc Két sắt,
-- link bị xóa cùng lúc. Không phụ thuộc việc từng route nhớ gọi.
CREATE TRIGGER shares_revoke_on_hide
AFTER UPDATE OF deleted_at, in_vault ON files
WHEN NEW.deleted_at IS NOT NULL OR NEW.in_vault = 1
BEGIN
  DELETE FROM shares WHERE file_id = NEW.id;
END;
```

- `FileItem` (ở `shared`) thêm `shared: boolean`: có link **còn hiệu lực** (chưa hết hạn). Client cũ bỏ qua trường này.
- Mỗi file một link (`UNIQUE`). Hết hạn rồi mà người dùng chia sẻ lại thì tạo **token mới** (xóa dòng cũ, chèn dòng mới).
- Chỉ `kind IN ('image','file')` và `status = 'ready'` mới có link.

### 4.3 API cho chủ file (cần Bearer token, như mọi route hiện có)

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/files/:id/share` | `ShareInfo` nếu đang có link còn hiệu lực, không thì `404 not_shared`. |
| `PUT` | `/files/:id/share` | Body `{ expiresInDays: 1 \| 7 \| 30 \| null }`. Chưa có link (hoặc đã hết hạn) thì **tạo** (201); đã có thì **đổi hạn**, giữ token, tính từ bây giờ (200). Trả `ShareInfo`. Lỗi: `404` (không tồn tại, đang ở Két/thùng rác, chưa `ready`), `400 not_shareable` (link/text), `400 bad_expiry`. |
| `DELETE` | `/files/:id/share` | Dừng chia sẻ. Idempotent, trả `{ ok: true }`. |

```ts
type ShareInfo = {
  token: string;
  url: string;              // `${origin}/s/${token}`, origin lấy từ request
  expiresAt: number | null; // epoch ms
  downloads: number;
  lastAccessAt: number | null;
  createdAt: number;
};
```

### 4.4 Route công khai cho người nhận (không cần token)

Đăng ký **trước** middleware auth ở `app.ts` (như `/health`). Chỉ có hai route; mọi thứ khác vẫn đòi token.

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/s/:token` | Trang HTML (mục 4.5). Cập nhật `last_access_at`. |
| `GET` | `/s/:token/file` | Truyền file từ R2 với `Content-Disposition: attachment` (tên gốc, mã hóa theo RFC 5987 để giữ tiếng Việt), tăng `downloads`. |
| `GET` | `/s/:token/file?inline=1` | Chỉ dành cho ảnh raster (`image/jpeg`, `png`, `gif`, `webp`, `avif`): phục vụ `inline` cho thẻ `<img>` của trang. Không tính lượt tải. Loại khác (kể cả SVG) thì `404`. |

**Một câu truy vấn quyết định mọi thứ**, chạy ở mỗi request:

```sql
SELECT f.*, s.* FROM shares s JOIN files f ON f.id = s.file_id
WHERE s.token = ? AND f.status = 'ready' AND f.deleted_at IS NULL AND f.in_vault = 0
  AND f.kind IN ('image','file') AND (s.expires_at IS NULL OR s.expires_at > ?)
```

Không có dòng nào thì trả **cùng một** `404` với trang "Link không còn hiệu lực", **không phân biệt** lý do (token sai, hết hạn, đã dừng, file vào thùng rác), để không lộ thông tin. Điều kiện `deleted_at IS NULL AND in_vault = 0` ở đây là lớp phòng thủ thứ hai bên cạnh trigger.

**Header cho mọi phản hồi công khai:** `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. Phản hồi file thêm `Content-Security-Policy: sandbox; default-src 'none'`.

**An toàn origin:** file người dùng tải lên được phục vụ cùng origin với PWA, nên **chỉ ảnh raster được inline**; mọi thứ khác là `attachment`, kèm `nosniff` và CSP `sandbox`. HTML/SVG tải lên không bao giờ chạy trên origin của app.

### 4.5 Trang người nhận

Thiết kế mặc định: **một thẻ ở giữa** (ảnh xem trước nếu là ảnh, tên, dung lượng, nút Tải về, ghi chú "Chỉ xem và tải về"); không có trong prototype. Người dùng xem nó bằng cách mở link ở trình duyệt khác khi tính năng chạy.

Worker dựng chuỗi HTML trong `worker/src/share-page.ts`: **không JS**, CSS nội tuyến, sáng/tối theo `prefers-color-scheme`, vừa màn hình điện thoại. Có: ảnh xem trước (`<img src="/s/<token>/file?inline=1">`, chỉ khi là ảnh), tên, dung lượng, nút **Tải về** (`<a href="/s/<token>/file">`), dòng ghi chú "Chỉ xem và tải về". Mọi giá trị đi vào HTML đều qua `escapeHtml`. Không có thẻ Open Graph (app chat xem trước link không kéo ảnh về). CSP của trang: `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`. Trang hết hiệu lực dùng cùng khung.

### 4.6 Thu hồi và dọn dẹp

| Sự kiện | Link |
|---|---|
| `DELETE /files/:id` (vào thùng rác) | Xóa (trigger) |
| `PUT /files/:id/vault` `{inVault: true}` | Xóa (trigger) |
| Khôi phục, đưa ra khỏi Két | **Không** sống lại (đã bị xóa) |
| `DELETE /files/:id/share` | Xóa |
| Quá `expires_at` | Từ chối ngay ở truy vấn; cron xóa dòng |
| Xóa vĩnh viễn, cron dọn thùng rác | `ON DELETE CASCADE` và `purge` xóa tường minh `shares` |

`cleanup` thêm một câu `DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ?`.

### 4.7 Client

**Chung (`shared-ipc.ts`, desktop và web):** `FatupApi` thêm `getShare(id)`, `setShare(id, expiresInDays)`, `stopShare(id)`; cài ở `desktop/src/main/api.ts` + IPC và `web/src/browser-api.ts`. Link tuyệt đối trả về từ server nên client không tự ghép URL.

**UI (tái dùng trên desktop và web):**

- Menu `⋮`/chuột phải: **Chia sẻ…** (đổi thành **Quản lý chia sẻ…** khi đang chia sẻ). Ẩn trong Két sắt và thùng rác, và với link/text.
- Thanh chọn nhiều file: nút **Chia sẻ**. Tạo link cho từng file (hạn mặc định không hết hạn), hiện hộp thoại liệt kê *tên + link* với nút sao chép từng dòng và **Sao chép tất cả** (mỗi dòng `tên: link`).
- **Nút lọc "Đã chia sẻ"** trên island: đặt **ngay sau nhóm Liên kết/File/Ảnh** (cạnh Ảnh, nút cuối của nhóm từ bản 0.4.1), tách khỏi nhóm đó bằng một đường kẻ dọc (`.chips-divider`, cùng loại với đường kẻ sau nút ★). Có icon nhiều người, chữ "Đã chia sẻ" và số lượng; **màu xanh lá** (`--success`) khác các chip còn lại, bật lên thì nền xanh lá nhạt. Bật nút thì chỉ hiện file có `shared = true`; kết hợp kiểu **VÀ** với tab loại (Ảnh/File) và ô tìm kiếm, giống nút ★ "quan trọng". Số lượng và bộ lọc tính ở client từ `FileItem.shared` của danh sách đã tải. Không hiện trong Két sắt và thùng rác.
- **Icon "đang chia sẻ" trên từng file:** chỉ icon (`Users` của lucide), **không chữ**, màu xanh lá. **Danh sách:** nằm trong cột hành động bên phải sẵn có (`.col-actions`, đã rộng 68px cho hai icon của dòng link), ngay **bên trái bút chì**, nên không đổi bố cục; dòng chưa chia sẻ chỉ có bút chì, canh phải như cũ. **Lưới:** bút chì chỉ hiện khi rê chuột và nổi đè lên đuôi tên, nên icon này cũng nổi đè (không chiếm chỗ của tên), **luôn hiện**, và nhích sang trái nhường chỗ khi bút chì hiện.
- **Tooltip bên trái:** là phần tử tuyệt đối (`data-tip`, `::after`) mọc về phía **trái** icon (không dùng `title` của trình duyệt vì không chọn được hướng), nên không bao giờ làm tràn mép phải hay đẩy bố cục. Nội dung: "Đang chia sẻ · bấm để quản lý link" (hạn và số lượt tải xem trong form, vì danh sách file không mang các số đó). Hiện sau ~0,25 giây rê chuột hoặc khi focus bàn phím.
- **Bấm icon** mở thẳng form cấu hình chia sẻ của file đó (lối tắt); mục menu "Quản lý chia sẻ…" mở cùng form. File chưa chia sẻ thì dùng menu **Chia sẻ…**.
- Hộp thoại Chia sẻ (biến thể chọn sau khi xem prototype): trạng thái chưa chia sẻ có chọn hạn và **Tạo link và sao chép**; trạng thái đang chia sẻ có ô link + **Sao chép**, chọn hạn, số lượt tải, lần mở gần nhất, ghi chú về Két sắt/thùng rác, **Dừng chia sẻ**.
- Khi chuyển một file đang chia sẻ vào Két sắt hoặc thùng rác: toast ghi rõ "Link chia sẻ đã hết hiệu lực". Không hỏi xác nhận. Nút **Hoàn tác** của thùng rác vẫn khôi phục file nhưng **không** khôi phục link.
- Chuỗi mới cho cả `en` và `vi` (`desktop/src/renderer/src/lib/i18n.ts`).

### 4.8 Kiểm thử

- **Worker (vitest):**
  - Tạo/đổi hạn/dừng chia sẻ; `404` cho file ở Két/thùng rác/`pending`; `400 not_shareable` cho link và text; `bad_expiry`; token khác nhau, đủ dài; chia sẻ lại sau khi hết hạn ra token mới.
  - **Thu hồi:** sau mỗi tình huống sau, `/s/:token` và `/s/:token/file` đều `404` và `GET /files/:id/share` là `404`: xóa vào thùng rác, vào Két sắt, Dừng chia sẻ, quá hạn, xóa vĩnh viễn, cron purge. **Khôi phục và đưa ra khỏi Két không làm link sống lại**, và tạo link mới cho ra token khác.
  - **Trigger là cấu trúc:** cập nhật thẳng `deleted_at`/`in_vault` bằng SQL (không qua route nào) cũng xóa link.
  - **Công khai đúng phạm vi:** `/s/...` không cần token; `GET /files` không token vẫn `401`; `/s/:token` không đọc được file khác; phản hồi `404` của token sai, hết hạn, đã dừng **giống hệt nhau**.
  - **An toàn:** tên file chứa `<script>`/dấu nháy được escape trong trang; `Content-Disposition` đúng với tên tiếng Việt; `inline=1` chỉ cho ảnh raster, SVG và HTML luôn `attachment`; có đủ header ở 4.4.
  - Bộ đếm: `downloads` tăng một lần mỗi lượt tải; xem trang/ảnh inline không tăng `downloads` nhưng cập nhật `last_access_at`.
  - `FileItem.shared` đúng ở danh sách, và `false` khi link hết hạn.
  - Migration `0008` không làm mất dữ liệu `files` hiện có.
- **Desktop/web:** hàm định dạng danh sách "tên: link" cho Sao chép tất cả; logic hạn.
- **E2E (Playwright, mock server):** mock server thêm ba route share; luồng tạo link → sao chép → icon nhiều người hiện cạnh bút chì (không đổi vị trí bút chì và các cột khác) → rê chuột thấy tooltip bên trái trong khung cửa sổ → bấm icon mở form → nút **Đã chia sẻ** lọc đúng và đếm đúng → chuyển file vào Két → icon biến mất, số đếm giảm và toast báo link hết hiệu lực.
- **Thủ công sau khi làm:** mở link ở cửa sổ ẩn danh (ảnh, PDF, tên tiếng Việt, file lớn), rồi chuyển vào Két sắt và tải lại, phải thấy trang "Link không còn hiệu lực".

## 5. Rủi ro và ghi chú triển khai

- **Thứ tự nâng cấp:** `npm run db:migrate` (áp dụng `0008`, chỉ thêm bảng và trigger, không dựng lại `files`) rồi `npm run deploy:worker`. Bản desktop/PWA cũ vẫn chạy bình thường, chỉ không thấy nút Chia sẻ.
- **Trigger trên D1:** cần xác minh trigger chạy đúng trên D1 thật (test miniflare chạy SQLite cục bộ). Nếu D1 từ chối trigger thì phương án dự phòng là gọi `revokeShares(fileId)` tường minh ở các route (`DELETE /files/:id`, `PUT /files/:id/vault`) kèm test; điều kiện `deleted_at IS NULL AND in_vault = 0` trong truy vấn công khai vẫn giữ link chết khi file đang ở Két/thùng rác, nhưng khi đó khôi phục sẽ làm link sống lại nên **phải có** phương án dự phòng, không được bỏ.
- **Ai có link thì tải được, và chuyển tiếp được.** Người nhận có thể gửi link đi nơi khác; hạn và Dừng chia sẻ là cách duy nhất thu hồi. Ghi rõ trong hộp thoại và README.
- **Băng thông qua Worker:** mỗi lượt tải tốn một request Worker (gói free 100.000 request/ngày). Không có giới hạn tần suất riêng: token 192 bit không đoán được; link bị lộ thì người dùng bấm Dừng chia sẻ. Có thể thêm quy tắc rate limiting của Cloudflare ở mức tài khoản nếu cần.
- **Không hỗ trợ `Range`** ở bản đầu (tải tiếp khi đứt, tua video). File ≤ 100 MB nên chấp nhận được. Thêm sau nếu cần.
- **Lượt tải thuộc app xem trước link:** Zalo/Messenger/iMessage có thể mở trang để dựng thẻ xem trước, làm "lần mở gần nhất" nhích lên dù người nhận chưa mở. Không tính `downloads` vì chỉ `/file` mới tăng.
- Khi người dùng đổi tên file sau khi chia sẻ, tên hiện ở trang và khi tải đổi theo (link không đổi).

## 6. Prototype cần quyết

Prototype chỉ vẽ **dashboard** (island có nút Đã chia sẻ, danh sách và lưới có icon nhiều người, menu, toast) cùng **form cấu hình chia sẻ** ở ba biến thể. **Trang người nhận không nằm trong prototype**: người dùng sẽ thấy nó khi mở link bằng trình duyệt khác; thiết kế mặc định là thẻ ở giữa (mục 4.5).

| | Form cấu hình chia sẻ |
|---|---|
| **A** | Hộp thoại giữa màn hình (cùng khung với "Thêm liên kết") |
| **B** | Popover nhỏ neo vào icon vừa bấm (như popover đổi tên); hợp nhất với ý "lối tắt" |
| **C** | Ngăn trượt bên phải có ảnh và nhật ký hoạt động |

**Đã chọn (2026-11-16): ghép, B khi bấm icon nhiều người, A khi chọn Chia sẻ… từ menu.** Hai form dùng chung các thành phần (ô link, chọn hạn, số liệu, Dừng chia sẻ). *Đề xuất ban đầu của Claude:* **A** cho lần tạo link và quản lý đầy đủ (dùng lại `Dialog`, gọn trên màn hình điện thoại của PWA, đủ chỗ cho ghi chú Két sắt/thùng rác). Nếu muốn "lối tắt" đúng nghĩa khi bấm icon nhiều người thì **B** nhanh hơn; hai biến thể này có thể ghép (B khi bấm icon, A khi chọn **Chia sẻ…** từ menu) nhưng sẽ phải làm và kiểm thử hai form. Prototype chưa vẽ màn hình **chia sẻ nhiều file** (chỉ mô tả ở 4.7).

## 7. Quyết định do Claude tự đưa ra (cần xem lại)

1. Truyền file qua Worker thay vì chuyển hướng tới presigned URL, để thu hồi tức thì (mục 4.1).
2. Trigger SQL để thu hồi theo cấu trúc, kèm truy vấn kiểm tra ở mỗi request (mục 4.2, 4.4).
3. Token 24 byte (192 bit), base64url; mỗi file một link; chia sẻ lại sau hết hạn = token mới.
4. Đổi hạn tính từ **bây giờ** (không cộng dồn) và giữ token.
5. `404` giống hệt nhau cho mọi lý do chết; không có trang riêng cho "hết hạn" so với "đã dừng".
6. Chỉ ảnh raster được xem inline; SVG, HTML và mọi loại khác luôn là `attachment` (an toàn origin).
7. Không Open Graph, không `Range`, không giới hạn tần suất, không giới hạn số lượt tải.
8. Chia sẻ nhiều file tạo link **không hết hạn** mặc định, không hỏi hạn từng file.
9. Menu Chia sẻ ẩn trong Két sắt và thùng rác; nút lọc **Đã chia sẻ** cũng không hiện ở hai màn hình đó.
10. Nút lọc **Đã chia sẻ** đặt sau nhóm Liên kết/File/Ảnh (cạnh Ảnh, đúng lời "bên cạnh Photos" khi thứ tự tab là Liên kết → File → Ảnh), lọc kiểu VÀ với tab loại; màu xanh lá; có số lượng.
11. Tooltip tự dựng bằng CSS để mọc về bên trái, thay cho `title` của trình duyệt; nội dung chỉ "Đang chia sẻ · bấm để quản lý link" (không kèm hạn và lượt tải: danh sách file không mang các số đó, và thêm vào sẽ làm mọi lượt tải đổi payload danh sách).
12. Ở dạng lưới, icon chia sẻ luôn hiện (khác bút chì chỉ hiện khi rê chuột) vì nó là trạng thái, không phải thao tác.
13. `shares` có `ON DELETE CASCADE` nhưng `purge` vẫn xóa tường minh, không dựa vào việc D1 bật khóa ngoại.

## 8. Việc để người làm quyết định

Cách chia file và component, thứ tự các bước, màu và icon cụ thể, câu chữ toast và chuỗi i18n, cách đặt tên hàm, kiểu HTML/CSS chi tiết của trang người nhận (giữ trong khuôn mục 4.5), cách mô phỏng R2 trong test.
