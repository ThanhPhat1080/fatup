import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { newSetup, VAULT_WIPE_AT, type VaultSetupRequest, type VaultStatus } from '@fatup/shared';
import { createApp } from '../src/app';

const fakePresigner = () => ({
  put: async (key: string) => `https://r2.test/put/${key}`,
  get: async (key: string) => `https://r2.test/get/${key}`,
});

const app = createApp({ presigner: fakePresigner });
const AUTH = { Authorization: 'Bearer test-token' };

function call(path: string, init: RequestInit = {}) {
  return app.request(path, { ...init, headers: { ...AUTH, ...(init.headers ?? {}) } }, env);
}

function send(method: string, path: string, body: unknown) {
  return call(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

const setupVault = (body: unknown) => send('POST', '/vault/setup', body);
const unlock = (authKey: unknown) => send('POST', '/vault/unlock', { authKey });
const recover = (rkAuth: unknown) => send('POST', '/vault/recover', { rkAuth });
const changePin = (body: unknown) => send('PUT', '/vault/pin', body);

/** A well-formed base64 value that matches nothing the server stored. */
function randomB64(bytes = 32): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))));
}

/** A realistic setup body (real FUV1 key material, 1000 PBKDF2 rounds to keep the test fast). */
async function makeSetup(pin = '135790'): Promise<VaultSetupRequest> {
  return (await newSetup(pin, { iterations: 1000 })).request;
}

type Row = {
  failed_attempts: number;
  locked_until: number | null;
  auth_hash: string | null;
  server_secret: string | null;
  wrapped_mk_pin: string | null;
  rk_auth_hash: string;
  wrapped_mk_recovery: string;
  kdf_salt: string;
  kdf_iterations: number;
};

async function row(): Promise<Row> {
  return (await env.DB.prepare('SELECT * FROM vault_keys WHERE id = 1').first<Row>())!;
}

async function rowCount(): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM vault_keys').first<{ n: number }>())!.n;
}

/** Pretends the lock has run out, so a test never waits for real time. */
async function expireLock() {
  await env.DB.prepare('UPDATE vault_keys SET locked_until = ?').bind(Date.now() - 1000).run();
}

async function status(): Promise<VaultStatus> {
  const res = await call('/vault');
  expect(res.status).toBe(200);
  return (await res.json()) as VaultStatus;
}

async function setupOk(pin?: string): Promise<VaultSetupRequest> {
  const s = await makeSetup(pin);
  const res = await setupVault(s);
  expect(res.status).toBe(201);
  return s;
}

/** Sends `n` wrong unlocks one after another, lifting any lock in between. Returns the last response. */
async function wrongUnlocks(n: number): Promise<Response> {
  let last!: Response;
  for (let i = 0; i < n; i++) {
    await expireLock();
    last = await unlock(randomB64());
  }
  return last;
}

async function wipe() {
  const res = await wrongUnlocks(VAULT_WIPE_AT);
  expect(res.status).toBe(410);
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM vault_keys').run();
  await env.DB.prepare('DELETE FROM shares').run();
  await env.DB.prepare('DELETE FROM files').run();
});

describe('vault routes: authentication', () => {
  it('answers 401 without a token on every vault route', async () => {
    const s = await makeSetup();
    const noAuth = (method: string, path: string, body?: unknown) =>
      app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    expect((await noAuth('GET', '/vault')).status).toBe(401);
    expect((await noAuth('POST', '/vault/setup', s)).status).toBe(401);
    expect((await noAuth('POST', '/vault/unlock', { authKey: s.authKey })).status).toBe(401);
    expect((await noAuth('POST', '/vault/recover', { rkAuth: s.rkAuth })).status).toBe(401);
    expect((await noAuth('PUT', '/vault/pin', { proof: { authKey: s.authKey }, ...s })).status).toBe(401);
    expect(await rowCount()).toBe(0);
  });
});

describe('GET /vault', () => {
  it('reports state none with a full attempt budget when nothing is set up', async () => {
    const res = await call('/vault');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ state: 'none', failedAttempts: 0, lockedUntil: null, remaining: 10 });
    expect(body).not.toHaveProperty('kdf');
  });

  it('reports state ready with the kdf parameters the setup sent', async () => {
    const s = await setupOk();
    const st = await status();
    expect(st.state).toBe('ready');
    expect(st.kdf).toEqual({ salt: s.kdfSalt, iterations: s.kdfIterations });
    expect(st.failedAttempts).toBe(0);
    expect(st.lockedUntil).toBeNull();
    expect(st.remaining).toBe(10);
  });

  it('counts down remaining and failedAttempts after wrong PINs', async () => {
    await setupOk();
    await wrongUnlocks(3);
    const st = await status();
    expect(st.failedAttempts).toBe(3);
    expect(st.remaining).toBe(7);
    expect(st.lockedUntil).toBeNull();
  });

  it('shows lockedUntil while the vault is locked', async () => {
    await setupOk();
    await wrongUnlocks(5);
    const st = await status();
    expect(st.state).toBe('ready');
    expect(st.remaining).toBe(5);
    expect(st.lockedUntil).toBeGreaterThan(Date.now());
  });

  it('reports state wiped after ten wrong PINs', async () => {
    await setupOk();
    await wipe();
    const st = await status();
    expect(st.state).toBe('wiped');
    expect(st.remaining).toBe(0);
  });

  it('never returns a secret, a hash or a wrapped key in any state', async () => {
    const s = await setupOk();
    const secrets = [s.serverSecret, s.wrappedMkPin, s.wrappedMkRecovery, s.authKey, s.rkAuth];
    const check = async () => {
      const res = await call('/vault');
      const text = await res.text();
      for (const v of secrets) expect(text).not.toContain(v);
      for (const k of ['server_secret', 'auth_hash', 'wrapped']) expect(text).not.toContain(k);
      for (const k of ['serverSecret', 'authKey', 'rkAuth', 'wrappedMkPin', 'wrappedMkRecovery']) expect(text).not.toContain(k);
    };
    await check();
    await wrongUnlocks(2);
    await check();
    await wipe();
    await check();
  });
});

describe('POST /vault/setup', () => {
  it('creates the vault and answers 201', async () => {
    const s = await makeSetup();
    const res = await setupVault(s);
    expect(res.status).toBe(201);
    expect(await rowCount()).toBe(1);
    const r = await row();
    expect(r.kdf_salt).toBe(s.kdfSalt);
    expect(r.kdf_iterations).toBe(s.kdfIterations);
    expect(r.server_secret).toBe(s.serverSecret);
    expect(r.wrapped_mk_pin).toBe(s.wrappedMkPin);
    expect(r.wrapped_mk_recovery).toBe(s.wrappedMkRecovery);
    expect(r.failed_attempts).toBe(0);
    expect(r.locked_until).toBeNull();
  });

  it('stores only a SHA-256 hex digest of authKey and rkAuth, never the values', async () => {
    const s = await setupOk();
    const r = await row();
    expect(r.auth_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.rk_auth_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.auth_hash).not.toBe(s.authKey);
    expect(r.rk_auth_hash).not.toBe(s.rkAuth);
    expect(r.auth_hash).not.toBe(r.rk_auth_hash);
  });

  it('refuses a second setup with 409 vault_exists and keeps the first one', async () => {
    const first = await setupOk();
    const second = await makeSetup('246801');
    const res = await setupVault(second);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('vault_exists');
    expect(await rowCount()).toBe(1);
    expect((await row()).server_secret).toBe(first.serverSecret);
    expect((await unlock(first.authKey)).status).toBe(200);
    expect((await unlock(second.authKey)).status).toBe(403);
  });

  it('refuses a setup over a wiped vault too (only PUT /vault/pin can revive it)', async () => {
    const first = await setupOk();
    await wipe();
    const res = await setupVault(await makeSetup('246801'));
    expect(res.status).toBe(409);
    expect((await status()).state).toBe('wiped');
    expect((await row()).rk_auth_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await recover(first.rkAuth)).status).toBe(200);
  });

  const FIELDS: (keyof VaultSetupRequest)[] = ['kdfSalt', 'kdfIterations', 'authKey', 'serverSecret', 'wrappedMkPin', 'rkAuth', 'wrappedMkRecovery'];

  for (const field of FIELDS) {
    it(`answers 400 when ${field} is missing and creates nothing`, async () => {
      const s = await makeSetup();
      const body: Partial<VaultSetupRequest> = { ...s };
      delete body[field];
      const res = await setupVault(body);
      expect(res.status).toBe(400);
      expect(await rowCount()).toBe(0);
    });
  }

  for (const field of FIELDS.filter((f) => f !== 'kdfIterations')) {
    it(`answers 400 when ${field} is not base64 and creates nothing`, async () => {
      const s = await makeSetup();
      const res = await setupVault({ ...s, [field]: 'not base64 !!!' });
      expect(res.status).toBe(400);
      expect(await rowCount()).toBe(0);
    });
  }

  it('answers 400 when kdfIterations is not a positive integer', async () => {
    const s = await makeSetup();
    for (const bad of [0, -5, 1.5, '1000', null]) {
      const res = await setupVault({ ...s, kdfIterations: bad });
      expect(res.status).toBe(400);
    }
    expect(await rowCount()).toBe(0);
  });

  it('answers 400 when the body is not JSON', async () => {
    const res = await call('/vault/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'nope' });
    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  it('accepts a valid setup after a rejected one', async () => {
    const s = await makeSetup();
    expect((await setupVault({ ...s, authKey: '***' })).status).toBe(400);
    expect((await setupVault(s)).status).toBe(201);
  });
});

describe('POST /vault/unlock', () => {
  it('returns serverSecret and wrappedMkPin exactly as the setup stored them', async () => {
    const s = await setupOk();
    const res = await unlock(s.authKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ serverSecret: s.serverSecret, wrappedMkPin: s.wrappedMkPin });
  });

  it('resets the failed-attempt counter to 0 on the right PIN', async () => {
    const s = await setupOk();
    await wrongUnlocks(3);
    expect((await row()).failed_attempts).toBe(3);
    expect((await unlock(s.authKey)).status).toBe(200);
    const r = await row();
    expect(r.failed_attempts).toBe(0);
    expect(r.locked_until).toBeNull();
    expect((await status()).remaining).toBe(10);
  });

  it('answers 403 with remaining 9..6 and no lock for wrong PINs 1 to 4', async () => {
    await setupOk();
    for (let i = 1; i <= 4; i++) {
      const res = await unlock(randomB64());
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ remaining: 10 - i, lockedUntil: null });
      expect((await row()).failed_attempts).toBe(i);
    }
  });

  it('locks for one minute on the 5th wrong PIN', async () => {
    await setupOk();
    await wrongUnlocks(4);
    const before = Date.now();
    const res = await unlock(randomB64());
    expect(res.status).toBe(423);
    const body = (await res.json()) as { remaining: number; lockedUntil: number };
    expect(body.remaining).toBe(5);
    expect(body.lockedUntil).toBeGreaterThanOrEqual(before + 60_000 - 5000);
    expect(body.lockedUntil).toBeLessThanOrEqual(Date.now() + 60_000 + 5000);
    const r = await row();
    expect(r.failed_attempts).toBe(5);
    expect(r.locked_until).toBe(body.lockedUntil);
  });

  it('refuses every unlock with 423 while locked, even the right PIN, without counting', async () => {
    const s = await setupOk();
    await wrongUnlocks(5);
    const lockedUntil = (await row()).locked_until;

    const right = await unlock(s.authKey);
    expect(right.status).toBe(423);
    const body = (await right.json()) as Record<string, unknown>;
    expect(body.lockedUntil).toBe(lockedUntil);
    expect(body).not.toHaveProperty('serverSecret');
    expect(body).not.toHaveProperty('wrappedMkPin');

    expect((await unlock(randomB64())).status).toBe(423);
    const r = await row();
    expect(r.failed_attempts).toBe(5);
    expect(r.locked_until).toBe(lockedUntil);
  });

  it('accepts the right PIN again once the lock has run out', async () => {
    const s = await setupOk();
    await wrongUnlocks(5);
    await expireLock();
    const res = await unlock(s.authKey);
    expect(res.status).toBe(200);
    expect((await row()).failed_attempts).toBe(0);
  });

  it('locks for 15 minutes on each of wrong PINs 6 to 9', async () => {
    await setupOk();
    await wrongUnlocks(5);
    for (let i = 6; i <= 9; i++) {
      await expireLock();
      const before = Date.now();
      const res = await unlock(randomB64());
      expect(res.status).toBe(423);
      const body = (await res.json()) as { remaining: number; lockedUntil: number };
      expect(body.remaining).toBe(10 - i);
      expect(body.lockedUntil).toBeGreaterThanOrEqual(before + 900_000 - 5000);
      expect(body.lockedUntil).toBeLessThanOrEqual(Date.now() + 900_000 + 5000);
      expect((await row()).failed_attempts).toBe(i);
    }
  });

  it('wipes the server-held secrets on the 10th wrong PIN and answers 410 vault_wiped', async () => {
    await setupOk();
    await wrongUnlocks(9);
    await expireLock();
    const res = await unlock(randomB64());
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('vault_wiped');
    const r = await row();
    expect(r.auth_hash).toBeNull();
    expect(r.server_secret).toBeNull();
    expect(r.wrapped_mk_pin).toBeNull();
    // The recovery path must survive the wipe.
    expect(r.rk_auth_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.wrapped_mk_recovery).toBeTruthy();
    expect((await status()).state).toBe('wiped');
  });

  it('keeps answering 410 after the wipe, even for the right PIN', async () => {
    const s = await setupOk();
    await wipe();
    expect((await unlock(s.authKey)).status).toBe(410);
    expect((await unlock(randomB64())).status).toBe(410);
    expect((await row()).server_secret).toBeNull();
  });

  it('answers 409 vault_not_ready before any setup', async () => {
    const res = await unlock(randomB64());
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('vault_not_ready');
    expect(await rowCount()).toBe(0);
  });

  it('answers 400 without counting when authKey is missing or not base64', async () => {
    await setupOk();
    expect((await send('POST', '/vault/unlock', {})).status).toBe(400);
    expect((await unlock('***not base64***')).status).toBe(400);
    expect((await unlock(123)).status).toBe(400);
    expect((await row()).failed_attempts).toBe(0);
  });

  it('counts exactly 5 when five wrong PINs arrive in parallel', async () => {
    await setupOk();
    const results = await Promise.all(Array.from({ length: 5 }, () => unlock(randomB64())));
    const r = await row();
    expect(r.failed_attempts).toBe(5);
    expect(r.locked_until).not.toBeNull();
    const codes = results.map((x) => x.status).sort();
    expect(codes).toEqual([403, 403, 403, 403, 423]);
  });

  it('cannot be pushed past the lock by a burst of parallel wrong PINs', async () => {
    await setupOk();
    const results = await Promise.all(Array.from({ length: 12 }, () => unlock(randomB64())));
    expect((await row()).failed_attempts).toBe(5);
    expect(results.filter((x) => x.status === 403)).toHaveLength(4);
    expect(results.filter((x) => x.status === 423)).toHaveLength(8);
  });
});

describe('POST /vault/recover', () => {
  it('returns wrappedMkRecovery for the right rkAuth', async () => {
    const s = await setupOk();
    const res = await recover(s.rkAuth);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wrappedMkRecovery: s.wrappedMkRecovery });
  });

  it('answers 403 for a wrong rkAuth and reveals nothing', async () => {
    const s = await setupOk();
    const res = await recover(randomB64());
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain(s.wrappedMkRecovery);
    expect(text).not.toContain('wrappedMkRecovery');
  });

  it('does not touch the PIN attempt counter, right or wrong', async () => {
    const s = await setupOk();
    await wrongUnlocks(2);
    await recover(randomB64());
    await recover(s.rkAuth);
    expect((await row()).failed_attempts).toBe(2);
  });

  it('still works while the PIN is locked', async () => {
    const s = await setupOk();
    await wrongUnlocks(5);
    expect((await recover(s.rkAuth)).status).toBe(200);
  });

  it('works after the secrets were wiped', async () => {
    const s = await setupOk();
    await wipe();
    const res = await recover(s.rkAuth);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wrappedMkRecovery: s.wrappedMkRecovery });
    expect((await recover(randomB64())).status).toBe(403);
  });

  it('does not accept the PIN authKey in place of rkAuth', async () => {
    const s = await setupOk();
    expect((await recover(s.authKey)).status).toBe(403);
  });

  it('answers 400 when rkAuth is missing or not base64', async () => {
    await setupOk();
    expect((await send('POST', '/vault/recover', {})).status).toBe(400);
    expect((await recover('***')).status).toBe(400);
  });

  it('answers 409 vault_not_ready before any setup', async () => {
    const res = await recover(randomB64());
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('vault_not_ready');
  });
});

describe('PUT /vault/pin', () => {
  it('lets rkAuth set a new PIN on a wiped vault: ready again, counter 0, new keys unlock', async () => {
    const old = await setupOk();
    await wipe();
    const next = await makeSetup('246801');

    const res = await changePin({ proof: { rkAuth: old.rkAuth }, kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin });
    expect(res.status).toBe(200);

    const st = await status();
    expect(st.state).toBe('ready');
    expect(st.failedAttempts).toBe(0);
    expect(st.lockedUntil).toBeNull();
    expect(st.remaining).toBe(10);
    expect(st.kdf).toEqual({ salt: next.kdfSalt, iterations: next.kdfIterations });
    const r = await row();
    expect(r.failed_attempts).toBe(0);
    expect(r.locked_until).toBeNull();

    const ok = await unlock(next.authKey);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin });
    expect((await unlock(old.authKey)).status).toBe(403);
  });

  it('keeps the recovery material when the PIN changes', async () => {
    const old = await setupOk();
    await wipe();
    const next = await makeSetup('246801');
    await changePin({ proof: { rkAuth: old.rkAuth }, kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin });
    const res = await recover(old.rkAuth);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wrappedMkRecovery: old.wrappedMkRecovery });
  });

  it('lets rkAuth reset the PIN while the vault is locked', async () => {
    const old = await setupOk();
    await wrongUnlocks(5);
    const next = await makeSetup('246801');
    const res = await changePin({ proof: { rkAuth: old.rkAuth }, kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin });
    expect(res.status).toBe(200);
    expect((await row()).failed_attempts).toBe(0);
    expect((await unlock(next.authKey)).status).toBe(200);
  });

  it('accepts the right old authKey, resets the counter and swaps the PIN material', async () => {
    const old = await setupOk();
    await wrongUnlocks(2);
    const next = await makeSetup('246801');
    const res = await changePin({ proof: { authKey: old.authKey }, kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin });
    expect(res.status).toBe(200);
    expect((await row()).failed_attempts).toBe(0);
    const ok = await unlock(next.authKey);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin });
    expect((await unlock(old.authKey)).status).toBe(403);
  });

  it('counts a wrong old authKey like a wrong unlock and changes nothing', async () => {
    const old = await setupOk();
    const next = await makeSetup('246801');
    const body = { kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin };
    const res = await changePin({ proof: { authKey: randomB64() }, ...body });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ remaining: 9, lockedUntil: null });
    expect((await row()).failed_attempts).toBe(1);
    // The old PIN is still the PIN.
    expect((await unlock(next.authKey)).status).toBe(403);
    expect((await unlock(old.authKey)).status).toBe(200);
  });

  it('locks on the 5th wrong old authKey, exactly as unlock does', async () => {
    await setupOk();
    const next = await makeSetup('246801');
    const body = { kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin };
    for (let i = 1; i <= 4; i++) expect((await changePin({ proof: { authKey: randomB64() }, ...body })).status).toBe(403);
    const res = await changePin({ proof: { authKey: randomB64() }, ...body });
    expect(res.status).toBe(423);
    const lockedUntil = ((await res.json()) as { lockedUntil: number }).lockedUntil;
    expect(lockedUntil).toBeGreaterThan(Date.now() + 55_000);
    expect(lockedUntil).toBeLessThan(Date.now() + 65_000);
    expect((await row()).failed_attempts).toBe(5);
  });

  it('shares the counter with unlock: wrong PINs from both routes add up', async () => {
    await setupOk();
    const next = await makeSetup('246801');
    const body = { kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin };
    await unlock(randomB64());
    await unlock(randomB64());
    await changePin({ proof: { authKey: randomB64() }, ...body });
    expect((await row()).failed_attempts).toBe(3);
  });

  it('refuses a right old authKey with 423 while locked and counts nothing', async () => {
    const old = await setupOk();
    await wrongUnlocks(5);
    const next = await makeSetup('246801');
    const res = await changePin({ proof: { authKey: old.authKey }, kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin });
    expect(res.status).toBe(423);
    expect((await row()).failed_attempts).toBe(5);
    expect((await row()).server_secret).toBe(old.serverSecret);
  });

  it('answers 403 for a wrong rkAuth and changes nothing', async () => {
    const old = await setupOk();
    const next = await makeSetup('246801');
    const res = await changePin({ proof: { rkAuth: randomB64() }, kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin });
    expect(res.status).toBe(403);
    expect((await unlock(old.authKey)).status).toBe(200);
    expect((await row()).server_secret).toBe(old.serverSecret);
  });

  it('answers 400 for a missing proof or a missing / non-base64 new field and changes nothing', async () => {
    const old = await setupOk();
    const next = await makeSetup('246801');
    const body = { kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin };
    expect((await changePin(body)).status).toBe(400);
    expect((await changePin({ proof: {}, ...body })).status).toBe(400);
    expect((await changePin({ proof: { rkAuth: old.rkAuth }, ...body, serverSecret: undefined })).status).toBe(400);
    expect((await changePin({ proof: { rkAuth: old.rkAuth }, ...body, wrappedMkPin: '***' })).status).toBe(400);
    expect((await changePin({ proof: { rkAuth: old.rkAuth }, ...body, kdfIterations: 0 })).status).toBe(400);
    expect((await row()).server_secret).toBe(old.serverSecret);
    expect((await row()).failed_attempts).toBe(0);
  });

  it('answers 409 vault_not_ready before any setup', async () => {
    const next = await makeSetup('246801');
    const res = await changePin({ proof: { rkAuth: next.rkAuth }, kdfSalt: next.kdfSalt, kdfIterations: next.kdfIterations, authKey: next.authKey, serverSecret: next.serverSecret, wrappedMkPin: next.wrappedMkPin });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('vault_not_ready');
    expect(await rowCount()).toBe(0);
  });
});
