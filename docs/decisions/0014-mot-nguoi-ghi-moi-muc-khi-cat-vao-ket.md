# 0014. Một người ghi mỗi mục khi cất vào két: giữ chỗ 2 giờ, không nhả sớm

- Trạng thái: Bị thay bởi [0015](0015-mot-object-rieng-moi-lan-ma-hoa.md) (giữ chỗ và ETag bị bỏ; mỗi lần cất dùng một object riêng)
- Ngày: 2026-11-17
- Nguồn: design spec `docs/superpowers/specs/2026-11-17-vault-e2ee-design.md` (mục 4.7b C1, 4.7c N1/N3/N5/N7; 4.7c đã bị thay bởi 4.7d); sổ SDD `.superpowers/sdd/2026-11-17-vault-e2ee/progress.md` (Review lần 2 và 3, F1, F4a, F5); commit `c17ea99`, `e3a9a4e`, `7ed2df2`, `2afb891`
- Phạm vi: worker, desktop, web

## Bối cảnh

Hai máy cùng cất một file vào két có thể làm hỏng file. Presigned URL ghi `vault/<id>` không thu hồi được, sống 15 phút, và chữ ký chỉ được kiểm tra lúc PUT bắt đầu. Nếu máy B ghi đè `vault/<id>` sau khi máy A đã complete, khóa trong D1 không còn khớp bản mã trên R2.

So sánh ETag lúc complete (4.7b) chặn được ghi đè trước complete, nhưng không chặn ghi đè sau complete (review lần 2, N1).

Các phương án đã cân nhắc:

- **Chỉ so ETag khi complete:** không đủ, như nêu ở trên. Loại.
- **Giữ chỗ, và nhả ngay khi complete bị từ chối:** mở lại lỗ hổng. URL ghi của lượt bị từ chối vẫn sống tới 15 phút, máy khác có thể xin URL mới và ghi trong lúc URL cũ còn hiệu lực, rồi URL cũ ghi đè lên (review lần 3, I1). Loại.
- **Giữ chỗ 30 phút:** một PUT chậm có thể vẫn đang chạy sau 30 phút, vì chữ ký chỉ kiểm lúc bắt đầu (review lần 3, I2). Loại.
- **Giữ chỗ không có hạn hoặc khóa theo phiên:** một máy chết sẽ khóa mục vĩnh viễn. Loại.
- **Một key object cho mỗi claim (`vault/<id>.<claim>`):** cách triệt để, vì không còn ghi đè nào để chặn. Để sau, ghi ở Nợ kỹ thuật, vì đổi key và cron là thay đổi lớn hơn cần làm trong đợt sửa này.

## Quyết định

1. **Chỉ máy đang giữ claim được ghi `vault/<id>`.** `vault/in` cấp `in_claim` (16 byte ngẫu nhiên, base64url) và `in_claim_until = now + 2 giờ` (`CLAIM_MS`), bằng một câu `UPDATE ... WHERE ... (in_claim IS NULL OR in_claim_until <= now) RETURNING`. Không đổi dòng nào thì trả `409 item_busy` và không cấp URL. Kiểm tra và giữ chỗ là một câu, nên hai máy hỏi cùng lúc không cùng được.
2. **`vault/in/complete` của mục chưa mã hóa** (không phải liên kết): nếu hàng có `in_claim`, body phải có đúng `claim` và `in_claim_until > now`, và ghi D1 chỉ khi cùng điều kiện. Hàng không có `in_claim` (chưa qua `vault/in`) thì không bị ràng buộc. Complete thành công xóa `in_claim` và `in_claim_until`.
3. **Từ chối không nhả claim.** `item_changed` và `size_mismatch` không xóa giữ chỗ. Chúng cắt `in_claim_until` xuống `lúc cấp + 16 phút`, với lúc cấp = hạn cũ − 2 giờ. Trong thời gian đó mọi `vault/in` nhận `item_busy`. Nếu hạn còn không quá 16 phút thì không cắt nữa, để khỏi tính sai từ một gốc đã bị cắt.
4. **Mọi complete trên hàng có `in_claim` phải kèm đúng claim.** Máy không có claim (hoặc claim đã hết hạn) nhận `item_busy`. Mục bị `item_busy` ở desktop và web đi vào trạng thái lỗi, không tự thử lại; lần mở két sau thì làm lại.
5. **Lấy ra cũng được bảo vệ bằng `out_started_at`.** `vault/out/complete` chỉ chuyển hàng khi `out_started_at IS NOT NULL`. Cron nhả `out_started_at` trước khi xóa object, nên một complete đến sau khi cron đã nhả thì trả `item_changed` và không chuyển nữa.
6. **Hằng số.** `CLAIM_MS = 2 giờ`; `KEPT_MS = 16 phút` (15 phút của URL cộng 1 phút dự phòng).

### Lý do 2 giờ

- Lớn hơn nhiều so với hạn 15 phút của URL, vì chữ ký chỉ được kiểm lúc PUT bắt đầu. Một PUT bắt đầu khi URL còn sống có thể chạy rất lâu sau đó.
- Đủ cho một file 100 MB qua mạng chậm nhưng vẫn dùng được (khoảng 14 KB/s trở lên).
- Một máy chết giữa chừng khóa mục tối đa 2 giờ, không vĩnh viễn. Người dùng chỉ cần thử lại.

### Lý do không nhả sớm khi bị từ chối

- URL ghi của lượt bị từ chối còn sống tới 15 phút. Nhả ngay thì máy khác có thể cấp URL mới và ghi trong khi URL cũ còn hiệu lực.
- Sau 16 phút tính từ lúc cấp, mọi URL của lượt đó đã hết hạn chữ ký, nên mục có thể được giữ lại.

## Hệ quả

- **Được:** không còn hai máy cùng ghi một `vault/<id>`. `enc_key` trong D1 khớp bản mã trên R2, trừ trường hợp PUT cực chậm vượt 2 giờ (xem dưới).
- **Mất:** mục bị giữ tối đa 2 giờ nếu máy chết; sau một lần từ chối, mục bị giữ tới 16 phút; lần cất có thể thất bại với `item_busy` và phải thử lại. Thông điệp của `item_busy` hiện là "máy khác đang chuyển", cả khi giữ chỗ đã hết hạn của chính máy này (Nợ kỹ thuật, M2).
- **Rủi ro còn lại (ghi nhận):** một PUT cực chậm, dưới khoảng 14 KB/s với file 100 MB, có thể vượt 2 giờ. Khi đó máy khác có thể đã giữ chỗ và hoàn tất, rồi PUT chậm ghi đè lên, làm khóa trong D1 lệch bản mã cho tới lần complete sau. Chi tiết: [security 7.7](../spec/security.md#77-giới-hạn-bảo-mật-còn-lại). Cách triệt để là key object mỗi claim (Nợ kỹ thuật).
- **Điều agent KHÔNG được làm vì quyết định này:**
  - Không cấp URL ghi cho mục đang có claim còn hạn.
  - Không nhả claim khi `item_changed` hoặc `size_mismatch`, và không rút `in_claim_until` xuống thấp hơn lúc cấp + 16 phút.
  - Không giảm 2 giờ hoặc 16 phút mà không viết ADR mới và tính lại hạn URL 15 phút.
  - Không bỏ kiểm `out_started_at IS NOT NULL` ở `vault/out/complete`, hay bỏ việc nhả cột trước khi cron xóa object.
  - Không bỏ kiểm claim ở `vault/in/complete` khi hàng có `in_claim`.
