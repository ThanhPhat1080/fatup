import { PENDING_TTL_HOURS, RETENTION_DAYS } from '@fatup/shared';
import type { Env } from './env';
import { fileKey, thumbKey } from './presign';

const BATCH = 500; // R2 delete() accepts up to 1000 keys; each file has 2.

/** Removes expired files and abandoned uploads. Returns how many rows were deleted. */
export async function cleanup(env: Env, now = Date.now()): Promise<number> {
  const readyCutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pendingCutoff = now - PENDING_TTL_HOURS * 60 * 60 * 1000;
  let total = 0;

  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM files
       WHERE (status = 'ready' AND created_at < ?) OR (status = 'pending' AND created_at < ?)
       LIMIT ?`,
    )
      .bind(readyCutoff, pendingCutoff, BATCH)
      .all<{ id: string }>();
    if (results.length === 0) break;

    const ids = results.map((r) => r.id);
    await env.BUCKET.delete(ids.flatMap((id) => [fileKey(id), thumbKey(id)]));
    await env.DB.prepare(`DELETE FROM files WHERE id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .run();
    total += ids.length;
    if (results.length < BATCH) break;
  }
  return total;
}
