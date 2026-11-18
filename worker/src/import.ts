import { MAX_FILE_SIZE } from '@fatup/shared';
import type { Env } from './env';
import { ObjectChangedError, ObjectMissingError, type ListedObject, type ObjectStore } from './object-store';
import { fileKey } from './presign';
import { ulidFrom } from './ulid';

/**
 * Images moved in per call, so a big backlog is worked off a refresh at a time. Each image costs four calls to R2's S3 API (copy, two HEADs, delete)
 * and a Worker on the free plan may make 50 subrequests per request: ten images and the listing stay under that.
 */
export const IMPORT_BATCH = 10;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
};

/**
 * The folder to import from, as a key prefix that ends in "/" (so `d30` never matches `d300/`), or null when the import is off.
 * Fatup's own object folders and the whole bucket are refused: importing those would move Fatup's files around itself.
 */
export function normalizeImportPrefix(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/^\/+/, '');
  if (trimmed === '') return null;
  const prefix = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  return /^(files|thumbs|vault)\//.test(prefix) ? null : prefix;
}

const extensionOf =(key: string) => /\.([A-Za-z0-9]+)$/.exec(key)?.[1].toLowerCase() ?? '';

/** An image the user can see: a known image extension, not a folder placeholder, not empty, within Fatup's size limit. */
export function isImportableImage(key: string, size: number): boolean {
  return !key.endsWith('/') && extensionOf(key) in MIME_BY_EXTENSION && size > 0 && size <= MAX_FILE_SIZE;
}

export const imageMime = (key: string): string => MIME_BY_EXTENSION[extensionOf(key)] ?? 'application/octet-stream';

/** The part of a key after its last slash, without control characters, as a file name. */
function nameOf(key: string): string {
  const clean = (key.split('/').pop() ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 255);
  return clean || 'image';
}

/**
 * The id a source object always gets: its upload time and 80 bits of SHA-256(key, etag). Two runs that meet the same object (two devices
 * refreshing, or one run repeated after an interruption) compute the same id, so the row's primary key is what stops a second row.
 */
export async function importId(key: string, etag: string, uploadedMs: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${key}\0${etag}`));
  return ulidFrom(uploadedMs, new Uint8Array(digest).slice(0, 16));
}

/** Deletes the source only while it is still the version that was imported: a newer file saved under the same name stays. */
async function deleteSource(store: ObjectStore, source: ListedObject): Promise<void> {
  const now = await store.head(source.key);
  if (now && now.etag === source.etag) await store.delete(source.key);
}

/** Brings one image in. Returns true when this call is the one that made the row ready. */
async function importOne(env: Env, store: ObjectStore, source: ListedObject, device: string | null): Promise<boolean> {
  const id = await importId(source.key, source.etag, source.uploaded);
  const status = async () => (await env.DB.prepare('SELECT status FROM files WHERE id = ?').bind(id).first<{ status: string }>())?.status ?? null;

  // A row that is already ready means an earlier run was cut off before it removed the source.
  if ((await status()) === 'ready') {
    await deleteSource(store, source);
    return false;
  }

  // The row is created pending with the import time, so the cron's 24-hour sweep of abandoned uploads covers a run that never finishes.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO files (id, name, mime, size, kind, has_thumb, status, device, created_at) VALUES (?, ?, ?, ?, 'image', 0, 'pending', ?, ?)`,
  )
    .bind(id, nameOf(source.key), imageMime(source.key), source.size, device, Date.now())
    .run();

  try {
    // Only the version that was listed: if the other app saved a new picture under the same name meanwhile, the id (made from the old etag) must not
    // end up holding the new picture, or the next scan would import that picture a second time under its own id.
    await store.copy(source.key, fileKey(id), source.etag);
  } catch (err) {
    if (err instanceof ObjectMissingError) return false; // another run moved it first
    if (err instanceof ObjectChangedError) {
      // Nobody can complete this id any more (every copy of it is refused the same way): drop its row; the new version is imported under its own id next time.
      await env.DB.prepare(`DELETE FROM files WHERE id = ? AND status = 'pending'`).bind(id).run();
      return false;
    }
    throw err;
  }
  const copy = await store.head(fileKey(id));
  if (!copy || copy.size !== source.size) return false; // not whole: the source stays, the next run copies again

  const res = await env.DB.prepare(`UPDATE files SET status = 'ready', created_at = ? WHERE id = ? AND status = 'pending'`).bind(source.uploaded, id).run();
  // Nothing changed: either another run made it ready (go on), or the row is gone (the cron swept it as an abandoned upload). In that case the
  // source must stay, and the copy just made has no row any more: take it back, or nothing ever would.
  if (!res.meta.changes && (await status()) !== 'ready') {
    await store.delete(fileKey(id));
    return false;
  }

  // From here the image is imported. If the source cannot be removed now, the next scan finds the ready row and removes it then.
  await deleteSource(store, source).catch((err) => console.error(`removing ${source.key} after its import failed`, err));
  return res.meta.changes > 0;
}

/**
 * Moves up to `limit` images from under `prefix` into Fatup, oldest listing order first.
 * The order per image never changes: row, copy, size check, ready, and only then the source is removed.
 * `more` says that images are still waiting for a later call. A failure of one image ends the call early with `more: true`
 * (what was already imported still counts); a failure to list the folder is thrown.
 */
export async function importImages(env: Env, store: ObjectStore, prefix: string, limit = IMPORT_BATCH): Promise<{ imported: number; more: boolean }> {
  const device = prefix.replace(/\/+$/, '').slice(0, 64) || null;
  let imported = 0;
  let handled = 0;
  let cursor: string | undefined;
  do {
    const page = await store.list(prefix, cursor);
    for (const source of page.objects) {
      if (!isImportableImage(source.key, source.size)) continue;
      if (handled >= limit) return { imported, more: true };
      handled++;
      try {
        if (await importOne(env, store, source, device)) imported++;
      } catch (err) {
        // Stop here but keep what is done: the client refreshes its list when `imported` is above 0, and asks again later for the rest.
        console.error(`import of ${source.key} failed`, err);
        return { imported, more: true };
      }
    }
    cursor = page.next ?? undefined;
  } while (cursor);
  return { imported, more: false };
}
