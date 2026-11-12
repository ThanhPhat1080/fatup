import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, normalizeServerUrl } from '../src/main/api';
import { ConfigStore, type Crypter } from '../src/main/config';
import { safeFileName, uniqueFileName } from '../src/main/filename';
import { LOCKOUT_MS, checkPin, hashPin, isValidPin } from '../src/main/pin';

describe('pin', () => {
  const record = hashPin('1234');

  it('validates format', () => {
    expect(isValidPin('0000')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });

  it('accepts the right PIN and resets counters', () => {
    const res = checkPin('1234', record, { failedAttempts: 3, lockedUntil: 0 });
    expect(res).toMatchObject({ ok: true, state: { failedAttempts: 0, lockedUntil: 0 } });
  });

  it('locks for 30 s after 5 wrong attempts, then allows retry', () => {
    let state = { failedAttempts: 0, lockedUntil: 0 };
    const now = 1_000_000;
    for (let i = 4; i >= 1; i--) {
      const res = checkPin('0000', record, state, now);
      expect(res).toMatchObject({ ok: false, reason: 'wrong', attemptsLeft: i });
      state = res.state;
    }
    const locked = checkPin('0000', record, state, now);
    expect(locked).toMatchObject({ ok: false, reason: 'locked', lockedUntil: now + LOCKOUT_MS });

    // Even the correct PIN is refused while locked.
    expect(checkPin('1234', record, locked.state, now + 1000)).toMatchObject({ ok: false, reason: 'locked' });
    expect(checkPin('1234', record, locked.state, now + LOCKOUT_MS + 1)).toMatchObject({ ok: true });
  });
});

describe('filenames', () => {
  it('strips characters that are illegal on Windows', () => {
    expect(safeFileName('a<b>:c"d/e\\f|g?h*.txt')).toBe('a_b__c_d_e_f_g_h_.txt');
    expect(safeFileName('report. ')).toBe('report');
    expect(safeFileName('CON.txt')).toBe('_CON.txt');
    expect(safeFileName('')).toBe('file');
  });

  it('adds (n) before the extension until the name is free', () => {
    const taken = new Set(['photo.jpg', 'photo (1).jpg']);
    expect(uniqueFileName('photo.jpg', (n) => taken.has(n))).toBe('photo (2).jpg');
    expect(uniqueFileName('README', (n) => n === 'README')).toBe('README (1)');
    expect(uniqueFileName('.env', (n) => n === '.env')).toBe('.env (1)');
    expect(uniqueFileName('new.pdf', () => false)).toBe('new.pdf');
  });
});

describe('ConfigStore', () => {
  const crypter: Crypter = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => b.toString().replace(/^enc:/, ''),
  };

  it('persists an encrypted token, prefs and download marks', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fatup-')), 'config.json');
    const store = new ConfigStore(file, crypter);
    store.setConnection('https://x.workers.dev', 'secret-token');
    store.setPrefs({ lang: 'vi', viewModes: { all: 'grid', image: 'grid', file: 'list' } });
    store.markDownloaded('A');
    store.markDownloaded('B');
    store.markDownloaded('A');

    expect(readFileSync(file, 'utf8')).not.toContain('secret-token');
    const reloaded = new ConfigStore(file, crypter);
    expect(reloaded.token).toBe('secret-token');
    expect(reloaded.snapshot.prefs.lang).toBe('vi');
    expect(reloaded.snapshot.downloaded).toEqual(['B', 'A']);
  });

  it('falls back to plain storage when OS encryption is unavailable', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fatup-')), 'config.json');
    const store = new ConfigStore(file, { ...crypter, isEncryptionAvailable: () => false });
    store.setConnection('https://x', 'tok');
    expect(new ConfigStore(file, crypter).token).toBe('tok');
  });

  it('reset keeps display prefs but drops credentials', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fatup-')), 'config.json');
    const store = new ConfigStore(file, crypter);
    store.setConnection('https://x', 'tok');
    store.setPin(hashPin('1111'));
    store.setPrefs({ lang: 'en' });
    store.reset();
    expect(store.token).toBeNull();
    expect(store.snapshot.pin).toBeNull();
    expect(store.snapshot.prefs.lang).toBe('en');
  });

  it('survives a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fatup-'));
    const file = join(dir, 'config.json');
    writeFileSync(file, '{not json');
    expect(new ConfigStore(file, crypter).snapshot.serverUrl).toBeNull();
  });
});

describe('ApiClient', () => {
  it('normalizes server URLs', () => {
    expect(normalizeServerUrl('fatup.me.workers.dev/')).toBe('https://fatup.me.workers.dev');
    expect(normalizeServerUrl(' http://127.0.0.1:8787 ')).toBe('http://127.0.0.1:8787');
    expect(() => normalizeServerUrl('http://')).toThrow();
  });

  it('follows cursors and sends the bearer token', async () => {
    const pages: Record<string, unknown> = {
      '': { items: [{ id: '1' }], nextCursor: 'c1' },
      c1: { items: [{ id: '2' }], nextCursor: null },
    };
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      const cursor = new URL(url).searchParams.get('cursor') ?? '';
      return new Response(JSON.stringify(pages[cursor]), { status: 200 });
    });
    const client = new ApiClient('https://api.test', 'tok', fetchMock as unknown as typeof fetch);
    const items = await client.listAll();
    expect(items.map((i) => i.id)).toEqual(['1', '2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('calls the trash endpoints', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname}${new URL(url).search}`);
      if (url.endsWith('/trash')) return new Response(JSON.stringify({ deleted: 3 }), { status: 200 });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.includes('trash=1')) return new Response(JSON.stringify({ items: [{ id: 't' }], nextCursor: null }), { status: 200 });
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
    });
    const client = new ApiClient('https://api.test', 'tok', fetchMock as unknown as typeof fetch);
    await client.setVault('v', true);
    await client.remove('a');
    await client.restore('b');
    await client.removeForever('c');
    expect(await client.emptyTrash()).toBe(3);
    expect((await client.listAll({ trash: true })).map((i) => i.id)).toEqual(['t']);
    expect(calls).toEqual([
      'PUT /files/v/vault',
      'DELETE /files/a',
      'POST /files/b/restore',
      'DELETE /files/c/permanent',
      'DELETE /trash',
      'GET /files?limit=200&trash=1',
    ]);
  });

  it('maps HTTP and network errors to ApiError codes', async () => {
    const unauthorized = new ApiClient('https://api.test', 'bad', (async () =>
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'no' } }), { status: 401 })) as unknown as typeof fetch);
    await expect(unauthorized.verify()).rejects.toMatchObject({ code: 'unauthorized', status: 401 });

    const offline = new ApiClient('https://api.test', 'tok', (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(offline.verify()).rejects.toBeInstanceOf(ApiError);
    await expect(offline.verify()).rejects.toMatchObject({ code: 'network' });
  });
});

import { isNewer } from '../src/main/updater';

describe('isNewer', () => {
  it('compares x.y.z numerically', () => {
    expect(isNewer('0.1.1', '0.1.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });
  it('accepts a v prefix and ignores pre-release suffixes', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.0', '0.0.0-dev')).toBe(true);
  });
});
