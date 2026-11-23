import { describe, expect, it, vi } from 'vitest';
import { IMPORT_SYNC_MIN_GAP_MS } from '@fatup/shared';
import { ApiClient } from '../src/main/api';
import { shouldSyncImport } from '../src/renderer/src/lib/import-sync';

describe('shouldSyncImport', () => {
  it('is true the first time (never synced)', () => {
    expect(shouldSyncImport(1_000, 0)).toBe(true);
  });

  it('waits for the minimum gap since the last sync', () => {
    expect(IMPORT_SYNC_MIN_GAP_MS).toBe(30_000);
    expect(shouldSyncImport(30_000, 1_000)).toBe(false);
    expect(shouldSyncImport(31_000, 1_000)).toBe(true);
    expect(shouldSyncImport(1_500, 1_000, 500)).toBe(true);
  });
});

describe('ApiClient import and thumbnail calls', () => {
  it('posts to /import/sync and returns the answer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ imported: 3, more: true }), { status: 200 }));
    const client = new ApiClient('https://api.test', 'tok', fetchMock as unknown as typeof fetch);

    expect(await client.importSync()).toEqual({ imported: 3, more: true });

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/import/sync', expect.objectContaining({ method: 'POST' }));
  });

  it('asks for a thumbnail upload URL and completes it', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url.replace('https://api.test', '')}`);
      return new Response(JSON.stringify(url.endsWith('/complete') ? { id: 'a/b', hasThumb: true } : { thumbUploadUrl: 'https://r2/put' }), { status: 200 });
    });
    const client = new ApiClient('https://api.test', 'tok', fetchMock as unknown as typeof fetch);

    expect(await client.thumbUpload('a/b')).toEqual({ thumbUploadUrl: 'https://r2/put' });
    expect(await client.thumbComplete('a/b')).toMatchObject({ hasThumb: true });

    expect(calls).toEqual(['POST /files/a%2Fb/thumb', 'POST /files/a%2Fb/thumb/complete']);
  });
  it('force skips the minimum gap', () => {
    expect(shouldSyncImport(2_000, 1_000, undefined, true)).toBe(true);
  });
});
