import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_FILE_SIZE,
  VAULT_HEADER,
  VAULT_PROTOCOL_VERSION,
  vaultCiphertextSize,
  type CreateUploadResponse,
  type FileItem,
  type ListFilesResponse,
} from '@fatup/shared';
import { createApp } from '../src/app';
import { ulid } from '../src/ulid';

type GetOpts = { filename?: string; contentType?: string };
const signedGets: { key: string; opts?: GetOpts }[] = [];

const fakePresigner = () => ({
  put: async (key: string) => `https://r2.test/put/${key}`,
  get: async (key: string, opts?: GetOpts) => {
    signedGets.push({ key, opts });
    return `https://r2.test/get/${key}${opts?.filename ? `?name=${encodeURIComponent(opts.filename)}` : ''}`;
  },
});

const app = createApp({ presigner: fakePresigner });
const AUTH = { Authorization: 'Bearer test-token' };
const VAULT = { [VAULT_HEADER]: VAULT_PROTOCOL_VERSION };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** A request as an old app sends it: no vault header. */
function call(path: string, init: RequestInit = {}) {
  return app.request(path, { ...init, headers: { ...AUTH, ...(init.headers ?? {}) } }, env);
}

/** A request as a vault-aware app sends it. Used wherever the header is not what is being tested. */
function callV(path: string, init: RequestInit = {}) {
  return call(path, { ...init, headers: { ...VAULT, ...(init.headers ?? {}) } });
}

const sendJson = (method: string, path: string, body: unknown, withHeader = true) =>
  (withHeader ? callV : call)(path, { method, body: JSON.stringify(body), headers: JSON_HEADERS });

const postJson = (path: string, body: unknown) => sendJson('POST', path, body);
const patchJson = (path: string, body: unknown) => sendJson('PATCH', path, body);
const setInVault = (id: string, inVault: boolean, withHeader = false) => sendJson('PUT', `/files/${id}/vault`, { inVault }, withHeader);
const del = (id: string) => call(`/files/${id}`, { method: 'DELETE' });
const restore = (id: string) => call(`/files/${id}/restore`, { method: 'POST' });

const listIds = async (path: string, withHeader = false) => {
  const res = await (withHeader ? callV : call)(path);
  expect(res.status).toBe(200);
  return ((await res.json()) as ListFilesResponse).items.map((i) => i.id);
};

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
  kind?: 'image' | 'file' | 'link';
  url?: string | null;
  hasThumb?: 0 | 1;
  encMeta?: string | null;
  encKey?: string | null;
  /** The attempt that encrypted the row; its objects are vault/<id>.<attempt>[.thumb]. NULL = the fixed key vault/<id>. */
  encObject?: string | null;
};

/** Inserts a finished file row straight into D1, bypassing the upload flow. */
async function insertFile(f: NewRow = {}) {
  const id = ulid();
  const encrypted = f.encrypted ?? 0;
  await env.DB.prepare(
    `INSERT INTO files (id, name, mime, size, kind, has_thumb, status, created_at, deleted_at, in_vault, encrypted, enc_meta, enc_key, url)
     VALUES (?, ?, 'application/octet-stream', 4, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      f.name ?? (encrypted ? '' : 'a.bin'),
      f.kind ?? 'file',
      f.hasThumb ?? 0,
      Date.now(),
      f.deletedAt ?? null,
      f.inVault ?? 0,
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
  kind: string;
  url: string | null;
  deleted_at: number | null;
  in_vault: number;
  encrypted: number;
  enc_meta: string | null;
  enc_key: string | null;
  tags: string;
  important: number;
  has_thumb: number;
  enc_object: string | null;
};
const rowOf = (id: string) => env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first<DbRow>();

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

const ENC_META = 'ZW5jcnlwdGVkLW1ldGE=';
const ENC_KEY = 'd3JhcHBlZC1maWxlLWtleQ==';

beforeEach(async () => {
  signedGets.length = 0;
  await env.DB.prepare('DELETE FROM vault_keys').run();
  await env.DB.prepare('DELETE FROM shares').run();
  await env.DB.prepare('DELETE FROM files').run();
  const { objects } = await env.BUCKET.list();
  if (objects.length) await env.BUCKET.delete(objects.map((o) => o.key));
});

describe('the Vault trash (DELETE keeps in_vault)', () => {
  for (const state of ['none', 'ready'] as const) {
    describe(`when the vault is ${state}`, () => {
      beforeEach(() => setState(state));

      it('keeps in_vault = 1 and sets deleted_at when a vault item is deleted', async () => {
        const id = await insertFile({ inVault: 1 });
        expect((await del(id)).status).toBe(204);
        const row = await rowOf(id);
        expect(row?.deleted_at).not.toBeNull();
        expect(row?.in_vault).toBe(1);
      });

      it('keeps a deleted vault item out of the normal trash', async () => {
        const vaulted = await insertFile({ inVault: 1 });
        const plain = await insertFile();
        await del(vaulted);
        await del(plain);
        expect(await listIds('/files?trash=1')).toEqual([plain]);
      });

      it('lists a deleted vault item in the vault trash, newest deletion first, without the normal trash items', async () => {
        const first = await insertFile({ inVault: 1 });
        const second = await insertFile({ inVault: 1 });
        const third = await insertFile({ inVault: 1 });
        const plain = await insertFile();
        for (const id of [first, second, third, plain]) await del(id);
        const at = (id: string, t: number) => env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').bind(t, id).run();
        await at(second, 3_000_000);
        await at(first, 2_000_000);
        await at(third, 1_000_000);
        await at(plain, 9_000_000);
        expect(await listIds('/files?vault=1&trash=1', true)).toEqual([second, first, third]);
        // A deleted vault item is not in the live vault list either.
        expect(await listIds('/files?vault=1', true)).toEqual([]);
      });

      it('restores a deleted vault item back into the vault', async () => {
        const id = await insertFile({ inVault: 1 });
        await del(id);
        expect((await restore(id)).status).toBe(200);
        const row = await rowOf(id);
        expect(row?.deleted_at).toBeNull();
        expect(row?.in_vault).toBe(1);
        expect(await listIds('/files?vault=1', true)).toEqual([id]);
        expect(await listIds('/files')).toEqual([]);
        expect(await listIds('/files?vault=1&trash=1', true)).toEqual([]);
      });
    });
  }

  it('keeps an encrypted item encrypted and in the vault through delete and restore', async () => {
    await setState('ready');
    const id = await insertFile({ inVault: 1, encrypted: 1 });
    await del(id);
    expect(await listIds('/files?vault=1&trash=1', true)).toEqual([id]);
    await restore(id);
    const row = await rowOf(id);
    expect([row?.in_vault, row?.encrypted, row?.deleted_at]).toEqual([1, 1, null]);
  });

  it('still sends a normal file to the normal trash with in_vault = 0', async () => {
    await setState('ready');
    const id = await insertFile();
    await del(id);
    expect((await rowOf(id))?.in_vault).toBe(0);
    expect(await listIds('/files?trash=1')).toEqual([id]);
    expect(await listIds('/files?vault=1&trash=1', true)).toEqual([]);
    await restore(id);
    expect(await listIds('/files')).toEqual([id]);
  });
});

describe('legacy vault endpoints before the vault exists (state none)', () => {
  beforeEach(() => setState('none'));

  it('moves a file into and out of the vault as before, without any header', async () => {
    const id = await insertFile();
    const res = await setInVault(id, true);
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileItem).inVault).toBe(true);
    expect((await rowOf(id))?.in_vault).toBe(1);
    expect((await setInVault(id, false)).status).toBe(200);
    expect((await rowOf(id))?.in_vault).toBe(0);
  });

  it('lists the vault without the header', async () => {
    const id = await insertFile({ inVault: 1 });
    expect(await listIds('/files?vault=1')).toEqual([id]);
  });
});

describe('legacy vault endpoints once the vault is set up', () => {
  for (const state of ['ready', 'wiped'] as const) {
    describe(`state ${state}`, () => {
      beforeEach(() => setState(state));

      it('answers 426 app_outdated to PUT /files/:id/vault (in) and leaves the row alone', async () => {
        const id = await insertFile();
        const res = await setInVault(id, true);
        expect(res.status).toBe(426);
        expect(await errorCode(res)).toBe('app_outdated');
        expect((await rowOf(id))?.in_vault).toBe(0);
      });

      it('answers 426 app_outdated to PUT /files/:id/vault (out) and leaves the row alone', async () => {
        const id = await insertFile({ inVault: 1 });
        const res = await setInVault(id, false);
        expect(res.status).toBe(426);
        expect(await errorCode(res)).toBe('app_outdated');
        expect((await rowOf(id))?.in_vault).toBe(1);
      });

      it('answers 426 app_outdated to GET /files?vault=1 without the header', async () => {
        await insertFile({ inVault: 1 });
        const res = await call('/files?vault=1');
        expect(res.status).toBe(426);
        expect(await errorCode(res)).toBe('app_outdated');
        expect((await call('/files?vault=1&trash=1')).status).toBe(426);
      });

      it('serves GET /files?vault=1 when the header is sent', async () => {
        const id = await insertFile({ inVault: 1 });
        expect(await listIds('/files?vault=1', true)).toEqual([id]);
      });

      it('needs no header for the main list or the normal trash', async () => {
        const live = await insertFile();
        const trashed = await insertFile({ deletedAt: Date.now() });
        expect(await listIds('/files')).toEqual([live]);
        expect(await listIds('/files?trash=1')).toEqual([trashed]);
      });
    });
  }
});

describe('uploading straight into the vault', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    name: 'secret.pdf',
    mime: 'application/pdf',
    size: 40,
    hasThumb: true,
    vault: { encMeta: ENC_META, encKey: ENC_KEY },
    ...over,
  });

  async function create(over: Record<string, unknown> = {}) {
    const res = await postJson('/uploads', body(over));
    expect(res.status).toBe(201);
    return (await res.json()) as CreateUploadResponse;
  }

  describe('when the vault is ready', () => {
    beforeEach(() => setState('ready'));

    it('presigns PUTs on vault/<id> and vault/<id>.thumb, whatever the plaintext name and mime say', async () => {
      const up = await create();
      expect(up.uploadUrl).toBe(`https://r2.test/put/vault/${up.id}`);
      expect(up.thumbUploadUrl).toBe(`https://r2.test/put/vault/${up.id}.thumb`);
    });

    it('gives no thumbnail URL when none is announced', async () => {
      const up = await create({ hasThumb: false });
      expect(up.thumbUploadUrl).toBeNull();
    });

    it('completes into an encrypted vault item that carries no plaintext metadata', async () => {
      const up = await create();
      await env.BUCKET.put(`vault/${up.id}`, new Uint8Array(40));
      await env.BUCKET.put(`vault/${up.id}.thumb`, new Uint8Array(20));
      const done = await callV(`/uploads/${up.id}/complete`, { method: 'POST' });
      expect(done.status).toBe(200);
      const item = (await done.json()) as FileItem;
      expect(item).toMatchObject({
        id: up.id,
        inVault: true,
        encrypted: true,
        encMeta: ENC_META,
        encKey: ENC_KEY,
        name: '',
        kind: 'file',
        mime: 'application/octet-stream',
        size: 40,
        url: null,
      });
      expect(item.thumbUrl).toContain(`vault/${up.id}.thumb`);
      expect(item.thumbUrl).not.toContain('thumbs/');

      const row = await rowOf(up.id);
      expect(row).toMatchObject({ name: '', mime: 'application/octet-stream', kind: 'file', url: null, in_vault: 1, encrypted: 1, enc_meta: ENC_META, enc_key: ENC_KEY, has_thumb: 1 });
      expect(JSON.stringify(row)).not.toContain('secret.pdf');
      expect(JSON.stringify(row)).not.toContain('application/pdf');
    });

    it('keeps enc_object NULL and the fixed key vault/<id>: the item and its thumbnail are named without any attempt (spec 4.7d)', async () => {
      const up = await create();
      await env.BUCKET.put(`vault/${up.id}`, new Uint8Array(40));
      await env.BUCKET.put(`vault/${up.id}.thumb`, new Uint8Array(20));
      const item = (await (await callV(`/uploads/${up.id}/complete`, { method: 'POST' })).json()) as FileItem;
      expect((await rowOf(up.id))?.enc_object).toBeNull();
      expect(item.thumbUrl).toContain(`/vault/${up.id}.thumb`);
      const { url } = (await (await callV(`/files/${up.id}/download`)).json()) as { url: string };
      expect(url).toBe(`https://r2.test/get/vault/${up.id}`);
    });

    it('shows the finished item in the vault list and never in the main list', async () => {
      const up = await create();
      await env.BUCKET.put(`vault/${up.id}`, new Uint8Array(40));
      await callV(`/uploads/${up.id}/complete`, { method: 'POST' });
      expect(await listIds('/files?vault=1', true)).toEqual([up.id]);
      expect(await listIds('/files')).toEqual([]);
    });

    it('needs no plain object and creates none', async () => {
      const up = await create({ hasThumb: false });
      await env.BUCKET.put(`vault/${up.id}`, new Uint8Array(40));
      expect((await callV(`/uploads/${up.id}/complete`, { method: 'POST' })).status).toBe(200);
      expect(await env.BUCKET.head(`files/${up.id}`)).toBeNull();
      expect(await env.BUCKET.head(`thumbs/${up.id}.jpg`)).toBeNull();
    });

    it('does not complete from an object at the plain key', async () => {
      const up = await create({ hasThumb: false });
      await env.BUCKET.put(`files/${up.id}`, new Uint8Array(40));
      const res = await callV(`/uploads/${up.id}/complete`, { method: 'POST' });
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('not_uploaded');
    });

    it('drops a thumbnail that was announced but never uploaded', async () => {
      const up = await create();
      await env.BUCKET.put(`vault/${up.id}`, new Uint8Array(40));
      const item = (await (await callV(`/uploads/${up.id}/complete`, { method: 'POST' })).json()) as FileItem;
      expect(item.thumbUrl).toBeNull();
      expect((await rowOf(up.id))?.has_thumb).toBe(0);
    });

    it('refuses a wrong ciphertext size and deletes the vault objects', async () => {
      const up = await create();
      await env.BUCKET.put(`vault/${up.id}`, new Uint8Array(41));
      await env.BUCKET.put(`vault/${up.id}.thumb`, new Uint8Array(20));
      const res = await callV(`/uploads/${up.id}/complete`, { method: 'POST' });
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('size_mismatch');
      expect(await env.BUCKET.head(`vault/${up.id}`)).toBeNull();
      expect(await env.BUCKET.head(`vault/${up.id}.thumb`)).toBeNull();
      expect(await rowOf(up.id)).toBeNull();
    });

    it('accepts a ciphertext of vaultCiphertextSize(MAX_FILE_SIZE) and refuses one byte more with 413', async () => {
      const max = vaultCiphertextSize(MAX_FILE_SIZE);
      expect((await postJson('/uploads', body({ size: max, hasThumb: false }))).status).toBe(201);
      const over = await postJson('/uploads', body({ size: max + 1, hasThumb: false }));
      expect(over.status).toBe(413);
      expect(await errorCode(over)).toBe('too_large');
    });

    it('accepts a vault upload whose ciphertext is larger than MAX_FILE_SIZE', async () => {
      expect((await postJson('/uploads', body({ size: MAX_FILE_SIZE + 1, hasThumb: false }))).status).toBe(201);
    });

    it('keeps the MAX_FILE_SIZE limit for plain uploads', async () => {
      const plain = { name: 'big.bin', mime: 'application/octet-stream', hasThumb: false };
      expect((await postJson('/uploads', { ...plain, size: MAX_FILE_SIZE })).status).toBe(201);
      const over = await postJson('/uploads', { ...plain, size: MAX_FILE_SIZE + 1 });
      expect(over.status).toBe(413);
      expect(await errorCode(over)).toBe('too_large');
    });

    it('answers 400 when vault.encMeta or vault.encKey is missing or not a string', async () => {
      const bad: unknown[] = [
        { encKey: ENC_KEY },
        { encMeta: ENC_META },
        { encMeta: 5, encKey: ENC_KEY },
        { encMeta: ENC_META, encKey: null },
        { encMeta: ENC_META, encKey: ['x'] },
        {},
        true,
      ];
      for (const vault of bad) {
        const res = await postJson('/uploads', body({ vault }));
        expect(res.status, JSON.stringify(vault)).toBe(400);
      }
      expect(((await env.DB.prepare('SELECT COUNT(*) AS n FROM files').first()) as { n: number }).n).toBe(0);
    });
  });

  for (const state of ['none', 'wiped'] as const) {
    it(`answers 409 vault_not_ready when the vault is ${state}, and creates nothing`, async () => {
      await setState(state);
      const res = await postJson('/uploads', body());
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('vault_not_ready');
      expect(((await env.DB.prepare('SELECT COUNT(*) AS n FROM files').first()) as { n: number }).n).toBe(0);
    });
  }
});

describe('downloading an encrypted item', () => {
  beforeEach(() => setState('ready'));

  it('signs vault/<id> with no filename and no image content type', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1 });
    const res = await callV(`/files/${id}/download`);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain(`vault/${id}`);
    expect(url).not.toContain('files/');
    expect(url).not.toContain('response-content-disposition');
    expect(url).not.toContain('name=');
    const signed = signedGets.filter((g) => g.key === `vault/${id}`);
    expect(signed).toHaveLength(1);
    expect(signed[0].opts?.filename).toBeFalsy();
    expect(signed[0].opts?.contentType ?? '').not.toMatch(/^image\//);
  });
});

describe('the keys of an item encrypted by an attempt follow its enc_object (spec 4.7d)', () => {
  beforeEach(() => setState('ready'));
  const ATTEMPT = 'QXR0ZW1wdC1BQUFBQUFBQQ';

  it('downloads vault/<id>.<enc_object>, with no filename and no image content type', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1, encObject: ATTEMPT });
    const res = await callV(`/files/${id}/download`);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toBe(`https://r2.test/get/vault/${id}.${ATTEMPT}`);
    const signed = signedGets.filter((g) => g.key === `vault/${id}.${ATTEMPT}`);
    expect(signed).toHaveLength(1);
    expect(signed[0].opts?.filename).toBeFalsy();
    expect(signed[0].opts?.contentType ?? '').not.toMatch(/^image\//);
    expect(signedGets.some((g) => g.key === `vault/${id}`)).toBe(false);
  });

  it('lists the thumbnail on vault/<id>.<enc_object>.thumb, as application/octet-stream', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1, hasThumb: 1, encObject: ATTEMPT });
    const res = await callV('/files?vault=1');
    const item = ((await res.json()) as ListFilesResponse).items.find((i) => i.id === id)!;
    expect(item.thumbUrl).toBe(`https://r2.test/get/vault/${id}.${ATTEMPT}.thumb`);
    const signed = signedGets.filter((g) => g.key === `vault/${id}.${ATTEMPT}.thumb`);
    expect(signed).toHaveLength(1);
    expect(signed[0].opts?.contentType).toBe('application/octet-stream');
  });

  it('lists the thumbnail of an item in the vault trash on its attempt key too', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1, hasThumb: 1, encObject: ATTEMPT, deletedAt: Date.now() });
    const item = ((await (await callV('/files?vault=1&trash=1')).json()) as ListFilesResponse).items.find((i) => i.id === id)!;
    expect(item.thumbUrl).toBe(`https://r2.test/get/vault/${id}.${ATTEMPT}.thumb`);
  });

  it('still lists a row with no enc_object on the fixed key vault/<id>.thumb', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1, hasThumb: 1 });
    const item = ((await (await callV('/files?vault=1')).json()) as ListFilesResponse).items.find((i) => i.id === id)!;
    expect(item.thumbUrl).toBe(`https://r2.test/get/vault/${id}.thumb`);
  });

  it('completing an upload of a plain (not encrypted) row is unaffected: it still uses files/<id>', async () => {
    const res = await postJson('/uploads', { name: 'a.txt', mime: 'text/plain', size: 4, hasThumb: false });
    const up = (await res.json()) as CreateUploadResponse;
    expect(up.uploadUrl).toBe(`https://r2.test/put/files/${up.id}`);
    await env.BUCKET.put(`files/${up.id}`, new Uint8Array(4));
    expect((await callV(`/uploads/${up.id}/complete`, { method: 'POST' })).status).toBe(200);
    expect((await rowOf(up.id))?.enc_object).toBeNull();
  });
});

describe('encrypted items and the server-side metadata routes', () => {
  beforeEach(() => setState('ready'));

  it('does not fetch a link preview for an encrypted item: 409 encrypted, no network', async () => {
    const calls: string[] = [];
    const guarded = createApp({
      presigner: fakePresigner,
      fetch: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        throw new Error('the network must not be touched for an encrypted item');
      }) as typeof fetch,
    });
    // An encrypted link is stored like any encrypted item: kind 'file', no url (the address is inside enc_meta).
    const id = await insertFile({ inVault: 1, encrypted: 1 });
    const res = await guarded.request(`/links/${id}/preview`, { method: 'POST', headers: { ...AUTH, ...VAULT } }, env);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('encrypted');
    expect(calls).toEqual([]);
  });

  it('answers 409 encrypted to a plain name and leaves the row alone', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1 });
    const res = await patchJson(`/files/${id}`, { name: 'leaked.txt' });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('encrypted');
    expect((await rowOf(id))?.name).toBe('');
  });

  it('answers 409 encrypted to a plain url and leaves the row alone', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1 });
    const res = await patchJson(`/files/${id}`, { url: 'https://example.com/leak' });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('encrypted');
    expect((await rowOf(id))?.url).toBeNull();
  });

  it('still takes tags and important on an encrypted item (they are plaintext by design)', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1 });
    const res = await patchJson(`/files/${id}`, { tags: ['red', 'blue'], important: true });
    expect(res.status).toBe(200);
    const item = (await res.json()) as FileItem;
    expect(item.tags).toEqual(['red', 'blue']);
    expect(item.important).toBe(true);
    expect(item.encMeta).toBe('TUVUQQ==');
    const row = await rowOf(id);
    expect([row?.tags, row?.important, row?.enc_meta, row?.name]).toEqual(['red,blue', 1, 'TUVUQQ==', '']);
  });

  it('replaces enc_meta when a new encMeta is sent (rename and link edit are re-encrypted by the client)', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1 });
    const res = await patchJson(`/files/${id}`, { encMeta: ENC_META });
    expect(res.status).toBe(200);
    const item = (await res.json()) as FileItem;
    expect(item.encMeta).toBe(ENC_META);
    expect(item.encrypted).toBe(true);
    expect(item.name).toBe('');
    const row = await rowOf(id);
    expect(row?.enc_meta).toBe(ENC_META);
    expect(row?.enc_key).toBe('S0VZ');
    expect(row?.name).toBe('');
  });

  it('takes encMeta together with tags and important', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1 });
    const res = await patchJson(`/files/${id}`, { encMeta: ENC_META, tags: ['green'], important: true });
    expect(res.status).toBe(200);
    const item = (await res.json()) as FileItem;
    expect([item.encMeta, item.tags, item.important]).toEqual([ENC_META, ['green'], true]);
    const row = await rowOf(id);
    expect([row?.enc_meta, row?.tags, row?.important]).toEqual([ENC_META, 'green', 1]);
  });

  it('answers 400 when encMeta is not a non-empty string', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1 });
    for (const encMeta of ['', 123, null, {}, ['x'], true]) {
      const res = await patchJson(`/files/${id}`, { encMeta });
      expect(res.status, JSON.stringify(encMeta)).toBe(400);
    }
    expect((await rowOf(id))?.enc_meta).toBe('TUVUQQ==');
  });

  it('answers 400 bad_request to encMeta on a row that is not encrypted', async () => {
    const plain = await insertFile({ name: 'a.txt' });
    const res = await patchJson(`/files/${plain}`, { encMeta: ENC_META });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('bad_request');
    const row = await rowOf(plain);
    expect([row?.enc_meta, row?.encrypted, row?.name]).toEqual([null, 0, 'a.txt']);

    const legacyVault = await insertFile({ name: 'old.txt', inVault: 1 });
    expect((await patchJson(`/files/${legacyVault}`, { encMeta: ENC_META })).status).toBe(400);
  });
});

describe('sharing vault items', () => {
  beforeEach(() => setState('ready'));

  const share = (id: string) => sendJson('PUT', `/files/${id}/share`, { expiresInDays: 7 });

  it('answers 404 for a legacy (unencrypted) vault item', async () => {
    const id = await insertFile({ inVault: 1 });
    expect((await share(id)).status).toBe(404);
  });

  it('answers 404 for an encrypted vault item', async () => {
    const id = await insertFile({ inVault: 1, encrypted: 1 });
    expect((await share(id)).status).toBe(404);
  });
});
