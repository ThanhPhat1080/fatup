import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_SIZE,
  decryptBytes,
  decryptMeta,
  encryptMeta,
  newFileKey,
  newMasterKey,
  unwrapFileKey,
  vaultCiphertextSize,
  type CreateUploadRequest,
  type VaultMeta,
} from '@fatup/shared';
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

  // Replaces the legacy rule ("upload plain, then PUT /files/:id/vault"): the Worker refuses that once the encrypted Vault exists, and
  // a plain file must never be stored in the Vault. A Vault upload needs the Vault encryptor (see the next describe).
  it('fails a vault upload with vault_locked when there is no vault encryptor, creating nothing and never using the legacy setVault', async () => {
    const { mgr, calls, latest, settled } = setup();
    mgr.add([file('a.png')], true);
    await settled();
    expect(latest.jobs[0]).toMatchObject({ state: 'error', error: 'vault_locked' });
    expect(calls).toEqual([]);
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

describe('WebUploadManager: uploads into the encrypted Vault', () => {
  const content = Uint8Array.from({ length: 3000 }, (_v, i) => (i * 7 + 3) % 251);
  const THUMB = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
  const dec = (b: Uint8Array) => new TextDecoder().decode(b);

  async function vaultWorld(o: { open?: boolean; thumb?: boolean; encryptError?: Error } = {}) {
    const mk = await newMasterKey();
    const created: CreateUploadRequest[] = [];
    const completed: string[] = [];
    const legacy: string[] = [];
    const puts: { url: string; mime: string; body: Blob }[] = [];
    const metas: VaultMeta[] = [];
    const latest: { jobs: UploadJob[] } = { jobs: [] };
    const state = { open: o.open ?? true };
    const mgr = new WebUploadManager({
      client: () => ({
        createUpload: async (req) => {
          created.push(JSON.parse(JSON.stringify(req)) as CreateUploadRequest);
          return { id: `N${created.length}`, uploadUrl: `u:N${created.length}`, thumbUploadUrl: req.hasThumb ? `t:N${created.length}` : null };
        },
        complete: async (id) => void completed.push(id),
        setVault: async (id) => void legacy.push(id),
      }),
      device: 'Chrome · Android',
      onChange: (jobs) => (latest.jobs = jobs),
      thumbnail: async () => (o.thumb ? new Blob([THUMB]) : null),
      put: async (url, body, mime) => void puts.push({ url, mime, body: body as Blob }),
      // The same thing `VaultSession.encryptMetaFor` does, over a key made here.
      vault: {
        isOpen: () => state.open,
        encryptMetaFor: async (meta: VaultMeta) => {
          if (o.encryptError) throw o.encryptError;
          metas.push(meta);
          const { dek, wrapped } = await newFileKey();
          return { encMeta: await encryptMeta(meta, mk), encKey: await wrapped(mk), dek };
        },
      },
    });
    const settled = async () => {
      for (let i = 0; i < 100 && (latest.jobs.length === 0 || latest.jobs.some((j) => j.state === 'queued' || j.state === 'uploading')); i++) await new Promise((r) => setTimeout(r, 5));
    };
    return { mgr, mk, created, completed, legacy, puts, metas, latest, state, settled };
  }

  const pdf = () => new File([content], 'Hợp đồng.pdf', { type: 'application/pdf' });
  const bodyOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

  it('asks the server for an opaque object: placeholder name and type, ciphertext size, and the sealed metadata', async () => {
    const w = await vaultWorld();
    w.mgr.add([pdf()], true);
    await w.settled();
    expect(w.created).toHaveLength(1);
    const req = w.created[0];
    expect(req).toMatchObject({ name: '', mime: 'application/octet-stream', size: vaultCiphertextSize(content.length), hasThumb: false, device: 'Chrome · Android' });
    expect(Object.keys(req.vault ?? {}).sort()).toEqual(['encKey', 'encMeta']);
    expect(await decryptMeta(req.vault!.encMeta, w.mk)).toEqual({ name: 'Hợp đồng.pdf', mime: 'application/pdf', kind: 'file' });
    expect(JSON.stringify(req)).not.toContain('Hợp đồng');
    expect(JSON.stringify(req)).not.toContain('application/pdf');
    expect(w.latest.jobs[0]).toMatchObject({ name: 'Hợp đồng.pdf', state: 'done', sent: content.length, size: content.length });
  });

  it('PUTs a FUV1 ciphertext of exactly vaultCiphertextSize bytes that decrypts to the file, then completes; never the legacy setVault', async () => {
    const w = await vaultWorld();
    w.mgr.add([pdf()], true);
    await w.settled();
    expect(w.puts).toHaveLength(1);
    const [put] = w.puts;
    expect(put.url).toBe('u:N1');
    expect(put.mime).toBe('application/octet-stream');
    const body = await bodyOf(put.body);
    expect(dec(body.subarray(0, 4))).toBe('FUV1');
    expect(body.length).toBe(vaultCiphertextSize(content.length));
    const dek = await unwrapFileKey(w.created[0].vault!.encKey, w.mk);
    expect(same(await decryptBytes(body, dek), content)).toBe(true);
    expect(w.completed).toEqual(['N1']);
    expect(w.legacy).toEqual([]);
  });

  it('uploads an empty file as a 32-byte ciphertext', async () => {
    const w = await vaultWorld();
    w.mgr.add([new File([], 'empty.txt', { type: 'text/plain' })], true);
    await w.settled();
    expect(w.created[0].size).toBe(vaultCiphertextSize(0));
    expect((await bodyOf(w.puts[0].body)).length).toBe(32);
  });

  it('encrypts the thumbnail of an image under the same file key and sends its ciphertext size', async () => {
    const w = await vaultWorld({ thumb: true });
    w.mgr.add([new File([content], 'photo.png', { type: 'image/png' })], true);
    await w.settled();
    const req = w.created[0];
    expect(req.hasThumb).toBe(true);
    expect(w.metas[0]).toEqual({ name: 'photo.png', mime: 'image/png', kind: 'image' });
    const thumb = w.puts.find((p) => p.url === 't:N1')!;
    expect(thumb).toBeDefined();
    const body = await bodyOf(thumb.body);
    expect(dec(body.subarray(0, 4))).toBe('FUV1');
    expect(body.length).toBe(vaultCiphertextSize(THUMB.length));
    expect(thumb.mime).toBe('application/octet-stream');
    const dek = await unwrapFileKey(req.vault!.encKey, w.mk);
    expect(same(await decryptBytes(body, dek), THUMB)).toBe(true);
    expect(w.puts.find((p) => p.url === 'u:N1')).toBeDefined();
  });

  it('fails with vault_locked, creating and uploading nothing, when the Vault is closed', async () => {
    const w = await vaultWorld({ open: false });
    w.mgr.add([pdf()], true);
    await w.settled();
    expect(w.latest.jobs[0]).toMatchObject({ state: 'error', error: 'vault_locked' });
    expect(w.created).toEqual([]);
    expect(w.puts).toEqual([]);
    expect(w.completed).toEqual([]);
    expect(w.legacy).toEqual([]);
    expect(w.metas).toEqual([]);
  });

  it('fails with vault_locked, creating nothing, when the Vault closes while the key is being made', async () => {
    const w = await vaultWorld({ encryptError: Object.assign(new Error('vault_locked'), { code: 'vault_locked' }) });
    w.mgr.add([pdf()], true);
    await w.settled();
    expect(w.latest.jobs[0]).toMatchObject({ state: 'error', error: 'vault_locked' });
    expect(w.created).toEqual([]);
    expect(w.puts).toEqual([]);
  });

  it('keeps plain uploads plain, even with the Vault open: real name and size, no vault field, no encryption', async () => {
    const w = await vaultWorld();
    w.mgr.add([pdf()]);
    await w.settled();
    expect(w.created[0]).toMatchObject({ name: 'Hợp đồng.pdf', mime: 'application/pdf', size: content.length });
    expect(w.created[0].vault).toBeUndefined();
    expect(w.metas).toEqual([]);
    expect(await bodyOf(w.puts[0].body)).toEqual(content);
  });

  it('keeps going after a Vault upload fails: a closed Vault does not stop a plain file queued next to it', async () => {
    const w = await vaultWorld({ open: false });
    w.mgr.add([pdf()], true);
    w.mgr.add([new File([content], 'plain.pdf', { type: 'application/pdf' })]);
    await w.settled();
    expect(w.latest.jobs.map((j) => j.state)).toEqual(['error', 'done']);
    expect(w.created.map((c) => c.name)).toEqual(['plain.pdf']);
  });
});

describe('deviceName', () => {
  it('names the browser and OS', () => {
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari · iOS');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/125.0')).toBe('Firefox · Windows');
  });
});
