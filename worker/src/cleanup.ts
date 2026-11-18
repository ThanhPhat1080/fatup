import { PENDING_TTL_HOURS, TRASH_RETENTION_DAYS } from '@fatup/shared';
import type { Env } from './env';
import { fileKey, thumbKey } from './presign';

const BATCH = 500; // R2 delete() accepts up to 1000 keys; each file has 2.
const DAY = 24 * 60 * 60 * 1000;

/** Deletes the R2 objects and database rows for the given file ids. */
export async function purge(env: Env, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    await env.BUCKET.delete(chunk.flatMap((id) => [fileKey(id), thumbKey(id)]));
    await env.DB.prepare(`DELETE FROM shares WHERE file_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .run();
    await env.DB.prepare(`DELETE FROM files WHERE id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .run();
  }
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
    await env.BUCKET.delete(results.flatMap((r) => [fileKey(r.id), thumbKey(r.id)]));
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
  return total;
}
