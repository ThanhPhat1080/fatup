-- End-to-end encrypted Vault. See docs/superpowers/specs/2026-11-17-vault-e2ee-design.md, section 4.3.
ALTER TABLE files ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0;  -- 1 = content and metadata are encrypted
ALTER TABLE files ADD COLUMN enc_meta  TEXT;                         -- base64, NULL when encrypted = 0
ALTER TABLE files ADD COLUMN enc_key   TEXT;                         -- file key wrapped with the Vault key, base64
ALTER TABLE files ADD COLUMN out_started_at INTEGER;                 -- epoch ms of the last vault/out; cleared by vault/out/complete, the cron sweeps plain leftovers when it stays set

ALTER TABLE files ADD COLUMN in_claim TEXT;                          -- token of the device that may write vault/<id> now (vault/in); cleared by vault/in/complete
ALTER TABLE files ADD COLUMN in_claim_until INTEGER;                 -- epoch ms; the claim is free again once it passed

CREATE TABLE vault_keys (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),  -- one user, one Vault
  kdf_salt            TEXT NOT NULL,
  kdf_iterations      INTEGER NOT NULL,
  auth_hash           TEXT,          -- NULL once wiped after 10 wrong attempts
  server_secret       TEXT,          -- NULL once wiped
  wrapped_mk_pin      TEXT,          -- NULL once wiped
  rk_auth_hash        TEXT NOT NULL,
  wrapped_mk_recovery TEXT NOT NULL,
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        INTEGER,       -- epoch ms
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
