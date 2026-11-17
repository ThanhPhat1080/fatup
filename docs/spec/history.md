# Lịch sử phiên bản của spec

> Một phần của [SPEC](../../SPEC.md).

Ghi lại spec đã đổi qua các phiên bản. Đây là **lịch sử**, không phải trạng thái hiện tại; chi tiết thay đổi từng bản app nằm ở [`CHANGELOG.md`](../../CHANGELOG.md).

## Các phiên bản của spec


- **v2** cập nhật spec v1 theo những gì đã được làm thêm trong quá trình phát triển: upload từ máy tính, bản web (PWA), chọn nhiều file, sắp xếp, **thùng rác**, **két sắt (Secret Vault)**, thanh dung lượng, dark mode, kiểm tra cập nhật.
- **v3** đánh dấu **Phase 1 hoàn thành** (bản `v0.1.6`): thêm **đổi tên file**, **thẻ màu (tag)** và bộ lọc theo màu, nút **Tải tất cả**, và hai màn hình khóa có hoạt họa (cổng Moria, két sắt). Mục [12](#12-khác-với-v1) liệt kê các điểm khác v1, mục [13](roadmap.md#13-lộ-trình) là lộ trình, trong đó **Phase 2** là bản web PWA đầy đủ.
- **v4** thêm **liên kết (bookmark)** vào Phase 2: chia sẻ link từ Android/PWA hoặc bấm **Thêm liên kết**, loại file mới `link` ([mục 4.1](api.md#41-liên-kết-bookmark), [9.2c](desktop-ui.md#92c-liên-kết)), không hết hạn, phân loại theo tên miền, sửa được tiêu đề và URL, xem trước tải khi mở app. Thiết kế chi tiết: `docs/superpowers/specs/2026-11-13-link-bookmarks-design.md`.
- **v5** (phát hành ở app `v0.4.2`) thêm **chia sẻ file bằng link công khai** ([mục 4.2](api.md#42-chia-sẻ-link-công-khai), [5.3](lifecycle.md#53-chia-sẻ-link-và-két-sắtthùng-rác), [9.2d](desktop-ui.md#92d-chia-sẻ-link)): chỉ đọc, hạn tùy chọn, **hết hiệu lực ngay** khi file vào Két sắt hoặc thùng rác và không bao giờ sống lại. Thiết kế chi tiết: `docs/superpowers/specs/2026-11-16-share-links-design.md`.
- **v6** (2026-11-16) không đổi nội dung: tách spec một file thành `SPEC.md` (tổng quan, phạm vi, mục lục) và các file theo vùng code trong `docs/spec/`, giữ nguyên số mục. Lịch sử và lộ trình tách khỏi trạng thái hiện tại. Số lượng test bỏ khỏi §11 vì nhanh bị cũ.

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
