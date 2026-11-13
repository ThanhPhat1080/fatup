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

  it('moves a file to the trash, keeping its objects, and hides it from the list and downloads', async () => {
    const item = await upload('x.jpg', 'image/jpeg', 'x', true);
    expect((await call(`/files/${item.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/files/${item.id}`, { method: 'DELETE' })).status).toBe(204); // idempotent
    expect(await env.BUCKET.head(fileKey(item.id))).not.toBeNull();
    expect(await env.BUCKET.head(thumbKey(item.id))).not.toBeNull();
    expect(((await (await call('/files')).json()) as ListFilesResponse).items).toEqual([]);
    expect((await call(`/files/${item.id}/download`)).status).toBe(404);
    expect((await call('/files/01HZZZZZZZZZZZZZZZZZZZZZZZ', { method: 'DELETE' })).status).toBe(404);
  });

  it('removes an unfinished upload outright instead of trashing it', async () => {
    const pending = (await (await postJson('/uploads', { name: 'p', mime: 'text/plain', size: 1, hasThumb: false })).json()) as CreateUploadResponse;
    expect((await call(`/files/${pending.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(pending.id).first()).toBeNull();
  });
});

describe('usage', () => {
  it('sums ready files (trash included) against the 10 GB free tier', async () => {
    expect(await (await call('/usage')).json()).toEqual({ usedBytes: 0, limitBytes: 10_000_000_000 });
    await upload('a.txt', 'text/plain', 'hello'); // 5 bytes
    const b = await upload('b.txt', 'text/plain', 'worlds'); // 6 bytes
    await call(`/files/${b.id}`, { method: 'DELETE' });
    await postJson('/uploads', { name: 'p', mime: 'text/plain', size: 999, hasThumb: false }); // pending: not counted
    expect(await (await call('/usage')).json()).toEqual({ usedBytes: 11, limitBytes: 10_000_000_000 });
  });
});

describe('rename', () => {
  const rename = (id: string, name: unknown) =>
    call(`/files/${id}`, { method: 'PATCH', body: JSON.stringify({ name }), headers: { 'Content-Type': 'application/json' } });

  it('changes the name and keeps everything else', async () => {
    const a = await upload('old.jpg', 'image/jpeg');
    const res = await rename(a.id, '  new name.jpg ');
    expect(res.status).toBe(200);
    const item = (await res.json()) as FileItem;
    expect(item).toMatchObject({ id: a.id, name: 'new name.jpg', mime: 'image/jpeg', size: a.size });
    const listed = ((await (await call('/files')).json()) as ListFilesResponse).items;
    expect(listed.map((i) => i.name)).toEqual(['new name.jpg']);
  });

  it('strips path separators like uploads do', async () => {
    const a = await upload('a.txt', 'text/plain');
    expect(((await (await rename(a.id, '../evil/b.txt')).json()) as FileItem).name).toBe('b.txt');
  });

  it('rejects bad names, missing files and trashed files', async () => {
    const a = await upload('a.txt', 'text/plain');
    expect((await rename(a.id, '')).status).toBe(400);
    expect((await rename(a.id, '   ')).status).toBe(400);
    expect((await rename(a.id, 42)).status).toBe(400);
    expect((await rename(a.id, 'x'.repeat(256))).status).toBe(400);
    expect((await rename('01HZZZZZZZZZZZZZZZZZZZZZZZ', 'b.txt')).status).toBe(404);
    await call(`/files/${a.id}`, { method: 'DELETE' });
    expect((await rename(a.id, 'b.txt')).status).toBe(404);
  });
});

describe('tags', () => {
  const patch = (id: string, body: unknown) =>
    call(`/files/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

  it('starts empty, then stores tags in the order given and returns them in lists', async () => {
    const a = await upload('a.txt', 'text/plain');
    expect(a.tags).toEqual([]);
    const res = await patch(a.id, { tags: ['green', 'red'] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileItem).tags).toEqual(['green', 'red']);
    const listed = ((await (await call('/files')).json()) as ListFilesResponse).items;
    expect(listed[0].tags).toEqual(['green', 'red']);
  });

  it('can change name and tags together or separately, without losing the other', async () => {
    const a = await upload('a.txt', 'text/plain');
    await patch(a.id, { tags: ['blue'] });
    const renamed = (await (await patch(a.id, { name: 'b.txt' })).json()) as FileItem;
    expect(renamed).toMatchObject({ name: 'b.txt', tags: ['blue'] });
    const both = (await (await patch(a.id, { name: 'c.txt', tags: [] })).json()) as FileItem;
    expect(both).toMatchObject({ name: 'c.txt', tags: [] });
  });

  it('rejects unknown colours, duplicates, more than three, non-arrays and empty bodies', async () => {
    const a = await upload('a.txt', 'text/plain');
    expect((await patch(a.id, { tags: ['pink'] })).status).toBe(400);
    expect((await patch(a.id, { tags: ['red', 'red'] })).status).toBe(400);
    expect((await patch(a.id, { tags: ['red', 'green', 'blue', 'gray'] })).status).toBe(400);
    expect((await patch(a.id, { tags: 'red' })).status).toBe(400);
    expect((await patch(a.id, {})).status).toBe(400);
    expect(((await (await call('/files')).json()) as ListFilesResponse).items[0].tags).toEqual([]);
  });

  it('does not tag missing or trashed files, but trashed files keep their tags', async () => {
    const a = await upload('a.txt', 'text/plain');
    await patch(a.id, { tags: ['red'] });
    expect((await patch('01HZZZZZZZZZZZZZZZZZZZZZZZ', { tags: ['red'] })).status).toBe(404);
    await call(`/files/${a.id}`, { method: 'DELETE' });
    expect((await patch(a.id, { tags: ['blue'] })).status).toBe(404);
    const trashed = ((await (await call('/files?trash=1')).json()) as ListFilesResponse).items;
    expect(trashed[0].tags).toEqual(['red']);
  });
});

describe('vault', () => {
  const list =async (path: string) => ((await (await call(path)).json()) as ListFilesResponse).items;
  const setVault = (id: string, inVault: unknown) =>
    call(`/files/${id}/vault`, { method: 'PUT', body: JSON.stringify({ inVault }), headers: { 'Content-Type': 'application/json' } });

  it('moves files between the main list and the vault list', async () => {
    const a = await upload('a.txt', 'text/plain');
    const b = await upload('b.txt', 'text/plain');
    const res = await setVault(a.id, true);
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileItem).inVault).toBe(true);
    expect((await list('/files')).map((i) => i.id)).toEqual([b.id]);
    expect((await list('/files?vault=1')).map((i) => i.id)).toEqual([a.id]);
    await setVault(a.id, false);
    expect((await list('/files?vault=1'))).toEqual([]);
    expect((await list('/files')).map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('validates the request and rejects missing or trashed files', async () => {
    const a = await upload('a.txt', 'text/plain');
    expect((await setVault(a.id, 'yes')).status).toBe(400);
    expect((await setVault('01HZZZZZZZZZZZZZZZZZZZZZZZ', true)).status).toBe(404);
    await call(`/files/${a.id}`, { method: 'DELETE' });
    expect((await setVault(a.id, true)).status).toBe(404);
  });

  it('takes a file out of the vault when it is deleted, so it shows up (and restores) in the normal trash', async () => {
    const a = await upload('secret.txt', 'text/plain');
    await setVault(a.id, true);
    await call(`/files/${a.id}`, { method: 'DELETE' });
    expect((await list('/files?vault=1'))).toEqual([]);
    expect((await list('/files?trash=1')).map((i) => i.id)).toEqual([a.id]);
    await call(`/files/${a.id}/restore`, { method: 'POST' });
    expect((await list('/files')).map((i) => i.id)).toEqual([a.id]);
  });
});

describe('trash', () => {
  const list = async (path: string) => ((await (await call(path)).json()) as ListFilesResponse).items;

  it('lists trashed files newest-deleted first, with deletedAt', async () => {
    const a = await upload('a.txt', 'text/plain');
    const b = await upload('b.txt', 'text/plain');
    await call(`/files/${a.id}`, { method: 'DELETE' });
    await new Promise((r) => setTimeout(r, 5));
    await call(`/files/${b.id}`, { method: 'DELETE' });
    const items = await list('/files?trash=1');
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(items[0].deletedAt).toBeGreaterThan(0);
    expect((await list('/files'))).toEqual([]);
  });

  it('paginates the trash', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const it = await upload(`f${i}.txt`, 'text/plain');
      ids.push(it.id);
      await call(`/files/${it.id}`, { method: 'DELETE' });
      await new Promise((r) => setTimeout(r, 3));
    }
    const first = (await (await call('/files?trash=1&limit=2')).json()) as ListFilesResponse;
    expect(first.items).toHaveLength(2);
    const second = (await (await call(`/files?trash=1&limit=2&cursor=${first.nextCursor}`)).json()) as ListFilesResponse;
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual([...ids].reverse());
    expect(second.nextCursor).toBeNull();
  });

  it('restores a file back into the list', async () => {
    const item = await upload('r.txt', 'text/plain');
    await call(`/files/${item.id}`, { method: 'DELETE' });
    const res = await call(`/files/${item.id}/restore`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileItem).deletedAt).toBeNull();
    expect((await list('/files')).map((i) => i.id)).toEqual([item.id]);
    expect(await list('/files?trash=1')).toEqual([]);
    expect((await call(`/files/${item.id}/restore`, { method: 'POST' })).status).toBe(200); // idempotent
    expect((await call('/files/01HZZZZZZZZZZZZZZZZZZZZZZZ/restore', { method: 'POST' })).status).toBe(404);
  });

  it('deletes forever only from the trash', async () => {
    const item = await upload('p.jpg', 'image/jpeg', 'x', true);
    expect((await call(`/files/${item.id}/permanent`, { method: 'DELETE' })).status).toBe(409);
    await call(`/files/${item.id}`, { method: 'DELETE' });
    expect((await call(`/files/${item.id}/permanent`, { method: 'DELETE' })).status).toBe(204);
    expect(await env.BUCKET.head(fileKey(item.id))).toBeNull();
    expect(await env.BUCKET.head(thumbKey(item.id))).toBeNull();
    expect((await call(`/files/${item.id}/permanent`, { method: 'DELETE' })).status).toBe(404);
  });

  it('empties the trash without touching live files', async () => {
    const keep = await upload('keep.txt', 'text/plain');
    const gone1 = await upload('g1.txt', 'text/plain');
    const gone2 = await upload('g2.txt', 'text/plain');
    await call(`/files/${gone1.id}`, { method: 'DELETE' });
    await call(`/files/${gone2.id}`, { method: 'DELETE' });
    const res = await call('/trash', { method: 'DELETE' });
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(await env.BUCKET.head(fileKey(gone1.id))).toBeNull();
    expect((await list('/files')).map((i) => i.id)).toEqual([keep.id]);
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

describe('cleanup and the trash', () => {
  const day = 24 * 60 * 60 * 1000;

  it('purges files only after 30 days in the trash, regardless of upload age', async () => {
    const trashedLong = await upload('long.txt', 'text/plain');
    const trashedRecent = await upload('recent.txt', 'text/plain');
    // Both were uploaded 40 days ago, which would normally expire them.
    await env.DB.prepare('UPDATE files SET created_at = ?').bind(Date.now() - 40 * day).run();
    await env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').bind(Date.now() - 31 * day, trashedLong.id).run();
    await env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').bind(Date.now() - 5 * day, trashedRecent.id).run();

    expect(await cleanup(env)).toBe(1);
    expect(await env.BUCKET.head(fileKey(trashedLong.id))).toBeNull();
    expect(await env.BUCKET.head(fileKey(trashedRecent.id))).not.toBeNull();
  });

  it('restarts the retention clock when an old file is restored', async () => {
    const item = await upload('old.txt', 'text/plain');
    await env.DB.prepare('UPDATE files SET created_at = ? WHERE id = ?').bind(Date.now() - 40 * day, item.id).run();
    await call(`/files/${item.id}`, { method: 'DELETE' });
    await call(`/files/${item.id}/restore`, { method: 'POST' });
    expect(await cleanup(env)).toBe(0);
    expect(await env.BUCKET.head(fileKey(item.id))).not.toBeNull();
    // ...and it does expire 30 days after the restore.
    expect(await cleanup(env, Date.now() + 31 * day)).toBe(1);
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
