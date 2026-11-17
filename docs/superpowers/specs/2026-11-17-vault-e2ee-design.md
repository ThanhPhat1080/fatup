# Mã hóa Két sắt phía client (E2EE): thiết kế

Trạng thái: **chờ người dùng duyệt**. Viết ngày 2026-11-17 sau một buổi hỏi đáp thiết kế; người dùng đã đồng ý các câu Q1 đến Q7 ở mục 3. Các quyết định kỹ thuật ở mục 4 do Claude đề xuất và nằm ở mục 7 để người dùng xem lại. Thay đổi quyết định thì sửa file này trước, code sau; khi làm xong phải cập nhật `docs/spec/lifecycle.md` (5.2), `security.md`, `api.md`, `data.md`, `desktop-ui.md`, `web.md`, và viết ADR mới thay một phần ADR 0006.

## 1. Mục đích

Hiện nay Két sắt chỉ là lớp che ở giao diện: file vẫn nằm bình thường trên R2, ai có API token đều đọc được.

**Mối đe dọa cụ thể (người dùng nêu):** máy công ty có **Zscaler** soi HTTPS. Admin mạng đọc được mọi request đi qua máy đó, kể cả **API token**; có token thì tải được mọi file, gồm cả file trong két.

**Mục tiêu:** file trong két **không đọc được dù lộ token**, miễn là két chưa từng được mở trên máy bị soi.

## 2. Mục tiêu, không phải mục tiêu, điều phải tránh

**Mục tiêu**

- Nội dung, thumbnail, tên, loại, `mime` và URL (với liên kết) của mọi mục trong két được **mã hóa trên máy** trước khi rời máy. Server và R2 chỉ giữ bản mã.
- Mở két bằng **PIN két 6 số**, tách khỏi PIN app 4 số. **Server đếm số lần sai**, nên người có token không thể thử PIN offline.
- **Recovery key** cứu két khi quên PIN hoặc khi server đã xóa bí mật vì sai quá nhiều.
- Két có **thùng rác riêng**, file đã xóa vẫn mã hóa.
- Các file đang có trong két được mã hóa một lần khi thiết lập; bị ngắt thì làm tiếp lần sau.
- Có trên **desktop và web (PWA)**.

**Không làm (phase này)**

- **Android không mở được két** (ghi ở Nợ kỹ thuật trong `docs/spec/roadmap.md`).
- **Không có "Tắt két sắt trên thiết bị này"** (ghi ở Nợ kỹ thuật).
- Không che kích thước, thời gian, tên thiết bị gửi, thẻ màu.
- Không chống Cloudflare/người đọc được D1 (xem 4.8).
- Không chống phần mềm theo dõi cài sẵn trên máy (máy công ty do công ty kiểm soát).
- Liên kết thêm thẳng vào két không có ảnh xem trước.

**Điều phải tránh (thất bại dù code chạy)**

- Bất kỳ byte nội dung, tên file hay URL nào của mục trong két **lên server ở dạng đọc được**, kể cả trong lúc chuyển đổi.
- Object R2 chưa mã hóa **còn sót lại** sau khi một file đã được mã hóa xong.
- Người có token **thử PIN offline** được (lấy được thứ gì đó đủ để kiểm tra một PIN mà không hỏi server).
- App bản cũ cất file vào két **ở dạng chưa mã hóa** sau khi két đã thiết lập mã hóa.
- Khóa két (master key) xuất hiện ở renderer của desktop, hoặc được ghi xuống đĩa / `localStorage`.
- Mất file vì quên PIN khi người dùng **vẫn còn recovery key**.

## 3. Các quyết định đã chốt với người dùng

| # | Câu hỏi | Chốt |
|---|---|---|
| — | Cơ chế | Mã hóa phía client; **PIN két 6 số + server đếm số lần sai** (không dùng passphrase dài). Phase này không làm Android. |
| Q1 | Recovery key? | **Có.** Hiện một lần khi thiết lập; người dùng gõ lại vài ký tự để xác nhận đã cất. Dùng khi quên PIN, khi bí mật bị xóa, hoặc để đặt lại PIN. |
| Q2 | Nhập sai PIN két | Sai 1–4: nhập lại ngay. Lần 5: khóa 1 phút. Lần 6–9: mỗi lần khóa 15 phút. Lần 10: **server xóa bí mật**, chỉ recovery key mở được. Đúng thì bộ đếm về 0. Màn hình hiện số lần còn lại. Chấp nhận việc người có token cố tình làm khóa két. |
| Q3 | Mã hóa gì | Nội dung, thumbnail, tên/tiêu đề, `mime` + loại, URL liên kết. **Để nguyên:** kích thước, thời gian, thiết bị gửi, thẻ màu. Tìm kiếm, sắp xếp theo tên, lọc tab làm ở client. Liên kết trong két không được server lấy xem trước; đưa ra khỏi két thì trở lại bình thường. |
| Q4 | Mở két, giữ khóa | PIN két tách PIN app, cấm PIN yếu. Cổng két giữ hoạt họa, ô 6 số. Khóa chỉ trong bộ nhớ khi két mở (desktop: main process; web: bộ nhớ JS); thoát két là xóa. Lần đầu: đặt PIN → recovery key → xác nhận → mã hóa file cũ. Đổi PIN trong Cài đặt, cần PIN cũ hoặc recovery key, không mã hóa lại file. |
| Q5 | Chuyển đổi, app cũ | Chưa thiết lập: endpoint cũ chạy như cũ. Đã thiết lập: endpoint cũ luôn trả "Cần cập nhật app"; chỉ còn luồng mới. File cũ mã hóa từng cái, xóa object chưa mã hóa, có tiến trình, làm tiếp khi bị ngắt, đánh dấu "đang mã hóa". Dọn endpoint cũ: Nợ kỹ thuật. |
| Q6 | Dung lượng, kích thước | Thanh dung lượng tính kích thước bản mã. Giới hạn kích thước như upload thường. Mã hóa/giải mã theo luồng. Web tải về: Chromium ghi thẳng xuống đĩa; Safari/Firefox giới hạn ~500 MB, lớn hơn thì báo dùng desktop. **Ghi chú khi viết plan:** `MAX_FILE_SIZE` hiện là 100 MB, nên mọi file đều vừa bộ nhớ; web mã hóa/giải mã trong bộ nhớ trên mọi trình duyệt, không cần `showSaveFilePicker` và không có giới hạn riêng nào. |
| Q7 | Xóa trong két | **Thùng rác riêng của két**: file vẫn trong két, vẫn mã hóa; chỉ xem khi két mở; khôi phục / xóa vĩnh viễn / dọn sạch; Hoàn tác 8 giây; cron xóa sau 30 ngày; thùng rác thường không hiện file của két. |
| Q7-UI | Giao diện thùng rác két | Màn hình > 720px: **sidebar phải rộng 70%**, phía sau phủ tối, bấm ra ngoài thì đóng. ≤ 720px: **trang phủ toàn màn hình** có nút ←. Trong két: viền trên thanh trên cùng màu **vàng đồng**, nhãn `🔒 Két sắt · đã mã hóa`, nền ngả vàng rất nhẹ. Thùng rác két: header vàng đồng + **vạch đỏ bên trái**, icon két nhỏ đè lên thùng rác, tiêu đề "Thùng rác của Két sắt", dòng phụ "File đã xóa trong két · mã hóa · tự xóa sau 30 ngày". Nút mở đặt cạnh "Đóng Két sắt", chỉ hiện trong két; mở sidebar **không đóng két**. Có bản dark mode; chuỗi đủ `en`/`vi`. |

## 4. Thiết kế kỹ thuật

### 4.1 Các khóa

| Tên | Là gì | Ở đâu |
|---|---|---|
| `MK` (master key) | AES-256 ngẫu nhiên, sinh một lần khi thiết lập | Chỉ trong bộ nhớ khi két mở. Trên server chỉ có bản đã bọc |
| `DEK` (khóa từng file) | AES-256 ngẫu nhiên cho mỗi mục trong két | D1 cột `enc_key`, bọc bằng `MK` |
| `S` (bí mật của server) | 32 byte ngẫu nhiên, client sinh khi thiết lập | D1 `vault_keys.server_secret`; server **chỉ trả khi PIN đúng** |
| `P` | `PBKDF2-SHA256(PIN, salt, 600 000 vòng)` → 64 byte | Tính trên máy, không lưu |
| `authKey` | `HKDF(P, "fatup-vault-auth")` | Gửi lên khi mở két; server chỉ lưu `SHA-256(authKey)` |
| `KEK` | `HKDF(HKDF(P, "fatup-vault-wrap") ‖ S, "fatup-vault-kek")` | Tính trên máy; bọc `MK` → `wrapped_mk_pin` |
| `RK` (recovery key) | 128 bit ngẫu nhiên, hiển thị dạng base32 nhóm 4 ký tự | Chỉ người dùng giữ. Server lưu `SHA-256(HKDF(RK,"fatup-vault-rk-auth"))` và `MK` bọc bằng `HKDF(RK,"fatup-vault-rk-wrap")` → `wrapped_mk_recovery` |

**Vì sao người có token không thử PIN offline được:** thử một PIN cần `S`, mà `S` chỉ được trả khi server xác nhận `authKey` đúng, và server đếm số lần sai. `salt` và `wrapped_mk_pin` có lộ cũng vô dụng khi thiếu `S`. `RK` 128 bit nên `wrapped_mk_recovery` có lộ cũng không đoán được.

Mọi phép mã hóa dùng **WebCrypto** (`crypto.subtle`), có sẵn trong trình duyệt, Electron main (Node) và Worker, nên lõi viết **một lần** trong `shared/`.

### 4.2 Định dạng bản mã (phiên bản 1)

- Header: magic `FUV1` (4 byte) + độ dài khối (4 byte, mặc định 1 MiB) + nonce gốc ngẫu nhiên (8 byte).
- Mỗi khối: `AES-256-GCM(DEK, nonce = nonce gốc ‖ chỉ số khối 32 bit, AAD = chỉ số khối ‖ cờ khối-cuối)`. Thêm 16 byte tag mỗi khối. AAD chặn đảo thứ tự và cắt cụt file.
- Kích thước bản mã tính trước được từ kích thước gốc, nên presigned PUT biết `Content-Length` từ đầu.
- Thumbnail: cùng định dạng, cùng `DEK`, nonce gốc riêng.
- Metadata (`enc_meta`): `AES-256-GCM(MK, JSON { name, mime, kind, url?, title? })`, nonce ngẫu nhiên 12 byte, base64.

### 4.3 Dữ liệu (migration `0009_vault_e2ee.sql`)

```sql
ALTER TABLE files ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0;  -- 1 = nội dung + metadata đã mã hóa
ALTER TABLE files ADD COLUMN enc_meta  TEXT;                         -- base64, NULL khi encrypted = 0
ALTER TABLE files ADD COLUMN enc_key   TEXT;                         -- DEK bọc bằng MK, base64

CREATE TABLE vault_keys (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),  -- một người dùng, một két
  kdf_salt            TEXT NOT NULL,
  kdf_iterations      INTEGER NOT NULL,
  auth_hash           TEXT,          -- NULL sau khi bị xóa vì sai 10 lần
  server_secret       TEXT,          -- NULL sau khi bị xóa
  wrapped_mk_pin      TEXT,          -- NULL sau khi bị xóa
  rk_auth_hash        TEXT NOT NULL,
  wrapped_mk_recovery TEXT NOT NULL,
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        INTEGER,       -- epoch ms
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
```

- Mục đã mã hóa: `name = ''`, `mime = 'application/octet-stream'`, `kind = 'file'`, `url = NULL`; giá trị thật nằm trong `enc_meta`. `size` = kích thước bản mã.
- R2 key: chưa mã hóa giữ `files/<id>` và `thumbs/<id>.jpg`; đã mã hóa dùng `vault/<id>` và `vault/<id>.thumb`. Suy ra từ cột `encrypted`, không cần cột mới.

### 4.4 API

| Method | Path | Ghi chú |
|---|---|---|
| `GET` | `/vault` | `{ state: 'none' \| 'ready' \| 'wiped', kdf: { salt, iterations }?, failedAttempts, lockedUntil, remaining }`. Không bao giờ trả `auth_hash`, `server_secret` |
| `POST` | `/vault/setup` | Chỉ khi `state = none`. Body: salt, iterations, `authKey`, `serverSecret`, `wrappedMkPin`, `rkAuth`, `wrappedMkRecovery`. Server lưu hash của `authKey`, `rkAuth` |
| `POST` | `/vault/unlock` | Body `{ authKey }`. Đúng → `{ serverSecret, wrappedMkPin }`, bộ đếm về 0. Sai → 403 `{ remaining, lockedUntil }`; đang khóa → 423; đã xóa → 410 `vault_wiped`. So sánh hằng thời gian; tăng bộ đếm bằng một câu `UPDATE … RETURNING` để hai request song song không vượt giới hạn |
| `POST` | `/vault/recover` | Body `{ rkAuth }` → `{ wrappedMkRecovery }` |
| `PUT` | `/vault/pin` | Đặt PIN mới. Body: chứng minh bằng `authKey` cũ **hoặc** `rkAuth`, cộng salt, `authKey`, `serverSecret`, `wrappedMkPin` mới. Bộ đếm về 0, `state` trở lại `ready` |
| `POST` | `/uploads` | Thêm `{ vault: true, encMeta, encKey }` → presigned PUT tới `vault/<id>` |
| `POST` | `/files/:id/vault/in` | Trả presigned PUT cho `vault/<id>` (+ thumb). Client tải bản gốc, mã hóa, PUT |
| `POST` | `/files/:id/vault/in/complete` | Body `{ encMeta, encKey, size, hasThumb }`. Server kiểm tra object mới tồn tại, ghi D1 (`encrypted = 1`, `in_vault = 1`, xóa trắng cột metadata), **rồi xóa `files/<id>` và `thumbs/<id>.jpg`** |
| `POST` | `/files/:id/vault/out` + `/complete` | Chiều ngược lại: client giải mã, PUT về `files/<id>`, complete ghi metadata thật, `encrypted = 0`, `in_vault = 0`, rồi xóa `vault/<id>*`. Liên kết được lấy xem trước lại như thường |
| `GET` | `/files?vault=1[&trash=1]` | Cần header `X-FatUp-Vault: 2` khi `state ≠ none`; thiếu thì 426 `app_outdated`. `trash=1` trả thùng rác của két |
| `GET` | `/files?trash=1` | **Không** trả mục có `in_vault = 1` nữa |
| `PUT` | `/files/:id/vault` | `state = none`: như cũ. `state ≠ none`: luôn 426 `app_outdated` |
| `DELETE` | `/files/:id` | Mục có `in_vault = 1` **giữ `in_vault = 1`** (vào thùng rác của két). Mục khác như cũ |

Cron xóa vĩnh viễn và `DELETE /files/:id?permanent` xóa đúng R2 key theo cột `encrypted`. Xem trước liên kết bỏ qua mục `encrypted = 1`.

### 4.5 Desktop

- Lõi mã hóa chạy ở **main process**. `MK` nằm trong biến của main, thay cho cờ `vaultOpen`; đóng két là ghi đè và bỏ tham chiếu.
- Renderer chỉ nhận danh sách đã giải mã (tên, loại…); không bao giờ nhận `MK`, `DEK`, `S`. Thumbnail và ảnh/PDF trong két đi qua một scheme riêng `fatup-vault://` do main phục vụ từ bộ nhớ (chỉ khi két mở), **không** ghi vào kho ảnh xem trước trên đĩa.
- Upload vào két, tải về, mở xem trước: main đọc/ghi theo luồng (1 MiB một khối).
- Kiểm tra PIN yếu ở main: cấm 6 số giống nhau, dãy tăng/giảm liên tiếp, và PIN có 4 số đầu hoặc 4 số cuối trùng PIN app (kiểm tra bằng hash PIN app sẵn có, **không** tính vào bộ đếm sai của màn hình khóa).

### 4.6 Web

- Lõi mã hóa trong `web/src/vault.ts` (dùng chung `shared/`). `MK` trong bộ nhớ JS, không ghi `localStorage`/IndexedDB.
- Upload vào két: mã hóa từng khối thành `Blob` rồi PUT. Tải về: giải mã vào bộ nhớ rồi lưu như hiện nay. File tối đa `MAX_FILE_SIZE` (100 MB) nên không cần ghi theo luồng xuống đĩa.
- Thumbnail và ảnh trong két: giải mã thành `blob:` URL trong bộ nhớ, không lưu vào kho ảnh xem trước (IndexedDB); đóng két thì `revokeObjectURL`.
- Kiểm tra PIN yếu như desktop (PIN app trên web cũng chỉ kiểm tra cục bộ).

### 4.7 Thiết lập và chuyển đổi

1. Bấm két khi `state = none` → trình thiết lập: nhập PIN két 2 lần → hiện `RK` (có nút sao chép) → gõ lại 2 nhóm ngẫu nhiên của `RK` → `POST /vault/setup`.
2. Ngay sau đó, và mỗi lần mở két khi còn mục `in_vault = 1 AND encrypted = 0`: chạy `vault/in` cho từng mục, có thanh tiến trình; mục chưa xong hiện dấu "đang mã hóa".
3. Mục trong thùng rác thường (`in_vault = 0`) thì không động tới. Mục chưa mã hóa nằm trong **thùng rác của két** (`in_vault = 1`, `deleted_at` có giá trị: bị xóa trong két sau khi deploy Worker mới nhưng trước khi thiết lập) **cũng được mã hóa**, và vẫn ở thùng rác của két. `vault/in` và `vault/in/complete` nhận các mục này; `vault/out` thì không (phải khôi phục trước).

### 4.8 Giới hạn bảo mật còn lại

- **Mở két trên máy bị soi** thì admin bắt được `S` và `wrapped_mk_pin`, sau đó thử 1 triệu PIN offline trong vài phút. Quy tắc: không mở két trên máy công ty (chưa có công tắc chặn, xem Nợ kỹ thuật).
- **Ai đọc được D1** (Cloudflare, người có quyền tài khoản Cloudflare) có cả `auth_hash` lẫn `S`, nên thử PIN offline được. Ngoài phạm vi: mối đe dọa đã chốt là mạng bị soi, không phải nhà cung cấp.
- Metadata để nguyên (kích thước, thời gian, thiết bị, thẻ màu) và số mục trong két vẫn lộ với người có token.
- File nằm trong két **trước** khi có mã hóa có thể đã bị thấy; mã hóa không lấy lại được.

## 5. Kiểm thử

- `shared/`: vector cố định cho định dạng `FUV1`; đảo khối, cắt khối cuối, sửa một byte đều bị từ chối; khối rỗng / file 0 byte / file đúng bội số 1 MiB.
- Worker: bộ đếm sai (1–4, 5, 6–9, 10 → xóa), khóa theo thời gian, hai request song song không vượt giới hạn, `GET /vault` không lộ bí mật, `PUT /files/:id/vault` trả 426 sau khi thiết lập, `DELETE` giữ `in_vault`, `trash=1` không trả mục két, `vault/in/complete` xóa object cũ, cron xóa đúng key.
- Desktop/web: đặt PIN → recovery key → mã hóa file cũ (kể cả bị ngắt giữa chừng); mở két sai/đúng; khôi phục bằng `RK`; đổi PIN; upload, tải, xem trước trong két; cất vào / lấy ra; thùng rác két; renderer không bao giờ nhận `MK` (test IPC).
- `e2e-verifier`: giao diện thiết lập, cổng 6 số, màu vàng đồng, sidebar 70% / trang phủ ở ≤ 720px.

## 6. Nâng cấp (cho CHANGELOG)

1. Sao lưu D1.
2. `npm run db:migrate:remote` (áp dụng `0009`), **rồi** `npm run deploy`.
3. Cập nhật app desktop trên **mọi** máy và tải lại bản web.
4. Trên máy cá nhân: mở két → thiết lập → **cất recovery key vào trình quản lý mật khẩu** → đợi mã hóa xong.
5. Không mở két trên máy công ty.

## 7. Quyết định do Claude tự đưa ra (cần xem lại)

1. **PBKDF2-SHA256 600 000 vòng** thay vì Argon2id: có sẵn trong WebCrypto, không cần thư viện WASM; độ khó KDF ít quan trọng vì bảo vệ chính là `S` + bộ đếm của server.
2. **Mỗi file một `DEK`** bọc bằng `MK`, thay vì dùng thẳng `MK`: giới hạn số lần dùng một khóa với AES-GCM và cho phép đổi `MK` sau này mà không mã hóa lại file.
3. **Client sinh `S`** khi thiết lập (thay vì server sinh): cùng mức lộ, đỡ một vòng request.
4. **Khối 1 MiB**, định dạng có magic + phiên bản (`FUV1`) để đổi định dạng sau này.
5. **R2 key riêng `vault/<id>`** cho bản mã, để không bao giờ ghi đè object chưa mã hóa trước khi bản mã đã lên xong.
6. **Header `X-FatUp-Vault: 2`** để nhận ra app mới, và mã lỗi **426 `app_outdated`** cho app cũ.
7. Đổi `DELETE` thành **giữ `in_vault = 1` cho mọi mục trong két** (kể cả trước khi thiết lập), và thùng rác thường không hiện chúng.
8. `RK` dạng **base32, 128 bit, nhóm 4 ký tự**; xác nhận bằng cách gõ lại **2 nhóm ngẫu nhiên**.
9. ~~Web trên Safari/Firefox giới hạn ~500 MB~~: không cần, vì `MAX_FILE_SIZE` = 100 MB. Server so giới hạn với kích thước bản mã, nên cho phép `MAX_FILE_SIZE` cộng phần tăng của định dạng (`vaultCiphertextSize(MAX_FILE_SIZE)`).
10. Không giới hạn số lần thử `rkAuth` (128 bit, không đoán được).
