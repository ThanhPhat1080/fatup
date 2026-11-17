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
/** Sends the body exactly as given. Since spec 4.7d there is no etag and no claim: a not-yet-encrypted row is finished by its `attempt`. */
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
  /** The attempt that encrypted the row: its objects live at vault/<id>.<attempt>[.thumb]. NULL = the fixed key vault/<id>. */
  encObject?: string | null;
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
  // Only a test that names an attempt touches enc_object, so tests that do not need the column do not depend on it.
  if (f.encObject) await env.DB.prepare('UPDATE files SET enc_object = ? WHERE id = ?').bind(f.encObject, id).run();
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
  out_started_at: number | null;
  enc_object: string | null;
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
const ATTEMPT = /^[A-Za-z0-9_-]{16,}$/;
/** A fresh attempt name as vault/in makes it: 16 random bytes, base64url. It is recorded nowhere, so a test may invent one without calling vault/in. */
const newAttempt = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
async function vaultedFile(f: NewRow & { thumb?: boolean; withObjects?: boolean; attempt?: string } = {}) {
  const id = await insertFile({ ...f, encrypted: 1, inVault: 1, hasThumb: f.thumb ? 1 : 0, encObject: f.attempt ?? f.encObject });
  if (f.withObjects !== false) {
    const stem = f.attempt ? `vault/${id}.${f.attempt}` : `vault/${id}`;
    await put(stem, 40);
    if (f.thumb) await put(`${stem}.thumb`, 20);
  }
  return id;
}

/** What a device does after vault/in: PUTs its ciphertext (and thumbnail) at vault/<id>.<attempt>[.thumb]; `fill` tells devices' bytes apart. Returns the attempt. */
async function stage(id: string, o: { thumb?: boolean; bytes?: number; fill?: number; attempt?: string } = {}) {
  const attempt = o.attempt ?? newAttempt();
  await env.BUCKET.put(`vault/${id}.${attempt}`, new Uint8Array(o.bytes ?? 40).fill(o.fill ?? 0));
  if (o.thumb) await env.BUCKET.put(`vault/${id}.${attempt}.thumb`, new Uint8Array(20).fill(o.fill ?? 0));
  return attempt;
}

/** Calls vault/in and returns the attempt it gave with the R2 keys its addresses stand for. */
async function startIn(id: string) {
  const res = await moveIn(id);
  expect(res.status).toBe(200);
  const u = (await res.json()) as VaultMoveUrls;
  expect(u.attempt).toMatch(ATTEMPT);
  return {
    attempt: u.attempt as string,
    urls: { download: keyOf(u.downloadUrl), thumb: keyOf(u.thumbUrl), upload: keyOf(u.uploadUrl), thumbUpload: keyOf(u.thumbUploadUrl) },
  };
}

/**
 * An encrypted vault row in the middle of a move out: vault/out stamped `out_started_at` and the cron has not swept it. Since spec 4.7c
 * the two UPDATEs of vault/out/complete only apply to such a row, so tests of that route start from here.
 */
async function vaultedOut(f: NewRow & { thumb?: boolean; withObjects?: boolean } = {}) {
  const id = await vaultedFile(f);
  await env.DB.prepare('UPDATE files SET out_started_at = ? WHERE id = ?').bind(Date.now(), id).run();
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

/**
 * Moving in with one object per attempt (spec 4.7d, replaces the claim/ETag design of 4.7b and 4.7c). Pinned shapes:
 *  - `POST /files/:id/vault/in` answers `VaultMoveUrls` plus `attempt` (a fresh base64url string of at least 16 characters on every call,
 *    written nowhere) and signs the PUTs on `vault/<id>.<attempt>` and `vault/<id>.<attempt>.thumb`. It sets `in_vault = 1` at once.
 *  - `POST /files/:id/vault/in/complete` takes `{ encMeta, encKey, size, hasThumb, attempt }`. A row that is not encrypted yet needs `attempt`
 *    (a string of base64url characters, at least 16, no `.` or `/`): anything else is 400. `etag` and `claim` are ignored. It `head()`s
 *    `vault/<id>.<attempt>` and writes `encrypted = 1, enc_object = attempt` with that attempt's key and metadata.
 *  - A row that is already encrypted answers 200 and changes nothing; it deletes the attempt's own objects when the attempt is not `enc_object`.
 *    A body without `attempt` is the move-out cleanup call: it only sweeps files/<id> and thumbs/<id>.jpg.
 */
describe('POST /files/:id/vault/in', () => {
  it('signs a GET for the plain file, a PUT for vault/<id>.<attempt>, and no thumbnail addresses when there is no thumbnail', async () => {
    const id = await plainFile();
    const { attempt, urls } = await startIn(id);
    expect(urls).toEqual({
      download: `files/${id}`,
      thumb: null,
      upload: `vault/${id}.${attempt}`,
      thumbUpload: null,
    });
  });

  it('also signs the plain thumbnail and a PUT for vault/<id>.<attempt>.thumb when the file has a thumbnail', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    const { attempt, urls } = await startIn(id);
    expect(urls).toEqual({
      download: `files/${id}`,
      thumb: `thumbs/${id}.jpg`,
      upload: `vault/${id}.${attempt}`,
      thumbUpload: `vault/${id}.${attempt}.thumb`,
    });
  });

  it('works on a legacy vault item (in_vault = 1, encrypted = 0) so it can be converted', async () => {
    const id = await plainFile({ inVault: 1, kind: 'image', mime: 'image/png', thumb: true });
    const { attempt, urls } = await startIn(id);
    expect(urls).toEqual({
      download: `files/${id}`,
      thumb: `thumbs/${id}.jpg`,
      upload: `vault/${id}.${attempt}`,
      thumbUpload: `vault/${id}.${attempt}.thumb`,
    });
  });

  it('gives a link no download address, because a link has no file to encrypt, but still an attempt', async () => {
    const id = await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'example.com', size: 0 });
    const res = await moveIn(id);
    expect(res.status).toBe(200);
    const u = (await res.json()) as VaultMoveUrls;
    expect(u.downloadUrl).toBeNull();
    expect(u.thumbUrl).toBeNull();
    expect(u.attempt).toMatch(ATTEMPT);
  });

  it('keeps the preview picture of a link that has one: its thumbnail moves to vault/<id>.<attempt>.thumb (spec Q3)', async () => {
    const id = await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'example.com', size: 0, hasThumb: 1 });
    const res = await moveIn(id);
    expect(res.status).toBe(200);
    const u = (await res.json()) as VaultMoveUrls;
    expect(u.downloadUrl).toBeNull();
    expect(keyOf(u.thumbUrl)).toBe(`thumbs/${id}.jpg`);
    expect(keyOf(u.thumbUploadUrl)).toBe(`vault/${id}.${u.attempt}.thumb`);
  });

  it('gives an attempt of at least 16 base64url characters', async () => {
    const id = await plainFile();
    const { attempt } = await startIn(id);
    expect(attempt).toMatch(ATTEMPT);
  });

  it('gives a different attempt, and different upload addresses, on every call', async () => {
    const id = await plainFile({ thumb: true });
    const calls = [await startIn(id), await startIn(id), await startIn(id)];
    expect(new Set(calls.map((c) => c.attempt)).size).toBe(3);
    expect(new Set(calls.map((c) => c.urls.upload)).size).toBe(3);
    expect(new Set(calls.map((c) => c.urls.thumbUpload)).size).toBe(3);
  });

  it('answers 200 to a second call right after the first: no item_busy, no claim', async () => {
    const id = await plainFile();
    expect((await moveIn(id)).status).toBe(200);
    const second = await moveIn(id);
    expect(second.status).toBe(200);
    const body = (await second.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('claim');
    expect(body).not.toHaveProperty('error');
  });

  it('writes no state for the attempt: the second call leaves the row exactly as the first did, and the attempt is in no column', async () => {
    const id = await plainFile();
    const first = await startIn(id);
    const afterFirst = await rowOf(id);
    const second = await startIn(id);
    expect(await rowOf(id)).toEqual(afterFirst);
    expect(afterFirst).toMatchObject({ encrypted: 0, enc_object: null, enc_meta: null, enc_key: null });
    for (const attempt of [first.attempt, second.attempt]) expect(JSON.stringify(await rowOf(id))).not.toContain(attempt);
  });

  it('has no claim columns any more', async () => {
    const id = await plainFile();
    const row = (await rowOf(id)) as Record<string, unknown>;
    expect(row).not.toHaveProperty('in_claim');
    expect(row).not.toHaveProperty('in_claim_until');
  });

  it('writes no object: the plain objects stay and nothing appears under vault/', async () => {
    const id = await plainFile({ thumb: true });
    await moveIn(id);
    expect(await has(`files/${id}`)).toBe(true);
    expect(await has(`thumbs/${id}.jpg`)).toBe(true);
    expect(await vaultObjects()).toEqual([]);
  });

  it('puts a live plain item in the vault at once: in_vault = 1, still not encrypted, plain metadata untouched', async () => {
    const id = await plainFile({ name: 'holiday.png', kind: 'image', mime: 'image/png' });
    expect((await moveIn(id)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({
      in_vault: 1,
      encrypted: 0,
      enc_object: null,
      name: 'holiday.png',
      mime: 'image/png',
      kind: 'image',
      deleted_at: null,
    });
  });

  it('takes the item off the main list and shows it in the vault list, as a plain item (encrypted false, plain name, with the header)', async () => {
    const id = await plainFile({ name: 'holiday.png' });
    expect((await moveIn(id)).status).toBe(200);
    const list = async (path: string) => ((await (await callV(path)).json()) as ListFilesResponse).items;
    expect((await list('/files')).map((i) => i.id)).toEqual([]);
    const inVault = await list('/files?vault=1');
    expect(inVault.map((i) => i.id)).toEqual([id]);
    expect(inVault[0]).toMatchObject({ inVault: true, name: 'holiday.png' });
    expect(inVault[0].encrypted).toBeFalsy();
  });

  it('kills the share link of the item right away, before anything is uploaded', async () => {
    const id = await plainFile();
    await addShare(id);
    expect(await shareCount(id)).toBe(1);
    expect((await moveIn(id)).status).toBe(200);
    expect(await shareCount(id)).toBe(0);
  });

  it('keeps deleted_at of a legacy item in the vault trash', async () => {
    const deletedAt = Date.now() - 5000;
    const id = await plainFile({ inVault: 1, deletedAt });
    expect((await moveIn(id)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ in_vault: 1, encrypted: 0, deleted_at: deletedAt });
  });

  it('puts a link in the vault at once too', async () => {
    const id = await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'example.com', size: 0 });
    expect((await moveIn(id)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ in_vault: 1, encrypted: 0, kind: 'link', url: 'https://example.com/a' });
  });

  it('answers 409 already_encrypted for an item that is already encrypted, and changes nothing', async () => {
    const id = await vaultedFile();
    const before = await rowOf(id);
    const res = await moveIn(id);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('already_encrypted');
    expect(await rowOf(id)).toEqual(before);
  });

  it('answers 409 already_encrypted for an item that was encrypted by an attempt, too', async () => {
    const id = await vaultedFile({ attempt: newAttempt() });
    const res = await moveIn(id);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('already_encrypted');
  });

  it('answers 404 for an item in the normal trash, and does not put it in the vault', async () => {
    const id = await plainFile({ deletedAt: Date.now() - 1000 });
    expect((await moveIn(id)).status).toBe(404);
    expect(await rowOf(id)).toMatchObject({ in_vault: 0, encrypted: 0 });
  });
});

describe('POST /files/:id/vault/in/complete', () => {
  it('answers 409 not_uploaded before vault/<id>.<attempt> exists, and changes nothing', async () => {
    const id = await plainFile({ thumb: true });
    const res = await completeIn(id, inBody({ attempt: newAttempt() }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('not_uploaded');
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, name: 'a.bin', enc_meta: null, enc_key: null, enc_object: null });
    expect(await has(`files/${id}`)).toBe(true);
    expect(await has(`thumbs/${id}.jpg`)).toBe(true);
  });

  it('does not accept size 0 for a file that has no vault object', async () => {
    const id = await plainFile();
    const res = await completeIn(id, inBody({ size: 0, attempt: newAttempt() }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('not_uploaded');
    expect((await rowOf(id))?.encrypted).toBe(0);
  });

  it('does not complete from an object that is only at a plain key', async () => {
    const id = await insertFile();
    await put(`files/${id}`, 40);
    const res = await completeIn(id, inBody({ attempt: newAttempt() }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('not_uploaded');
  });

  it('does not complete from the fixed key vault/<id>, nor from another attempt: it looks only at its own attempt', async () => {
    const id = await plainFile();
    await put(`vault/${id}`, 40);
    const other = await stage(id);
    const res = await completeIn(id, inBody({ attempt: newAttempt() }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('not_uploaded');
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, enc_object: null });
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.${other}`]);
  });

  it('answers 409 size_mismatch when the size differs from the object, deletes that attempt\'s objects, and keeps the plain copy', async () => {
    const id = await plainFile({ thumb: true });
    const attempt = await stage(id, { bytes: 41, thumb: true });
    const res = await completeIn(id, inBody({ size: 40, hasThumb: true, attempt }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('size_mismatch');
    expect(await vaultObjects()).toEqual([]);
    expect(await has(`files/${id}`)).toBe(true);
    expect(await has(`thumbs/${id}.jpg`)).toBe(true);
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, name: 'a.bin', enc_meta: null, enc_key: null, enc_object: null, has_thumb: 1 });
  });

  it('on size_mismatch leaves the objects of another attempt alone', async () => {
    const id = await plainFile();
    const other = await stage(id, { thumb: true });
    const bad = await stage(id, { bytes: 41 });
    expect((await completeIn(id, inBody({ size: 40, attempt: bad }))).status).toBe(409);
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}.${other}`, `vault/${id}.${other}.thumb`]);
  });

  it('turns the row into an encrypted vault item with no plaintext metadata, remembers the attempt, and stores the ciphertext size', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', name: 'holiday.png', size: 4, thumb: true });
    const attempt = await stage(id, { thumb: true });
    const res = await completeIn(id, inBody({ hasThumb: true, attempt }));
    expect(res.status).toBe(200);
    const row = await rowOf(id);
    expect(row).toMatchObject({
      encrypted: 1,
      in_vault: 1,
      enc_object: attempt,
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

  it('returns the item as an encrypted one, with its thumbnail on the attempt\'s key', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    const attempt = await stage(id, { thumb: true });
    const item = (await (await completeIn(id, inBody({ hasThumb: true, attempt }))).json()) as FileItem;
    expect(item).toMatchObject({ id, encrypted: true, inVault: true, encMeta: ENC_META, encKey: ENC_KEY, name: '', kind: 'file', mime: 'application/octet-stream', size: 40, url: null });
    expect(keyOf(item.thumbUrl)).toBe(`vault/${id}.${attempt}.thumb`);
  });

  it('deletes files/<id> and thumbs/<id>.jpg but keeps the attempt\'s objects', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    const attempt = await stage(id, { thumb: true });
    expect((await completeIn(id, inBody({ hasThumb: true, attempt }))).status).toBe(200);
    expect(await has(`files/${id}`)).toBe(false);
    expect(await has(`thumbs/${id}.jpg`)).toBe(false);
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}.${attempt}`, `vault/${id}.${attempt}.thumb`]);
  });

  it('does not touch the objects of other attempts (an abandoned one is left to the cron)', async () => {
    const id = await plainFile();
    const abandoned = await stage(id, { thumb: true });
    const attempt = await stage(id);
    expect((await completeIn(id, inBody({ attempt }))).status).toBe(200);
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}.${abandoned}`, `vault/${id}.${abandoned}.thumb`, `vault/${id}.${attempt}`]);
  });

  it('kills the share link of the file', async () => {
    const id = await plainFile();
    await addShare(id);
    expect(await shareCount(id)).toBe(1);
    const attempt = await stage(id);
    expect((await completeIn(id, inBody({ attempt }))).status).toBe(200);
    expect(await shareCount(id)).toBe(0);
  });

  it('moves the item from the main list to the vault list', async () => {
    const id = await plainFile();
    const attempt = await stage(id);
    await completeIn(id, inBody({ attempt }));
    const ids = async (path: string) => ((await (await callV(path)).json()) as ListFilesResponse).items.map((i) => i.id);
    expect(await ids('/files')).toEqual([]);
    expect(await ids('/files?vault=1')).toEqual([id]);
  });

  it('records no thumbnail when hasThumb is false, even if the plain file had one', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    const attempt = await stage(id);
    await completeIn(id, inBody({ hasThumb: false, attempt }));
    expect((await rowOf(id))?.has_thumb).toBe(0);
    expect(await has(`thumbs/${id}.jpg`)).toBe(false);
  });

  it('records no thumbnail when hasThumb is true but the attempt\'s thumbnail was never uploaded', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    const attempt = await stage(id);
    const item = (await (await completeIn(id, inBody({ hasThumb: true, attempt }))).json()) as FileItem;
    expect((await rowOf(id))?.has_thumb).toBe(0);
    expect(item.thumbUrl).toBeNull();
  });

  it('does not take a thumbnail from another attempt', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    await stage(id, { thumb: true });
    const attempt = await stage(id);
    await completeIn(id, inBody({ hasThumb: true, attempt }));
    expect((await rowOf(id))?.has_thumb).toBe(0);
  });

  it('converts a legacy vault item and leaves it in the vault', async () => {
    const id = await plainFile({ inVault: 1, name: 'old.txt' });
    const attempt = await stage(id);
    expect((await completeIn(id, inBody({ attempt }))).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, name: '', enc_meta: ENC_META, enc_object: attempt });
    expect(await has(`files/${id}`)).toBe(false);
  });

  it('finishes an item that vault/in already put in the vault (in_vault = 1, encrypted = 0)', async () => {
    const id = await plainFile({ thumb: true });
    const { attempt, urls } = await startIn(id);
    expect(urls.upload).toBe(`vault/${id}.${attempt}`);
    await stage(id, { attempt, thumb: true });
    const res = await completeIn(id, inBody({ hasThumb: true, attempt }));
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, enc_object: attempt, has_thumb: 1 });
  });

  it('moves a link in without any upload: size 0 is accepted, the attempt is remembered, and no file object is required', async () => {
    const id = await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'Example', size: 0 });
    await env.DB.prepare('UPDATE files SET previewed_at = 5, icon_url = ? WHERE id = ?').bind('https://example.com/i.png', id).run();
    const attempt = newAttempt();
    const res = await completeIn(id, inBody({ size: 0, attempt }));
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({
      encrypted: 1,
      in_vault: 1,
      enc_object: attempt,
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

  it('moves a link with a preview picture in, keeping the picture encrypted on the attempt\'s thumb key and removing the plain one (spec Q3)', async () => {
    const id = await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'Example', size: 0, hasThumb: 1 });
    await put(`thumbs/${id}.jpg`, 7);
    const attempt = newAttempt();
    await put(`vault/${id}.${attempt}.thumb`, 39);
    const res = await completeIn(id, inBody({ size: 0, hasThumb: true, attempt }));
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, kind: 'file', url: null, size: 0, has_thumb: 1, enc_object: attempt });
    expect(await has(`thumbs/${id}.jpg`)).toBe(false);
    expect(await vaultObjects()).toEqual([`vault/${id}.${attempt}.thumb`]);
    expect(keyOf(((await res.json()) as FileItem).thumbUrl)).toBe(`vault/${id}.${attempt}.thumb`);
  });

  it('asks a link for an attempt too: answers 400 without one and changes nothing', async () => {
    const id = await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'Example', size: 0 });
    const res = await completeIn(id, inBody({ size: 0 }));
    expect(res.status).toBe(400);
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, kind: 'link', in_vault: 0, enc_object: null });
  });

  it('is idempotent for the same attempt: a retry after success answers 200 and deletes nothing from the live object', async () => {
    const id = await plainFile({ thumb: true });
    const attempt = await stage(id, { thumb: true });
    expect((await completeIn(id, inBody({ hasThumb: true, attempt }))).status).toBe(200);
    const again = await completeIn(id, inBody({ hasThumb: true, attempt }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as FileItem).encrypted).toBe(true);
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}.${attempt}`, `vault/${id}.${attempt}.thumb`]);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, enc_meta: ENC_META, enc_object: attempt, size: 40, has_thumb: 1 });
  });

  it('is idempotent for a row that was uploaded straight into the vault: its fixed-key object stays', async () => {
    const id = await vaultedFile({ thumb: true });
    const res = await completeIn(id, inBody({ hasThumb: true }));
    expect(res.status).toBe(200);
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
    expect((await rowOf(id))?.enc_object).toBeNull();
  });

  it('ignores etag and claim in the body: they neither help nor hurt', async () => {
    const id = await plainFile();
    const attempt = await stage(id);
    const res = await completeIn(id, { ...inBody({ attempt }), etag: 'whatever', claim: 'whatever-too' });
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, enc_object: attempt, enc_key: ENC_KEY });
  });

  it('needs no etag and no claim: a body of the five fields is enough', async () => {
    const id = await plainFile();
    const attempt = await stage(id);
    const body = inBody({ attempt });
    expect(Object.keys(body).sort()).toEqual(['attempt', 'encKey', 'encMeta', 'hasThumb', 'size']);
    expect((await completeIn(id, body)).status).toBe(200);
  });

  it('answers 404 for a row in the normal trash, and changes nothing', async () => {
    const id = await plainFile({ deletedAt: Date.now() - 1000 });
    const attempt = await stage(id);
    const before = await rowOf(id);
    expect((await completeIn(id, inBody({ attempt }))).status).toBe(404);
    expect(await rowOf(id)).toEqual(before);
    expect(await has(`files/${id}`)).toBe(true);
  });

  describe('the move-out cleanup call (an already encrypted row, a body without attempt)', () => {
    it('answers 200 and sweeps files/<id> and thumbs/<id>.jpg that an interrupted move out left, keeping the live object', async () => {
      const attempt = newAttempt();
      const id = await vaultedFile({ thumb: true, attempt });
      await put(`files/${id}`, 4);
      await put(`thumbs/${id}.jpg`, 3);
      const res = await completeIn(id, inBody({ hasThumb: true }));
      expect(res.status).toBe(200);
      expect(await has(`files/${id}`)).toBe(false);
      expect(await has(`thumbs/${id}.jpg`)).toBe(false);
      expect((await vaultObjects()).sort()).toEqual([`vault/${id}.${attempt}`, `vault/${id}.${attempt}.thumb`]);
      expect(await rowOf(id)).toMatchObject({ encrypted: 1, enc_key: 'S0VZ', enc_object: attempt });
    });

    it('does the same for a row uploaded straight into the vault (enc_object NULL)', async () => {
      const id = await vaultedFile({ thumb: true });
      await put(`files/${id}`, 4);
      await put(`thumbs/${id}.jpg`, 3);
      expect((await completeIn(id, inBody({ hasThumb: true }))).status).toBe(200);
      expect(await has(`files/${id}`)).toBe(false);
      expect(await has(`thumbs/${id}.jpg`)).toBe(false);
      expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
    });
  });

  describe('invalid body: answers 400 and changes nothing', () => {
    const attempt = 'AAAAAAAAAAAAAAAAAAAAAA';
    const bad: [string, unknown][] = [
      ['missing encMeta', { encKey: ENC_KEY, size: 40, hasThumb: false, attempt }],
      ['missing encKey', { encMeta: ENC_META, size: 40, hasThumb: false, attempt }],
      ['empty encMeta', inBody({ encMeta: '', attempt })],
      ['encMeta that is not a string', { ...inBody({ attempt }), encMeta: 5 }],
      ['encKey that is not a string', { ...inBody({ attempt }), encKey: ['x'] }],
      ['encMeta over 8192 characters', inBody({ encMeta: 'A'.repeat(8193), attempt })],
      ['encKey over 512 characters', inBody({ encKey: 'A'.repeat(513), attempt })],
      ['missing size', { encMeta: ENC_META, encKey: ENC_KEY, hasThumb: false, attempt }],
      ['non-integer size', inBody({ size: 40.5, attempt })],
      ['negative size', inBody({ size: -1, attempt })],
      ['size as a string', { ...inBody({ attempt }), size: '40' }],
      ['missing attempt', inBody()],
      ['empty attempt', inBody({ attempt: '' })],
      ['attempt that is not a string', { ...inBody(), attempt: 5 }],
      ['null attempt', { ...inBody(), attempt: null }],
      ['attempt shorter than 16 characters', inBody({ attempt: 'abcdefghijklmno' })],
      ['attempt with a slash (it must not reach another key)', inBody({ attempt: 'AAAAAAAA/AAAAAAAAAAAAA' })],
      ['attempt with a dot (it would collide with the .thumb suffix)', inBody({ attempt: 'AAAAAAAAAAAAAAAA.thumb' })],
      ['attempt with a path climb', inBody({ attempt: '../../files/AAAAAAAAAAAA' })],
      ['attempt with a space', inBody({ attempt: 'AAAAAAAA AAAAAAAAAAAAA' })],
    ];
    for (const [label, body] of bad) {
      it(label, async () => {
        const id = await plainFile();
        await put(`vault/${id}.${attempt}`, 40);
        const res = await completeIn(id, body);
        expect(res.status).toBe(400);
        expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, name: 'a.bin', enc_meta: null, enc_object: null });
        expect(await has(`files/${id}`)).toBe(true);
        expect(await has(`vault/${id}.${attempt}`)).toBe(true);
      });
    }

    it('a body that is not JSON', async () => {
      const id = await plainFile();
      await put(`vault/${id}.${attempt}`, 40);
      const res = await callV(`/files/${id}/vault/in/complete`, { method: 'POST', body: 'not json', headers: JSON_HEADERS });
      expect(res.status).toBe(400);
      expect((await rowOf(id))?.encrypted).toBe(0);
    });
  });

  it('accepts encMeta of exactly 8192 characters and encKey of exactly 512', async () => {
    const id = await plainFile();
    const attempt = await stage(id);
    const res = await completeIn(id, inBody({ encMeta: 'A'.repeat(8192), encKey: 'B'.repeat(512), attempt }));
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1 });
  });
});

describe('two devices moving the same file in: every attempt has its own object (spec 4.7d)', () => {
  /** What a device does: vault/in, then PUT its own ciphertext (`fill` marks whose bytes they are) at the address it was given. */
  async function device(id: string, fill: number, over: { thumb?: boolean; encKey: string; encMeta: string }) {
    const { attempt, urls } = await startIn(id);
    expect(urls.upload).toBe(`vault/${id}.${attempt}`);
    await stage(id, { attempt, fill, thumb: over.thumb });
    const complete = () => completeIn(id, inBody({ attempt, encKey: over.encKey, encMeta: over.encMeta, hasThumb: over.thumb === true }));
    return { attempt, complete };
  }
  const A = { encKey: 'QUtFWS1B', encMeta: 'TUVUQS1B' };
  const B = { encKey: 'QktFWS1C', encMeta: 'TUVUQS1C' };
  const bytesOf = async (key: string) => new Uint8Array(await (await env.BUCKET.get(key))!.arrayBuffer());

  it('both get an attempt and an upload address of their own: no item_busy for the second', async () => {
    const id = await plainFile();
    const a = await startIn(id);
    const b = await startIn(id);
    expect(a.attempt).not.toBe(b.attempt);
    expect(a.urls.upload).not.toBe(b.urls.upload);
  });

  it('A completes first, then B: both get 200, the row keeps A\'s key, meta and object, and B\'s objects are deleted', async () => {
    const id = await plainFile({ thumb: true });
    const a = await device(id, 1, { ...A, thumb: true });
    const b = await device(id, 2, { ...B, thumb: true });

    expect((await a.complete()).status).toBe(200);
    const late = await b.complete();
    expect(late.status).toBe(200);
    expect(((await late.json()) as FileItem).encrypted).toBe(true);

    expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, enc_key: A.encKey, enc_meta: A.encMeta, enc_object: a.attempt });
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}.${a.attempt}`, `vault/${id}.${a.attempt}.thumb`]);
    expect(await has(`vault/${id}.${b.attempt}`)).toBe(false);
    expect(await has(`vault/${id}.${b.attempt}.thumb`)).toBe(false);
  });

  it('A completes first, then B: the stored object of the row is A\'s bytes, so A\'s key decrypts it (same size, different bytes)', async () => {
    const id = await plainFile();
    const a = await device(id, 1, A);
    const b = await device(id, 2, B);
    await a.complete();
    await b.complete();

    const row = (await rowOf(id))!;
    const bytes = await bytesOf(`vault/${id}.${row.enc_object}`);
    expect(row.enc_key).toBe(A.encKey);
    expect(bytes).toHaveLength(40);
    expect([...bytes].every((x) => x === 1)).toBe(true);
  });

  it('B completes first, then A: the symmetrical case, the row keeps B\'s key, meta and object, and A\'s objects are deleted', async () => {
    const id = await plainFile({ thumb: true });
    const a = await device(id, 1, { ...A, thumb: true });
    const b = await device(id, 2, { ...B, thumb: true });

    expect((await b.complete()).status).toBe(200);
    expect((await a.complete()).status).toBe(200);

    const row = (await rowOf(id))!;
    expect(row).toMatchObject({ encrypted: 1, enc_key: B.encKey, enc_meta: B.encMeta, enc_object: b.attempt });
    expect([...(await bytesOf(`vault/${id}.${row.enc_object}`))].every((x) => x === 2)).toBe(true);
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}.${b.attempt}`, `vault/${id}.${b.attempt}.thumb`]);
  });

  it('the loser changes nothing else: plain objects are gone once, the size and thumbnail flag are the winner\'s', async () => {
    const id = await plainFile({ thumb: true });
    const a = await device(id, 1, { ...A, thumb: true });
    const b = await device(id, 2, B); // B has no thumbnail
    await a.complete();
    const before = await rowOf(id);
    await b.complete();
    expect(await rowOf(id)).toEqual(before);
    expect(before).toMatchObject({ has_thumb: 1, size: 40 });
  });

  it('a retry by the winner after the loser finished is still 200 and keeps the live object', async () => {
    const id = await plainFile();
    const a = await device(id, 1, A);
    const b = await device(id, 2, B);
    await a.complete();
    await b.complete();
    expect((await a.complete()).status).toBe(200);
    expect(await vaultObjects()).toEqual([`vault/${id}.${a.attempt}`]);
    expect(await rowOf(id)).toMatchObject({ enc_key: A.encKey, enc_object: a.attempt });
  });

  it('a retry by the loser is 200 too, although its objects are gone already', async () => {
    const id = await plainFile();
    const a = await device(id, 1, A);
    const b = await device(id, 2, B);
    await a.complete();
    await b.complete();
    expect((await b.complete()).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ enc_key: A.encKey, enc_object: a.attempt });
  });

  it('a row uploaded straight into the vault (enc_object NULL) is not changed by a late attempt, whose objects are deleted', async () => {
    const id = await vaultedFile({ thumb: true });
    const attempt = await stage(id, { thumb: true });
    const res = await completeIn(id, inBody({ attempt, encKey: B.encKey, encMeta: B.encMeta, hasThumb: true }));
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ enc_key: 'S0VZ', enc_meta: 'TUVUQQ==', enc_object: null });
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
  });

  describe('an attempt that never completes blocks nothing', () => {
    it('leaves the row in the vault, not encrypted, with no attempt recorded', async () => {
      const id = await plainFile();
      await startIn(id);
      expect(await rowOf(id)).toMatchObject({ in_vault: 1, encrypted: 0, enc_object: null });
    });

    it('a later vault/in and complete works as normal, and the abandoned objects stay for the cron', async () => {
      const id = await plainFile({ thumb: true });
      const abandoned = await startIn(id);
      await stage(id, { attempt: abandoned.attempt, fill: 9, thumb: true });

      const later = await startIn(id);
      expect(later.attempt).not.toBe(abandoned.attempt);
      await stage(id, { attempt: later.attempt, fill: 1, thumb: true });
      const res = await completeIn(id, inBody({ attempt: later.attempt, hasThumb: true }));
      expect(res.status).toBe(200);

      expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, enc_object: later.attempt, has_thumb: 1 });
      expect(await has(`vault/${id}.${later.attempt}`)).toBe(true);
      expect(await has(`vault/${id}.${abandoned.attempt}`)).toBe(true);
    });

    it('the abandoned attempt can still complete if it is the first to do so', async () => {
      const id = await plainFile();
      const first = await device(id, 1, A);
      await startIn(id); // a second vault/in that nobody uses
      expect((await first.complete()).status).toBe(200);
      expect(await rowOf(id)).toMatchObject({ encrypted: 1, enc_object: first.attempt });
    });
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

  it('stamps out_started_at with the current time, so the cron can find leftovers of an interrupted move', async () => {
    const id = await vaultedFile();
    const before = Date.now();
    expect((await moveOut(id)).status).toBe(200);
    const stamped = (await rowOf(id))!.out_started_at;
    expect(stamped).not.toBeNull();
    expect(stamped!).toBeGreaterThanOrEqual(before);
    expect(stamped!).toBeLessThanOrEqual(Date.now());
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1 });
  });

  it('does not stamp out_started_at when it refuses (the item is not encrypted)', async () => {
    const id = await plainFile();
    expect((await moveOut(id)).status).toBe(409);
    expect((await rowOf(id))!.out_started_at).toBeNull();
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
      const id = await vaultedOut({ thumb: true });
      const res = await completeOut(id, outBody());
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('not_uploaded');
      expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, enc_meta: 'TUVUQQ==', name: '' });
      expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
    });

    it('answers 409 size_mismatch, deletes only files/<id> and thumbs/<id>.jpg, and keeps the encrypted item intact', async () => {
      const id = await vaultedOut({ thumb: true });
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
      const id = await vaultedOut({ thumb: true });
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

    it('clears out_started_at: the move is finished, nothing is left to sweep', async () => {
      const id = await vaultedFile();
      expect((await moveOut(id)).status).toBe(200);
      expect((await rowOf(id))!.out_started_at).not.toBeNull();
      await put(`files/${id}`, 10);
      expect((await completeOut(id, outBody())).status).toBe(200);
      expect((await rowOf(id))!.out_started_at).toBeNull();
    });

    it('deletes vault/<id> and vault/<id>.thumb and keeps the plain objects', async () => {
      const id = await vaultedOut({ thumb: true });
      await put(`files/${id}`, 10);
      await put(`thumbs/${id}.jpg`, 3);
      await completeOut(id, outBody({ mime: 'image/png', hasThumb: true }));
      expect(await vaultObjects()).toEqual([]);
      expect(await has(`files/${id}`)).toBe(true);
      expect(await has(`thumbs/${id}.jpg`)).toBe(true);
    });

    it('shows the item in the main list again and not in the vault list', async () => {
      const id = await vaultedOut();
      await put(`files/${id}`, 10);
      await completeOut(id, outBody());
      const ids = async (path: string) => ((await (await callV(path)).json()) as ListFilesResponse).items.map((i) => i.id);
      expect(await ids('/files')).toEqual([id]);
      expect(await ids('/files?vault=1')).toEqual([]);
    });

    it('sanitises the name like an upload does: no directory parts, no control characters', async () => {
      const id = await vaultedOut();
      await put(`files/${id}`, 10);
      await completeOut(id, outBody({ name: '../../etc/pass\u0000wd.txt' }));
      expect((await rowOf(id))?.name).toBe('passwd.txt');
    });

    it('cleans the mime like an upload does: lower-cased, and an invalid one becomes application/octet-stream', async () => {
      const a = await vaultedOut();
      await put(`files/${a}`, 10);
      await completeOut(a, outBody({ mime: 'Application/PDF' }));
      expect(await rowOf(a)).toMatchObject({ mime: 'application/pdf', kind: 'file' });

      const b = await vaultedOut();
      await put(`files/${b}`, 10);
      await completeOut(b, outBody({ mime: 'not a mime' }));
      expect(await rowOf(b)).toMatchObject({ mime: 'application/octet-stream', kind: 'file' });
    });

    it('takes the kind from the mime, not from anything stored', async () => {
      const id = await vaultedOut();
      await put(`files/${id}`, 10);
      await completeOut(id, outBody({ mime: 'image/jpeg' }));
      expect((await rowOf(id))?.kind).toBe('image');
    });

    it('records no thumbnail when hasThumb is true but thumbs/<id>.jpg was never uploaded', async () => {
      const id = await vaultedOut({ thumb: true });
      await put(`files/${id}`, 10);
      await completeOut(id, outBody({ mime: 'image/png', hasThumb: true }));
      expect((await rowOf(id))?.has_thumb).toBe(0);
    });

    it('is idempotent: a second complete answers 200 and keeps the plain file', async () => {
      const id = await vaultedOut();
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
          const id = await vaultedOut();
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
    const encryptedLink = () => vaultedOut({ withObjects: false, size: 0 });
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

    it('clears out_started_at too', async () => {
      const id = await vaultedFile({ withObjects: false, size: 0 });
      expect((await moveOut(id)).status).toBe(200);
      expect((await rowOf(id))!.out_started_at).not.toBeNull();
      expect((await completeOut(id, linkBody())).status).toBe(200);
      expect((await rowOf(id))!.out_started_at).toBeNull();
    });

    it('uses the host as the name when there is no title', async () => {
      const id = await encryptedLink();
      await completeOut(id, linkBody({ url: 'https://Example.com/a', title: null }));
      expect((await rowOf(id))?.name).toBe('example.com');
    });

    it('deletes the vault objects it had', async () => {
      const id = await vaultedOut({ thumb: true, size: 0 });
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
        const id = await vaultedOut({ size: 0 });
        const res = await completeOut(id, linkBody({ url }));
        expect(res.status, url).toBe(400);
        expect(await errorCode(res), url).toBe('bad_url');
        expect(await rowOf(id), url).toMatchObject({ encrypted: 1, in_vault: 1, enc_meta: 'TUVUQQ==', url: null });
        expect(await has(`vault/${id}`), url).toBe(true);
      }
    });

    it('answers 409 duplicate_url when another live link has the same address, and keeps the vault item intact', async () => {
      await insertFile({ kind: 'link', url: 'https://example.com/a', name: 'example.com', size: 0 });
      const id = await vaultedOut({ thumb: true, size: 0 });
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

describe('moving out an item that an attempt encrypted: the row\'s enc_object names its objects (spec 4.7d)', () => {
  it('vault/out signs the GET on vault/<id>.<enc_object> and the thumbnail GET on its .thumb, and still the PUTs on files/<id>', async () => {
    const attempt = newAttempt();
    const id = await vaultedFile({ thumb: true, attempt });
    expect(await urlsOf(await moveOut(id))).toEqual({
      download: `vault/${id}.${attempt}`,
      thumb: `vault/${id}.${attempt}.thumb`,
      upload: `files/${id}`,
      thumbUpload: `thumbs/${id}.jpg`,
    });
  });

  it('vault/out signs the fixed vault/<id> for a row with no enc_object (uploaded straight into the vault)', async () => {
    const id = await vaultedFile({ thumb: true });
    expect(await urlsOf(await moveOut(id))).toMatchObject({ download: `vault/${id}`, thumb: `vault/${id}.thumb` });
  });

  it('vault/out stamps out_started_at as before and does not change enc_object', async () => {
    const attempt = newAttempt();
    const id = await vaultedFile({ attempt });
    expect((await moveOut(id)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, enc_object: attempt });
    expect((await rowOf(id))!.out_started_at).not.toBeNull();
  });

  it('out/complete deletes vault/<id>.<enc_object> and its thumbnail, keeps the plain objects, and the row is plain with no enc_object', async () => {
    const attempt = newAttempt();
    const id = await vaultedFile({ thumb: true, attempt });
    expect((await moveOut(id)).status).toBe(200);
    await put(`files/${id}`, 10);
    await put(`thumbs/${id}.jpg`, 3);
    const res = await completeOut(id, outBody({ mime: 'image/png', hasThumb: true }));
    expect(res.status).toBe(200);
    expect(await vaultObjects()).toEqual([]);
    expect(await has(`files/${id}`)).toBe(true);
    expect(await has(`thumbs/${id}.jpg`)).toBe(true);
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, enc_meta: null, enc_key: null, enc_object: null, out_started_at: null });
  });

  it('out/complete of an encrypted link deletes the attempt-keyed preview thumbnail too', async () => {
    const attempt = newAttempt();
    const id = await vaultedFile({ withObjects: false, size: 0, attempt });
    await put(`vault/${id}.${attempt}.thumb`, 20);
    await env.DB.prepare('UPDATE files SET has_thumb = 1, out_started_at = ? WHERE id = ?').bind(Date.now(), id).run();
    const res = await completeOut(id, outBody({ name: 'x', mime: LINK_MIME, size: 0, url: 'https://example.com/a' }));
    expect(res.status).toBe(200);
    expect(await vaultObjects()).toEqual([]);
    expect(await rowOf(id)).toMatchObject({ kind: 'link', encrypted: 0, enc_object: null });
  });

  it('out/complete that is refused (size_mismatch) leaves the attempt\'s objects and enc_object alone', async () => {
    const attempt = newAttempt();
    const id = await vaultedFile({ thumb: true, attempt });
    expect((await moveOut(id)).status).toBe(200);
    await put(`files/${id}`, 11);
    const res = await completeOut(id, outBody({ size: 10 }));
    expect(res.status).toBe(409);
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}.${attempt}`, `vault/${id}.${attempt}.thumb`]);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, enc_object: attempt, enc_key: 'S0VZ' });
  });

  it('out/complete still answers 409 item_changed once the cron released out_started_at, and keeps the attempt\'s objects', async () => {
    const attempt = newAttempt();
    const id = await vaultedFile({ attempt });
    await put(`files/${id}`, 10);
    const res = await completeOut(id, outBody());
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('item_changed');
    expect(await vaultObjects()).toEqual([`vault/${id}.${attempt}`]);
  });

  it('a whole round trip through the API: vault/in, upload, complete, then vault/out signs the attempt\'s key and out/complete removes it', async () => {
    const id = await plainFile({ kind: 'image', mime: 'image/png', thumb: true });
    const { attempt } = await startIn(id);
    await stage(id, { attempt, thumb: true });
    expect((await completeIn(id, inBody({ attempt, hasThumb: true }))).status).toBe(200);

    const out = await urlsOf(await moveOut(id));
    expect(out.download).toBe(`vault/${id}.${attempt}`);
    expect(out.thumb).toBe(`vault/${id}.${attempt}.thumb`);

    await put(`files/${id}`, 10);
    await put(`thumbs/${id}.jpg`, 3);
    expect((await completeOut(id, outBody({ mime: 'image/png', hasThumb: true }))).status).toBe(200);
    expect(await vaultObjects()).toEqual([]);
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, enc_object: null });

    // And it can go in again, with a new attempt.
    const again = await startIn(id);
    expect(again.attempt).not.toBe(attempt);
    expect(again.urls.upload).toBe(`vault/${id}.${again.attempt}`);
  });
});

describe('vault/out/complete after the cron released the row (spec 4.7c, review N3)', () => {
  it('answers 409 item_changed for a file whose out_started_at is NULL (the cron swept it), and the row stays encrypted', async () => {
    const id = await vaultedFile({ thumb: true });
    await put(`files/${id}`, 10);
    expect((await rowOf(id))!.out_started_at).toBeNull();
    const res = await completeOut(id, outBody());
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('item_changed');
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, enc_meta: 'TUVUQQ==', enc_key: 'S0VZ', name: '' });
    expect((await vaultObjects()).sort()).toEqual([`vault/${id}`, `vault/${id}.thumb`]);
  });

  it('answers 409 item_changed for a link whose out_started_at is NULL, and the row stays encrypted', async () => {
    const id = await vaultedFile({ withObjects: false, size: 0 });
    const res = await completeOut(id, outBody({ name: 'ignored', mime: LINK_MIME, size: 0, url: 'https://example.com/a' }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('item_changed');
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, kind: 'file', url: null });
  });

  it('keeps vault/<id> for a later vault/out after refusing', async () => {
    const id = await vaultedFile();
    await put(`files/${id}`, 10);
    expect((await completeOut(id, outBody())).status).toBe(409);
    expect((await moveOut(id)).status).toBe(200);
    await put(`files/${id}`, 10);
    expect((await completeOut(id, outBody())).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, out_started_at: null });
  });

  it('works as before when out_started_at is set, by vault/out itself', async () => {
    const id = await vaultedFile();
    expect((await moveOut(id)).status).toBe(200);
    await put(`files/${id}`, 10);
    const res = await completeOut(id, outBody());
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 0, in_vault: 0, out_started_at: null });
  });
});

describe('a legacy item in the vault trash', () => {
  // Deleted in the vault before encryption was set up: it sits in the vault trash in plain form and must be encrypted too.
  it('can be moved in, stays in the vault trash, and loses its plain objects', async () => {
    const deletedAt = Date.now() - 1000;
    const id = await plainFile({ inVault: 1, deletedAt, thumb: true });
    const { attempt } = await startIn(id);
    expect(await rowOf(id)).toMatchObject({ in_vault: 1, deleted_at: deletedAt, encrypted: 0 });
    await stage(id, { attempt, thumb: true });
    const res = await completeIn(id, inBody({ size: 40, hasThumb: true, attempt }));
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ encrypted: 1, in_vault: 1, deleted_at: deletedAt, name: '', enc_object: attempt });
    expect(await has(`files/${id}`)).toBe(false);
    expect(await has(`thumbs/${id}.jpg`)).toBe(false);
  });

  it('is not moved out while it is in the trash (restore it first)', async () => {
    const id = await vaultedFile({ deletedAt: Date.now() });
    expect((await moveOut(id)).status).toBe(404);
  });
});

describe('guards on all four routes', () => {
  /** The attempt each vault/in/complete row was staged with. */
  const attempts = new Map<string, string>();
  /** Each route with a row it would accept and a body that would otherwise be valid. */
  const routes: { name: string; call: (id: string) => Response | Promise<Response>; make: (f?: NewRow) => Promise<string> }[] = [
    { name: 'vault/in', call: moveIn, make: (f) => plainFile(f) },
    { name: 'vault/in/complete', call: (id) => completeIn(id, inBody({ attempt: attempts.get(id) })), make: async (f) => {
      const id = await plainFile(f);
      attempts.set(id, await stage(id));
      return id;
    } },
    { name: 'vault/out', call: moveOut, make: (f) => vaultedFile(f) },
    { name: 'vault/out/complete', call: (id) => completeOut(id, outBody()), make: async (f) => {
      const id = await vaultedOut(f);
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
