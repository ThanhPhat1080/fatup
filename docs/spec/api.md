# API (Worker)

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 4. API (Worker)

Tất cả trả JSON, lỗi có dạng `{ "error": { "code": string, "message": string } }`. Mọi route (trừ `/health`) đòi `Authorization: Bearer <token>`.

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/health` | Không cần auth. `{ ok: true }` |
| `GET` | `/me` | Client dùng để kiểm tra URL + token khi setup |
| `GET` | `/usage` | `{ usedBytes, limitBytes }`. Tổng `size` của file `ready` (**gồm cả thùng rác và két sắt**, không tính thumbnail). `limitBytes` mặc định 10 GB (free tier R2), đổi bằng biến `R2_QUOTA_GB` |
| `POST` | `/uploads` | Body `{ name, mime, size, hasThumb, device?, vault? }`. Kiểm tra `size ≤ 100MB`. Tạo row `pending`. Trả `{ id, uploadUrl, thumbUploadUrl? }`. Với `vault: { encMeta, encKey }` (upload thẳng vào két, [mục 4.3](#43-két-sắt-mã-hóa)): `size` là kích thước bản mã (≤ `vaultCiphertextSize(100MB)`) và địa chỉ là `vault/<id>`. |
| `POST` | `/uploads/:id/complete` | `HEAD` R2 xác nhận object tồn tại và đúng size. `status = 'ready'`, `created_at = now`. Trả `FileItem` |
| `GET` | `/files?kind=&limit=&cursor=` | Danh sách chính: `ready`, **không ở thùng rác, không ở két sắt**. Mới nhất trước |
| `GET` | `/files?vault=1` | Danh sách trong két sắt (không gồm mục đã vào thùng rác của két). Cần header `X-FatUp-Vault: 2` khi két đã thiết lập, [mục 4.3](#43-két-sắt-mã-hóa) |
| `GET` | `/files?vault=1&trash=1` | Thùng rác của két sắt, theo `deleted_at` |
| `GET` | `/files?trash=1` | Thùng rác thường, sắp theo thời điểm xóa (mới xóa trước). Cursor theo `deleted_at`. Không bao giờ có mục của két |
| `GET` | `/files/:id/download` | `{ url }`: presigned GET có `response-content-disposition` theo tên gốc. 404 nếu file ở thùng rác. Mục mã hóa: presigned GET của `vault/<id>`, không kèm tên hay loại (client tự giải mã) |
| `DELETE` | `/files/:id` | **Chuyển vào thùng rác** (idempotent): đặt `deleted_at`. Mục trong két giữ `in_vault = 1` (vào thùng rác của két). Riêng upload `pending` thì xóa hẳn |
| `POST` | `/files/:id/restore` | Khôi phục khỏi thùng rác: `deleted_at = NULL`. Idempotent. Trả `FileItem` |
| `DELETE` | `/files/:id/permanent` | Xóa vĩnh viễn (R2 + D1). Chỉ cho file đang ở thùng rác, không thì `409 not_in_trash` |
| `DELETE` | `/trash` | Dọn sạch **thùng rác thường** (`in_vault = 0`), theo lô 100. Không đụng thùng rác của két. Trả `{ deleted }` |
| `PATCH` | `/files/:id` | Body `{ name?, tags?, encMeta? }`, phải có ít nhất một. `name` là tên hiển thị mới (đã gồm phần mở rộng); `tags` là mảng tối đa 3 màu khác nhau trong `TAG_COLORS`. Mục trong két: `name` và `url` dạng rõ bị `409 encrypted`; đổi tên thì gửi `encMeta` mới (client mã hóa lại). Mục thường gửi `encMeta` bị `400`. Chỉ sửa D1: object R2 đặt theo `id` nên đổi tên không động tới R2. Trả `FileItem` |
| `PUT` | `/files/:id/vault` | Body `{ inVault: boolean }`. Khi két **chưa thiết lập** (`state = none`): chuyển vào/ra két như cũ. Khi đã thiết lập: `426 app_outdated`, dùng [mục 4.3](#43-két-sắt-mã-hóa). 404 nếu file không tồn tại hoặc đang ở thùng rác |

```ts
type FileItem = {
  id: string; name: string; mime: string; size: number;
  kind: 'image' | 'file' | 'text';
  thumbUrl: string | null;   // presigned, 1h
  device: string | null;
  createdAt: number;         // epoch ms
  deletedAt: number | null;  // có giá trị khi ở thùng rác
  inVault: boolean;
  tags: TagColor[];          // tối đa MAX_TAGS (3), theo thứ tự thêm
  encrypted?: boolean;       // mục két đã mã hóa: name = '', mime = 'application/octet-stream', kind = 'file', url = null
  encMeta?: string | null;   // base64: name, mime, kind, url/title đã mã hóa bằng MK; chỉ khi encrypted
  encKey?: string | null;    // base64: DEK đã bọc bằng MK; chỉ khi encrypted
};

// shared: TAG_COLORS = red | orange | yellow | green | blue | purple | gray
```

Phân trang dùng cursor `<sortValue>_<id>`, với `sortValue` là `created_at` (danh sách thường, két sắt) hoặc `deleted_at` (thùng rác).

### 4.1 Liên kết (bookmark)

Một link là một row `files` với `kind = 'link'`, `mime = 'text/uri-list'`, `size = 0` (không tính vào dung lượng), `status = 'ready'`, `name` là tiêu đề, `url` là địa chỉ. Không có object `files/<id>` trên R2. Ảnh xem trước **không còn được lưu trên server** (từ bản này): mỗi thiết bị tự tải và giữ ảnh ([9.2c](desktop-ui.md#92c-liên-kết)); link cũ vẫn dùng `thumbs/<id>.jpg` đã có trên R2 (`thumbUrl`). `FileItem` có thêm `url`, `site` (`facebook | youtube | instagram | threads | shopee | tiktok | internet`, tính từ `url` bằng `siteOf` ở `shared/`) và `previewed`.

| Method | Path | Mô tả |
|---|---|---|
| `POST` | `/links` | Body `{ url, title?, device? }`. Chỉ nhận `http`/`https`, tối đa 2048 ký tự; chuẩn hóa URL (bỏ fragment, hạ chữ thường tên miền). URL đã có link **không ở thùng rác** thì trả bản cũ (200), không tạo bản sao. Có `title` thì `title_set = 1`, không thì tên = tên miền. 201 khi tạo mới. Lỗi: `400 bad_url`. |
| `POST` | `/links/:id/preview` | Worker đọc trang đích (timeout 6 giây, tối đa 3 lần redirect, đọc ≤ 512 KB HTML, từ chối localhost/IP nội bộ) rồi cập nhật tên (chỉ khi `title_set = 0`) và trả `PreviewResponse` = link + `previewImage` (địa chỉ tuyệt đối, công khai của `og:image`/thumbnail oEmbed, hoặc `null`). **Không tải và không lưu ảnh, không ghi R2.** YouTube và TikTok dùng oEmbed. Không bao giờ lỗi vì trang đích. Gọi lần nào cũng đọc lại trang (client quyết định khi nào cần); vẫn đặt `previewed_at`. `?force=1` không còn tác dụng. |
| `PATCH` | `/files/:id` | Với link nhận thêm `url`: đổi URL thì xóa xem trước (`previewed_at = NULL`, xóa `thumbs/<id>.jpg`), tên quay về tên miền mới nếu `title_set = 0`. Đổi `name` đặt `title_set = 1`. URL trùng link khác: `409 duplicate_url`. Gửi `url` cho file thường: `400`. |

- `GET /files?kind=all` **không trả link** (để bản app cũ không thấy chúng); lấy link bằng `kind=link` (kết hợp được với `vault=1`). Thùng rác trả mọi loại.
- `GET /files/:id/download` với link: `400 not_a_file`.
- Link, như mọi file ngoài thùng rác, không bao giờ hết hạn. Link ở thùng rác quá 30 ngày vẫn bị xóa như file.
- Thùng rác, két sắt, khôi phục, xóa vĩnh viễn, thẻ màu dùng nguyên.

### 4.2 Chia sẻ link công khai

*(Chi tiết và lý do: `docs/superpowers/specs/2026-11-16-share-links-design.md`.)* Chỉ `kind` là `image` hoặc `file`, `status = 'ready'`, không ở thùng rác, không ở két sắt mới có link. Mỗi file tối đa một link.

**Cho chủ file** (cần Bearer token như mọi route khác):

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/files/:id/share` | `ShareInfo` (`token`, `url`, `expiresAt`, `downloads`, `lastAccessAt`, `createdAt`), hoặc `404 not_shared`. |
| `PUT` | `/files/:id/share` | Body `{ expiresInDays: 1 \| 7 \| 30 \| null }`. Chưa có link (hoặc hết hạn) thì **tạo** token mới (201); đã có thì **đổi hạn** từ bây giờ, giữ token (200). Lỗi: `404` (không tồn tại, ở Két/thùng rác, chưa `ready`), `400 not_shareable` (link, text), `400 bad_expiry`. |
| `DELETE` | `/files/:id/share` | Dừng chia sẻ. Idempotent. |

`FileItem` thêm `shared: boolean` (có link còn hiệu lực).

**Cho người nhận** (không cần token; chỉ hai route này công khai, mọi route khác vẫn đòi token):

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/s/:token` | Trang HTML do Worker dựng: tên, dung lượng, ảnh xem trước nếu là ảnh, nút Tải về. Không JS. |
| `GET` | `/s/:token/file` | Truyền file từ R2, `Content-Disposition: attachment` (tên gốc, RFC 5987). Tăng `downloads`. |
| `GET` | `/s/:token/file?inline=1` | Chỉ ảnh raster (jpeg/png/gif/webp/avif), `inline`, cho thẻ `<img>`; không tính lượt tải. Loại khác `404`. |

- **Mỗi request** chạy một truy vấn `shares JOIN files` đòi: token khớp, `ready`, không ở thùng rác, không ở két sắt, là image/file, chưa hết hạn. Không khớp thì trả cùng một `404` (trang "Link không còn hiệu lực") dù lý do là gì.
- **Thu hồi tức thì:** trigger `shares_revoke_on_hide` xóa link khi file vào thùng rác hoặc két sắt, bằng bất cứ đường nào. Khôi phục hoặc đưa ra khỏi két **không** làm link sống lại; chia sẻ lại thì ra token mới.
- Header: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`; phản hồi file thêm CSP `sandbox; default-src 'none'`. File do người dùng tải lên cùng origin với PWA nên **chỉ ảnh raster được inline**; SVG, HTML, mọi loại khác luôn là `attachment`.
- Không hỗ trợ `Range`, không giới hạn tần suất, không giới hạn lượt tải.

### 4.3 Két sắt mã hóa

Mọi route dưới đây đòi Bearer token như các route khác. Thiết kế mã hóa, các khóa và bộ đếm: [mục 7.1–7.3](security.md#71-két-sắt-mã-hóa-phía-client-e2ee). Lý do: [ADR 0013](../decisions/0013-ket-sat-ma-hoa-phia-client.md).

**Phiên bản.** Client biết két mã hóa gửi header `X-FatUp-Vault: 2`. Khi két đã thiết lập (`state ≠ none`), `GET /files?vault=1` và `PUT /files/:id/vault` trả `426 app_outdated` nếu thiếu header. App bản cũ vì thế không thấy và không đưa file vào két mới được.

**Két và mở két.** Mọi giá trị là base64 chuẩn có padding; `kdfIterations` là số nguyên dương.

| Method | Path | Body | Trả về | Lỗi |
|---|---|---|---|---|
| `GET` | `/vault` | — | `{ state, kdf?, failedAttempts, lockedUntil, remaining }`. `state` là `none`, `ready` hoặc `wiped`; `kdf = { salt, iterations }` có khi đã thiết lập; `lockedUntil` là `null` khi không khóa (kể cả khóa đã hết hạn) | — |
| `POST` | `/vault/setup` | `{ kdfSalt, kdfIterations, authKey, serverSecret, wrappedMkPin, rkAuth, wrappedMkRecovery }` | `201 { ok: true }` | `400 bad_request`; `409 vault_exists` (két đã có, kể cả khi đã bị xóa bí mật) |
| `POST` | `/vault/unlock` | `{ authKey }` | `200 { serverSecret, wrappedMkPin }`, bộ đếm về 0 | `403 { remaining, lockedUntil }` sai PIN; `423 { remaining, lockedUntil }` đang khóa; `410 vault_wiped`; `409 vault_not_ready`, `vault_busy` |
| `POST` | `/vault/recover` | `{ rkAuth }` | `200 { wrappedMkRecovery }` | `403 forbidden` sai recovery key; `409 vault_not_ready` |
| `PUT` | `/vault/pin` | `{ proof, kdfSalt, kdfIterations, authKey, serverSecret, wrappedMkPin }`. `proof` là `{ authKey }` (PIN cũ) **hoặc** `{ rkAuth }`, đúng một trong hai; `authKey` ở đây là PIN mới | `200 { ok: true }`, bộ đếm về 0, `state` = `ready` | `400 bad_request`; `403 { remaining, lockedUntil }` (authKey cũ sai); `403 forbidden` (rkAuth sai); `423`; `410 vault_wiped` (authKey cũ sau khi đã xóa bí mật); `409 vault_not_ready`, `vault_busy` |

- `unlock` và `PUT /vault/pin` bằng `authKey` cũ dùng chung bộ đếm và khóa. Bằng `rkAuth` thì không đếm và không bị khóa (`recover` cũng vậy).
- Lỗi `403`/`423` của `unlock` và `PUT /vault/pin` (bằng `authKey`) có body **phẳng** `{ remaining, lockedUntil }`, không có khóa `error`. Các lỗi khác có dạng `{ error: { code, message } }`.
- Bảng số lần sai và thời gian khóa: [mục 7.3](security.md#73-bộ-đếm-sai-phía-server).

**Thêm, lấy và đưa mục ra khỏi két.** Các route này cần két `ready` (lỗi `vault_not_ready` khi két `none` hoặc `wiped`). Mục phải tồn tại và không ở thùng rác thường. `vault/in` còn nhận mục đang ở thùng rác của két (`in_vault = 1`, đã xóa), vì mục đó vẫn phải được mã hóa.

| Method | Path | Body | Trả về |
|---|---|---|---|
| `POST` | `/uploads` | Thêm `vault: { encMeta, encKey }`. `name` và `mime` vẫn bắt buộc (client gửi `''` và `application/octet-stream`); `size` là kích thước **bản mã** | `201 { id, uploadUrl (vault/<id>), thumbUploadUrl? (vault/<id>.thumb) }` |
| `POST` | `/files/:id/vault/in` | — | `VaultMoveUrls` = `{ uploadUrl, thumbUploadUrl, downloadUrl, thumbUrl, attempt }`. `uploadUrl` và `thumbUploadUrl` ghi `vault/<id>.<attempt>` (và `.thumb`); `downloadUrl` và `thumbUrl` đọc bản gốc. `attempt` là 16 byte ngẫu nhiên (base64url), sinh mới mỗi lần gọi. Liên kết không có object nên `downloadUrl` là `null`. Route không ghi gì về `attempt` vào D1, nhưng đặt `in_vault = 1` ngay (mục rời danh sách chính, link chết) |
| `POST` | `/files/:id/vault/in/complete` | `{ encMeta, encKey, size, hasThumb, attempt }` | `FileItem` (đã mã hóa) |
| `POST` | `/files/:id/vault/out` | — | `{ uploadUrl (files/<id>), thumbUploadUrl, downloadUrl (object mã hóa của mục), thumbUrl }`. Object mã hóa là `vault/<id>.<enc_object>` (hoặc `vault/<id>` khi `enc_object` NULL). Ghi `out_started_at` |
| `POST` | `/files/:id/vault/out/complete` | `{ name, mime, size, hasThumb }`. Liên kết gửi `{ url, title? }` (có `url` thì là liên kết, `name` và `mime` bị bỏ qua) | `FileItem` (dạng rõ) |

*`vault/in/complete`:*

- `attempt`: chuỗi 16–64 ký tự `[A-Za-z0-9_-]`, đúng dạng `vault/in` trả về. Bắt buộc với mục chưa mã hóa (kể cả liên kết). Với mục đã mã hóa thì có thể bỏ, nhưng nếu gửi thì phải đúng dạng. Thiếu với mục chưa mã hóa, hoặc sai dạng: `400 bad_request`. Lời gọi dọn sau khi lấy ra bị lỗi (`vault/in/complete` trên mục đã mã hóa) không gửi `attempt`.
- **Mục đã mã hóa** (`encrypted = 1`):
  - Không có `attempt` (lời gọi dọn sau khi lấy ra bị lỗi): xóa `files/<id>` và `thumbs/<id>.jpg`, trả `FileItem`.
  - `attempt` trùng `enc_object`: trả `200 FileItem` (idempotent), dọn bản rõ còn sót, không đổi gì khác.
  - `attempt` khác `enc_object` (máy thua cuộc): xóa đúng `vault/<id>.<attempt>` và `.thumb` của lần đó, trả `200 FileItem`. `enc_key`, `enc_meta` và object của máy thắng không đổi.
- **Mục chưa mã hóa, còn `in_vault = 1`** (`vault/in` đã đặt): server `head()` đúng `vault/<id>.<attempt>`; liên kết không có object nên bỏ qua bước này.
  - Không có object (`not_uploaded`), hoặc `size` không khớp kích thước object (`size_mismatch`, object của lần đó bị xóa): `409`.
  - `size` vượt `vaultCiphertextSize(100 MB)`: `413 too_large`, object của lần đó bị xóa.
  - Liên kết: `size` lưu là `0`. Ảnh xem trước (nếu có) được mã hóa vào `vault/<id>.<attempt>.thumb`.
- **Thành công:** một câu `UPDATE ... WHERE id = ? AND encrypted = 0 AND in_vault = 1 AND status = 'ready'` đặt `encrypted = 1`, `enc_object = attempt`, `enc_meta`, `enc_key`, `name = ''`, `mime = 'application/octet-stream'`, `kind = 'file'`, `url = NULL`. Khóa luôn khớp đúng object mà `enc_object` nêu. Sau đó mới xóa `files/<id>` và `thumbs/<id>.jpg`; thumb mã hóa của lần đó được giữ nếu có ảnh xem trước, không thì xóa.
- **Máy thua cuộc trong cùng lần cất** (UPDATE không đổi dòng, mục đã mã hóa bởi máy khác): trả `200 FileItem`, xóa object của chính lần đó nếu `attempt` khác `enc_object`. Không lỗi.
- **`409 upload_too_old`:** object (hoặc thumbnail) của lần thử đã nằm trên R2 quá 45 phút. Cron dọn rác xóa object không được hàng nào trỏ tới sau 1 giờ, nên complete không nhận object già hơn 45 phút. Không ghi D1; object của lần thử bị xóa; mục vẫn "đám mây" và lần mở két sau cất lại với `attempt` mới.
- **`409 item_changed`:** mục không còn trên đường vào két (đã lấy ra, hoặc `in_vault` không còn là 1) khi complete đến: object của lần đó bị xóa, hàng không đổi. Đây là "complete muộn" của máy đã bỏ dở.

*`vault/out` và `vault/out/complete`:*

- `vault/out` chỉ cho mục đã mã hóa (`not_encrypted` nếu không) và ghi `out_started_at`. Từ đó bản rõ có thể xuất hiện ở `files/<id>`; cron dọn nếu lượt này không hoàn tất ([mục 6](lifecycle.md#6-vòng-đời-file-thùng-rác-và-dọn-dẹp)).
- `vault/out/complete` trên mục đã mã hóa và còn `out_started_at`: một câu `UPDATE` ghi lại bản rõ (`encrypted = 0`, `in_vault = 0`, `enc_object = NULL`, xóa `enc_meta`, `enc_key`, `out_started_at`), rồi xóa object mã hóa của mục (`vault/<id>.<enc_object>` và thumb, hoặc khóa cố định khi `enc_object` NULL).
- Mục đã rõ, `in_vault = 0`, cùng tên/loại (hoặc cùng URL với liên kết) và cùng kích thước: đây là lần thử lại của lượt đã xong. Dọn bản mã còn sót và trả `FileItem`.
- Mục mã hóa mà `out_started_at` là `NULL` (cron đã nhả): `409 item_changed`, không đổi gì.
- `size_mismatch` và `not_uploaded` áp dụng cho `files/<id>`; object sai kích thước thì bị xóa.
- Liên kết trùng URL với link khác đang sống: `409 duplicate_url`. Liên kết có URL không hợp lệ: `400 bad_url`.
- Quá kích thước `MAX_FILE_SIZE` (100 MB): `413 too_large`, `files/<id>` bị xóa.

*Mục đã mã hóa trong danh sách:* `encrypted: true`, `encMeta`, `encKey` (base64, đã bọc bằng MK), `name = ''`, `mime = 'application/octet-stream'`, `kind = 'file'`, `url = null`. `thumbUrl` trỏ vào `vault/<id>.thumb` (presigned GET 1 giờ, `contentType: application/octet-stream`). Server không giải mã gì; client giải mã `encMeta` bằng MK.

**Danh sách và các route ngoài két.**

| Route | Ghi chú |
|---|---|
| `GET /files` (không `vault`) | Chỉ mục ngoài két. Không bao giờ có mục đã vào thùng rác của két |
| `GET /files?vault=1` | Mục két đang sống, cần header `X-FatUp-Vault: 2` khi két đã thiết lập |
| `GET /files?vault=1&trash=1` | Thùng rác của két |
| `GET /files?trash=1` | Thùng rác thường (`in_vault = 0`) |
| `DELETE /files/:id` | Mục trong két giữ `in_vault = 1` (vào thùng rác của két). Mục khác vào thùng rác thường |
| `DELETE /trash` | Chỉ mục có `in_vault = 0`, theo lô 100 |
| `PATCH /files/:id` | `encMeta` (chuỗi, ≤ 8192 ký tự) cho mục mã hóa khi đổi tên hoặc URL trong két. Mục mã hóa gửi `name` hoặc `url` dạng rõ: `409 encrypted`. Mục thường gửi `encMeta`: `400`. `tags` và `important` vẫn sửa được |
| `POST /links/:id/preview` | Mục mã hóa: `409 encrypted`. Server không đọc được địa chỉ, nên không xem trước |
| `PUT /files/:id/vault` | `state = none`: như cũ. `state ≠ none`: `426 app_outdated` |

Giới hạn độ dài: `encMeta` ≤ 8192 ký tự, `encKey` ≤ 512 ký tự, vi phạm thì `400 bad_request`.

**Mã lỗi mới của két sắt:**

| Mã | HTTP | Khi nào | Client làm gì |
|---|---|---|---|
| `vault_not_ready` | 409 | Két chưa thiết lập (`none`) hoặc đã bị xóa bí mật (`wiped`) với route cần két sẵn sàng (`vault/in`, `vault/out`, upload vào két, `unlock`, `recover`, `PUT /vault/pin`) | Thiết lập, hoặc mở bằng recovery key |
| `vault_exists` | 409 | `POST /vault/setup` khi két đã có | Không thiết lập lại |
| `vault_wiped` | 410 | `unlock`, hoặc `PUT /vault/pin` bằng `authKey` khi két đã bị xóa bí mật | Dùng recovery key |
| `vault_busy` | 409 | Két đổi giữa lúc kiểm tra (request song song) | Thử lại |
| `app_outdated` | 426 | Thiếu `X-FatUp-Vault: 2` khi két đã thiết lập (`GET /files?vault=1`, `PUT /files/:id/vault`) | Cập nhật app |
| `forbidden` | 403 | `rkAuth` sai (`recover`, `PUT /vault/pin` bằng `rkAuth`) | Kiểm tra recovery key |
| `upload_too_old` | 409 | `vault/in/complete` cho object đã upload hơn 45 phút trước | Không cần làm gì: lần mở két sau cất lại với `attempt` mới |
| `item_changed` | 409 | `vault/in/complete` đến khi mục không còn trên đường vào két (đã lấy ra); `out_started_at` không còn (`vault/out/complete`); mục đổi giữa chừng. Đây là complete muộn của lần cất bị bỏ dở | Không cần làm gì: lần mở két sau cất lại với `attempt` mới |
| `size_mismatch` | 409 | Kích thước object của `attempt` không khớp body | Làm lại |
| `not_uploaded` | 409 | Object của `attempt` (hoặc `files/<id>` khi lấy ra) chưa được PUT, hoặc complete trước khi PUT | Làm lại PUT |
| `already_encrypted` | 409 | `vault/in` cho mục đã mã hóa | Không cần làm gì (mục đã trong két) |
| `not_encrypted` | 409 | `vault/out` hoặc `vault/out/complete` cho mục không mã hóa | Không cần làm gì |
| `encrypted` | 409 | `PATCH` đổi `name`/`url` dạng rõ trên mục mã hóa; `POST /links/:id/preview` trên mục mã hóa | Gửi `encMeta` |
| `too_large` | 413 | Bản mã (`vault/in/complete`, upload vào két) hoặc bản rõ (`vault/out/complete`) vượt giới hạn | — |
| `bad_request` | 400 | JSON sai, thiếu trường, `attempt` thiếu (mục chưa mã hóa) hoặc sai dạng, `encMeta`/`encKey` quá dài | Sửa request |
| `bad_url` | 400 | Liên kết trong `vault/out/complete` có URL không hợp lệ | — |
| (phẳng) | 403 | `authKey` sai: body `{ remaining, lockedUntil }` | Nhập lại PIN |
| (phẳng) | 423 | Két đang khóa do sai nhiều: body `{ remaining, lockedUntil }` | Chờ `lockedUntil` |

`vault_locked` không phải mã HTTP: đó là lỗi phía client khi két đang đóng trong app (desktop, web). Các lỗi `bad_item`, `unreadable`, `bad_response`, `network`, `upload_failed` cũng phía client, không có trong bảng này.

*Cron và object mã hóa:* cron xóa object rác dưới `vault/` (lần cất bỏ dở hoặc thua) sau 1 giờ; một complete đến sau mốc đó có thể không còn object để `head()`. Chi tiết và rủi ro: [mục 6](lifecycle.md#6-vòng-đời-file-thùng-rác-và-dọn-dẹp), [mục 7.7](security.md#77-giới-hạn-bảo-mật-còn-lại).
