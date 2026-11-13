import { PENDING_TTL_HOURS, RETENTION_DAYS, TRASH_RETENTION_DAYS } from '@fatup/shared';
import type { Env } from './env';
import { fileKey, thumbKey } from './presign';

const BATCH = 500; // R2 delete() accepts up to 1000 keys; each file has 2.
const DAY = 24 * 60 * 60 * 1000;

/** Deletes the R2 objects and database rows for the given file ids. */
export async function purge(env: Env, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    await env.BUCKET.delete(chunk.flatMap((id) => [fileKey(id), thumbKey(id)]));
    await env.DB.prepare(`DELETE FROM files WHERE id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .run();
  }
}

/**
 * Removes expired files, files that sat in the trash for 30 days, and abandoned uploads.
 * Files in the trash are not subject to the upload retention; restoring one restarts that clock.
 * Returns how many rows were deleted.
 */
export async function cleanup(env: Env, now = Date.now()): Promise<number> {
  const readyCutoff = now - RETENTION_DAYS * DAY;
  const trashCutoff = now - TRASH_RETENTION_DAYS * DAY;
  const pendingCutoff = now - PENDING_TTL_HOURS * 60 * 60 * 1000;
  let total = 0;

  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM files
       WHERE (status = 'ready' AND kind != 'link' AND deleted_at IS NULL AND COALESCE(retain_from, created_at) < ?)
          OR (status = 'ready' AND deleted_at IS NOT NULL AND deleted_at < ?)
          OR (status = 'pending' AND created_at < ?)
       LIMIT ?`,
    )
      .bind(readyCutoff, trashCutoff, pendingCutoff, BATCH)
      .all<{ id: string }>();
    if (results.length === 0) break;

    await purge(env, results.map((r) => r.id));
    total += results.length;
    if (results.length < BATCH) break;
  }
  return total;
}
