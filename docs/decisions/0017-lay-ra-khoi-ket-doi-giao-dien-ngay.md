# 0017. Lấy ra khỏi Két sắt đổi giao diện ngay: bản giả trong danh sách chính

- Trạng thái: Đã chốt
- Ngày: 2026-11-18
- Nguồn: plan `docs/superpowers/plans/2026-11-18-vault-lay-ra-optimistic.md` (quyết định 1–5); yêu cầu của người dùng ngày 2026-11-18 (không có design spec riêng); đối xứng với cất vào két (`enteringVault` trong `Main.tsx`, [mục 5.2](../spec/lifecycle.md#52-két-sắt-secret-vault))
- Phạm vi: desktop, web

## Bối cảnh

Trước đây, bấm "Đưa ra khỏi Két sắt" thì file vẫn nằm trong danh sách két cho tới khi server trả lời xong (tải về, giải mã, tải lên, complete). Lượt này mất vài giây và người dùng thấy file chưa đi đâu. Người dùng yêu cầu giao diện đổi ngay, như khi cất vào két.

Vấn đề kỹ thuật: làm mới (poll, focus, nút làm mới) có thể trả về trong lúc lượt đang chạy, và câu trả lời của một làm mới cũ có thể kéo mục trở lại chỗ cũ hoặc ghi đè trạng thái mới hơn.

Các phương án đã cân nhắc:

- **Giữ chờ server rồi mới đổi giao diện** (cách cũ): loại theo yêu cầu của người dùng.
- **Bản giả giữ địa chỉ ảnh thu nhỏ của két** (`fatup-vault://` hoặc `blob:`): loại. Hai địa chỉ này bị thu hồi khi rời màn Két sắt ([ADR 0016](0016-phien-ket-sat-6-gio.md) mục 6), nên người dùng rời màn đó giữa lượt thì ảnh vỡ. Bản giả vì vậy không có ảnh thu nhỏ và hiện icon loại file.
- **Bộ đếm thế hệ cho làm mới:** chọn. Câu trả lời của làm mới đã bị một làm mới mới hơn thay thế thì bị bỏ, và chỉ làm mới mới hơn tắt cờ đang tải.

## Quyết định

1. Khi bấm "Đưa ra khỏi Két sắt", các mục đã chọn (chỉ mục lấy ra được) rời danh sách két ngay và hiện ở danh sách chính như bản giả: `inVault: false`, tên đã giải mã giữ nguyên, không có ảnh thu nhỏ.
2. Ref `leavingVault` (id → mục gốc) giữ các mục đang lấy ra tới khi lượt kết thúc. Làm mới trong lúc đó bỏ các id này khỏi danh sách két và giữ bản giả trong danh sách chính, nên mục không nhảy ngược.
3. Kết thúc lượt:
   - Thành công: làm mới thay bản giả bằng mục thật. Toast "Đã đưa N file ra khỏi Két sắt" hiện khi lượt xong.
   - Thất bại (mục nằm trong `failed`, hoặc cả lượt bị từ chối): bản giả bị bỏ khỏi danh sách chính. Mục được đưa lại vào danh sách két chỉ khi két đang mở và người dùng đang xem két; không thì làm mới kế tiếp nạp lại từ server. Toast lỗi hiện như trước.
   - Lỗi `locked` và `vault_locked`: không đưa lại bằng tay, vì két đã đóng. `locked` còn gọi `onLocked()`.
4. Mỗi làm mới có số thế hệ; câu trả lời của làm mới đã bị một làm mới mới hơn thay thế thì bị bỏ.
5. Hàm thuần trong `lib/vault.ts` (có unit test): `leavingGhost`, `withoutIds`, `mergeGhosts`, `restoreAfterFailedMoveOut`.

## Hệ quả

**Được:** lấy ra có cảm giác tức thì; làm mới ở giữa lượt không làm mục nhảy; lượt lỗi không để lại mục "ma" trong danh sách chính.

**Chấp nhận (ghi rõ, không phải lỗi bị bỏ sót):**

a. Trong vài giây của lượt, bản giả trong danh sách chính vẫn bấm được (mở, đổi tên, xóa, cất vào két) và trả lỗi khó hiểu, vì server còn ghi mục là trong két. Ghi nhận trong [Nợ kỹ thuật](../spec/roadmap.md#nợ-kỹ-thuật).
b. Tên đã giải mã của bản giả nằm trong bộ nhớ của danh sách chính suốt lượt, kể cả sau khi rời màn Két sắt (`vaultLeave`). Đây là ngoại lệ có chủ ý với việc rời két xóa danh sách đã giải mã ([ADR 0016](0016-phien-ket-sat-6-gio.md) mục 6). Không ghi xuống đĩa và không lưu lâu hơn lượt; khóa app đóng màn chính nên bản giả cũng mất.
c. Khi cả lượt bị từ chối trước khi xử lý từng file, người dùng thấy thông báo lỗi chung, không thấy "Không đưa ra được N file" ([Nợ kỹ thuật](../spec/roadmap.md#nợ-kỹ-thuật)).
d. Khi đưa lại vào két, thứ tự là thứ tự mặc định, không theo sắp xếp của người dùng ([Nợ kỹ thuật](../spec/roadmap.md#nợ-kỹ-thuật)).

**Điều agent KHÔNG được làm vì quyết định này:**

- Không quay lại việc chờ server rồi mới đổi giao diện khi lấy ra.
- Không cho bản giả giữ địa chỉ `fatup-vault://` hoặc `blob:`.
- Không bỏ bộ đếm thế hệ của làm mới, và không đưa mục lại vào két bằng tay khi két đã đóng (`locked`, `vault_locked`).
- Không lưu bản giả xuống đĩa hoặc bộ nhớ đệm.
