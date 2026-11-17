import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupByDay } from '../src/renderer/src/lib/format';
import { dictionaries } from '../src/renderer/src/lib/i18n';
// @ts-ignore -- plain JavaScript test helper, no declarations
import { startMockServer, TOKEN } from '../e2e/mock-server.mjs';

describe('the end-to-end mock server', () => {
  // The smoke test expects "Today" and "Yesterday" groups in the file list. They must exist whatever time of day CI happens to run
  // (a run just after midnight UTC once found no file dated today).
  it.each(Array.from({ length: 24 }, (_, h) => h))('has files dated today and yesterday at %i:05', async (hour) => {
    const realNow = new Date(2026, 10, 14, hour, 5).getTime();
    const { server, files } = await startMockServer(realNow);
    try {
      const sorted = [...files].sort((a: { createdAt: number }, b: { createdAt: number }) => b.createdAt - a.createdAt);
      const labels = groupByDay(sorted, realNow, dictionaries.vi, 'vi').map((g) => g.label);
      expect(labels).toContain('Hôm nay');
      expect(labels).toContain('Hôm qua');
    } finally {
      server.close();
    }
  });
});

// The Vault routes of the mock must answer like worker/src/vault.ts and worker/src/app.ts for the shapes the app uses.
type Res = { status: number; json: any; text: string };

const VAULT_HEADERS = { 'X-FatUp-Vault': '2' };
const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');
const setupBody = () => ({
  kdfSalt: Buffer.alloc(16, 1).toString('base64'),
  kdfIterations: 1000,
  authKey: key(2),
  serverSecret: key(3),
  wrappedMkPin: Buffer.alloc(48, 4).toString('base64'),
  rkAuth: key(5),
  wrappedMkRecovery: Buffer.alloc(48, 6).toString('base64'),
});

async function api(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, text };
}

const putBytes = (url: string, bytes: string) => fetch(url, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });

describe('the mock Vault routes', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  async function start(options: { vaultLockScale?: number } = {}) {
    const { server, url } = await startMockServer(Date.now(), options);
    stop = async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    };
    return url as string;
  }

  it('is "none" until setup, and refuses unlock, recovery and PIN change before it', async () => {
    const base = await start();
    expect(await api(base, 'GET', '/vault')).toMatchObject({ status: 200, json: { state: 'none', failedAttempts: 0, lockedUntil: null, remaining: 10 } });
    const unlock = await api(base, 'POST', '/vault/unlock', { authKey: key(2) });
    expect(unlock).toMatchObject({ status: 409, json: { error: { code: 'vault_not_ready' } } });
    expect((await api(base, 'POST', '/vault/recover', { rkAuth: key(5) })).status).toBe(409);
  });

  it('sets up once: 201, then 409 vault_exists; the status shows the KDF parameters', async () => {
    const base = await start();
    expect((await api(base, 'POST', '/vault/setup', setupBody())).status).toBe(201);
    expect(await api(base, 'GET', '/vault')).toMatchObject({ status: 200, json: { state: 'ready', kdf: { iterations: 1000 }, remaining: 10 } });
    expect(await api(base, 'POST', '/vault/setup', setupBody())).toMatchObject({ status: 409, json: { error: { code: 'vault_exists' } } });
  });

  it('answers 426 app_outdated to the encrypted list without the version header once a Vault exists', async () => {
    const base = await start();
    expect((await api(base, 'GET', '/files?vault=1')).status).toBe(200); // nothing set up yet: an empty list for any app
    await api(base, 'POST', '/vault/setup', setupBody());
    expect(await api(base, 'GET', '/files?vault=1')).toMatchObject({ status: 426, json: { error: { code: 'app_outdated' } } });
    expect(await api(base, 'GET', '/files?vault=1', undefined, VAULT_HEADERS)).toMatchObject({ status: 200, json: { items: [] } });
    // The normal list is not affected.
    expect((await api(base, 'GET', '/files')).json.items.length).toBeGreaterThan(0);
  });

  it('unlock: the right key returns the wrapped key; a wrong one answers 403 with the attempts left and resets on success', async () => {
    const base = await start();
    await api(base, 'POST', '/vault/setup', setupBody());
    const wrong = await api(base, 'POST', '/vault/unlock', { authKey: key(9) });
    expect(wrong).toMatchObject({ status: 403, json: { remaining: 9, lockedUntil: null } });
    expect(await api(base, 'GET', '/vault')).toMatchObject({ json: { failedAttempts: 1, remaining: 9 } });
    const right = await api(base, 'POST', '/vault/unlock', { authKey: key(2) });
    expect(right).toMatchObject({ status: 200, json: { serverSecret: key(3), wrappedMkPin: Buffer.alloc(48, 4).toString('base64') } });
    expect(await api(base, 'GET', '/vault')).toMatchObject({ json: { failedAttempts: 0, remaining: 10 } });
  });

  it('locks after five wrong PINs: 423 even for the right PIN, and the locked attempts are not counted', async () => {
    const base = await start({ vaultLockScale: 1 });
    await api(base, 'POST', '/vault/setup', setupBody());
    for (let i = 1; i <= 4; i++) expect((await api(base, 'POST', '/vault/unlock', { authKey: key(9) })).status).toBe(403);
    const locked = await api(base, 'POST', '/vault/unlock', { authKey: key(9) });
    expect(locked.status).toBe(423);
    expect(locked.json.remaining).toBe(5);
    expect(locked.json.lockedUntil).toBeGreaterThan(Date.now());
    expect((await api(base, 'POST', '/vault/unlock', { authKey: key(2) })).status).toBe(423);
    expect(await api(base, 'GET', '/vault')).toMatchObject({ json: { failedAttempts: 5, lockedUntil: expect.any(Number) } });
  });

  it('the lock ends when its time is up (shortened for the test)', async () => {
    const base = await start({ vaultLockScale: 0.001 }); // 60 s becomes 60 ms
    await api(base, 'POST', '/vault/setup', setupBody());
    for (let i = 0; i < 5; i++) await api(base, 'POST', '/vault/unlock', { authKey: key(9) });
    expect((await api(base, 'POST', '/vault/unlock', { authKey: key(2) })).status).toBe(423);
    await new Promise((r) => setTimeout(r, 120));
    expect(await api(base, 'GET', '/vault')).toMatchObject({ json: { lockedUntil: null } });
    expect((await api(base, 'POST', '/vault/unlock', { authKey: key(2) })).status).toBe(200);
  });

  it('wipes after ten wrong PINs (410 from then on) and the recovery key still opens the wrapped key', async () => {
    const base = await start({ vaultLockScale: 0 }); // no lock, so ten tries can follow each other
    await api(base, 'POST', '/vault/setup', setupBody());
    let last: Res | undefined;
    for (let i = 0; i < 10; i++) last = await api(base, 'POST', '/vault/unlock', { authKey: key(9) });
    expect(last).toMatchObject({ status: 410, json: { error: { code: 'vault_wiped' } } });
    expect(await api(base, 'GET', '/vault')).toMatchObject({ json: { state: 'wiped', remaining: 0 } });
    expect((await api(base, 'POST', '/vault/unlock', { authKey: key(2) })).status).toBe(410);
    expect(await api(base, 'POST', '/vault/recover', { rkAuth: key(9) })).toMatchObject({ status: 403, json: { error: { code: 'forbidden' } } });
    expect(await api(base, 'POST', '/vault/recover', { rkAuth: key(5) })).toMatchObject({ status: 200, json: { wrappedMkRecovery: Buffer.alloc(48, 6).toString('base64') } });
  });

  it('PIN change by the recovery key replaces the PIN: the old PIN stops working and the new one opens', async () => {
    const base = await start();
    await api(base, 'POST', '/vault/setup', setupBody());
    const change = { ...setupBody(), authKey: key(7), serverSecret: key(8), wrappedMkPin: Buffer.alloc(48, 10).toString('base64'), proof: { rkAuth: key(5) } };
    expect((await api(base, 'PUT', '/vault/pin', change)).status).toBe(200);
    expect((await api(base, 'POST', '/vault/unlock', { authKey: key(2) })).status).toBe(403);
    expect(await api(base, 'POST', '/vault/unlock', { authKey: key(7) })).toMatchObject({ status: 200, json: { serverSecret: key(8) } });
  });

  it('upload into the Vault: stored as sent, listed encrypted with an empty name, bytes served back, kept out of the normal list', async () => {
    const base = await start();
    await api(base, 'POST', '/vault/setup', setupBody());
    const created = await api(base, 'POST', '/uploads', { name: 'anh.png', mime: 'image/png', size: 5, hasThumb: false, vault: { encMeta: 'meta-1', encKey: 'key-1' } });
    expect(created.status).toBe(201);
    expect((await putBytes(created.json.uploadUrl, 'abcde')).status).toBe(200);
    const done = await api(base, 'POST', `/uploads/${created.json.id}/complete`);
    expect(done).toMatchObject({ status: 200, json: { encrypted: true, inVault: true, name: '', mime: 'application/octet-stream', encMeta: 'meta-1', size: 5 } });

    const id = created.json.id;
    expect((await api(base, 'GET', '/files')).json.items.some((i: { id: string }) => i.id === id)).toBe(false);
    expect((await api(base, 'GET', '/files?vault=1', undefined, VAULT_HEADERS)).json.items.map((i: { id: string }) => i.id)).toContain(id);
    // The client asks for files and links apart; the Vault holds files only.
    expect((await api(base, 'GET', '/files?vault=1&kind=link', undefined, VAULT_HEADERS)).json.items).toEqual([]);
    const download = await api(base, 'GET', `/files/${id}/download`);
    expect(await (await fetch(download.json.url)).text()).toBe('abcde');
    expect(await (await fetch(created.json.uploadUrl.replace('/put/', '/obj/'))).text()).toBe('abcde');
  });

  it('a vault upload before setup is refused with 409 vault_not_ready', async () => {
    const base = await start();
    const res = await api(base, 'POST', '/uploads', { name: 'a', mime: 'image/png', size: 1, vault: { encMeta: 'm', encKey: 'k' } });
    expect(res).toMatchObject({ status: 409, json: { error: { code: 'vault_not_ready' } } });
  });

  it('delete keeps the item in the Vault trash; restore brings it back; permanent delete needs the trash', async () => {
    const base = await start();
    await api(base, 'POST', '/vault/setup', setupBody());
    const created = await api(base, 'POST', '/uploads', { name: 'a', mime: 'image/png', size: 1, vault: { encMeta: 'm', encKey: 'k' } });
    await putBytes(created.json.uploadUrl, 'x');
    await api(base, 'POST', `/uploads/${created.json.id}/complete`);
    const id = created.json.id;
    const listed = (q: string) => api(base, 'GET', `/files?vault=1${q}`, undefined, VAULT_HEADERS).then((r) => r.json.items.map((i: { id: string }) => i.id));

    expect((await api(base, 'DELETE', `/files/${id}`)).status).toBe(204);
    expect(await listed('')).not.toContain(id);
    expect(await listed('&trash=1')).toContain(id);
    expect((await api(base, 'GET', '/files?trash=1')).json.items.some((i: { id: string }) => i.id === id)).toBe(false);

    expect((await api(base, 'POST', `/files/${id}/restore`)).json).toMatchObject({ id, deletedAt: null, inVault: true });
    expect(await listed('')).toContain(id);
    expect(await listed('&trash=1')).not.toContain(id);

    expect((await api(base, 'DELETE', `/files/${id}/permanent`)).json?.error?.code).toBe('not_in_trash');
    await api(base, 'DELETE', `/files/${id}`);
    expect((await api(base, 'DELETE', `/files/${id}/permanent`)).status).toBe(204);
    expect((await fetch(created.json.uploadUrl.replace('/put/', '/obj/'))).status).toBe(404);
  });

  it('moves a plain file in and back out with the four move routes (spec 4.7d: attempt objects)', async () => {
    const base = await start();
    await api(base, 'POST', '/vault/setup', setupBody());
    const id = String(0).padStart(26, '0'); // the first seeded picture
    const into = await api(base, 'POST', `/files/${id}/vault/in`);
    expect(into.json.attempt).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(into.json).not.toHaveProperty('claim');
    expect(into.json.uploadUrl).toContain(`/put/vault/${id}.${into.json.attempt}`);
    const stored = await putBytes(into.json.uploadUrl, 'cipher');
    expect(stored.status).toBe(200);
    const moved = await api(base, 'POST', `/files/${id}/vault/in/complete`, { encMeta: 'm', encKey: 'k', size: 6, hasThumb: false, attempt: into.json.attempt });
    expect(moved).toMatchObject({ status: 200, json: { id, encrypted: true, inVault: true } });
    expect((await api(base, 'GET', '/files')).json.items.some((i: { id: string }) => i.id === id)).toBe(false);
    // The download and the move out read the attempt's object.
    const download = await api(base, 'GET', `/files/${id}/download`);
    expect(download.json.url).toContain(`/obj/vault/${id}.${into.json.attempt}`);
    expect(await (await fetch(download.json.url)).text()).toBe('cipher');

    const out = await api(base, 'POST', `/files/${id}/vault/out`);
    expect(out.json.downloadUrl).toContain(`/obj/vault/${id}.${into.json.attempt}`);
    await putBytes(out.json.uploadUrl, 'plain!');
    const back = await api(base, 'POST', `/files/${id}/vault/out/complete`, { name: 'a.txt', mime: 'text/plain', size: 6, hasThumb: false });
    expect(back).toMatchObject({ status: 200, json: { id, name: 'a.txt', encrypted: false, inVault: false } });
    const plain = (await api(base, 'GET', '/files')).json.items.find((i: { id: string }) => i.id === id);
    expect(plain).toMatchObject({ name: 'a.txt', size: 6 });
    expect(await (await fetch(`${base}/raw/${id}`)).text()).toBe('plain!');
    expect((await fetch(download.json.url)).status).toBe(404); // the attempt's object went with the move out
  });

  describe('per-attempt vault objects (like worker/src/vault.ts, spec 4.7d)', () => {
    const firstId = String(0).padStart(26, '0'); // a seeded plain file
    const ATTEMPT = /^[A-Za-z0-9_-]{16,}$/;
    const complete = (base: string, id: string, extra: Record<string, unknown> = {}) =>
      api(base, 'POST', `/files/${id}/vault/in/complete`, { encMeta: 'm', encKey: 'k', size: 6, hasThumb: false, ...extra });
    const into = (base: string, id = firstId) => api(base, 'POST', `/files/${id}/vault/in`);
    const ready = async () => {
      const base = await start();
      await api(base, 'POST', '/vault/setup', setupBody());
      return base;
    };
    const obj = async (base: string, key: string) => fetch(`${base}/obj/${key}`);
    const vaultList = (base: string) => api(base, 'GET', '/files?vault=1', undefined, VAULT_HEADERS).then((r) => r.json.items as { id: string; encrypted: boolean; name: string; encKey: string | null; inVault: boolean }[]);
    const stored = async (base: string, id = firstId) => (await vaultList(base)).find((i) => i.id === id);

    it('answers a PUT with no ETag header (nothing needs it)', async () => {
      const base = await ready();
      const a = await into(base);
      const put = await putBytes(a.json.uploadUrl, 'cipher');
      expect(put.status).toBe(200);
      expect(put.headers.get('etag')).toBeNull();
    });

    it('vault/in gives a different attempt and different addresses on every call, and never item_busy', async () => {
      const base = await ready();
      const calls = [await into(base), await into(base), await into(base)];
      for (const c of calls) {
        expect(c.status).toBe(200);
        expect(c.json.attempt).toMatch(ATTEMPT);
        expect(c.json).not.toHaveProperty('claim');
      }
      expect(new Set(calls.map((c) => c.json.attempt)).size).toBe(3);
      expect(new Set(calls.map((c) => c.json.uploadUrl)).size).toBe(3);
    });

    it('vault/in signs the thumbnail address of the attempt for a file with a thumbnail', async () => {
      const base = await ready();
      const a = await into(base); // the first seeded file is a picture: it has a thumbnail
      expect(a.json.thumbUploadUrl).toBe(`${a.json.uploadUrl}.thumb`);
    });

    it('vault/in puts the item in the Vault at once: off the main list, in the vault list as a plain pending item', async () => {
      const base = await ready();
      const before = (await api(base, 'GET', '/files')).json.items.find((i: { id: string }) => i.id === firstId);
      expect(before).toBeTruthy();
      expect((await into(base)).status).toBe(200);
      expect((await api(base, 'GET', '/files')).json.items.some((i: { id: string }) => i.id === firstId)).toBe(false);
      expect(await stored(base)).toMatchObject({ id: firstId, encrypted: false, inVault: true, name: before.name });
    });

    it('vault/in kills the share link of the item', async () => {
      const base = await ready();
      expect((await api(base, 'PUT', `/files/${firstId}/share`, { expiresInDays: null })).status).toBe(201);
      await into(base);
      expect((await api(base, 'GET', `/files/${firstId}/share`)).status).toBe(404);
    });

    it('vault/in answers 404 for an unknown id, 409 vault_not_ready before setup, and 409 already_encrypted for an encrypted item', async () => {
      const base = await start();
      expect(await into(base)).toMatchObject({ status: 409, json: { error: { code: 'vault_not_ready' } } });
      await api(base, 'POST', '/vault/setup', setupBody());
      expect((await into(base, 'Z'.repeat(26))).status).toBe(404);
      const a = await into(base);
      await putBytes(a.json.uploadUrl, 'cipher');
      await complete(base, firstId, { attempt: a.json.attempt });
      expect(await into(base)).toMatchObject({ status: 409, json: { error: { code: 'already_encrypted' } } });
    });

    it('complete needs the attempt: 400 without one or with a malformed one, and changes nothing', async () => {
      const base = await ready();
      const a = await into(base);
      await putBytes(a.json.uploadUrl, 'cipher');
      for (const attempt of [undefined, '', 5, 'short', 'with/slash0123456789', 'with.dot01234567890']) {
        expect((await complete(base, firstId, attempt === undefined ? {} : { attempt })).status, String(attempt)).toBe(400);
      }
      expect(await stored(base)).toMatchObject({ encrypted: false });
    });

    it('complete ignores etag and claim', async () => {
      const base = await ready();
      const a = await into(base);
      await putBytes(a.json.uploadUrl, 'cipher');
      const done = await complete(base, firstId, { attempt: a.json.attempt, etag: '"whatever"', claim: 'whatever-0123456789' });
      expect(done).toMatchObject({ status: 200, json: { id: firstId, encrypted: true, inVault: true } });
    });

    it('complete answers 409 not_uploaded for an attempt nobody PUT, even when another attempt has an object', async () => {
      const base = await ready();
      const a = await into(base);
      const b = await into(base);
      await putBytes(a.json.uploadUrl, 'cipher');
      const res = await complete(base, firstId, { attempt: b.json.attempt });
      expect(res).toMatchObject({ status: 409, json: { error: { code: 'not_uploaded' } } });
      expect(await stored(base)).toMatchObject({ encrypted: false });
    });

    it('complete answers 409 size_mismatch, deletes that attempt\'s objects and keeps the other attempts', async () => {
      const base = await ready();
      const a = await into(base);
      const b = await into(base);
      await putBytes(a.json.uploadUrl, 'cipher');
      await putBytes(b.json.uploadUrl, 'a different size');
      const res = await complete(base, firstId, { attempt: b.json.attempt, size: 6 });
      expect(res).toMatchObject({ status: 409, json: { error: { code: 'size_mismatch' } } });
      expect((await obj(base, `vault/${firstId}.${b.json.attempt}`)).status).toBe(404);
      expect((await obj(base, `vault/${firstId}.${a.json.attempt}`)).status).toBe(200);
      expect(await stored(base)).toMatchObject({ encrypted: false });
    });

    it('a successful complete keeps the attempt\'s objects and does not touch other attempts', async () => {
      const base = await ready();
      const abandoned = await into(base);
      const a = await into(base);
      await putBytes(abandoned.json.uploadUrl, 'abandoned bytes');
      await putBytes(a.json.uploadUrl, 'cipher');
      expect((await complete(base, firstId, { attempt: a.json.attempt })).status).toBe(200);
      expect((await obj(base, `vault/${firstId}.${a.json.attempt}`)).status).toBe(200);
      expect((await obj(base, `vault/${firstId}.${abandoned.json.attempt}`)).status).toBe(200);
    });

    it('an abandoned attempt blocks nothing: the row stays pending, and a later vault/in and complete work', async () => {
      const base = await ready();
      await into(base); // never completed
      expect(await stored(base)).toMatchObject({ encrypted: false, inVault: true });
      const later = await into(base);
      await putBytes(later.json.uploadUrl, 'cipher');
      expect((await complete(base, firstId, { attempt: later.json.attempt })).status).toBe(200);
      expect(await stored(base)).toMatchObject({ encrypted: true, name: '' });
    });

    it('two devices: A completes, then B: B gets 200, the row keeps A\'s key, and B\'s objects are deleted', async () => {
      const base = await ready();
      const a = await into(base);
      const b = await into(base);
      await putBytes(a.json.uploadUrl, 'cipher-A');
      await putBytes(b.json.uploadUrl, 'cipher-B');
      expect((await complete(base, firstId, { attempt: a.json.attempt, size: 8, encKey: 'key-of-A' })).status).toBe(200);
      const late = await complete(base, firstId, { attempt: b.json.attempt, size: 8, encKey: 'key-of-B' });
      expect(late.status).toBe(200);
      expect(late.json).toMatchObject({ id: firstId, encrypted: true, encKey: 'key-of-A' });
      expect((await stored(base))!.encKey).toBe('key-of-A');
      // A's bytes are what the item downloads, so A's key decrypts them.
      const download = await api(base, 'GET', `/files/${firstId}/download`);
      expect(await (await fetch(download.json.url)).text()).toBe('cipher-A');
      expect((await obj(base, `vault/${firstId}.${b.json.attempt}`)).status).toBe(404);
    });

    it('two devices, the other way round: B completes first and wins, A\'s late complete changes nothing', async () => {
      const base = await ready();
      const a = await into(base);
      const b = await into(base);
      await putBytes(a.json.uploadUrl, 'cipher-A');
      await putBytes(b.json.uploadUrl, 'cipher-B');
      expect((await complete(base, firstId, { attempt: b.json.attempt, size: 8, encKey: 'key-of-B' })).status).toBe(200);
      expect((await complete(base, firstId, { attempt: a.json.attempt, size: 8, encKey: 'key-of-A' })).status).toBe(200);
      expect((await stored(base))!.encKey).toBe('key-of-B');
      expect((await obj(base, `vault/${firstId}.${a.json.attempt}`)).status).toBe(404);
      expect((await obj(base, `vault/${firstId}.${b.json.attempt}`)).status).toBe(200);
    });

    it('a retry of the winning attempt is a 200 that deletes nothing', async () => {
      const base = await ready();
      const a = await into(base);
      await putBytes(a.json.uploadUrl, 'cipher');
      await complete(base, firstId, { attempt: a.json.attempt });
      expect((await complete(base, firstId, { attempt: a.json.attempt })).status).toBe(200);
      expect((await obj(base, `vault/${firstId}.${a.json.attempt}`)).status).toBe(200);
    });

    it('complete without an attempt on an encrypted item is the move-out cleanup: 200, and the object stays', async () => {
      const base = await ready();
      const a = await into(base);
      await putBytes(a.json.uploadUrl, 'cipher');
      await complete(base, firstId, { attempt: a.json.attempt });
      const res = await complete(base, firstId);
      expect(res).toMatchObject({ status: 200, json: { encrypted: true } });
      expect((await obj(base, `vault/${firstId}.${a.json.attempt}`)).status).toBe(200);
    });

    it('permanent delete removes the item\'s attempt object and its thumbnail', async () => {
      const base = await ready();
      const a = await into(base);
      await putBytes(a.json.uploadUrl, 'cipher');
      await putBytes(a.json.thumbUploadUrl, 'thumb');
      await complete(base, firstId, { attempt: a.json.attempt, hasThumb: true });
      await api(base, 'DELETE', `/files/${firstId}`);
      expect((await api(base, 'DELETE', `/files/${firstId}/permanent`)).status).toBe(204);
      expect((await obj(base, `vault/${firstId}.${a.json.attempt}`)).status).toBe(404);
      expect((await obj(base, `vault/${firstId}.${a.json.attempt}.thumb`)).status).toBe(404);
    });

    it('a direct vault upload keeps the fixed key vault/<id>, for the download and the thumbnail', async () => {
      const base = await ready();
      const created = await api(base, 'POST', '/uploads', { name: 'a', mime: 'image/png', size: 5, hasThumb: true, vault: { encMeta: 'm', encKey: 'k' } });
      expect(created.json.uploadUrl).toContain(`/put/vault/${created.json.id}`);
      expect(created.json.uploadUrl).toMatch(/\/put\/vault\/[0-9A-F]{26}$/);
      await putBytes(created.json.uploadUrl, 'abcde');
      await putBytes(created.json.thumbUploadUrl, 'thumb');
      const done = await api(base, 'POST', `/uploads/${created.json.id}/complete`);
      expect(done.json.thumbUrl).toBe(`${created.json.uploadUrl.replace('/put/', '/obj/')}.thumb`);
      const download = await api(base, 'GET', `/files/${created.json.id}/download`);
      expect(download.json.url).toBe(created.json.uploadUrl.replace('/put/', '/obj/'));
    });
  });
});
