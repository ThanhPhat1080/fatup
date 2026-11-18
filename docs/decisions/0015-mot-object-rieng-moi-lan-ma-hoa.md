# 0015. Mỗi lần cất vào két một object riêng, không giữ chỗ

- Trạng thái: Đã chốt
- Ngày: 2026-11-17
- Nguồn: design spec `docs/superpowers/specs/2026-11-17-vault-e2ee-design.md` (mục 4.7d, thay 4.7b phần ETag và 4.7c phần giữ chỗ); sổ SDD `.superpowers/sdd/2026-11-17-vault-e2ee/progress.md` (Task 17, F6a, F6b, F6c, và review Task 17); commit `dfd227a`, `d565cda`, `50a662e`, `979d3c5`
- Phạm vi: worker, desktop, web, shared
- Thay thế: [0014](0014-mot-nguoi-ghi-moi-muc-khi-cat-vao-ket.md)

## Bối cảnh

Hai máy cùng cất một mục vào két sẽ cùng ghi vào một tên `vault/<id>`, mỗi máy với một `DEK` riêng. Presigned URL ghi lên R2 không thu hồi được và sống 15 phút; chữ ký chỉ được kiểm tra lúc PUT bắt đầu. Vì vậy một URL đã cấp vẫn ghi đè được object sau khi máy kia đã hoàn tất. Nếu D1 giữ khóa của lần này còn R2 giữ bản mã của lần khác, mục không giải mã được.

Các phương án đã cân nhắc:

- **So ETag khi complete (4.7b).** Không đủ: chỉ chặn được ghi đè trước complete, không chặn ghi đè sau complete (review lần hai, N1). Loại.
- **Giữ chỗ (claim) 30 phút, rồi 2 giờ (4.7c, [ADR 0014](0014-mot-nguoi-ghi-moi-muc-khi-cat-vao-ket.md)).** Mỗi mức đều có lỗ hổng: nhả claim khi bị từ chối mở lại cửa cho URL cũ còn sống 15 phút (review lần 3, I1); 30 phút không đủ cho một PUT chậm (I2); 2 giờ vẫn có PUT cực chậm vượt hạn; máy chết giữa chừng chặn mục tối đa 2 giờ. Cơ chế còn kéo theo cột `in_claim*`, mã lỗi `item_busy`, logic thử lại và rút hạn, nên càng phức tạp và còn tự chặn chính máy bị bỏ dở. Loại.
- **Thông báo thời gian thực giữa các máy (pub/sub) để biết máy nào đang ghi.** Cần Durable Objects hoặc WebSocket, tức hạ tầng mới trái với phạm vi "không realtime" của spec §2. Và không chặn được hết: migrate nền chạy ở mọi máy, kể cả máy không mở app, vẫn có thể ghi. Loại.
- **Ghi có điều kiện trên R2 (`If-Match` / `If-None-Match`) trên `vault/<id>`.** Chưa kiểm chứng trên R2 thật, nên không dựa vào. Loại.

## Quyết định

1. **Mỗi lần cất có một tên riêng.** `vault/in` sinh `attempt` (16 byte ngẫu nhiên, base64url) và cấp URL ghi cho `vault/<id>.<attempt>` (và `vault/<id>.<attempt>.thumb`). Không ghi trạng thái nào về lần thử này vào D1, nên không có giữ chỗ và không có `item_busy`.
2. **`vault/in` đặt `in_vault = 1` ngay.** Mục rời danh sách chính, link chia sẻ chết ngay nhờ trigger, và hiện trong két với biểu tượng đám mây mờ. Lúc này `encrypted` vẫn là 0.
3. **`vault/in/complete` ghi khóa theo đúng object.** Server `head()` đúng object của `attempt`, rồi một câu `UPDATE ... WHERE encrypted = 0 AND in_vault = 1 AND status = 'ready'` đặt `encrypted = 1`, `enc_object = attempt`, cùng `enc_meta` và `enc_key` của lần đó. Khóa trong D1 luôn khớp đúng object mà nó mã hóa.
4. **Máy thua và máy bị lấy ra.** Hàng đã mã hóa (máy khác thắng): trả 200, không đổi `enc_key` và `enc_meta`, và xóa object của chính lần thử nếu `attempt` khác `enc_object`. Hàng không còn trên đường vào két (đã lấy ra): trả `409 item_changed`, xóa object của lần thử, không đổi hàng.
5. **Khóa của mục đã mã hóa** là `vault/<id>.<enc_object>` (kèm `.thumb`). `enc_object` NULL nghĩa là khóa cố định `vault/<id>`, dùng cho upload thẳng vào két. Mọi chỗ lấy khóa đều đi qua `objectKeys(row)`.
6. **Dọn rác bằng cron.** Cron hằng ngày xóa object dưới `vault/` có tuổi trên 1 giờ mà hàng của nó không còn, hoặc có `attempt` khác `enc_object`. `purge` xóa khóa hiện tại của hàng và các khóa bản rõ.
7. **Mover không thử lại trong cùng lượt.** Mọi lỗi của một mục đưa mục vào `failed`. Lần mở két sau (`migrateLegacy`) làm lại với `attempt` mới. Không còn ETag, và CORS của R2 không cần `ExposeHeaders: ETag` cho két.
8. **Trạng thái hiển thị.** Mục trong két với `encrypted = 0` hiện biểu tượng đám mây mờ; `encrypted = 1` hiện dấu tick xanh. Thiết bị khác thấy đổi trạng thái qua làm mới sẵn có (polling 60 giây và khi lấy lại focus), không thêm hạ tầng.

## Hệ quả

- **Được:** hai máy không bao giờ ghi cùng một tên; khóa trong D1 luôn khớp object; máy chết giữa chừng không khóa mục; không thêm hạ tầng. Bỏ được `in_claim`, `in_claim_until`, `etag`, `item_busy`, `CLAIM_MS`, `KEPT_MS` và logic thử lại của mover.
- **Mất:** object rác còn tới lần cron kế tiếp (tối đa khoảng một ngày sau khi quá 1 giờ) và chiếm dung lượng R2 tạm thời. Một lần cất bị dở phải làm lại từ đầu, tốn băng thông. Cần thêm việc liệt kê `vault/` trong cron.
- **Rủi ro còn lại** (ghi ở [security 7.7](../spec/security.md#77-giới-hạn-bảo-mật-còn-lại)):
  - Mục ở trạng thái đám mây (chưa mã hóa xong) vẫn có bản rõ trên R2, và người có token đọc được, như mọi mục chưa mã hóa.
  - Một `vault/in/complete` đến sau hơn 1 giờ kể từ lúc PUT, đúng khoảng cron đang xóa object đó, có thể làm mục mất cả bản rõ lẫn bản mã. Chi tiết và cách giảm rủi ro nằm ở security 7.7 và Nợ kỹ thuật.
  - Bản rõ sót lại khi lấy ra bị ngắt tồn tại tới lần cron sau (security 7.7).
- **Điều agent KHÔNG được làm vì quyết định này:**
  - Không thêm lại giữ chỗ, ETag, `item_busy` hay khóa theo claim mà không viết ADR mới.
  - Không ghi `vault/<id>` cố định cho một mục đã có `enc_object`, và không đặt `enc_object` ngoài `vault/in/complete` và `vault/out/complete`.
  - Không xóa object của `attempt` mà `enc_object` đang trỏ tới.
  - Không bỏ điều kiện `encrypted = 0` (và `in_vault = 1`) ở câu UPDATE của `vault/in/complete`.
