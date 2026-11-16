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
```

- `kind = 'image'` khi `mime` bắt đầu bằng `image/`, còn lại là `'file'`.
- R2 key: `files/<id>` cho file gốc, `thumbs/<id>.jpg` cho thumbnail.
- Migration chạy theo thứ tự. Mỗi lần nâng cấp: **migrate trước, deploy sau** (code mới đọc cột mới).
