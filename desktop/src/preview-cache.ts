// A link's preview picture is kept on the device that shows it: the server only reads the page and names the picture's address.
// This module is the part shared by the desktop app and the PWA; each supplies a `PreviewStore` (files on disk, or the browser's
// Cache Storage) and the rest, including what to do when a picture cannot be had, lives here.
import { isPublicUrl, type PreviewResponse } from '@fatup/shared';
import type { Item } from './shared-ipc';

const MAX_PICTURE_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ENTRIES = 300;
const DEFAULT_MAX_BYTES = 50_000_000;
/** After a picture could not be had, the link is left alone for this long (a blocked site is not worth asking again on every start). */
const RETRY_AFTER_MS = 24 * 3_600_000;
/** SVG is left out on purpose: a picture that can carry markup is not worth the risk. */
const PICTURE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export type Picture = { bytes: Uint8Array; type: string };
export type CachedEntry = { id: string; bytes: number; savedAt: number };

/** Where the pictures live. Ids are link ids. */
export interface PreviewStore {
  /** Address an <img> can load for each cached picture; ids without one are left out. */
  urls(ids: string[]): Promise<Map<string, string>>;
  put(id: string, bytes: Uint8Array, type: string, savedAt: number): Promise<void>;
  remove(ids: string[]): Promise<void>;
  entries(): Promise<CachedEntry[]>;
  /** Epoch milliseconds of the last failed attempt per link id. */
  readFailures(): Promise<Record<string, number>>;
  writeFailures(failures: Record<string, number>): Promise<void>;
}

/** Downloads a picture, or returns null for anything unsafe or unusable: an address `allowed` refuses (public hosts only, by default; also checked after redirects), a non-image or SVG, an error status, an empty or oversized body. */
export async function fetchPicture(url: string, fetchImpl: typeof fetch = (i, init) => fetch(i, init), allowed: (url: string) => boolean = isPublicUrl): Promise<Picture | null> {
  if (!allowed(url)) return null;
  try {
    const res = await fetchImpl(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok || (res.url && !allowed(res.url))) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!PICTURE_TYPES.has(type) || Number(res.headers.get('content-length') ?? 0) > MAX_PICTURE_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) return null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_PICTURE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    if (total === 0) return null;
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return { bytes, type };
  } catch {
    return null;
  }
}

type Options = {
  fetchPicture: (url: string) => Promise<Picture | null>;
  /** Browsers: when the picture cannot be read (no CORS), still show the remote address for this session. Not kept. */
  hotlink?: boolean;
  now?: () => number;
  maxEntries?: number;
  maxBytes?: number;
};

export class PreviewCache {
  private readonly hot = new Map<string, string>();
  private failures: Record<string, number> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: PreviewStore,
    private readonly opts: Options,
  ) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  private async loadFailures() {
    if (!this.failures) {
      const stored = await this.store.readFailures();
      const cutoff = this.now() - RETRY_AFTER_MS;
      this.failures = Object.fromEntries(Object.entries(stored).filter(([, at]) => at > cutoff));
    }
    return this.failures;
  }

  private persistFailures() {
    const snapshot = { ...this.failures };
    this.saving = this.saving.then(() => this.store.writeFailures(snapshot)).catch(() => undefined);
    return this.saving;
  }

  /**
   * Points each link at its local picture (or an older server thumbnail) and says whether the app should still ask for a preview:
   * `previewed` is true when there is a picture or a recent failure, false otherwise, whatever the server believes.
   */
  async decorate<T extends Item>(items: T[]): Promise<T[]> {
    const ids = items.filter((it) => it.kind === 'link').map((it) => it.id);
    if (ids.length === 0) return items;
    const cached = await this.store.urls(ids);
    const failures = await this.loadFailures();
    return items.map((it) => {
      if (it.kind !== 'link') return it;
      const local = cached.get(it.id) ?? this.hot.get(it.id);
      if (local) return { ...it, thumbUrl: local, previewed: true };
      const failedAt = failures[it.id];
      return { ...it, previewed: it.thumbUrl !== null || (failedAt !== undefined && failedAt > this.now() - RETRY_AFTER_MS) };
    });
  }

  /** Takes the server's answer, fetches the picture if this device has none (or `force`), and returns the link ready to show. */
  async learn(res: PreviewResponse & { downloaded?: boolean }, force = false): Promise<Item> {
    const { previewImage, ...rest } = res;
    const item = { downloaded: false, ...rest } as Item;
    const have = (await this.store.urls([item.id])).has(item.id);
    const failures = await this.loadFailures();
    if (previewImage && (force || !have)) {
      // The Vault is meant to leave no trace in the open, so its links' pictures are never written to the device.
      const picture = item.inVault ? null : await this.opts.fetchPicture(previewImage);
      let stored = false;
      if (picture) {
        try {
          await this.store.put(item.id, picture.bytes, picture.type, this.now());
          stored = true;
        } catch {
          // Disk full, storage blocked...: carry on as if the picture could not be had.
        }
      }
      if (stored) {
        this.hot.delete(item.id);
        if (failures[item.id] !== undefined) {
          delete failures[item.id];
          await this.persistFailures();
        }
        await this.prune();
      } else if (this.opts.hotlink || item.inVault) {
        this.hot.set(item.id, previewImage);
      } else {
        failures[item.id] = this.now();
        await this.persistFailures();
      }
    } else if (!previewImage && !have && item.thumbUrl === null) {
      failures[item.id] = this.now();
      await this.persistFailures();
    }
    return (await this.decorate([item]))[0];
  }

  /** Drops everything kept for these links. */
  async forget(ids: string[]) {
    await this.store.remove(ids);
    const failures = await this.loadFailures();
    let changed = false;
    for (const id of ids) {
      this.hot.delete(id);
      if (failures[id] !== undefined) {
        delete failures[id];
        changed = true;
      }
    }
    if (changed) await this.persistFailures();
  }

  /** Drops every picture and failure. */
  async clear() {
    await this.forget((await this.store.entries()).map((e) => e.id));
    this.failures = {};
    this.hot.clear();
    await this.persistFailures();
  }

  /** Keeps the newest pictures within the count and size limits. */
  private async prune() {
    const maxEntries = this.opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const maxBytes = this.opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const entries = (await this.store.entries()).sort((a, b) => b.savedAt - a.savedAt);
    let bytes = 0;
    const drop: string[] = [];
    entries.forEach((e, i) => {
      bytes += e.bytes;
      if (i >= maxEntries || bytes > maxBytes) drop.push(e.id);
    });
    if (drop.length > 0) await this.store.remove(drop);
  }
}
