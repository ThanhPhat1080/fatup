import type { CachedEntry, PreviewStore } from '../../desktop/src/preview-cache';

const CACHE_NAME = 'fatup-previews-v1';
const PREFIX = '/_preview/';
const FAILURES = `${PREFIX}_failures`;

const requestFor = (id: string) => new Request(new URL(`${PREFIX}${encodeURIComponent(id)}`, location.origin));

/**
 * Link pictures in the browser's Cache Storage, under made-up same-origin keys (/_preview/<id>). The service worker never answers
 * these keys, so they exist only for this code: pictures are read back as blobs and shown through object URLs.
 */
export class CacheStoragePreviewStore implements PreviewStore {
  private readonly shown = new Map<string, { url: string; savedAt: number }>();

  private open() {
    return caches.open(CACHE_NAME);
  }

  private forgetUrl(id: string) {
    const known = this.shown.get(id);
    if (known) URL.revokeObjectURL(known.url);
    this.shown.delete(id);
  }

  async urls(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const cache = await this.open();
    for (const id of ids) {
      const res = await cache.match(requestFor(id));
      if (!res) {
        this.forgetUrl(id);
        continue;
      }
      const savedAt = Number(res.headers.get('x-saved-at'));
      const known = this.shown.get(id);
      if (known && known.savedAt === savedAt) {
        out.set(id, known.url);
        continue;
      }
      this.forgetUrl(id);
      const url = URL.createObjectURL(await res.blob());
      this.shown.set(id, { url, savedAt });
      out.set(id, url);
    }
    return out;
  }

  async put(id: string, bytes: Uint8Array, type: string, savedAt: number): Promise<void> {
    const cache = await this.open();
    await cache.put(requestFor(id), new Response(bytes as BlobPart, { headers: { 'content-type': type, 'x-saved-at': String(savedAt), 'x-bytes': String(bytes.length) } }));
    this.forgetUrl(id);
  }

  async remove(ids: string[]): Promise<void> {
    const cache = await this.open();
    for (const id of ids) {
      await cache.delete(requestFor(id));
      this.forgetUrl(id);
    }
  }

  async entries(): Promise<CachedEntry[]> {
    const cache = await this.open();
    const out: CachedEntry[] = [];
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (!path.startsWith(PREFIX) || path === FAILURES) continue;
      const res = await cache.match(req);
      if (res) out.push({ id: decodeURIComponent(path.slice(PREFIX.length)), bytes: Number(res.headers.get('x-bytes')) || 0, savedAt: Number(res.headers.get('x-saved-at')) || 0 });
    }
    return out;
  }

  async readFailures(): Promise<Record<string, number>> {
    try {
      const res = await (await this.open()).match(new URL(FAILURES, location.origin).href);
      const parsed: unknown = res ? await res.json() : {};
      if (typeof parsed !== 'object' || parsed === null) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, at]) => typeof at === 'number'));
    } catch {
      return {};
    }
  }

  async writeFailures(failures: Record<string, number>): Promise<void> {
    const cache = await this.open();
    await cache.put(new URL(FAILURES, location.origin).href, new Response(JSON.stringify(failures), { headers: { 'content-type': 'application/json' } }));
  }
}
