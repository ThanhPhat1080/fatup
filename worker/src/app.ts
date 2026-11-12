import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  DEFAULT_PAGE_SIZE,
  MAX_FILE_SIZE,
  MAX_PAGE_SIZE,
  kindFromMime,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type FileItem,
  type FileKind,
  type ListFilesResponse,
} from '@fatup/shared';
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

function encodeCursor(row: Pick<Row, 'created_at' | 'id'>) {
  return `${row.created_at}_${row.id}`;
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

    const where = [`status = 'ready'`];
    const params: unknown[] = [];
    if (kind !== 'all') {
      where.push('kind = ?');
      params.push(kind);
    }
    const cursorRaw = c.req.query('cursor');
    if (cursorRaw) {
      const cursor = decodeCursor(cursorRaw);
      if (!cursor) return fail(c, 400, 'bad_request', 'Invalid cursor');
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM files WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
      .bind(...params, limit + 1)
      .all<Row>();

    const page = results.slice(0, limit);
    const presigner = c.get('presigner');
    const res: ListFilesResponse = {
      items: await Promise.all(page.map((r) => toItem(r, presigner))),
      nextCursor: results.length > limit ? encodeCursor(page[page.length - 1]) : null,
    };
    return c.json(res);
  });

  app.get('/files/:id/download', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ? AND status = 'ready'`).bind(id).first<Row>();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    const url = await c.get('presigner').get(fileKey(id), { filename: row.name, contentType: row.mime });
    return c.json({ url });
  });

  app.delete('/files/:id', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(id).first();
    if (!row) return fail(c, 404, 'not_found', 'File not found');
    await c.env.BUCKET.delete([fileKey(id), thumbKey(id)]);
    await c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
    return c.body(null, 204);
  });

  app.notFound((c) => fail(c, 404, 'not_found', 'Route not found'));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });

  return app;
}
