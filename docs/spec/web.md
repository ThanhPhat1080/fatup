# Bản web (PWA)

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 10. Bản web (PWA)

- Dùng **lại toàn bộ UI của desktop**; chỉ thay lớp `window.fatup` (`web/src/browser-api.ts`) bằng `fetch` + `localStorage`. `ApiClient` dùng chung với desktop. Giao diện trên điện thoại giống hệt desktop, chỉ xếp lại bố cục.
- Build ra `worker/public/`, được Worker phục vụ qua `[assets]`. `npm run deploy` (trong `worker/`) build web trước rồi mới deploy. Ô URL điền sẵn bằng origin hiện tại; người dùng chỉ dán token và đặt PIN.
- Cài được như app: manifest + service worker (chỉ cache app shell và asset; **không cache API, không cache presigned URL**).
- Có: xem, **upload**, tải về, đổi tên, thẻ màu, xóa, thùng rác, két sắt, chọn nhiều, sắp xếp, dung lượng, dark mode. **Không có:** kiểm tra cập nhật (web tự cập nhật qua service worker), QR ghép Android.
- Tải về bằng thẻ `<a download>` (presigned URL đã có `Content-Disposition: attachment`).
- **CORS của R2 là bắt buộc để upload** (`npm run r2:cors` áp dụng `worker/r2-cors.json`: `GET`, `HEAD`, `PUT`, header `content-type`, và lộ header `ETag`). Thiếu thì upload báo lỗi mạng. "Copy ảnh" cũng cần CORS; thiếu thì copy ảnh xem trước. Thiếu `ETag` thì cất vào két lỗi `no_etag` ([mục 10.3](#103-két-sắt-trên-web)).
- Lưu ý bảo mật của token trên web: xem [mục 7](security.md#7-bảo-mật).

- **Nhận link từ Chia sẻ (Web Share Target):** manifest có `share_target` (`GET /` với `title`, `text`, `url`). Android Chrome thường để link trong `text`, nên `takeSharedLink` (`web/src/share.ts`) ưu tiên `url` rồi tách link từ `text`. Link được giữ trong `sessionStorage` **qua màn hình khóa PIN** (token chỉ giải mã được sau PIN), thanh địa chỉ được dọn, và khi app mở khóa thì gọi `addLink`, hiện toast và chuyển sang tab Liên kết. Chia sẻ không có link thì toast báo không tìm thấy. Android cập nhật mục Chia sẻ của PWA đã cài khá chậm (tới ~1 ngày), có thể phải cài lại PWA.

### 10.1 Upload từ web

- `WebUploadManager` (`web/src/uploader.ts`) cùng giao diện hàng đợi với `UploadManager` của desktop nên **bảng tiến trình dùng chung**: 2 file cùng lúc, tiến độ, hủy từng file, tick khi xong. Luồng `POST /uploads` → PUT file → PUT thumbnail → `complete`. Khi đang mở két, file và thumbnail được mã hóa trong trang và `POST /uploads` gửi kèm `vault: { encMeta, encKey }`; không gọi `PUT /files/:id/vault` ([mục 4.3](api.md#43-két-sắt-mã-hóa)).
- File lấy từ `<input type="file" multiple>` (nút Tải lên, trên Android có cả chụp ảnh) hoặc kéo-thả. Vì File của trình duyệt không có đường dẫn, "paths" của bridge là **handle** `web:N` trỏ vào một bảng File trong bộ nhớ.
- PUT bằng `XMLHttpRequest` (fetch không báo tiến độ upload). Thumbnail 400px JPEG q80 vẽ bằng canvas (`createImageBitmap`, theo EXIF); định dạng trình duyệt không giải mã được (HEIC...) vẫn upload, chỉ thiếu thumbnail.
- `device` là `Trình duyệt · Hệ điều hành` từ User-Agent. File > 100 MB bị từ chối ngay. Khóa app hoặc đăng xuất hủy các upload đang chạy.
- **Giới hạn:** upload chạy trong trang, nên đóng tab hoặc để trình duyệt ngủ thì dừng; không tiếp tục được upload dở.

### 10.2 Giao diện điện thoại

- Thanh trên: hàng 1 là logo, thanh Store và các nút (Tải lên, két sắt, thùng rác, cài đặt), hàng 2 là ô tìm kiếm. Lưới 2 cột, nút bấm tối thiểu 40–44px, tôn trọng safe-area của tai thỏ, chiều cao theo `dvh`.
- Không có hover nên: bút chì ở lưới luôn hiện; **giữ lâu 450ms** một file để chọn (rung nhẹ), đã có file được chọn thì **chạm** để chọn/bỏ chọn. Chuột và bút cảm ứng giữ hành vi cũ.
- Trình xem ảnh: ẩn nút zoom và mũi tên; **chụm hai ngón** để zoom, **vuốt ngang** chuyển ảnh, **vuốt xuống** đóng; bảng Chi tiết trượt từ đáy.
- Màn hình khóa dọc: cảnh 16:9 được cắt vào giữa cổng (rộng 140% chiều cao màn hình) để ô PIN đủ lớn; Gollum nằm ngoài khung hình trên điện thoại.

### 10.3 Két sắt trên web

- Cùng két và cùng giao diện với desktop ([9.11](desktop-ui.md#911-két-sắt-mã-hóa)). Khóa, mã hóa và giải mã chạy trong trang, bằng `VaultSession`, lõi `createVaultCore`, `createVaultMover` (dùng chung với desktop) và WebCrypto trong `shared/`; mã nguồn: `web/src/vault-web.ts`.
- `MK` và tên đã giải mã chỉ nằm trong bộ nhớ JS. **Không ghi** vào `localStorage`, IndexedDB hay Cache Storage, và mục két không đi vào kho ảnh xem trước. Service worker không cache API, presigned URL hay `/s/`.
- Ảnh và file trong két hiện qua **`blob:` URL** làm từ byte đã giải mã. Đóng két (khóa app, đăng xuất, bấm logo, nút đóng két) thu hồi **mọi** `blob:` URL ngay lập tức, đồng bộ, và xóa khóa khỏi bộ nhớ. Đóng tab cũng mất khóa; mở lại cần PIN.
- **Giới hạn bộ nhớ:** file được mã hóa và giải mã **trong bộ nhớ** trên mọi trình duyệt, nên giới hạn là `MAX_FILE_SIZE` = 100 MB. Không ghi luồng xuống đĩa và không dùng `showSaveFilePicker`. Tải về đi qua `<a download>`.
- **CORS của R2** phải lộ header `ETag` (xem đầu mục 10). Cất vào két đọc `ETag` của lần PUT; thiếu header này thì báo `no_etag`.
- **Khác với desktop:** khi két chưa thiết lập, "Chuyển vào Két sắt" trên web báo `vault_locked` và không chuyển file. Desktop thì chuyển như cũ ([mục 5.2](lifecycle.md#52-két-sắt-secret-vault)). Hai hành vi chưa thống nhất ([Nợ kỹ thuật](roadmap.md#nợ-kỹ-thuật)).
