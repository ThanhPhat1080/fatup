-- Public share links: one row per shared photo or file.
-- Adds a table and a trigger only; the `files` table is not rebuilt.
CREATE TABLE shares (
  token          TEXT PRIMARY KEY,                                              -- 24 random bytes, base64url (32 characters)
  file_id        TEXT NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,   -- at most one link per file
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER,                                                       -- NULL = never expires
  downloads      INTEGER NOT NULL DEFAULT 0,
  last_access_at INTEGER                                                        -- last time someone opened the page or downloaded
);

-- A link is dead for good the moment its file goes to the trash or the Vault, whichever route did it.
-- Restoring or taking the file out again must not bring the link back; sharing again makes a new one.
CREATE TRIGGER shares_revoke_on_hide
AFTER UPDATE OF deleted_at, in_vault ON files
WHEN NEW.deleted_at IS NOT NULL OR NEW.in_vault = 1
BEGIN
  DELETE FROM shares WHERE file_id = NEW.id;
END;
