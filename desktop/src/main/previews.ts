import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CachedEntry, PreviewStore } from '../preview-cache';

/** The scheme the renderer loads cached pictures through: fatup-preview://p/<id>?v=<saved at>. Registered in index.ts. */
export const PREVIEW_SCHEME = 'fatup-preview';

const TYPE_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
const EXT_BY_TYPE = Object.fromEntries(Object.entries(TYPE_BY_EXT).map(([ext, type]) => [type, ext]));
const FAILURES_FILE = '_failures.json';
const SAFE_ID = /^[\w-]{1,64}$/;

/** Cached preview pictures as plain files in one folder: `<link id>.<jpg|png|webp|gif|avif>`, plus a small JSON of failures. */
export class FilePreviewStore implements PreviewStore {
  constructor(private readonly dir: string) {}

  private async files(): Promise<{ id: string; ext: string; name: string }[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const out: { id: string; ext: string; name: string }[] = [];
    for (const name of names) {
      const dot = name.lastIndexOf('.');
      const id = name.slice(0, dot);
      const ext = name.slice(dot + 1);
      if (dot > 0 && TYPE_BY_EXT[ext] && SAFE_ID.test(id)) out.push({ id, ext, name });
    }
    return out;
  }

  async urls(ids: string[]): Promise<Map<string, string>> {
    const wanted = new Set(ids);
    const out = new Map<string, string>();
    for (const f of await this.files()) {
      if (!wanted.has(f.id)) continue;
      const saved = await stat(join(this.dir, f.name)).catch(() => null);
      if (saved) out.set(f.id, `${PREVIEW_SCHEME}://p/${f.id}?v=${Math.round(saved.mtimeMs)}`);
    }
    return out;
  }

  async put(id: string, bytes: Uint8Array, type: string, savedAt: number): Promise<void> {
    const ext = EXT_BY_TYPE[type];
    if (!SAFE_ID.test(id) || !ext) throw new Error('unsupported preview');
    await mkdir(this.dir, { recursive: true });
    await this.remove([id]); // a picture of another type for the same link must not linger
    const path = join(this.dir, `${id}.${ext}`);
    await writeFile(path, bytes);
    await utimes(path, savedAt / 1000, savedAt / 1000); // the file's time is when it was saved, which is what pruning goes by
  }

  async remove(ids: string[]): Promise<void> {
    const gone = new Set(ids);
    for (const f of await this.files()) if (gone.has(f.id)) await rm(join(this.dir, f.name), { force: true });
  }

  async entries(): Promise<CachedEntry[]> {
    const out: CachedEntry[] = [];
    for (const f of await this.files()) {
      const s = await stat(join(this.dir, f.name)).catch(() => null);
      if (s) out.push({ id: f.id, bytes: s.size, savedAt: s.mtimeMs });
    }
    return out;
  }

  async readFailures(): Promise<Record<string, number>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.dir, FAILURES_FILE), 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, at]) => typeof at === 'number'));
    } catch {
      return {};
    }
  }

  async writeFailures(failures: Record<string, number>): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, FAILURES_FILE), JSON.stringify(failures));
  }

  /** The bytes and type behind a fatup-preview:// address, or null when the id is unsafe or nothing is cached. */
  async read(id: string): Promise<{ bytes: Buffer; type: string } | null> {
    if (!SAFE_ID.test(id)) return null;
    const f = (await this.files()).find((x) => x.id === id);
    if (!f) return null;
    try {
      return { bytes: await readFile(join(this.dir, f.name)), type: TYPE_BY_EXT[f.ext] };
    } catch {
      return null;
    }
  }
}
