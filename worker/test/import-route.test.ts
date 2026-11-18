import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FileItem, ImportSyncResponse, ListFilesResponse } from '@fatup/shared';
import { createApp } from '../src/app';
import { cleanup } from '../src/cleanup';
import { importId } from '../src/import';
import { ObjectChangedError, ObjectMissingError, type ObjectStore } from '../src/object-store';
import { fileKey } from '../src/presign';

const fakePresigner = () => ({
  put: async (key: string) => `https://r2.test/put/${key}`,
  get: async (key: string) => `https://r2.test/get/${key}`,
});

/** The R2 binding seen as an ObjectStore, counting the calls it gets. */
function bucketStore() {
  const calls: string[] = [];
  const store: ObjectStore = {
    async list(prefix, cursor) {
      calls.push('list');
      const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
      return { objects: page.objects.map((o) => ({ key: o.key, size: o.size, etag: o.etag, uploaded: o.uploaded.getTime() })), next: page.truncated ? page.cursor : null };
    },
    async head(key) {
      calls.push('head');
      const o = await env.BUCKET.head(key);
      return o ? { size: o.size, etag: o.etag } : null;
    },
    async copy(from, to, etag) {
      calls.push('copy');
      const src = await env.BUCKET.get(from);
      if (!src) throw new ObjectMissingError(from);
      if (etag !== undefined && src.etag !== etag) throw new ObjectChangedError(from);
      await env.BUCKET.put(to, await src.arrayBuffer());
    },
    async delete(key) {
      calls.push('delete');
      await env.BUCKET.delete(key);
    },
  };
  return { store, calls };
}

const AUTH = { Authorization: 'Bearer test-token' };

/** The test environment with IMPORT_PREFIX replaced (wrangler.toml gives it a value; tests need to vary it). */
const envWith = (prefix: string | undefined) => Object.assign(Object.create(env), { IMPORT_PREFIX: prefix }) as typeof env;

/** `prefix` null leaves IMPORT_PREFIX unset. */
function sync(store: ObjectStore, prefix: string | null = 'd30/', init: RequestInit = { method: 'POST', headers: AUTH }) {
  const app = createApp({ presigner: fakePresigner, objectStore: () => store });
  return app.request('/import/sync', init, envWith(prefix ?? undefined));
}

async function list(store: ObjectStore): Promise<FileItem[]> {
  const app = createApp({ presigner: fakePresigner, objectStore: () => store });
  const res = await app.request('/files', { headers: AUTH }, envWith('d30/'));
  return ((await res.json()) as ListFilesResponse).items;
}

const has = async (key: string) => (await env.BUCKET.head(key)) !== null;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM files').run();
  const all = await env.BUCKET.list();
  if (all.objects.length > 0) await env.BUCKET.delete(all.objects.map((o) => o.key));
});

describe('POST /import/sync', () => {
  it('needs the API token', async () => {
    const { store } = bucketStore();
    expect((await sync(store, 'd30/', { method: 'POST' })).status).toBe(401);
  });

  it('does nothing, without touching the bucket, when IMPORT_PREFIX is empty or not set', async () => {
    const { store, calls } = bucketStore();
    await env.BUCKET.put('d30/a.png', 'x');
    for (const prefix of [null, '', '   ']) {
      const res = await sync(store, prefix);
      expect(res.status).toBe(200);
      expect((await res.json()) as ImportSyncResponse).toEqual({ imported: 0, more: false });
    }
    expect(calls).toEqual([]);
    expect(await has('d30/a.png')).toBe(true);
  });

  it('imports an image and then lists it as a plain file from the folder, shown by its original until it has a thumbnail', async () => {
    const { store } = bucketStore();
    await env.BUCKET.put('d30/a.png', 'pixels');

    const res = await sync(store);

    expect((await res.json()) as ImportSyncResponse).toEqual({ imported: 1, more: false });
    const [item] = await list(store);
    expect(item).toMatchObject({ name: 'a.png', kind: 'image', mime: 'image/png', device: 'd30', hasThumb: false, deletedAt: null, inVault: false });
    expect(item.thumbUrl).toBe(`https://r2.test/get/files/${item.id}`);
  });

  it('matches a prefix without its trailing slash only as a folder (d30 does not match d300/)', async () => {
    const { store } = bucketStore();
    await env.BUCKET.put('d30/a.png', 'x');
    await env.BUCKET.put('d300/b.png', 'x');

    await sync(store, 'd30');

    expect((await list(store)).map((i) => i.name)).toEqual(['a.png']);
    expect(await has('d300/b.png')).toBe(true);
  });

  it("refuses to import Fatup's own objects or the whole bucket", async () => {
    const { store, calls } = bucketStore();
    await env.BUCKET.put('files/01ARZ3NDEKTSV4RRFFQ69G5FAV', 'x');
    for (const prefix of ['files/', 'files', 'thumbs/', 'vault/', '/', 'files/sub/']) {
      const res = await sync(store, prefix);
      expect((await res.json()) as ImportSyncResponse).toEqual({ imported: 0, more: false });
    }
    expect(calls).toEqual([]);
    expect(await list(store)).toEqual([]);
  });

  it('two requests at the same moment leave one image', async () => {
    const { store } = bucketStore();
    await env.BUCKET.put('d30/a.png', 'pixels');

    await Promise.all([sync(store), sync(store)]);

    expect(await list(store)).toHaveLength(1);
    expect((await env.BUCKET.list({ prefix: 'files/' })).objects).toHaveLength(1);
  });

  it('an import cut off for over 24 hours is swept by the cron and imported again cleanly, the source untouched meanwhile', async () => {
    const { store } = bucketStore();
    await env.BUCKET.put('d30/a.png', 'pixels');
    const source = (await env.BUCKET.head('d30/a.png'))!;
    const id = await importId('d30/a.png', source.etag, source.uploaded.getTime());
    const longAgo = Date.now() - 25 * 60 * 60 * 1000;
    await env.DB.prepare(`INSERT INTO files (id, name, mime, size, kind, has_thumb, status, device, created_at) VALUES (?, 'a.png', 'image/png', 6, 'image', 0, 'pending', 'd30', ?)`).bind(id, longAgo).run();
    await env.BUCKET.put(fileKey(id), 'pixels');

    expect(await cleanup(env)).toBe(1);

    expect(await has(fileKey(id))).toBe(false);
    expect(await has('d30/a.png')).toBe(true);

    await sync(store);

    expect(await list(store)).toHaveLength(1);
    expect(await has('d30/a.png')).toBe(false);
  });
});

describe('hasThumb and thumbUrl', () => {
  it('an image that has a thumbnail says so and points at it', async () => {
    const { store } = bucketStore();
    await env.DB.prepare(`INSERT INTO files (id, name, mime, size, kind, has_thumb, status, created_at) VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'p.jpg', 'image/jpeg', 3, 'image', 1, 'ready', 1)`).run();
    const [item] = await list(store);
    expect(item.hasThumb).toBe(true);
    expect(item.thumbUrl).toBe('https://r2.test/get/thumbs/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg');
  });

  it('a file that is not an image has no thumbnail at all', async () => {
    const { store } = bucketStore();
    await env.DB.prepare(`INSERT INTO files (id, name, mime, size, kind, has_thumb, status, created_at) VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAW', 'r.pdf', 'application/pdf', 3, 'file', 0, 'ready', 1)`).run();
    const [item] = await list(store);
    expect(item).toMatchObject({ hasThumb: false, thumbUrl: null });
  });
});
