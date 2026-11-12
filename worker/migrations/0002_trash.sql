-- Soft delete: a file in the trash keeps its R2 objects until it is purged (30 days) or deleted forever.
ALTER TABLE files ADD COLUMN deleted_at INTEGER;
-- Set when a file is restored, so the 30-day retention clock restarts instead of purging it right away.
ALTER TABLE files ADD COLUMN retain_from INTEGER;

CREATE INDEX idx_files_trash ON files (deleted_at, id) WHERE deleted_at IS NOT NULL;
