import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decryptBytes, newFileKey, vaultCiphertextSize, type CreateUploadRequest, type VaultMeta } from '@fatup/shared';
import type { UploadJob } from '../src/shared-ipc';
import { mimeFromName } from '../src/main/mime';
import { UploadManager, putFile } from '../src/main/uploader';

let server: Server;
let base = '';
const received = new Map<string, { bytes: number; type: string | undefined }>();
/** The whole body and the Content-Length header of each PUT, for the encrypted-upload tests. */
const bodies = new Map<string, { body: Buffer; length: string | undefined }>();

beforeAll(async () => {
  server = createServer((req, res) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      bytes += c.length;
      chunks.push(c);
    });
    req.on('end', () => {
      received.set(req.url ?? '', { bytes, type: req.headers['content-type'] });
      bodies.set(req.url ?? '', { body: Buffer.concat(chunks), length: req.headers['content-length'] });
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

  it('refuses a vault upload when there is no vault encryptor, and never uses the legacy setVault', async () => {
    // The encrypted vault is always set up before anything can be uploaded into it (spec Q4), so a vault upload
    // without an encryptor must fail rather than store a plain file in the vault.
    const { manager, setVault, settled } = setup();
    manager.add([write('secret.txt', 4)], true);
    await settled();
    expect(manager.snapshot()[0]).toMatchObject({ state: 'error', error: 'vault_locked' });
    expect(setVault).not.toHaveBeenCalled();
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

describe('UploadManager into the encrypted Vault', () => {
  /** What the open Vault session hands the uploader (Task 8): `isOpen()` and `encryptMetaFor(meta)`, the latter minting a file key. */
  function vaultSetup(opts: { thumb?: Buffer | null; open?: boolean; encryptError?: Error } = {}) {
    const states: UploadJob[][] = [];
    const created: CreateUploadRequest[] = [];
    const metas: VaultMeta[] = [];
    const keys: CryptoKey[] = [];
    const complete = vi.fn(async () => ({}));
    const setVault = vi.fn(async () => ({}));
    const open = { value: opts.open ?? true };
    const manager = new UploadManager({
      client: () => ({
        createUpload: async (req) => {
          created.push(req);
          const id = `v${nextVaultId++}`;
          return { id, uploadUrl: `${base}/f/${id}`, thumbUploadUrl: req.hasThumb ? `${base}/t/${id}` : null };
        },
        complete,
        setVault,
      }),
      device: 'Test PC',
      thumbnail: () => opts.thumb ?? null,
      onChange: (jobs) => states.push(jobs),
      vault: {
        isOpen: () => open.value,
        encryptMetaFor: async (meta: VaultMeta) => {
          if (opts.encryptError) throw opts.encryptError;
          metas.push(meta);
          const { dek } = await newFileKey();
          keys.push(dek);
          return { encMeta: `ENCMETA-${metas.length}`, encKey: `ENCKEY-${metas.length}`, dek };
        },
      },
    });
    const settled = () =>
      vi.waitFor(() => {
        const last = states.at(-1);
        expect(last?.length).toBeGreaterThan(0);
        expect(last?.every((j) => j.state !== 'queued' && j.state !== 'uploading')).toBe(true);
      });
    return { manager, created, metas, keys, complete, setVault, open, settled };
  }
  let nextVaultId = 1;

  /** A file with content that would show any mix-up (not one repeated byte). */
  const writeRandom = (name: string, size: number) => {
    const p = join(dir, name);
    const bytes = Buffer.from(Array.from({ length: size }, (_, i) => (i * 131 + 17) & 0xff));
    writeFileSync(p, bytes);
    return { path: p, bytes };
  };

  it('sends the encrypted metadata and file key, and no plain name or type', async () => {
    const { manager, created, metas, settled } = vaultSetup();
    const file = writeRandom('Hợp đồng.pdf', 3000);
    manager.add([file.path], true);
    await settled();
    expect(manager.snapshot()[0]).toMatchObject({ name: 'Hợp đồng.pdf', size: 3000, sent: 3000, state: 'done' });
    expect(metas).toEqual([{ name: 'Hợp đồng.pdf', mime: 'application/pdf', kind: 'file' }]);
    expect(created).toHaveLength(1);
    expect(created[0].vault).toEqual({ encMeta: 'ENCMETA-1', encKey: 'ENCKEY-1' });
    expect(created[0].name).not.toContain('pdf');
    expect(created[0].name).not.toContain('Hợp');
    expect(created[0].mime).toBe('application/octet-stream');
    expect(created[0].size).toBe(vaultCiphertextSize(3000));
    expect(created[0].device).toBe('Test PC');
  });

  it('PUTs an FUV1 ciphertext of exactly the announced size, typed as opaque bytes', async () => {
    const { manager, created, settled } = vaultSetup();
    const file = writeRandom('doc.pdf', 5000);
    manager.add([file.path], true);
    await settled();
    const put = bodies.get(`/f/v${nextVaultId - 1}`)!;
    expect(put.body.subarray(0, 4).toString('ascii')).toBe('FUV1');
    expect(put.body.length).toBe(vaultCiphertextSize(5000));
    expect(put.length).toBe(String(vaultCiphertextSize(5000)));
    expect(created[0].size).toBe(put.body.length);
    expect(received.get(`/f/v${nextVaultId - 1}`)?.type).toBe('application/octet-stream');
  });

  it('encrypts so that the file key gives back the original bytes, across several chunks', async () => {
    const { manager, keys, settled } = vaultSetup();
    const file = writeRandom('big.bin', 2 * 1024 * 1024 + 123);
    manager.add([file.path], true);
    await settled();
    const put = bodies.get(`/f/v${nextVaultId - 1}`)!;
    expect(put.length).toBe(String(vaultCiphertextSize(file.bytes.length)));
    const plain = await decryptBytes(new Uint8Array(put.body), keys[0]);
    expect(Buffer.compare(Buffer.from(plain), file.bytes)).toBe(0);
  });

  it('encrypts an empty file too', async () => {
    const { manager, keys, settled } = vaultSetup();
    manager.add([write('empty.dat', 0)], true);
    await settled();
    const put = bodies.get(`/f/v${nextVaultId - 1}`)!;
    expect(put.body.length).toBe(vaultCiphertextSize(0));
    expect((await decryptBytes(new Uint8Array(put.body), keys[0])).length).toBe(0);
    expect(manager.snapshot()[0].state).toBe('done');
  });

  it('encrypts the thumbnail of an image with the same file key, as opaque bytes', async () => {
    const { manager, created, metas, keys, settled } = vaultSetup({ thumb: Buffer.from('jpeg preview bytes') });
    const file = writeRandom('photo.jpg', 2048);
    manager.add([file.path], true);
    await settled();
    const id = `v${nextVaultId - 1}`;
    expect(metas[0]).toMatchObject({ name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' });
    expect(created[0].hasThumb).toBe(true);
    const thumb = bodies.get(`/t/${id}`)!;
    expect(thumb.body.subarray(0, 4).toString('ascii')).toBe('FUV1');
    expect(thumb.body.length).toBe(vaultCiphertextSize('jpeg preview bytes'.length));
    expect(received.get(`/t/${id}`)?.type).toBe('application/octet-stream');
    expect(Buffer.from(await decryptBytes(new Uint8Array(thumb.body), keys[0])).toString()).toBe('jpeg preview bytes');
    const body = bodies.get(`/f/${id}`)!;
    expect(Buffer.compare(Buffer.from(await decryptBytes(new Uint8Array(body.body), keys[0])), file.bytes)).toBe(0);
  });

  it('completes the upload and does not use the legacy move into the Vault', async () => {
    const { manager, complete, setVault, settled } = vaultSetup();
    manager.add([write('x.txt', 10)], true);
    await settled();
    expect(complete).toHaveBeenCalledWith(`v${nextVaultId - 1}`);
    expect(setVault).not.toHaveBeenCalled();
  });

  it('fails with vault_locked, and uploads nothing, when the Vault is closed', async () => {
    const { manager, created, metas, complete, settled } = vaultSetup({ open: false });
    const before = bodies.size;
    manager.add([write('closed.txt', 10)], true);
    await settled();
    expect(manager.snapshot()[0]).toMatchObject({ state: 'error', error: 'vault_locked' });
    expect(created).toEqual([]);
    expect(metas).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
    expect(bodies.size).toBe(before);
  });

  it('fails with vault_locked, and uploads nothing, when the Vault closes while the key is being made', async () => {
    const closed = Object.assign(new Error('vault_locked'), { code: 'vault_locked' });
    const { manager, created, complete, settled } = vaultSetup({ encryptError: closed });
    const before = bodies.size;
    manager.add([write('race.txt', 10)], true);
    await settled();
    expect(manager.snapshot()[0]).toMatchObject({ state: 'error', error: 'vault_locked' });
    expect(created).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
    expect(bodies.size).toBe(before);
  });

  it('leaves plain uploads alone: no vault field, plain bytes, real name and size', async () => {
    const { manager, created, metas, settled } = vaultSetup();
    const file = writeRandom('plain.txt', 700);
    manager.add([file.path]);
    await settled();
    const id = `v${nextVaultId - 1}`;
    expect(metas).toEqual([]);
    expect(created[0].vault).toBeUndefined();
    expect(created[0]).toMatchObject({ name: 'plain.txt', mime: 'text/plain', size: 700 });
    expect(Buffer.compare(bodies.get(`/f/${id}`)!.body, file.bytes)).toBe(0);
  });

  it('uploads plain files even while the Vault is closed', async () => {
    const { manager, settled } = vaultSetup({ open: false });
    manager.add([write('free.txt', 4)]);
    await settled();
    expect(manager.snapshot()[0].state).toBe('done');
  });
});
