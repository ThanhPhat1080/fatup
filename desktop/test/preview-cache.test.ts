import { describe, expect, it } from 'vitest';
import { PreviewCache, fetchPicture, type CachedEntry, type Picture, type PreviewStore } from '../src/preview-cache';
import type { Item } from '../src/shared-ipc';

class MemoryStore implements PreviewStore {
  files = new Map<string, { bytes: Uint8Array; type: string; savedAt: number }>();
  failures: Record<string, number> = {};
  async urls(ids: string[]) {
    return new Map(ids.filter((id) => this.files.has(id)).map((id) => [id, `mem://${id}`] as const));
  }
  async put(id: string, bytes: Uint8Array, type: string, savedAt: number) {
    this.files.set(id, { bytes, type, savedAt });
  }
  async remove(ids: string[]) {
    for (const id of ids) this.files.delete(id);
  }
  async entries(): Promise<CachedEntry[]> {
    return [...this.files].map(([id, f]) => ({ id, bytes: f.bytes.length, savedAt: f.savedAt }));
  }
  async readFailures() {
    return { ...this.failures };
  }
  async writeFailures(f: Record<string, number>) {
    this.failures = { ...f };
  }
}

const link = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, name: id, mime: 'text/uri-list', size: 0, kind: 'link', thumbUrl: null, device: null, createdAt: 1, deletedAt: null, inVault: false, tags: [], url: `https://a.test/${id}`, site: 'internet', previewed: true, downloaded: false, ...over }) as Item;
const file = (id: string): Item => link(id, { kind: 'file', url: null, site: null, mime: 'text/plain', size: 5, previewed: false });
const answer = (item: Item, previewImage: string | null) => ({ ...item, previewImage });
const pic = (n = 4): Picture => ({ bytes: new Uint8Array(n), type: 'image/jpeg' });

function make(over: { fetchPicture?: (url: string) => Promise<Picture | null>; hotlink?: boolean; now?: () => number; maxEntries?: number; maxBytes?: number } = {}) {
  const store = new MemoryStore();
  const fetched: string[] = [];
  const cache = new PreviewCache(store, {
    fetchPicture: async (url) => {
      fetched.push(url);
      return over.fetchPicture ? over.fetchPicture(url) : pic();
    },
    hotlink: over.hotlink,
    now: over.now,
    maxEntries: over.maxEntries,
    maxBytes: over.maxBytes,
  });
  return { store, cache, fetched };
}

describe('decorate', () => {
  it('shows the local copy and marks a link with a picture as previewed', async () => {
    const { store, cache } = make();
    await store.put('a', pic().bytes, 'image/jpeg', 1);
    const [a] = await cache.decorate([link('a', { previewed: false })]);
    expect(a).toMatchObject({ thumbUrl: 'mem://a', previewed: true });
  });

  it('asks for a preview of a link that has no picture anywhere, whatever the server says', async () => {
    const { cache } = make();
    const [a] = await cache.decorate([link('a', { previewed: true })]);
    expect(a.previewed).toBe(false);
  });

  it('keeps an older server-side thumbnail and does not ask again for it', async () => {
    const { cache } = make();
    const [a] = await cache.decorate([link('a', { thumbUrl: 'https://r2.test/a.jpg', previewed: false })]);
    expect(a).toMatchObject({ thumbUrl: 'https://r2.test/a.jpg', previewed: true });
  });

  it('prefers the local copy over the server thumbnail and leaves files alone', async () => {
    const { store, cache } = make();
    await store.put('a', pic().bytes, 'image/jpeg', 1);
    const [a, f] = await cache.decorate([link('a', { thumbUrl: 'https://r2.test/a.jpg' }), file('f')]);
    expect(a.thumbUrl).toBe('mem://a');
    expect(f).toEqual(file('f'));
  });
});

describe('learn', () => {
  it('downloads the picture once and keeps it', async () => {
    const { store, cache, fetched } = make();
    const first = await cache.learn(answer(link('a', { previewed: false }), 'https://img.test/a.jpg'));
    expect(first).toMatchObject({ thumbUrl: 'mem://a', previewed: true });
    expect('previewImage' in first).toBe(false);
    expect(store.files.has('a')).toBe(true);
    await cache.learn(answer(link('a'), 'https://img.test/other.jpg'));
    expect(fetched).toEqual(['https://img.test/a.jpg']);
  });

  it('replaces the copy when forced', async () => {
    const { cache, fetched } = make();
    await cache.learn(answer(link('a'), 'https://img.test/1.jpg'));
    await cache.learn(answer(link('a'), 'https://img.test/2.jpg'), true);
    expect(fetched).toEqual(['https://img.test/1.jpg', 'https://img.test/2.jpg']);
  });

  it('remembers a failure for a day so a blocked site is not hit on every start', async () => {
    let now = 1_000;
    const { store, cache } = make({ fetchPicture: async () => null, now: () => now });
    const first = await cache.learn(answer(link('a', { previewed: false }), 'https://img.test/a.jpg'));
    expect(first).toMatchObject({ thumbUrl: null, previewed: true });
    expect(Object.keys(store.failures)).toEqual(['a']);

    const again = make({ now: () => now });
    again.store.failures = { ...store.failures };
    expect((await again.cache.decorate([link('a')]))[0].previewed).toBe(true);
    now += 25 * 3_600_000;
    expect((await again.cache.decorate([link('a')]))[0].previewed).toBe(false);
  });

  it('treats a page without a picture as a failure too, but not when an older thumbnail exists', async () => {
    const { store, cache } = make();
    await cache.learn(answer(link('a'), null));
    await cache.learn(answer(link('b', { thumbUrl: 'https://r2.test/b.jpg' }), null));
    expect(Object.keys(store.failures)).toEqual(['a']);
  });

  it('clears the failure once a picture arrives', async () => {
    const { store, cache } = make();
    await cache.learn(answer(link('a'), null));
    await cache.learn(answer(link('a'), 'https://img.test/a.jpg'), true);
    expect(store.failures).toEqual({});
  });

  it('in the browser falls back to the remote address for this session when the picture cannot be read', async () => {
    const { store, cache } = make({ fetchPicture: async () => null, hotlink: true });
    const item = await cache.learn(answer(link('a', { previewed: false }), 'https://img.test/a.jpg'));
    expect(item).toMatchObject({ thumbUrl: 'https://img.test/a.jpg', previewed: true });
    expect(store.failures).toEqual({});
    expect(store.files.size).toBe(0);
    const next = make({ hotlink: true });
    expect((await next.cache.decorate([link('a')]))[0]).toMatchObject({ thumbUrl: null, previewed: false });
  });
});

describe('privacy and storage failures', () => {
  it('does not keep pictures of Vault links on the device; they show from their own address for this session', async () => {
    const { store, cache, fetched } = make();
    const item = await cache.learn(answer(link('a', { inVault: true, previewed: false }), 'https://img.test/a.jpg'));
    expect(item).toMatchObject({ thumbUrl: 'https://img.test/a.jpg', previewed: true });
    expect(store.files.size).toBe(0);
    expect(fetched).toEqual([]);
  });

  it('copes with a store that cannot be written: remote address in the browser, a remembered failure otherwise', async () => {
    const broken = (hotlink: boolean) => {
      const m = make({ hotlink });
      m.store.put = async () => {
        throw new Error('quota');
      };
      return m;
    };
    const web = broken(true);
    expect(await web.cache.learn(answer(link('a'), 'https://img.test/a.jpg'))).toMatchObject({ thumbUrl: 'https://img.test/a.jpg' });
    const app = broken(false);
    expect(await app.cache.learn(answer(link('a'), 'https://img.test/a.jpg'))).toMatchObject({ thumbUrl: null, previewed: true });
    expect(Object.keys(app.store.failures)).toEqual(['a']);
  });
});

describe('housekeeping', () => {
  it('drops the oldest pictures beyond the limits', async () => {
    let now = 0;
    const { store, cache } = make({ maxEntries: 2, now: () => ++now });
    for (const id of ['a', 'b', 'c']) await cache.learn(answer(link(id), `https://img.test/${id}.jpg`));
    expect([...store.files.keys()].sort()).toEqual(['b', 'c']);

    const bytes = make({ maxBytes: 10, fetchPicture: async () => pic(6), now: () => ++now });
    for (const id of ['a', 'b']) await bytes.cache.learn(answer(link(id), `https://img.test/${id}.jpg`));
    expect([...bytes.store.files.keys()]).toEqual(['b']);
  });

  it('forgets a link: picture, failure and session fallback', async () => {
    const { store, cache } = make();
    await cache.learn(answer(link('a'), 'https://img.test/a.jpg'));
    await cache.learn(answer(link('b'), null));
    await cache.forget(['a', 'b']);
    expect(store.files.size).toBe(0);
    expect(store.failures).toEqual({});
  });
});

describe('clear', () => {
  it('wipes every picture and failure (used when the app is disconnected)', async () => {
    const { store, cache } = make();
    await cache.learn(answer(link('a'), 'https://img.test/a.jpg'));
    await cache.learn(answer(link('b'), null));
    await cache.clear();
    expect(store.files.size).toBe(0);
    expect(store.failures).toEqual({});
  });
});

describe('fetchPicture', () => {
  const reply = (body: ConstructorParameters<typeof Response>[0], type = 'image/jpeg', url = '', status = 200) => {
    const res = new Response(body, { status, headers: { 'content-type': type } });
    if (url) Object.defineProperty(res, 'url', { value: url });
    return res;
  };
  const via = (res: Response | Error) => (async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;

  it('returns the bytes and type of an image', async () => {
    const got = await fetchPicture('https://img.test/a.jpg', via(reply('abcd')));
    expect(got?.type).toBe('image/jpeg');
    expect(got?.bytes.length).toBe(4);
  });

  it.each([
    ['a private address', 'http://127.0.0.1/a.jpg', reply('x')],
    ['not an image', 'https://img.test/a', reply('x', 'text/html')],
    ['an SVG', 'https://img.test/a.svg', reply('<svg/>', 'image/svg+xml')],
    ['an error page', 'https://img.test/a.jpg', reply('x', 'image/jpeg', '', 404)],
    ['an empty body', 'https://img.test/a.jpg', reply('')],
    ['a redirect to a private address', 'https://img.test/a.jpg', reply('x', 'image/jpeg', 'http://192.168.0.1/a.jpg')],
    ['too large', 'https://img.test/a.jpg', reply('x'.repeat(2_100_000))],
  ])('refuses %s', async (_name, url, res) => {
    expect(await fetchPicture(url, via(res))).toBeNull();
  });

  it('can be told which addresses are allowed (the end-to-end test serves pictures from localhost)', async () => {
    const local = (u: string) => u.startsWith('http://127.0.0.1');
    expect((await fetchPicture('http://127.0.0.1/a.jpg', via(reply('abcd')), local))?.bytes.length).toBe(4);
    expect(await fetchPicture('https://img.test/a.jpg', via(reply('abcd')), local)).toBeNull();
  });

  it('returns null when the request fails', async () => {
    expect(await fetchPicture('https://img.test/a.jpg', via(new TypeError('Failed to fetch')))).toBeNull();
  });
});
