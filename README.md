# FatUp

Gửi ảnh và file từ **điện thoại Android** sang **máy tính** (macOS, Ubuntu, Windows) chỉ bằng nút **Chia sẻ**. Dành cho dùng cá nhân.

| Danh sách (sáng) | Lưới ảnh (tối) |
|---|---|
| ![](docs/screenshots/list-light.png) | ![](docs/screenshots/grid-dark.png) |
| **Xem ảnh** | **Kết nối Android bằng QR** |
| ![](docs/screenshots/lightbox.png) | ![](docs/screenshots/settings-qr.png) |

- Android: chọn ảnh/file → **Chia sẻ → FatUp**. Mất mạng thì app xếp hàng rồi tự gửi lại.
- Máy tính: mở app, nhập **PIN 4 số**. File xếp mới nhất lên đầu, nhóm theo ngày, chia tab **Tất cả / Ảnh / File**.
- File tự xóa sau **30 ngày**. Giới hạn **100 MB/file**.
- Giao diện En/Vi, sáng/tối theo hệ điều hành.

Thiết kế chi tiết nằm ở [SPEC.md](SPEC.md).

## Cấu trúc

```
worker/    Cloudflare Worker (Hono) + D1 (metadata) + R2 (file)
desktop/   App Electron (electron-vite + React + TS)
android/   App Android (Kotlin, chỉ có share target + màn hình kết nối)
shared/    Kiểu dữ liệu API dùng chung
```

File đi thẳng giữa thiết bị và R2 qua presigned URL. Worker chỉ cấp URL và lưu metadata.

---

## 1. Deploy server (Cloudflare, miễn phí)

Cần tài khoản Cloudflare và Node 22.

> **Lưu ý:** từ bước 2 trở đi, mọi lệnh đều chạy **trong thư mục `worker/`** (trừ khi có ghi khác). Chạy ở thư mục gốc sẽ báo lỗi `Missing script`.

### Bước 1. Tải code và cài thư viện

```bash
git clone https://github.com/ThanhPhat1080/fatup && cd fatup
```

```bash
npm install
```

### Bước 2. Đăng nhập Cloudflare

```bash
cd worker
```

```bash
npx wrangler login
```

Trình duyệt sẽ mở ra, bạn bấm **Allow**.

### Bước 3. Tạo bucket R2 (nơi chứa file)

```bash
npx wrangler r2 bucket create fatup-files
```

### Bước 4. Tạo database D1 (nơi lưu metadata)

```bash
npx wrangler d1 create fatup
```

Lệnh in ra một đoạn có dòng `database_id = "xxxxxxxx-xxxx-…"`. Copy chuỗi UUID đó, mở file `worker/wrangler.toml` và thay vào dòng `database_id` (đang là chuỗi mẫu `00000000-…`):

```toml
[[d1_databases]]
binding = "DB"
database_name = "fatup"
database_id = "dán-id-của-bạn-vào-đây"
```

Sau đó tạo các bảng trong database:

```bash
npm run db:migrate:remote
```

Khi wrangler hỏi xác nhận, gõ `y`.

### Bước 5. Tạo R2 API token

Token này để Worker ký presigned URL.

1. Vào Dashboard → **R2** → **Manage API tokens** → **Create API token**.
2. Chọn quyền **Object Read & Write**, giới hạn vào bucket `fatup-files`.
3. Sau khi tạo, giữ lại 3 giá trị: *Access Key ID*, *Secret Access Key* và *Account ID* (Account ID nằm trong URL dashboard hoặc trang R2). Secret Access Key chỉ hiện một lần.

### Bước 6. Lưu 3 giá trị trên thành secret

Mỗi lệnh dưới đây có phần tên secret cố định (`R2_ACCESS_KEY_ID`…), bạn gõ nguyên như vậy. Sau khi bấm Enter, wrangler hỏi `Enter a secret value:`, lúc đó bạn dán **giá trị** tương ứng rồi Enter. Khi dán, màn hình không hiện ký tự nào, đó là bình thường.

```bash
npx wrangler secret put R2_ACCESS_KEY_ID
```
→ dán *Access Key ID*

```bash
npx wrangler secret put R2_SECRET_ACCESS_KEY
```
→ dán *Secret Access Key*

```bash
npx wrangler secret put R2_ACCOUNT_ID
```
→ dán *Account ID*

Nếu wrangler hỏi có muốn tạo Worker mới không, chọn **Yes**.

### Bước 7. Tạo token đăng nhập của riêng bạn

Đây là "mật khẩu" để app máy tính và app Android nói chuyện với server. Lệnh dưới in ra một chuỗi ngẫu nhiên, hãy cất kỹ chuỗi này:

```bash
npm run token:new
```

Rồi lưu nó thành secret `API_TOKEN` (dán chuỗi vừa tạo khi được hỏi giá trị):

```bash
npx wrangler secret put API_TOKEN
```

### Bước 8. Deploy

```bash
npm run deploy
```

Lệnh in ra URL kiểu `https://fatup.<tên-bạn>.workers.dev`. Kiểm tra nhanh:

```bash
curl https://fatup.<tên-bạn>.workers.dev/health
```

Kết quả đúng là `{"ok":true}`. Cron xóa file cũ chạy lúc 03:00 UTC mỗi ngày.

### Bước 9. Dùng bản web (PWA)

`npm run deploy` build luôn bản web và đẩy lên cùng Worker, nên không cần deploy thêm gì. Mở `https://fatup.<tên-bạn>.workers.dev` trên trình duyệt (điện thoại hay máy tính đều được):

1. Ô URL đã điền sẵn, bạn chỉ cần dán token (chuỗi tạo ở bước 7) rồi đặt PIN 4 số.
2. Cài như một app: Chrome/Edge chọn **Install app**, Safari (iPhone) chọn **Share → Add to Home Screen**.

Bản web xem, tải về và xóa file giống app máy tính, nhưng không có phần cập nhật và ghép QR cho Android.

**Lưu ý bảo mật:** token được mã hóa bằng PIN rồi lưu trong trình duyệt. PIN 4 số chỉ là khóa che màn hình, không chống được người có quyền truy cập vào dữ liệu trình duyệt của bạn. Đừng dùng bản web trên máy dùng chung.

**Nút "Copy ảnh"** trên web cần bucket R2 cho phép CORS. Nếu không cấu hình, nút này sẽ dùng ảnh xem trước thay cho ảnh gốc. Việc này không bắt buộc.

## 2. Cài app máy tính

Tải bản cài trong mục [Releases](https://github.com/ThanhPhat1080/fatup/releases), hoặc tự build (xem phần 5).

- **macOS** (`.dmg`): app không được ký, nên lần đầu phải chuột phải → **Open**. Nếu báo "app bị hỏng", chạy:

  ```bash
  xattr -cr /Applications/FatUp.app
  ```

- **Windows** (`.exe`): SmartScreen sẽ cảnh báo, chọn **More info → Run anyway**.
- **Ubuntu**: dùng file `.deb` (`sudo apt install ./FatUp-*.deb`) hoặc `AppImage` (`chmod +x` rồi chạy).

Lần đầu mở app: dán **URL Worker** và **API token** → **Tiếp** → đặt **PIN 4 số**. Mỗi máy có PIN riêng. Quên PIN thì bấm "Quên PIN? Đặt lại" rồi nhập lại token.

## 3. Cài app Android

Tải file `FatUp-*-android.apk` trong Releases và cài (Android 9 trở lên; cần cho phép "cài từ nguồn không xác định").

Kết nối: trên máy tính vào **⚙ Cài đặt → Kết nối Android**, nhập PIN để hiện mã QR. Trên điện thoại mở FatUp → **Quét mã QR**. Cách khác là quét QR bằng camera của máy, link `fatup://` sẽ tự mở app.

Gửi file: ở bất kỳ app nào, chọn ảnh/file → **Chia sẻ → FatUp**.

## 4. Phát triển local

```bash
npm install
```

Worker (D1/R2 giả lập bằng Miniflare). Trước khi chạy dev, chép `worker/.dev.vars.example` thành `worker/.dev.vars`:

```bash
npm run -w @fatup/worker db:migrate:local
```

```bash
npm run -w @fatup/worker dev
```

Desktop:

```bash
npm run -w @fatup/desktop dev
```

Web (PWA, dùng chung giao diện với desktop, chạy ở http://localhost:5173 và nối vào server bạn nhập):

```bash
npm run -w @fatup/web dev
```

Test:

```bash
npm test
```

```bash
npm run -w @fatup/desktop e2e
```

Lệnh `e2e` build app rồi điều khiển nó bằng Playwright, dùng một API giả. Trên Linux không có màn hình thì chạy qua `xvfb-run -a`. Đặt biến `SCREENSHOT_DIR=…` để lưu ảnh chụp từng màn hình.

Android (cần JDK 21 và Android SDK có `platforms;android-37.0`):

```bash
cd android && ./gradlew testDebugUnitTest assembleDebug
```

## 5. Phát hành

Push một tag, GitHub Actions sẽ build `.dmg` (Intel và Apple Silicon), `.exe`, `AppImage`, `.deb` và APK, rồi tạo **draft release**:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

**Nên tạo keystore Android cố định.** Nếu không, mỗi lần CI build APK sẽ được ký bằng một key ngẫu nhiên khác nhau, và bản mới sẽ không cài đè được lên bản cũ. Tạo keystore một lần:

```bash
keytool -genkeypair -v -keystore fatup.jks -alias fatup -keyalg RSA -keysize 2048 -validity 10000
```

Sau đó thêm 4 secret vào repo (Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64` (giá trị của `base64 -w0 fatup.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`fatup`) và `ANDROID_KEY_PASSWORD`. Đừng commit file `.jks`.

## Bảo mật (tóm tắt)

- Mọi request API đều cần token dài 32 byte. PIN 4 số chỉ khóa giao diện trên máy tính và không bao giờ rời khỏi máy.
- Token trên máy tính được mã hóa bằng keychain của hệ điều hành (Electron `safeStorage`). Trên Linux không có keyring thì app lưu dạng base64.
- Token trên Android nằm trong storage riêng của app và bị loại khỏi backup.
- Ai có token thì đọc được file của bạn. Lộ token thì tạo token mới bằng `npm run token:new` và `wrangler secret put API_TOKEN`, rồi kết nối lại các thiết bị.
