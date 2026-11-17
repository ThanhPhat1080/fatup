import { describe, expect, it, vi } from 'vitest';
import {
  VAULT_WIPE_AT,
  decryptBytes,
  decryptMeta,
  derivePinKeys,
  encryptBytes,
  isWeakVaultPin,
  kekFrom,
  newRecoveryKey,
  parseRecoveryKey,
  recoveryKeys,
  unwrapFileKey,
  unwrapMasterKey,
  vaultLockMs,
  type FileItem,
  type VaultMeta,
  type VaultPinRequest,
  type VaultSetupRequest,
  type VaultStatus,
} from '@fatup/shared';
import { ApiError } from '../src/main/api';
import { VaultSession } from '../src/vault-session';

// Small on purpose: production uses 600 000; the tests only need the shape.
const ITERATIONS = 1000;
const NOW = 1_700_000_000_000;
const PIN = '135792';
const PIN2 = '246810';
const APP_PIN = '4821';

type Client = ReturnType<ConstructorParameters<typeof VaultSession>[0]['client']>;

/** An ApiError the way ApiClient builds it: the parsed JSON body stays on the error. */
function apiError(status: number, code: string, message: string, body: unknown): ApiError {
  return Object.assign(new ApiError(code, message, status), { body });
}
const flat = (status: number, remaining: number, lockedUntil: number | null) =>
  apiError(status, 'http', 'Forbidden', { remaining, lockedUntil });
const coded = (status: number, code: string) => apiError(status, code, code, { error: { code, message: code } });

/** A tiny in-memory Worker: stores the setup request, compares `authKey`/`rkAuth`, and counts wrong PINs with the real lock rules. */
class FakeVaultServer {
  now = NOW;
  state: 'none' | 'ready' | 'wiped' = 'none';
  req: VaultSetupRequest | null = null;
  /** Every `serverSecret` the server was ever given (setup and each PIN change). */
  secrets: string[] = [];
  failed = 0;
  lockedUntil: number | null = null;
  /** Names of the client methods called, in order. */
  calls: string[] = [];
  setPinRequests: VaultPinRequest[] = [];
  /** When set, every call throws this instead of answering. */
  fault: Error | null = null;

  private enter(name: string) {
    this.calls.push(name);
    if (this.fault) throw this.fault;
  }

  private status(): VaultStatus {
    return {
      state: this.state,
      ...(this.req ? { kdf: { salt: this.req.kdfSalt, iterations: this.req.kdfIterations } } : {}),
      failedAttempts: this.failed,
      lockedUntil: this.lockedUntil !== null && this.lockedUntil > this.now ? this.lockedUntil : null,
      remaining: Math.max(0, VAULT_WIPE_AT - this.failed),
    };
  }

  /** The unlock rules of Task 4: locked refuses even the right PIN; wrong counts; 5th locks (423); 10th wipes (410). */
  private checkAuthKey(authKey: string) {
    if (this.state === 'none') throw coded(409, 'vault_not_ready');
    if (this.state === 'wiped') throw coded(410, 'vault_wiped');
    const remaining = () => Math.max(0, VAULT_WIPE_AT - this.failed);
    if (this.lockedUntil !== null && this.lockedUntil > this.now) throw flat(423, remaining(), this.lockedUntil);
    if (authKey === this.req!.authKey) {
      this.failed = 0;
      this.lockedUntil = null;
      return;
    }
    this.failed++;
    if (this.failed >= VAULT_WIPE_AT) {
      this.state = 'wiped';
      throw coded(410, 'vault_wiped');
    }
    const ms = vaultLockMs(this.failed);
    if (ms > 0) {
      this.lockedUntil = this.now + ms;
      throw flat(423, remaining(), this.lockedUntil);
    }
    throw flat(403, remaining(), null);
  }

  wipe() {
    this.state = 'wiped';
    this.failed = VAULT_WIPE_AT;
  }

  readonly client = {
    vaultStatus: async () => {
      this.enter('vaultStatus');
      return this.status();
    },
    vaultSetup: async (req: VaultSetupRequest) => {
      this.enter('vaultSetup');
      if (this.state !== 'none') throw coded(409, 'vault_exists');
      this.req = JSON.parse(JSON.stringify(req)) as VaultSetupRequest;
      this.secrets.push(req.serverSecret);
      this.state = 'ready';
    },
    vaultUnlock: async ({ authKey }: { authKey: string }) => {
      this.enter('vaultUnlock');
      this.checkAuthKey(authKey);
      return { serverSecret: this.req!.serverSecret, wrappedMkPin: this.req!.wrappedMkPin };
    },
    vaultRecover: async ({ rkAuth }: { rkAuth: string }) => {
      this.enter('vaultRecover');
      if (this.state === 'none') throw coded(409, 'vault_not_ready');
      if (rkAuth !== this.req!.rkAuth) throw coded(403, 'forbidden');
      return { wrappedMkRecovery: this.req!.wrappedMkRecovery };
    },
    vaultSetPin: async (req: VaultPinRequest) => {
      this.enter('vaultSetPin');
      this.setPinRequests.push(JSON.parse(JSON.stringify(req)) as VaultPinRequest);
      if (this.state === 'none') throw coded(409, 'vault_not_ready');
      if ('authKey' in req.proof) this.checkAuthKey(req.proof.authKey);
      else if (req.proof.rkAuth !== this.req!.rkAuth) throw coded(403, 'forbidden');
      this.req = { ...this.req!, kdfSalt: req.kdfSalt, kdfIterations: req.kdfIterations, authKey: req.authKey, serverSecret: req.serverSecret, wrappedMkPin: req.wrappedMkPin };
      this.secrets.push(req.serverSecret);
      this.state = 'ready';
      this.failed = 0;
      this.lockedUntil = null;
    },
    // Anything that touches files: a PIN change must never reach these.
    createUpload: async () => this.fileCall('createUpload'),
    complete: async () => this.fileCall('complete'),
    update: async () => this.fileCall('update'),
    moveIn: async () => this.fileCall('moveIn'),
    moveInComplete: async () => this.fileCall('moveInComplete'),
    moveOut: async () => this.fileCall('moveOut'),
    moveOutComplete: async () => this.fileCall('moveOutComplete'),
  };

  fileCalls: string[] = [];
  private fileCall(name: string): never {
    this.fileCalls.push(name);
    throw new Error(`unexpected file call: ${name}`);
  }
}

function make(server = new FakeVaultServer(), appPin = APP_PIN) {
  const appPinMatches = vi.fn((pin4: string) => pin4 === appPin);
  const session = new VaultSession({ client: () => server.client as unknown as Client, appPinMatches, iterations: ITERATIONS });
  return { server, session, appPinMatches };
}

/** A new session over the same server: the app was restarted, nothing is in memory. */
const restart = (server: FakeVaultServer) => make(server).session;

async function setUp(pin = PIN) {
  const ctx = make();
  const res = await ctx.session.setup(pin);
  if (!res.ok) throw new Error(`setup failed: ${res.error}`);
  return { ...ctx, recoveryKey: res.recoveryKey };
}

/** The master key as only the owner of `pin` could get it from what the server stores (extractable, for the checks). */
async function masterKeyFor(server: FakeVaultServer, pin: string) {
  const req = server.req!;
  const { wrapBase } = await derivePinKeys(pin, req.kdfSalt, req.kdfIterations);
  return unwrapMasterKey(req.wrappedMkPin, await kekFrom(wrapBase, req.serverSecret), { extractable: true });
}

const b64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64');

const fileMeta: VaultMeta = { name: 'Hợp đồng thuê nhà – Đà Nẵng.pdf', mime: 'application/pdf', kind: 'file' };

function item(over: Partial<FileItem> = {}): FileItem {
  return {
    id: 'I1',
    name: '',
    mime: 'application/octet-stream',
    size: 1234,
    kind: 'file',
    thumbUrl: null,
    device: 'pc',
    createdAt: 1_700_000_000_000,
    deletedAt: null,
    inVault: true,
    tags: ['red'],
    url: null,
    site: null,
    previewed: false,
    encrypted: true,
    ...over,
  };
}

/** An item as the server would hold it after `meta` was encrypted by the open session. */
async function encryptedItem(session: VaultSession, meta: VaultMeta, over: Partial<FileItem> = {}) {
  const { encMeta, encKey, dek } = await session.encryptMetaFor(meta);
  return { item: item({ encMeta, encKey, ...over }), dek, encMeta, encKey };
}

async function lockedError(promise: Promise<unknown>) {
  const err = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as (Error & { code?: string }) | null;
  expect(err).toBeInstanceOf(Error);
  expect(err!.code === 'vault_locked' || err!.message === 'vault_locked').toBe(true);
  return err!;
}

describe('VaultSession.status', () => {
  it('returns what GET /vault says, without any secret', async () => {
    const { session, server } = await setUp();
    const status = await session.status();
    expect(status).toMatchObject({ state: 'ready', failedAttempts: 0, lockedUntil: null, remaining: 10, kdf: { iterations: ITERATIONS } });
    expect(JSON.stringify(status)).not.toContain(server.req!.serverSecret);
  });

  it('says "none" before setup', async () => {
    const { session } = make();
    expect(await session.status()).toMatchObject({ state: 'none' });
  });
});

describe('VaultSession.setup', () => {
  it.each(['111111', '123456', '654321', '000000', '12345', '1234567', 'abcdef'])('rejects the weak PIN %s without asking the server', async (pin) => {
    expect(isWeakVaultPin(pin)).toBe(true);
    const { session, server } = make();
    expect(await session.setup(pin)).toEqual({ ok: false, error: 'weak_pin' });
    expect(server.calls).toEqual([]);
    expect(session.isOpen()).toBe(false);
  });

  it('rejects a PIN whose first 4 digits are the app PIN, checking the first 4 and the last 4', async () => {
    const { session, server, appPinMatches } = make(undefined, '1357');
    expect(await session.setup('135792')).toEqual({ ok: false, error: 'matches_app_pin' });
    expect(appPinMatches).toHaveBeenCalledWith('1357');
    expect(server.calls).toEqual([]);
    expect(session.isOpen()).toBe(false);
  });

  it('rejects a PIN whose last 4 digits are the app PIN', async () => {
    const { session, server, appPinMatches } = make(undefined, '5792');
    expect(await session.setup('135792')).toEqual({ ok: false, error: 'matches_app_pin' });
    expect(appPinMatches).toHaveBeenCalledWith('1357');
    expect(appPinMatches).toHaveBeenCalledWith('5792');
    expect(server.calls).toEqual([]);
    expect(session.isOpen()).toBe(false);
  });

  it('asks the app PIN about both ends of an acceptable PIN', async () => {
    const { session, appPinMatches } = make();
    expect((await session.setup('135792')).ok).toBe(true);
    expect(appPinMatches).toHaveBeenCalledWith('1357');
    expect(appPinMatches).toHaveBeenCalledWith('5792');
  });

  it('sends a request that contains neither the PIN nor the recovery key', async () => {
    const { session, server } = make();
    const res = await session.setup(PIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const sent = JSON.stringify(server.req);
    expect(server.req).not.toBeNull();
    expect(sent).not.toContain(PIN);
    expect(sent).not.toContain(res.recoveryKey);
    expect(sent).not.toContain(res.recoveryKey.replace(/-/g, ''));
    expect(server.req!.kdfIterations).toBe(ITERATIONS);
  });

  it('returns a recovery key that parses, and the request holds exactly what that key and the PIN derive', async () => {
    const { session, server } = make();
    const res = await session.setup(PIN);
    if (!res.ok) throw new Error('setup failed');
    expect(parseRecoveryKey(res.recoveryKey)).not.toBeNull();
    expect((await recoveryKeys(res.recoveryKey)).rkAuth).toBe(server.req!.rkAuth);
    expect((await derivePinKeys(PIN, server.req!.kdfSalt, ITERATIONS)).authKey).toBe(server.req!.authKey);
  });

  it('leaves the vault open, holding the master key the server stored wrapped', async () => {
    const { session, server } = make();
    expect(session.isOpen()).toBe(false);
    expect((await session.setup(PIN)).ok).toBe(true);
    expect(session.isOpen()).toBe(true);

    const { encMeta } = await session.encryptMetaFor(fileMeta);
    expect(await decryptMeta(encMeta, await masterKeyFor(server, PIN))).toEqual(fileMeta);
  });

  it('answers vault_exists when the vault is already set up, and does not open', async () => {
    const { server } = await setUp();
    const other = restart(server);
    expect(await other.setup(PIN2)).toEqual({ ok: false, error: 'vault_exists' });
    expect(other.isOpen()).toBe(false);
  });

  it('reports a network failure as an error, not as an open vault', async () => {
    const { session, server } = make();
    server.fault = new ApiError('network', 'fetch failed');
    expect(await session.setup(PIN)).toEqual({ ok: false, error: 'network' });
    expect(session.isOpen()).toBe(false);
  });
});

describe('VaultSession.unlock', () => {
  it('opens with the right PIN', async () => {
    const { server } = await setUp();
    const session = restart(server);
    expect(session.isOpen()).toBe(false);
    expect(await session.unlock(PIN)).toEqual({ ok: true });
    expect(session.isOpen()).toBe(true);
  });

  it('opens with the master key the vault was set up with', async () => {
    const { session, server } = await setUp();
    const { item: stored } = await encryptedItem(session, fileMeta);
    const again = restart(server);
    await again.unlock(PIN);
    const [shown] = await again.decryptList([stored]);
    expect(shown.name).toBe(fileMeta.name);
  });

  it('answers wrong with the attempts left, and never opens', async () => {
    const { server } = await setUp();
    const session = restart(server);
    expect(await session.unlock(PIN2)).toMatchObject({ ok: false, reason: 'wrong', remaining: 9 });
    expect(session.isOpen()).toBe(false);
    expect(await session.unlock(PIN2)).toMatchObject({ ok: false, reason: 'wrong', remaining: 8 });
    expect(session.isOpen()).toBe(false);
  });

  it('answers locked with lockedUntil after the 5th wrong PIN, and stays closed even for the right PIN', async () => {
    const { server } = await setUp();
    const session = restart(server);
    for (let i = 0; i < 4; i++) expect(await session.unlock(PIN2)).toMatchObject({ reason: 'wrong' });
    expect(await session.unlock(PIN2)).toMatchObject({ ok: false, reason: 'locked', lockedUntil: NOW + 60_000 });
    expect(session.isOpen()).toBe(false);
    expect(await session.unlock(PIN)).toMatchObject({ ok: false, reason: 'locked', lockedUntil: NOW + 60_000 });
    expect(session.isOpen()).toBe(false);
  });

  it('answers wiped when the server has wiped its keys (410)', async () => {
    const { server } = await setUp();
    server.wipe();
    const session = restart(server);
    expect(await session.unlock(PIN)).toEqual({ ok: false, reason: 'wiped' });
    expect(session.isOpen()).toBe(false);
  });

  it('answers not_ready when the vault was never set up', async () => {
    const { session } = make();
    expect(await session.unlock(PIN)).toEqual({ ok: false, reason: 'not_ready' });
    expect(session.isOpen()).toBe(false);
  });

  it('answers not_ready when the server says vault_not_ready (409) to the unlock itself', async () => {
    const { server } = await setUp();
    const session = restart(server);
    server.client.vaultUnlock = async () => {
      throw coded(409, 'vault_not_ready');
    };
    expect(await session.unlock(PIN)).toEqual({ ok: false, reason: 'not_ready' });
    expect(session.isOpen()).toBe(false);
  });

  it('answers an error with the code "network" when the server cannot be reached', async () => {
    const { server } = await setUp();
    const session = restart(server);
    server.fault = new ApiError('network', 'fetch failed');
    expect(await session.unlock(PIN)).toEqual({ ok: false, reason: 'error', error: 'network' });
    expect(session.isOpen()).toBe(false);
  });

  it('answers an error with the server code for any other failure', async () => {
    const { server } = await setUp();
    const session = restart(server);
    server.fault = new ApiError('http', 'boom', 500);
    expect(await session.unlock(PIN)).toEqual({ ok: false, reason: 'error', error: 'http' });
    expect(session.isOpen()).toBe(false);
  });
});

describe('VaultSession.close', () => {
  it('closes the vault', async () => {
    const { session } = await setUp();
    expect(session.isOpen()).toBe(true);
    session.close();
    expect(session.isOpen()).toBe(false);
  });

  it('makes decryptList, encryptMetaFor and fileKey fail with vault_locked', async () => {
    const { session } = await setUp();
    const { item: stored } = await encryptedItem(session, fileMeta);
    session.close();
    await lockedError(session.decryptList([stored]));
    await lockedError(session.encryptMetaFor(fileMeta));
    await lockedError(session.fileKey(stored));
  });

  it('refuses the same calls before the vault was ever opened', async () => {
    const { session, server } = await setUp();
    const { item: stored } = await encryptedItem(session, fileMeta);
    const fresh = restart(server);
    await lockedError(fresh.decryptList([stored]));
    await lockedError(fresh.encryptMetaFor(fileMeta));
    await lockedError(fresh.fileKey(stored));
  });

  it('can be reopened with the PIN', async () => {
    const { session } = await setUp();
    session.close();
    expect(await session.unlock(PIN)).toEqual({ ok: true });
    expect(session.isOpen()).toBe(true);
  });
});

describe('VaultSession.recover', () => {
  it('rejects a weak new PIN first, even when the recovery key is bad, without asking the server', async () => {
    const { session, server } = make();
    expect(await session.recover('not a key', '111111')).toEqual({ ok: false, error: 'weak_pin' });
    expect(server.calls).toEqual([]);
  });

  it('rejects a new PIN that matches the app PIN without asking the server', async () => {
    const { server, recoveryKey } = await setUp();
    const { session } = make(server, '2468');
    server.calls.length = 0;
    expect(await session.recover(recoveryKey, PIN2)).toEqual({ ok: false, error: 'matches_app_pin' });
    expect(server.calls).toEqual([]);
  });

  it('rejects a recovery key with the wrong format without asking the server', async () => {
    const { server } = await setUp();
    const session = restart(server);
    server.calls.length = 0;
    expect(await session.recover('ABCD-EFGH', PIN2)).toEqual({ ok: false, error: 'bad_recovery_key' });
    expect(server.calls).toEqual([]);
  });

  it('rejects a well-formed but wrong recovery key (server 403) and changes nothing', async () => {
    const { server } = await setUp();
    const session = restart(server);
    expect(await session.recover(newRecoveryKey(), PIN2)).toEqual({ ok: false, error: 'bad_recovery_key' });
    expect(server.calls).not.toContain('vaultSetPin');
    expect(await restart(server).unlock(PIN)).toEqual({ ok: true });
  });

  it('sets the new PIN: it opens the vault and the old PIN no longer does', async () => {
    const { server, recoveryKey } = await setUp();
    const session = restart(server);
    expect(await session.recover(recoveryKey, PIN2)).toMatchObject({ ok: true });

    expect(await restart(server).unlock(PIN2)).toEqual({ ok: true });
    expect(await restart(server).unlock(PIN)).toMatchObject({ ok: false, reason: 'wrong' });
  });

  it('keeps the master key, so items made before still open', async () => {
    const { session: first, server, recoveryKey } = await setUp();
    const { item: stored } = await encryptedItem(first, fileMeta);
    await restart(server).recover(recoveryKey, PIN2);
    const reopened = restart(server);
    await reopened.unlock(PIN2);
    expect((await reopened.decryptList([stored]))[0].name).toBe(fileMeta.name);
  });

  it('works when the server has wiped its keys, and the vault is usable again', async () => {
    const { server, recoveryKey } = await setUp();
    server.wipe();
    expect(await restart(server).unlock(PIN)).toEqual({ ok: false, reason: 'wiped' });

    expect(await restart(server).recover(recoveryKey, PIN2)).toMatchObject({ ok: true });
    expect(server.state).toBe('ready');
    expect(await restart(server).unlock(PIN2)).toEqual({ ok: true });
  });

  it('proves itself with rkAuth and sends neither the new PIN nor the recovery key', async () => {
    const { server, recoveryKey } = await setUp();
    await restart(server).recover(recoveryKey, PIN2);
    expect(server.setPinRequests).toHaveLength(1);
    const [sent] = server.setPinRequests;
    expect(sent.proof).toEqual({ rkAuth: (await recoveryKeys(recoveryKey)).rkAuth });
    const json = JSON.stringify(sent);
    expect(json).not.toContain(PIN2);
    expect(json).not.toContain(recoveryKey);
    expect(json).not.toContain(recoveryKey.replace(/-/g, ''));
  });

  it('accepts the recovery key typed in lower case without dashes', async () => {
    const { server, recoveryKey } = await setUp();
    const typed = recoveryKey.replace(/-/g, '').toLowerCase();
    expect(await restart(server).recover(typed, PIN2)).toMatchObject({ ok: true });
    expect(await restart(server).unlock(PIN2)).toEqual({ ok: true });
  });
});

describe('VaultSession.changePin', () => {
  it('sets the new PIN with the old one: the new PIN opens, the old one does not', async () => {
    const { server } = await setUp();
    expect(await restart(server).changePin(PIN, PIN2)).toMatchObject({ ok: true });

    expect(await restart(server).unlock(PIN2)).toEqual({ ok: true });
    expect(await restart(server).unlock(PIN)).toMatchObject({ ok: false, reason: 'wrong' });
  });

  it('re-encrypts no file: the client sees no upload or move, and earlier items still open', async () => {
    const { session: first, server } = await setUp();
    const { item: stored } = await encryptedItem(first, fileMeta);
    await restart(server).changePin(PIN, PIN2);
    expect(server.fileCalls).toEqual([]);

    const reopened = restart(server);
    await reopened.unlock(PIN2);
    expect((await reopened.decryptList([stored]))[0].name).toBe(fileMeta.name);
  });

  it('answers wrong with the attempts left when the old PIN is wrong, and keeps the old PIN', async () => {
    const { server } = await setUp();
    expect(await restart(server).changePin('975310', PIN2)).toMatchObject({ ok: false, reason: 'wrong', remaining: 9 });
    expect(await restart(server).unlock(PIN)).toEqual({ ok: true });
    expect(await restart(server).unlock(PIN2)).toMatchObject({ ok: false, reason: 'wrong' });
  });

  it('answers locked and wiped like unlock does', async () => {
    const { server } = await setUp();
    const session = restart(server);
    for (let i = 0; i < 4; i++) await session.changePin('975310', PIN2);
    expect(await session.changePin('975310', PIN2)).toMatchObject({ ok: false, reason: 'locked', lockedUntil: NOW + 60_000 });

    server.wipe();
    expect(await session.changePin(PIN, PIN2)).toEqual({ ok: false, reason: 'wiped' });
  });

  it('rejects a weak new PIN and a new PIN that matches the app PIN without asking the server', async () => {
    const { server } = await setUp();
    const { session } = make(server, '2468');
    server.calls.length = 0;
    expect(await session.changePin(PIN, '111111')).toEqual({ ok: false, error: 'weak_pin' });
    expect(await session.changePin(PIN, PIN2)).toEqual({ ok: false, error: 'matches_app_pin' });
    expect(server.calls).toEqual([]);
  });

  it('proves itself with the old authKey, sends neither PIN, and uses a fresh salt and server secret', async () => {
    const { server } = await setUp();
    const before = { ...server.req! };
    await restart(server).changePin(PIN, PIN2);
    const [sent] = server.setPinRequests;
    expect(sent.proof).toEqual({ authKey: before.authKey });
    const json = JSON.stringify(sent);
    expect(json).not.toContain(PIN);
    expect(json).not.toContain(PIN2);
    expect(sent.kdfSalt).not.toBe(before.kdfSalt);
    expect(sent.serverSecret).not.toBe(before.serverSecret);
    expect(sent.kdfIterations).toBe(ITERATIONS);
  });
});

describe('VaultSession.encryptMetaFor and fileKey', () => {
  it('encrypts the metadata under the master key and returns the wrapped file key and the file key', async () => {
    const { session, server } = await setUp();
    const { encMeta, encKey, dek } = await session.encryptMetaFor(fileMeta);
    const mk = await masterKeyFor(server, PIN);
    expect(await decryptMeta(encMeta, mk)).toEqual(fileMeta);
    expect(await unwrapFileKey(encKey, mk)).toBeDefined();
    expect(isKey(dek)).toBe(true);
  });

  it('gives each call its own file key', async () => {
    const { session } = await setUp();
    const a = await session.encryptMetaFor(fileMeta);
    const b = await session.encryptMetaFor(fileMeta);
    expect(a.encKey).not.toBe(b.encKey);
    expect(a.encMeta).not.toBe(b.encMeta);
  });

  it('fileKey opens what the file key from encryptMetaFor encrypted', async () => {
    const { session } = await setUp();
    const { item: stored, dek } = await encryptedItem(session, fileMeta);
    const plain = new TextEncoder().encode('nội dung tệp – Việt Nam');
    const cipher = await encryptBytes(plain, dek);
    const key = await session.fileKey(stored);
    expect(await decryptBytes(cipher, key)).toEqual(plain);
  });

  it('fileKey works in a later session opened with the PIN', async () => {
    const { session, server } = await setUp();
    const { item: stored, dek } = await encryptedItem(session, fileMeta);
    const plain = new Uint8Array([1, 2, 3, 4, 5]);
    const cipher = await encryptBytes(plain, dek);
    const later = restart(server);
    await later.unlock(PIN);
    expect(await decryptBytes(cipher, await later.fileKey(stored))).toEqual(plain);
  });

  it('keeps the file key non-extractable', async () => {
    const { session } = await setUp();
    const { item: stored, dek } = await encryptedItem(session, fileMeta);
    await expect(crypto.subtle.exportKey('raw', dek)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('raw', await session.fileKey(stored))).rejects.toThrow();
  });
});

describe('VaultSession.decryptList', () => {
  const picture = 'https://r2.example/vault/I1.thumb?X-Amz-Signature=abc';

  it('replaces name, mime, kind and url with the decrypted metadata, Vietnamese included', async () => {
    const { session } = await setUp();
    const meta: VaultMeta = { name: 'Ảnh đại diện – Nguyễn Văn Ánh.png', mime: 'image/png', kind: 'image' };
    const { item: stored } = await encryptedItem(session, meta);
    const [shown] = await session.decryptList([stored]);
    expect(shown).toMatchObject({ id: 'I1', name: meta.name, mime: 'image/png', kind: 'image', url: null });
  });

  it('turns a link into its decrypted url, kind and title (as the name)', async () => {
    const { session } = await setUp();
    const meta: VaultMeta = { name: 'https://example.com/trang', mime: 'text/uri-list', kind: 'link', url: 'https://example.com/trang?q=tiếng+Việt', title: 'Trang chủ – Ví dụ' };
    const { item: stored } = await encryptedItem(session, meta);
    const [shown] = await session.decryptList([stored]);
    expect(shown).toMatchObject({ kind: 'link', url: 'https://example.com/trang?q=tiếng+Việt', name: 'Trang chủ – Ví dụ', mime: 'text/uri-list' });
  });

  it('falls back to the metadata name for a link without a title', async () => {
    const { session } = await setUp();
    const meta: VaultMeta = { name: 'example.com', mime: 'text/uri-list', kind: 'link', url: 'https://example.com', title: null };
    const { item: stored } = await encryptedItem(session, meta);
    expect((await session.decryptList([stored]))[0]).toMatchObject({ name: 'example.com', url: 'https://example.com' });
  });

  it('points the thumbnail at fatup-vault://thumb/<id> when the item had one, and at null when it had none', async () => {
    const { session } = await setUp();
    const withThumb = await encryptedItem(session, fileMeta, { id: 'I1', thumbUrl: picture });
    const without = await encryptedItem(session, fileMeta, { id: 'I2', thumbUrl: null });
    const [a, b] = await session.decryptList([withThumb.item, without.item]);
    expect(a.thumbUrl).toBe('fatup-vault://thumb/I1');
    expect(b.thumbUrl).toBeNull();
  });

  it('strips encMeta and encKey from every result, and keeps the other fields', async () => {
    const { session } = await setUp();
    const { item: stored } = await encryptedItem(session, fileMeta, { size: 777, tags: ['blue', 'green'], createdAt: 42 });
    const [shown] = await session.decryptList([stored]);
    expect('encMeta' in shown).toBe(false);
    expect('encKey' in shown).toBe(false);
    expect(JSON.stringify(shown)).not.toContain(stored.encKey!);
    expect(shown).toMatchObject({ id: 'I1', size: 777, tags: ['blue', 'green'], createdAt: 42, inVault: true, encrypted: true });
  });

  it('returns items that are not encrypted yet unchanged, thumbnail address included', async () => {
    const { session } = await setUp();
    const old = item({ id: 'OLD', name: 'bản cũ.txt', mime: 'text/plain', encrypted: false, thumbUrl: picture });
    const older = item({ id: 'OLDER', name: 'cũ hơn.txt', mime: 'text/plain', thumbUrl: null });
    delete older.encrypted;
    const result = await session.decryptList([old, older]);
    expect(result).toEqual([old, older]);
  });

  it('keeps the order of a mixed list and does not touch its input', async () => {
    const { session } = await setUp();
    const { item: enc } = await encryptedItem(session, fileMeta, { id: 'E' });
    const old = item({ id: 'OLD', name: 'cũ.txt', encrypted: false });
    const input = [old, enc, old];
    const snapshot = JSON.stringify(input);
    const result = await session.decryptList(input);
    expect(result.map((i) => i.id)).toEqual(['OLD', 'E', 'OLD']);
    expect(result[1].name).toBe(fileMeta.name);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(enc.encMeta).toBeTruthy();
  });

  it('returns an empty list for an empty list', async () => {
    const { session } = await setUp();
    expect(await session.decryptList([])).toEqual([]);
  });
});

type Key = Awaited<ReturnType<typeof crypto.subtle.generateKey>>;
const isKey = (v: unknown): v is Key & { extractable: boolean } => Object.prototype.toString.call(v) === '[object CryptoKey]';

/** Every CryptoKey reachable from `root` through own properties, arrays, maps and sets. */
function keysIn(root: unknown, seen = new Set<unknown>(), depth = 0): (Key & { extractable: boolean })[] {
  if (root === null || typeof root !== 'object' || seen.has(root) || depth > 5) return [];
  if (isKey(root)) return [root];
  seen.add(root);
  const children: unknown[] = [];
  if (root instanceof Map) children.push(...root.keys(), ...root.values());
  else if (root instanceof Set) children.push(...root.values());
  else for (const name of Object.getOwnPropertyNames(root)) children.push((root as Record<string, unknown>)[name]);
  return children.flatMap((c) => keysIn(c, seen, depth + 1));
}

describe('VaultSession keeps its secrets', () => {
  it('returns nothing that contains the server secret, the master key or (after setup) the recovery key', async () => {
    const { session, server, recoveryKey } = await setUp();
    const mk = await masterKeyFor(server, PIN);
    const raw = await crypto.subtle.exportKey('raw', mk);
    const forbidden = [b64(raw), Buffer.from(raw).toString('hex'), b64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')];

    const returned: unknown[] = [];
    returned.push(await session.status());
    const { item: stored, dek } = await encryptedItem(session, fileMeta, { thumbUrl: 'https://r2.example/t' });
    returned.push(stored);
    returned.push(await session.decryptList([stored, item({ encrypted: false })]));
    returned.push(await session.fileKey(stored));
    returned.push(await restart(server).unlock(PIN));
    returned.push(await restart(server).unlock(PIN2));
    returned.push(await restart(server).changePin(PIN, PIN2));
    returned.push(await restart(server).recover(recoveryKey, PIN));
    session.close();
    for (const call of [() => session.decryptList([stored]), () => session.encryptMetaFor(fileMeta), () => session.fileKey(stored)]) {
      const err = (await call().then(
        () => null,
        (e: unknown) => e,
      )) as Error;
      returned.push(err.message, err.stack ?? '');
    }

    const text = returned.map((r) => JSON.stringify(r)).join('\n');
    for (const secret of [...server.secrets, recoveryKey, recoveryKey.replace(/-/g, ''), ...forbidden]) expect(text).not.toContain(secret);
    await expect(crypto.subtle.exportKey('raw', dek)).rejects.toThrow();
  });

  it('puts the recovery key only in the answer of setup', async () => {
    const res = await make().session.setup(PIN);
    expect(res).toMatchObject({ ok: true });
    expect(Object.keys(res).sort()).toEqual(['ok', 'recoveryKey']);
  });

  it('holds no extractable key, after setup, unlock, recovery and a PIN change', async () => {
    const { session, server, recoveryKey } = await setUp();
    for (const key of keysIn(session)) expect(key.extractable).toBe(false);

    const unlocked = restart(server);
    await unlocked.unlock(PIN);
    for (const key of keysIn(unlocked)) expect(key.extractable).toBe(false);

    const changed = restart(server);
    await changed.changePin(PIN, PIN2);
    for (const key of keysIn(changed)) expect(key.extractable).toBe(false);

    const recovered = restart(server);
    await recovered.recover(recoveryKey, PIN);
    for (const key of keysIn(recovered)) expect(key.extractable).toBe(false);
  });

  it('drops every key on close', async () => {
    const { session } = await setUp();
    session.close();
    expect(keysIn(session)).toEqual([]);
  });
});
