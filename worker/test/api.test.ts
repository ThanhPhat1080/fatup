import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateUploadResponse, FileItem, ListFilesResponse } from '@fatup/shared';
import { createApp, sanitizeName } from '../src/app';
import { cleanup } from '../src/cleanup';
import { contentDisposition, createPresigner, fileKey, thumbKey } from '../src/presign';

const fakePresigner = () => ({
  put: async (key: string) => `https://r2.test/put/${key}`,
  get: async (key: string, opts?: { filename?: string }) =>
    `https://r2.test/get/${key}${opts?.filename ? `?name=${encodeURIComponent(opts.filename)}` : ''}`,
});

const app = createApp({ presigner: fakePresigner });
const AUTH = { Authorization: 'Bearer test-token' };

function call(path: string, init: RequestInit = {}) {
  return app.request(path, { ...init, headers: { ...AUTH, ...(init.headers ?? {}) } }, env);
}

function postJson(path: string, body: unknown) {
  return call(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

/** Runs the full create → PUT → complete flow, writing objects straight to the R2 binding. */
async function upload(name: string, mime: string, content = 'hello', thumb = false): Promise<FileItem> {
  const res = await postJson('/uploads', { name, mime, size: new TextEncoder().encode(content).length, hasThumb: thumb, device: 'Pixel' });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as CreateUploadResponse;
  await env.BUCKET.put(fileKey(id), content);
  if (thumb) await env.BUCKET.put(thumbKey(id), 'jpeg');
  const done = await call(`/uploads/${id}/complete`, { method: 'POST' });
  expect(done.status).toBe(200);
  return (await done.json()) as FileItem;
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM files').run();
});

describe('auth', () => {
  it('serves /health without a token', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
  });

  it('rejects missing and wrong tokens', async () => {
    expect((await app.request('/files', {}, env)).status).toBe(401);
    expect((await app.request('/files', { headers: { Authorization: 'Bearer nope' } }, env)).status).toBe(401);
    expect((await call('/me')).status).toBe(200);
  });
});

describe('uploads', () => {
  it('creates a pending upload with a thumbnail URL only for images', async () => {
    const img = (await (await postJson('/uploads', { name: 'a.heic', mime: 'image/heic', size: 3, hasThumb: true })).json()) as CreateUploadResponse;
    expect(img.uploadUrl).toBe(`https://r2.test/put/files/${img.id}`);
    expect(img.thumbUploadUrl).toBe(`https://r2.test/put/thumbs/${img.id}.jpg`);

    const pdf = (await (await postJson('/uploads', { name: 'a.pdf', mime: 'application/pdf', size: 3, hasThumb: true })).json()) as CreateUploadResponse;
    expect(pdf.thumbUploadUrl).toBeNull();

    const list = (await (await call('/files')).json()) as ListFilesResponse;
    expect(list.items).toHaveLength(0); // pending uploads are hidden
  });

  it('rejects files over 100 MB and malformed bodies', async () => {
    expect((await postJson('/uploads', { name: 'big', mime: 'video/mp4', size: 100 * 1024 * 1024 + 1, hasThumb: false })).status).toBe(413);
    expect((await postJson('/uploads', { name: 'x' })).status).toBe(400);
    expect((await call('/uploads', { method: 'POST', body: 'not json' })).status).toBe(400);
  });

  it('refuses to complete before the object exists, and on size mismatch', async () => {
    const { id } = (await (await postJson('/uploads', { name: 'a.txt', mime: 'text/plain', size: 5, hasThumb: false })).json()) as CreateUploadResponse;
    expect((await call(`/uploads/${id}/complete`, { method: 'POST' })).status).toBe(409);

    await env.BUCKET.put(fileKey(id), 'too long content');
    const res = await call(`/uploads/${id}/complete`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await env.BUCKET.head(fileKey(id))).toBeNull();
  });

  it('completes, classifies, and drops a missing thumbnail', async () => {
    const withThumb = await upload('photo.jpg', 'image/jpeg', 'abc', true);
    expect(withThumb.kind).toBe('image');
    expect(withThumb.thumbUrl).toContain(`thumbs/${withThumb.id}.jpg`);
    expect(withThumb.device).toBe('Pixel');

    const res = await postJson('/uploads', { name: 'nothumb.png', mime: 'image/png', size: 1, hasThumb: true });
    const { id } = (await res.json()) as CreateUploadResponse;
    await env.BUCKET.put(fileKey(id), 'x');
    const item = (await (await call(`/uploads/${id}/complete`, { method: 'POST' })).json()) as FileItem;
    expect(item.thumbUrl).toBeNull();

    const doc = await upload('../../etc/report.pdf', 'application/pdf');
    expect(doc.kind).toBe('file');
    expect(doc.name).toBe('report.pdf');
  });

  it('is idempotent when complete is retried', async () => {
    const item = await upload('a.txt', 'text/plain');
    const again = await call(`/uploads/${item.id}/complete`, { method: 'POST' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as FileItem).createdAt).toBe(item.createdAt);
  });
});

describe('listing', () => {
  it('filters by kind, sorts newest first, and paginates', async () => {
    const a = await upload('1.jpg', 'image/jpeg');
    const b = await upload('2.pdf', 'application/pdf');
    const c = await upload('3.png', 'image/png');

    const all = (await (await call('/files')).json()) as ListFilesResponse;
    expect(all.items.map((i) => i.id)).toEqual([c.id, b.id, a.id]);

    const images = (await (await call('/files?kind=image')).json()) as ListFilesResponse;
    expect(images.items.map((i) => i.id)).toEqual([c.id, a.id]);
    const files = (await (await call('/files?kind=file')).json()) as ListFilesResponse;
    expect(files.items.map((i) => i.id)).toEqual([b.id]);

    const p1 = (await (await call('/files?limit=2')).json()) as ListFilesResponse;
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = (await (await call(`/files?limit=2&cursor=${p1.nextCursor}`)).json()) as ListFilesResponse;
    expect(p2.items.map((i) => i.id)).toEqual([a.id]);
    expect(p2.nextCursor).toBeNull();

    expect((await call('/files?kind=video')).status).toBe(400);
    expect((await call('/files?cursor=garbage')).status).toBe(400);
  });
});

describe('download and delete', () => {
  it('returns a download URL carrying the original name', async () => {
    const item = await upload('Ảnh đẹp.jpg', 'image/jpeg');
    const { url } = (await (await call(`/files/${item.id}/download`)).json()) as { url: string };
    expect(url).toContain(`files/${item.id}`);
    expect(decodeURIComponent(url)).toContain('Ảnh đẹp.jpg');
    expect((await call('/files/01HZZZZZZZZZZZZZZZZZZZZZZZ/download')).status).toBe(404);
  });

  it('deletes the row and both objects', async () => {
    const item = await upload('x.jpg', 'image/jpeg', 'x', true);
    expect((await call(`/files/${item.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await env.BUCKET.head(fileKey(item.id))).toBeNull();
    expect(await env.BUCKET.head(thumbKey(item.id))).toBeNull();
    expect((await call(`/files/${item.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('cleanup', () => {
  it('removes files older than 30 days and stale pending uploads only', async () => {
    const old = await upload('old.txt', 'text/plain');
    const fresh = await upload('fresh.txt', 'text/plain');
    const day = 24 * 60 * 60 * 1000;
    await env.DB.prepare('UPDATE files SET created_at = ? WHERE id = ?').bind(Date.now() - 31 * day, old.id).run();

    const pending = (await (await postJson('/uploads', { name: 'p', mime: 'text/plain', size: 1, hasThumb: false })).json()) as CreateUploadResponse;
    const freshPending = (await (await postJson('/uploads', { name: 'q', mime: 'text/plain', size: 1, hasThumb: false })).json()) as CreateUploadResponse;
    await env.DB.prepare('UPDATE files SET created_at = ? WHERE id = ?').bind(Date.now() - 2 * day, pending.id).run();

    expect(await cleanup(env)).toBe(2);
    const ids = (await env.DB.prepare('SELECT id FROM files').all<{ id: string }>()).results.map((r) => r.id).sort();
    expect(ids).toEqual([fresh.id, freshPending.id].sort());
    expect(await env.BUCKET.head(fileKey(old.id))).toBeNull();
  });
});

describe('helpers', () => {
  it('sanitizes names', () => {
    expect(sanitizeName('C:\\Users\\me\\a.txt')).toBe('a.txt');
    expect(sanitizeName('  \u0000 ')).toBe('file');
  });

  it('builds RFC 6266 content-disposition', () => {
    expect(contentDisposition('Ảnh "1".jpg')).toBe(`attachment; filename="_nh _1_.jpg"; filename*=UTF-8''%E1%BA%A2nh%20%221%22.jpg`);
  });

  it('produces SigV4 presigned URLs for R2', async () => {
    const p = createPresigner(env);
    const url = new URL(await p.put('files/ABC'));
    expect(url.host).toBe('acct.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/fatup-files/files/ABC');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });
});
