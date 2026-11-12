# FatUp — Spec v2

Chuyển ảnh và file giữa **điện thoại Android** và **máy tính** (macOS / Ubuntu / Windows) qua một server cá nhân trên Cloudflare. Dùng cá nhân, một người dùng.

> Tài liệu này ghi lại các quyết định đã chốt. Thay đổi quyết định thì sửa file này trước, code sau.
>
> **v2** cập nhật spec v1 theo những gì đã được làm thêm trong quá trình phát triển: upload từ máy tính, bản web (PWA), chọn nhiều file, sắp xếp, **thùng rác**, **két sắt (Secret Vault)**, thanh dung lượng, dark mode, kiểm tra cập nhật. Mục [12](#12-khác-với-v1) liệt kê các điểm khác v1.

---

## 1. Tổng quan

```text
 Android (Kotlin)     Desktop (Electron)      Web (PWA)
 ┌──────────────┐     ┌────────────────┐     ┌────────────────┐
 │ Share target │     │ main process   │     │ trình duyệt    │
 │ + WorkManager│     │ (giữ token)    │     │ (token mã hóa) │
 └──────┬───────┘     └───────┬────────┘     └───────┬────────┘
        │ 1. xin URL / list / xóa / vault / usage    │
        ▼                     ▼                      ▼
              ┌────────────────────────────────────────┐
              │ Worker (Hono) + D1 (metadata)          │  ← phục vụ luôn file tĩnh của PWA
              └───────────────────┬────────────────────┘
                                  │ presigned URL (S3 SigV4)
        2. PUT / GET file + thumbnail, đi thẳng tới R2
                                  ▼
              ┌────────────────────────────────────────┐
              │ R2 bucket `fatup-files`                │
              └────────────────────────────────────────┘
```

- File **không đi qua Worker**: Worker chỉ cấp presigned URL (ký bằng `aws4fetch`) nên không dính giới hạn request body của Worker.
- Cron mỗi ngày (03:00 UTC) dọn file hết hạn, file ở thùng rác quá 30 ngày và upload dở dang (xem [mục 6](#6-vòng-đời-file-thùng-rác-và-dọn-dẹp)).

### Monorepo

```text
fatup/
├── shared/      # TS types + hằng số dùng chung (Worker, desktop, web)
├── worker/      # Cloudflare Worker: Hono + D1 + R2; public/ là bản build của web
├── desktop/     # electron-vite + React + TS
├── web/         # PWA: dùng lại UI của desktop, chỉ thay lớp `window.fatup`
├── android/     # Kotlin, Gradle (project độc lập)
└── .github/workflows/
```

npm workspaces cho `shared`, `worker`, `desktop`, `web`. `android/` là project Gradle độc lập.

---

## 2. Phạm vi

| Có | Không (để sau) |
|---|---|
| Android → cloud → desktop/web, mọi loại file, ≤ 100 MB/file | Android xem/tải lại file đã gửi |
| Desktop tải file lên từ máy (chọn file, kéo-thả) | Upload từ bản web, upload cả thư mục |
| Share nhiều file một lúc (Android) | Share text/link (schema có sẵn `kind = 'text'`) |
| Thumbnail ảnh (Android và desktop tạo) | Video thumbnail |
| Tự xóa sau 30 ngày | Lưu trữ vĩnh viễn |
| **Thùng rác** 30 ngày, khôi phục, xóa vĩnh viễn | Chia sẻ link công khai |
| **Két sắt**: che file sau PIN nhập lại mỗi lần mở | Mã hóa nội dung file (xem [mục 7](#7-bảo-mật)) |
| Chọn nhiều file, sắp xếp, xóa hàng loạt | Thư mục, nhãn, album |
| PIN 4 số khóa app; UI En/Vi; sáng/tối (theo OS hoặc tự chọn) | Nhiều người dùng |
| Bản web cài được như app (PWA) | Offline đầy đủ, đồng bộ nền |
| Thanh dung lượng R2, kiểm tra cập nhật app | Tray, notification desktop |
| Polling 60s + refresh khi focus + nút Refresh | Realtime (WebSocket) |
| Build không ký qua GitHub Actions | Code signing, store |

---

## 3. Dữ liệu (D1)

```sql
-- 0001_init.sql
CREATE TABLE files (
  id          TEXT PRIMARY KEY,           -- ULID (sort được theo thời gian)
  name        TEXT NOT NULL,              -- tên gốc
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,           -- bytes
  kind        TEXT NOT NULL CHECK (kind IN ('image','file','text')),
  has_thumb   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL CHECK (status IN ('pending','ready')),
  device      TEXT,                       -- tên thiết bị gửi, vd "Pixel 8"
  created_at  INTEGER NOT NULL            -- epoch ms, thời điểm upload hoàn tất
);

-- 0002_trash.sql
ALTER TABLE files ADD COLUMN deleted_at  INTEGER;   -- NULL = không ở thùng rác
ALTER TABLE files ADD COLUMN retain_from INTEGER;   -- đặt khi khôi phục: mốc mới để tính hạn 30 ngày

-- 0003_vault.sql
ALTER TABLE files ADD COLUMN in_vault INTEGER NOT NULL DEFAULT 0;   -- 1 = đang ở két sắt
```

- `kind = 'image'` khi `mime` bắt đầu bằng `image/`, còn lại là `'file'`.
- R2 key: `files/<id>` cho file gốc, `thumbs/<id>.jpg` cho thumbnail.
- Migration chạy theo thứ tự. Mỗi lần nâng cấp: **migrate trước, deploy sau** (code mới đọc cột mới).

---

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
| `POST` | `/files/:id/restore` | Khôi phục khỏi thùng rác: `deleted_at = NULL`, `retain_from = now`. Idempotent. Trả `FileItem` |
| `DELETE` | `/files/:id/permanent` | Xóa vĩnh viễn (R2 + D1). Chỉ cho file đang ở thùng rác, không thì `409 not_in_trash` |
| `DELETE` | `/trash` | Dọn sạch thùng rác. Trả `{ deleted }` |
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
};
```

Phân trang dùng cursor `<sortValue>_<id>`, với `sortValue` là `created_at` (danh sách thường, két sắt) hoặc `deleted_at` (thùng rác).

---

## 5. Hai tính năng riêng tư: Thùng rác và Két sắt

### 5.1 Thùng rác (Trash)

- **Xóa = chuyển vào thùng rác**, không xóa thật. Không hỏi xác nhận; thông báo "Đã chuyển N file vào thùng rác" có nút **Hoàn tác** (8 giây).
- File trong thùng rác **không mở/tải được**; phải khôi phục trước. R2 object vẫn còn nguyên cho đến khi bị xóa vĩnh viễn.
- **Khôi phục** đưa file về danh sách chính. Vì hạn 30 ngày tính từ lúc upload, một file cũ khôi phục xong có thể bị cron xóa ngay đêm đó. Để tránh, khôi phục ghi `retain_from = now` và hạn được tính từ mốc mới.
- **Xóa vĩnh viễn** và **Dọn sạch thùng rác** đều có hộp xác nhận (không hoàn tác được).
- Cron xóa vĩnh viễn file có `deleted_at < now − 30 ngày`. Trong thùng rác, file **không** bị tính hạn upload 30 ngày.
- Màn hình thùng rác: biểu tượng thùng rác trên thanh trên cùng, header "← Thùng rác", cột "Thời gian xóa", chọn nhiều file để khôi phục hoặc xóa vĩnh viễn.

### 5.2 Két sắt (Secret Vault)

Một khu vực để **cất file ra khỏi danh sách chính**, chỉ xem được sau khi nhập lại PIN.

- **Cất vào:** menu `⋮`/chuột phải hoặc thanh chọn nhiều file có "Chuyển vào Két sắt". File biến mất khỏi danh sách chính. Không có "Hoàn tác" vì muốn lấy ra phải nhập PIN.
- **Mở két:** biểu tượng két sắt cạnh thùng rác. Mỗi lần mở đều hiện màn hình nhập PIN, **kể cả khi app đang mở khóa**. Thoát ra (nút ←, mở thùng rác, bấm logo, khóa app, đăng xuất) là đóng két; lần sau phải nhập PIN lại.
- **Cơ chế (desktop):** main process giữ cờ `vaultOpen` (chỉ trong bộ nhớ, không lưu đĩa). `vaultOpen(pin)` kiểm tra PIN bằng chính hàm `tryUnlock` của màn hình khóa, nên **dùng chung giới hạn sai 5 lần / khóa 30 giây**. `listVault` chỉ chạy khi cờ bật, nếu không trả `vault_locked`. Danh sách két không được tải vào renderer khi két đang đóng. Đưa file *ra* khỏi két cũng đòi két đang mở.
- **Trong két:** xem, tải, copy ảnh, tìm kiếm, tab Tất cả/Ảnh/File, chọn nhiều file như bình thường. Có "Đưa ra khỏi Két sắt". Tải file lên khi đang mở két thì file vào thẳng két (upload xong gọi `PUT /files/:id/vault`).
- **Xóa file trong két** chuyển file vào thùng rác thường và đưa nó ra khỏi két. "Hoàn tác" khôi phục rồi đưa nó về két.
- File trong két vẫn tính vào dung lượng và vẫn hết hạn sau 30 ngày như mọi file.
- **Giới hạn quan trọng:** két sắt **không mã hóa nội dung**. Đây là lớp che ở giao diện: file vẫn nằm bình thường trên R2, và bất kỳ ai có API token (ví dụ app Android, hoặc client khác) vẫn đọc được qua API. Chỉ người dùng app desktop/web mới bị chặn bằng PIN. Mã hóa phía client (E2EE) là hướng mở rộng, chưa làm.

---

## 6. Vòng đời file, thùng rác và dọn dẹp

```text
 upload ──▶ pending ──complete──▶ ready ──DELETE──▶ ready + deleted_at ──cron (30 ngày)──▶ xóa hẳn
                │                  │  ▲                    │   ▲
                │ 24h              │  └──── restore ───────┘   │
                ▼                  │                           └── DELETE /permanent, DELETE /trash
          cron xóa                 └─ 30 ngày kể từ max(created_at, retain_from) ──▶ cron xóa
```

**Cron** (`0 3 * * *`), xóa ở cả R2 lẫn D1, gồm ba nhóm:

1. `ready`, **không** ở thùng rác, và `COALESCE(retain_from, created_at) < now − 30 ngày`.
2. `ready`, ở thùng rác, và `deleted_at < now − 30 ngày`.
3. `pending` cũ hơn 24 giờ.

---

## 7. Bảo mật

- **Token API**: chuỗi ngẫu nhiên 32 byte (base64url), lưu ở Worker secret `API_TOKEN`, so sánh constant-time. **Ai có token thì đọc/xóa được mọi file**, kể cả file trong két sắt.
- **PIN 4 số chỉ khóa UI**, không bao giờ gửi lên server.
  - Desktop: lưu `scrypt(pin, salt)` trong file config local. Sai 5 lần thì khóa 30 giây (thời điểm khóa lưu ra đĩa để restart app không lách được). Quên PIN thì "Đặt lại": xóa token + PIN, về màn setup.
  - Dùng cùng một bộ đếm cho màn hình khóa và cổng két sắt.
- **Token trên desktop** mã hóa bằng `safeStorage` của Electron, chỉ main process đọc; renderer không bao giờ thấy token, mọi request đi qua IPC. Linux không có keyring thì lưu base64.
- **Token trên Android** lưu ở `SharedPreferences` private, loại khỏi backup.
- **Token trên web (PWA)**: không có keychain, nên token được mã hóa **AES-GCM** bằng khóa dẫn xuất từ PIN (PBKDF2-SHA256, 310.000 vòng) rồi lưu `localStorage`. Mở khóa = giải mã thành công. PIN 4 số chỉ có 10.000 tổ hợp nên chỉ chống người qua đường, **không chống người đọc được dữ liệu trình duyệt**. Không dùng web trên máy dùng chung. Bộ đếm sai PIN của web nằm ở client nên chỉ mang tính nhắc nhở.
- Presigned URL hết hạn sau 15 phút (upload) hoặc 1 giờ (thumbnail/download).
- Bản web được phục vụ cùng origin với API nên **không cần CORS**.

---

## 8. Android

- **Kotlin**, `minSdk 28`, `compileSdk`/`targetSdk 37`, package `dev.fatup.app`. AGP 9 + Gradle 9.
- **Không có màn hình chính**, chỉ có:
  1. `ShareActivity` (trong suốt) nhận `ACTION_SEND` / `ACTION_SEND_MULTIPLE` với `*/*`: copy URI vào cache, enqueue `UploadWorker`, hiện toast rồi đóng. File > 100 MB bị từ chối ngay.
  2. `SetupActivity` mở khi chưa có config hoặc từ icon launcher: **Quét QR** (zxing-android-embedded) hoặc nhập tay URL + token; nút "Gửi thử" gọi `/health` có auth.
- `UploadWorker` (WorkManager, cần mạng, retry exponential backoff): tạo thumbnail (cạnh dài 400px, JPEG q80, theo EXIF) → `POST /uploads` → PUT file → PUT thumbnail → `complete` → xóa cache. Mỗi lần share là một batch; 401 dừng cả batch, 4xx khác bỏ file đó, lỗi mạng/5xx retry tối đa 8 lần.
- Notification foreground hiện tiến độ; xong hoặc lỗi thì báo.
- Android **chỉ gửi**, không xem danh sách, nên không có thùng rác/két sắt. File Android gửi lên hiện ở danh sách chính trên desktop/web.
- Chuỗi giao diện ở `values/strings.xml` (en) và `values-vi/strings.xml`.

---

## 9. Desktop (Electron)

**Stack:** electron-vite + React + TS, icon `lucide-react` (riêng icon két sắt tự vẽ SVG), CSS thuần với design token.

### 9.1 Màn hình

1. **Setup** (lần đầu): URL Worker + token → "Kiểm tra kết nối" → đặt PIN (nhập 2 lần).
2. **Khóa**: 4 ô PIN, tự submit khi đủ 4 số; "Quên PIN? Đặt lại".
3. **Chính**: danh sách file (xem dưới).
4. **Thùng rác** và **Két sắt** (cổng PIN, rồi danh sách): xem [mục 5](#5-hai-tính-năng-riêng-tư-thùng-rác-và-két-sắt).
5. **Cài đặt**: ngôn ngữ, **giao diện sáng/tối** (công tắc mặt trời/mặt trăng), server, QR kết nối Android (nhập lại PIN), đổi PIN, khóa ngay, đăng xuất, **phiên bản + kiểm tra cập nhật**.

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
- **Phím tắt:** `Ctrl/⌘+R` làm mới, `Ctrl/⌘+F` tìm, `Ctrl/⌘+U` tải lên, `Delete` chuyển file đang chọn vào thùng rác (trong thùng rác: xóa vĩnh viễn, có xác nhận).
- **Tải về**: main process tải vào `~/Downloads`, trùng tên thì thêm hậu tố (1), (2)…, xong `shell.showItemInFolder`.
- **Làm mới:** polling 60s, tự làm mới khi cửa sổ focus (cách nhau ≥ 5s) và sau mỗi thao tác.

### 9.3 Trình xem ảnh (Lightbox)

- Ảnh mở ra **vừa khung** (contain theo chiều cao/rộng của vùng xem). Zoom **10% – 800%**: nút zoom, lăn chuột, `+`/`-`, **phím ↓ phóng to, ↑ thu nhỏ**, nhấp đúp (2,5×); `0` về vừa khung. Kéo chuột để di chuyển khi đã phóng to.
- `←`/`→` chuyển ảnh, `Esc` đóng; ảnh kề được tải trước và ảnh gốc hiện đè lên thumbnail khi giải mã xong, nên không bị nháy.
- Nút ⓘ (hoặc `I`) mở bảng **Chi tiết**: tên, loại, dung lượng, kích thước ảnh, thời gian tải lên, thiết bị gửi.

### 9.4 Upload từ máy tính

- Nút **Tải lên** (hoặc `Ctrl/⌘+U`) mở hộp chọn nhiều file; hoặc **kéo-thả** vào cửa sổ. Thả thư mục thì báo "không tải thư mục lên được".
- Hàng đợi chạy ở main process, **2 file cùng lúc**, stream từ đĩa lên presigned URL (đếm byte để báo tiến độ), có hủy từng file. Thumbnail 400px JPEG q80 tạo bằng `nativeImage` (định dạng không giải mã được vẫn upload, chỉ thiếu thumbnail). Trường `device` là hostname máy.
- **Bảng tiến trình** góc dưới phải kiểu Google Drive: tên, % và dung lượng, thanh tiến độ, hủy, tick khi xong, lỗi; thu gọn/đóng được. Danh sách tự làm mới khi có file xong.
- Khóa app hoặc đăng xuất sẽ hủy các upload đang chạy. Đang mở két sắt thì upload vào thẳng két.

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
- Có bản mới → nút **Cập nhật**. **Windows (NSIS) và Linux AppImage** tự tải và cài bằng `electron-updater` (cần `latest*.yml` và `.blockmap` đính kèm trong release), hiện % tiến độ rồi tự khởi động lại. **macOS và `.deb`** chỉ mở trang release để tải tay: app chưa ký số nên macOS không cho thay app tại chỗ.
- Chỉ bản **publish** (không phải draft) mới được app nhìn thấy.

### 9.8 i18n

Dictionary `en` / `vi` tự viết (không thư viện), mặc định theo `app.getLocale()`.

### 9.9 Kiến trúc Electron

- `main/`: config store (JSON trong `userData`, ghi nguyên tử), `safeStorage`, `ApiClient` (fetch), download manager, `UploadManager`, kiểm tra cập nhật, IPC handlers.
- `preload/`: `contextBridge` expose `window.fatup.*` (một interface `FatupApi` trong `shared-ipc.ts`).
- `renderer/`: React, không có quyền Node (`contextIsolation`, `sandbox`). Thumbnail và ảnh viewer tải thẳng từ presigned URL bằng `<img>`.

---

## 10. Bản web (PWA)

- Dùng **lại toàn bộ UI của desktop**; chỉ thay lớp `window.fatup` (`web/src/browser-api.ts`) bằng `fetch` + `localStorage`. `ApiClient` dùng chung với desktop.
- Build ra `worker/public/`, được Worker phục vụ qua `[assets]`. `npm run deploy` (trong `worker/`) build web trước rồi mới deploy. Ô URL điền sẵn bằng origin hiện tại; người dùng chỉ dán token và đặt PIN.
- Cài được như app: manifest + service worker (chỉ cache app shell và asset; **không cache API, không cache presigned URL**).
- Có: xem, tải về, xóa, thùng rác, két sắt, chọn nhiều, sắp xếp, dung lượng, dark mode. **Không có:** upload, kiểm tra cập nhật, QR ghép Android.
- Tải về bằng thẻ `<a download>` (presigned URL đã có `Content-Disposition: attachment`). "Copy ảnh" cần bucket bật CORS; thiếu thì copy ảnh xem trước.
- Lưu ý bảo mật của token trên web: xem [mục 7](#7-bảo-mật).

---

## 11. Build, phát hành, triển khai, kiểm thử

### Build & phát hành

- `.github/workflows/release.yml` chạy khi push tag `v*`:
  - `desktop`: macOS (`.dmg`, x64 + arm64), Windows (`.exe` NSIS), Ubuntu (`AppImage` + `.deb`) bằng electron-builder, **không ký**. Đính kèm `latest*.yml` và `*.exe.blockmap` cho cập nhật tự động.
  - `android`: `assembleRelease`, ký bằng keystore từ secrets (`ANDROID_KEYSTORE_*`); thiếu secret thì ký bằng key debug ngẫu nhiên (bản sau không cài đè được bản trước).
  - Tạo **draft release**; phải bấm Publish thì app mới thấy bản mới.
- `.github/workflows/ci.yml` chạy khi push/PR: typecheck + test, build desktop, `assembleDebug` cho Android.

### Triển khai Cloudflare (người dùng chạy)

1. `npx wrangler login`
2. `npx wrangler r2 bucket create fatup-files`, `npx wrangler d1 create fatup` (chép `database_id` vào `worker/wrangler.toml`)
3. Trong `worker/`: `npm run db:migrate:remote`
4. Tạo R2 API token (Object Read & Write, chỉ bucket `fatup-files`), rồi `wrangler secret put R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`
5. `npm run token:new` rồi `wrangler secret put API_TOKEN`
6. `npm run deploy`

**Nâng cấp:** `npm run db:migrate:remote` rồi `npm run deploy`, theo thứ tự đó. Biến tùy chọn: `R2_QUOTA_GB` (đổi giới hạn hiển thị của thanh dung lượng). Free tier đủ dùng: R2 10 GB, Workers 100k request/ngày, D1 5 GB.

### Kiểm thử

- **Worker** (vitest + Workers pool, D1/R2 giả lập, 26 test): auth, upload/complete, phân trang; thùng rác (xóa mềm, liệt kê, khôi phục, xóa vĩnh viễn, dọn sạch); két sắt (chuyển vào/ra, validate, xóa từ két); `/usage`; cron (hạn 30 ngày, hạn thùng rác, `retain_from`).
- **Desktop** (vitest, 38 test): nhóm theo ngày, sắp xếp, ngưỡng và định dạng dung lượng, đặt tên tránh trùng, PIN lockout, i18n, `ApiClient`, so sánh version cập nhật, hàng đợi upload (server HTTP giả: stream, tiến độ, lỗi, hủy, upload vào két).
- **Web** (2 test): mã hóa token bằng PIN và quy tắc khóa sau 5 lần sai.
- **Chưa có:** test tự động cho UI (chọn nhiều file, thùng rác, két sắt, dark mode, viewer) và cho luồng nhập PIN két sắt. Script `desktop/e2e/smoke.mjs` (Playwright) viết từ v1 và **chưa được cập nhật** theo giao diện mới. Android chỉ có unit test cho logic thuần.

---

## 12. Khác với v1

| Chủ đề | v1 | v2 |
|---|---|---|
| Xóa file | Xóa ngay, có confirm | Vào thùng rác 30 ngày, khôi phục được, không confirm (có Hoàn tác) |
| Riêng tư | PIN khóa app | Thêm **Két sắt** nhập lại PIN mỗi lần mở |
| Hướng truyền | Chỉ Android → máy tính | Desktop cũng tải file lên |
| Nền tảng | Android, Electron | Thêm **bản web PWA** |
| Danh sách | Lọc theo tab, nhóm theo ngày | Thêm chọn nhiều file, xóa hàng loạt, sắp xếp |
| Viewer ảnh | ← → / Esc | Thêm zoom 10–800%, kéo, chi tiết ảnh, tải trước ảnh kề |
| Dung lượng | Không có | Thanh Store (xanh/cam/đỏ), `GET /usage` |
| Giao diện | Dark/light theo OS | Thêm công tắc sáng/tối ở Cài đặt |
| Cập nhật app | "Để sau" | Có kiểm tra cập nhật; tự cài trên Windows/AppImage |
| Dữ liệu D1 | 1 bảng, 9 cột | +3 cột qua migration `0002`, `0003` |
| API | 7 route | +7 route (xem [mục 4](#4-api-worker)) |
| Ghi chú tải về | Item đã tải hiện ✓ | Đã bỏ dấu ✓ (vẫn lưu danh sách id đã tải trong config) |

## 13. Hướng mở rộng

- Mã hóa phía client cho Két sắt (khóa dẫn xuất từ PIN/passphrase mạnh hơn), để file trong két không đọc được dù lộ token.
- Upload từ bản web; thả thư mục; tiếp tục upload bị gián đoạn.
- Android xem lại file đã gửi, có thùng rác/két sắt.
- Ký số macOS/Windows để cập nhật tự động trên mọi nền tảng.
- Test E2E cho giao diện mới; cập nhật lại ảnh chụp màn hình trong README.
