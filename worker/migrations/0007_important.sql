-- "Important" marker (like Gmail's): any file, photo or link can carry it; it sorts first and has its own quick filter.
ALTER TABLE files ADD COLUMN important INTEGER NOT NULL DEFAULT 0;
