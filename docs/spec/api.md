# API (Worker)

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 4. API (Worker)

Tất cả trả JSON, lỗi có dạng `{ "error": { "code": string, "message": string } }`. Mọi route (trừ `/health`) đòi `Authorization: Bearer <token>`.

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/health` | Không cần auth. `{ ok: true }` |
| `GET` | `/me` | Client dùng để kiểm tra URL + token khi setup |
| `GET` | `/usage` | `{ usedBytes, limitBytes }`. Tổng `size` của file `ready` (**gồm cả thùng rác và két sắt**, không tính thumbnail). `limitBytes` mặc định 10 GB (free tier R2), đổi bằng biến `R2_QUOTA_GB` |
| `POST` | `/uploads` | Body `{ name, mime, size, hasThumb, device? }`. Kiểm tra `size ≤ 100MB`. Tạo row `pending`. Trả `{ id, uploadUrl, thumbUploadUrl? }` |
| `POST` | `/uploads/:id/complete` | `HEAD` R2 xác nhận object tồn tại và đúng size. `status = 'ready'`, `created_at = now`. Trả `FileItem` |
| `GET` | `/files?kind=&limit=&cursor=` | Danh sách chính: `ready`, **không ở thùng rác, không ở két sắt**. Mới nhất trước |
| `GET` | `/files?vault=1` | Danh sách trong két sắt (không gồm file đã vào thùng rác) |
| `GET` | `/files?trash=1` | Thùng rác, sắp theo thời điểm xóa (mới xóa trước). Cursor theo `deleted_at` |
| `GET` | `/files/:id/download` | `{ url }`: presigned GET có `response-content-disposition` theo tên gốc. 404 nếu file ở thùng rác |
| `DELETE` | `/files/:id` | **Chuyển vào thùng rác** (idempotent): đặt `deleted_at`, đưa ra khỏi két sắt (`in_vault = 0`). Riêng upload `pending` thì xóa hẳn |
| `POST` | `/files/:id/restore` | Khôi phục khỏi thùng rác: `deleted_at = NULL`. Idempotent. Trả `FileItem` |
| `DELETE` | `/files/:id/permanent` | Xóa vĩnh viễn (R2 + D1). Chỉ cho file đang ở thùng rác, không thì `409 not_in_trash` |
| `DELETE` | `/trash` | Dọn sạch thùng rác. Trả `{ deleted }` |
| `PATCH` | `/files/:id` | Body `{ name?, tags? }`, phải có ít nhất một. `name` là tên hiển thị mới (đã gồm phần mở rộng); `tags` là mảng tối đa 3 màu khác nhau trong `TAG_COLORS`. Chỉ sửa D1: object R2 đặt theo `id` nên đổi tên không động tới R2. Trả `FileItem` |
| `PUT` | `/files/:id/vault` | Body `{ inVault: boolean }`. Chuyển vào/ra két sắt. 404 nếu file không tồn tại hoặc đang ở thùng rác |

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
