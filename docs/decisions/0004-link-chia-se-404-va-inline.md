# 0004. Một 404 cho mọi lý do link chết; chỉ ảnh raster được inline

- Trạng thái: Đã chốt
- Ngày: 2026-11-16
- Nguồn: `docs/superpowers/specs/2026-11-16-share-links-design.md` §4.4, §4.5, §7 (5, 6, 7)
- Phạm vi: worker

## Bối cảnh

`/s/` là bề mặt công khai duy nhất (ngoài `/health`) và chạy cùng origin với PWA. Trang báo "hết hạn" khác "đã dừng" làm lộ trạng thái; file HTML/SVG phục vụ inline có thể chạy script trên origin của app.

## Quyết định

- Mọi lý do (token sai, hết hạn, dừng, thùng rác, két, đã xóa) trả **cùng một** trang `404`.
- Chỉ `image/jpeg|png|gif|webp|avif` được inline (`?inline=1`); mọi thứ khác, kể cả SVG và HTML, là `attachment`.
- Header: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`; file thêm `Content-Security-Policy: sandbox; default-src 'none'`.
- Trang không có JS, không Open Graph, không giới hạn tần suất.

## Hệ quả

Đừng thêm thông báo lỗi riêng theo lý do, đừng nới danh sách inline, đừng thêm OG preview mà không viết ADR mới.
