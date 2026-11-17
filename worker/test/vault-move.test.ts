import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LINK_MIME,
  VAULT_HEADER,
  VAULT_PROTOCOL_VERSION,
  type FileItem,
  type ListFilesResponse,
  type VaultMoveInComplete,
  type VaultMoveOutComplete,
  type VaultMoveUrls,
} from '@fatup/shared';
import { createApp } from '../src/app';
import { ulid } from '../src/ulid';

type GetOpts = { filename?: string; contentType?: string };

const fakePresigner = () => ({
  put: async (key: string) => `https://r2.test/put/${key}`,
  get: async (key: string, opts?: GetOpts) => `https://r2.test/get/${key}${opts?.filename ? `?name=${encodeURIComponent(opts.filename)}` : ''}`,
});

const app = createApp({ presigner: fakePresigner });
const AUTH = { Authorization: 'Bearer test-token' };
const VAULT = { [VAULT_HEADER]: VAULT_PROTOCOL_VERSION };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** A request as a vault-aware app sends it. */
function callV(path: string, init: RequestInit = {}) {
  return app.request(path, { ...init, headers: { ...AUTH, ...VAULT, ...(init.headers ?? {}) } }, env);
}

const postJson = (path: string, body: unknown) => callV(path, { method: 'POST', body: JSON.stringify(body), headers: JSON_HEADERS });

const moveIn = (id: string) => callV(`/files/${id}/vault/in`, { method: 'POST' });
const moveOut = (id: string) => callV(`/files/${id}/vault/out`, { method: 'POST' });
const completeIn = (id: string, body: unknown) => postJson(`/files/${id}/vault/in/complete`, body);
const completeOut = (id: string, body: unknown) => postJson(`/files/${id}/vault/out/complete`, body);

type VaultState = 'none' | 'ready' | 'wiped';

/** Puts the single vault_keys row in the wanted state by SQL (the routes that do it are covered in vault-routes.test.ts). */
async function setState(state: VaultState) {
  await env.DB.prepare('DELETE FROM vault_keys').run();
  if (state === 'none') return;
  const ready = state === 'ready';
  await env.DB.prepare(
    `INSERT INTO vault_keys (id, kdf_salt, kdf_iterations, auth_hash, server_secret, wrapped_mk_pin, rk_auth_hash, wrapped_mk_recovery, created_at, updated_at)
     VALUES (1, 'salt', 1000, ?, ?, ?, 'rk', 'wrapped-rk', 1, 1)`,
  )
    .bind(ready ? 'auth' : null, ready ? 'secret' : null, ready ? 'wrapped-pin' : null)
    .run();
}

type NewRow = {
  inVault?: 0 | 1;
  encrypted?: 0 | 1;
  deletedAt?: number | null;
  name?: string;
  mime?: string;
  size?: number;
  kind?: 'image' | 'file' | 'link';
  url?: string | null;
  hasThumb?: 0 | 1;
  encMeta?: string | null;
  encKey?: string | null;
};

/** Inserts a finished file row straight into D1, bypassing the upload flow. */
async function insertFile(f: NewRow = {}) {
  const id = ulid();
  const encrypted = f.encrypted ?? 0;
  await env.DB.prepare(
    `INSERT INTO files (id, name, mime, size, kind, has_thumb, status, created_at, deleted_at, in_vault, encrypted, enc_meta, enc_key, url)
     VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      f.name ?? (encrypted ? '' : 'a.bin'),
      f.mime ?? (encrypted ? 'application/octet-stream' : f.kind === 'link' ? LINK_MIME : 'application/octet-stream'),
      f.size ?? 4,
      f.kind ?? 'file',
      f.hasThumb ?? 0,
      Date.now(),
      f.deletedAt ?? null,
      f.inVault ?? (encrypted ? 1 : 0),
      encrypted,
      f.encMeta ?? (encrypted ? 'TUVUQQ==' : null),
      f.encKey ?? (encrypted ? 'S0VZ' : null),
      f.url ?? null,
    )
    .run();
  return id;
}

type DbRow = {
  name: string;
  mime: string;
  size: number;
  kind: string;
  url: string | null;
  deleted_at: number | null;
  in_vault: number;
  encrypted: number;
  enc_meta: string | null;
  enc_key: string | null;
  has_thumb: number;
  previewed_at: number | null;
  icon_url: string | null;
};
const rowOf = (id: string) => env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first<DbRow>();

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

const put = (key: string, bytes: number) => env.BUCKET.put(key, new Uint8Array(bytes));
const has = async (key: string) => (await env.BUCKET.head(key)) !== null;

/** `https://r2.test/get/files/<id>?name=x` -> `files/<id>`: the R2 key a fake-presigned URL stands for. */
const keyOf = (url: string | null) => (url === null ? null : url.replace(/^https:\/\/r2\.test\/(get|put)\//, '').replace(/\?.*$/, ''));

const urlsOf = async (res: Response) => {
  expect(res.status).toBe(200);
  const u = (await res.json()) as VaultMoveUrls;
  return {
    download: keyOf(u.downloadUrl),
    thumb: keyOf(u.thumbUrl),
    upload: keyOf(u.uploadUrl),
    thumbUpload: keyOf(u.thumbUploadUrl),
  };
};

const addShare = (fileId: string) =>
  env.DB.prepare('INSERT INTO shares (token, file_id, created_at) VALUES (?, ?, ?)').bind(`tok-${fileId}`, fileId, Date.now()).run();
const shareCount = async (fileId: string) =>
  ((await env.DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE file_id = ?').bind(fileId).first()) as { n: number }).n;
const vaultObjects = async () => (await env.BUCKET.list({ prefix: 'vault/' })).objects.map((o) => o.key);

const ENC_META = 'ZW5jcnlwdGVkLW1ldGE=';
const ENC_KEY = 'd3JhcHBlZC1maWxlLWtleQ==';
const inBody = (over: Partial<VaultMoveInComplete> = {}): VaultMoveInComplete => ({ encMeta: ENC_META, encKey: ENC_KEY, size: 40, hasThumb: false, ...over });
const outBody = (over: Partial<VaultMoveOutComplete> = {}): VaultMoveOutComplete => ({ name: 'a.bin', mime: 'application/octet-stream', size: 10, hasThumb: false, ...over });

/** A plain file row with its plain objects in R2. */
async function plainFile(f: NewRow & { thumb?: boolean } = {}) {
  const id = await insertFile({ ...f, hasThumb: f.thumb ? 1 : 0 });
  await put(`files/${id}`, 4);
  if (f.thumb) await put(`thumbs/${id}.jpg`, 3);
  return id;
}

/** An encrypted vault row with its vault objects in R2. */
async function vaultedFile(f: NewRow & { thumb?: boolean; withObjects?: boolean } = {}) {
  const id = await insertFile({ ...f, encrypted: 1, inVault: 1, hasThumb: f.thumb ? 1 : 0 });
  if (f.withObjects !== false) {
    await put(`vault/${id}`, 40);
    if (f.thumb) await put(`vault/${id}.thumb`, 20);
  }
  return id;
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM vault_keys').run();
  await env.DB.prepare('DELETE FROM shares').run();
  await env.DB.prepare('DELETE FROM files').run();
  const { objects } = await env.BUCKET.list();
  if (objects.length) await env.BUCKET.delete(objects.map((o) => o.key));
  await setState('ready');
});

describe('POST /files/:id/vault/in', () => {
  it('signs a GET for the plain file, a PUT for vault/<id>, and no thumbnail addresses when there is no thumbnail', async () => {
    const id = await plainFile();
    expect(await urlsOf(await moveIn(id))).toEqual({
      download: `files/${id}`,
      thumb: null,
      upload: `vault/${id}`,
      thumbUpload: null,
    });
  });

  it('also signs the plain thumbnail and a PUT for vault/<id>.thumb when the file has a thumbnail', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    expect(await urlsOf(await moveIn(id))).toEqual({
      download: `files/${id}`,
      thumb: `thumbs/${id}.jpg`,
      upload: `vault/${id}`,
      thumbUpload: `vault/${id}.thumb`,
    });
  });

  it('works on a legacy vault item (in_vault = 1, encrypted = 0) so it can be converted', async () => {
    const id = await plainFile({ inVault: 1, kind: 'image', mime: 'image/png', thumb: true });
    expect(await urlsOf(await moveIn(id))).toEqual({
      download: `files/${id}`,
      thumb: `thumbs/${id}.jpg`,
      upload: `vault/${id}`,
      thumbUpload: `vault/${id}.thumb`,
    });
  });

  it('gives a link no download address, because a link has no file to encrypt', async () => {
    const id = await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'example.com', size: 0 });
    const res = await moveIn(id);
    expect(res.status).toBe(200);
    const u = (await res.json()) as { downloadUrl: string | null; thumbUrl: string | null };
    expect(u.downloadUrl).toBeNull();
    expect(u.thumbUrl).toBeNull();
  });

  it('changes nothing: no row change and no object is written or removed', async () => {
    const id = await plainFile({ thumb: true });
    await moveIn(id);
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, name: 'a.bin' });
    expect(await has(`files/${id}`)).toBe(true);
    expect(await vaultObjects()).toEqual([]);
  });

  it('answers 409 already_encrypted for an item that is already encrypted', async () => {
    const id = await vaultedFile();
    const res = await moveIn(id);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('already_encrypted');
  });
});

describe('POST /files/:id/vault/in/complete', () => {
  it('answers 409 not_uploaded before vault/<id> exists, and changes nothing', async () => {
    const id = await plainFile({ thumb: true });
    const res = await completeIn(id, inBody());
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('not_uploaded');
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, name: 'a.bin', enc_meta: null, enc_key: null });
    expect(await has(`files/${id}`)).toBe(true);
    expect(await has(`thumbs/${id}.jpg`)).toBe(true);
  });

  it('does not accept size 0 for a file that has no vault object', async () => {
    const id = await plainFile();
    const res = await completeIn(id, inBody({ size: 0 }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('not_uploaded');
    expect((await rowOf(id))?.encrypted).toBe(0);
  });

  it('does not complete from an object that is only at a plain key', async () => {
    const id = await insertFile();
    await put(`files/${id}`, 40);
    const res = await completeIn(id, inBody());
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('not_uploaded');
  });

  it('answers 409 size_mismatch when the size differs from the object, deletes vault/<id>*, and keeps the plain copy', async () => {
    const id = await plainFile({ thumb: true });
    await put(`vault/${id}`, 41);
    await put(`vault/${id}.thumb`, 20);
    const res = await completeIn(id, inBody({ size: 40, hasThumb: true }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('size_mismatch');
    expect(await vaultObjects()).toEqual([]);
    expect(await has(`files/${id}`)).toBe(true);
    expect(await has(`thumbs/${id}.jpg`)).toBe(true);
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, name: 'a.bin', enc_meta: null, enc_key: null, has_thumb: 1 });
  });

  it('turns the row into an encrypted vault item with no plaintext metadata, and stores the ciphertext size', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', name: 'holiday.png', size: 4, thumb: true });
    await put(`vault/${id}`, 40);
    await put(`vault/${id}.thumb`, 20);
    const res = await completeIn(id, inBody({ hasThumb: true }));
    expect(res.status).toBe(200);
    const row = await rowOf(id);
    expect(row).toMatchObject({
      encrypted: 1,
      in_vault: 1,
      enc_meta: ENC_META,
      enc_key: ENC_KEY,
      name: '',
      mime: 'application/octet-stream',
      kind: 'file',
      url: null,
      size: 40,
      has_thumb: 1,
      previewed_at: null,
      icon_url: null,
      deleted_at: null,
    });
    expect(JSON.stringify(row)).not.toContain('holiday');
    expect(JSON.stringify(row)).not.toContain('image/png');
  });

  it('returns the item as an encrypted one, with its thumbnail on the vault key', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    await put(`vault/${id}`, 40);
    await put(`vault/${id}.thumb`, 20);
    const item = (await (await completeIn(id, inBody({ hasThumb: true }))).json()) as FileItem;
    expect(item).toMatchObject({ id, encrypted: true, inVault: true, encMeta: ENC_META, encKey: ENC_KEY, name: '', kind: 'file', mime: 'application/octet-stream', size: 40, url: null });
    expect(keyOf(item.thumbUrl)).toBe(`vault/${id}.thumb`);
  });

  it('deletes files/<id> and thumbs/<id>.jpg but keeps the vault objects', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    await put(`vault/${id}`, 40);
    await put(`vault/${id}.thumb`, 20);
    expect((await completeIn(id, inBody({ hasThumb: true }))).status).toBe(200);
    expect(await has(`files/${id}`)).toBe(false);
    expect(await has(`thumbs/${id}.jpg`)).toBe(false);
    expect(await has(`vault/${id}`)).toBe(true);
    expect(await has(`vault/${id}.thumb`)).toBe(true);
  });

  it('kills the share link of the file', async () => {
    const id = await plainFile();
    await addShare(id);
    expect(await shareCount(id)).toBe(1);
    await put(`vault/${id}`, 40);
    expect((await completeIn(id, inBody())).status).toBe(200);
    expect(await shareCount(id)).toBe(0);
  });

  it('moves the item from the main list to the vault list', async () => {
    const id = await plainFile();
    await put(`vault/${id}`, 40);
    await completeIn(id, inBody());
    const ids = async (path: string) => ((await (await callV(path)).json()) as ListFilesResponse).items.map((i) => i.id);
    expect(await ids('/files')).toEqual([]);
    expect(await ids('/files?vault=1')).toEqual([id]);
  });

  it('records no thumbnail when hasThumb is false, even if the plain file had one', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    await put(`vault/${id}`, 40);
    await completeIn(id, inBody({ hasThumb: false }));
    expect((await rowOf(id))?.has_thumb).toBe(0);
    expect(await has(`thumbs/${id}.jpg`)).toBe(false);
  });

  it('records no thumbnail when hasThumb is true but vault/<id>.thumb was never uploaded', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    await put(`vault/${id}`, 40);
    const item = (await (await completeIn(id, inBody({ hasThumb: true }))).json()) as FileItem;
    expect((await rowOf(id))?.has_thumb).toBe(0);
    expect(item.thumbUrl).toBeNull();
  });

  it('converts a legacy vault item and leaves it in the vault', async () => {
    const id = await plainFile({ inVault: 1, name: 'old.txt' });
    await put(`vault/${id}`, 40);
    expect((await completeIn(id, inBody())).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, name: '', enc_meta: ENC_META });
    expect(await has(`files/${id}`)).toBe(false);
  });

  it('moves a link in without any upload: size 0 is accepted and vault/<id> is not required', async () => {
    const id = await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'Example', size: 0 });
    await env.DB.prepare('UPDATE files SET previewed_at = 5, icon_url = ? WHERE id = ?').bind('https://example.com/i.png', id).run();
    const res = await completeIn(id, inBody({ size: 0 }));
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({
      encrypted: 1,
      in_vault: 1,
      enc_meta: ENC_META,
      enc_key: ENC_KEY,
      name: '',
      mime: 'application/octet-stream',
      kind: 'file',
      url: null,
      size: 0,
      has_thumb: 0,
      previewed_at: null,
      icon_url: null,
    });
    expect(await vaultObjects()).toEqual([]);
  });

  it('is idempotent: a second complete answers 200 and deletes nothing from vault/', async () => {
    const id = await plainFile({ thumb: true });
    await put(`vault/${id}`, 40);
    await put(`vault/${id}.thumb`, 20);
    expect((await completeIn(id, inBody({ hasThumb: true }))).status).toBe(200);
    const again = await completeIn(id, inBody({ hasThumb: true }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as FileItem).encrypted).toBe(true);
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, enc_meta: ENC_META, size: 40, has_thumb: 1 });
  });

  it('is idempotent for a row that was uploaded straight into the vault', async () => {
    const id = await vaultedFile({ thumb: true });
    const res = await completeIn(id, inBody({ hasThumb: true }));
    expect(res.status).toBe(200);
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
  });

  describe('invalid body: answers 400 and changes nothing', () => {
    const bad: [string, unknown][] = [
      ['missing encMeta', { encKey: ENC_KEY, size: 40, hasThumb: false }],
      ['missing encKey', { encMeta: ENC_META, size: 40, hasThumb: false }],
      ['empty encMeta', inBody({ encMeta: '' })],
      ['encMeta that is not a string', { ...inBody(), encMeta: 5 }],
      ['encKey that is not a string', { ...inBody(), encKey: ['x'] }],
      ['encMeta over 8192 characters', inBody({ encMeta: 'A'.repeat(8193) })],
      ['encKey over 512 characters', inBody({ encKey: 'A'.repeat(513) })],
      ['missing size', { encMeta: ENC_META, encKey: ENC_KEY, hasThumb: false }],
      ['non-integer size', inBody({ size: 40.5 })],
      ['negative size', inBody({ size: -1 })],
      ['size as a string', { ...inBody(), size: '40' }],
    ];
    for (const [label, body] of bad) {
      it(label, async () => {
        const id = await plainFile();
        await put(`vault/${id}`, 40);
        const res = await completeIn(id, body);
        expect(res.status).toBe(400);
        expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, name: 'a.bin', enc_meta: null });
        expect(await has(`files/${id}`)).toBe(true);
        expect(await has(`vault/${id}`)).toBe(true);
      });
    }

    it('a body that is not JSON', async () => {
      const id = await plainFile();
      await put(`vault/${id}`, 40);
      const res = await callV(`/files/${id}/vault/in/complete`, { method: 'POST', body: 'not json', headers: JSON_HEADERS });
      expect(res.status).toBe(400);
      expect((await rowOf(id))?.encrypted).toBe(0);
    });
  });

  it('accepts encMeta of exactly 8192 characters and encKey of exactly 512', async () => {
    const id = await plainFile();
    await put(`vault/${id}`, 40);
    const res = await completeIn(id, inBody({ encMeta: 'A'.repeat(8192), encKey: 'B'.repeat(512) }));
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1 });
  });
});

describe('POST /files/:id/vault/out', () => {
  it('signs a GET for vault/<id>, a PUT for files/<id>, and no thumbnail addresses when there is no thumbnail', async () => {
    const id = await vaultedFile();
    expect(await urlsOf(await moveOut(id))).toEqual({
      download: `vault/${id}`,
      thumb: null,
      upload: `files/${id}`,
      thumbUpload: null,
    });
  });

  it('also signs vault/<id>.thumb for download and thumbs/<id>.jpg for upload when the item has a thumbnail', async () => {
    const id = await vaultedFile({ thumb: true });
    expect(await urlsOf(await moveOut(id))).toEqual({
      download: `vault/${id}`,
      thumb: `vault/${id}.thumb`,
      upload: `files/${id}`,
      thumbUpload: `thumbs/${id}.jpg`,
    });
  });

  it('answers 409 not_encrypted for an item that is not encrypted', async () => {
    const id = await plainFile();
    const res = await moveOut(id);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('not_encrypted');
  });

  it('answers 409 not_encrypted for a legacy vault item too', async () => {
    const id = await plainFile({ inVault: 1 });
    const res = await moveOut(id);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('not_encrypted');
  });

  it('changes nothing: the row and the vault objects stay', async () => {
    const id = await vaultedFile({ thumb: true });
    await moveOut(id);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, enc_meta: 'TUVUQQ==' });
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
  });
});

describe('POST /files/:id/vault/out/complete', () => {
  describe('a file', () => {
    it('answers 409 not_uploaded when files/<id> does not exist, and changes nothing', async () => {
      const id = await vaultedFile({ thumb: true });
      const res = await completeOut(id, outBody());
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('not_uploaded');
      expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, enc_meta: 'TUVUQQ==', name: '' });
      expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
    });

    it('answers 409 size_mismatch, deletes only files/<id> and thumbs/<id>.jpg, and keeps the encrypted item intact', async () => {
      const id = await vaultedFile({ thumb: true });
      await put(`files/${id}`, 11);
      await put(`thumbs/${id}.jpg`, 3);
      const res = await completeOut(id, outBody({ size: 10, hasThumb: true }));
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('size_mismatch');
      expect(await has(`files/${id}`)).toBe(false);
      expect(await has(`thumbs/${id}.jpg`)).toBe(false);
      expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
      expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, enc_meta: 'TUVUQQ==', enc_key: 'S0VZ', name: '', size: 4 });
    });

    it('writes the real metadata back, clears the encryption columns and leaves the vault', async () => {
      const id = await vaultedFile({ thumb: true });
      await put(`files/${id}`, 10);
      await put(`thumbs/${id}.jpg`, 3);
      const res = await completeOut(id, outBody({ name: 'Hà Nội.png', mime: 'image/png', size: 10, hasThumb: true }));
      expect(res.status).toBe(200);
      expect(await rowOf(id)).toMatchObject({
        encrypted: 0,
        in_vault: 0,
        enc_meta: null,
        enc_key: null,
        name: 'Hà Nội.png',
        mime: 'image/png',
        kind: 'image',
        url: null,
        size: 10,
        has_thumb: 1,
        deleted_at: null,
      });
      const item = (await res.json()) as FileItem;
      expect(item).toMatchObject({ id, name: 'Hà Nội.png', kind: 'image', inVault: false, size: 10 });
      expect(item.encrypted).toBeFalsy();
      expect(keyOf(item.thumbUrl)).toBe(`thumbs/${id}.jpg`);
    });

    it('deletes vault/<id> and vault/<id>.thumb and keeps the plain objects', async () => {
      const id = await vaultedFile({ thumb: true });
      await put(`files/${id}`, 10);
      await put(`thumbs/${id}.jpg`, 3);
      await completeOut(id, outBody({ mime: 'image/png', hasThumb: true }));
      expect(await vaultObjects()).toEqual([]);
      expect(await has(`files/${id}`)).toBe(true);
      expect(await has(`thumbs/${id}.jpg`)).toBe(true);
    });

    it('shows the item in the main list again and not in the vault list', async () => {
      const id = await vaultedFile();
      await put(`files/${id}`, 10);
      await completeOut(id, outBody());
      const ids = async (path: string) => ((await (await callV(path)).json()) as ListFilesResponse).items.map((i) => i.id);
      expect(await ids('/files')).toEqual([id]);
      expect(await ids('/files?vault=1')).toEqual([]);
    });

    it('sanitises the name like an upload does: no directory parts, no control characters', async () => {
      const id = await vaultedFile();
      await put(`files/${id}`, 10);
      await completeOut(id, outBody({ name: '../../etc/pass\u0000wd.txt' }));
      expect((await rowOf(id))?.name).toBe('passwd.txt');
    });

    it('cleans the mime like an upload does: lower-cased, and an invalid one becomes application/octet-stream', async () => {
      const a = await vaultedFile();
      await put(`files/${a}`, 10);
      await completeOut(a, outBody({ mime: 'Application/PDF' }));
      expect(await rowOf(a)).toMatchObject({ mime: 'application/pdf', kind: 'file' });

      const b = await vaultedFile();
      await put(`files/${b}`, 10);
      await completeOut(b, outBody({ mime: 'not a mime' }));
      expect(await rowOf(b)).toMatchObject({ mime: 'application/octet-stream', kind: 'file' });
    });

    it('takes the kind from the mime, not from anything stored', async () => {
      const id = await vaultedFile();
      await put(`files/${id}`, 10);
      await completeOut(id, outBody({ mime: 'image/jpeg' }));
      expect((await rowOf(id))?.kind).toBe('image');
    });

    it('records no thumbnail when hasThumb is true but thumbs/<id>.jpg was never uploaded', async () => {
      const id = await vaultedFile({ thumb: true });
      await put(`files/${id}`, 10);
      await completeOut(id, outBody({ mime: 'image/png', hasThumb: true }));
      expect((await rowOf(id))?.has_thumb).toBe(0);
    });

    it('is idempotent: a second complete answers 200 and keeps the plain file', async () => {
      const id = await vaultedFile();
      await put(`files/${id}`, 10);
      expect((await completeOut(id, outBody())).status).toBe(200);
      const again = await completeOut(id, outBody());
      expect(again.status).toBe(200);
      expect(await has(`files/${id}`)).toBe(true);
      expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, name: 'a.bin', size: 10 });
    });

    describe('invalid body: answers 400 and changes nothing', () => {
      const bad: [string, unknown][] = [
        ['missing name', { mime: 'application/octet-stream', size: 10, hasThumb: false }],
        ['name that is not a string', { ...outBody(), name: 5 }],
        ['non-integer size', outBody({ size: 10.5 })],
        ['negative size', outBody({ size: -1 })],
        ['missing size', { name: 'a.bin', mime: 'application/octet-stream', hasThumb: false }],
      ];
      for (const [label, body] of bad) {
        it(label, async () => {
          const id = await vaultedFile();
          await put(`files/${id}`, 10);
          const res = await completeOut(id, body);
          expect(res.status).toBe(400);
          expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1 });
          expect(await has(`vault/${id}`)).toBe(true);
        });
      }
    });
  });

  describe('a link', () => {
    // An encrypted link is stored like any encrypted item, with no object of its own.
    const encryptedLink = () => vaultedFile({ withObjects: false, size: 0 });
    const linkBody = (over: Partial<VaultMoveOutComplete> = {}): VaultMoveOutComplete =>
      outBody({ name: 'ignored', mime: LINK_MIME, size: 0, url: 'https://example.com/a', ...over });

    it('becomes a link again: kind link, normalised url, title as name, to be previewed again, and needs no files/<id>', async () => {
      const id = await encryptedLink();
      const res = await completeOut(id, linkBody({ url: '  HTTPS://Example.com/Path?q=1#frag ', title: '  My   page  ' }));
      expect(res.status).toBe(200);
      expect(await rowOf(id)).toMatchObject({
        encrypted: 0,
        in_vault: 0,
        enc_meta: null,
        enc_key: null,
        kind: 'link',
        url: 'https://example.com/Path?q=1',
        name: 'My page',
        mime: LINK_MIME,
        previewed_at: null,
        has_thumb: 0,
        size: 0,
      });
      expect(await has(`files/${id}`)).toBe(false);
      expect(((await res.json()) as FileItem)).toMatchObject({ kind: 'link', url: 'https://example.com/Path?q=1', previewed: false, inVault: false });
    });

    it('uses the host as the name when there is no title', async () => {
      const id = await encryptedLink();
      await completeOut(id, linkBody({ url: 'https://Example.com/a', title: null }));
      expect((await rowOf(id))?.name).toBe('example.com');
    });

    it('deletes the vault objects it had', async () => {
      const id = await vaultedFile({ thumb: true, size: 0 });
      expect((await completeOut(id, linkBody())).status).toBe(200);
      expect(await vaultObjects()).toEqual([]);
    });

    it('shows the link in the main list again', async () => {
      const id = await encryptedLink();
      await completeOut(id, linkBody());
      const ids = ((await (await callV('/files?kind=link')).json()) as ListFilesResponse).items.map((i) => i.id);
      expect(ids).toEqual([id]);
    });

    it('answers 400 bad_url for an address that is not http(s), and changes nothing', async () => {
      for (const url of ['javascript:alert(1)', 'ftp://example.com/x', 'not a url', 'https://']) {
        const id = await vaultedFile({ size: 0 });
        const res = await completeOut(id, linkBody({ url }));
        expect(res.status, url).toBe(400);
        expect(await errorCode(res), url).toBe('bad_url');
        expect(await rowOf(id), url).toMatchObject({ encrypted: 1, in_vault: 1, enc_meta: 'TUVUQQ==', url: null });
        expect(await has(`vault/${id}`), url).toBe(true);
      }
    });

    it('answers 409 duplicate_url when another live link has the same address, and keeps the vault item intact', async () => {
      await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'example.com', size: 0 });
      const id = await vaultedFile({ thumb: true, size: 0 });
      const res = await completeOut(id, linkBody({ url: 'https://EXAMPLE.com/a#section' }));
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('duplicate_url');
      expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, enc_meta: 'TUVUQQ==', enc_key: 'S0VZ', name: '', kind: 'file', url: null });
      expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
    });

    it('does not count a link in the trash as a duplicate', async () => {
      await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'example.com', size: 0, deletedAt: Date.now() });
      const id = await encryptedLink();
      expect((await completeOut(id, linkBody())).status).toBe(200);
      expect((await rowOf(id))?.kind).toBe('link');
    });

    it('is idempotent: a second complete answers 200 and does not clash with itself', async () => {
      const id = await encryptedLink();
      expect((await completeOut(id, linkBody())).status).toBe(200);
      const again = await completeOut(id, linkBody());
      expect(again.status).toBe(200);
      expect(await rowOf(id)).toMatchObject({ kind: 'link', url: 'https://example.com/a', encrypted: 0 });
    });
  });
});

describe('guards on all four routes', () => {
  /** Each route with a row it would accept and a body that would otherwise be valid. */
  const routes: { name: string; call: (id: string) => Response | Promise<Response>; make: (f?: NewRow) => Promise<string> }[] = [
    { name: 'vault/in', call: moveIn, make: (f) => plainFile(f) },
    { name: 'vault/in/complete', call: (id) => completeIn(id, inBody()), make: async (f) => {
      const id = await plainFile(f);
      await put(`vault/${id}`, 40);
      return id;
    } },
    { name: 'vault/out', call: moveOut, make: (f) => vaultedFile(f) },
    { name: 'vault/out/complete', call: (id) => completeOut(id, outBody()), make: async (f) => {
      const id = await vaultedFile(f);
      await put(`files/${id}`, 10);
      return id;
    } },
  ];

  for (const route of routes) {
    describe(route.name, () => {
      for (const state of ['none', 'wiped'] as const) {
        it(`answers 409 vault_not_ready when the vault is ${state}, and changes nothing`, async () => {
          const id = await route.make();
          const before = await rowOf(id);
          await setState(state);
          const res = await route.call(id);
          expect(res.status).toBe(409);
          expect(await errorCode(res)).toBe('vault_not_ready');
          expect(await rowOf(id)).toEqual(before);
        });
      }

      it('answers 404 for an item in the trash, and changes nothing', async () => {
        const id = await route.make({ deletedAt: Date.now() });
        const before = await rowOf(id);
        const res = await route.call(id);
        expect(res.status).toBe(404);
        expect(await rowOf(id)).toEqual(before);
      });

      it('answers 404 for an unknown id', async () => {
        expect((await route.call(ulid())).status).toBe(404);
      });

      it('answers 404 for an id that is not a ULID', async () => {
        expect((await route.call('nope')).status).toBe(404);
      });

      it('needs the API token', async () => {
        const id = await route.make();
        const res = await app.request(`/files/${id}/${route.name}`, { method: 'POST', headers: { ...VAULT, ...JSON_HEADERS }, body: '{}' }, env);
        expect(res.status).toBe(401);
      });
    });
  }
});
