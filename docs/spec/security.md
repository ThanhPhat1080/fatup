# Bảo mật

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 7. Bảo mật

- **Token API**: chuỗi ngẫu nhiên 32 byte (base64url), lưu ở Worker secret `API_TOKEN`, so sánh constant-time. **Ai có token thì đọc/xóa được mọi file**, kể cả file trong két sắt.
- **PIN 4 số chỉ khóa UI**, không bao giờ gửi lên server.
  - Desktop: lưu `scrypt(pin, salt)` trong file config local. Sai 5 lần thì khóa 30 giây (thời điểm khóa lưu ra đĩa để restart app không lách được). Quên PIN thì "Đặt lại": xóa token + PIN, về màn setup.
  - Dùng cùng một bộ đếm cho màn hình khóa và cổng két sắt.
- **Token trên desktop** mã hóa bằng `safeStorage` của Electron, chỉ main process đọc; renderer không bao giờ thấy token, mọi request đi qua IPC. Linux không có keyring thì lưu base64.
- **Token trên Android** lưu ở `SharedPreferences` private, loại khỏi backup.
- **Token trên web (PWA)**: không có keychain, nên token được mã hóa **AES-GCM** bằng khóa dẫn xuất từ PIN (PBKDF2-SHA256, 310.000 vòng) rồi lưu `localStorage`. Mở khóa = giải mã thành công. PIN 4 số chỉ có 10.000 tổ hợp nên chỉ chống người qua đường, **không chống người đọc được dữ liệu trình duyệt**. Không dùng web trên máy dùng chung. Bộ đếm sai PIN của web nằm ở client nên chỉ mang tính nhắc nhở.
- Presigned URL hết hạn sau 15 phút (upload) hoặc 1 giờ (thumbnail/download).
- **Link chia sẻ công khai**: token 192 bit không đoán được, ai có link thì xem/tải được (và chuyển tiếp được), thu hồi bằng hạn hoặc Dừng chia sẻ. Đây là bề mặt công khai duy nhất của API ngoài `/health`, giới hạn ở hai route `/s/...` chỉ đọc. Không lộ lý do khi link chết (mọi lý do cùng một `404`). Không phục vụ HTML/SVG inline trên origin của PWA ([mục 4.2](api.md#42-chia-sẻ-link-công-khai)).
- Bản web được phục vụ cùng origin với API nên API **không cần CORS**. Riêng R2 thì cần: trình duyệt PUT/GET thẳng tới presigned URL (origin khác), xem [mục 10](web.md#10-bản-web-pwa).

### 7.x Nhập ảnh từ bucket dùng lại khóa R2

Việc nhập ảnh ([api.md 4.3](api.md#43-nhập-ảnh-từ-thư-mục-của-bucket)) dùng đúng khóa R2 đang ký presigned URL (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) để liệt kê, copy và xóa object qua S3 API; không thêm secret mới. Khóa đó đã phải đủ quyền đọc/ghi bucket. `POST /import/sync` nằm sau token như mọi route; prefix `files/`, `thumbs/`, `vault/` và cả bucket bị từ chối để việc nhập không tự di chuyển file của Fatup. Ảnh nhập vào là **bản rõ** (app kia ghi bản rõ), không vào Két sắt.
