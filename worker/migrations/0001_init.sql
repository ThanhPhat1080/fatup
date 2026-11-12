CREATE TABLE files (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('image', 'file', 'text')),
  has_thumb   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
  device      TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_files_ready ON files (status, created_at DESC, id DESC);
