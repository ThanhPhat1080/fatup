# Quyết định kiến trúc (ADR)

Mỗi file ghi **một** quyết định: bối cảnh, quyết định, cái giá phải trả. Mục đích: người (và agent) sau này biết *vì sao* code như vậy, thay vì đoán rồi "sửa" mất một quyết định có chủ ý.

**Khi nào viết ADR**

- Một lựa chọn có nhiều cách hợp lý và cách bị loại có thể bị người sau chọn lại.
- Một "Ruling" trong sổ SDD (`.superpowers/sdd/*/progress.md`) làm đổi hành vi: sổ đó bị gitignore, nên ruling phải chép sang đây.
- Một mục "Quyết định do Claude tự đưa ra" trong design spec được người dùng duyệt hoặc bác.
- Đảo ngược một ADR cũ: viết ADR mới, sửa ADR cũ thành `Bị thay bởi NNNN`. Không xóa ADR cũ.

**Không** viết ADR cho thứ chỉ là chi tiết cài đặt (tên hàm, chia file) hay đã nằm đầy đủ trong spec (`docs/spec/`) mà không có lựa chọn thay thế đáng kể.

## Mẫu

Tên file: `NNNN-ten-ngan.md` (số tăng dần, không dùng lại).

```markdown
# NNNN. Tiêu đề là chính quyết định

- Trạng thái: Đã chốt | Đề xuất | Bị thay bởi NNNN
- Ngày: YYYY-MM-DD
- Nguồn: link tới design spec / plan / commit / ledger
- Phạm vi: worker | desktop | web | android | shared | quy trình

## Bối cảnh
Vấn đề, ràng buộc, các cách đã cân nhắc.

## Quyết định
Một đoạn ngắn, khẳng định.

## Hệ quả
Cái được, cái mất, và điều agent KHÔNG được làm vì quyết định này.
```

## Danh sách

| # | Quyết định | Phạm vi | Trạng thái |
|---|---|---|---|
| [0001](0001-ghi-quyet-dinh-bang-adr.md) | Ghi quyết định bằng ADR trong git | quy trình | Đã chốt |
| [0002](0002-file-khong-di-qua-worker.md) | File không đi qua Worker (presigned R2), trừ link chia sẻ | worker | Đã chốt |
| [0003](0003-thu-hoi-link-chia-se-bang-trigger.md) | Thu hồi link chia sẻ bằng trigger SQL | worker | Đã chốt |
| [0004](0004-link-chia-se-404-va-inline.md) | Một `404` cho mọi lý do link chết; chỉ ảnh raster được inline | worker | Đã chốt |
| [0005](0005-pwa-dung-lai-ui-desktop.md) | PWA dùng lại UI desktop, chỉ thay `window.fatup` | desktop, web | Đã chốt |
| [0006](0006-pin-chi-khoa-giao-dien.md) | PIN chỉ khóa giao diện; token web mã hóa bằng PIN | desktop, web | Đã chốt; một phần bị thay bởi 0013 |
| [0007](0007-lien-ket-la-mot-loai-file.md) | Liên kết là `kind = 'link'` trong bảng `files`; API `kind=all` không trả link | worker, shared | Đã chốt |
| [0008](0008-tat-ca-gom-lien-ket.md) | Nút "Tất cả" trên giao diện gồm cả liên kết | desktop | Đã chốt |
| [0009](0009-chi-thung-rac-het-han.md) | Chỉ file trong thùng rác mới hết hạn | worker | Đã chốt |
| [0010](0010-bo-phim-tat-them-lien-ket.md) | Không có phím tắt Ctrl/⌘+L cho "Thêm liên kết" | desktop | Đã chốt |
| [0011](0011-linkworker-khong-foreground.md) | `LinkWorker` Android là worker thường, không foreground | android | Đã chốt |
| [0012](0012-dong-bang-test-khi-sua.md) | Đóng băng file test khi làm cho test thất bại chạy qua | quy trình | Đã chốt |
| [0013](0013-ket-sat-ma-hoa-phia-client.md) | Két sắt mã hóa phía client: PIN két 6 số, bộ đếm trên server, recovery key | worker, shared, desktop, web | Đã chốt |
| [0014](0014-mot-nguoi-ghi-moi-muc-khi-cat-vao-ket.md) | Một người ghi mỗi mục khi cất vào két: giữ chỗ 2 giờ, không nhả sớm | worker, desktop, web | Bị thay bởi 0015 |
| [0015](0015-mot-object-rieng-moi-lan-ma-hoa.md) | Mỗi lần cất vào két một object riêng (`vault/<id>.<attempt>`), `enc_object` trong D1, không giữ chỗ | worker, desktop, web, shared | Đã chốt |
