import type { Context, Hono } from 'hono';
import {
  VAULT_LOCK_RULES,
  VAULT_WIPE_AT,
  type VaultPinRequest,
  type VaultRecoverRequest,
  type VaultSetupRequest,
  type VaultStatus,
  type VaultUnlockRequest,
  type VaultUnlockResponse,
} from '@fatup/shared';
import type { AppEnv } from './app';
import { fail } from './app';

type VaultRow = {
  kdf_salt: string;
  kdf_iterations: number;
  auth_hash: string | null;
  server_secret: string | null;
  wrapped_mk_pin: string | null;
  rk_auth_hash: string;
  wrapped_mk_recovery: string;
  failed_attempts: number;
  locked_until: number | null;
};

type Ctx = Context<AppEnv>;

const MAX_B64_LENGTH = 4096;
const MIN_SECRET_BYTES = 16;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Decodes strict standard base64 (with padding) of at least `MIN_SECRET_BYTES` bytes; null for anything else. */
function decodeB64(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length > MAX_B64_LENGTH || !B64.test(value)) return null;
  const bin = atob(value);
  if (bin.length < MIN_SECRET_BYTES) return null;
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Lowercase hex SHA-256 of the decoded bytes; what the table stores instead of `authKey` / `rkAuth`. */
async function hashOf(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

/** Hashes the candidate, then compares two equal-length digests in constant time. */
async function matches(candidate: Uint8Array, storedHex: string): Promise<boolean> {
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', candidate));
  const b = fromHex(storedHex);
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

async function readBody(c: Ctx): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const readRow = (c: Ctx) => c.env.DB.prepare('SELECT * FROM vault_keys WHERE id = 1').first<VaultRow>();

const badRequest = (c: Ctx, message: string) => fail(c, 400, 'bad_request', message);
const notReady = (c: Ctx) => fail(c, 409, 'vault_not_ready', 'The Vault has not been set up');
const wiped = (c: Ctx) => fail(c, 410, 'vault_wiped', 'The Vault keys were wiped; use the recovery key');

const remainingOf = (attempts: number) => Math.max(0, VAULT_WIPE_AT - attempts);

/** The lock length for the counter value after an attempt, as a SQL expression over `failed_attempts + 1`. */
function lockMsSql(): string {
  const next = 'failed_attempts + 1';
  const rules = [...VAULT_LOCK_RULES].sort((a, b) => b.from - a.from);
  const whens = rules.map((r) => `WHEN ${next} >= ${r.from | 0} THEN ? + ${r.ms | 0}`).join(' ');
  return `CASE WHEN ${next} >= ${VAULT_WIPE_AT | 0} THEN NULL ${whens} ELSE NULL END`;
}

/**
 * Records one wrong PIN. The increment, the lock and the wipe happen in this single statement, so parallel
 * requests can neither be counted as one nor push past a lock. It only touches a Vault that still holds a PIN
 * hash and is not locked; otherwise it changes nothing and returns no row.
 */
export const WRONG_ATTEMPT_SQL = `UPDATE vault_keys SET
  failed_attempts = failed_attempts + 1,
  locked_until = ${lockMsSql()},
  auth_hash = CASE WHEN failed_attempts + 1 >= ${VAULT_WIPE_AT | 0} THEN NULL ELSE auth_hash END,
  server_secret = CASE WHEN failed_attempts + 1 >= ${VAULT_WIPE_AT | 0} THEN NULL ELSE server_secret END,
  wrapped_mk_pin = CASE WHEN failed_attempts + 1 >= ${VAULT_WIPE_AT | 0} THEN NULL ELSE wrapped_mk_pin END,
  updated_at = ?
WHERE id = 1 AND auth_hash IS NOT NULL AND (locked_until IS NULL OR locked_until <= ?)
RETURNING failed_attempts, locked_until, auth_hash`;

const lockedBody = (row: Pick<VaultRow, 'failed_attempts' | 'locked_until'>) => ({
  remaining: remainingOf(row.failed_attempts),
  lockedUntil: row.locked_until,
});

const isLocked = (row: VaultRow, now: number) => row.locked_until !== null && row.locked_until > now;

/**
 * Checks `authKey` against the stored PIN hash for unlock and for a PIN change by the old PIN.
 * Returns a Response when the attempt must stop (wiped, locked, wrong), or null when the PIN is right.
 * A locked Vault refuses even the right PIN and counts nothing.
 */
async function checkPin(c: Ctx, row: VaultRow, authKey: Uint8Array): Promise<Response | null> {
  for (let tries = 0; tries < 3; tries++) {
    const now = Date.now();
    if (row.auth_hash === null) return wiped(c);
    if (isLocked(row, now)) return c.json(lockedBody(row), 423);
    if (await matches(authKey, row.auth_hash)) return null;

    const lockArgs = VAULT_LOCK_RULES.map(() => now);
    const hit = await c.env.DB.prepare(WRONG_ATTEMPT_SQL)
      .bind(...lockArgs, now, now)
      .first<Pick<VaultRow, 'failed_attempts' | 'locked_until' | 'auth_hash'>>();
    if (hit) {
      if (hit.auth_hash === null) return wiped(c);
      return c.json(lockedBody(hit), hit.locked_until !== null && hit.locked_until > now ? 423 : 403);
    }
    // Nothing was updated: a parallel request locked or wiped the Vault first. Look again.
    const fresh = await readRow(c);
    if (!fresh) return notReady(c);
    row = fresh;
  }
  return fail(c, 409, 'vault_busy', 'The Vault changed while checking; try again');
}

/** The ways a PIN replacement can be proven. */
type Proof = { kind: 'authKey'; bytes: Uint8Array } | { kind: 'rkAuth'; bytes: Uint8Array };

export function registerVaultRoutes(app: Hono<AppEnv>): void {
  app.get('/vault', async (c) => {
    const row = await readRow(c);
    if (!row) {
      const none: VaultStatus = { state: 'none', failedAttempts: 0, lockedUntil: null, remaining: VAULT_WIPE_AT };
      return c.json(none);
    }
    const isWiped = row.auth_hash === null;
    const status: VaultStatus = {
      state: isWiped ? 'wiped' : 'ready',
      kdf: { salt: row.kdf_salt, iterations: row.kdf_iterations },
      failedAttempts: row.failed_attempts,
      lockedUntil: isLocked(row, Date.now()) ? row.locked_until : null,
      remaining: isWiped ? 0 : remainingOf(row.failed_attempts),
    };
    return c.json(status);
  });

  app.post('/vault/setup', async (c) => {
    const body = (await readBody(c)) as Partial<Record<keyof VaultSetupRequest, unknown>> | null;
    if (!body) return badRequest(c, 'Body must be JSON');
    const authKey = decodeB64(body.authKey);
    const rkAuth = decodeB64(body.rkAuth);
    if (
      !decodeB64(body.kdfSalt) ||
      !isPositiveInt(body.kdfIterations) ||
      !authKey ||
      !decodeB64(body.serverSecret) ||
      !decodeB64(body.wrappedMkPin) ||
      !rkAuth ||
      !decodeB64(body.wrappedMkRecovery)
    ) {
      return badRequest(c, 'kdfSalt, kdfIterations, authKey, serverSecret, wrappedMkPin, rkAuth and wrappedMkRecovery must be valid');
    }
    const now = Date.now();
    const res = await c.env.DB.prepare(
      `INSERT INTO vault_keys (id, kdf_salt, kdf_iterations, auth_hash, server_secret, wrapped_mk_pin, rk_auth_hash, wrapped_mk_recovery, failed_attempts, locked_until, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
      .bind(body.kdfSalt, body.kdfIterations, await hashOf(authKey), body.serverSecret, body.wrappedMkPin, await hashOf(rkAuth), body.wrappedMkRecovery, now, now)
      .run();
    if (!res.meta.changes) return fail(c, 409, 'vault_exists', 'The Vault is already set up');
    return c.json({ ok: true }, 201);
  });

  app.post('/vault/unlock', async (c) => {
    const body = (await readBody(c)) as Partial<VaultUnlockRequest> | null;
    if (!body) return badRequest(c, 'Body must be JSON');
    const authKey = decodeB64(body.authKey);
    if (!authKey) return badRequest(c, 'authKey must be base64');

    const row = await readRow(c);
    if (!row) return notReady(c);
    const stop = await checkPin(c, row, authKey);
    if (stop) return stop;

    // Right PIN: reset the counter, unless a parallel wrong PIN locked or wiped the Vault since we looked.
    const now = Date.now();
    const ok = await c.env.DB.prepare(
      `UPDATE vault_keys SET failed_attempts = 0, locked_until = NULL, updated_at = ?
       WHERE id = 1 AND auth_hash = ? AND (locked_until IS NULL OR locked_until <= ?)
       RETURNING server_secret, wrapped_mk_pin`,
    )
      .bind(now, row.auth_hash, now)
      .first<{ server_secret: string; wrapped_mk_pin: string }>();
    if (!ok) {
      const fresh = await readRow(c);
      if (!fresh) return notReady(c);
      if (fresh.auth_hash === null) return wiped(c);
      if (isLocked(fresh, now)) return c.json(lockedBody(fresh), 423);
      return fail(c, 409, 'vault_busy', 'The Vault changed while unlocking; try again');
    }
    const res: VaultUnlockResponse = { serverSecret: ok.server_secret, wrappedMkPin: ok.wrapped_mk_pin };
    return c.json(res);
  });

  app.post('/vault/recover', async (c) => {
    const body = (await readBody(c)) as Partial<VaultRecoverRequest> | null;
    if (!body) return badRequest(c, 'Body must be JSON');
    const rkAuth = decodeB64(body.rkAuth);
    if (!rkAuth) return badRequest(c, 'rkAuth must be base64');
    const row = await readRow(c);
    if (!row) return notReady(c);
    if (!(await matches(rkAuth, row.rk_auth_hash))) return fail(c, 403, 'forbidden', 'Wrong recovery key');
    return c.json({ wrappedMkRecovery: row.wrapped_mk_recovery });
  });

  app.put('/vault/pin', async (c) => {
    const body = (await readBody(c)) as (Partial<Omit<VaultPinRequest, 'proof'>> & { proof?: unknown }) | null;
    if (!body) return badRequest(c, 'Body must be JSON');

    const rawProof = body.proof && typeof body.proof === 'object' && !Array.isArray(body.proof) ? (body.proof as Record<string, unknown>) : null;
    let proof: Proof | null = null;
    if (rawProof && (rawProof.authKey === undefined) !== (rawProof.rkAuth === undefined)) {
      const kind = rawProof.authKey !== undefined ? 'authKey' : 'rkAuth';
      const bytes = decodeB64(rawProof[kind]);
      if (bytes) proof = { kind, bytes };
    }
    const newAuth = decodeB64(body.authKey);
    if (!proof) return badRequest(c, 'proof must hold exactly one of authKey or rkAuth, as base64');
    if (!decodeB64(body.kdfSalt) || !isPositiveInt(body.kdfIterations) || !newAuth || !decodeB64(body.serverSecret) || !decodeB64(body.wrappedMkPin)) {
      return badRequest(c, 'kdfSalt, kdfIterations, authKey, serverSecret and wrappedMkPin must be valid');
    }

    const row = await readRow(c);
    if (!row) return notReady(c);

    // The guard in the UPDATE keeps the proof valid up to the moment of the write.
    let guard: string;
    let guardArgs: unknown[];
    const now = Date.now();
    if (proof.kind === 'authKey') {
      const stop = await checkPin(c, row, proof.bytes);
      if (stop) return stop;
      guard = `auth_hash = ? AND (locked_until IS NULL OR locked_until <= ?)`;
      guardArgs = [row.auth_hash, now];
    } else {
      // The recovery key (128 bits) is not guessable, so it neither counts nor respects the lock.
      if (!(await matches(proof.bytes, row.rk_auth_hash))) return fail(c, 403, 'forbidden', 'Wrong recovery key');
      guard = `rk_auth_hash = ?`;
      guardArgs = [row.rk_auth_hash];
    }

    const res = await c.env.DB.prepare(
      `UPDATE vault_keys SET kdf_salt = ?, kdf_iterations = ?, auth_hash = ?, server_secret = ?, wrapped_mk_pin = ?,
         failed_attempts = 0, locked_until = NULL, updated_at = ?
       WHERE id = 1 AND ${guard}`,
    )
      .bind(body.kdfSalt, body.kdfIterations, await hashOf(newAuth), body.serverSecret, body.wrappedMkPin, now, ...guardArgs)
      .run();
    if (!res.meta.changes) {
      const fresh = await readRow(c);
      if (fresh && fresh.auth_hash !== null && isLocked(fresh, now)) return c.json(lockedBody(fresh), 423);
      return fail(c, 409, 'vault_busy', 'The Vault changed while updating the PIN; try again');
    }
    return c.json({ ok: true });
  });
}
