# Android

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 8. Android

- **Kotlin**, `minSdk 28`, `compileSdk`/`targetSdk 37`, package `dev.fatup.app`. AGP 9 + Gradle 9.
- **Không có màn hình chính**, chỉ có:
  1. `ShareActivity` (trong suốt) nhận `ACTION_SEND` / `ACTION_SEND_MULTIPLE` với `*/*`: copy URI vào cache, enqueue `UploadWorker`, hiện toast rồi đóng. File > 100 MB bị từ chối ngay. **Share text có link** (không có file): tách link đầu tiên bằng `Links.extractUrl`, lấy tiêu đề từ `EXTRA_SUBJECT`/`EXTRA_TITLE` nếu nó không chỉ là chính link, enqueue `LinkWorker` (WorkManager, cần mạng, retry exponential, tối đa 8 lần) gọi `POST /links`. Không có link thì toast "Không tìm thấy liên kết".
  2. `SetupActivity` mở khi chưa có config hoặc từ icon launcher: **Quét QR** (zxing-android-embedded) hoặc nhập tay URL + token; nút "Gửi thử" gọi `/health` có auth.
- `UploadWorker` (WorkManager, cần mạng, retry exponential backoff): tạo thumbnail (cạnh dài 400px, JPEG q80, theo EXIF) → `POST /uploads` → PUT file → PUT thumbnail → `complete` → xóa cache. Mỗi lần share là một batch; 401 dừng cả batch, 4xx khác bỏ file đó, lỗi mạng/5xx retry tối đa 8 lần.
- Notification foreground hiện tiến độ; xong hoặc lỗi thì báo.
- Android **chỉ gửi**, không xem danh sách, nên không có thùng rác/két sắt. File Android gửi lên hiện ở danh sách chính trên desktop/web.
- Chuỗi giao diện ở `values/strings.xml` (en) và `values-vi/strings.xml`.
