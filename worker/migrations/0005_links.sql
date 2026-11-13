-- Link bookmarks: kind = 'link' rows that have an address instead of an R2 object. SQLite cannot alter a CHECK
-- constraint, so the table is rebuilt with the wider list of kinds and three new columns.
CREATE TABLE files_new (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('image', 'file', 'text', 'link')),
  has_thumb    INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
  device       TEXT,
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  retain_from  INTEGER,
  in_vault     INTEGER NOT NULL DEFAULT 0,
  tags         TEXT NOT NULL DEFAULT '',
  -- Normalised address of a link; NULL for files.
  url          TEXT,
  -- When a preview (title and image) was last attempted, even if it found nothing; NULL = not yet.
  previewed_at INTEGER,
  -- 1 when the title came from the user or the share sheet, so a preview must not overwrite it.
  title_set    INTEGER NOT NULL DEFAULT 0
);

INSERT INTO files_new (id, name, mime, size, kind, has_thumb, status, device, created_at, deleted_at, retain_from, in_vault, tags)
SELECT id, name, mime, size, kind, has_thumb, status, device, created_at, deleted_at, retain_from, in_vault, tags FROM files;

DROP TABLE files;
ALTER TABLE files_new RENAME TO files;

CREATE INDEX idx_files_ready ON files (status, created_at DESC, id DESC);
CREATE INDEX idx_files_trash ON files (deleted_at, id) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_files_link_url ON files (url) WHERE kind = 'link';
