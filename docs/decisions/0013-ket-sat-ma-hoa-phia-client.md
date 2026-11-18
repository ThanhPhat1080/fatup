# 0013. Két sắt mã hóa phía client: PIN két 6 số, bộ đếm trên server, recovery key

- Trạng thái: Đã chốt
- Ngày: 2026-11-17
- Nguồn: design spec `docs/superpowers/specs/2026-11-17-vault-e2ee-design.md` (mục 3, 4, 7); plan `docs/superpowers/plans/2026-11-17-vault-e2ee.md`; các Ruling trong sổ SDD `.superpowers/sdd/2026-11-17-vault-e2ee/progress.md` (chép ở cuối ADR); commit `0c04fa0`, `9eb55ac`…`2afb891`
- Phạm vi: worker, shared, desktop, web

## Bối cảnh

Két sắt cũ chỉ là lớp che giao diện: file vẫn là object R2 đọc được bằng API token. Máy công ty có Zscaler soi HTTPS, nên token có thể lộ, và ai có token đọc được cả két. Yêu cầu: file trong két không đọc được dù lộ token, miễn là két chưa từng được mở trên máy bị soi.

Các phương án đã cân nhắc:

- **Mã hóa phía server (SSE-C):** khóa phải đi theo mỗi request tới R2, qua đúng đường mạng bị soi. Zscaler thấy khóa và đọc được file. Loại.
- **Mã hóa phía server với khóa do Worker giữ:** ai có token vẫn lấy được file đã giải mã qua API, và khóa nằm trên server. Không đạt mục tiêu. Loại.
- **Passphrase dài thay PIN:** loại theo quyết định của người dùng (Q4): mở két hay dùng trên điện thoại và máy tính, cần PIN ngắn có bộ đếm trên server.
- **Argon2id thay PBKDF2:** loại, vì WebCrypto có sẵn PBKDF2 và không cần WASM. Thứ bảo vệ két là bí mật `S` và bộ đếm, không phải độ khó của KDF.
- **Server sinh `S`:** cùng mức lộ, thêm một vòng request. Loại.
- **Dùng thẳng `MK` cho mọi file:** loại, vì giới hạn số lần dùng một khóa AES-GCM và làm đổi `MK` sau này phải mã hóa lại mọi file. Chọn `DEK` riêng cho mỗi file.
- **Két không có recovery key:** mất PIN là mất két. Loại theo quyết định của người dùng (Q1).

## Quyết định

Két sắt là mã hóa đầu cuối phía client. Các khóa và định dạng:

1. **Khóa.** `MK` (AES-256, một lần khi thiết lập) chỉ sống trong bộ nhớ khi két mở. Mỗi mục có `DEK` riêng, bọc bằng `MK`. `S` (32 byte, client sinh) lưu trên server và chỉ trả khi `authKey` đúng. `P = PBKDF2-SHA256(PIN, salt, 600 000 vòng)`; `authKey = HKDF(P, "fatup-vault-auth")` là thứ duy nhất gửi lên; `KEK = HKDF(HKDF(P, "fatup-vault-wrap") ‖ S, "fatup-vault-kek")` bọc `MK`. `RK` 128 bit (recovery key) có đường riêng qua `rkAuth` và `rkKek`.
2. **PIN két 6 số, khác PIN app 4 số.** PIN app không bao giờ lên server ([ADR 0006](0006-pin-chi-khoa-giao-dien.md), vẫn đúng). PIN két tham gia kiểm tra phía server qua `authKey` dẫn xuất, nhưng không bao giờ gửi dạng đọc được. Từ chối PIN yếu: sáu chữ số giống nhau, dãy tăng hoặc giảm liên tiếp, hoặc trùng 4 số đầu/cuối của PIN app.
3. **Bộ đếm sai trên server.** Sai 1–4: nhập lại. Sai 5: khóa 1 phút. Sai 6–9: mỗi lần khóa 15 phút. Sai 10: server xóa `auth_hash`, `S` và `wrapped_mk_pin`, chỉ recovery key mở được. Đúng thì về 0. Việc đếm là một câu `UPDATE` có điều kiện, nên các request song song không vượt giới hạn.
4. **Recovery key.** 128 bit, Crockford base32, 26 ký tự cộng 1 ký tự kiểm tra, in theo nhóm 4 ký tự. Hiện một lần khi thiết lập. Xác nhận bằng cách gõ lại 2 nhóm ngẫu nhiên. `rkAuth` không đếm và không bị khóa, vì 128 bit không đoán được; đặt lại PIN bằng recovery key được cả khi két đang khóa hoặc đã bị xóa bí mật.
5. **Metadata mã hóa.** `enc_meta` (tên, loại, kind, URL và tiêu đề liên kết) mã hóa bằng `MK`. Mục két trên server có `name = ''`, `mime = 'application/octet-stream'`, `kind = 'file'`, `url = NULL`. Server không thấy tên, loại hay URL.
6. **Định dạng bản mã FUV1.** Header 16 byte (magic, cỡ khối 1 MiB, nonce gốc 8 byte). Mỗi khối AES-256-GCM với nonce = nonce gốc ‖ chỉ số khối, AAD = chỉ số khối ‖ cờ khối cuối. Kích thước bản mã tính trước được. Khi giải mã chấp nhận cỡ khối từ 1 byte đến 64 MiB.
7. **Thùng rác riêng của két.** Xóa trong két đặt `deleted_at` và giữ `in_vault = 1`. Thùng rác thường là `in_vault = 0`. `DELETE /trash` chỉ dọn `in_vault = 0`. Cron xóa sau 30 ngày cho cả hai. Hoàn tác trong két là khôi phục về két.
8. **Liên kết và xem trước.** Mục trong két không được server xem trước (`409 encrypted`). Ảnh xem trước của liên kết được mã hóa vào `vault/<id>.thumb`. App không lưu ảnh xem trước cho liên kết trong két.
9. **Upload thẳng vào két.** `POST /uploads` nhận `vault: { encMeta, encKey }`. Thiết bị gửi (`device`) vẫn để rõ (Q3).
10. **Chuyển đổi file cũ.** Sau khi thiết lập, mỗi mục còn rõ trong két được mã hóa từng cái, có tiến trình, bị ngắt thì làm tiếp. Mục trong thùng rác của két cũng được mã hóa.
11. **Thiết lập hai bước.** `prepareSetup` tính mọi thứ trên máy và trả recovery key, không gọi server. `commitSetup` mới `POST /vault/setup` và mở két, sau khi người dùng đã xác nhận.
12. **Đóng két.** `VaultSession` có bộ đếm thế hệ. `close()` tăng nó, xóa khóa và làm mọi lời gọi mở đang chờ trả `closed`, không giữ khóa.
13. **Nơi ở của khóa.** `MK` không bao giờ extractable, trừ một bản tạm bên trong `recover` và `changePin` để bọc lại. Desktop giữ `MK` trong main process; web giữ trong bộ nhớ JS. Renderer không nhận `MK`, `DEK` hay `S`. Ảnh và file trong két đi qua `fatup-vault://` (desktop, phục vụ từ bộ nhớ, không ghi đĩa) hoặc `blob:` (web, thu hồi khi đóng).
14. **Giao thức và app cũ.** Client mới gửi `X-FatUp-Vault: 2`. Khi két đã thiết lập, `GET /files?vault=1` và `PUT /files/:id/vault` trả `426 app_outdated` nếu thiếu header. Trước khi thiết lập, endpoint cũ vẫn chạy như cũ.
15. **Cất vào két không ghi đè nhau.** Mỗi lần cất ghi một object riêng `vault/<id>.<attempt>`, và D1 trỏ tới đúng object mà khóa của nó mã hóa (`enc_object`). Không còn ETag, giữ chỗ hay `item_busy`. Thay cho cách làm ở 4.7b/4.7c (ADR 0014, đã bị thay): xem [ADR 0015](0015-mot-object-rieng-moi-lan-ma-hoa.md).
16. **Cron.** Dọn bản rõ sót của hàng `encrypted = 1` có `out_started_at` cũ hơn 1 giờ: nhả cột trước, rồi xóa object; và dọn object rác dưới `vault/` ([ADR 0015](0015-mot-object-rieng-moi-lan-ma-hoa.md)). `purge` xóa các khóa của mục (kể cả khóa theo `enc_object`), theo lô 100 id.
17. **Phạm vi.** Android hoãn (không thấy và không mở két). "Tắt két sắt trên thiết bị này" hoãn. Không che kích thước, thời gian, thiết bị, thẻ màu, số mục. Cloudflare và người đọc được D1 ngoài phạm vi mối đe dọa.

### Ruling trong sổ SDD được chép vào đây

Các Ruling làm đổi hành vi, gom theo chủ đề (sổ SDD bị gitignore nên bản chính nằm ở đây):

- *Shared và mã hóa (Task 1–2):* `newSetup` trả `MK` không extractable (unwrap lại từ bản bọc bằng PIN); `unwrapMasterKey` có `{ extractable }` chỉ dùng khi đổi PIN; checksum RK tính trên ký tự; AAD = chỉ số BE32 ‖ cờ cuối; base64 chuẩn có padding; thumbnail là một blob FUV1 riêng, cùng DEK, nonce gốc riêng.
- *Bộ đếm và API (Task 4):* thêm `409 vault_busy` khi két đổi giữa lúc kiểm tra; `GET /vault` trả `lockedUntil: null` khi khóa đã hết; `PUT /vault/pin` đúng một trong `authKey`/`rkAuth`; `rkAuth` sai là `403 forbidden` không đếm; `auth_hash` và `rk_auth_hash` là SHA-256 của bytes đã giải base64, lưu hex; `403` của `unlock` luôn có `lockedUntil`.
- *Đổi tên và upload (Task 5, 9):* `PATCH /files/:id` nhận `encMeta` (đổi tên mục két mã hóa lại trên máy); `name`/`url` dạng rõ bị `409 encrypted`; `encMeta` ≤ 8192 và `encKey` ≤ 512 ký tự; upload két giữ `device`.
- *Liên kết (Task 6):* liên kết không có object R2, `vault/in` trả `downloadUrl: null`, complete nhận `size: 0`; ảnh xem trước của liên kết đi vào `vault/<id>.thumb`; lấy ra thì bỏ ảnh và để server xem trước lại.
- *Thùng rác của két (Task 9, sửa `ee8fa86`):* `vault/in` và `vault/in/complete` nhận mục `in_vault = 1` đã xóa; `vault/out` không nhận; `migrateLegacy` chạy sau thiết lập, mở két và khôi phục, một lần, nuốt lỗi; lấy ra mục cũ chưa mã hóa cần két mở.
- *Phía client (Task 7–8):* `VaultSession` nằm trong `desktop/src/vault-session.ts`, không import Node, web dùng lại; scheme `fatup-vault` trả `cache-control: no-store`; `owns(id)` vẫn đúng sau khi đóng két, để trả `vault_locked` thay vì rơi sang đường tải thường.
- *Thiết lập và cất (F2, một phần đã bị thay bởi [0015](0015-mot-object-rieng-moi-lan-ma-hoa.md): không còn ETag và không còn thử lại khi `item_changed`):* `moveIn` đọc header `ETag` nguyên văn; thiếu thì mục lỗi, không gọi complete; `409 item_changed` thử lại một lần với `DEK` mới; `moveOut` lỗi sau khi đã PUT bản rõ thì gọi `moveInComplete` không etag để dọn; giữ bản thiết lập đã chuẩn bị sau lỗi mạng; web từng cần CORS `ExposeHeaders: ETag`, nay không còn cần.

## Hệ quả

- **Được:** ai có token không đọc được nội dung, tên, loại hay URL của mục két; không thử được PIN két qua API (mọi lần thử bị đếm, `S` chỉ trả khi đúng).
- **Mất:** mất cả PIN lẫn recovery key là mất file trong két, không có đường lấy lại. Kích thước, thời gian, thiết bị, thẻ màu và số mục vẫn lộ. Tìm kiếm và sắp xếp theo tên chạy trên máy. Android không mở được két. Desktop và web phải giữ thêm lõi mã hóa và nhiều trạng thái chuyển đổi.
- **Rủi ro chấp nhận có quy tắc:** mở két trên máy bị soi HTTPS thì lộ `S` và `wrapped_mk_pin`, và thử PIN offline được. Quy tắc: không mở két trên máy công ty hoặc qua mạng bị soi. Chi tiết: [security 7.7](../spec/security.md#77-giới-hạn-bảo-mật-còn-lại). Chấp nhận việc người có token cố tình làm khóa két (Q2).
- **Điều agent KHÔNG được làm vì quyết định này:**
  - Không gửi PIN két, `MK`, `DEK`, `S`, hay tên/URL dạng rõ của mục két lên server; không đưa `MK`/`DEK`/`S` ra renderer; không ghi khóa xuống đĩa, `localStorage`, IndexedDB hay Cache Storage.
  - Không đổi bộ đếm sai (1–4 / 5 / 6–9 / 10) hay quy tắc xóa bí mật mà không viết ADR mới.
  - Không đưa lại `PUT /files/:id/vault` cho két đã thiết lập, và không cho xem trước mục két trên server.
  - Không xóa quy tắc "không mở két trên máy bị soi" khỏi tài liệu người dùng.
  - Không sửa `0009` sau khi đã áp dụng ở đâu; thay đổi schema phải là migration mới.
