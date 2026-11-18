# Lấy file ra khỏi Két sắt: cập nhật giao diện ngay (optimistic) — plan

Người dùng yêu cầu (2026-11-18): khi lấy file hoặc ảnh ra khỏi Két sắt, giao diện đổi ngay, không chờ server. Nếu lần lấy ra **thất bại** thì xóa mục đó khỏi danh sách chính và hiện lại trong Két sắt, kèm một toast. Đơn giản thôi (đây là drive cá nhân). Đối xứng với việc cất vào két (`enteringVault` trong `Main.tsx`).

Phạm vi: chỉ renderer dùng chung desktop và web (`Main.tsx`, `lib/vault.ts`, i18n nếu cần). Không đổi API, mật mã hay core.

## Quyết định

1. Bấm "Lấy ra khỏi Két sắt" thì ngay lập tức: mục rời danh sách Két sắt và hiện ở danh sách chính (bản giả của chính mục đó, `inVault: false`, tên đã giải mã giữ nguyên).
2. Trong lúc đang lấy ra, một `refresh()` (poll, focus) đến sớm **không** được làm mục nhảy ngược: danh sách Két sắt bỏ các id đang lấy ra, danh sách chính vẫn có bản giả của chúng cho tới khi lượt lấy ra kết thúc. Ref `leavingVault` (id → mục) đối xứng với `enteringVault`.
3. Kết thúc lượt: mục thành công thì `refresh()` thay bản giả bằng bản thật. Mục **thất bại** (nằm trong `failed`, hoặc cả lượt bị từ chối) thì xóa bản giả khỏi danh sách chính và đưa mục về lại danh sách Két sắt (nếu đang ở màn Két sắt và két còn mở; nếu không thì lần `refresh()` kế tiếp sẽ nạp lại), kèm toast lỗi đã có (`movedOutOfVaultFailed({ n })`). Lỗi `locked` vẫn gọi `onLocked()`; `vault_locked` thì mục không bị đưa lại bằng tay: két đã đóng, màn khóa lo phần còn lại.
4. Mục chưa lấy ra được (`!canMoveOut`) vẫn bị bỏ qua, không đụng tới.
5. Hàm thuần trong `lib/vault.ts` (có unit test): `leavingGhost(item)` (bản giả cho danh sách chính), `withoutIds(list, ids)`, `mergeGhosts(list, ghosts)` (thêm bản giả chưa có trong danh sách, không trùng id), `restoreAfterFailedMoveOut(vaultList, failedItems)` (đưa mục lỗi về lại, không trùng).

## Task

| # | Việc | Model |
|---|---|---|
| T1 | `test-writer`: unit test cho các hàm thuần ở quyết định 5 | Haiku |
| T2 | Cài đặt hàm thuần + `removeFromVault`/`refresh` trong `Main.tsx` | Haiku |
| T3 | E2E vùng `vault`: lấy ra thành công (mục hiện ngay ở danh sách chính), lấy ra thất bại (mục về lại Két sắt + toast; cần mock có tùy chọn làm hỏng lần lấy ra) | Haiku |
| T4 | `reviewer` độc lập | Opus |
| T5 | `doc-keeper`: desktop-ui, lifecycle, CHANGELOG | Haiku |
