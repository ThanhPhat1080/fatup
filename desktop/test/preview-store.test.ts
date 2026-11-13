import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilePreviewStore } from '../src/main/previews';

let dir: string;
let store: FilePreviewStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fatup-previews-'));
  store = new FilePreviewStore(join(dir, 'previews')); // the folder does not exist yet
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const bytes = (...n: number[]) => new Uint8Array(n);

describe('FilePreviewStore', () => {
  it('starts empty without needing the folder to exist', async () => {
    expect(await store.urls(['a'])).toEqual(new Map());
    expect(await store.entries()).toEqual([]);
    expect(await store.readFailures()).toEqual({});
  });

  it('stores a picture and serves its bytes and type', async () => {
    await store.put('abc', bytes(1, 2, 3), 'image/png', 5_000);
    const urls = await store.urls(['abc', 'other']);
    expect([...urls.keys()]).toEqual(['abc']);
    expect(urls.get('abc')).toBe('fatup-preview://p/abc?v=5000');
    const got = await store.read('abc');
    expect(got?.type).toBe('image/png');
    expect([...(got?.bytes ?? [])]).toEqual([1, 2, 3]);
    expect(await store.entries()).toEqual([{ id: 'abc', bytes: 3, savedAt: 5_000 }]);
  });

  it('keeps one picture per link, even when the type changes', async () => {
    await store.put('abc', bytes(1), 'image/png', 1_000);
    await store.put('abc', bytes(2, 2), 'image/jpeg', 2_000);
    expect(readdirSync(join(dir, 'previews'))).toEqual(['abc.jpg']);
    expect((await store.read('abc'))?.type).toBe('image/jpeg');
  });

  it('removes pictures', async () => {
    await store.put('a', bytes(1), 'image/jpeg', 1_000);
    await store.put('b', bytes(1), 'image/jpeg', 1_000);
    await store.remove(['a', 'missing']);
    expect((await store.entries()).map((e) => e.id)).toEqual(['b']);
  });

  it('refuses unsafe ids and unknown types', async () => {
    await expect(store.put('../evil', bytes(1), 'image/jpeg', 1)).rejects.toThrow();
    await expect(store.put('a', bytes(1), 'text/html', 1)).rejects.toThrow();
    expect(await store.read('../config')).toBeNull();
    expect(await store.read('nope')).toBeNull();
  });

  it('ignores files in the folder that are not pictures', async () => {
    await store.put('a', bytes(1), 'image/jpeg', 1_000);
    writeFileSync(join(dir, 'previews', 'notes.txt'), 'x');
    expect((await store.entries()).map((e) => e.id)).toEqual(['a']);
  });

  it('round-trips failures and survives a corrupt file', async () => {
    await store.writeFailures({ a: 5 });
    expect(await store.readFailures()).toEqual({ a: 5 });
    writeFileSync(join(dir, 'previews', '_failures.json'), '{nope');
    expect(await store.readFailures()).toEqual({});
  });
});
