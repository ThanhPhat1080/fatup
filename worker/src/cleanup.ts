import { PENDING_TTL_HOURS, TRASH_RETENTION_DAYS } from '@fatup/shared';
import type { Env } from './env';
import { fileKey, thumbKey, vaultFileKey, vaultThumbKey } from './presign';

const BATCH = 250; // R2 delete() accepts up to 1000 keys; each file has 4.
const DAY = 24 * 60 * 60 * 1000;
/** A move out of the Vault older than this is dead, not running. */
const OUT_MOVE_GRACE_MS = 60 * 60 * 1000;

/** Deletes the R2 objects and database rows for the given file ids. */
export async function purge(env: Env, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const marks = chunk.map(() => '?').join(',');
    // Every key of every row, whatever `encrypted` says: a move between plain and encrypted may have left either pair behind.
    await env.BUCKET.delete(chunk.flatMap((id) => [fileKey(id), thumbKey(id), vaultFileKey(id), vaultThumbKey(id)]));
    await env.DB.prepare(`DELETE FROM shares WHERE file_id IN (${marks})`)
      .bind(...chunk)
      .run();
    await env.DB.prepare(`DELETE FROM files WHERE id IN (${marks})`)
      .bind(...chunk)
      .run();
  }
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
  for (;;) {
    const { results } = await env.DB.prepare('SELECT id FROM files WHERE encrypted = 1 AND out_started_at IS NOT NULL AND out_started_at < ? LIMIT ?')
      .bind(outCutoff, BATCH)
      .all<{ id: string }>();
    if (results.length === 0) break;
    await env.BUCKET.delete(results.flatMap((r) => [fileKey(r.id), thumbKey(r.id)]));
    const marks = results.map(() => '?').join(',');
    await env.DB.prepare(`UPDATE files SET out_started_at = NULL WHERE id IN (${marks})`)
      .bind(...results.map((r) => r.id))
      .run();
    if (results.length < BATCH) break;
  }

  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM files
       WHERE (status = 'ready' AND deleted_at IS NOT NULL AND deleted_at < ?)
          OR (status = 'pending' AND created_at < ?)
       LIMIT ?`,
    )
      .bind(trashCutoff, pendingCutoff, BATCH)
      .all<{ id: string }>();
    if (results.length === 0) break;

    await purge(env, results.map((r) => r.id));
    total += results.length;
    if (results.length < BATCH) break;
  }
  return total;
}
