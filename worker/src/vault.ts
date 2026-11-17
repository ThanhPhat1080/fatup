import type { Context, Hono } from 'hono';
import {
  LINK_MIME,
  MAX_FILE_SIZE,
  MAX_URL_LENGTH,
  VAULT_HEADER,
  VAULT_LOCK_RULES,
  VAULT_PROTOCOL_VERSION,
  VAULT_WIPE_AT,
  kindFromMime,
  normalizeUrl,
  vaultCiphertextSize,
  type VaultMoveUrls,
  type VaultPinRequest,
  type VaultRecoverRequest,
  type VaultSetupRequest,
  type VaultStatus,
  type VaultUnlockRequest,
  type VaultUnlockResponse,
} from '@fatup/shared';
import type { AppEnv } from './app';
import { MAX_ENC_KEY, MAX_ENC_META, cleanMime, fail, hostOf, isEncText, itemOf, sanitizeName, sanitizeTitle, type Row } from './app';
import { fileKey, thumbKey, vaultFileKey, vaultThumbKey } from './presign';
import { isUlid } from './ulid';

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

export type VaultState = 'none' | 'ready' | 'wiped';

/** `none` before setup, `wiped` once the PIN hash is gone (too many wrong PINs), otherwise `ready`. */
export async function vaultState(db: D1Database): Promise<VaultState> {
  const row = await db.prepare('SELECT auth_hash FROM vault_keys WHERE id = 1').first<{ auth_hash: string | null }>();
  if (!row) return 'none';
  return row.auth_hash === null ? 'wiped' : 'ready';
}

/** Whether the client announced that it knows the encrypted Vault (apps that predate it never send the header). */
export const speaksVault = (c: Context) => c.req.header(VAULT_HEADER) === VAULT_PROTOCOL_VERSION;

/** What a client that predates the encrypted Vault gets once a Vault exists. */
export const appOutdated = (c: Context) => fail(c, 426, 'app_outdated', 'Update the app to use the Vault');

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

/** What the checks every move route shares produce: the live, finished item (and the parsed body, when the route has one). */
type Move<B> = { row: Row; body: B };

/**
 * The checks every move route shares, in order: the id is a ULID, the Vault is ready, the body parses (when the route
 * takes one), the item exists, is finished and is not in the trash. Returns a Response when the request must stop.
 * `allowVaultTrash` also admits an item in the Vault's trash (`in_vault = 1`), for the moves in: a plain item deleted in
 * the Vault before it was set up still has to be encrypted. The normal trash (`in_vault = 0`) is never admitted.
 */
async function beginMove<B = null>(
  c: Ctx,
  parse?: (body: Record<string, unknown>) => B | Response,
  allowVaultTrash = false,
): Promise<Move<B> | Response> {
  const id = c.req.param('id') ?? '';
  if (!isUlid(id)) return fail(c, 404, 'not_found', 'File not found');
  if ((await vaultState(c.env.DB)) !== 'ready') return notReady(c);
  let body = null as B;
  if (parse) {
    const raw = await readBody(c);
    if (!raw) return badRequest(c, 'Body must be JSON');
    const parsed = parse(raw);
    if (parsed instanceof Response) return parsed;
    body = parsed;
  }
  const live = allowVaultTrash ? '(deleted_at IS NULL OR in_vault = 1)' : 'deleted_at IS NULL';
  const row = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ? AND status = 'ready' AND ${live}`).bind(id).first<Row>();
  if (!row) return fail(c, 404, 'not_found', 'File not found');
  return { row, body };
}

const isSize = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

type InBody = { encMeta: string; encKey: string; size: number; hasThumb: boolean; etag: unknown; claim: string | null };
type OutBody = { link: { url: string; title: string } | null; name: string; mime: string; size: number; hasThumb: boolean };

function parseIn(c: Ctx) {
  return (b: Record<string, unknown>): InBody | Response => {
    if (!isEncText(b.encMeta, MAX_ENC_META) || !isEncText(b.encKey, MAX_ENC_KEY) || !isSize(b.size)) {
      return badRequest(c, `encMeta (at most ${MAX_ENC_META} characters), encKey (at most ${MAX_ENC_KEY}) and a non-negative integer size are required`);
    }
    if (b.claim !== undefined && typeof b.claim !== 'string') return badRequest(c, 'claim must be a string');
    return { encMeta: b.encMeta, encKey: b.encKey, size: b.size, hasThumb: b.hasThumb === true, etag: b.etag, claim: b.claim ?? null };
  };
}

/** A body with a string `url` brings a link out of the Vault; otherwise it brings a file. */
function parseOut(c: Ctx) {
  return (b: Record<string, unknown>): OutBody | Response => {
    if (b.url !== undefined && b.url !== null) {
      if (typeof b.url !== 'string') return badRequest(c, 'url must be a string');
      const url = normalizeUrl(b.url);
      if (!url) return fail(c, 400, 'bad_url', `url must be an http(s) address of at most ${MAX_URL_LENGTH} characters`);
      return { link: { url, title: typeof b.title === 'string' ? sanitizeTitle(b.title) : '' }, name: '', mime: LINK_MIME, size: 0, hasThumb: false };
    }
    if (typeof b.name !== 'string' || typeof b.mime !== 'string' || !isSize(b.size)) {
      return badRequest(c, 'name, mime and a non-negative integer size are required');
    }
    return { link: null, name: sanitizeName(b.name), mime: cleanMime(b.mime), size: b.size, hasThumb: b.hasThumb === true };
  };
}

const reload = async (c: Ctx, id: string) => (await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first<Row>())!;

const MAX_ETAG = 200;

/** The `etag` of a move-in: a non-empty string of at most `MAX_ETAG` characters; one pair of surrounding quotes (the ETag header form) is dropped. */
function cleanEtag(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ETAG) return null;
  const bare = v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
  return bare.length > 0 ? bare : null;
}

const busy = (c: Ctx) => fail(c, 409, 'item_busy', 'Another device is moving this item in; try again later');

/** How long a device keeps the right to write vault/<id>: longer than the 15 minutes its presigned URLs live. */
const CLAIM_MS = 30 * 60 * 1000;

/** A random token, 16 bytes as base64url. */
function newClaim(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const changed = (c: Ctx) => fail(c, 409, 'item_changed', 'The item changed while moving it; try again');

function registerMoveRoutes(app: Hono<AppEnv>): void {
  // Moving in: the client downloads the plain file, encrypts it and PUTs it to vault/<id>; only `complete` changes anything.
  app.post('/files/:id/vault/in', async (c) => {
    const begun = await beginMove(c, undefined, true);
    if (begun instanceof Response) return begun;
    const { row } = begun;
    if (row.encrypted === 1) return fail(c, 409, 'already_encrypted', 'The item is already encrypted');
    // One writer at a time: the presigned PUT cannot be revoked, so no second URL is handed out while a claim lives.
    // The check and the claim are one statement, so two devices asking together cannot both get one.
    const now = Date.now();
    const claimed = await c.env.DB.prepare(
      `UPDATE files SET in_claim = ?, in_claim_until = ?
       WHERE id = ? AND encrypted = 0 AND (in_claim IS NULL OR in_claim_until <= ?)
       RETURNING in_claim`,
    )
      .bind(newClaim(), now + CLAIM_MS, row.id, now)
      .first<{ in_claim: string }>();
    if (!claimed) return busy(c);
    const presigner = c.get('presigner');
    // A link has no file object in R2 (its address travels in encMeta alone), but it may have a preview picture, which moves in too.
    const hasObjects = row.kind !== 'link';
    const withThumb = row.has_thumb === 1;
    const res: VaultMoveUrls = {
      uploadUrl: await presigner.put(vaultFileKey(row.id)),
      thumbUploadUrl: withThumb ? await presigner.put(vaultThumbKey(row.id)) : null,
      downloadUrl: hasObjects ? await presigner.get(fileKey(row.id)) : null,
      thumbUrl: withThumb ? await presigner.get(thumbKey(row.id)) : null,
      claim: claimed.in_claim,
    };
    return c.json(res);
  });

  app.post('/files/:id/vault/in/complete', async (c) => {
    const begun = await beginMove(c, parseIn(c), true);
    if (begun instanceof Response) return begun;
    const { row, body } = begun;
    const plainKeys = [fileKey(row.id), thumbKey(row.id)];
    const vaultKeys = [vaultFileKey(row.id), vaultThumbKey(row.id)];

    // Already encrypted (a retry, or an item uploaded straight into the Vault). Sweep plain objects an interrupted run may have left.
    if (row.encrypted === 1) {
      await c.env.BUCKET.delete(plainKeys);
      return c.json(await itemOf(c, row));
    }

    // The row is claimed: only the holder of a live claim may go on. Anyone else changes and deletes nothing.
    const now = Date.now();
    if (row.in_claim !== null && (body.claim !== row.in_claim || row.in_claim_until === null || row.in_claim_until <= now)) return busy(c);
    /** The caller's claim was valid, so a refusal that lets the client start over frees it at once. */
    const release = async () => {
      if (row.in_claim === null) return;
      await c.env.DB.prepare('UPDATE files SET in_claim = NULL, in_claim_until = NULL WHERE id = ? AND in_claim = ?').bind(row.id, row.in_claim).run();
    };

    const isLink = row.kind === 'link';
    // A file must say which bytes it encrypted (the ETag of its PUT), so two devices moving the same file in cannot mix one's key with the other's ciphertext.
    const etag = isLink ? null : cleanEtag(body.etag);
    if (!isLink && etag === null) return badRequest(c, `etag (the ETag of the uploaded encrypted file, at most ${MAX_ETAG} characters) is required`);
    if (!isLink) {
      if (body.size > vaultCiphertextSize(MAX_FILE_SIZE)) {
        await c.env.BUCKET.delete(vaultKeys);
        return fail(c, 413, 'too_large', `Files are limited to ${vaultCiphertextSize(MAX_FILE_SIZE)} bytes`);
      }
      const object = await c.env.BUCKET.head(vaultFileKey(row.id));
      if (!object) return fail(c, 409, 'not_uploaded', 'The encrypted file has not been uploaded yet');
      if (object.size !== body.size) {
        await c.env.BUCKET.delete(vaultKeys);
        await release();
        return fail(c, 409, 'size_mismatch', 'Uploaded size does not match');
      }
      // Another device overwrote vault/<id> since this one's PUT: nothing is written or deleted, the client starts over.
      if (object.etag !== etag) {
        await release();
        return changed(c);
      }
    }
    const keepThumb = body.hasThumb && (await c.env.BUCKET.head(vaultThumbKey(row.id))) !== null;

    // The encrypted object exists, so D1 may point at it. One statement writes every column, so no plaintext metadata survives.
    // deleted_at is left alone, so an item in the Vault's trash stays there. The share trigger (in_vault -> 1) kills the item's share link in the same statement.
    const res = await c.env.DB.prepare(
      `UPDATE files SET encrypted = 1, in_vault = 1, enc_meta = ?, enc_key = ?, name = '', mime = 'application/octet-stream', kind = 'file',
         url = NULL, size = ?, has_thumb = ?, previewed_at = NULL, icon_url = NULL, title_set = 0, in_claim = NULL, in_claim_until = NULL
       WHERE id = ? AND encrypted = 0 AND status = 'ready' AND (deleted_at IS NULL OR in_vault = 1)
         AND in_claim IS ? AND (in_claim IS NULL OR in_claim_until > ?)`,
    )
      .bind(body.encMeta, body.encKey, isLink ? 0 : body.size, keepThumb ? 1 : 0, row.id, row.in_claim, now)
      .run();
    if (!res.meta.changes) {
      await release();
      return changed(c);
    }

    // Only now are the plain objects (and an encrypted thumbnail nobody will reference) safe to remove.
    await c.env.BUCKET.delete(keepThumb ? plainKeys : [...plainKeys, vaultKeys[1]]);
    return c.json(await itemOf(c, await reload(c, row.id)));
  });

  // Moving out: the client downloads and decrypts vault/<id>, then PUTs the plain file to files/<id>.
  app.post('/files/:id/vault/out', async (c) => {
    const begun = await beginMove(c);
    if (begun instanceof Response) return begun;
    const { row } = begun;
    if (row.encrypted !== 1) return fail(c, 409, 'not_encrypted', 'The item is not encrypted');
    // From here plain objects may appear under files/<id>; the daily cron sweeps them if this move never completes.
    await c.env.DB.prepare('UPDATE files SET out_started_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
    const presigner = c.get('presigner');
    const withThumb = row.has_thumb === 1;
    const res: VaultMoveUrls = {
      uploadUrl: await presigner.put(fileKey(row.id)),
      thumbUploadUrl: withThumb ? await presigner.put(thumbKey(row.id)) : null,
      downloadUrl: await presigner.get(vaultFileKey(row.id)),
      thumbUrl: withThumb ? await presigner.get(vaultThumbKey(row.id), { contentType: 'application/octet-stream' }) : null,
    };
    return c.json(res);
  });

  app.post('/files/:id/vault/out/complete', async (c) => {
    const begun = await beginMove(c, parseOut(c));
    if (begun instanceof Response) return begun;
    const { row, body } = begun;
    const plainKeys = [fileKey(row.id), thumbKey(row.id)];
    const vaultKeys = [vaultFileKey(row.id), vaultThumbKey(row.id)];

    if (row.encrypted !== 1) {
      // A retry of a move that already went through: the same plain item, outside the Vault. Sweep leftovers of an interrupted run.
      const same = body.link ? row.kind === 'link' && row.url === body.link.url : row.kind !== 'link' && row.size === body.size;
      if (row.in_vault !== 0 || !same) return fail(c, 409, 'not_encrypted', 'The item is not encrypted');
      await c.env.BUCKET.delete(vaultKeys);
      await c.env.DB.prepare('UPDATE files SET out_started_at = NULL WHERE id = ?').bind(row.id).run();
      return c.json(await itemOf(c, await reload(c, row.id)));
    }

    let res: D1Result;
    let stray: string[];
    if (body.link) {
      const { url, title } = body.link;
      const dup = await c.env.DB.prepare(`SELECT id FROM files WHERE kind = 'link' AND url = ? AND deleted_at IS NULL AND id != ?`).bind(url, row.id).first();
      if (dup) return fail(c, 409, 'duplicate_url', 'This link is already saved');
      res = await c.env.DB.prepare(
        `UPDATE files SET encrypted = 0, in_vault = 0, enc_meta = NULL, enc_key = NULL, name = ?, mime = ?, kind = 'link', url = ?,
           size = 0, has_thumb = 0, previewed_at = NULL, icon_url = NULL, title_set = ?, out_started_at = NULL
         WHERE id = ? AND encrypted = 1 AND out_started_at IS NOT NULL AND status = 'ready' AND deleted_at IS NULL`,
      )
        .bind(title || hostOf(url), LINK_MIME, url, title ? 1 : 0, row.id)
        .run();
      stray = [];
    } else {
      if (body.size > MAX_FILE_SIZE) {
        await c.env.BUCKET.delete(plainKeys);
        return fail(c, 413, 'too_large', `Files are limited to ${MAX_FILE_SIZE} bytes`);
      }
      const object = await c.env.BUCKET.head(fileKey(row.id));
      if (!object) return fail(c, 409, 'not_uploaded', 'The file has not been uploaded yet');
      if (object.size !== body.size) {
        await c.env.BUCKET.delete(plainKeys);
        return fail(c, 409, 'size_mismatch', 'Uploaded size does not match');
      }
      const kind = kindFromMime(body.mime);
      const keepThumb = body.hasThumb && kind === 'image' && (await c.env.BUCKET.head(thumbKey(row.id))) !== null;
      res = await c.env.DB.prepare(
        `UPDATE files SET encrypted = 0, in_vault = 0, enc_meta = NULL, enc_key = NULL, name = ?, mime = ?, kind = ?, url = NULL,
           size = ?, has_thumb = ?, previewed_at = NULL, icon_url = NULL, title_set = 0, out_started_at = NULL
         WHERE id = ? AND encrypted = 1 AND out_started_at IS NOT NULL AND status = 'ready' AND deleted_at IS NULL`,
      )
        .bind(body.name, body.mime, kind, body.size, keepThumb ? 1 : 0, row.id)
        .run();
      stray = keepThumb ? [] : [plainKeys[1]];
    }
    if (!res.meta.changes) return changed(c);

    // The plain item is in D1 now, so the encrypted objects (and a plain thumbnail nobody will reference) can go.
    await c.env.BUCKET.delete([...vaultKeys, ...stray]);
    return c.json(await itemOf(c, await reload(c, row.id)));
  });
}

export function registerVaultRoutes(app: Hono<AppEnv>): void {
  registerMoveRoutes(app);

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
