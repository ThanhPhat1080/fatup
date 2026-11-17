import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ListFilesResponse } from '@fatup/shared';
import { createApp } from '../src/app';
import { cleanup, purge } from '../src/cleanup';
import type { Env } from '../src/env';
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

const ALL_KEYS = (id: string) => [`files/${id}`, `thumbs/${id}.jpg`, `vault/${id}`, `vault/${id}.thumb`];

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

  it('adds out_started_at to files: a nullable integer with no default', async () => {
    const col = (await columns('files')).find((c) => c.name === 'out_started_at');
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0);
    expect(col!.dflt_value).toBeNull();
    const id = await insertFile({ encrypted: 0 });
    expect(await env.DB.prepare('SELECT out_started_at FROM files WHERE id = ?').bind(id).first()).toEqual({ out_started_at: null });
  });

  it('adds in_claim (TEXT) and in_claim_until (INTEGER) to files: nullable, no default (spec 4.7c)', async () => {
    const cols = await columns('files');
    for (const [name, type] of [['in_claim', 'TEXT'], ['in_claim_until', 'INTEGER']] as const) {
      const col = cols.find((c) => c.name === name) as (Col & { type: string }) | undefined;
      expect(col, name).toBeDefined();
      expect(col!.type, name).toBe(type);
      expect(col!.notnull, name).toBe(0);
      expect(col!.dflt_value, name).toBeNull();
    }
    const id = await insertFile({ encrypted: 0 });
    expect(await env.DB.prepare('SELECT in_claim, in_claim_until FROM files WHERE id = ?').bind(id).first()).toEqual({ in_claim: null, in_claim_until: null });
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

  it('deletes all four keys of an encrypted item, even the plain ones an interrupted move-out left', async () => {
    const id = await insertFile({ encrypted: 1, inVault: 1, hasThumb: 1, name: '', encMeta: 'M', encKey: 'K' });
    for (const k of ALL_KEYS(id)) await env.BUCKET.put(k, 'x');

    await purge(env, [id]);

    for (const k of ALL_KEYS(id)) expect(await env.BUCKET.head(k)).toBeNull();
    expect(await fileRow(id)).toBeNull();
  });

  it('deletes all four keys of a plain item, even the encrypted ones an interrupted move-in left', async () => {
    const id = await insertFile({ encrypted: 0, hasThumb: 1 });
    for (const k of ALL_KEYS(id)) await env.BUCKET.put(k, 'x');

    await purge(env, [id]);

    for (const k of ALL_KEYS(id)) expect(await env.BUCKET.head(k)).toBeNull();
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

describe('DELETE /trash', () => {
  const trash = (id: string, at = Date.now()) => env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').bind(at, id).run();

  it('purges only the normal trash: an item in the vault trash stays, with its objects (spec 4.7b C2)', async () => {
    const normal = await insertFile({ encrypted: 0 });
    await env.BUCKET.put(`files/${normal}`, 'plain');
    const vaulted = await insertFile({ encrypted: 1, inVault: 1, hasThumb: 1, name: '', encMeta: 'M', encKey: 'K' });
    await env.BUCKET.put(`vault/${vaulted}`, 'cipher');
    await env.BUCKET.put(`vault/${vaulted}.thumb`, 'cipher-thumb');
    await trash(normal);
    await trash(vaulted);

    const res = await call('/trash', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
    expect(await fileRow(normal)).toBeNull();
    expect(await env.BUCKET.head(`files/${normal}`)).toBeNull();
    expect(await fileRow(vaulted)).not.toBeNull();
    expect(await env.BUCKET.head(`vault/${vaulted}`)).not.toBeNull();
    expect(await env.BUCKET.head(`vault/${vaulted}.thumb`)).not.toBeNull();
  });

  it('also keeps a legacy (not yet encrypted) item in the vault trash', async () => {
    const legacy = await insertFile({ encrypted: 0, inVault: 1 });
    await env.BUCKET.put(`files/${legacy}`, 'plain');
    await trash(legacy);

    const res = await call('/trash', { method: 'DELETE' });

    expect(await res.json()).toEqual({ deleted: 0 });
    expect(await fileRow(legacy)).not.toBeNull();
    expect(await env.BUCKET.head(`files/${legacy}`)).not.toBeNull();
  });
});

describe('cleanup: plain leftovers of an interrupted move out of the vault (spec 4.7b C3)', () => {
  const NOW = 1_800_000_000_000;
  const HOUR = 60 * 60 * 1000;
  const MIN = 60 * 1000;
  const stamp = (id: string, at: number) => env.DB.prepare('UPDATE files SET out_started_at = ? WHERE id = ?').bind(at, id).run();
  const outStarted = async (id: string) =>
    ((await env.DB.prepare('SELECT out_started_at AS t FROM files WHERE id = ?').bind(id).first()) as { t: number | null }).t;

  async function encryptedWithLeftovers() {
    const id = await insertFile({ encrypted: 1, inVault: 1, hasThumb: 1, name: '', encMeta: 'M', encKey: 'K' });
    for (const k of [`files/${id}`, `thumbs/${id}.jpg`, `vault/${id}`]) await env.BUCKET.put(k, 'x');
    return id;
  }

  it('deletes files/<id> and thumbs/<id>.jpg of an encrypted row whose move out started over an hour ago, and keeps vault/<id>', async () => {
    const id = await encryptedWithLeftovers();
    await stamp(id, NOW - 2 * HOUR);

    await cleanup(env, NOW);

    expect(await env.BUCKET.head(`files/${id}`)).toBeNull();
    expect(await env.BUCKET.head(`thumbs/${id}.jpg`)).toBeNull();
    expect(await env.BUCKET.head(`vault/${id}`)).not.toBeNull();
    expect(await outStarted(id)).toBeNull();
    expect(await env.DB.prepare('SELECT encrypted, in_vault, enc_key FROM files WHERE id = ?').bind(id).first()).toEqual({ encrypted: 1, in_vault: 1, enc_key: 'K' });
  });

  it('leaves a move out that started 10 minutes ago alone: it may still be running', async () => {
    const id = await encryptedWithLeftovers();
    await stamp(id, NOW - 10 * MIN);

    await cleanup(env, NOW);

    for (const k of [`files/${id}`, `thumbs/${id}.jpg`, `vault/${id}`]) expect(await env.BUCKET.head(k)).not.toBeNull();
    expect(await outStarted(id)).toBe(NOW - 10 * MIN);
  });

  it('does not touch an encrypted row that has no out_started_at', async () => {
    const id = await encryptedWithLeftovers();

    await cleanup(env, NOW);

    for (const k of [`files/${id}`, `thumbs/${id}.jpg`, `vault/${id}`]) expect(await env.BUCKET.head(k)).not.toBeNull();
  });

  it('never deletes the plain objects of a plain row, even with a stale out_started_at: that move finished and they are its file', async () => {
    const id = await insertFile({ encrypted: 0, hasThumb: 1 });
    await env.BUCKET.put(`files/${id}`, 'plain');
    await env.BUCKET.put(`thumbs/${id}.jpg`, 'jpeg');
    await stamp(id, NOW - 2 * HOUR);

    await cleanup(env, NOW);

    expect(await env.BUCKET.head(`files/${id}`)).not.toBeNull();
    expect(await env.BUCKET.head(`thumbs/${id}.jpg`)).not.toBeNull();
    expect(await fileRow(id)).not.toBeNull();
  });
});

/**
 * An env whose D1 and R2 report what they are asked: the largest number of values bound to one statement and the largest
 * R2 delete. D1 refuses more than 100 bound parameters per statement and R2 more than 1000 keys per delete; the local
 * simulators are laxer, so the limits are asserted on what the code sends.
 */
function watched() {
  const seen = { maxBound: 0, maxKeys: 0, statements: 0 };
  const db = new Proxy(env.DB, {
    get(t, key) {
      const value = Reflect.get(t, key, t) as unknown;
      if (key !== 'prepare') return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
      return (sql: string) => {
        seen.statements++;
        const stmt = t.prepare(sql);
        return new Proxy(stmt, {
          get(st, k) {
            const v = Reflect.get(st, k, st) as unknown;
            if (k === 'bind') {
              return (...args: unknown[]) => {
                seen.maxBound = Math.max(seen.maxBound, args.length);
                return st.bind(...args);
              };
            }
            return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(st) : v;
          },
        });
      };
    },
  });
  const bucket = new Proxy(env.BUCKET, {
    get(t, key) {
      const value = Reflect.get(t, key, t) as unknown;
      if (key !== 'delete') return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
      return (keys: string | string[]) => {
        seen.maxKeys = Math.max(seen.maxKeys, Array.isArray(keys) ? keys.length : 1);
        return t.delete(keys);
      };
    },
  });
  return { env: { ...env, DB: db, BUCKET: bucket } as unknown as Env, seen };
}

describe('purge and the cron work in batches of at most 100 ids (spec 4.7c, review N7)', () => {
  const NOW = 1_800_000_000_000;
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  async function manyRows(n: number, over: { encrypted?: 0 | 1; deletedAt?: number | null; outStartedAt?: number | null } = {}) {
    const ids = Array.from({ length: n }, () => ulid());
    // One multi-row insert per chunk of 10 keeps this quick and under D1's 100 values per statement (7 each).
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      await env.DB.prepare(
        `INSERT INTO files (id, name, mime, size, kind, has_thumb, status, created_at, deleted_at, in_vault, encrypted, enc_meta, enc_key, out_started_at)
         VALUES ${chunk.map(() => `(?, 'a.bin', 'application/octet-stream', 4, 'file', 0, 'ready', 1, ?, ?, ?, ?, ?, ?)`).join(',')}`,
      )
        .bind(...chunk.flatMap((id) => [id, over.deletedAt ?? null, over.encrypted ? 1 : 0, over.encrypted ? 1 : 0, over.encrypted ? 'M' : null, over.encrypted ? 'K' : null, over.outStartedAt ?? null]))
        .run();
    }
    return ids;
  }
  const count = async () => ((await env.DB.prepare('SELECT COUNT(*) AS n FROM files').first()) as { n: number }).n;

  it('purge deletes 250 ids: every row and object is gone, no statement binds more than 100 values, no R2 delete takes more than 1000 keys', async () => {
    const ids = await manyRows(250);
    for (const id of ids.slice(0, 30)) await env.BUCKET.put(`files/${id}`, 'x');
    for (const id of ids.slice(100, 130)) await env.BUCKET.put(`vault/${id}`, 'x');
    const w = watched();

    await purge(w.env, ids);

    expect(await count()).toBe(0);
    expect((await env.BUCKET.list()).objects).toEqual([]);
    expect(w.seen.maxBound).toBeLessThanOrEqual(100);
    expect(w.seen.maxBound).toBeGreaterThan(0);
    expect(w.seen.maxKeys).toBeLessThanOrEqual(1000);
  });

  it('purge also deletes the shares of the ids', async () => {
    const ids = await manyRows(120);
    await env.DB.prepare('INSERT INTO shares (token, file_id, created_at) VALUES (?, ?, 1), (?, ?, 1)').bind('t1', ids[0], 't2', ids[119]).run();
    await purge(watched().env, ids);
    expect(((await env.DB.prepare('SELECT COUNT(*) AS n FROM shares').first()) as { n: number }).n).toBe(0);
  });

  it('DELETE /trash with 250 trashed rows removes them all, within the limits', async () => {
    const ids = await manyRows(250, { deletedAt: Date.now() });
    for (const id of ids) await env.BUCKET.put(`files/${id}`, 'x');
    const keep = await insertFile({ encrypted: 1, inVault: 1, name: '', encMeta: 'M', encKey: 'K' });
    await env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').bind(Date.now(), keep).run(); // the Vault's trash stays
    const w = watched();

    const res = await app.request('/trash', { method: 'DELETE', headers: AUTH }, w.env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 250 });
    expect(await count()).toBe(1);
    expect(await fileRow(keep)).not.toBeNull();
    expect((await env.BUCKET.list()).objects).toEqual([]);
    expect(w.seen.maxBound).toBeLessThanOrEqual(100);
    expect(w.seen.maxKeys).toBeLessThanOrEqual(1000);
  });

  it('cleanup removes 250 rows that sat in the trash for over 30 days, within the limits', async () => {
    const ids = await manyRows(250, { deletedAt: NOW - 31 * DAY });
    for (const id of ids) await env.BUCKET.put(`files/${id}`, 'x');
    const w = watched();

    expect(await cleanup(w.env, NOW)).toBe(250);

    expect(await count()).toBe(0);
    expect((await env.BUCKET.list()).objects).toEqual([]);
    expect(w.seen.maxBound).toBeLessThanOrEqual(100);
    expect(w.seen.maxKeys).toBeLessThanOrEqual(1000);
  });

  it('cleanup sweeps the plain leftovers of 250 stale move outs, within the limits, and clears every out_started_at', async () => {
    const ids = await manyRows(250, { encrypted: 1, outStartedAt: NOW - 2 * HOUR });
    for (const id of ids) {
      await env.BUCKET.put(`files/${id}`, 'x');
      await env.BUCKET.put(`vault/${id}`, 'x');
    }
    const w = watched();

    await cleanup(w.env, NOW);

    expect(((await env.DB.prepare('SELECT COUNT(*) AS n FROM files WHERE out_started_at IS NOT NULL').first()) as { n: number }).n).toBe(0);
    expect((await env.BUCKET.list({ prefix: 'files/' })).objects).toEqual([]);
    expect((await env.BUCKET.list({ prefix: 'vault/' })).objects).toHaveLength(250);
    expect(await count()).toBe(250);
    expect(w.seen.maxBound).toBeLessThanOrEqual(100);
    expect(w.seen.maxKeys).toBeLessThanOrEqual(1000);
  });
});

describe('cleanup releases out_started_at BEFORE it deletes the plain objects (spec 4.7c, review N3)', () => {
  const NOW = 1_800_000_000_000;
  const HOUR = 60 * 60 * 1000;

  it('has already cleared out_started_at of a row when the delete of its plain objects is issued', async () => {
    const id = await insertFile({ encrypted: 1, inVault: 1, hasThumb: 1, name: '', encMeta: 'M', encKey: 'K' });
    for (const k of [`files/${id}`, `thumbs/${id}.jpg`, `vault/${id}`]) await env.BUCKET.put(k, 'x');
    await env.DB.prepare('UPDATE files SET out_started_at = ? WHERE id = ?').bind(NOW - 2 * HOUR, id).run();

    // Look at the row at the moment the Worker asks R2 to delete the row's plain objects.
    const atDelete: (number | null)[] = [];
    const bucket = new Proxy(env.BUCKET, {
      get(t, key) {
        const value = Reflect.get(t, key, t) as unknown;
        if (key !== 'delete') return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
        return async (keys: string | string[]) => {
          if ([keys].flat().includes(`files/${id}`)) {
            const row = (await env.DB.prepare('SELECT out_started_at AS t FROM files WHERE id = ?').bind(id).first()) as { t: number | null };
            atDelete.push(row.t);
          }
          return t.delete(keys);
        };
      },
    });

    await cleanup({ ...env, BUCKET: bucket } as unknown as Env, NOW);

    expect(atDelete).toEqual([null]); // the objects were deleted once, after the row was released
    expect(await env.BUCKET.head(`files/${id}`)).toBeNull();
    expect(await env.BUCKET.head(`thumbs/${id}.jpg`)).toBeNull();
    expect(await env.BUCKET.head(`vault/${id}`)).not.toBeNull();
    expect(await env.DB.prepare('SELECT out_started_at AS t FROM files WHERE id = ?').bind(id).first()).toEqual({ t: null });
  });

  it('does not delete the plain objects of a row whose out_started_at a vault/out/complete cleared meanwhile', async () => {
    // The row the cron would have swept finished its move out first: it is plain now and files/<id> is its file.
    const id = await insertFile({ encrypted: 0, hasThumb: 0 });
    await env.BUCKET.put(`files/${id}`, 'plain');
    await env.DB.prepare('UPDATE files SET out_started_at = NULL WHERE id = ?').bind(id).run();

    await cleanup(env, NOW);

    expect(await env.BUCKET.head(`files/${id}`)).not.toBeNull();
  });
});
