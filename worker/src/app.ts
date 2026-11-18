import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  DEFAULT_PAGE_SIZE,
  MAX_FILE_SIZE,
  MAX_PAGE_SIZE,
  MAX_TAGS,
  isTagColor,
  type TagColor,
  DEFAULT_QUOTA_BYTES,
  type UsageResponse,
  kindFromMime,
  LINK_MIME,
  vaultCiphertextSize,
  MAX_URL_LENGTH,
  normalizeUrl,
  siteOf,
  type CreateLinkRequest,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type EmptyTrashResponse,
  type FileItem,
  type FileKind,
  type ListFilesResponse,
  SHARE_TOKEN_BYTES,
  isShareExpiry,
  type ShareInfo,
} from '@fatup/shared';
import { purge } from './cleanup';
import { checkFrame, fetchPreview } from './preview';
import type { Env } from './env';
import { createPresigner, fileKey, objectKeys, thumbKey, vaultFileKey, vaultThumbKey, type Presigner } from './presign';
import { createShareRoutes } from './share-public';
import { isUlid, ulid } from './ulid';
import { appOutdated, registerVaultRoutes, speaksVault, vaultState } from './vault';

export type Row = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: FileKind;
  has_thumb: number;
  status: 'pending' | 'ready';
  device: string | null;
  created_at: number;
  deleted_at: number | null;
  in_vault: number;
  tags: string;
  /** Unused since files stopped expiring outside the trash; the column stays so no migration is needed. */
  retain_from: number | null;
  url: string | null;
  previewed_at: number | null;
  title_set: number;
  /** Absolute address of the link's site icon, or null. */
  icon_url: string | null;
  /** 1 when marked important. */
  important: number;
  /** 1 when the content and metadata are end-to-end encrypted (R2 keys under `vault/`). */
  encrypted: number;
  /** Base64 encrypted metadata, or null for plain rows. */
  enc_meta: string | null;
  /** Base64 file key wrapped with the Vault key, or null for plain rows. */
  enc_key: string | null;
  /** The attempt whose objects (vault/<id>.<attempt>[.thumb]) hold the ciphertext; null = the fixed key vault/<id>, or not encrypted. */
  enc_object: string | null;
};

export type AppEnv = { Bindings: Env; Variables: { presigner: Presigner } };

export type AppOptions = {
  /** Lets tests swap in a presigner that does not need real R2 credentials. */
  presigner?: (env: Env) => Presigner;
  /** Lets tests replace the network when a link's page is fetched for its preview. */
  fetch?: typeof fetch;
};

export function fail(c: Context, status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 426, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** Link titles are free text, so unlike file names they keep slashes. */
export function sanitizeTitle(raw: string): string {
  return raw.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255);
}

export const hostOf = (url: string) => new URL(url).hostname;

/** Strips directory parts and control characters from a client-supplied name. */
export function sanitizeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 255);
  return clean || 'file';
}

/** A client-supplied mime type as stored: lower-cased when it looks like one, otherwise the generic binary type. */
export function cleanMime(raw: string): string {
  return /^[\w.+-]+\/[\w.+-]+$/.test(raw) ? raw.toLowerCase() : 'application/octet-stream';
}

function parseTags(raw: string | null | undefined): TagColor[] {
  return (raw ?? '').split(',').filter(isTagColor).slice(0, MAX_TAGS);
}

/** A valid tag list is an array of at most MAX_TAGS distinct known colours. */
function isTagList(value: unknown): value is TagColor[] {
  return Array.isArray(value) && value.length <= MAX_TAGS && value.every(isTagColor) && new Set(value).size === value.length;
}

function encodeCursor(sortValue: number, id: string) {
  return `${sortValue}_${id}`;
}

function decodeCursor(cursor: string): { createdAt: number; id: string } | null {
  const m = /^(\d+)_([0-9A-Z]{26})$/.exec(cursor);
  return m ? { createdAt: Number(m[1]), id: m[2] } : null;
}

export async function toItem(row: Row, presigner: Presigner, shared = false): Promise<FileItem> {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    kind: row.kind,
    thumbUrl: row.has_thumb
      ? await presigner.get(objectKeys(row)[1], { contentType: row.encrypted === 1 ? 'application/octet-stream' : 'image/jpeg' })
      : null,
    device: row.device,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    inVault: row.in_vault === 1,
    tags: parseTags(row.tags),
    url: row.kind === 'link' ? row.url : null,
    site: row.kind === 'link' && row.url ? siteOf(row.url) : null,
    previewed: row.previewed_at !== null,
    iconUrl: row.kind === 'link' ? (row.icon_url ?? null) : null,
    important: row.important === 1,
    shared,
    encrypted: row.encrypted === 1,
    encMeta: row.encrypted === 1 ? row.enc_meta : null,
    encKey: row.encrypted === 1 ? row.enc_key : null,
  };
}

/** A non-empty string of at most `max` characters; the caps keep encrypted metadata from bloating D1 rows. */
export const isEncText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
export const MAX_ENC_META = 8192;
export const MAX_ENC_KEY = 512;

const DAY = 24 * 60 * 60 * 1000;

type ShareRow = { token: string; file_id: string; created_at: number; expires_at: number | null; downloads: number; last_access_at: number | null };

/** 24 random bytes as base64url without padding: 32 characters, 192 bits. */
function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SHARE_TOKEN_BYTES));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toShareInfo(origin: string, r: ShareRow): ShareInfo {
  return { token: r.token, url: `${origin}/s/${r.token}`, expiresAt: r.expires_at, downloads: r.downloads, lastAccessAt: r.last_access_at, createdAt: r.created_at };
}

/** Which of these files have a share link that has not expired. */
export async function sharedIds(db: D1Database, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await db
    .prepare(`SELECT file_id FROM shares WHERE file_id IN (${ids.map(() => '?').join(',')}) AND (expires_at IS NULL OR expires_at > ?)`)
    .bind(...ids, Date.now())
    .all<{ file_id: string }>();
  return new Set(results.map((r) => r.file_id));
}

/** A file as the API returns it, with its current `shared` state read from the database. */
export const itemOf = async (c: Context<AppEnv>, row: Row) => toItem(row, c.get('presigner'), (await sharedIds(c.env.DB, [row.id])).has(row.id));

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();
  const makePresigner = options.presigner ?? createPresigner;

  app.get('/health', (c) => c.json({ ok: true }));

  // The only other public routes: what a share link's recipient opens. Registered before the token check on purpose.
  app.route('/s', createShareRoutes());

  app.use('*', async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!c.env.API_TOKEN || !token || !(await tokenMatches(token, c.env.API_TOKEN))) {
      return fail(c, 401, 'unauthorized', 'Missing or invalid token');
    }
    c.set('presigner', makePresigner(c.env));
    await next();
  });

  // Authenticated health check, used by clients to verify their setup.
  app.get('/me', (c) => c.json({ ok: true }));

  registerVaultRoutes(app);

  // Storage in use, summed from the database (no extra R2 API credentials needed). Preview thumbnails are tiny and not counted.
  app.get('/usage', async (c) => {
    const row = await c.env.DB.prepare(`SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE status = 'ready'`).first<{ used: number }>();
    const quotaGb = Number(c.env.R2_QUOTA_GB);
    const res: UsageResponse = {
      usedBytes: row?.used ?? 0,
      limitBytes: Number.isFinite(quotaGb) && quotaGb > 0 ? Math.round(quotaGb * 1_000_000_000) : DEFAULT_QUOTA_BYTES,
    };
    return c.json(res);
  });

  app.post('/uploads', async (c) => {
    let body: Partial<CreateUploadRequest>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'bad_request', 'Body must be JSON');
    }
    const { name, mime, size, hasThumb, device } = body;
    if (typeof name !== 'string' || typeof mime !== 'string' || typeof size !== 'number') {
      return fail(c, 400, 'bad_request', 'name, mime and size are required');
    }
    if (!Number.isInteger(size) || size < 0) return fail(c, 400, 'bad_request', 'Invalid size');

    // An upload straight into the encrypted Vault: `size` is the ciphertext size, and the name, type and thumbnail kind stay in encMeta.
    const vault = body.vault ?? null;
    if (vault !== null && !(isEncText((vault as { encMeta?: unknown }).encMeta, MAX_ENC_META) && isEncText((vault as { encKey?: unknown }).encKey, MAX_ENC_KEY))) {
      return fail(c, 400, 'bad_request', `vault.encMeta (at most ${MAX_ENC_META} characters) and vault.encKey (at most ${MAX_ENC_KEY}) must be non-empty strings`);
    }
    if (vault && (await vaultState(c.env.DB)) !== 'ready') return fail(c, 409, 'vault_not_ready', 'The Vault is not ready');
    const maxSize = vault ? vaultCiphertextSize(MAX_FILE_SIZE) : MAX_FILE_SIZE;
    if (size > maxSize) return fail(c, 413, 'too_large', `Files are limited to ${maxSize} bytes`);

    const id = ulid();
    const now = Date.now();
    const presigner = c.get('presigner');

    if (vault) {
      const withThumb = hasThumb === true;
      // The sender device stays plaintext (spec Q3), exactly as for plain uploads.
      await c.env.DB.prepare(
        `INSERT INTO files (id, name, mime, size, kind, has_thumb, status, device, created_at, in_vault, encrypted, enc_meta, enc_key)
         VALUES (?, '', 'application/octet-stream', ?, 'file', ?, 'pending', ?, ?, 1, 1, ?, ?)`,
      )
        .bind(id, size, withThumb ? 1 : 0, typeof device === 'string' ? device.slice(0, 64) : null, now, vault.encMeta, vault.encKey)
        .run();
      const res: CreateUploadResponse = {
        id,
        uploadUrl: await presigner.put(vaultFileKey(id)),
        thumbUploadUrl: withThumb ? await presigner.put(vaultThumbKey(id)) : null,
      };
      return c.json(res, 201);
    }

    const mimeType = cleanMime(mime);
    const kind = kindFromMime(mimeType);
    const withThumb = hasThumb === true && kind === 'image';

    await c.env.DB.prepare(
      `INSERT INTO files (id, name, mime, size, kind, has_thumb, status, device, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
      .bind(id, sanitizeName(name), mimeType, size, kind, withThumb ? 1 : 0, typeof device === 'string' ? device.slice(0, 64) : null, now)
      .run();

    const res: CreateUploadResponse = {
      id,
      uploadUrl: await presigner.put(fileKey(id)),
      thumbUploadUrl: withThumb ? await presigner.put(thumbKey(id)) : null,
    };
    return c.json(res, 201);
  });

  app.post('/uploads/:id/complete', async (c) => {
    const id = c.req.param('id');
    if (!isUlid(id)) return fail(c, 404, 'not_found', 'Upload not found');
    const row = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first<Row>();
    if (!row) return fail(c, 404, 'not_found', 'Upload not found');
    if (row.status === 'ready') return c.json(await itemOf(c, row));

    const [objectKey, thumbObjectKey] = objectKeys(row);
    const object = await c.env.BUCKET.head(objectKey);
    if (!object) return fail(c, 409, 'not_uploaded', 'File has not been uploaded yet');
    if (object.size !== row.size) {
      await c.env.BUCKET.delete([objectKey, thumbObjectKey]);
      await c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
      return fail(c, 409, 'size_mismatch', 'Uploaded size does not match');
    }
    const hasThumb = row.has_thumb ? (await c.env.BUCKET.head(thumbObjectKey)) !== null : false;
    const now = Date.now();
    await c.env.DB.prepare(`UPDATE files SET status = 'ready', has_thumb = ?, created_at = ? WHERE id = ?`)
      .bind(hasThumb ? 1 : 0, now, id)
      .run();
    return c.json(await itemOf(c, { ...row, status: 'ready', has_thumb: hasThumb ? 1 : 0, created_at: now }));
  });

  app.post('/links', async (c) => {
    let body: Partial<CreateLinkRequest>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'bad_request', 'Body must be JSON');
    }
    if (typeof body.url !== 'string') return fail(c, 400, 'bad_request', 'url is required');
    const url = normalizeUrl(body.url);
    if (!url) return fail(c, 400, 'bad_url', `url must be an http(s) address of at most ${MAX_URL_LENGTH} characters`);

    const existing = await c.env.DB.prepare(`SELECT * FROM files WHERE kind = 'link' AND url = ? AND deleted_at IS NULL`).bind(url).first<Row>();
    if (existing) return c.json(await itemOf(c, existing));

    const title = typeof body.title === 'string' ? sanitizeTitle(body.title) : '';
    const row: Row = {
      id: ulid(),
      name: title || hostOf(url),
      mime: LINK_MIME,
      size: 0,
      kind: 'link',
      has_thumb: 0,
      status: 'ready',
      device: typeof body.device === 'string' ? body.device.slice(0, 64) : null,
      created_at: Date.now(),
      deleted_at: null,
      in_vault: 0,
      tags: '',
      retain_from: null,
      url,
      previewed_at: null,
      title_set: title ? 1 : 0,
      icon_url: null,
      important: 0,
      encrypted: 0,
      enc_meta: null,
      enc_key: null,
      enc_object: null,
    };
    await c.env.DB.prepare(
      `INSERT INTO files (id, name, mime, size, kind, has_thumb, status, device, created_at, url, title_set)
       VALUES (?, ?, ?, 0, 'link', 0, 'ready', ?, ?, ?, ?)`,
    )
      .bind(row.id, row.name, row.mime, row.device, row.created_at, url, row.title_set)
      .run();
    return c.json(await itemOf(c, row), 201);
  });

  // Reads the page for its title and the address of its picture. It does not fetch or store the picture and it does not remember
  // having tried: each client keeps its own copy of the picture and asks again only when it has none.
  app.post('/links/:id/preview', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ? AND status = 'ready' AND deleted_at IS NULL`).bind(id).first<Row>();
    // An encrypted row keeps its address inside enc_meta: the server has nothing to fetch, and must not be tricked into guessing.
    if (row?.encrypted === 1) return fail(c, 409, 'encrypted', 'Encrypted items have no server-side preview');
    if (!row || row.kind !== 'link' || !row.url) return fail(c, 404, 'not_found', 'Link not found');

    const found = await fetchPreview(row.url, options.fetch);
    const next: Row = { ...row, previewed_at: Date.now(), icon_url: found.iconUrl ?? row.icon_url ?? null };
    if (found.title && !row.title_set) next.name = found.title;
    await c.env.DB.prepare('UPDATE files SET name = ?, previewed_at = ?, icon_url = ? WHERE id = ?').bind(next.name, next.previewed_at, next.icon_url, id).run();
    return c.json({ ...(await itemOf(c, next)), previewImage: found.imageUrl });
  });

  // Tells the web app whether a link's page can be shown inside it (the desktop app has a real browser view and never asks).
  app.get('/links/:id/frame', async (c) => {
    const row = await c.env.DB.prepare(`SELECT url FROM files WHERE id = ? AND kind = 'link' AND status = 'ready' AND deleted_at IS NULL`)
      .bind(c.req.param('id'))
      .first<Pick<Row, 'url'>>();
    if (!row?.url) return fail(c, 404, 'not_found', 'Link not found');
    return c.json(await checkFrame(row.url, options.fetch));
  });

  app.get('/files', async (c) => {
    const kind = c.req.query('kind') ?? 'all';
    if (!['all', 'image', 'file', 'link'].includes(kind)) return fail(c, 400, 'bad_request', 'Invalid kind');
    const limitRaw = Number(c.req.query('limit') ?? DEFAULT_PAGE_SIZE);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

    const trash = c.req.query('trash') === '1';
    const vault = c.req.query('vault') === '1';
    // Once a Vault exists, an app that does not send the version header would list it without being able to open it.
    if (vault && !speaksVault(c) && (await vaultState(c.env.DB)) !== 'none') return appOutdated(c);
    // The trash is ordered by when files were deleted, the normal list by when they were uploaded.
    const sortCol = trash ? 'deleted_at' : 'created_at';
    // The Vault is a separate list with its own trash: deleting a Vault item keeps it in the Vault.
    const where = [`status = 'ready'`, `${trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'} AND in_vault = ${vault ? 1 : 0}`];
    const params: unknown[] = [];
    // Links are only returned when asked for (or in the trash), so clients that predate them never see one.
    if (kind === 'all') {
      if (!trash) where.push(`kind != 'link'`);
    } else {
      where.push('kind = ?');
      params.push(kind);
    }
    const cursorRaw = c.req.query('cursor');
    if (cursorRaw) {
      const cursor = decodeCursor(cursorRaw);
      if (!cursor) return fail(c, 400, 'bad_request', 'Invalid cursor');
      where.push(`(${sortCol} < ? OR (${sortCol} = ? AND id < ?))`);
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM files WHERE ${where.join(' AND ')} ORDER BY ${sortCol} DESC, id DESC LIMIT ?`,
    )
      .bind(...params, limit + 1)
      .all<Row>();

    const page = results.slice(0, limit);
    const presigner = c.get('presigner');
    const shared = await sharedIds(c.env.DB, page.map((r) => r.id));
    const res: ListFilesResponse = {
      items: await Promise.all(page.map((r) => toItem(r, presigner, shared.has(r.id)))),
      nextCursor: results.length > limit ? encodeCursor(page[page.length - 1][sortCol] ?? 0, page[page.length - 1].id) : null,
    };
    return c.json(res);
  });

  app.get('/files/:id/download', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ? AND status = 'ready' AND deleted_at IS NULL`).bind(id).first<Row>();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    if (row.kind === 'link') return fail(c, 400, 'not_a_file', 'Links have nothing to download');
    // An encrypted row has no readable name or type; the client decrypts and names the file itself.
    const url = row.encrypted === 1 ? await c.get('presigner').get(objectKeys(row)[0]) : await c.get('presigner').get(fileKey(id), { filename: row.name, contentType: row.mime });
    return c.json({ url });
  });

  // Moves a file to the trash (idempotent). Unfinished uploads have nothing worth restoring, so they are removed outright.
  app.delete('/files/:id', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT id, status FROM files WHERE id = ?').bind(id).first<Pick<Row, 'id' | 'status'>>();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    if (row.status === 'pending') {
      await purge(c.env, [id]);
    } else {
      await c.env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(Date.now(), id).run();
    }
    return c.body(null, 204);
  });

  // Updates a file's display name, colour tags and/or important marker, and for links also the address. The R2 objects are keyed by id, so a rename never touches them.
  app.patch('/files/:id', async (c) => {
    const id = c.req.param('id');
    let body: { name?: unknown; tags?: unknown; url?: unknown; important?: unknown; encMeta?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'bad_request', 'Body must be JSON');
    }
    if (body.name === undefined && body.tags === undefined && body.url === undefined && body.important === undefined && body.encMeta === undefined) {
      return fail(c, 400, 'bad_request', 'Provide name, tags, url, important and/or encMeta');
    }
    if (body.encMeta !== undefined && !isEncText(body.encMeta, MAX_ENC_META)) return fail(c, 400, 'bad_request', `encMeta must be a non-empty string of at most ${MAX_ENC_META} characters`);
    if (body.important !== undefined && typeof body.important !== 'boolean') return fail(c, 400, 'bad_request', 'important must be true or false');
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') return fail(c, 400, 'bad_request', 'name must be a non-empty string');
      if (body.name.length > 255) return fail(c, 400, 'bad_request', 'name must be at most 255 characters');
    }
    if (body.tags !== undefined && !isTagList(body.tags)) return fail(c, 400, 'bad_request', `tags must be at most ${MAX_TAGS} distinct colours`);
    const row = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ? AND status = 'ready' AND deleted_at IS NULL`).bind(id).first<Row>();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    // The name and address of an encrypted item live in enc_meta, which only the client can rewrite.
    if (row.encrypted === 1 && (body.name !== undefined || body.url !== undefined)) return fail(c, 409, 'encrypted', 'Send encMeta instead of a plain name or url');
    if (row.encrypted !== 1 && body.encMeta !== undefined) return fail(c, 400, 'bad_request', 'Only encrypted items have encMeta');

    let next: Row = { ...row };
    if (typeof body.encMeta === 'string') next.enc_meta = body.encMeta;
    if (typeof body.name === 'string') {
      next.name = row.kind === 'link' ? sanitizeTitle(body.name) || row.name : sanitizeName(body.name);
      if (row.kind === 'link') next.title_set = 1;
    }
    if (isTagList(body.tags)) next.tags = body.tags.join(',');
    if (typeof body.important === 'boolean') next.important = body.important ? 1 : 0;

    if (body.url !== undefined) {
      if (row.kind !== 'link') return fail(c, 400, 'bad_request', 'Only links have a url');
      const url = typeof body.url === 'string' ? normalizeUrl(body.url) : null;
      if (!url) return fail(c, 400, 'bad_url', `url must be an http(s) address of at most ${MAX_URL_LENGTH} characters`);
      if (url !== row.url) {
        const clash = await c.env.DB.prepare(`SELECT id FROM files WHERE kind = 'link' AND url = ? AND deleted_at IS NULL AND id != ?`).bind(url, id).first();
        if (clash) return fail(c, 409, 'duplicate_url', 'This link is already saved');
        // The old preview describes another page: drop it so it is fetched again for the new address.
        await c.env.BUCKET.delete(thumbKey(id));
        next = { ...next, url, has_thumb: 0, previewed_at: null, icon_url: null };
        if (!next.title_set) next.name = hostOf(url);
      }
    }
    await c.env.DB.prepare('UPDATE files SET name = ?, tags = ?, url = ?, has_thumb = ?, previewed_at = ?, title_set = ?, icon_url = ?, important = ?, enc_meta = ? WHERE id = ?')
      .bind(next.name, next.tags, next.url, next.has_thumb, next.previewed_at, next.title_set, next.icon_url, next.important, next.enc_meta, id)
      .run();
    return c.json(await itemOf(c, next));
  });

  // Moves a file into or out of the Vault.
  // Once a Vault exists, the move goes through the encrypting endpoints, so an app that still sends this one is told to update.
  app.put('/files/:id/vault', async (c) => {
    if ((await vaultState(c.env.DB)) !== 'none') return appOutdated(c);
    const id = c.req.param('id');
    let body: { inVault?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'bad_request', 'Body must be JSON');
    }
    if (typeof body.inVault !== 'boolean') return fail(c, 400, 'bad_request', 'inVault must be a boolean');
    const row = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ? AND status = 'ready' AND deleted_at IS NULL`).bind(id).first<Row>();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    await c.env.DB.prepare('UPDATE files SET in_vault = ? WHERE id = ?').bind(body.inVault ? 1 : 0, id).run();
    return c.json(await itemOf(c, { ...row, in_vault: body.inVault ? 1 : 0 }));
  });

  app.post('/files/:id/restore', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ? AND status = 'ready'`).bind(id).first<Row>();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    if (row.deleted_at === null) return c.json(await itemOf(c, row));
    // Out of the trash a file is kept for good, so there is no clock to restart (retain_from is unused now).
    await c.env.DB.prepare('UPDATE files SET deleted_at = NULL WHERE id = ?').bind(id).run();
    return c.json(await itemOf(c, { ...row, deleted_at: null }));
  });

  app.delete('/files/:id/permanent', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT deleted_at FROM files WHERE id = ?').bind(id).first<Pick<Row, 'deleted_at'>>();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    if (row.deleted_at === null) return fail(c, 409, 'not_in_trash', 'Move the file to the trash first');
    await purge(c.env, [id]);
    return c.body(null, 204);
  });

  app.delete('/trash', async (c) => {
    let deleted = 0;
    for (;;) {
      const { results } = await c.env.DB.prepare('SELECT id FROM files WHERE deleted_at IS NOT NULL AND in_vault = 0 LIMIT 100').all<{ id: string }>();
      if (results.length === 0) break;
      await purge(c.env, results.map((r) => r.id));
      deleted += results.length;
    }
    const res: EmptyTrashResponse = { deleted };
    return c.json(res);
  });

  // ---- Public share links (owner side). The recipient's side is in share-public.ts. ----

  app.get('/files/:id/share', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM shares WHERE file_id = ? AND (expires_at IS NULL OR expires_at > ?)`).bind(id, Date.now()).first<ShareRow>();
    if (!row) return fail(c, 404, 'not_shared', 'This file is not shared');
    return c.json(toShareInfo(new URL(c.req.url).origin, row));
  });

  app.put('/files/:id/share', async (c) => {
    const id = c.req.param('id');
    // Only a finished photo or file outside the trash and the Vault can be shared.
    const file = await c.env.DB.prepare(`SELECT id, kind FROM files WHERE id = ? AND status = 'ready' AND deleted_at IS NULL AND in_vault = 0`).bind(id).first<Pick<Row, 'id' | 'kind'>>();
    if (!file) return fail(c, 404, 'not_found', 'File not found');
    if (file.kind !== 'image' && file.kind !== 'file') return fail(c, 400, 'not_shareable', 'Only photos and files can be shared');
    const body = (await c.req.json().catch(() => null)) as { expiresInDays?: unknown } | null;
    if (!body || !('expiresInDays' in body) || !isShareExpiry(body.expiresInDays)) {
      return fail(c, 400, 'bad_expiry', 'expiresInDays must be 1, 7, 30 or null');
    }
    const now = Date.now();
    const expiresAt = body.expiresInDays === null ? null : now + body.expiresInDays * DAY;
    const origin = new URL(c.req.url).origin;

    const existing = await c.env.DB.prepare('SELECT * FROM shares WHERE file_id = ?').bind(id).first<ShareRow>();
    if (existing && (existing.expires_at === null || existing.expires_at > now)) {
      // Changing the expiry keeps the link (and its counters); the new time counts from now.
      await c.env.DB.prepare('UPDATE shares SET expires_at = ? WHERE file_id = ?').bind(expiresAt, id).run();
      return c.json(toShareInfo(origin, { ...existing, expires_at: expiresAt }));
    }
    // A link that expired is gone for good: sharing again makes a new one.
    if (existing) await c.env.DB.prepare('DELETE FROM shares WHERE file_id = ?').bind(id).run();
    const row: ShareRow = { token: newShareToken(), file_id: id, created_at: now, expires_at: expiresAt, downloads: 0, last_access_at: null };
    await c.env.DB.prepare('INSERT INTO shares (token, file_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(row.token, id, now, expiresAt).run();
    return c.json(toShareInfo(origin, row), 201);
  });

  app.delete('/files/:id/share', async (c) => {
    await c.env.DB.prepare('DELETE FROM shares WHERE file_id = ?').bind(c.req.param('id')).run();
    return c.json({ ok: true });
  });

  app.notFound((c) => fail(c, 404, 'not_found', 'Route not found'));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });

  return app;
}
