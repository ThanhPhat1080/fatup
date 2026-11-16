# 0008. Nút "Tất cả" trên giao diện gồm cả liên kết

- Trạng thái: Đã chốt (thay quyết định 2 ở §6 của design spec link-bookmarks)
- Ngày: 2026-11-16
- Nguồn: `CHANGELOG.md` 0.4.2 "Đổi"; commit `d7da2db`
- Phạm vi: desktop

## Bối cảnh

Bản link-bookmarks chốt "Tất cả chỉ gồm file, link chỉ ở tab Liên kết". Khi dùng thật, người dùng muốn một chỗ thấy mọi thứ theo ngày.

## Quyết định

Nút **Tất cả** (tím, có icon) gồm ảnh, file và liên kết, xếp phẳng theo ngày, **không** nhóm theo tên miền. Ảnh / File / Liên kết vẫn chỉ hiện loại của mình. Vào Két sắt hoặc Thùng rác thì mở ở Tất cả.

## Hệ quả

Chỉ là thay đổi phía client: API vẫn giữ 0007 (`kind=all` không trả link); client gộp hai request.
