# 0010. Không có phím tắt Ctrl/⌘+L cho "Thêm liên kết"

- Trạng thái: Đã chốt
- Ngày: 2026-11-13
- Nguồn: ledger SDD link-bookmarks, Task 5 (Ruling)
- Phạm vi: desktop

## Bối cảnh

Plan link-bookmarks đề xuất Ctrl/⌘+L để mở hộp "Thêm liên kết".

## Quyết định

Bỏ phím tắt này: trong PWA nó trùng phím chọn thanh địa chỉ của trình duyệt. Trong hộp liên kết: Enter lưu và hiện lý do lỗi của server ngay tại chỗ; bấm ra ngoài lưu phần hợp lệ và báo lỗi bằng toast.

## Hệ quả

Đừng thêm lại Ctrl/⌘+L (hoặc phím tắt nào trùng phím của trình duyệt) cho UI dùng chung.
