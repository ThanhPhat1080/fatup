import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { IMPORT_BATCH, imageMime, importId, importImages, isImportableImage } from '../src/import';
import { ObjectChangedError, ObjectMissingError, type ObjectStore } from '../src/object-store';
import { fileKey } from '../src/presign';
import { isUlid, ulid, ulidFrom } from '../src/ulid';

/** An ObjectStore backed by the R2 binding: same behaviour as the S3 one, none of the network. */
function bucketStore(): ObjectStore {
  return {
    async list(prefix, cursor) {
      const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
      return {
        objects: page.objects.map((o) => ({ key: o.key, size: o.size, etag: o.etag, uploaded: o.uploaded.getTime() })),
        next: page.truncated ? page.cursor : null,
      };
    },
    async head(key) {
      const o = await env.BUCKET.head(key);
      return o ? { size: o.size, etag: o.etag } : null;
    },
    async copy(from, to, etag) {
      const src = await env.BUCKET.get(from);
      if (!src) throw new ObjectMissingError(from);
      if (etag !== undefined && src.etag !== etag) throw new ObjectChangedError(from);
      await env.BUCKET.put(to, await src.arrayBuffer());
    },
    async delete(key) {
      await env.BUCKET.delete(key);
    },
  };
}

/** The store, with one operation made to throw (or to run extra code) when `when(op, key)` says so. */
function flaky(when: (op: 'list' | 'head' | 'copy' | 'delete', key: string) => boolean): ObjectStore {
  const base = bucketStore();
  const guard = <A extends unknown[], R>(op: 'list' | 'head' | 'copy' | 'delete', fn: (...a: A) => Promise<R>, keyOf: (...a: A) => string) =>
    async (...a: A) => {
      if (when(op, keyOf(...a))) throw new Error(`injected failure in ${op}`);
      return fn(...a);
    };
  return {
    list: guard('list', base.list, (p) => p),
    head: guard('head', base.head, (k) => k),
    copy: guard('copy', base.copy, (_from, to) => to),
    delete: guard('delete', base.delete, (k) => k),
  };
}

const rows = async () => (await env.DB.prepare('SELECT * FROM files ORDER BY id').all<Record<string, unknown>>()).results;
const has = async (key: string) => (await env.BUCKET.head(key)) !== null;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM files').run();
  const all = await env.BUCKET.list();
  if (all.objects.length > 0) await env.BUCKET.delete(all.objects.map((o) => o.key));
});

describe('isImportableImage / imageMime', () => {
  it('accepts image extensions in any case and refuses the rest', () => {
    expect(isImportableImage('d30/a.PNG', 10)).toBe(true);
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif']) expect(isImportableImage(`d30/x.${ext}`, 1)).toBe(true);
    expect(isImportableImage('d30/a.pdf', 10)).toBe(false);
    expect(isImportableImage('d30/noext', 10)).toBe(false);
    expect(isImportableImage('d30/', 10)).toBe(false);
    expect(isImportableImage('d30/sub/', 10)).toBe(false);
    expect(isImportableImage('d30/a.png', 0)).toBe(false);
    expect(isImportableImage('d30/a.png', 100 * 1024 * 1024)).toBe(true);
    expect(isImportableImage('d30/a.png', 100 * 1024 * 1024 + 1)).toBe(false);
  });

  it('maps an extension to its mime type', () => {
    expect(imageMime('d30/a.PNG')).toBe('image/png');
    expect(imageMime('d30/a.jpg')).toBe('image/jpeg');
    expect(imageMime('d30/a.jpeg')).toBe('image/jpeg');
    expect(imageMime('d30/a.webp')).toBe('image/webp');
    expect(imageMime('d30/a.heic')).toBe('image/heic');
  });
});

describe('importId', () => {
  it('is the same for the same source object and differs when the key or the etag differs', async () => {
    const a = await importId('d30/a.png', 'etag1', 1_800_000_000_000);
    expect(await importId('d30/a.png', 'etag1', 1_800_000_000_000)).toBe(a);
    expect(await importId('d30/a.png', 'etag2', 1_800_000_000_000)).not.toBe(a);
    expect(await importId('d30/b.png', 'etag1', 1_800_000_000_000)).not.toBe(a);
  });

  it('is a ULID whose time part is the upload time', async () => {
    const id = await importId('d30/a.png', 'etag1', 1_800_000_000_000);
    expect(isUlid(id)).toBe(true);
    expect(id.slice(0, 10)).toBe(ulid(1_800_000_000_000).slice(0, 10));
  });

  it('ulidFrom builds a ULID from a time and 16 random bytes', () => {
    const id = ulidFrom(1_800_000_000_000, new Uint8Array(16));
    expect(isUlid(id)).toBe(true);
    expect(id.slice(10)).toBe('0'.repeat(16));
  });
});

describe('importImages', () => {
  it('moves an image from the folder to files/<id> and makes it a ready row', async () => {
    await env.BUCKET.put('d30/Screenshot.png', 'pixels');
    const source = (await env.BUCKET.head('d30/Screenshot.png'))!;

    const res = await importImages(env, bucketStore(), 'd30/');

    expect(res).toEqual({ imported: 1, more: false });
    const [row] = await rows();
    expect(row).toMatchObject({ name: 'Screenshot.png', mime: 'image/png', kind: 'image', size: 6, status: 'ready', device: 'd30', has_thumb: 0, deleted_at: null, created_at: source.uploaded.getTime() });
    expect(await (await env.BUCKET.get(fileKey(row.id as string)))!.text()).toBe('pixels');
    expect(await has('d30/Screenshot.png')).toBe(false);
  });

  it('imports images in sub-folders under their last name segment', async () => {
    await env.BUCKET.put('d30/2026/b.png', 'x');
    await importImages(env, bucketStore(), 'd30/');
    expect((await rows())[0]).toMatchObject({ name: 'b.png' });
  });

  it('never makes a second row: sequential and simultaneous runs end with one row and one object', async () => {
    await env.BUCKET.put('d30/a.png', 'pixels');
    await Promise.all([importImages(env, bucketStore(), 'd30/'), importImages(env, bucketStore(), 'd30/')]);
    await importImages(env, bucketStore(), 'd30/');

    const all = await rows();
    expect(all).toHaveLength(1);
    const files = (await env.BUCKET.list({ prefix: 'files/' })).objects;
    expect(files.map((o) => o.key)).toEqual([fileKey(all[0].id as string)]);
    expect(await has('d30/a.png')).toBe(false);
  });

  it('after an interruption following the copy, the source stays and the next run finishes without a second row', async () => {
    await env.BUCKET.put('d30/a.png', 'pixels');
    expect(await importImages(env, flaky((op, key) => op === 'head' && key.startsWith('files/')), 'd30/')).toEqual({ imported: 0, more: true });
    expect((await rows()).map((r) => r.status)).toEqual(['pending']);
    expect(await has('d30/a.png')).toBe(true);

    const res = await importImages(env, bucketStore(), 'd30/');

    expect(res.imported).toBe(1);
    expect((await rows()).map((r) => r.status)).toEqual(['ready']);
    expect(await has('d30/a.png')).toBe(false);
  });

  it('after an interruption between ready and the delete, the next run only deletes the source', async () => {
    await env.BUCKET.put('d30/a.png', 'pixels');
    // The image is imported even though the source could not be removed yet: it counts, and nothing is reported as a failure.
    expect(await importImages(env, flaky((op, key) => op === 'delete' && key === 'd30/a.png'), 'd30/')).toEqual({ imported: 1, more: false });
    expect((await rows()).map((r) => r.status)).toEqual(['ready']);
    expect(await has('d30/a.png')).toBe(true);

    const res = await importImages(env, bucketStore(), 'd30/');

    expect(res.imported).toBe(0);
    expect(await rows()).toHaveLength(1);
    expect(await has('d30/a.png')).toBe(false);
  });

  it('keeps a source that was overwritten between the copy and the delete, and imports it as a new image next time', async () => {
    await env.BUCKET.put('d30/x.png', 'first version');
    const base = bucketStore();
    const overwriting: ObjectStore = {
      ...base,
      copy: async (from, to) => {
        await base.copy(from, to);
        await env.BUCKET.put(from, 'second version, longer');
      },
    };

    await importImages(env, overwriting, 'd30/');

    expect(await has('d30/x.png')).toBe(true);
    expect(await rows()).toHaveLength(1);

    await importImages(env, bucketStore(), 'd30/');

    const all = await rows();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.size).sort()).toEqual([13, 22]);
    expect(await has('d30/x.png')).toBe(false);
  });

  it('an overwrite of the same size between the listing and the copy never makes a second row for one image', async () => {
    await env.BUCKET.put('d30/x.bmp', 'AAAA');
    const base = bucketStore();
    const swapped: ObjectStore = {
      ...base,
      // The other app saves a different picture of the very same size under the same name, after we listed the first one.
      list: async (prefix, cursor) => {
        const page = await base.list(prefix, cursor);
        await env.BUCKET.put('d30/x.bmp', 'BBBB');
        return page;
      },
    };

    await importImages(env, swapped, 'd30/');

    expect(await rows()).toEqual([]);
    expect(await has('d30/x.bmp')).toBe(true);
    expect((await env.BUCKET.list({ prefix: 'files/' })).objects).toEqual([]);

    await importImages(env, bucketStore(), 'd30/');

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(await (await env.BUCKET.get(fileKey(all[0].id as string)))!.text()).toBe('BBBB');
    expect(await has('d30/x.bmp')).toBe(false);
  });

  it('imports keys with spaces, accents and symbols and shows the last segment as the name', async () => {
    await env.BUCKET.put('d30/Ảnh chụp & thử #1.png', 'x');
    await importImages(env, bucketStore(), 'd30/');
    expect((await rows())[0]).toMatchObject({ name: 'Ảnh chụp & thử #1.png' });
  });

  it('imports in batches of 10 and leaves what is not an image alone', async () => {
    for (let i = 0; i < 25; i++) await env.BUCKET.put(`d30/img-${String(i).padStart(2, '0')}.png`, `p${i}`);
    for (let i = 0; i < 5; i++) await env.BUCKET.put(`d30/note-${i}.txt`, 'text');

    expect(IMPORT_BATCH).toBe(10);
    expect(await importImages(env, bucketStore(), 'd30/')).toEqual({ imported: 10, more: true });
    expect(await importImages(env, bucketStore(), 'd30/')).toEqual({ imported: 10, more: true });
    expect(await importImages(env, bucketStore(), 'd30/')).toEqual({ imported: 5, more: false });

    expect(await rows()).toHaveLength(25);
    expect((await env.BUCKET.list({ prefix: 'd30/' })).objects.map((o) => o.key).sort()).toEqual(['d30/note-0.txt', 'd30/note-1.txt', 'd30/note-2.txt', 'd30/note-3.txt', 'd30/note-4.txt']);
  });

  it('when one image fails it stops there, reports the ones already done, and the next call goes on', async () => {
    await env.BUCKET.put('d30/a.png', 'one');
    await env.BUCKET.put('d30/b.png', 'two');
    let copies = 0;
    const failing: ObjectStore = {
      ...bucketStore(),
      copy: async (from, to, etag) => {
        if (++copies === 2) throw new Error('injected failure in copy');
        return bucketStore().copy(from, to, etag);
      },
    };

    expect(await importImages(env, failing, 'd30/')).toEqual({ imported: 1, more: true });
    expect((await rows()).map((r) => r.status).sort()).toEqual(['pending', 'ready']);

    expect(await importImages(env, bucketStore(), 'd30/')).toEqual({ imported: 1, more: false });
    expect((await rows()).map((r) => r.status)).toEqual(['ready', 'ready']);
  });

  it('skips a source that vanished before it could be copied', async () => {
    await env.BUCKET.put('d30/a.png', 'pixels');
    const base = bucketStore();
    const vanishing: ObjectStore = {
      ...base,
      copy: async (from) => {
        await env.BUCKET.delete(from);
        throw new ObjectMissingError(from);
      },
    };

    expect(await importImages(env, vanishing, 'd30/')).toEqual({ imported: 0, more: false });
    expect(await has('d30/a.png')).toBe(false);
  });
});

describe('the cron and an import working on the same pending row', () => {
  const pendingRow = (id: string, createdAt: number) =>
    env.DB.prepare(`INSERT INTO files (id, name, mime, size, kind, has_thumb, status, device, created_at) VALUES (?, 'a.png', 'image/png', 6, 'image', 0, 'pending', 'd30', ?)`).bind(id, createdAt).run();

  it('purgePending leaves a row that became ready meanwhile, and its object, alone', async () => {
    const { purgePending } = await import('../src/cleanup');
    await env.DB.prepare(`INSERT INTO files (id, name, mime, size, kind, has_thumb, status, created_at) VALUES ('READYONE', 'a.png', 'image/png', 6, 'image', 0, 'ready', 1)`).run();
    await env.BUCKET.put('files/READYONE', 'pixels');
    await pendingRow('PENDINGONE', 1);
    await env.BUCKET.put('files/PENDINGONE', 'half');

    // The cron selected both ids as abandoned uploads; one of them was completed before the cron got to it.
    await purgePending(env, ['READYONE', 'PENDINGONE']);

    expect((await rows()).map((r) => r.id)).toEqual(['READYONE']);
    expect(await has('files/READYONE')).toBe(true);
    expect(await has('files/PENDINGONE')).toBe(false);
  });

  it('an import whose row the cron removed meanwhile takes back its own copy and leaves the source alone', async () => {
    await env.BUCKET.put('d30/a.png', 'pixels');
    const base = bucketStore();
    const cronStrikes: ObjectStore = {
      ...base,
      head: async (key) => {
        const found = await base.head(key);
        // The copy exists, and now the cron deletes the pending row (and would delete files/<id>).
        if (key.startsWith('files/')) await env.DB.prepare(`DELETE FROM files WHERE status = 'pending'`).run();
        return found;
      },
    };

    const res = await importImages(env, cronStrikes, 'd30/');

    expect(res.imported).toBe(0);
    expect(await rows()).toEqual([]);
    expect(await has('d30/a.png')).toBe(true);
    expect((await env.BUCKET.list({ prefix: 'files/' })).objects).toEqual([]);

    expect(await importImages(env, bucketStore(), 'd30/')).toMatchObject({ imported: 1 });
    expect(await rows()).toHaveLength(1);
  });
});
