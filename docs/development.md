# Phát triển và phát hành

Dành cho người sửa code FatUp. Người chỉ muốn dùng thì đọc [README](../README.md). AI agent bắt đầu từ [CLAUDE.md](../CLAUDE.md).

## Cấu trúc

```text
worker/    Cloudflare Worker (Hono) + D1 (thông tin file) + R2 (file); phục vụ luôn bản web
desktop/   App Electron (electron-vite + React + TS); giao diện React dùng chung với bản web
web/       Bản web PWA: chỉ thay lớp kết nối window.fatup, giao diện lấy từ desktop/
android/   App Android (Kotlin, project Gradle riêng): đích chia sẻ + màn hình kết nối
shared/    Kiểu dữ liệu và hằng số API dùng chung
```

Mô tả hệ thống: [SPEC.md](../SPEC.md) và [docs/spec/](spec/). Lý do các quyết định: [docs/decisions/](decisions/README.md).

## Chạy local

```bash
npm install
```

**Worker** (D1/R2 giả lập bằng Miniflare). Chép `worker/.dev.vars.example` thành `worker/.dev.vars` (chứa token dùng khi dev), rồi:

```bash
npm run dev:worker          # migrate D1 local + wrangler dev
```

**Web** (http://localhost:5173). Muốn dùng database và file thật: chép `web/.env.example` thành `web/.env.local` và điền `FATUP_SERVER=https://fatup.<tên-bạn>.workers.dev`. Vite sẽ chuyển các lệnh gọi API sang Worker đó (Worker không bật CORS nên phải qua proxy). Ở màn hình thiết lập, giữ nguyên địa chỉ `localhost:5173` và nhập token thật.

```bash
npm run dev:web
```

**Desktop.** `dev:desktop` dùng chung cấu hình với app FatUp đã cài (nối thẳng vào server thật). `dev:desktop:fresh` dùng một hồ sơ riêng trong `.dev-userdata/`; thêm `FATUP_SERVER=https://…` để điền sẵn địa chỉ server.

```bash
npm run dev:desktop
```

## Test

```bash
npm test                    # unit test của worker, desktop, web
npm run typecheck
npm run docs:check          # cảnh báo khi code đổi mà tài liệu không đổi
```

**E2E desktop** (Playwright điều khiển app đã build, dùng API giả):

```bash
npm run e2e                     # mọi vùng: setup, files, share, links, settings
npm run e2e -- links share      # chỉ các vùng này (hoặc E2E_ONLY=links,share)
npm run -w @fatup/desktop e2e:lock   # màn hình khóa trên khung điện thoại
```

Cần màn hình; trên Linux không có màn hình thì chạy qua `xvfb-run -a`. `SCREENSHOT_DIR=…` lưu ảnh chụp từng màn hình. Cách thêm vùng mới: [desktop/CLAUDE.md](../desktop/CLAUDE.md).

**Android** (cần JDK 21 và Android SDK có `platforms;android-37.0`):

```bash
cd android && ./gradlew testDebugUnitTest assembleDebug
```

## Deploy server từ máy dev

Từ thư mục gốc: `npm run release:worker` (migrate D1 trên server rồi deploy Worker kèm bản web). Hoặc từng bước: `npm run db:migrate`, rồi `npm run deploy:worker`.

## Build app máy tính

```bash
npm run build:desktop       # build vào desktop/out/
npm run dist:mac            # .dmg (cũng có dist:win, dist:linux trong desktop/)
```

## Phát hành

Push một tag `v*` thì GitHub Actions build `.dmg` (Apple Silicon), `.exe`, `.AppImage` và APK, rồi tạo một **draft release**. Bấm **Publish** thì app máy tính mới thấy bản đó.

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

Trước khi tag: cập nhật [CHANGELOG.md](../CHANGELOG.md) (kể cả mục **Nâng cấp** nếu có migration).

**Keystore Android cố định.** Không có keystore thì mỗi lần CI build APK sẽ ký bằng một key ngẫu nhiên khác nhau, và bản mới không cài đè được bản cũ. Tạo một lần:

```bash
keytool -genkeypair -v -keystore fatup.jks -alias fatup -keyalg RSA -keysize 2048 -validity 10000
```

Rồi thêm 4 secret vào repo (Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64` (giá trị của `base64 -w0 fatup.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`fatup`) và `ANDROID_KEY_PASSWORD`. Đừng commit file `.jks`.

**Biến tùy chọn của server:** `R2_QUOTA_GB` trong mục `[vars]` của `worker/wrangler.toml` đổi giới hạn mà thanh dung lượng hiển thị (mặc định 10 GB, bằng gói miễn phí của R2).
