# 0007. Liên kết là `kind = 'link'` trong bảng `files`; API `kind=all` không trả link

- Trạng thái: Đã chốt
- Ngày: 2026-11-13
- Nguồn: `docs/superpowers/specs/2026-11-13-link-bookmarks-design.md` §3, §6 (1, 3, 4); ledger link-bookmarks
- Phạm vi: worker, shared

## Bối cảnh

Bookmark cần thùng rác, két sắt, thẻ màu, đổi tên giống file. Client cũ (app desktop/Android chưa cập nhật) không biết loại `link`.

## Quyết định

- Link là một dòng trong `files` với `kind = 'link'`, cột `url`, không có object R2, không hết hạn.
- `GET /files?kind=all` **loại** link (trừ trong thùng rác) để client cũ không vỡ. Client mới gọi thêm `kind=link` và gộp (`ApiClient.list`). Ruling SDD: chấp nhận thêm một request.
- Phân loại tên miền (`siteOf`) tính ở client từ URL, không có cột `site`.
- `POST /links` với URL đã có (ngoài thùng rác) trả bản cũ (`200` thay vì `201`), không tạo bản sao. Đổi URL của một link thành URL đã có (`PATCH`) thì bị `409 duplicate_url`.

## Hệ quả

Đừng "sửa" `kind=all` để trả link: sẽ làm vỡ client cũ. Muốn đổi thì cần ADR mới và một mốc ngừng hỗ trợ client cũ.
