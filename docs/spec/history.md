# Lịch sử phiên bản của spec

> Một phần của [SPEC](../../SPEC.md).

Ghi lại spec đã đổi qua các phiên bản. Đây là **lịch sử**, không phải trạng thái hiện tại; chi tiết thay đổi từng bản app nằm ở [`CHANGELOG.md`](../../CHANGELOG.md).

## Các phiên bản của spec


- **v2** cập nhật spec v1 theo những gì đã được làm thêm trong quá trình phát triển: upload từ máy tính, bản web (PWA), chọn nhiều file, sắp xếp, **thùng rác**, **két sắt (Secret Vault)**, thanh dung lượng, dark mode, kiểm tra cập nhật.
- **v3** đánh dấu **Phase 1 hoàn thành** (bản `v0.1.6`): thêm **đổi tên file**, **thẻ màu (tag)** và bộ lọc theo màu, nút **Tải tất cả**, và hai màn hình khóa có hoạt họa (cổng Moria, két sắt). Mục [12](#12-khác-với-v1) liệt kê các điểm khác v1, mục [13](roadmap.md#13-lộ-trình) là lộ trình, trong đó **Phase 2** là bản web PWA đầy đủ.
- **v4** thêm **liên kết (bookmark)** vào Phase 2: chia sẻ link từ Android/PWA hoặc bấm **Thêm liên kết**, loại file mới `link` ([mục 4.1](api.md#41-liên-kết-bookmark), [9.2c](desktop-ui.md#92c-liên-kết)), không hết hạn, phân loại theo tên miền, sửa được tiêu đề và URL, xem trước tải khi mở app. Thiết kế chi tiết: `docs/superpowers/specs/2026-11-13-link-bookmarks-design.md`.
- **v5** (phát hành ở app `v0.4.2`) thêm **chia sẻ file bằng link công khai** ([mục 4.2](api.md#42-chia-sẻ-link-công-khai), [5.3](lifecycle.md#53-chia-sẻ-link-và-két-sắtthùng-rác), [9.2d](desktop-ui.md#92d-chia-sẻ-link)): chỉ đọc, hạn tùy chọn, **hết hiệu lực ngay** khi file vào Két sắt hoặc thùng rác và không bao giờ sống lại. Thiết kế chi tiết: `docs/superpowers/specs/2026-11-16-share-links-design.md`.
- **v6** (2026-11-16) không đổi nội dung: tách spec một file thành `SPEC.md` (tổng quan, phạm vi, mục lục) và các file theo vùng code trong `docs/spec/`, giữ nguyên số mục. Lịch sử và lộ trình tách khỏi trạng thái hiện tại. Số lượng test bỏ khỏi §11 vì nhanh bị cũ.
- **v7** (2026-11-17, app `0.5.0`, chưa phát hành) thay két sắt "che bằng giao diện" bằng **két sắt mã hóa phía client**: nội dung, thumbnail, tên, loại và URL được mã hóa trên máy; mở bằng **PIN két 6 số** (server đếm sai, xóa bí mật sau 10 lần); **recovery key**; **thùng rác riêng của két**; cất vào két từ danh sách chính qua cổng PIN; app cũ nhận `426 app_outdated` khi két đã thiết lập. Mục [5.2](lifecycle.md#52-két-sắt-secret-vault) được viết lại; thêm [mục 4.3](api.md#43-két-sắt-mã-hóa), [mục 7.1–7.7](security.md#71-két-sắt-mã-hóa-phía-client-e2ee), [9.11](desktop-ui.md#911-két-sắt-mã-hóa), [10.3](web.md#103-két-sắt-trên-web); migration `0009`. Thiết kế: `docs/superpowers/specs/2026-11-17-vault-e2ee-design.md`. Quyết định: [ADR 0013](../decisions/0013-ket-sat-ma-hoa-phia-client.md) (thay một phần [ADR 0006](../decisions/0006-pin-chi-khoa-giao-dien.md)) và [ADR 0015](../decisions/0015-mot-object-rieng-moi-lan-ma-hoa.md) (thay [ADR 0014](../decisions/0014-mot-nguoi-ghi-moi-muc-khi-cat-vao-ket.md)). Trong cùng v7, cách cất vào két đổi từ giữ chỗ sang **một object riêng cho mỗi lần cất** (`vault/<id>.<attempt>`, cột `enc_object`); mục vào két ngay khi bắt đầu cất, hiện đám mây mờ rồi tick xanh; cất vào két chưa thiết lập mở trình thiết lập trước; bỏ ETag.

## 12. Khác với v1

| Chủ đề | v1 | v2 |
|---|---|---|
| Xóa file | Xóa ngay, có confirm | Vào thùng rác 30 ngày, khôi phục được, không confirm (có Hoàn tác) |
| Riêng tư | PIN khóa app | Thêm **Két sắt** nhập lại PIN mỗi lần mở |
| Hướng truyền | Chỉ Android → máy tính | Desktop cũng tải file lên |
| Nền tảng | Android, Electron | Thêm **bản web PWA** (có upload, giao diện điện thoại) |
| Danh sách | Lọc theo tab, nhóm theo ngày | Thêm chọn nhiều file, xóa hàng loạt, sắp xếp |
| Viewer ảnh | ← → / Esc | Thêm zoom 10–800%, kéo, chi tiết ảnh, tải trước ảnh kề |
| Dung lượng | Không có | Thanh Store (xanh/cam/đỏ), `GET /usage` |
| Giao diện | Dark/light theo OS | Thêm công tắc sáng/tối ở Cài đặt |
| Cập nhật app | "Để sau" | Có kiểm tra cập nhật; tự cài trên Windows/AppImage |
| Dữ liệu D1 | 1 bảng, 9 cột | +4 cột qua migration `0002`, `0003`, `0004` |
| API | 7 route | +8 route (xem [mục 4](api.md#4-api-worker)) |
| Đổi tên / thẻ màu | Không có | Bút chì + popover, 7 màu, tối đa 3/file, lọc theo màu |
| Chọn nhiều file | Xóa | Thêm **Tải tất cả** |
| Màn hình khóa | Ô nhập PIN tĩnh | Cổng Moria hoạt họa; cổng két sắt với ông phù thủy |
| Ghi chú tải về | Item đã tải hiện ✓ | Đã bỏ dấu ✓ (vẫn lưu danh sách id đã tải trong config) |
| Chia sẻ link | Không có | Link công khai chỉ đọc cho từng ảnh/file, hạn tùy chọn, chết ngay khi vào Két sắt/thùng rác (migration `0008`, `/files/:id/share`, `/s/:token`) |
| Liên kết | Không có | `kind = 'link'`: share từ Android/PWA hoặc "Thêm liên kết", không hết hạn, loại theo tên miền, sửa tiêu đề/URL, xem trước tải khi mở app (migration `0005`, `POST /links`, `POST /links/:id/preview`) |
| Két sắt | Chỉ che giao diện; file vẫn đọc được bằng API token | Mã hóa phía client (FUV1 trên R2 `vault/<id>.<attempt>`); PIN két 6 số có bộ đếm trên server; recovery key; thùng rác riêng của két; app cũ nhận 426 (migration `0009`, `/vault/*`, [mục 7.1](security.md#71-két-sắt-mã-hóa-phía-client-e2ee)) |
