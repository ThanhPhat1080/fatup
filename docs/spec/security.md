# Bảo mật

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 7. Bảo mật

- **Token API**: chuỗi ngẫu nhiên 32 byte (base64url), lưu ở Worker secret `API_TOKEN`, so sánh constant-time. **Ai có token thì đọc/xóa được mọi file ngoài két sắt.** File trong két chỉ là bản mã đối với token (xem [7.1](#71-két-sắt-mã-hóa-phía-client-e2ee)), nhưng kích thước, thời gian, thiết bị, thẻ màu và số mục vẫn lộ.
- **PIN 4 số của app chỉ khóa UI**, không bao giờ gửi lên server.
  - Desktop: lưu `scrypt(pin, salt)` trong file config local. Sai 5 lần thì khóa 30 giây (thời điểm khóa lưu ra đĩa để restart app không lách được). Quên PIN thì "Đặt lại": xóa token + PIN, về màn setup.
  - Bộ đếm sai của màn khóa app là cục bộ, **tách hẳn** khỏi bộ đếm của két sắt.
- **PIN két sắt 6 số** là một mã khác, có bộ đếm trên server và được kiểm tra qua `authKey` dẫn xuất (xem [7.1](#71-két-sắt-mã-hóa-phía-client-e2ee)). PIN két không bao giờ gửi dạng đọc được.
- **Token trên desktop** mã hóa bằng `safeStorage` của Electron, chỉ main process đọc; renderer không bao giờ thấy token, mọi request đi qua IPC. Linux không có keyring thì lưu base64.
- **Token trên Android** lưu ở `SharedPreferences` private, loại khỏi backup.
- **Token trên web (PWA)**: không có keychain, nên token được mã hóa **AES-GCM** bằng khóa dẫn xuất từ PIN (PBKDF2-SHA256, 310.000 vòng) rồi lưu `localStorage`. Mở khóa = giải mã thành công. PIN 4 số chỉ có 10.000 tổ hợp nên chỉ chống người qua đường, **không chống người đọc được dữ liệu trình duyệt**. Không dùng web trên máy dùng chung. Bộ đếm sai PIN của web nằm ở client nên chỉ mang tính nhắc nhở.
- Presigned URL hết hạn sau 15 phút (upload) hoặc 1 giờ (thumbnail/download). Chữ ký chỉ được kiểm tra lúc request bắt đầu.
- **Link chia sẻ công khai**: token 192 bit không đoán được, ai có link thì xem/tải được (và chuyển tiếp được), thu hồi bằng hạn hoặc Dừng chia sẻ. Đây là bề mặt công khai duy nhất của API ngoài `/health`, giới hạn ở hai route `/s/...` chỉ đọc. Không lộ lý do khi link chết (mọi lý do cùng một `404`). Không phục vụ HTML/SVG inline trên origin của PWA ([mục 4.2](api.md#42-chia-sẻ-link-công-khai)).
- Bản web được phục vụ cùng origin với API nên API **không cần CORS**. Riêng R2 thì cần: trình duyệt PUT/GET thẳng tới presigned URL (origin khác). Két không cần header `ETag`. Xem [mục 10](web.md#10-bản-web-pwa).

### 7.1 Két sắt mã hóa phía client (E2EE)

Thiết kế đầy đủ: [design spec](../superpowers/specs/2026-11-17-vault-e2ee-design.md). Lý do chọn: [ADR 0013](../decisions/0013-ket-sat-ma-hoa-phia-client.md); cách cất vào két không ghi đè nhau: [ADR 0015](../decisions/0015-mot-object-rieng-moi-lan-ma-hoa.md) (thay [ADR 0014](../decisions/0014-mot-nguoi-ghi-moi-muc-khi-cat-vao-ket.md)).

**Mối đe dọa được tính tới.** Máy công ty có Zscaler soi HTTPS: admin mạng đọc được mọi request đi qua máy đó, kể cả API token. Mục tiêu: file trong két **không đọc được dù lộ token**, miễn là két chưa từng được mở trên máy bị soi. Giữ khóa tối đa 6 giờ ([7.7](#77-giới-hạn-bảo-mật-còn-lại)) không thêm đường lộ ra mạng: khóa chỉ nằm trong bộ nhớ, và mọi lần đọc két vẫn cần PIN.

**Không tính tới:** Cloudflare và người có quyền đọc D1 (xem [7.7](#77-giới-hạn-bảo-mật-còn-lại)); phần mềm theo dõi đã cài sẵn trên máy.

#### Các khóa

| Tên | Là gì | Ở đâu |
|---|---|---|
| `MK` (master key) | AES-256 ngẫu nhiên, sinh một lần khi thiết lập | Chỉ trong bộ nhớ (main process của desktop, bộ nhớ trang của web), tối đa 6 giờ kể từ lần mở két thành công gần nhất (PIN đúng, khôi phục, thiết lập, đổi PIN); không gia hạn khi dùng, không bao giờ extractable ngoài lúc đổi PIN hoặc khôi phục. Quyền xem két là một thứ khác, không đi theo khóa ([mục 5.2](lifecycle.md#52-két-sắt-secret-vault)). Trên server chỉ có `MK` đã bọc (`wrapped_mk_pin`, `wrapped_mk_recovery`). Không bao giờ ra renderer, không ghi đĩa, không vào `localStorage` |
| `DEK` (khóa từng file) | AES-256 ngẫu nhiên cho mỗi mục trong két | D1 cột `enc_key`, bọc bằng `MK` (nonce 12 byte ‖ AES-GCM, base64) |
| `S` (bí mật của server) | 32 byte ngẫu nhiên, client sinh khi thiết lập | D1 `vault_keys.server_secret`; server **chỉ trả khi `authKey` đúng** |
| `P` | `PBKDF2-SHA256(PIN, salt, 600 000 vòng)` → 64 byte | Tính trên máy, không lưu |
| `authKey` | `HKDF(P, "fatup-vault-auth")` | Gửi lên khi mở két hoặc đổi PIN; server chỉ lưu `SHA-256(authKey)` |
| `wrapBase` | `HKDF(P, "fatup-vault-wrap")` | Tính trên máy, không gửi đi; là một nửa đầu của `KEK` |
| `KEK` | `HKDF(wrapBase ‖ S, "fatup-vault-kek")`, AES-256 | Tính trên máy; bọc `MK` → `wrapped_mk_pin` |
| `RK` (recovery key) | 128 bit ngẫu nhiên, in thành chữ base32 (xem [7.4](#74-recovery-key)) | Chỉ người dùng giữ. Server lưu `SHA-256(rkAuth)` với `rkAuth = HKDF(RK, "fatup-vault-rk-auth")`, và `MK` bọc bằng `HKDF(RK, "fatup-vault-rk-wrap")` → `wrapped_mk_recovery` |

**Vì sao người có token không thử PIN offline được.** Thử một PIN cần `S` (để dựng `KEK`) hoặc cần `auth_hash` và `salt` để kiểm tra `authKey`. Người có token không có `auth_hash`, không có `S` (server chỉ trả `S` khi `authKey` đúng), và mọi lần thử qua API đều bị đếm. `salt` và `wrapped_mk_pin` lộ ra cũng không đủ khi thiếu `S`. `RK` 128 bit nên `wrapped_mk_recovery` lộ ra cũng không đoán được.

**Kiểm tra PIN két yếu** (trên máy, trước khi thiết lập và khi đổi PIN): từ chối 6 chữ số giống nhau, dãy tăng hoặc giảm liên tiếp, và PIN có 4 số đầu hoặc 4 số cuối trùng PIN app. Kiểm tra PIN app dùng hash sẵn có và **không** được tính vào bộ đếm của màn khóa.

**KDF.** PBKDF2-SHA256 600 000 vòng trong WebCrypto (không dùng Argon2). Server không tự kiểm tra số vòng tối thiểu (xem [Nợ kỹ thuật](roadmap.md#nợ-kỹ-thuật)).

#### Thiết lập (một lần)

Chạy theo hai bước, để không có gì lên server trước khi người dùng xác nhận recovery key:

1. `prepareSetup`: kiểm tra PIN, sinh `S`, `MK`, `RK`, các `wrapped` và `authKey`/`rkAuth` trên máy. Không gọi server.
2. `commitSetup`: `POST /vault/setup` rồi mở két. Lỗi mạng thì giữ bản đã chuẩn bị để thử lại.

### 7.2 Định dạng bản mã FUV1

- **Header 16 byte:** magic `FUV1` (4 byte) + cỡ khối (u32 big-endian, `1 MiB` khi mã hóa) + nonce gốc ngẫu nhiên (8 byte).
- **Mỗi khối:** `AES-256-GCM(DEK, nonce, AAD)` với `nonce = nonce gốc (8 byte) ‖ chỉ số khối (u32 BE)`, `AAD = chỉ số khối (u32 BE) ‖ cờ khối cuối (1 byte, 1 nếu là khối cuối)`, tag 16 byte. AAD chặn đảo thứ tự và cắt cụt file.
- **File 0 byte** là một khối rỗng. Kích thước bản mã tính trước được: `16 + n + max(1, ⌈n / 1 MiB⌉) × 16`, nên presigned PUT biết `Content-Length` từ đầu.
- Khi **giải mã**, cỡ khối trong header được chấp nhận từ 1 byte đến 64 MiB; ngoài khoảng là lỗi `bad_format`.
- **Thumbnail:** cùng định dạng, cùng `DEK`, nonce gốc ngẫu nhiên riêng.
- **Metadata (`enc_meta`):** `nonce 12 byte ‖ AES-256-GCM(MK, JSON)`, base64. JSON gồm `name`, `mime`, `kind`, và với liên kết thì `url`, `title`.
- **Khóa `enc_key`:** `nonce 12 byte ‖ AES-256-GCM(MK, DEK thô)`, base64.

### 7.3 Bộ đếm sai phía server

Mỗi lần sai được ghi bằng **một câu `UPDATE`** có điều kiện (tăng bộ đếm, khóa và xóa bí mật trong cùng một câu), nên hai request song song không tính thành một và không vượt được mốc khóa. Nếu câu đó không đổi dòng nào (một request song song vừa khóa hoặc xóa), server đọc lại và xử lý tiếp; sau 3 vòng thì trả `409 vault_busy`.

| Số lần sai liên tiếp | Phản hồi của `POST /vault/unlock` (hoặc `PUT /vault/pin` bằng `authKey` cũ) | Ghi chú |
|---|---|---|
| 1–4 | `403` `{ remaining, lockedUntil: null }` | nhập lại ngay; `remaining = 10 − số lần sai` |
| 5 | `423` `{ remaining: 5, lockedUntil }`, khóa **1 phút** | |
| 6–9 | `423` `{ remaining, lockedUntil }`, mỗi lần sai khóa **15 phút** | |
| 10 | `410 vault_wiped`; server xóa `auth_hash`, `server_secret`, `wrapped_mk_pin` | Két còn `wrapped_mk_recovery` và `rk_auth_hash`: chỉ recovery key mở được |

- **Đúng PIN:** bộ đếm về 0, trả `serverSecret` và `wrappedMkPin`.
- **Đang khóa:** mọi `authKey` (kể cả đúng) nhận `423`, không được đếm.
- **Đã xóa bí mật:** `unlock` và `PUT /vault/pin` bằng `authKey` trả `410`.
- Cố tình làm khóa két là có thể (người có token gửi sai PIN). Chấp nhận, đã chốt ở [ADR 0013](../decisions/0013-ket-sat-ma-hoa-phia-client.md).
- So sánh hằng thời gian `SHA-256(authKey)` với `auth_hash`.

### 7.4 Recovery key

- **128 bit**, mã hóa bằng Crockford base32: 26 ký tự mang 128 bit (2 bit đệm bằng 0), cộng **1 ký tự kiểm tra** (tổng có trọng số, mod 32), in thành các nhóm 4 ký tự, nối bằng `-`.
- Hiện **một lần** khi thiết lập, có nút sao chép. Để xác nhận đã cất, người dùng gõ lại **2 nhóm ngẫu nhiên** (chọn ngẫu nhiên trong reducer của trình thiết lập).
- Dùng khi: quên PIN két, PIN két đã bị server xóa bí mật, hoặc đặt lại PIN. Đặt lại PIN bằng recovery key **không mã hóa lại file**: `MK` không đổi, chỉ được bọc lại bằng PIN mới.
- **Không đếm, không khóa:** `rkAuth` 128 bit không đoán được, nên `POST /vault/recover` và `PUT /vault/pin` bằng `rkAuth` không tăng bộ đếm và không bị khóa, kể cả khi két đang khóa hoặc đã bị xóa bí mật. Sai thì `403 forbidden`.
- **Mất cả PIN lẫn recovery key là mất hết file trong két.** Không có đường lấy lại nào khác.

### 7.5 Những gì được mã hóa và những gì để rõ

| Được mã hóa (chỉ có bản mã trên server) | Để rõ với server và người có token |
|---|---|
| Nội dung file, thumbnail | Kích thước (`size` là kích thước bản mã) |
| Tên, loại (`mime`, `kind`) | Thời gian tải lên (`created_at`) |
| URL và tiêu đề liên kết | Thiết bị gửi (`device`, tên máy/trình duyệt) |
| Đều nằm trong `enc_meta` và `enc_key` | Thẻ màu (`tags`), cờ quan trọng (`important`) |
| | Số mục trong két, trạng thái (trong két hay thùng rác của két, thời điểm xóa), có thumbnail hay không |

- Tìm kiếm, sắp xếp theo tên và lọc tab chạy trên máy, nên server không biết những thao tác này.
- Liên kết trong két **không được server lấy xem trước**: `POST /links/:id/preview` trả `409 encrypted`, và cột `url` của mục trong két là `NULL`.
- File **trước khi có mã hóa** nằm trong két có thể đã bị thấy; mã hóa không lấy lại được điều đó.

### 7.6 Ghi chú về ghi đè

Mỗi lần cất vào két ghi một object riêng, tên `vault/<id>.<attempt>`, với `attempt` là 16 byte ngẫu nhiên. Hai máy (hoặc hai lần thử của một máy) không bao giờ ghi cùng một tên, nên không có ghi đè và không có giữ chỗ. Máy hoàn tất trước thì D1 trỏ tới object của nó (`enc_object`) cùng khóa mã hóa của nó; object của máy kia bị xóa. Chi tiết API: [api.md mục 4.3](api.md#43-két-sắt-mã-hóa). Lý do và các phương án đã loại (giữ chỗ, ETag, thông báo thời gian thực): [ADR 0015](../decisions/0015-mot-object-rieng-moi-lan-ma-hoa.md).

### 7.7 Giới hạn bảo mật còn lại

- **Mở két trên máy bị soi.** Máy có HTTPS bị soi (ví dụ máy công ty có Zscaler) thấy `S` và `wrapped_mk_pin` lúc mở két. Từ đó, admin mạng thử PIN offline được. **Quy tắc: không mở két trên máy công ty hoặc qua mạng bị soi HTTPS.** Chưa có công tắc chặn trong app ([Nợ kỹ thuật](roadmap.md#nợ-kỹ-thuật)).
- **Ai đọc được D1** (Cloudflare, người có quyền tài khoản Cloudflare) có `auth_hash` và `kdf_salt`, nên thử được PIN offline mà không cần `S`. Ngoài phạm vi: mối đe dọa đã chốt là mạng bị soi, không phải nhà cung cấp.
- **Mục ở trạng thái đám mây còn bản rõ.** Từ lúc cất bắt đầu tới khi mã hóa xong (đám mây mờ, `encrypted = 0`), bản rõ vẫn nằm trên R2 và người có token đọc được, như mọi mục chưa mã hóa. Một lần cất bị bỏ dở để mục ở trạng thái này cho tới lần mở két sau.
- **Bản rõ sót lại khi lấy ra bị ngắt.** Nếu client chết giữa lúc lấy ra, bản rõ `files/<id>` tồn tại tới lần cron sau (cron chạy lúc 03:00 UTC và dọn bản có `out_started_at` cũ hơn 1 giờ), nên có thể sống tới khoảng **25 giờ**. Trong khoảng đó người có token đọc được bản rõ đó. Mục vẫn mã hóa và không mất dữ liệu.
- **Complete muộn đụng cron: đã đóng.** Cron xóa object `vault/<id>.<attempt>` tuổi trên 1 giờ mà hàng không trỏ tới. Để cron và một lần `vault/in/complete` không bao giờ chạm cùng một object, `complete` **từ chối object (và thumbnail) đã nằm trên R2 quá 45 phút** bằng 409 `upload_too_old`: không ghi D1, xóa object của lần thử đó, mục giữ nguyên bản rõ và lần mở két sau mã hóa lại bằng một `attempt` mới. Còn 15 phút đệm giữa 45 và 60 phút.
- **Khe cron (M1).** Giữa lúc cron nhả `out_started_at` và lúc xóa object, một lần lấy ra hợp lệ chỉ hoàn tất trong vài giây thì bản rõ mới có thể bị xóa. Chỉ xảy ra lúc 03:00 UTC.
- **AAD chưa gắn với id (M6).** `enc_meta` và `DEK` không được ràng buộc với id mục. Người ghi được cả D1 lẫn R2 có thể hoán đổi hai mục. Người chỉ có API token thì không làm được. Nâng cấp lên FUV2 nằm ở [Nợ kỹ thuật](roadmap.md#nợ-kỹ-thuật).
- **Thumbnail trong két** dùng presigned GET 1 giờ, giống thumbnail thường (xem [Nợ kỹ thuật](roadmap.md#nợ-kỹ-thuật), M3).
- **Mất PIN và recovery key đồng thời** thì file trong két không thể lấy lại. Đây là hệ quả có chủ ý của việc mã hóa phía client.
- **Khóa giữ trong bộ nhớ tới 6 giờ.** Sau lần nhập PIN đúng, khóa `MK` được giữ tối đa 6 giờ để cất file vào két mà không hỏi PIN. Trong khoảng đó, kẻ kiểm soát app đang chạy hoặc trang đang chạy có thể cất file vào két, nhưng **không đọc được**: đọc cần quyền xem, tức cần PIN. Khóa không bao giờ ra mạng. Khóa app, đăng xuất, đặt lại, hết hạn hoặc đóng app thì khóa bị xóa ngay. Quyết định và lý do: [ADR 0016](../decisions/0016-phien-ket-sat-6-gio.md).
- **Khóa còn lại sau lượt mở bị dở.** Bấm lùi ở cổng khi lần mở đang chạy, hoặc rời trình thiết lập lúc đang gửi lên server, có thể để khóa được giữ tới 6 giờ. Quyền xem không được cấp trong trường hợp này, nhưng khóa vẫn còn.
- **Byte đã giải mã có thể lọt sau khi rời két.** Lượt tải đang chạy (`serve`, `fileBytes`) khi người dùng rời màn Két sắt vẫn có thể trả byte đã giải mã, vì sau khi tải không kiểm tra lại quyền xem.
- **Đổi PIN không cần mở két.** Đổi PIN chạy khi app đã mở khóa, bằng PIN cũ, kể cả khi két đang đóng hoặc chỉ đang giữ khóa. Ai biết PIN cũ thì đổi được PIN.
- **Thử lại mục đám mây mờ.** Mỗi lần danh sách két được tải khi đang xem, mục chưa mã hóa xong được thử mã hóa lại bằng khóa đang giữ. Không mở thêm quyền nào.
