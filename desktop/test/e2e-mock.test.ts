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

  it('moves a plain file in and back out with the four move routes', async () => {
    const base = await start();
    await api(base, 'POST', '/vault/setup', setupBody());
    const id = String(0).padStart(26, '0'); // the first seeded picture
    const into = await api(base, 'POST', `/files/${id}/vault/in`);
    expect(into.json.uploadUrl).toContain(`/put/vault/${id}`);
    const stored = await putBytes(into.json.uploadUrl, 'cipher');
    expect(typeof into.json.claim).toBe('string'); // vault/in hands out the claim (spec 4.7c)
    const moved = await api(base, 'POST', `/files/${id}/vault/in/complete`, { encMeta: 'm', encKey: 'k', size: 6, hasThumb: false, etag: stored.headers.get('etag'), claim: into.json.claim });
    expect(moved).toMatchObject({ status: 200, json: { id, encrypted: true, inVault: true } });
    expect((await api(base, 'GET', '/files')).json.items.some((i: { id: string }) => i.id === id)).toBe(false);

    const out = await api(base, 'POST', `/files/${id}/vault/out`);
    await putBytes(out.json.uploadUrl, 'plain!');
    const back = await api(base, 'POST', `/files/${id}/vault/out/complete`, { name: 'a.txt', mime: 'text/plain', size: 6, hasThumb: false });
    expect(back).toMatchObject({ status: 200, json: { id, name: 'a.txt', encrypted: false, inVault: false } });
    const plain = (await api(base, 'GET', '/files')).json.items.find((i: { id: string }) => i.id === id);
    expect(plain).toMatchObject({ name: 'a.txt', size: 6 });
    expect(await (await fetch(`${base}/raw/${id}`)).text()).toBe('plain!');
  });

  describe('the ETag of a stored object and the move-in etag check (like worker/src/vault.ts, review C1)', () => {
    const firstId = String(0).padStart(26, '0'); // a seeded plain file
    const complete = (base: string, id: string, extra: Record<string, unknown> = {}) =>
      api(base, 'POST', `/files/${id}/vault/in/complete`, { encMeta: 'm', encKey: 'k', size: 6, hasThumb: false, ...extra });

    /** Moves `id` in up to the point of the PUT; returns the ETag header the mock answered for the object. */
    async function stage(base: string, id: string, bytes = 'cipher') {
      await api(base, 'POST', '/vault/setup', setupBody());
      const into = await api(base, 'POST', `/files/${id}/vault/in`);
      const res = await putBytes(into.json.uploadUrl, bytes);
      return { into, put: res, etag: res.headers.get('etag'), claim: into.json.claim as string };
    }

    it('answers a PUT of a stored object with a non-empty ETag header', async () => {
      const base = await start();
      const { put, etag } = await stage(base, firstId);
      expect(put.status).toBe(200);
      expect(etag).toBeTruthy();
      expect(etag!.length).toBeLessThanOrEqual(200);
    });

    it('answers the PUT of a thumbnail with an ETag header too', async () => {
      const base = await start();
      const { into } = await stage(base, firstId);
      const res = await putBytes(`${base}/put/vault/${firstId}.thumb`, 'thumbnail');
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBeTruthy();
      expect(into.json.uploadUrl).toContain(`/put/vault/${firstId}`);
    });

    it('gives an overwrite with different bytes a different ETag', async () => {
      const base = await start();
      const { into, etag } = await stage(base, firstId, 'cipher');
      const other = await putBytes(into.json.uploadUrl, 'CIPHER');
      expect(other.headers.get('etag')).toBeTruthy();
      expect(other.headers.get('etag')).not.toBe(etag);
    });

    it('completes a move in with the ETag of the last PUT, quoted or not', async () => {
      const base = await start();
      const { etag, claim } = await stage(base, firstId);
      const bare = etag!.replace(/^"|"$/g, '');
      expect((await complete(base, firstId, { etag: bare, claim })).status).toBe(200);

      const base2 = await start();
      const second = await stage(base2, firstId);
      expect((await complete(base2, firstId, { etag: second.etag, claim: second.claim })).status).toBe(200);
    });

    it.each([
      ['missing', {}],
      ['empty', { etag: '' }],
      ['not a string', { etag: 5 }],
      ['over 200 characters', { etag: 'a'.repeat(201) }],
    ])('refuses a move in of a file whose etag is %s with 400 and changes nothing', async (_name, extra) => {
      const base = await start();
      const { claim } = await stage(base, firstId);
      const res = await complete(base, firstId, { claim, ...extra });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('bad_request');
      expect((await api(base, 'GET', '/files')).json.items.some((i: { id: string }) => i.id === firstId)).toBe(true);
      expect((await fetch(`${base}/raw/${firstId}`)).status).toBe(200);
    });

    it('answers 409 item_changed when another PUT replaced the object, and then neither writes the row nor removes the plain file', async () => {
      const base = await start();
      const { into, etag, claim } = await stage(base, firstId, 'cipher');
      await putBytes(into.json.uploadUrl, 'CIPHER'); // the other device
      const res = await complete(base, firstId, { etag, claim });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('item_changed');
      expect((await api(base, 'GET', '/files?vault=1', undefined, VAULT_HEADERS)).json.items.map((i: { id: string }) => i.id)).not.toContain(firstId);
      expect((await api(base, 'GET', '/files')).json.items.some((i: { id: string }) => i.id === firstId)).toBe(true);
      expect((await fetch(`${base}/raw/${firstId}`)).status).toBe(200);
    });

    it('lets the client start over after a 409: a new PUT and its own ETag complete the move in', async () => {
      const base = await start();
      const { into, etag, claim } = await stage(base, firstId, 'cipher');
      await putBytes(into.json.uploadUrl, 'CIPHER');
      expect((await complete(base, firstId, { etag, claim })).status).toBe(409);
      // The 409 kept the claim (cut to 16 minutes after issue): once that has passed the client asks vault/in again and completes with the new claim.
      expect((await api(base, 'POST', `/files/${firstId}/vault/in`)).json.error.code).toBe('item_busy');
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 17 * 60 * 1000 });
      try {
        const again = await api(base, 'POST', `/files/${firstId}/vault/in`);
        expect(again.status).toBe(200);
        const mine = await putBytes(again.json.uploadUrl, 'second');
        const done = await complete(base, firstId, { etag: mine.headers.get('etag'), size: 6, claim: again.json.claim });
        expect(done).toMatchObject({ status: 200, json: { id: firstId, encrypted: true, inVault: true } });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not compare the etag again once the row is encrypted (a retry answers 200)', async () => {
      const base = await start();
      const { etag, claim } = await stage(base, firstId);
      expect((await complete(base, firstId, { etag, claim })).status).toBe(200);
      expect((await complete(base, firstId, { etag: 'some-other-etag' })).status).toBe(200);
    });

    it('still reports an object that was never uploaded as 409 not_uploaded', async () => {
      const base = await start();
      await api(base, 'POST', '/vault/setup', setupBody());
      const into = await api(base, 'POST', `/files/${firstId}/vault/in`);
      const res = await complete(base, firstId, { etag: '"whatever"', claim: into.json.claim });
      expect(res).toMatchObject({ status: 409, json: { error: { code: 'not_uploaded' } } });
    });
  });
  describe('the per-item write claim of vault/in (like worker/src/vault.ts, spec 4.7c)', () => {
    const firstId = String(0).padStart(26, '0'); // a seeded plain file
    const complete = (base: string, id: string, extra: Record<string, unknown> = {}) =>
      api(base, 'POST', `/files/${id}/vault/in/complete`, { encMeta: 'm', encKey: 'k', size: 6, hasThumb: false, ...extra });
    const into = (base: string, id = firstId) => api(base, 'POST', `/files/${id}/vault/in`);
    const isPlain = async (base: string, id = firstId) => (await api(base, 'GET', '/files')).json.items.some((i: { id: string }) => i.id === id);
    const vaultKey = async (base: string, id = firstId) =>
      (await api(base, 'GET', '/files?vault=1', undefined, VAULT_HEADERS)).json.items.find((i: { id: string }) => i.id === id)?.encKey;

    async function ready() {
      const base = await start();
      await api(base, 'POST', '/vault/setup', setupBody());
      return base;
    }

    it('hands out a claim of at least 16 base64url characters with the addresses', async () => {
      const base = await ready();
      const res = await into(base);
      expect(res.status).toBe(200);
      expect(res.json.claim).toMatch(/^[A-Za-z0-9_-]{16,}$/);
      expect(res.json.uploadUrl).toContain(`/put/vault/${firstId}`);
    });

    it('refuses a second vault/in while the claim is held: 409 item_busy and no address', async () => {
      const base = await ready();
      const first = await into(base);
      const second = await into(base);
      expect(second.status).toBe(409);
      expect(second.json.error.code).toBe('item_busy');
      expect(second.json.uploadUrl).toBeUndefined();
      expect(second.json.claim).toBeUndefined();
      // The holder still completes with its own claim.
      const stored = await putBytes(first.json.uploadUrl, 'cipher');
      expect((await complete(base, firstId, { etag: stored.headers.get('etag'), claim: first.json.claim })).status).toBe(200);
    });

    it('claims different items independently', async () => {
      const base = await ready();
      const other = String(1).padStart(26, '0');
      expect((await into(base, firstId)).status).toBe(200);
      expect((await into(base, other)).status).toBe(200);
    });

    it('needs the claim to complete: without it, or with another one, answers 409 item_busy and changes nothing', async () => {
      const base = await ready();
      const first = await into(base);
      const stored = await putBytes(first.json.uploadUrl, 'cipher');
      const etag = stored.headers.get('etag');
      for (const extra of [{ etag }, { etag, claim: 'not-the-claim-0123456789' }]) {
        const res = await complete(base, firstId, extra);
        expect(res.status).toBe(409);
        expect(res.json.error.code).toBe('item_busy');
      }
      expect(await isPlain(base)).toBe(true);
      expect((await fetch(`${base}/raw/${firstId}`)).status).toBe(200);
      expect(await vaultKey(base)).toBeUndefined();
      // A wrong claim does not release it: the item is still busy, and the right claim still completes.
      expect((await into(base)).status).toBe(409);
      expect((await complete(base, firstId, { etag, claim: first.json.claim })).status).toBe(200);
    });

    it('refuses a claim that is not a string with 400', async () => {
      const base = await ready();
      const first = await into(base);
      const stored = await putBytes(first.json.uploadUrl, 'cipher');
      const res = await complete(base, firstId, { etag: stored.headers.get('etag'), claim: 5 });
      expect(res.status).toBe(400);
      expect(await isPlain(base)).toBe(true);
    });

    const MIN = 60 * 1000;
    /** Only `Date` is faked, so the real HTTP server and fetch keep working while the clock jumps. */
    const clock = () => vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 14, 12, 0, 0) });
    const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
    afterEach(() => vi.useRealTimers());

    it('keeps the claim for 2 hours: busy at 119 minutes, a new claim after 121', async () => {
      clock();
      const base = await ready();
      const first = await into(base);
      later(119 * MIN);
      expect((await into(base)).json.error.code).toBe('item_busy');
      later(2 * MIN);
      const next = await into(base);
      expect(next.status).toBe(200);
      expect(next.json.claim).not.toBe(first.json.claim);
    });

    it('does not accept a complete of an expired claim (2 hours + 1 minute): 409 item_busy, nothing changes', async () => {
      clock();
      const base = await ready();
      const first = await into(base);
      const stored = await putBytes(first.json.uploadUrl, 'cipher');
      later(121 * MIN);
      const res = await complete(base, firstId, { etag: stored.headers.get('etag'), claim: first.json.claim });
      expect(res.json.error.code).toBe('item_busy');
      expect(await isPlain(base)).toBe(true);
    });

    describe('409 item_changed and size_mismatch keep the claim and cut it to issued + 16 minutes', () => {
      /** vault/in, then a PUT of A, then another PUT of the same size: A's etag no longer matches. */
      async function overwritten(base: string) {
        const first = await into(base);
        const stored = await putBytes(first.json.uploadUrl, 'cipher');
        await putBytes(first.json.uploadUrl, 'CIPHER'); // another device overwrote it
        return { first, etagA: stored.headers.get('etag') };
      }

      it('item_changed: vault/in answers 409 item_busy with no address for 16 minutes after issue, then gives a new claim', async () => {
        clock();
        const base = await ready();
        const { first, etagA } = await overwritten(base);
        later(5 * MIN);
        expect((await complete(base, firstId, { etag: etagA, claim: first.json.claim })).json.error.code).toBe('item_changed');

        later(5 * MIN); // 10 minutes after issue
        const busy = await into(base);
        expect(busy.status).toBe(409);
        expect(busy.json.error.code).toBe('item_busy');
        expect(busy.json.uploadUrl).toBeUndefined();
        expect(busy.json.claim).toBeUndefined();

        later(7 * MIN); // 17 minutes after issue, long before the original 2 hours
        const again = await into(base);
        expect(again.status).toBe(200);
        expect(again.json.claim).not.toBe(first.json.claim);
      });

      it('size_mismatch: the same', async () => {
        clock();
        const base = await ready();
        const first = await into(base);
        const stored = await putBytes(first.json.uploadUrl, 'cipher');
        expect((await complete(base, firstId, { etag: stored.headers.get('etag'), claim: first.json.claim, size: 99 })).json.error.code).toBe('size_mismatch');
        later(10 * MIN);
        expect((await into(base)).json.error.code).toBe('item_busy');
        later(7 * MIN);
        expect((await into(base)).status).toBe(200);
      });

      it('the cut counts from the issue, not from the refusal: a refusal 14 minutes after issue leaves 2 minutes', async () => {
        clock();
        const base = await ready();
        const { first, etagA } = await overwritten(base);
        later(14 * MIN);
        expect((await complete(base, firstId, { etag: etagA, claim: first.json.claim })).json.error.code).toBe('item_changed');
        later(3 * MIN); // 17 minutes after issue
        expect((await into(base)).status).toBe(200);
      });

      it('the holder still completes with the old claim while the cut claim lives, and not after it', async () => {
        clock();
        const base = await ready();
        const { first, etagA } = await overwritten(base);
        expect((await complete(base, firstId, { etag: etagA, claim: first.json.claim })).json.error.code).toBe('item_changed');
        const current = await putBytes(first.json.uploadUrl, 'third!');
        later(10 * MIN);
        const ok = await complete(base, firstId, { etag: current.headers.get('etag'), claim: first.json.claim });
        expect(ok).toMatchObject({ status: 200, json: { id: firstId, encrypted: true } });
      });

      it('after the cut claim passed, a complete with the old claim answers 409 item_busy and the row stays plain', async () => {
        clock();
        const base = await ready();
        const { first, etagA } = await overwritten(base);
        expect((await complete(base, firstId, { etag: etagA, claim: first.json.claim })).json.error.code).toBe('item_changed');
        const current = await putBytes(first.json.uploadUrl, 'third!');
        later(17 * MIN);
        const res = await complete(base, firstId, { etag: current.headers.get('etag'), claim: first.json.claim });
        expect(res.status).toBe(409);
        expect(res.json.error.code).toBe('item_busy');
        expect(await isPlain(base)).toBe(true);
      });

      it('a request with a wrong claim reduces nothing: the claim lives its full 2 hours', async () => {
        clock();
        const base = await ready();
        const { etagA } = await overwritten(base);
        expect((await complete(base, firstId, { etag: etagA, claim: 'not-the-claim-0123456789' })).json.error.code).toBe('item_busy');
        later(30 * MIN);
        expect((await into(base)).json.error.code).toBe('item_busy');
        later(91 * MIN);
        expect((await into(base)).status).toBe(200);
      });
    });

    it('two devices: B is refused its addresses while A holds the claim; A completes; B\'s late complete is an idempotent 200 that keeps A\'s key', async () => {
      const base = await ready();
      const a = await into(base);
      const b = await into(base);
      expect(b.status).toBe(409);
      expect(b.json.error.code).toBe('item_busy');
      const stored = await putBytes(a.json.uploadUrl, 'cipher');
      expect((await complete(base, firstId, { encKey: 'key-of-A', etag: stored.headers.get('etag'), claim: a.json.claim })).status).toBe(200);

      const late = await complete(base, firstId, { encKey: 'key-of-B', etag: '"whatever"', claim: 'b-has-no-claim-0123456789' });
      expect(late.status).toBe(200);
      expect(late.json).toMatchObject({ id: firstId, encrypted: true });
      expect(await vaultKey(base)).toBe('key-of-A');
    });
  });
});
