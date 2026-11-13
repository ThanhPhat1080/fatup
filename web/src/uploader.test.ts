import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE } from '@fatup/shared';
import type { UploadJob } from '../../desktop/src/shared-ipc';
import { WebUploadManager, deviceName, type WebUploadDeps } from './uploader';

const file = (name: string, size = 10, type = 'image/png') => new File([new Uint8Array(size)], name, { type });

function setup(over: Partial<WebUploadDeps> = {}) {
  const calls: string[] = [];
  const latest: { jobs: UploadJob[] } = { jobs: [] };
  const mgr = new WebUploadManager({
    client: () => ({
      createUpload: async (req) => {
        calls.push(`create:${req.name}:${req.hasThumb}:${req.device}`);
        return { id: req.name, uploadUrl: `u:${req.name}`, thumbUploadUrl: req.hasThumb ? `t:${req.name}` : null };
      },
      complete: async (id) => void calls.push(`complete:${id}`),
      setVault: async (id, v) => void calls.push(`vault:${id}:${v}`),
    }),
    device: 'Chrome · Android',
    onChange: (jobs) => (latest.jobs = jobs),
    thumbnail: async () => new Blob(['jpg']),
    put: async (url, _b, _m, opts) => {
      calls.push(`put:${url}`);
      opts?.onProgress?.(5);
    },
    ...over,
  });
  const settled = async () => {
    for (let i = 0; i < 50 && latest.jobs.some((j) => j.state === 'queued' || j.state === 'uploading'); i++) await new Promise((r) => setTimeout(r, 5));
  };
  return { mgr, calls, latest, settled };
}

describe('WebUploadManager', () => {
  it('uploads the file, then its thumbnail, then completes', async () => {
    const { mgr, calls, latest, settled } = setup();
    mgr.add([file('a.png')]);
    await settled();
    expect(calls).toEqual(['create:a.png:true:Chrome · Android', 'put:u:a.png', 'put:t:a.png', 'complete:a.png']);
    expect(latest.jobs[0]).toMatchObject({ name: 'a.png', state: 'done', sent: 10, size: 10 });
  });

  it('skips the thumbnail for non-images and when decoding fails', async () => {
    const { mgr, calls, settled } = setup({ thumbnail: async () => null });
    mgr.add([file('a.heic'), file('b.pdf', 10, 'application/pdf')]);
    await settled();
    expect(calls.filter((c) => c.startsWith('put:t:'))).toEqual([]);
    expect(calls.filter((c) => c.startsWith('create:')).every((c) => c.includes(':false:'))).toBe(true);
  });

  it('moves files into the vault when asked', async () => {
    const { mgr, calls, settled } = setup();
    mgr.add([file('a.png')], true);
    await settled();
    expect(calls.at(-1)).toBe('vault:a.png:true');
  });

  it('runs two at a time', async () => {
    let active = 0;
    let peak = 0;
    const { mgr, settled } = setup({
      put: async () => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
      },
      thumbnail: async () => null,
    });
    mgr.add([file('1'), file('2'), file('3'), file('4')]);
    await settled();
    expect(peak).toBe(2);
  });

  it('rejects files over the size limit without contacting the server', async () => {
    const { mgr, calls, latest, settled } = setup();
    const big = file('big.bin', 1);
    Object.defineProperty(big, 'size', { value: MAX_FILE_SIZE + 1 });
    mgr.add([big]);
    await settled();
    expect(calls).toEqual([]);
    expect(latest.jobs[0]).toMatchObject({ state: 'error', error: 'too_large' });
  });

  it('reports a failed upload and keeps going', async () => {
    const { mgr, latest, settled } = setup({
      put: async (url) => {
        if (url === 'u:bad') throw Object.assign(new Error('x'), { code: 'upload_failed' });
      },
      thumbnail: async () => null,
    });
    mgr.add([file('bad'), file('good')]);
    await settled();
    expect(latest.jobs.map((j) => j.state)).toEqual(['error', 'done']);
  });

  it('cancels a running upload and clears finished entries', async () => {
    const { mgr, latest, settled } = setup({
      put: (_u, _b, _m, opts) => new Promise((_res, rej) => opts?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))),
      thumbnail: async () => null,
    });
    mgr.add([file('a')]);
    await new Promise((r) => setTimeout(r, 10));
    mgr.cancel(latest.jobs[0].id);
    await settled();
    expect(latest.jobs[0].state).toBe('canceled');
    mgr.clearFinished();
    expect(latest.jobs).toEqual([]);
  });
});

describe('deviceName', () => {
  it('names the browser and OS', () => {
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari · iOS');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/125.0')).toBe('Firefox · Windows');
  });
});
