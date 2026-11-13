-- Colour tags: a comma-separated list of colour names (max 3), in the order they were added.
ALTER TABLE files ADD COLUMN tags TEXT NOT NULL DEFAULT '';
