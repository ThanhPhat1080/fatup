import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { UploadJob } from '../src/shared-ipc';
import { mimeFromName } from '../src/main/mime';
import { UploadManager, putFile } from '../src/main/uploader';

let server: Server;
let base = '';
const received = new Map<string, { bytes: number; type: string | undefined }>();

beforeAll(async () => {
  server = createServer((req, res) => {
    let bytes = 0;
    req.on('data', (c) => (bytes += c.length));
    req.on('end', () => {
      received.set(req.url ?? '', { bytes, type: req.headers['content-type'] });
      res.writeHead(req.url?.includes('fail') ? 500 : 200).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const dir = mkdtempSync(join(tmpdir(), 'fatup-up-'));
const write = (name: string, size: number) => {
  const p = join(dir, name);
  writeFileSync(p, Buffer.alloc(size, 1));
  return p;
};

describe('mimeFromName', () => {
  it('maps known extensions and falls back to octet-stream', () => {
    expect(mimeFromName('a.JPG')).toBe('image/jpeg');
    expect(mimeFromName('report.pdf')).toBe('application/pdf');
    expect(mimeFromName('noext')).toBe('application/octet-stream');
  });
});

describe('putFile', () => {
  it('streams the file and reports progress', async () => {
    const path = write('big.bin', 3 * 1024 * 1024);
    const progress: number[] = [];
    await putFile(`${base}/put-big`, path, 3 * 1024 * 1024, 'application/octet-stream', { onProgress: (n) => progress.push(n) });
    expect(received.get('/put-big')).toEqual({ bytes: 3 * 1024 * 1024, type: 'application/octet-stream' });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(3 * 1024 * 1024);
  });

  it('sends empty files', async () => {
    await putFile(`${base}/put-empty`, write('empty.txt', 0), 0, 'text/plain');
    expect(received.get('/put-empty')?.bytes).toBe(0);
  });

  it('throws on a non-2xx response', async () => {
    await expect(putFile(`${base}/fail`, write('x.bin', 10), 10, 'a/b')).rejects.toMatchObject({ code: 'upload_failed' });
  });
});

describe('UploadManager', () => {
  function setup(opts: { thumb?: Buffer | null } = {}) {
    const states: UploadJob[][] = [];
    const created: unknown[] = [];
    const complete = vi.fn(async () => ({}));
    const setVault = vi.fn(async () => ({}));
    const manager = new UploadManager({
      client: () => ({
        createUpload: async (req) => {
          created.push(req);
          const id = `id${created.length}`;
          return { id, uploadUrl: `${base}/f/${id}`, thumbUploadUrl: req.hasThumb ? `${base}/t/${id}` : null };
        },
        complete,
        setVault,
      }),
      device: 'Test PC',
      thumbnail: () => opts.thumb ?? null,
      onChange: (jobs) => states.push(jobs),
    });
    const settled = () =>
      vi.waitFor(() => {
        const last = states.at(-1);
        expect(last?.length).toBeGreaterThan(0);
        expect(last?.every((j) => j.state !== 'queued' && j.state !== 'uploading')).toBe(true);
      });
    return { manager, states, created, complete, setVault, settled };
  }

  it('uploads a file, its thumbnail, then completes', async () => {
    const { manager, created, complete, settled } = setup({ thumb: Buffer.from('jpeg') });
    manager.add([write('photo.jpg', 2048)]);
    await settled();
    expect(manager.snapshot()[0]).toMatchObject({ name: 'photo.jpg', size: 2048, sent: 2048, state: 'done' });
    expect(created[0]).toMatchObject({ name: 'photo.jpg', mime: 'image/jpeg', size: 2048, hasThumb: true, device: 'Test PC' });
    expect(received.get('/f/id1')?.bytes).toBe(2048);
    expect(received.get('/t/id1')).toEqual({ bytes: 4, type: 'image/jpeg' });
    expect(complete).toHaveBeenCalledWith('id1');
  });

  it('moves vault uploads into the vault after completing', async () => {
    const { manager, setVault, settled } = setup();
    manager.add([write('secret.txt', 4)], true);
    await settled();
    expect(manager.snapshot()[0].state).toBe('done');
    expect(setVault).toHaveBeenCalledWith('id1', true);
  });

  it('does not touch the vault for normal uploads', async () => {
    const { manager, setVault, settled } = setup();
    manager.add([write('plain.txt', 4)]);
    await settled();
    expect(setVault).not.toHaveBeenCalled();
  });

  it('skips the thumbnail for non-images', async () => {
    const { manager, created, settled } = setup({ thumb: Buffer.from('jpeg') });
    manager.add([write('notes.txt', 5)]);
    await settled();
    expect(created[0]).toMatchObject({ hasThumb: false });
  });

  it('reports missing files and folders as errors without stopping the queue', async () => {
    const { manager, settled } = setup();
    manager.add([join(dir, 'nope.bin'), dir, write('ok.bin', 3)]);
    await settled();
    expect(manager.snapshot().map((j) => [j.state, j.error])).toEqual([
      ['error', 'not_found'],
      ['error', 'not_a_file'],
      ['done', undefined],
    ]);
  });

  it('cancels a queued job and clears finished ones', async () => {
    const { manager, settled } = setup();
    manager.add([write('a.bin', 1), write('b.bin', 1), write('c.bin', 1)]);
    manager.cancel(manager.snapshot()[2].id);
    await settled();
    expect(manager.snapshot().map((j) => j.state)).toEqual(['done', 'done', 'canceled']);
    manager.clearFinished();
    expect(manager.snapshot()).toEqual([]);
  });
});
