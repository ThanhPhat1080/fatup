# 0020. Màn khóa mặc định là cửa đơn giản nhẹ; cảnh LOTR đầy đủ bật bằng tùy chọn

- Trạng thái: Đã chốt
- Ngày: 2026-11-23
- Nguồn: [design spec](../superpowers/specs/2026-11-23-khoa-don-gian-design.md), [plan](../superpowers/plans/2026-11-23-khoa-don-gian.md); yêu cầu của người dùng ngày 2026-11-23
- Phạm vi: desktop, web

## Bối cảnh

Màn khóa app và cổng Két sắt còn giật và lag trên điện thoại, kể cả khi điện thoại đã dùng cánh cửa rút gọn `LockGate` (không có cây, đoàn người, bạch tuộc, hồ, ông phù thủy). Người dùng chấp nhận bỏ hoạt họa để lấy hiệu năng: chỉ cần ánh sáng lên nhấp nháy chậm.

Các cách đã cân nhắc:

- A. Vẽ mới bằng CSS thuần. Nhẹ nhất nhưng mất hình cửa Moria.
- B. Dùng lại `MoriaDoor`, bỏ phần nặng: không `DoorDefs` có bộ lọc phát sáng, không đá, vệt sáng hắt, lá cửa, lóe sáng, `halo`, `LockBackdrop`; chỉ một lớp sáng đổi `opacity`. **Đã chọn.**
- C. Chụp sẵn cánh cửa thành một ảnh rồi phủ lớp sáng. Chắc chắn nhẹ nhất nhưng thêm asset và có thể mờ. **Dự phòng**, nếu thử trên điện thoại thật vẫn lag.

## Quyết định

1. **Mặc định là khóa đơn giản** cho mọi thiết bị, kể cả người dùng cũ khi cập nhật. `Prefs.lotrLock` mặc định `false`; config hoặc localStorage cũ không có khóa này thì coi là `false`.
2. **Tick "Dùng khóa LOTR"** (Cài đặt, `en` "Use LOTR lock", `vi` "Dùng khóa LOTR", kèm một dòng mô tả là tắt thì nhẹ hơn) thì giữ đúng hành vi cũ: máy tính dùng cảnh Moria đầy đủ, điện thoại dùng `LockGate`, cổng Két sắt dùng ông phù thủy.
3. **Bỏ tick:** màn khóa app là `SimpleDoor` trên mọi kích thước màn hình. Cổng Két sắt dùng cùng cánh cửa, thêm chữ **VAULT** cố định (không dịch, dù người dùng viết "Vault").
4. **Chi tiết cửa đơn giản** (do Claude tự chọn, người dùng xem lại): nhịp sáng khoảng 4 giây; mở cửa mờ dần khoảng 0,3 giây rồi vào app; sai PIN chỉ lắc ô PIN, không giật đèn; cổng két mở ngay khi PIN đúng và "Quay lại" thoát ngay (không có 3,4 giây chờ); `prefers-reduced-motion` thì lớp sáng đứng yên và vào ngay.
5. Không đổi PIN, bộ đếm sai, khóa tạm, `vaultUnlock`, giữ khóa 6 giờ.

## Hệ quả

- Được: màn khóa nhẹ, không hoạt họa nhiều lớp; điện thoại không còn dùng cảnh nặng khi người dùng không chọn.
- Mất: người dùng mới không thấy cảnh Moria cho đến khi tick. Người dùng cũ thấy đổi ngay khi cập nhật, và cần tick lại nếu muốn cảnh cũ. Đã chấp nhận.
- Hiệu năng thật trên điện thoại chưa được đo (người dùng tự test). Nếu vẫn giật, làm phương án C; khi đó viết ADR mới hoặc sửa ADR này thành "Bị thay bởi NNNN".
- Agent **không được**: đưa bộ lọc (`filter`, `feGaussianBlur`), `halo`, đá, lá cửa, lóe sáng, hoặc nhiều lớp hoạt họa vào `SimpleDoor`; đổi mặc định `lotrLock` thành `true`; đưa cảnh đầy đủ trở lại làm đường mặc định mà không có ADR mới.
