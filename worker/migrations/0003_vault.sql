-- Vault: files hidden from the main list. The desktop/web apps only show them after the PIN is re-entered.
ALTER TABLE files ADD COLUMN in_vault INTEGER NOT NULL DEFAULT 0;
