# Dữ liệu (D1)

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 3. Dữ liệu (D1)

```sql
-- 0001_init.sql
CREATE TABLE files (
  id          TEXT PRIMARY KEY,           -- ULID (sort được theo thời gian)
  name        TEXT NOT NULL,              -- tên gốc
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,           -- bytes
  kind        TEXT NOT NULL CHECK (kind IN ('image','file','text')),
  has_thumb   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL CHECK (status IN ('pending','ready')),
  device      TEXT,                       -- tên thiết bị gửi, vd "Pixel 8"
  created_at  INTEGER NOT NULL            -- epoch ms, thời điểm upload hoàn tất
);

-- 0002_trash.sql
ALTER TABLE files ADD COLUMN deleted_at  INTEGER;   -- NULL = không ở thùng rác
ALTER TABLE files ADD COLUMN retain_from INTEGER;   -- không còn dùng (trước đây: mốc tính hạn 30 ngày sau khôi phục); cột giữ lại để không cần migration

-- 0003_vault.sql
ALTER TABLE files ADD COLUMN in_vault INTEGER NOT NULL DEFAULT 0;   -- 1 = đang ở két sắt

-- 0004_tags.sql
ALTER TABLE files ADD COLUMN tags TEXT NOT NULL DEFAULT '';          -- tên màu cách nhau bằng dấu phẩy, tối đa 3, theo thứ tự thêm

-- 0005_links.sql: dựng lại bảng (SQLite không sửa được CHECK) để kind nhận thêm 'link', cộng 3 cột:
--   url TEXT                       -- địa chỉ đã chuẩn hóa của link, NULL với file
--   previewed_at INTEGER           -- lần cuối server đọc trang để xem trước (kể cả thất bại), NULL = chưa; client không dựa vào cột này
--   title_set INTEGER NOT NULL DEFAULT 0  -- 1 = tiêu đề do người dùng/share sheet đặt, xem trước không được ghi đè

-- 0008_shares.sql: bảng `shares` + trigger thu hồi, không đụng bảng `files`
CREATE TABLE shares (
  token          TEXT PRIMARY KEY,                       -- 24 byte ngẫu nhiên, base64url (32 ký tự)
  file_id        TEXT NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,  -- tối đa một link mỗi file
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER,                                -- NULL = không hết hạn
  downloads      INTEGER NOT NULL DEFAULT 0,
  last_access_at INTEGER
);
CREATE TRIGGER shares_revoke_on_hide AFTER UPDATE OF deleted_at, in_vault ON files
WHEN NEW.deleted_at IS NOT NULL OR NEW.in_vault = 1
BEGIN DELETE FROM shares WHERE file_id = NEW.id; END;

-- 0009_vault_e2ee.sql: két sắt mã hóa phía client (mục 7.1–7.6 của security.md)
ALTER TABLE files ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0;  -- 1 = nội dung và metadata đã mã hóa
ALTER TABLE files ADD COLUMN enc_meta  TEXT;                         -- base64, NULL khi encrypted = 0
ALTER TABLE files ADD COLUMN enc_key   TEXT;                         -- DEK bọc bằng MK, base64
ALTER TABLE files ADD COLUMN out_started_at INTEGER;                 -- lúc vault/out gần nhất; vault/out/complete xóa; cron dọn bản rõ sót nếu còn quá 1 giờ
ALTER TABLE files ADD COLUMN enc_object TEXT;                        -- attempt có object vault/<id>.<attempt>[.thumb] chứa bản mã (vault/in/complete ghi); NULL = khóa cố định vault/<id>

CREATE TABLE vault_keys (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),  -- một người dùng, một két (luôn một dòng)
  kdf_salt            TEXT NOT NULL,                       -- salt của PBKDF2 (base64)
  kdf_iterations      INTEGER NOT NULL,                    -- số vòng PBKDF2 của PIN két
  auth_hash           TEXT,                                -- SHA-256(authKey) hex; NULL sau khi bị xóa vì sai 10 lần
  server_secret       TEXT,                                -- S (base64); NULL sau khi bị xóa
  wrapped_mk_pin      TEXT,                                -- MK bọc bằng KEK của PIN (base64); NULL sau khi bị xóa
  rk_auth_hash        TEXT NOT NULL,                       -- SHA-256(rkAuth) hex
  wrapped_mk_recovery TEXT NOT NULL,                       -- MK bọc bằng khóa của recovery key (base64)
  failed_attempts     INTEGER NOT NULL DEFAULT 0,          -- số lần sai liên tiếp; về 0 khi đúng
  locked_until        INTEGER,                             -- epoch ms; NULL khi không khóa
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
```

- `kind = 'image'` khi `mime` bắt đầu bằng `image/`, còn lại là `'file'`.
- R2 key: `files/<id>` cho file gốc, `thumbs/<id>.jpg` cho thumbnail (bản rõ). Mục mã hóa bằng `vault/<id>.<attempt>` và `vault/<id>.<attempt>.thumb` (bản mã FUV1), với `attempt` là `enc_object` của mục. Mục đưa thẳng vào két khi upload (không qua `vault/in`) có `enc_object` NULL và dùng khóa cố định `vault/<id>` và `vault/<id>.thumb`. Cột `encrypted` quyết định cặp nào đang áp dụng; `enc_object` quyết định tên cặp mã hóa.
- `enc_object` là tên của lần cất đã thắng (`vault/in/complete`); `vault/out/complete` đặt lại NULL. Mọi chỗ lấy khóa đi qua `objectKeys(row)` (`worker/src/presign.ts`).
- **Mục đã mã hóa** (`encrypted = 1`): `name = ''`, `mime = 'application/octet-stream'`, `kind = 'file'`, `url = NULL`; giá trị thật nằm trong `enc_meta`. `size` là kích thước bản mã.
- `in_vault = 1` cũng là thùng rác của két khi `deleted_at` có giá trị. `deleted_at` và `in_vault` là hai cột độc lập: thùng rác thường là `deleted_at IS NOT NULL AND in_vault = 0`.
- `0009` chỉ thêm cột và bảng, không đổi dữ liệu cũ; mọi dòng hiện có có `encrypted = 0`.
- Hằng số liên quan: `MAX_ENC_META = 8192`, `MAX_ENC_KEY = 512` ký tự (validate ở API, không ở schema).
- Migration chạy theo thứ tự. Mỗi lần nâng cấp: **migrate trước, deploy sau** (code mới đọc cột mới).

- **Ảnh nhập từ bucket không thêm cột nào.** Id của dòng được tính từ object nguồn (khóa + etag) nên khóa chính `id` là thứ chặn dòng trùng; `device` là tên thư mục nguồn. Xem [api.md 4.4](api.md#44-nhập-ảnh-từ-thư-mục-của-bucket).
