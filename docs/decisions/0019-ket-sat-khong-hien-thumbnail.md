# 0019. Két sắt không hiện thumbnail của bất kỳ mục nào

- Trạng thái: Đã chốt
- Ngày: 2026-11-18
- Nguồn: yêu cầu của người dùng ngày 2026-11-18 (không có design spec riêng); thay một phần quyết định về thumbnail trong [ADR 0013](0013-ket-sat-ma-hoa-phia-client.md)
- Phạm vi: desktop, web

## Bối cảnh

Từ bản 0.5.0, ảnh trong két được mã hóa kèm thumbnail (`vault/<id>.<attempt>.thumb`) và danh sách két tải rồi giải mã thumbnail để hiện ngay. Ảnh trong két thường là ảnh nhạy cảm: một thumbnail hiện ra ngay khi mở két là điều người dùng không muốn, và mỗi lần mở két đều tải và giải mã hàng loạt thumbnail.

## Quyết định

1. **Danh sách két không có thumbnail nào.** `createVaultCore.listVault` trả `thumbUrl: null` cho mọi mục (kể cả mục có thumbnail, kể cả mục cũ chưa mã hóa). Không tải, không giải mã, không tạo `blob:` URL nào cho thumbnail. Thẻ lưới và dòng danh sách trong két hiện biểu tượng file.
2. **`fatup-vault://thumb/<id>` luôn trả 404.** Không còn đường nào để lấy bản rõ của thumbnail từ két. `VaultViews.thumbnail` bị bỏ.
3. **Ảnh gốc chỉ được tải khi người dùng mở nó** (trình xem ảnh, Tải về, Sao chép ảnh), vẫn đòi quyền xem (PIN ở màn Két sắt, [ADR 0016](0016-phien-ket-sat-6-gio.md)).
4. **Thumbnail vẫn được tạo, mã hóa và lưu khi cất vào két** (mover, upload thẳng vào két) và vẫn đi theo mục khi lấy ra khỏi két, nên ảnh về danh sách chính có thumbnail như cũ. Không đổi định dạng lưu trữ, schema hay API.
5. **Danh sách chính không đổi.**

## Hệ quả

- Mở két nhanh hơn và gần như không tải gì ngoài danh sách; không còn giới hạn memory của `blob:` thumbnail trên web.
- Khó tìm ảnh bằng mắt trong két: phải dựa vào tên, kèm tìm kiếm và sắp xếp theo tên. Đã chấp nhận.
- Thumbnail trong két thành dữ liệu chỉ để dành cho lúc lấy ra. Nếu sau này không cần nữa thì bỏ hẳn việc tạo thumbnail khi cất vào két (đổi cả mover và hai uploader); chưa làm.
- Vài ý khác (ảnh gốc làm thumbnail, nút ẩn/hiện theo từng ảnh) đã được bàn và **chưa** làm.
