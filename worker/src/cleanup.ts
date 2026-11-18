import { PENDING_TTL_HOURS, TRASH_RETENTION_DAYS } from '@fatup/shared';
import type { Env } from './env';
import { fileKey, thumbKey, vaultFileKey, vaultThumbKey } from './presign';

/** Ids per statement and per R2 delete: D1 binds at most 100 values per statement, and 100 ids are 400 keys (R2 takes up to 1000). */
const BATCH = 100;
const DAY = 24 * 60 * 60 * 1000;
/** A move out of the Vault older than this is dead, not running. */
const OUT_MOVE_GRACE_MS = 60 * 60 * 1000;
/** A Vault object younger than this may belong to an attempt that is still uploading (its URL lives 15 minutes). */
export const VAULT_GARBAGE_GRACE_MS = 60 * 60 * 1000;
const R2_DELETE_MAX = 1000;

/** Deletes R2 keys in calls of at most 1000 (the R2 limit). */
async function deleteKeys(env: Env, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += R2_DELETE_MAX) await env.BUCKET.delete(keys.slice(i, i + R2_DELETE_MAX));
}

/** Deletes the R2 objects and database rows for the given file ids. */
export async function purge(env: Env, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const marks = chunk.map(() => '?').join(',');
    // The attempt that encrypted each row names its current vault objects (spec 4.7d).
    const { results: attempts } = await env.DB.prepare(`SELECT id, enc_object FROM files WHERE id IN (${marks}) AND enc_object IS NOT NULL`)
      .bind(...chunk)
      .all<{ id: string; enc_object: string }>();
    const attemptOf = new Map(attempts.map((r) => [r.id, r.enc_object]));
    // Every key of every row, whatever `encrypted` says: a move between plain and encrypted may have left either pair behind.
    // Other attempts' leftovers are the cron's to find.
    await deleteKeys(
      env,
      chunk.flatMap((id) => {
        const keys = [fileKey(id), thumbKey(id), vaultFileKey(id), vaultThumbKey(id)];
        const attempt = attemptOf.get(id);
        return attempt ? [...keys, vaultFileKey(id, attempt), vaultThumbKey(id, attempt)] : keys;
      }),
    );
    await env.DB.prepare(`DELETE FROM shares WHERE file_id IN (${marks})`)
      .bind(...chunk)
      .run();
    await env.DB.prepare(`DELETE FROM files WHERE id IN (${marks})`)
      .bind(...chunk)
      .run();
  }
}

/** `vault/<id>`, `vault/<id>.thumb`, `vault/<id>.<attempt>` or `vault/<id>.<attempt>.thumb`. */
const VAULT_KEY = /^vault\/([0-9A-Z]{26})(?:\.([A-Za-z0-9_-]{16,64}))?(?:\.thumb)?$/;

/**
 * Removes the garbage under `vault/` (spec 4.7d): objects older than an hour whose row is gone or whose attempt is not the row's `enc_object`
 * (a key without an attempt is the row's only when `enc_object` is NULL). Younger objects may belong to an attempt that is still uploading.
 * Keys of another shape are left alone.
 */
async function sweepVaultGarbage(env: Env, now: number): Promise<void> {
  const cutoff = now - VAULT_GARBAGE_GRACE_MS;
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: 'vault/', cursor, limit: R2_DELETE_MAX });
    cursor = page.truncated ? page.cursor : undefined;
    const old: { key: string; id: string; attempt: string | null }[] = [];
    for (const o of page.objects) {
      const m = VAULT_KEY.exec(o.key);
      if (m && o.uploaded.getTime() < cutoff) old.push({ key: o.key, id: m[1], attempt: m[2] ?? null });
    }
    const ids = [...new Set(old.map((o) => o.id))];
    // id -> the row's enc_object (null when the row has none); absent when the row is gone.
    const rows = new Map<string, string | null>();
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const { results } = await env.DB.prepare(`SELECT id, enc_object FROM files WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .bind(...chunk)
        .all<{ id: string; enc_object: string | null }>();
      for (const r of results) rows.set(r.id, r.enc_object);
    }
    await deleteKeys(
      env,
      old.filter((o) => !rows.has(o.id) || rows.get(o.id) !== o.attempt).map((o) => o.key),
    );
  } while (cursor);
}

/**
 * Deletes abandoned uploads (rows still `pending`). The row goes first and only while it is still `pending`: an import may complete one of
 * these rows at this very moment, and a row that became `ready` meanwhile must keep its row and its objects. Returns how many rows went.
 */
export async function purgePending(env: Env, ids: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const { results } = await env.DB.prepare(`DELETE FROM files WHERE status = 'pending' AND id IN (${chunk.map(() => '?').join(',')}) RETURNING id`)
      .bind(...chunk)
      .all<{ id: string }>();
    if (results.length === 0) continue;
    // An upload straight into the Vault is pending too, and its objects are the fixed vault/<id> pair (no attempt exists before the row is ready).
    await deleteKeys(env, results.flatMap((r) => [fileKey(r.id), thumbKey(r.id), vaultFileKey(r.id), vaultThumbKey(r.id)]));
    removed += results.length;
  }
  return removed;
}

/**
 * Removes files that sat in the trash for 30 days and abandoned uploads.
 * A finished file outside the trash is never removed, however old it is: only the user's own
 * delete (which moves it to the trash) starts the 30-day clock.
 * Returns how many rows were deleted.
 */
export async function cleanup(env: Env, now = Date.now()): Promise<number> {
  const trashCutoff = now - TRASH_RETENTION_DAYS * DAY;
  const pendingCutoff = now - PENDING_TTL_HOURS * 60 * 60 * 1000;
  let total = 0;

  // Expired share links are already refused on every request; this just tidies the rows.
  await env.DB.prepare('DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ?').bind(now).run();

  // A move out of the Vault that never completed may have left plain objects next to the ciphertext. Only encrypted rows are
  // swept: a plain row's files/<id> is its file.
  const outCutoff = now - OUT_MOVE_GRACE_MS;
  // Release first, delete second: a vault/out/complete that finishes meanwhile needs out_started_at, so it either wins (the row is
  // plain and the UPDATE below skips it) or finds the row released and answers item_changed. Deleting first could remove the new plain file.
  const { results: released } = await env.DB.prepare(
    'UPDATE files SET out_started_at = NULL WHERE encrypted = 1 AND out_started_at IS NOT NULL AND out_started_at < ? RETURNING id',
  )
    .bind(outCutoff)
    .all<{ id: string }>();
  for (let i = 0; i < released.length; i += BATCH) {
    await deleteKeys(env, released.slice(i, i + BATCH).flatMap((r) => [fileKey(r.id), thumbKey(r.id)]));
  }

  for (;;) {
    const { results } = await env.DB.prepare(`SELECT id FROM files WHERE status = 'ready' AND deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?`)
      .bind(trashCutoff, BATCH)
      .all<{ id: string }>();
    if (results.length === 0) break;

    await purge(env, results.map((r) => r.id));
    total += results.length;
    if (results.length < BATCH) break;
  }

  for (;;) {
    const { results } = await env.DB.prepare(`SELECT id FROM files WHERE status = 'pending' AND created_at < ? LIMIT ?`).bind(pendingCutoff, BATCH).all<{ id: string }>();
    if (results.length === 0) break;

    const removed = await purgePending(env, results.map((r) => r.id));
    total += removed;
    if (results.length < BATCH || removed === 0) break;
  }

  await sweepVaultGarbage(env, now);
  return total;
}
