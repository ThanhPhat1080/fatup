import { describe, expect, it } from 'vitest';
import type { Item } from '../src/shared-ipc';
import { createThumbBackfill, type ThumbBackfillDeps } from '../src/main/thumb-backfill';

const item = (over: Partial<Item> = {}): Item => ({
  id: 'a',
  name: 'a.png',
  mime: 'image/png',
  size: 10,
  kind: 'image',
  thumbUrl: 'https://r2/original',
  hasThumb: false,
  device: 'd30',
  createdAt: 1,
  deletedAt: null,
  inVault: false,
  tags: [],
  url: null,
  site: null,
  previewed: false,
  downloaded: false,
  ...over,
});

function setup(over: Partial<ThumbBackfillDeps> = {}) {
  const calls: string[] = [];
  const deps: ThumbBackfillDeps = {
    client: () => ({
      downloadUrl: async (id) => (calls.push(`downloadUrl ${id}`), `https://r2/get/${id}`),
      thumbUpload: async (id) => (calls.push(`thumbUpload ${id}`), { thumbUploadUrl: `https://r2/put/${id}` }),
      thumbComplete: async (id) => (calls.push(`thumbComplete ${id}`), item({ id, hasThumb: true })),
    }),
    fetchBytes: async (url) => (calls.push(`fetchBytes ${url}`), new Uint8Array([1, 2, 3])),
    thumbnail: (bytes) => (calls.push(`thumbnail ${bytes.length}`), Buffer.from('jpeg')),
    putThumb: async (url, bytes) => void calls.push(`putThumb ${url} ${bytes.toString()}`),
    ...over,
  };
  return { backfill: createThumbBackfill(deps), calls };
}

describe('createThumbBackfill', () => {
  it('makes the thumbnail of an image that has none, in order', async () => {
    const { backfill, calls } = setup();

    backfill.run([item()]);
    await backfill.idle();

    expect(calls).toEqual([
      'downloadUrl a',
      'fetchBytes https://r2/get/a',
      'thumbnail 3',
      'thumbUpload a',
      'putThumb https://r2/put/a jpeg',
      'thumbComplete a',
    ]);
  });

  it('skips what does not need one: has a thumbnail, not an image, in the trash, in the Vault, or from an older server (hasThumb unknown)', async () => {
    const { backfill, calls } = setup();

    backfill.run([
      item({ id: '1', hasThumb: true }),
      item({ id: '2', kind: 'file', mime: 'application/pdf' }),
      item({ id: '3', deletedAt: 5 }),
      item({ id: '4', inVault: true }),
      item({ id: '5', hasThumb: undefined }),
    ]);
    await backfill.idle();

    expect(calls).toEqual([]);
  });

  it('does nothing for an image it cannot decode (such as HEIC), and does not try again this session', async () => {
    const { backfill, calls } = setup({ thumbnail: () => null });

    backfill.run([item()]);
    await backfill.idle();
    backfill.run([item()]);
    await backfill.idle();

    expect(calls.filter((c) => c.startsWith('downloadUrl'))).toHaveLength(1);
    expect(calls.some((c) => c.startsWith('thumbUpload'))).toBe(false);
  });

  it('does not repeat an image it already handled', async () => {
    const { backfill, calls } = setup();

    backfill.run([item()]);
    await backfill.idle();
    backfill.run([item()]);
    await backfill.idle();

    expect(calls.filter((c) => c === 'thumbComplete a')).toHaveLength(1);
  });

  it('goes on with the next image when one fails', async () => {
    const { backfill, calls } = setup({
      fetchBytes: async (url) => {
        if (url.endsWith('/bad')) throw new Error('network');
        return new Uint8Array([1]);
      },
    });

    backfill.run([item({ id: 'bad' }), item({ id: 'good' })]);
    await backfill.idle();

    expect(calls).toContain('thumbComplete good');
    expect(calls).not.toContain('thumbComplete bad');
  });

  it('works one image at a time and never handles one twice when run overlaps itself', async () => {
    let active = 0;
    let peak = 0;
    const { backfill, calls } = setup({
      fetchBytes: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return new Uint8Array([1]);
      },
    });

    backfill.run([item({ id: 'x' }), item({ id: 'y' })]);
    backfill.run([item({ id: 'x' }), item({ id: 'y' }), item({ id: 'z' })]);
    await backfill.idle();

    expect(peak).toBe(1);
    expect(calls.filter((c) => c.startsWith('thumbComplete')).sort()).toEqual(['thumbComplete x', 'thumbComplete y', 'thumbComplete z']);
  });
});
