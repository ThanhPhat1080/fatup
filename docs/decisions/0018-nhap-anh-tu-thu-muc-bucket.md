# 0018. Nhập ảnh từ thư mục của bucket: di chuyển, id xác định từ nguồn, mọi thao tác qua S3 API

- Trạng thái: Đã chốt
- Ngày: 2026-11-18
- Nguồn: `docs/superpowers/specs/2026-11-18-nhap-anh-tu-thu-muc-bucket-design.md` §3, §5; plan `docs/superpowers/plans/2026-11-18-nhap-anh-tu-thu-muc-bucket.md`
- Phạm vi: worker, shared, desktop, web

## Bối cảnh

Một app chụp ảnh màn hình khác, không sửa được, ghi ảnh thẳng vào bucket (thư mục `d30/`). Fatup chỉ hiện những gì có dòng trong D1, và mọi khóa R2 của nó suy ra từ id (`files/<id>`). Người dùng muốn thấy ảnh đó ở Fatup ngay, không bao giờ thấy một ảnh thành hai dòng, và xóa trong Fatup phải xóa hẳn khỏi bucket.

## Quyết định

1. **Di chuyển, không giữ tại chỗ.** Ảnh được copy sang `files/<id>` rồi bản ở thư mục nguồn bị xóa. Giữ tại chỗ cần cột mới trỏ khóa ngoài quy ước và sửa mọi chỗ lấy khóa.
2. **Id xác định từ nguồn.** ULID có thời gian là giờ upload của object và phần ngẫu nhiên từ `SHA-256(key + "\0" + etag)`; `INSERT OR IGNORE` trên khóa chính chặn dòng trùng. Không thêm cột hay migration. Phương án cột `import_key UNIQUE` tương đương nhưng cần migration.
3. **Thứ tự bất biến:** dòng `pending` → copy có điều kiện etag → kiểm kích thước → `ready` → (đọc lại etag) xóa bản gốc. Bản gốc chỉ bị xóa sau `ready`, và chỉ khi etag còn khớp (ảnh ghi đè giữa chừng được giữ lại).
4. **Mọi thao tác R2 của việc nhập qua S3 API** bằng khóa đang ký presigned URL, không qua binding `BUCKET`: `wrangler dev` giả lập một R2 riêng, khác bucket mà upload ghi vào. Copy server-side nên file không đi qua Worker (ADR 0002).
5. **Quét lười:** client gọi `POST /import/sync` khi làm mới, cách nhau ≥ 30 giây; mỗi lần tối đa 10 ảnh (4 lời gọi S3 mỗi ảnh; Worker gói miễn phí giới hạn 50 subrequest). Không cron nền, không R2 Event Notifications.
6. **Thumbnail:** desktop tạo bù; client khác hiện ảnh gốc (`thumbUrl` của ảnh chưa có thumbnail trỏ tới `files/<id>`; `FileItem.hasThumb` cho biết mục nào cần bù).
7. `IMPORT_PREFIX` đặt trong `wrangler.toml`; rỗng thì tắt; `files/`, `thumbs/`, `vault/` và cả bucket bị từ chối.

## Hệ quả

- Hai máy làm mới cùng lúc và ca nhập lại ảnh đã xóa vĩnh viễn là nợ kỹ thuật (`docs/spec/roadmap.md`).
- App kia thấy `d30/` trống dần: không dựa vào việc ảnh ở lại đó.
- Khi hợp nhất với nhánh Két sắt mã hóa phải thêm `encrypted = 0` vào ba chỗ (xem nợ kỹ thuật).
- Đừng nhập file không phải ảnh, và đừng xóa object nguồn trước khi dòng `ready`.
