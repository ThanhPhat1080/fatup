import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ListFilesResponse } from '@fatup/shared';
import { createApp } from '../src/app';
import { purge } from '../src/cleanup';
import { fileKey, objectKeys, thumbKey, vaultFileKey, vaultThumbKey } from '../src/presign';
import { ulid } from '../src/ulid';

const fakePresigner = () => ({
  put: async (key: string) => `https://r2.test/put/${key}`,
  get: async (key: string) => `https://r2.test/get/${key}`,
});

const app = createApp({ presigner: fakePresigner });
const AUTH = { Authorization: 'Bearer test-token' };

function call(path: string, init: RequestInit = {}) {
  return app.request(path, { ...init, headers: { ...AUTH, ...(init.headers ?? {}) } }, env);
}

type Col = { name: string; notnull: number; dflt_value: string | null };
async function columns(table: string): Promise<Col[]> {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<Col>();
  return results;
}

/** Inserts a finished file row straight into D1, bypassing the upload flow. */
async function insertFile(f: { encrypted: 0 | 1; inVault?: 0 | 1; hasThumb?: 0 | 1; name?: string; encMeta?: string | null; encKey?: string | null }) {
  const id = ulid();
  await env.DB.prepare(
    `INSERT INTO files (id, name, mime, size, kind, has_thumb, status, created_at, in_vault, encrypted, enc_meta, enc_key)
     VALUES (?, ?, 'application/octet-stream', 4, 'file', ?, 'ready', ?, ?, ?, ?, ?)`,
  )
    .bind(id, f.name ?? 'a.bin', f.hasThumb ?? 0, Date.now(), f.inVault ?? 0, f.encrypted, f.encMeta ?? null, f.encKey ?? null)
    .run();
  return id;
}

async function fileRow(id: string) {
  return env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(id).first();
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM vault_keys').run();
  await env.DB.prepare('DELETE FROM shares').run();
  await env.DB.prepare('DELETE FROM files').run();
  const { objects } = await env.BUCKET.list();
  if (objects.length) await env.BUCKET.delete(objects.map((o) => o.key));
});

describe('schema', () => {
  it('creates vault_keys with every column of the spec', async () => {
    const cols = await columns('vault_keys');
    expect(cols.map((c) => c.name).sort()).toEqual(
      [
        'id',
        'kdf_salt',
        'kdf_iterations',
        'auth_hash',
        'server_secret',
        'wrapped_mk_pin',
        'rk_auth_hash',
        'wrapped_mk_recovery',
        'failed_attempts',
        'locked_until',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });

  it('defaults failed_attempts to 0 and lets the wipeable columns be NULL', async () => {
    const cols = await columns('vault_keys');
    const by = (n: string) => cols.find((c) => c.name === n)!;
    expect(by('failed_attempts').notnull).toBe(1);
    expect(by('failed_attempts').dflt_value).toBe('0');
    for (const n of ['auth_hash', 'server_secret', 'wrapped_mk_pin', 'locked_until']) expect(by(n).notnull).toBe(0);
    for (const n of ['kdf_salt', 'kdf_iterations', 'rk_auth_hash', 'wrapped_mk_recovery', 'created_at', 'updated_at']) expect(by(n).notnull).toBe(1);
  });

  it('adds encrypted (NOT NULL default 0), enc_meta and enc_key to files', async () => {
    const cols = await columns('files');
    const by = (n: string) => cols.find((c) => c.name === n);
    expect(by('encrypted')?.notnull).toBe(1);
    expect(by('encrypted')?.dflt_value).toBe('0');
    expect(by('enc_meta')).toBeDefined();
    expect(by('enc_key')).toBeDefined();
  });

  it('refuses a second vault_keys row (id must be 1)', async () => {
    const insert = (id: number) =>
      env.DB.prepare(
        `INSERT INTO vault_keys (id, kdf_salt, kdf_iterations, rk_auth_hash, wrapped_mk_recovery, created_at, updated_at)
         VALUES (?, 's', 1, 'r', 'w', 1, 1)`,
      )
        .bind(id)
        .run();
    await insert(1);
    await expect(insert(2)).rejects.toThrow();
    const { results } = await env.DB.prepare('SELECT id, failed_attempts FROM vault_keys').all();
    expect(results).toEqual([{ id: 1, failed_attempts: 0 }]);
  });
});

describe('R2 keys', () => {
  it('names encrypted objects vault/<id> and vault/<id>.thumb', () => {
    expect(vaultFileKey('abc')).toBe('vault/abc');
    expect(vaultThumbKey('abc')).toBe('vault/abc.thumb');
  });

  it('objectKeys picks the key pair from the encrypted flag', () => {
    expect(objectKeys({ id: 'abc', encrypted: 0 })).toEqual([fileKey('abc'), thumbKey('abc')]);
    expect(objectKeys({ id: 'abc', encrypted: 1 })).toEqual([vaultFileKey('abc'), vaultThumbKey('abc')]);
  });
});

describe('purge', () => {
  it('deletes the vault/ objects and the row of an encrypted item', async () => {
    const id = await insertFile({ encrypted: 1, inVault: 1, hasThumb: 1, name: '', encMeta: 'M', encKey: 'K' });
    await env.BUCKET.put(`vault/${id}`, 'cipher');
    await env.BUCKET.put(`vault/${id}.thumb`, 'cipher-thumb');

    await purge(env, [id]);

    expect(await env.BUCKET.head(`vault/${id}`)).toBeNull();
    expect(await env.BUCKET.head(`vault/${id}.thumb`)).toBeNull();
    expect(await fileRow(id)).toBeNull();
  });

  it('still deletes the files/ and thumbs/ objects of a plain item', async () => {
    const id = await insertFile({ encrypted: 0, hasThumb: 1 });
    await env.BUCKET.put(`files/${id}`, 'plain');
    await env.BUCKET.put(`thumbs/${id}.jpg`, 'jpeg');

    await purge(env, [id]);

    expect(await env.BUCKET.head(`files/${id}`)).toBeNull();
    expect(await env.BUCKET.head(`thumbs/${id}.jpg`)).toBeNull();
    expect(await fileRow(id)).toBeNull();
  });

  it('cleans both kinds in one call and leaves other items alone', async () => {
    const plain = await insertFile({ encrypted: 0, hasThumb: 1 });
    const enc = await insertFile({ encrypted: 1, inVault: 1, hasThumb: 1, name: '', encMeta: 'M', encKey: 'K' });
    const keep = await insertFile({ encrypted: 1, inVault: 1, name: '', encMeta: 'M', encKey: 'K' });
    for (const k of [`files/${plain}`, `thumbs/${plain}.jpg`, `vault/${enc}`, `vault/${enc}.thumb`, `vault/${keep}`]) await env.BUCKET.put(k, 'x');

    await purge(env, [plain, enc]);

    for (const k of [`files/${plain}`, `thumbs/${plain}.jpg`, `vault/${enc}`, `vault/${enc}.thumb`]) expect(await env.BUCKET.head(k)).toBeNull();
    expect(await env.BUCKET.head(`vault/${keep}`)).not.toBeNull();
    expect(await fileRow(keep)).not.toBeNull();
  });
});

describe('GET /files?vault=1', () => {
  it('reports a legacy vault item as encrypted: false when no vault exists', async () => {
    const id = await insertFile({ encrypted: 0, inVault: 1, name: 'old.pdf' });
    const res = await call('/files?vault=1');
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as ListFilesResponse;
    const item = items.find((i) => i.id === id)!;
    expect(item.encrypted).toBe(false);
    expect(item.name).toBe('old.pdf');
    expect(item.inVault).toBe(true);
  });

  it('returns encMeta and encKey of an encrypted item and signs its thumbnail on vault/<id>.thumb', async () => {
    const id = await insertFile({ encrypted: 1, inVault: 1, hasThumb: 1, name: '', encMeta: 'M', encKey: 'K' });
    const res = await call('/files?vault=1');
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as ListFilesResponse;
    const item = items.find((i) => i.id === id)!;
    expect(item.encrypted).toBe(true);
    expect(item.encMeta).toBe('M');
    expect(item.encKey).toBe('K');
    expect(item.thumbUrl).toContain(`/vault/${id}.thumb`);
    expect(item.thumbUrl).not.toContain('thumbs/');
  });

  it('gives a plain item no encMeta or encKey', async () => {
    const id = await insertFile({ encrypted: 0, inVault: 1 });
    const { items } = (await (await call('/files?vault=1')).json()) as ListFilesResponse;
    const item = items.find((i) => i.id === id)!;
    expect(item.encMeta ?? null).toBeNull();
    expect(item.encKey ?? null).toBeNull();
  });
});
