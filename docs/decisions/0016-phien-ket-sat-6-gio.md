# 0016. Phiên két 6 giờ: giữ khóa để cất, quyền xem tách riêng và luôn hỏi PIN

- Trạng thái: Đã chốt
- Ngày: 2026-11-18
- Nguồn: plan `docs/superpowers/plans/2026-11-18-vault-session-6h.md` (quyết định 1–7 và các Ruling); quyết định của người dùng ngày 2026-11-18 (không có design spec riêng); tinh chỉnh [ADR 0013](0013-ket-sat-ma-hoa-phia-client.md) mục 1
- Phạm vi: desktop, web, shared

## Bối cảnh

Theo ADR 0013, khóa chính `MK` chỉ sống khi màn Két sắt đang mở: rời màn hình là đóng két, và mỗi lần cất file từ danh sách chính phải nhập PIN két, bị chuyển sang màn Két sắt, rồi cất xong lại đóng. Cất vài file liên tiếp hay vài lần trong ngày nghĩa là nhập PIN và đổi màn hình lặp lại mỗi lần.

Người dùng yêu cầu (2026-11-18): cất file vào két không hỏi PIN mỗi lần và không chuyển sang màn Két sắt; còn **xem** két thì luôn hỏi PIN.

Các phương án đã cân nhắc:

- **Giữ nguyên** (đóng khóa khi rời, hỏi PIN mỗi lần cất): loại theo yêu cầu.
- **Hết hạn theo thời gian rỗi:** mỗi lần dùng két gia hạn thêm. Loại: cửa sổ mở có thể kéo dài mãi khi app còn được dùng, và tab nền bị trình duyệt làm chậm bộ hẹn giờ nên khó đoán. Chọn hạn tuyệt đối 6 giờ kể từ lần nhập PIN đúng, không gia hạn khi dùng.
- **Một quyền duy nhất** (giữ khóa là được xem): loại. Khi đó xem két cũng không cần PIN trong 6 giờ, trái với yêu cầu rằng xem luôn hỏi PIN.
- **Rời màn Két sắt thì đóng khóa:** loại. Sau khi xem xong, cất file tiếp sẽ lại hỏi PIN, đúng điều người dùng muốn tránh.
- **Khóa công khai (phương án B):** đã được đưa ra và người dùng từ chối. Với khóa công khai, cất vào két chỉ cần khóa công khai, không cần khóa bí mật trong bộ nhớ. Nhưng khóa công khai nằm trên server, và ai có API token có thể thay nó bằng khóa của mình; chỉ chặn được nếu mỗi máy ghim khóa công khai và so khớp. Đó là thay đổi lớn hơn (định dạng khóa, ghim khóa, chuyển đổi dữ liệu).

## Quyết định

1. **Két có hai quyền tách riêng.**
   - **Giữ khóa** (`MK` trong `VaultSession`): đủ để *cất file vào két* (mã hóa, chuyển file cũ chạy nền, tải lên thẳng vào két). `vaultStatus().open` cho biết app có đang giữ khóa không.
   - **Quyền xem** (`viewOpen` trong lõi `createVaultCore`): cần để *xem két* (danh sách đã giải mã, ảnh thu nhỏ, mở và tải file, đổi tên, thêm liên kết, lấy ra, `serve`). Chỉ có khi PIN đúng được nhập trên màn Két sắt (`vaultUnlock(pin)`, mặc định là `view`) hoặc khi vừa thiết lập, khôi phục ở đó. Mất khi rời màn Két sắt (`vaultLeave`), khi khóa app, `reset`, hoặc khi hết hạn.
2. **Hạn 6 giờ cố định.** Khóa được giữ tối đa `VAULT_SESSION_MS` (6 giờ) kể từ lần mở két thành công gần nhất: PIN đúng, khôi phục, hoàn tất thiết lập, hoặc đổi PIN thành công. Dùng két không gia hạn. Hết hạn thì đóng hẳn như `vaultClose()`. Hạn được kiểm cả bằng bộ hẹn giờ lẫn mỗi lần dùng khóa.
3. **Cất từ danh sách chính.** Đang giữ khóa thì cất ngay, không hỏi PIN, không chuyển màn hình. Chưa giữ khóa thì hiện popup nhỏ `VaultPinDialog` ngay trên danh sách, gọi `vaultUnlock(pin, 'move')`: đúng PIN thì cất file và giữ khóa 6 giờ, nhưng **không** cấp quyền xem. Không còn chuyển hướng sang màn Két sắt.
4. **Vào màn Két sắt luôn hỏi PIN** (cổng 6 số), kể cả khi đang giữ khóa.
5. **Đổi PIN két không đòi quyền xem.** `vaultChangePin` chỉ đòi app đã mở khóa: PIN cũ là bằng chứng, không trả về gì đã giải mã, và form nằm trong Cài đặt. Đây là quyết định cuối (Ruling trong plan).
6. **Bridge:** `vaultClose` của renderer đổi tên thành `vaultLeave`. `vaultLeave` bỏ quyền xem, xóa danh sách đã giải mã, thu hồi mọi địa chỉ, bỏ bản thiết lập đang chuẩn bị, và **giữ khóa**. `vaultClose()` của lõi vẫn là đóng hẳn.

## Hệ quả

**Được:** cất nhiều file trong 6 giờ không hỏi PIN; xem két luôn cần PIN; quyền xem và khóa tách riêng, nên lỗi ở một nhánh không tự cấp quyền của nhánh kia.

**Chấp nhận (ghi rõ để không bị coi là lỗi bị bỏ sót):**

a. **Khóa nằm trong bộ nhớ tới 6 giờ sau lần nhập PIN đúng gần nhất.** Kẻ kiểm soát app đang chạy hoặc trang đang chạy (không phải kẻ nghe mạng) trong khoảng đó có thể cất file vào két, nhưng **không đọc được**: đọc vẫn cần quyền xem, tức cần PIN. Khóa không bao giờ ra mạng.
b. **Bấm lùi ở cổng khi một lần mở đang chạy, hoặc rời trình thiết lập trong lúc `commitSetup` đang chạy,** có thể để khóa được giữ tới 6 giờ. Quyền xem không được cấp (lượt mở đã cũ khi kết thúc), nhưng khóa vẫn còn.
c. **`serve` và `plainBytes` đang tải dở khi `vaultLeave` chạy** vẫn có thể trả byte đã giải mã, vì sau `fetchPlain` không có kiểm tra thế hệ. Chỉ ảnh hưởng những yêu cầu đã qua kiểm tra quyền xem trước khi rời màn hình.
d. **`changePin` được phép khi app đã mở khóa,** kể cả khi két đang đóng hoặc chỉ đang giữ khóa. Ai biết PIN cũ thì đổi được PIN.
e. `lock`, `reset`, hết hạn và `vaultClose` tường minh vẫn xóa mọi thứ: khóa, danh sách, địa chỉ, quyền xem.
f. **`listVault` thử lại mục đám mây mờ** (chưa mã hóa xong) mỗi lần danh sách két được tải. Việc này chỉ cần khóa để chạy, nhưng danh sách chỉ tải khi có quyền xem, nên không mở thêm quyền nào.
g. **Bản giả của mục đang lấy ra** (ADR 0017) giữ tên đã giải mã trong danh sách chính cho tới khi lượt lấy ra kết thúc, kể cả khi rời màn Két sắt giữa chừng. Đây là ngoại lệ duy nhất của việc rời két xóa danh sách đã giải mã; khóa app vẫn xóa hết.

**Điều agent KHÔNG được làm vì quyết định này:**

- Không gia hạn 6 giờ khi dùng két, và không đổi sang hết hạn theo thời gian rỗi mà không có ADR mới.
- Không cho quyền xem đi theo khóa (giữ khóa không đủ để xem), và không đóng khóa khi rời màn Két sắt.
- Không cấp quyền xem từ `vaultUnlock(pin, 'move')`.
- Không ghi khóa xuống đĩa hay bộ nhớ đệm để giữ phiên qua lúc khởi động lại.
- Không đòi quyền xem cho `changePin` mà không có ADR mới.

**Quan hệ với ADR 0013:** quy tắc "khóa chỉ sống khi két mở" ở mục 1 của 0013 được thay bằng quy tắc của ADR này. Các quy tắc khác của 0013 (không gửi PIN, `MK`, `DEK`, `S` lên server; không ra renderer; không ghi xuống đĩa) vẫn đúng.
