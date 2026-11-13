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
  type CreateUploadRequest,
  type CreateUploadResponse,
  type EmptyTrashResponse,
  type FileItem,
  type FileKind,
  type ListFilesResponse,
} from '@fatup/shared';
import { purge } from './cleanup';
import type { Env } from './env';
import { createPresigner, fileKey, thumbKey, type Presigner } from './presign';
import { isUlid, ulid } from './ulid';

type Row = {
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
  retain_from: number | null;
};

type AppEnv = { Bindings: Env; Variables: { presigner: Presigner } };

export type AppOptions = {
  /** Lets tests swap in a presigner that does not need real R2 credentials. */
  presigner?: (env: Env) => Presigner;
};

function fail(c: Context, status: 400 | 401 | 404 | 409 | 413, code: string, message: string) {
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

/** Strips directory parts and control characters from a client-supplied name. */
export function sanitizeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 255);
  return clean || 'file';
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

async function toItem(row: Row, presigner: Presigner): Promise<FileItem> {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    kind: row.kind,
    thumbUrl: row.has_thumb ? await presigner.get(thumbKey(row.id), { contentType: 'image/jpeg' }) : null,
    device: row.device,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    inVault: row.in_vault === 1,
    tags: parseTags(row.tags),
  };
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();
  const makePresigner = options.presigner ?? createPresigner;

  app.get('/health', (c) => c.json({ ok: true }));

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
    if (size > MAX_FILE_SIZE) return fail(c, 413, 'too_large', `Files are limited to ${MAX_FILE_SIZE} bytes`);

    const cleanMime = /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime.toLowerCase() : 'application/octet-stream';
    const kind = kindFromMime(cleanMime);
    const withThumb = hasThumb === true && kind === 'image';
    const id = ulid();
    const now = Date.now();

    await c.env.DB.prepare(
      `INSERT INTO files (id, name, mime, size, kind, has_thumb, status, device, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
      .bind(id, sanitizeName(name), cleanMime, size, kind, withThumb ? 1 : 0, typeof device === 'string' ? device.slice(0, 64) : null, now)
      .run();

    const presigner = c.get('presigner');
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
    if (row.status === 'ready') return c.json(await toItem(row, c.get('presigner')));

    const object = await c.env.BUCKET.head(fileKey(id));
    if (!object) return fail(c, 409, 'not_uploaded', 'File has not been uploaded yet');
    if (object.size !== row.size) {
      await c.env.BUCKET.delete([fileKey(id), thumbKey(id)]);
      await c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
      return fail(c, 409, 'size_mismatch', 'Uploaded size does not match');
    }
    const hasThumb = row.has_thumb ? (await c.env.BUCKET.head(thumbKey(id))) !== null : false;
    const now = Date.now();
    await c.env.DB.prepare(`UPDATE files SET status = 'ready', has_thumb = ?, created_at = ? WHERE id = ?`)
      .bind(hasThumb ? 1 : 0, now, id)
      .run();
    return c.json(await toItem({ ...row, status: 'ready', has_thumb: hasThumb ? 1 : 0, created_at: now }, c.get('presigner')));
  });

  app.get('/files', async (c) => {
    const kind = c.req.query('kind') ?? 'all';
    if (!['all', 'image', 'file'].includes(kind)) return fail(c, 400, 'bad_request', 'Invalid kind');
    const limitRaw = Number(c.req.query('limit') ?? DEFAULT_PAGE_SIZE);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

    const trash = c.req.query('trash') === '1';
    // The trash is ordered by when files were deleted, the normal list by when they were uploaded.
    const sortCol = trash ? 'deleted_at' : 'created_at';
    // The Vault is a separate list; trashed files are shown together because deleting a file takes it out of the Vault.
    const vault = c.req.query('vault') === '1';
    const where = [`status = 'ready'`, trash ? 'deleted_at IS NOT NULL' : `deleted_at IS NULL AND in_vault = ${vault ? 1 : 0}`];
    const params: unknown[] = [];
    if (kind !== 'all') {
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
    const res: ListFilesResponse = {
      items: await Promise.all(page.map((r) => toItem(r, presigner))),
      nextCursor: results.length > limit ? encodeCursor(page[page.length - 1][sortCol] ?? 0, page[page.length - 1].id) : null,
    };
    return c.json(res);
  });

  app.get('/files/:id/download', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ? AND status = 'ready' AND deleted_at IS NULL`).bind(id).first<Row>();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    const url = await c.get('presigner').get(fileKey(id), { filename: row.name, contentType: row.mime });
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
      await c.env.DB.prepare('UPDATE files SET deleted_at = ?, in_vault = 0 WHERE id = ? AND deleted_at IS NULL').bind(Date.now(), id).run();
    }
    return c.body(null, 204);
  });

  // Updates a file's display name and/or colour tags. The R2 objects are keyed by id, so a rename never touches them.
  app.patch('/files/:id', async (c) => {
    const id = c.req.param('id');
    let body: { name?: unknown; tags?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'bad_request', 'Body must be JSON');
    }
    if (body.name === undefined && body.tags === undefined) return fail(c, 400, 'bad_request', 'Provide name and/or tags');
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') return fail(c, 400, 'bad_request', 'name must be a non-empty string');
      if (body.name.length > 255) return fail(c, 400, 'bad_request', 'name must be at most 255 characters');
    }
    if (body.tags !== undefined && !isTagList(body.tags)) return fail(c, 400, 'bad_request', `tags must be at most ${MAX_TAGS} distinct colours`);
    const row = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ? AND status = 'ready' AND deleted_at IS NULL`).bind(id).first<Row>();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    const name = typeof body.name === 'string' ? sanitizeName(body.name) : row.name;
    const tags = isTagList(body.tags) ? body.tags.join(',') : row.tags;
    await c.env.DB.prepare('UPDATE files SET name = ?, tags = ? WHERE id = ?').bind(name, tags, id).run();
    return c.json(await toItem({ ...row, name, tags }, c.get('presigner')));
  });

  // Moves a file into or out of the Vault.
  app.put('/files/:id/vault', async (c) => {
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
    return c.json(await toItem({ ...row, in_vault: body.inVault ? 1 : 0 }, c.get('presigner')));
  });

  app.post('/files/:id/restore', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ? AND status = 'ready'`).bind(id).first<Row>();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    if (row.deleted_at === null) return c.json(await toItem(row, c.get('presigner')));
    const now = Date.now();
    await c.env.DB.prepare('UPDATE files SET deleted_at = NULL, retain_from = ? WHERE id = ?').bind(now, id).run();
    return c.json(await toItem({ ...row, deleted_at: null, retain_from: now }, c.get('presigner')));
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
      const { results } = await c.env.DB.prepare('SELECT id FROM files WHERE deleted_at IS NOT NULL LIMIT 500').all<{ id: string }>();
      if (results.length === 0) break;
      await purge(c.env, results.map((r) => r.id));
      deleted += results.length;
    }
    const res: EmptyTrashResponse = { deleted };
    return c.json(res);
  });

  app.notFound((c) => fail(c, 404, 'not_found', 'Route not found'));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });

  return app;
}
