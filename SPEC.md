# FatUp — Spec v1

Chuyển ảnh và file một chiều từ **Android → máy tính** (macOS / Ubuntu / Windows). Dùng cá nhân, một người dùng.

> Tài liệu này ghi lại các quyết định đã chốt trong buổi thiết kế. Thay đổi quyết định thì sửa file này trước, code sau.

---

## 1. Tổng quan

```
 Android (Kotlin)                Cloudflare                      Desktop (Electron)
 ┌───────────────┐   1. xin URL   ┌──────────────┐   list/xóa     ┌──────────────────┐
 │ Share target  │ ─────────────▶ │ Worker (Hono)│ ◀───────────── │ main process     │
 │ + WorkManager │ ◀───────────── │  + D1 (meta) │ ─────────────▶ │  (giữ token)     │
 └──────┬────────┘  presigned URL └──────┬───────┘  presigned URL └────────┬─────────┘
        │ 2. PUT file + thumbnail        │ binding                         │ GET file / thumb
        ▼                                ▼                                 ▼
                         ┌─────────────────────────────────┐
                         │ R2 bucket `fatup-files`         │
                         └─────────────────────────────────┘
```

- File **không đi qua Worker**: Worker chỉ cấp presigned URL (S3 SigV4, ký bằng `aws4fetch`). Nhờ vậy không dính giới hạn request body 100MB của Worker.
- Cron mỗi ngày xóa file quá **30 ngày** và các upload `pending` quá 24h.

### Monorepo

```
fatup/
├── shared/      # TS types của API (Worker và desktop cùng import)
├── worker/      # Cloudflare Worker: Hono + D1 + R2
├── desktop/     # electron-vite + React + TS
├── android/     # Kotlin, Gradle
└── .github/workflows/
```

Dùng npm workspaces cho `shared`, `worker`, `desktop`. `android/` là project Gradle độc lập.

---

## 2. Phạm vi v1

| Có | Không (để sau) |
|---|---|
| Android → Desktop, mọi loại file, ≤ 100MB/file | Desktop → Android (hai chiều) |
| Share nhiều file một lúc | Share text/link (schema có sẵn `kind = 'text'`) |
| Thumbnail ảnh (Android tạo) | Video thumbnail |
| Tự xóa sau 30 ngày, xóa tay | Lưu trữ vĩnh viễn |
| PIN 4 số khóa app desktop | Nhiều người dùng |
| UI En/Vi, dark/light theo OS | Tray, notification desktop, auto-update |
| Polling 60s + refresh khi focus + nút Refresh | Realtime (WebSocket) |
| Build không ký qua GitHub Actions | Code signing, store |

---

## 3. Bảo mật

- **Token API**: một chuỗi ngẫu nhiên 32 byte (base64url), lưu ở Worker secret `API_TOKEN`. Mọi route đều đòi `Authorization: Bearer <token>`, so sánh constant-time.
- **PIN 4 số chỉ khóa UI desktop**, không bao giờ gửi lên server.
  - Lưu `scrypt(pin, salt)` ở file config local.
  - Sai 5 lần thì khóa 30 giây (lưu thời điểm khóa ra đĩa để restart app không lách được).
  - Quên PIN thì bấm "Đặt lại", app xóa token + PIN rồi quay về màn setup.
- **Token trên desktop** được mã hóa bằng `safeStorage` của Electron và chỉ main process đọc. Renderer không bao giờ thấy token, mọi request đi qua IPC.
- **Token trên Android** lưu ở `SharedPreferences` private của app. App cá nhân, chấp nhận mức này.
- Presigned URL hết hạn sau 15 phút (upload) hoặc 1 giờ (thumbnail/download).

---

## 4. Dữ liệu (D1)

```sql
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
CREATE INDEX idx_files_ready ON files(status, created_at DESC);
```

- `kind = 'image'` khi `mime` bắt đầu bằng `image/`, còn lại là `'file'`.
- R2 key: `files/<id>` cho file gốc, `thumbs/<id>.jpg` cho thumbnail.

---

## 5. API (Worker)

Tất cả trả JSON, lỗi có dạng `{ "error": { "code": string, "message": string } }`.

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/health` | Không cần auth. `{ ok: true }` |
| `POST` | `/uploads` | Body `{ name, mime, size, hasThumb, device? }`. Kiểm tra `size ≤ 100MB`. Tạo row `pending`. Trả `{ id, uploadUrl, thumbUploadUrl? }` |
| `POST` | `/uploads/:id/complete` | `HEAD` R2 để xác nhận object tồn tại và đúng size. Đặt `status = 'ready'`, `created_at = now`. Trả `FileItem` |
| `GET` | `/files?kind=all\|image\|file&cursor=&limit=100` | Chỉ file `ready`, mới nhất trước. Trả `{ items: FileItem[], nextCursor? }` |
| `GET` | `/files/:id/download` | Trả `{ url }`: presigned GET có `response-content-disposition` theo tên gốc |
| `DELETE` | `/files/:id` | Xóa R2 (file + thumb) và row D1 |

```ts
type FileItem = {
  id: string; name: string; mime: string; size: number;
  kind: 'image' | 'file' | 'text';
  thumbUrl: string | null;   // presigned, 1h
  device: string | null;
  createdAt: number;         // epoch ms
};
```

**Cron** (`0 3 * * *`): xóa file `ready` có `created_at < now - 30 ngày` và `pending` cũ hơn 24h, ở cả R2 lẫn D1.

---

## 6. Android

- **Kotlin**, `minSdk 28` (để decode HEIC bằng `ImageDecoder`), package `dev.fatup.app`.
- **Không có màn hình chính**. Chỉ có:
  1. `ShareActivity` (trong suốt) nhận `ACTION_SEND` / `ACTION_SEND_MULTIPLE` với `*/*`. Activity copy các URI vào cache của app (vì quyền đọc URI sẽ mất khi activity đóng), enqueue một `UploadWorker` cho mỗi file, hiện toast "Đang gửi N file", rồi đóng.
  2. `SetupActivity` mở khi chưa có config, hoặc từ icon launcher. Có nút **Quét QR** (zxing-android-embedded, không phụ thuộc Google Play) hoặc nhập tay URL + token. Có nút "Gửi thử" để gọi `/health` có auth.
- `UploadWorker` (WorkManager, ràng buộc `NetworkType.CONNECTED`, retry exponential backoff):
  1. Tạo thumbnail nếu là ảnh: cạnh dài 400px, JPEG q80, có tôn trọng EXIF orientation.
  2. `POST /uploads`, rồi PUT file (OkHttp stream từ file cache), rồi PUT thumbnail, rồi `complete`.
  3. Xóa file cache khi xong.
- Notification foreground hiện tiến độ "Đang gửi 3/10". Xong thì hiện "Đã gửi 10 file", lỗi vĩnh viễn thì "Gửi thất bại: <tên>".
- File > 100MB bị từ chối ngay ở `ShareActivity`, báo bằng toast.
- Chuỗi giao diện ở `values/strings.xml` (en) và `values-vi/strings.xml`.

---

## 7. Desktop (Electron)

**Stack:** electron-vite + React + TS. Icon dùng `lucide-react`. CSS thuần với design token (không dùng UI framework).

### Màn hình

1. **Setup** (lần đầu): nhập Worker URL + token, bấm "Kiểm tra kết nối", rồi đặt PIN (nhập 2 lần).
2. **Khóa**: 4 ô PIN, tự submit khi đủ 4 số, có link "Quên PIN? Đặt lại".
3. **Chính** (minimal, tham khảo Google Drive):

```
┌──────────────────────────────────────────────────────────────┐
│ ⬆ FatUp   [ 🔍 Tìm theo tên…        ]        ↻   ▦/☰   ⚙   │
│ ( Tất cả )( Ảnh )( File )                                    │
├──────────────────────────────────────────────────────────────┤
│ Hôm nay                                                      │
│ ┌─────┐ ┌─────┐ ┌─────┐                                       │
│ │ img │ │ img │ │ PDF │   …   (lưới)                          │
│ └─────┘ └─────┘ └─────┘                                       │
│ Hôm qua                                                      │
│ 📄 report.pdf          2.1 MB   Pixel 8   14:02    ⋮  (list)  │
└──────────────────────────────────────────────────────────────┘
```

- Tab **Tất cả / Ảnh / File**. Mặc định tab Ảnh là lưới, tab Tất cả và File là list. Nút ▦/☰ đổi chế độ cho tab hiện tại (nhớ trong config).
- Ô tìm kiếm lọc theo tên phía client trong danh sách đã tải.
- Nhóm theo ngày: "Hôm nay", "Hôm qua", rồi `dd/MM/yyyy` (en: "Today", "Yesterday", `MMM d, yyyy`).
- **Click ảnh** mở lightbox (← → để chuyển, Esc để đóng). **Click file khác** thì tải về.
- Menu `⋮` / chuột phải gồm: **Tải về**, **Copy ảnh** (chỉ có với ảnh), **Xóa** (có confirm).
- **Tải về**: main process tải vào `~/Downloads`, trùng tên thì thêm ` (1)`, ` (2)`…, xong gọi `shell.showItemInFolder`. Item đã tải về hiện ✓ (danh sách id lưu local trên từng máy).
- Refresh: polling 60s, tự refresh khi cửa sổ focus, nút ↻ (xoay khi đang tải).
- Trạng thái rỗng: minh họa nhỏ + "Share file từ Android để bắt đầu".
- **⚙ Cài đặt**: ngôn ngữ (Tự động / English / Tiếng Việt), **QR kết nối Android** (phải nhập lại PIN mới hiện), đổi PIN, khóa ngay, đăng xuất (xóa token).

### Theme

- Màu định nghĩa bằng CSS custom properties trên `:root`, có bộ dark dưới `@media (prefers-color-scheme: dark)`. Mọi nền nút, hover, icon đều dùng token, không hard-code màu.
- Nút icon tròn 36px, hover có nền `--surface-hover`, tab dạng chip giống Drive.
- Font hệ thống (`system-ui`).

### i18n

Một dictionary `en` / `vi` tự viết (không cần thư viện). Mặc định theo `app.getLocale()`.

### Kiến trúc Electron

- `main/`: config store (JSON trong `userData`), `safeStorage`, API client (fetch), download manager, IPC handlers.
- `preload/`: `contextBridge` expose `window.fatup.{setup, unlock, list, download, copyImage, remove, settings…}`.
- `renderer/`: React, không có quyền Node (`contextIsolation: true`, `sandbox: true`).
- Thumbnail và ảnh trong lightbox load trực tiếp từ presigned URL bằng `<img>`. CSP cho phép `img-src` từ `*.r2.cloudflarestorage.com`.

---

## 8. Build & phát hành

- `.github/workflows/release.yml` chạy khi push tag `v*`:
  - `desktop`: matrix `macos-latest` (`.dmg`), `windows-latest` (`.exe` NSIS), `ubuntu-latest` (`AppImage` + `.deb`) bằng electron-builder, **không ký**.
  - `android`: `./gradlew assembleRelease`, ký bằng keystore lấy từ GitHub secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Thiếu secret thì build debug APK.
  - Đẩy artifact vào GitHub Release (dạng draft).
- `.github/workflows/ci.yml` chạy khi push/PR: typecheck + test cho worker và desktop, `assembleDebug` cho Android.

Cài lần đầu:
- **macOS**: chuột phải → Open, hoặc chạy `xattr -cr /Applications/FatUp.app`.
- **Windows**: SmartScreen cảnh báo, chọn "More info" → "Run anyway".

---

## 9. Triển khai Cloudflare (người dùng chạy)

1. `npx wrangler login`
2. `npx wrangler r2 bucket create fatup-files`
3. `npx wrangler d1 create fatup`, chép `database_id` vào `worker/wrangler.toml`
4. `npm run -w worker db:migrate:remote`
5. Tạo **R2 API token** (quyền Object Read & Write, chỉ cho bucket `fatup-files`) trong dashboard, rồi:
   `wrangler secret put R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`
6. `npm run -w worker token:new` in ra token mới, rồi `wrangler secret put API_TOKEN`
7. `npm run -w worker deploy` in ra URL `https://fatup.<subdomain>.workers.dev`

Có thể nằm trong free tier: R2 10GB lưu trữ, Workers 100k request/ngày, D1 5GB.

---

## 10. Kiểm thử

- **Worker**: vitest + `@cloudflare/vitest-pool-workers` (D1/R2 giả lập). Test auth, giới hạn size, flow upload → complete → list → download → delete, cron cleanup, phân trang.
- **Desktop**: vitest cho logic thuần (nhóm theo ngày, đặt tên tránh trùng, PIN lockout, i18n). Có smoke test Playwright `_electron`: setup → khóa → mở khóa → thấy danh sách (Worker chạy `wrangler dev` local).
- **Android**: unit test cho tính kích thước thumbnail và phân loại kind. Phần build/test trên thiết bị chạy qua CI hoặc Android Studio, vì môi trường dev cloud không có Android SDK.

## 11. Thứ tự làm

1. `shared/` + `worker/` (kèm test)
2. `desktop/`
3. `android/`
4. CI/release workflows + README hướng dẫn deploy
