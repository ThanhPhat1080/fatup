import { beforeEach, describe, expect, it } from 'vitest';
import { CacheStoragePreviewStore } from './preview-store';

/** Just enough of the Cache API: entries keyed by URL, a fresh Response on every match. */
function fakeCaches() {
  const entries = new Map<string, { body: ArrayBuffer; headers: [string, string][] }>();
  const key = (r: Request | string) => (typeof r === 'string' ? r : r.url);
  const cache = {
    async match(r: Request | string) {
      const e = entries.get(key(r));
      return e ? new Response(e.body.slice(0), { headers: e.headers }) : undefined;
    },
    async put(r: Request | string, res: Response) {
      entries.set(key(r), { body: await res.arrayBuffer(), headers: [...res.headers] });
    },
    async delete(r: Request | string) {
      return entries.delete(key(r));
    },
    async keys() {
      return [...entries.keys()].map((u) => new Request(u));
    },
  };
  return { open: async () => cache, entries };
}

let fake: ReturnType<typeof fakeCaches>;
beforeEach(() => {
  fake = fakeCaches();
  Object.assign(globalThis, { caches: fake, location: { origin: 'https://fatup.test' } });
});

const bytes = (...n: number[]) => new Uint8Array(n);

describe('CacheStoragePreviewStore', () => {
  it('stores a picture and shows it through an object URL that stays the same until it is replaced', async () => {
    const store = new CacheStoragePreviewStore();
    expect((await store.urls(['a'])).size).toBe(0);
    await store.put('a', bytes(1, 2, 3), 'image/png', 1_000);
    const first = (await store.urls(['a'])).get('a');
    expect(first).toMatch(/^blob:/);
    expect((await store.urls(['a'])).get('a')).toBe(first);
    await store.put('a', bytes(9), 'image/png', 2_000);
    expect((await store.urls(['a'])).get('a')).not.toBe(first);
  });

  it('lists entries with size and time, without the failures record, and decodes ids', async () => {
    const store = new CacheStoragePreviewStore();
    await store.put('a b', bytes(1, 2), 'image/jpeg', 7);
    await store.writeFailures({ x: 1 });
    expect(await store.entries()).toEqual([{ id: 'a b', bytes: 2, savedAt: 7 }]);
  });

  it('removes pictures', async () => {
    const store = new CacheStoragePreviewStore();
    await store.put('a', bytes(1), 'image/jpeg', 1);
    await store.put('b', bytes(1), 'image/jpeg', 1);
    await store.remove(['a']);
    expect([...(await store.urls(['a', 'b'])).keys()]).toEqual(['b']);
  });

  it('round-trips failures and survives a broken record', async () => {
    const store = new CacheStoragePreviewStore();
    expect(await store.readFailures()).toEqual({});
    await store.writeFailures({ a: 5 });
    expect(await store.readFailures()).toEqual({ a: 5 });
    fake.entries.set('https://fatup.test/_preview/_failures', { body: new TextEncoder().encode('{nope').buffer as ArrayBuffer, headers: [] });
    expect(await store.readFailures()).toEqual({});
  });
});
