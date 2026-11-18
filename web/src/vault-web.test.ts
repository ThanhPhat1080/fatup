// Task 10: the encrypted Vault in the browser, as a module that can be tested without a page.
//
// This file is the contract for a new module, `web/src/vault-web.ts`. `browser-api.ts` calls it from the `window.fatup` bridge
// (that wiring is checked as text in vault-wiring.test.ts). Everything runs in page memory: the master key, the decrypted names
// and the object URLs. Nothing is written to localStorage, IndexedDB or Cache Storage (the link-picture store).
//
//   export type WebVaultDeps = {
//     client(): ApiClient-like;           // listEverything, downloadUrl, update, createUpload, complete, addLink, moveIn, moveInComplete,
//                                         // moveOut, moveOutComplete, vaultStatus, vaultSetup, vaultUnlock, vaultRecover, vaultSetPin.
//                                         // Throws ApiError('locked') when the app is locked / not configured.
//     isUnlocked(): boolean;              // the app (PIN) lock; false = every handler refuses (vaultClose never)
//     appPinMatches(pin4: string): Promise<boolean> | boolean;
//                                         // ASYNC on the web (PBKDF2 over the sealed token). `VaultSession` takes a sync `boolean` today,
//                                         // so its `appPinMatches` must accept `boolean | Promise<boolean>` and the PIN refusal must
//                                         // `await` it. Must not count against the lock screen's attempts (browser-api's job).
//     saveFile(name: string, bytes: Uint8Array, mime: string): void;   // what `download` hands the browser (an <a download> in production)
//     createObjectURL(blob: Blob): string;                              // URL.createObjectURL in production
//     revokeObjectURL(url: string): void;
//     fetchImpl?: typeof fetch;           // presigned GETs and PUTs; default: the global fetch (wrapped)
//     device: string | null;              // sender shown for a link added straight into the Vault
//     iterations?: number;                // PBKDF2 rounds of a NEW PIN (VaultSession option); tests pass a small number
//   };
//
//   createWebVault(deps) returns plain async functions with the same names and results as the desktop bridge:
//     vaultStatus(): Result<VaultStatus>;  vaultSetup(pin);  vaultUnlock(pin);  vaultRecover(rk, newPin);  vaultChangePin(old, new)
//       -> the result shapes of vault-ipc (desktop/test/vault-ipc.test.ts). While the app is locked: `{ok:false, error:'locked'}`,
//          and for the two PIN checks `{ok:false, reason:'error', error:'locked'}`; the client is not touched.
//     vaultClose(): void                  // SYNCHRONOUS, never refused: forgets the key and revokes EVERY object URL created so far
//     vaultLeave(): void                  // SYNCHRONOUS: view-only close (plan 2026-11-18-vault-session-6h): revokes the URLs, keeps the key
//     listVault({ trash? }): Result<Item[]>   // decrypted; no `encMeta`/`encKey`; `thumbUrl` is always null (the Vault shows no thumbnails)
//     vaultMoveIn(ids) / vaultMoveOut(ids): Result<{ done: number; failed: string[] }>   // createVaultMover semantics
//     onVaultProgress(cb): () => void     // one call per item of a move or of the legacy conversion: { done, total, current? }
//     fileBytes(id) / copyImageBytes(id): Result<Uint8Array>          // decrypted
//     download(id): Result<string>                                    // saveFile(realName, plaintext, realMime)
//     previewUrl(id): Result<string>                                  // a blob: URL of the decrypted file (typed with the real mime)
//     updateFile(id, patch) / addLink(url, title?)                    // as vault-ipc (encMeta only; a 32-byte encrypted upload)
//     owns(id): boolean                                               // true for an encrypted item listVault returned, even after close
//     uploadEncryptor(): { isOpen(): boolean; encryptMetaFor(meta): Promise<{ encMeta; encKey; dek }> }   // for WebUploadManager
//
// Refusals as vault-ipc: Vault closed -> `vault_locked` with no network call; id never listed -> `not_found`.
// After a successful setup / unlock / recover the legacy (not yet encrypted) Vault items are converted in the background (spec 4.7),
// without making the caller wait.
//
// The module must NOT take a preview store (the Cache Storage store of link pictures): the deps are wrapped in a Proxy below and the
// scenario fails if any other property is read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LINK_MIME,
  VAULT_SESSION_MS,
  decryptBytes,
  decryptMeta,
  derivePinKeys,
  encryptBytes,
  encryptMeta,
  kekFrom,
  newFileKey,
  unwrapFileKey,
  unwrapMasterKey,
  vaultCiphertextSize,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type FileItem,
  type VaultMeta,
  type VaultMoveInComplete,
  type VaultMoveOutComplete,
  type VaultMoveUrls,
  type VaultPinRequest,
  type VaultSetupRequest,
  type VaultStatus,
} from '@fatup/shared';
import { ApiError } from '../../desktop/src/main/api';
import { createWebVault, type WebVaultDeps } from './vault-web';

const ITERATIONS = 1000;
const PIN = '135792';
const PIN2 = '246810';
const DEVICE = 'Chrome · Test';
const R2 = 'https://r2.test';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** The deps `createWebVault` may read. Anything else (a preview store, say) is a failure. */
const ALLOWED_DEPS = ['client', 'isUnlocked', 'appPinMatches', 'saveFile', 'createObjectURL', 'revokeObjectURL', 'fetchImpl', 'device', 'iterations'];

/** The part of the Worker a real VaultSession needs: setup, status, unlock (compares authKey), recover (compares rkAuth), PIN change. */
function miniServer() {
  const state: { req: VaultSetupRequest | null; rkAuth: string | null; wrappedMkRecovery: string | null; nextUnlockError: Error | null } = {
    req: null,
    rkAuth: null,
    wrappedMkRecovery: null,
    nextUnlockError: null,
  };
  const calls: string[] = [];
  const status = (): VaultStatus =>
    state.req
      ? { state: 'ready', kdf: { salt: state.req.kdfSalt, iterations: state.req.kdfIterations }, failedAttempts: 0, lockedUntil: null, remaining: 10 }
      : { state: 'none', failedAttempts: 0, lockedUntil: null, remaining: 10 };
  const client = {
    vaultStatus: vi.fn(async () => {
      calls.push('vaultStatus');
      return status();
    }),
    vaultSetup: vi.fn(async (req: VaultSetupRequest) => {
      calls.push('vaultSetup');
      state.req = JSON.parse(JSON.stringify(req)) as VaultSetupRequest;
      state.rkAuth = req.rkAuth;
      state.wrappedMkRecovery = req.wrappedMkRecovery;
    }),
    vaultUnlock: vi.fn(async (req: { authKey: string }) => {
      calls.push('vaultUnlock');
      if (state.nextUnlockError) {
        const err = state.nextUnlockError;
        state.nextUnlockError = null;
        throw err;
      }
      if (req.authKey !== state.req!.authKey) throw new ApiError('http', 'Forbidden', 403, { remaining: 9, lockedUntil: null });
      return { serverSecret: state.req!.serverSecret, wrappedMkPin: state.req!.wrappedMkPin };
    }),
    vaultRecover: vi.fn(async (req: { rkAuth: string }) => {
      calls.push('vaultRecover');
      if (req.rkAuth !== state.rkAuth) throw new ApiError('forbidden', 'Forbidden', 403, { error: { code: 'forbidden', message: 'no' } });
      return { wrappedMkRecovery: state.wrappedMkRecovery! };
    }),
    vaultSetPin: vi.fn(async (req: VaultPinRequest) => {
      calls.push('vaultSetPin');
      state.req = { ...state.req!, kdfSalt: req.kdfSalt, kdfIterations: req.kdfIterations, authKey: req.authKey, serverSecret: req.serverSecret, wrappedMkPin: req.wrappedMkPin };
    }),
  };
  return { state, client, calls };
}

function storedItem(over: Partial<FileItem> = {}): FileItem {
  return {
    id: 'I1',
    name: '',
    mime: 'application/octet-stream',
    size: 100,
    kind: 'file',
    thumbUrl: null,
    device: 'pc',
    createdAt: 1_700_000_000_000,
    deletedAt: null,
    inVault: true,
    tags: [],
    url: null,
    site: null,
    previewed: false,
    encrypted: true,
    ...over,
  };
}

type Patch = { encMeta?: string; name?: string; url?: string; tags?: string[]; important?: boolean };

/**
 * The page's world: a fake Worker (Vault routes, file routes, move routes), a fake R2 behind `fetchImpl`, fake browser functions
 * (object URLs, save) and a Proxy around the deps that records every property the module reads.
 * By default the Vault is set up and open (setup opens it); `open: false` closes it again.
 */
async function world(opts: { open?: boolean; unlocked?: boolean; appPinMatches?: (pin4: string) => boolean | Promise<boolean> } = {}) {
  const server = miniServer();
  const objects = new Map<string, Uint8Array>();
  const puts: { url: string; body: Uint8Array }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PUT') {
      const sent = init.body as unknown;
      const body = sent instanceof Blob ? await bytesOf(sent) : new Uint8Array(sent as ArrayBufferLike);
      puts.push({ url, body });
      objects.set(url, body);
      // No ETag header on purpose: since spec 4.7d a move in does not need one.
      return new Response(null, { status: 200 });
    }
    const body = objects.get(url);
    return body ? new Response(body as unknown as BodyInit) : new Response('missing', { status: 404 });
  });

  const rows: FileItem[] = [];
  const created: { id: string; req: CreateUploadRequest }[] = [];
  const updates: { id: string; patch: Patch }[] = [];
  const completesIn: { id: string; req: VaultMoveInComplete }[] = [];
  /** Every attempt vault/in handed out per id, in order: a fresh one each time, written nowhere (spec 4.7d). */
  const attempts = new Map<string, string[]>();
  const attempt = (id: string, n = 0) => attempts.get(id)![n];
  const completesOut: { id: string; req: VaultMoveOutComplete }[] = [];
  const find = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new ApiError('not_found', 'no such file', 404);
    return row;
  };
  const client = {
    ...server.client,
    listEverything: vi.fn(async (o: { trash?: boolean; vault?: boolean } = {}) =>
      rows
        .filter((r) => (o.vault ? r.inVault : !r.inVault) && (o.trash ? r.deletedAt !== null : r.deletedAt === null))
        .map((r) => ({ ...r })),
    ),
    downloadUrl: vi.fn(async (id: string) => (find(id).encrypted ? `${R2}/vault/${id}` : `${R2}/files/${id}`)),
    update: vi.fn(async (id: string, patch: Patch): Promise<FileItem> => {
      updates.push({ id, patch: JSON.parse(JSON.stringify(patch)) as Patch });
      const row = find(id);
      if (patch.encMeta) row.encMeta = patch.encMeta;
      if (patch.tags) row.tags = patch.tags as FileItem['tags'];
      if (patch.important !== undefined) row.important = patch.important;
      return { ...row };
    }),
    createUpload: vi.fn(async (req: CreateUploadRequest): Promise<CreateUploadResponse> => {
      const id = `N${created.length + 1}`;
      created.push({ id, req: JSON.parse(JSON.stringify(req)) as CreateUploadRequest });
      return { id, uploadUrl: `${R2}/put/vault/${id}`, thumbUploadUrl: null };
    }),
    complete: vi.fn(async (id: string): Promise<FileItem> => {
      const made = created.find((c) => c.id === id)!;
      const row = storedItem({ id, size: made.req.size, encMeta: made.req.vault!.encMeta, encKey: made.req.vault!.encKey });
      objects.set(`${R2}/vault/${id}`, objects.get(`${R2}/put/vault/${id}`)!);
      rows.push(row);
      return { ...row };
    }),
    addLink: vi.fn(async (): Promise<FileItem> => {
      throw new Error('the plain /links route must never be used for the Vault');
    }),
    /** The legacy plain move: the encrypted Vault never uses it (spec 4.7d). */
    setVault: vi.fn(async (): Promise<FileItem> => {
      throw new Error('the legacy setVault must never be used');
    }),
    moveIn: vi.fn(async (id: string): Promise<VaultMoveUrls> => {
      const attempt = `attempt-${id}-${(attempts.get(id)?.length ?? 0) + 1}-AAAAAAAAAAAA`;
      attempts.set(id, [...(attempts.get(id) ?? []), attempt]);
      return { uploadUrl: `${R2}/put/vault/${id}.${attempt}`, thumbUploadUrl: null, downloadUrl: `${R2}/files/${id}`, thumbUrl: null, attempt };
    }),
    moveInComplete: vi.fn(async (id: string, req: VaultMoveInComplete): Promise<FileItem> => {
      completesIn.push({ id, req: JSON.parse(JSON.stringify(req)) as VaultMoveInComplete });
      const row = find(id);
      Object.assign(row, { name: '', mime: 'application/octet-stream', kind: 'file', inVault: true, encrypted: true, encMeta: req.encMeta, encKey: req.encKey, size: req.size });
      const written = objects.get(`${R2}/put/vault/${id}.${req.attempt}`);
      if (written) objects.set(`${R2}/vault/${id}`, written);
      return { ...row };
    }),
    moveOut: vi.fn(
      async (id: string): Promise<VaultMoveUrls> => ({
        uploadUrl: `${R2}/put/files/${id}`,
        thumbUploadUrl: null,
        downloadUrl: `${R2}/vault/${id}`,
        thumbUrl: null,
      }),
    ),
    moveOutComplete: vi.fn(async (id: string, req: VaultMoveOutComplete): Promise<FileItem> => {
      completesOut.push({ id, req: JSON.parse(JSON.stringify(req)) as VaultMoveOutComplete });
      const row = find(id);
      Object.assign(row, { name: req.name, mime: req.mime, inVault: false, encrypted: false, encMeta: undefined, encKey: undefined, size: req.size });
      return { ...row };
    }),
  };

  const made: { url: string; blob: Blob }[] = [];
  const revoked: string[] = [];
  const saved: { name: string; bytes: Uint8Array; mime: string }[] = [];
  const state = { unlocked: opts.unlocked ?? true };
  let settingUp = true; // the world's own setup (PIN 135792) must not be refused by the test's app-PIN check
  const baseDeps: WebVaultDeps = {
    client: () => client as never,
    isUnlocked: () => state.unlocked,
    appPinMatches: (pin4: string) => (settingUp ? false : (opts.appPinMatches ?? (() => false))(pin4)),
    saveFile: vi.fn((name: string, bytes: Uint8Array, mime: string) => void saved.push({ name, bytes, mime })),
    createObjectURL: vi.fn((blob: Blob) => {
      const url = `blob:test/${made.length + 1}`;
      made.push({ url, blob });
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => void revoked.push(url)),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    device: DEVICE,
    iterations: ITERATIONS,
  };
  const readDeps = new Set<string>();
  const deps = new Proxy(baseDeps, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') readDeps.add(prop);
      return Reflect.get(target, prop, receiver);
    },
  });
  const vault = createWebVault(deps);

  // Setup always runs with the app unlocked (it opens the Vault); `unlocked: false` / `open: false` are applied afterwards.
  const wasUnlocked = state.unlocked;
  state.unlocked = true;
  const setup = await vault.vaultSetup(PIN);
  if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
  const recoveryKey = setup.recoveryKey;
  state.unlocked = wasUnlocked;
  if (opts.open === false) vault.vaultClose();
  // A successful setup starts the legacy conversion in the background; let it finish (nothing to convert) before the test begins.
  await new Promise((resolve) => setTimeout(resolve, 0));
  settingUp = false;

  /** The master key, derived from what the server stores, to seal and open things the way only the owner can. */
  async function masterKey(pin = PIN) {
    const req = server.state.req!;
    const { wrapBase } = await derivePinKeys(pin, req.kdfSalt, req.kdfIterations);
    return unwrapMasterKey(req.wrappedMkPin, await kekFrom(wrapBase, req.serverSecret));
  }

  /** Stores an encrypted item the way the Worker would: ciphertext objects in R2, `encMeta`/`encKey` on the row. */
  async function addItem(id: string, meta: VaultMeta, plain: Uint8Array, o: { thumb?: Uint8Array; tamper?: boolean; deletedAt?: number } = {}) {
    const mk = await masterKey();
    const { dek, wrapped } = await newFileKey();
    const cipher = await encryptBytes(plain, dek);
    if (o.tamper) cipher[cipher.length - 1] ^= 1;
    objects.set(`${R2}/vault/${id}`, cipher);
    let thumbUrl: string | null = null;
    if (o.thumb) {
      thumbUrl = `${R2}/vault/${id}.thumb`;
      objects.set(thumbUrl, await encryptBytes(o.thumb, dek));
    }
    const row = storedItem({ id, encMeta: await encryptMeta(meta, mk), encKey: await wrapped(mk), thumbUrl, size: cipher.length, deletedAt: o.deletedAt ?? null });
    rows.push(row);
    return row;
  }

  /** A plain item (not in the Vault) with its object in the fake R2. */
  function addPlain(id: string, over: Partial<FileItem>, plain: Uint8Array) {
    objects.set(`${R2}/files/${id}`, plain);
    const row = storedItem({ id, inVault: false, encrypted: false, size: plain.length, ...over });
    rows.push(row);
    return row;
  }

  return { server, vault, client, fetchImpl, objects, puts, attempts, attempt, rows, created, updates, completesIn, completesOut, made, revoked, saved, state, deps: baseDeps, readDeps, masterKey, addItem, addPlain, recoveryKey };
}

const PDF_META: VaultMeta = { name: 'Hợp đồng.pdf', mime: 'application/pdf', kind: 'file' };
const PHOTO_META: VaultMeta = { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' };
const PDF = enc('%PDF contents of the lease agreement');
const PHOTO = enc('jpeg bytes of a photo');
const THUMB = enc('jpeg bytes of a thumbnail');

afterEach(() => vi.unstubAllGlobals());

describe('web Vault: status, setup and PIN checks', () => {
  it('answers the status as a Result and needs no open Vault', async () => {
    const w = await world({ open: false });
    expect(await w.vault.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ state: 'ready', remaining: 10 }) });
  });

  it('refuses a weak PIN before any request', async () => {
    const w = await world({ open: false });
    w.client.vaultSetup.mockClear();
    w.client.vaultStatus.mockClear();
    expect(await w.vault.vaultSetup('111111')).toEqual({ ok: false, error: 'weak_pin' });
    expect(await w.vault.vaultSetup('123456')).toEqual({ ok: false, error: 'weak_pin' });
    expect(w.client.vaultSetup).not.toHaveBeenCalled();
  });

  it.each([
    ['its first four digits', '1357'],
    ['its last four digits', '5792'],
  ])('refuses a Vault PIN whose %s are the app PIN, asking the (async) app-PIN check, before any request', async (_label, appPin) => {
    const asked: string[] = [];
    const w = await world({
      open: false,
      appPinMatches: async (pin4) => {
        asked.push(pin4);
        return pin4 === appPin;
      },
    });
    w.client.vaultSetup.mockClear();
    expect(await w.vault.vaultSetup(PIN)).toEqual({ ok: false, error: 'matches_app_pin' });
    expect(asked).toContain(appPin);
    expect(w.client.vaultSetup).not.toHaveBeenCalled();
  });

  it('sets up, returns the recovery key once, and the Vault is then open', async () => {
    const w = await world();
    expect(w.recoveryKey).toMatch(/\S{8,}/);
    expect(w.vault.uploadEncryptor().isOpen()).toBe(true);
    expect(await w.vault.listVault()).toEqual({ ok: true, value: [] });
  });

  describe('two-step setup (review I1)', () => {
    /** A set-up world whose server is reset to "none" and whose Vault is closed: the next setup is a first one. */
    async function fresh(over: Parameters<typeof world>[0] = {}) {
      const w = await world({ open: false, ...over });
      w.server.state.req = null;
      w.client.vaultSetup.mockClear();
      w.client.vaultStatus.mockClear();
      w.client.listEverything.mockClear();
      w.client.moveIn.mockClear();
      return w;
    }

    it('vaultSetupPrepare shows the recovery key and reaches no server: nothing is set up, nothing is open, nothing is converted', async () => {
      const w = await fresh();
      w.addPlain('LEG', { name: 'old.txt', mime: 'text/plain', inVault: true }, enc('written before encryption'));
      const res = await w.vault.vaultSetupPrepare(PIN);
      expect(res).toMatchObject({ ok: true, recoveryKey: expect.stringMatching(/\S{8,}/) });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(w.client.vaultSetup).not.toHaveBeenCalled();
      expect(w.server.state.req).toBeNull();
      expect(w.client.listEverything).not.toHaveBeenCalled(); // the background conversion has not started
      expect(w.client.moveIn).not.toHaveBeenCalled();
      expect(w.vault.uploadEncryptor().isOpen()).toBe(false);
    });

    it('vaultSetupCommit sets the vault up, opens it and starts the background conversion of old Vault files', async () => {
      const w = await fresh();
      w.addPlain('LEG', { name: 'old.txt', mime: 'text/plain', inVault: true }, enc('written before encryption'));
      const prepared = await w.vault.vaultSetupPrepare(PIN);
      if (!prepared.ok) throw new Error(prepared.error);
      expect(await w.vault.vaultSetupCommit()).toEqual({ ok: true });
      expect(w.client.vaultSetup).toHaveBeenCalledTimes(1);
      expect(w.server.state.req).not.toBeNull();
      expect(w.vault.uploadEncryptor().isOpen()).toBe(true);
      await vi.waitFor(() => expect(w.completesIn.map((c) => c.id)).toEqual(['LEG']));
      // The request carries what the PIN and the shown recovery key derive, and neither of them.
      expect(JSON.stringify(w.server.state.req)).not.toContain(prepared.recoveryKey);
      expect((await derivePinKeys(PIN, w.server.state.req!.kdfSalt, ITERATIONS)).authKey).toBe(w.server.state.req!.authKey);
    });

    it.each([
      ['weak', '111111', 'weak_pin'],
      ['app-PIN-like', PIN, 'matches_app_pin'],
    ])('a refused (%s) PIN makes no request, starts no conversion and leaves nothing to commit', async (_label, pin, error) => {
      const w = await fresh({ appPinMatches: (pin4) => pin4 === '1357' });
      expect(await w.vault.vaultSetupPrepare(pin)).toEqual({ ok: false, error });
      expect(await w.vault.vaultSetupCommit()).toEqual({ ok: false, error: 'no_prepared_setup' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(w.client.vaultSetup).not.toHaveBeenCalled();
      expect(w.client.listEverything).not.toHaveBeenCalled();
    });

    it('a failed commit (the server refuses) starts no conversion and stays closed', async () => {
      const w = await fresh();
      await w.vault.vaultSetupPrepare(PIN);
      w.client.vaultSetup.mockRejectedValueOnce(new ApiError('vault_exists', 'exists', 409));
      expect(await w.vault.vaultSetupCommit()).toEqual({ ok: false, error: 'vault_exists' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(w.client.listEverything).not.toHaveBeenCalled();
      expect(w.vault.uploadEncryptor().isOpen()).toBe(false);
    });

    it('vaultClose discards the prepared setup', async () => {
      const w = await fresh();
      await w.vault.vaultSetupPrepare(PIN);
      w.vault.vaultClose();
      expect(await w.vault.vaultSetupCommit()).toEqual({ ok: false, error: 'no_prepared_setup' });
      expect(w.client.vaultSetup).not.toHaveBeenCalled();
    });

    it('vaultLeave discards the prepared setup too (the wizard cancels with it): a commit after it posts nothing and the Vault stays closed', async () => {
      const w = await fresh();
      await w.vault.vaultSetupPrepare(PIN);
      w.vault.vaultLeave();
      expect(await w.vault.vaultSetupCommit()).toEqual({ ok: false, error: 'no_prepared_setup' });
      expect(w.client.vaultSetup).not.toHaveBeenCalled();
      expect(w.server.state.req).toBeNull();
      expect(w.vault.uploadEncryptor().isOpen()).toBe(false);
      expect(await w.vault.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    });

    it('vaultSetupCommit gives the view right at once: listVault works right after', async () => {
      const w = await fresh();
      await w.vault.vaultSetupPrepare(PIN);
      expect(await w.vault.vaultSetupCommit()).toEqual({ ok: true });
      expect((await w.vault.listVault()).ok).toBe(true);
    });

    it('refuses both steps with "locked" while the app is locked, and does not touch the server', async () => {
      const w = await fresh({ unlocked: false });
      expect(await w.vault.vaultSetupPrepare(PIN)).toEqual({ ok: false, error: 'locked' });
      expect(await w.vault.vaultSetupCommit()).toEqual({ ok: false, error: 'locked' });
      for (const [name, fn] of Object.entries(w.client)) expect(fn, name).not.toHaveBeenCalled();
    });
  });

  it('opens with the right PIN and maps the server answers: wrong, locked, wiped', async () => {
    const w = await world({ open: false });
    expect(await w.vault.vaultUnlock(PIN2)).toEqual({ ok: false, reason: 'wrong', remaining: 9 });
    w.server.state.nextUnlockError = new ApiError('http', 'Locked', 423, { remaining: 5, lockedUntil: 1_700_000_060_000 });
    expect(await w.vault.vaultUnlock(PIN)).toEqual({ ok: false, reason: 'locked', lockedUntil: 1_700_000_060_000 });
    w.server.state.nextUnlockError = new ApiError('vault_wiped', 'wiped', 410, { error: { code: 'vault_wiped', message: 'wiped' } });
    expect(await w.vault.vaultUnlock(PIN)).toEqual({ ok: false, reason: 'wiped' });
    expect(w.vault.uploadEncryptor().isOpen()).toBe(false);
    expect(await w.vault.vaultUnlock(PIN)).toEqual({ ok: true });
    expect(w.vault.uploadEncryptor().isOpen()).toBe(true);
  });

  it('recovers with the recovery key and a new PIN, which then opens it (the old one no longer does)', async () => {
    const w = await world({ open: false });
    expect(await w.vault.vaultRecover('not a recovery key', PIN2)).toEqual({ ok: false, error: 'bad_recovery_key' });
    expect(await w.vault.vaultRecover(w.recoveryKey, PIN2)).toEqual({ ok: true });
    expect(w.vault.uploadEncryptor().isOpen()).toBe(true);
    w.vault.vaultClose();
    expect(await w.vault.vaultUnlock(PIN)).toMatchObject({ ok: false, reason: 'wrong' });
    expect(await w.vault.vaultUnlock(PIN2)).toEqual({ ok: true });
  });

  it('changes the PIN with the old one; a weak or app-PIN-like new PIN is refused first', async () => {
    const w = await world({ open: false, appPinMatches: (pin4) => pin4 === '2468' });
    expect(await w.vault.vaultChangePin(PIN, '111111')).toEqual({ ok: false, error: 'weak_pin' });
    expect(await w.vault.vaultChangePin(PIN, PIN2)).toEqual({ ok: false, error: 'matches_app_pin' });
    expect(await w.vault.vaultChangePin(PIN, '864209')).toEqual({ ok: true });
    w.vault.vaultClose();
    expect(await w.vault.vaultUnlock(PIN)).toMatchObject({ ok: false, reason: 'wrong' });
    expect(await w.vault.vaultUnlock('864209')).toEqual({ ok: true });
  });

  it('refuses with "locked" while the app is locked and does not touch the server; closing is still allowed', async () => {
    const w = await world({ unlocked: false });
    for (const fn of Object.values(w.client)) if (typeof fn === 'function' && 'mockClear' in fn) (fn as { mockClear(): void }).mockClear();
    expect(await w.vault.vaultStatus()).toMatchObject({ ok: false, error: 'locked' });
    expect(await w.vault.vaultSetup(PIN)).toEqual({ ok: false, error: 'locked' });
    expect(await w.vault.vaultRecover('RK', PIN2)).toEqual({ ok: false, error: 'locked' });
    expect(await w.vault.vaultUnlock(PIN)).toEqual({ ok: false, reason: 'error', error: 'locked' });
    expect(await w.vault.vaultChangePin(PIN, PIN2)).toEqual({ ok: false, reason: 'error', error: 'locked' });
    expect(await w.vault.listVault()).toMatchObject({ ok: false, error: 'locked' });
    expect(await w.vault.vaultMoveIn(['A'])).toMatchObject({ ok: false, error: 'locked' });
    expect(await w.vault.addLink('https://example.com')).toMatchObject({ ok: false, error: 'locked' });
    for (const [name, fn] of Object.entries(w.client)) expect(fn, name).not.toHaveBeenCalled();
    expect(() => w.vault.vaultClose()).not.toThrow();
    expect(w.vault.uploadEncryptor().isOpen()).toBe(false);
  });
});

describe('web Vault: listing', () => {
  it('shows the real name, type and kind, and never the encrypted metadata or keys', async () => {
    const w = await world();
    const pdf = await w.addItem('A', PDF_META, PDF);
    const res = await w.vault.listVault();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0]).toMatchObject({ id: 'A', name: 'Hợp đồng.pdf', mime: 'application/pdf', kind: 'file', inVault: true, downloaded: false });
    const json = JSON.stringify(res);
    expect(json).not.toContain('encMeta');
    expect(json).not.toContain('encKey');
    expect(json).not.toContain(pdf.encMeta!);
    expect(json).not.toContain(pdf.encKey!);
  });

  it('shows no thumbnail for any item: no thumbUrl, no thumbnail request, no blob URL (the Vault never loads pictures by itself)', async () => {
    const w = await world();
    await w.addItem('P', PHOTO_META, PHOTO, { thumb: THUMB });
    await w.addItem('A', PDF_META, PDF);
    w.made.length = 0;
    const res = await w.vault.listVault();
    if (!res.ok) throw new Error(res.error);
    expect(res.value.map((i) => [i.id, i.thumbUrl])).toEqual([['P', null], ['A', null]]);
    expect(w.fetchImpl.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('.thumb'))).toEqual([]);
    expect(w.made).toHaveLength(0);
    expect(JSON.stringify(res)).not.toContain('r2.test'); // no presigned address of an encrypted object reaches the page's items
  });

  it('marks an item it cannot decrypt as unreadable and still shows the others', async () => {
    const w = await world();
    await w.addItem('A', PDF_META, PDF);
    const bad = await w.addItem('B', PHOTO_META, PHOTO);
    bad.encMeta = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const res = await w.vault.listVault();
    if (!res.ok) throw new Error(res.error);
    const byId = new Map(res.value.map((i) => [i.id, i]));
    expect(byId.get('A')).toMatchObject({ name: 'Hợp đồng.pdf' });
    expect(byId.get('A')!.unreadable).toBeUndefined();
    expect(byId.get('B')).toMatchObject({ name: '', unreadable: true });
  });

  it("lists the Vault's own trash with { trash: true }, and only that", async () => {
    const w = await world();
    await w.addItem('A', PDF_META, PDF);
    await w.addItem('T', PHOTO_META, PHOTO, { deletedAt: 1_700_000_100_000 });
    const trash = await w.vault.listVault({ trash: true });
    if (!trash.ok) throw new Error(trash.error);
    expect(trash.value.map((i) => i.id)).toEqual(['T']);
    expect(trash.value[0]).toMatchObject({ name: 'photo.jpg', deletedAt: 1_700_000_100_000 });
    expect(w.client.listEverything).toHaveBeenCalledWith({ vault: true, trash: true });
    const live = await w.vault.listVault();
    if (!live.ok) throw new Error(live.error);
    expect(live.value.map((i) => i.id)).toEqual(['A']);
  });

  it('answers vault_locked, with no request, while the Vault is closed', async () => {
    const w = await world({ open: false });
    w.client.listEverything.mockClear();
    expect(await w.vault.listVault()).toMatchObject({ ok: false, error: 'vault_locked' });
    expect(await w.vault.listVault({ trash: true })).toMatchObject({ ok: false, error: 'vault_locked' });
    expect(w.client.listEverything).not.toHaveBeenCalled();
  });
});

describe('web Vault: opening, saving and copying', () => {
  async function listed() {
    const w = await world();
    await w.addItem('A', PDF_META, PDF);
    await w.addItem('P', PHOTO_META, PHOTO, { thumb: THUMB });
    await w.vault.listVault();
    return w;
  }

  it('previewUrl is a blob: URL of the decrypted file, typed with the real mime', async () => {
    const w = await listed();
    w.made.length = 0;
    const res = await w.vault.previewUrl('A');
    expect(res).toEqual({ ok: true, value: expect.stringMatching(/^blob:/) });
    if (!res.ok) return;
    const [made] = w.made;
    expect(made.url).toBe(res.value);
    expect(made.blob.type).toBe('application/pdf');
    expect(same(await bytesOf(made.blob), PDF)).toBe(true);
  });

  it('download saves the decrypted bytes under the real name and mime, and nothing else', async () => {
    const w = await listed();
    const res = await w.vault.download('A');
    expect(res.ok).toBe(true);
    expect(w.saved).toHaveLength(1);
    expect(w.saved[0].name).toBe('Hợp đồng.pdf');
    expect(w.saved[0].mime).toBe('application/pdf');
    expect(same(w.saved[0].bytes, PDF)).toBe(true);
  });

  it('fileBytes and copyImageBytes return the plaintext', async () => {
    const w = await listed();
    const bytes = await w.vault.fileBytes('A');
    if (!bytes.ok) throw new Error(bytes.error);
    expect(same(bytes.value, PDF)).toBe(true);
    const image = await w.vault.copyImageBytes('P');
    if (!image.ok) throw new Error(image.error);
    expect(same(image.value, PHOTO)).toBe(true);
  });

  it('refuses a tampered file and saves nothing', async () => {
    const w = await world();
    await w.addItem('X', PDF_META, PDF, { tamper: true });
    await w.vault.listVault();
    expect((await w.vault.fileBytes('X')).ok).toBe(false);
    expect((await w.vault.download('X')).ok).toBe(false);
    expect(w.saved).toEqual([]);
  });

  it('answers not_found for an id the Vault never listed', async () => {
    const w = await listed();
    for (const call of [w.vault.fileBytes('nope'), w.vault.download('nope'), w.vault.previewUrl('nope'), w.vault.copyImageBytes('nope')]) {
      expect(await call).toMatchObject({ ok: false, error: 'not_found' });
    }
  });

  it('answers vault_locked, with no network call, once the Vault is closed', async () => {
    const w = await listed();
    w.vault.vaultClose();
    w.fetchImpl.mockClear();
    w.client.downloadUrl.mockClear();
    for (const call of [w.vault.fileBytes('A'), w.vault.download('A'), w.vault.previewUrl('A'), w.vault.copyImageBytes('P')]) {
      expect(await call).toMatchObject({ ok: false, error: 'vault_locked' });
    }
    expect(w.fetchImpl).not.toHaveBeenCalled();
    expect(w.client.downloadUrl).not.toHaveBeenCalled();
    expect(w.saved).toEqual([]);
  });

  it('owns the encrypted items it listed, even after closing, and nothing else (legacy items take the plain path)', async () => {
    const w = await world();
    await w.addItem('A', PDF_META, PDF);
    w.rows.push(storedItem({ id: 'LEG', name: 'old.txt', mime: 'text/plain', encrypted: false }));
    expect(w.vault.owns('A')).toBe(false); // not listed yet
    await w.vault.listVault();
    expect(w.vault.owns('A')).toBe(true);
    expect(w.vault.owns('LEG')).toBe(false);
    expect(w.vault.owns('nope')).toBe(false);
    w.vault.vaultClose();
    expect(w.vault.owns('A')).toBe(true);
  });
});

describe('web Vault: closing', () => {
  it('revokes EVERY object URL it made (the previews), synchronously, then refuses to list', async () => {
    const w = await world();
    await w.addItem('P', PHOTO_META, PHOTO);
    await w.addItem('Q', PHOTO_META, PHOTO);
    await w.addItem('A', PDF_META, PDF);
    await w.vault.listVault();
    await w.vault.previewUrl('A');
    await w.vault.previewUrl('P');
    await w.vault.listVault(); // a second listing must not leave the first one's URLs behind
    expect(w.made.length).toBeGreaterThanOrEqual(2);

    w.vault.vaultClose(); // not awaited: the key and the URLs are gone by the time it returns
    expect(new Set(w.revoked)).toEqual(new Set(w.made.map((m) => m.url)));
    expect(await w.vault.listVault()).toMatchObject({ ok: false, error: 'vault_locked' });
  });

  it('can be closed twice, and a closed Vault makes no new URL', async () => {
    const w = await world();
    await w.addItem('P', PHOTO_META, PHOTO, { thumb: THUMB });
    await w.vault.listVault();
    w.vault.vaultClose();
    const revokedOnce = [...w.revoked];
    w.vault.vaultClose(); // closing again is harmless
    expect(new Set(w.revoked)).toEqual(new Set(revokedOnce));
    const before = w.made.length;
    await w.vault.listVault();
    await w.vault.previewUrl('P');
    expect(w.made).toHaveLength(before);
  });

  it('never refuses to close while the app is locked', async () => {
    const w = await world();
    await w.addItem('P', PHOTO_META, PHOTO, { thumb: THUMB });
    await w.vault.listVault();
    w.state.unlocked = false;
    w.vault.vaultClose();
    expect(new Set(w.revoked)).toEqual(new Set(w.made.map((m) => m.url)));
    expect(w.vault.uploadEncryptor().isOpen()).toBe(false);
  });
});

describe('web Vault: secrets stay in memory', () => {
  /** An in-memory localStorage that counts writes, and spies for the other browser stores. */
  function stubStores() {
    const data = new Map<string, string>();
    const localStorage = {
      getItem: vi.fn((k: string) => data.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => void data.set(k, String(v))),
      removeItem: vi.fn((k: string) => void data.delete(k)),
      clear: vi.fn(() => data.clear()),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    };
    const indexedDB = { open: vi.fn(() => { throw new Error('IndexedDB must not be used by the Vault'); }) };
    const caches = { open: vi.fn(async () => { throw new Error('Cache Storage (the link-picture store) must not be used by the Vault'); }) };
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('indexedDB', indexedDB);
    vi.stubGlobal('caches', caches);
    return { data, localStorage, indexedDB, caches };
  }

  it('writes nothing to localStorage, IndexedDB or Cache Storage through setup, unlock, listing, preview, download and close', async () => {
    const stores = stubStores();
    stores.localStorage.setItem('fatup.web.v1', '{"existing":"app data"}');
    stores.localStorage.setItem.mockClear();
    const before = new Map(stores.data);

    const w = await world();
    await w.addItem('P', PHOTO_META, PHOTO, { thumb: THUMB });
    await w.addItem('A', PDF_META, PDF);
    await w.vault.listVault();
    await w.vault.previewUrl('A');
    await w.vault.download('A');
    await w.vault.fileBytes('P');
    await w.vault.addLink('https://example.com/secret-page', 'Secret title');
    w.vault.vaultClose();
    await w.vault.vaultUnlock(PIN);
    await w.vault.listVault({ trash: true });
    w.vault.vaultClose();

    expect(stores.localStorage.setItem).not.toHaveBeenCalled();
    expect(stores.localStorage.removeItem).not.toHaveBeenCalled();
    expect(new Map(stores.data)).toEqual(before);
    expect(stores.indexedDB.open).not.toHaveBeenCalled();
    expect(stores.caches.open).not.toHaveBeenCalled();
  });

  it('reads no dep other than the pinned ones (in particular no preview store)', async () => {
    stubStores();
    const w = await world();
    await w.addItem('P', PHOTO_META, PHOTO, { thumb: THUMB });
    await w.vault.listVault();
    await w.vault.previewUrl('P');
    await w.vault.download('P');
    await w.vault.addLink('https://example.com/');
    w.vault.vaultClose();
    expect([...w.readDeps].filter((k) => !ALLOWED_DEPS.includes(k))).toEqual([]);
  });

  it('hands the page no key material: no master key, file key, server secret or wrapped key in any answer', async () => {
    const w = await world();
    await w.addItem('P', PHOTO_META, PHOTO, { thumb: THUMB });
    const req = w.server.state.req!;
    const secrets = [req.serverSecret, req.wrappedMkPin, req.authKey, w.server.state.rkAuth!, w.server.state.wrappedMkRecovery!];
    const answers: unknown[] = [
      await w.vault.vaultStatus(),
      await w.vault.listVault(),
      await w.vault.listVault({ trash: true }),
      await w.vault.previewUrl('P'),
      await w.vault.download('P'),
      await w.vault.updateFile('P', { name: 'renamed.jpg' }),
      await w.vault.addLink('https://example.com/', 'Title'),
      await w.vault.vaultMoveOut(['P']),
      await w.vault.vaultUnlock(PIN2),
    ];
    for (const s of secrets) expect(s).toMatch(/\S{10,}/); // the scan below is not vacuous
    const json = JSON.stringify(answers);
    for (const s of secrets) expect(json).not.toContain(s);
    // the recovery key is shown once, by setup, and by nothing else
    expect(json).not.toContain(w.recoveryKey);
  });

  it('keeps the file key it hands the uploader non-extractable', async () => {
    const w = await world();
    const sealed = await w.vault.uploadEncryptor().encryptMetaFor({ name: 'a.bin', mime: 'application/octet-stream', kind: 'file' });
    expect(sealed.dek.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', sealed.dek)).rejects.toBeTruthy();
  });
});

describe('web Vault: moving in and out', () => {
  it('moves a plain file in: ciphertext uploaded, real name only inside encMeta, and then it lists decrypted', async () => {
    const w = await world();
    w.addPlain('A', { name: 'Hợp đồng.pdf', mime: 'application/pdf', kind: 'file' }, PDF);
    expect(await w.vault.vaultMoveIn(['A'])).toEqual({ ok: true, value: { done: 1, failed: [] } });

    const put = w.puts.find((p) => p.url === `${R2}/put/vault/A.${w.attempt('A')}`)!;
    expect(dec(put.body.subarray(0, 4))).toBe('FUV1');
    expect(put.body.length).toBe(vaultCiphertextSize(PDF.length));
    const [{ req }] = w.completesIn;
    expect(req.size).toBe(put.body.length);
    expect(await decryptMeta(req.encMeta, await w.masterKey())).toMatchObject({ name: 'Hợp đồng.pdf', mime: 'application/pdf', kind: 'file' });
    expect(same(await decryptBytes(put.body, await unwrapFileKey(req.encKey, await w.masterKey())), PDF)).toBe(true);
    expect(JSON.stringify(w.client.moveIn.mock.calls) + JSON.stringify(w.completesIn)).not.toContain('Hợp đồng');

    const res = await w.vault.listVault();
    if (!res.ok) throw new Error(res.error);
    expect(res.value[0]).toMatchObject({ id: 'A', name: 'Hợp đồng.pdf', mime: 'application/pdf' });
  });

  it('PUTs to the address of the attempt and completes with that attempt: no etag, no claim, and no ETag header needed (spec 4.7d)', async () => {
    const w = await world();
    w.addPlain('A', { name: 'a.txt', mime: 'text/plain' }, enc('a'));
    expect(await w.vault.vaultMoveIn(['A'])).toEqual({ ok: true, value: { done: 1, failed: [] } });
    expect(w.attempts.get('A')).toHaveLength(1);
    expect(w.puts.map((p) => p.url)).toEqual([`${R2}/put/vault/A.${w.attempt('A')}`]);
    const [{ req }] = w.completesIn;
    expect(req.attempt).toBe(w.attempt('A'));
    expect(req).not.toHaveProperty('etag');
    expect(req).not.toHaveProperty('claim');
  });

  it('gives every item its own attempt', async () => {
    const w = await world();
    w.addPlain('A', { name: 'a.txt', mime: 'text/plain' }, enc('a'));
    w.addPlain('B', { name: 'b.txt', mime: 'text/plain' }, enc('b'));
    await w.vault.vaultMoveIn(['A', 'B']);
    expect(w.completesIn.map((c) => c.req.attempt)).toEqual([w.attempt('A'), w.attempt('B')]);
    expect(w.attempt('A')).not.toBe(w.attempt('B'));
  });

  it('reports an item whose completion answers 409 as failed, without a retry (no second vault/in, no second PUT), and moves the rest', async () => {
    const w = await world();
    w.addPlain('A', { name: 'a.txt', mime: 'text/plain' }, enc('a'));
    w.addPlain('B', { name: 'b.txt', mime: 'text/plain' }, enc('b'));
    w.client.moveInComplete.mockImplementationOnce(async (id: string, req: VaultMoveInComplete) => {
      w.completesIn.push({ id, req: JSON.parse(JSON.stringify(req)) as VaultMoveInComplete });
      throw new ApiError('item_changed', 'The item changed', 409, { error: { code: 'item_changed', message: 'changed' } });
    });
    expect(await w.vault.vaultMoveIn(['A', 'B'])).toEqual({ ok: true, value: { done: 1, failed: ['A'] } });
    expect(w.client.moveIn.mock.calls.filter(([id]) => id === 'A')).toHaveLength(1);
    expect(w.puts.filter((p) => p.url.includes('/put/vault/A.'))).toHaveLength(1);
    expect(w.completesIn.filter((c) => c.id === 'A')).toHaveLength(1);
    expect(w.completesIn.at(-1)!.id).toBe('B');
  });

  it('reports an item whose PUT answers 500 as failed, without completing it, and moves the rest', async () => {
    const w = await world();
    w.addPlain('A', { name: 'a.txt', mime: 'text/plain' }, enc('a'));
    w.addPlain('B', { name: 'b.txt', mime: 'text/plain' }, enc('b'));
    const real = w.fetchImpl.getMockImplementation()!;
    w.fetchImpl.mockImplementation(async (input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PUT' && String(input).includes('/put/vault/A.') ? new Response('boom', { status: 500 }) : real(input, init),
    );
    expect(await w.vault.vaultMoveIn(['A', 'B'])).toEqual({ ok: true, value: { done: 1, failed: ['A'] } });
    expect(w.completesIn.map((c) => c.id)).toEqual(['B']);
    expect(w.client.moveIn.mock.calls.filter(([id]) => id === 'A')).toHaveLength(1);
  });

  it('retries a failed item on a later run with a NEW attempt', async () => {
    const w = await world();
    w.addPlain('A', { name: 'a.txt', mime: 'text/plain' }, enc('a'));
    w.client.moveInComplete.mockImplementationOnce(async (id: string, req: VaultMoveInComplete) => {
      w.completesIn.push({ id, req: JSON.parse(JSON.stringify(req)) as VaultMoveInComplete });
      throw new ApiError('item_changed', 'The item changed', 409, { error: { code: 'item_changed', message: 'changed' } });
    });
    expect(await w.vault.vaultMoveIn(['A'])).toEqual({ ok: true, value: { done: 0, failed: ['A'] } });
    expect(await w.vault.vaultMoveIn(['A'])).toEqual({ ok: true, value: { done: 1, failed: [] } });
    expect(w.attempts.get('A')).toHaveLength(2);
    expect(w.attempt('A', 1)).not.toBe(w.attempt('A', 0));
    expect(w.completesIn.map((c) => c.req.attempt)).toEqual([w.attempt('A', 0), w.attempt('A', 1)]);
    expect(w.puts.map((p) => p.url)).toEqual([`${R2}/put/vault/A.${w.attempt('A', 0)}`, `${R2}/put/vault/A.${w.attempt('A', 1)}`]);
  });

  it('sends no attempt in the cleanup call after a failed move out (the row is already encrypted), and no etag or claim', async () => {
    const w = await world();
    await w.addItem('E', PDF_META, PDF);
    await w.vault.listVault();
    w.client.moveOutComplete.mockRejectedValueOnce(new ApiError('network', 'down'));
    await w.vault.vaultMoveOut(['E']);
    expect(w.completesIn).toHaveLength(1);
    for (const field of ['attempt', 'claim', 'etag']) expect(w.completesIn[0].req).not.toHaveProperty(field);
    expect(w.attempts.get('E')).toBeUndefined();
  });

  it('does not use the legacy setVault when the Vault has not been set up (state none): it refuses and calls nothing', async () => {
    const w = await world();
    w.addPlain('A', { name: 'a.txt', mime: 'text/plain' }, enc('a'));
    w.vault.vaultClose();
    w.server.state.req = null; // the server says: no Vault yet
    const res = await w.vault.vaultMoveIn(['A']);
    expect(res.ok).toBe(false);
    expect(w.client.setVault).not.toHaveBeenCalled();
    expect(w.client.moveIn).not.toHaveBeenCalled();
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it('cleans up the plain copy when a move out fails after the plain upload (review C3)', async () => {
    const w = await world();
    const row = await w.addItem('E', PDF_META, PDF);
    await w.vault.listVault();
    w.client.moveOutComplete.mockRejectedValueOnce(new ApiError('network', 'down'));
    expect(await w.vault.vaultMoveOut(['E'])).toEqual({ ok: true, value: { done: 0, failed: ['E'] } });
    expect(w.puts.some((p) => p.url === `${R2}/put/files/E`)).toBe(true);
    expect(w.completesIn).toEqual([{ id: 'E', req: { encMeta: row.encMeta, encKey: row.encKey, size: row.size, hasThumb: false } }]);
  });

  it('reports an id it cannot find among the failures and moves the rest', async () => {
    const w = await world();
    w.addPlain('A', { name: 'a.txt', mime: 'text/plain' }, enc('a'));
    expect(await w.vault.vaultMoveIn(['ghost', 'A'])).toEqual({ ok: true, value: { done: 1, failed: ['ghost'] } });
  });

  it('moves an encrypted file out: plaintext uploaded back under its real name and type, and it is plain again', async () => {
    const w = await world();
    await w.addItem('E', PDF_META, PDF);
    await w.vault.listVault();
    expect(await w.vault.vaultMoveOut(['E'])).toEqual({ ok: true, value: { done: 1, failed: [] } });

    const put = w.puts.find((p) => p.url === `${R2}/put/files/E`)!;
    expect(same(put.body, PDF)).toBe(true);
    expect(w.completesOut).toEqual([{ id: 'E', req: expect.objectContaining({ name: 'Hợp đồng.pdf', mime: 'application/pdf', size: PDF.length }) }]);
    expect(w.vault.owns('E')).toBe(false); // plain again: the plain paths apply
  });

  it('answers vault_locked and does nothing while the Vault is closed', async () => {
    const w = await world();
    await w.addItem('E', PDF_META, PDF);
    w.addPlain('A', { name: 'a.txt', mime: 'text/plain' }, enc('a'));
    await w.vault.listVault();
    w.vault.vaultClose();
    w.fetchImpl.mockClear();
    expect(await w.vault.vaultMoveIn(['A'])).toMatchObject({ ok: false, error: 'vault_locked' });
    expect(await w.vault.vaultMoveOut(['E'])).toMatchObject({ ok: false, error: 'vault_locked' });
    expect(w.client.moveIn).not.toHaveBeenCalled();
    expect(w.client.moveOut).not.toHaveBeenCalled();
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it('reports one progress call per item, and the callback can be removed', async () => {
    const w = await world();
    w.addPlain('A', { name: 'a.txt', mime: 'text/plain' }, enc('a'));
    w.addPlain('B', { name: 'b.txt', mime: 'text/plain' }, enc('b'));
    const seen: { done: number; total: number }[] = [];
    const off = w.vault.onVaultProgress((p) => seen.push({ done: p.done, total: p.total }));
    await w.vault.vaultMoveIn(['A', 'B']);
    expect(seen).toEqual([{ done: 1, total: 2 }, { done: 2, total: 2 }]);
    off();
    w.addPlain('C', { name: 'c.txt', mime: 'text/plain' }, enc('c'));
    await w.vault.vaultMoveIn(['C']);
    expect(seen).toHaveLength(2);
  });

  it('encrypts the legacy Vault files in the background after unlocking, without making unlock wait', async () => {
    const w = await world({ open: false });
    w.addPlain('LEG', { name: 'old.txt', mime: 'text/plain', inVault: true }, enc('written before encryption'));
    expect(await w.vault.vaultUnlock(PIN)).toEqual({ ok: true });
    await vi.waitFor(() => expect(w.completesIn.map((c) => c.id)).toEqual(['LEG']));
    expect(await decryptMeta(w.completesIn[0].req.encMeta, await w.masterKey())).toMatchObject({ name: 'old.txt', mime: 'text/plain' });
  });
});

describe('web Vault: renaming and adding links', () => {
  it('renames with a new encMeta only: the plain name never goes to the server', async () => {
    const w = await world();
    await w.addItem('A', PDF_META, PDF);
    await w.vault.listVault();
    const res = await w.vault.updateFile('A', { name: 'Biên bản.pdf' });
    expect(res).toMatchObject({ ok: true, value: { id: 'A', name: 'Biên bản.pdf', mime: 'application/pdf' } });
    expect(w.updates).toHaveLength(1);
    expect(Object.keys(w.updates[0].patch)).toEqual(['encMeta']);
    expect(JSON.stringify(w.updates)).not.toContain('Biên bản');
    expect(await decryptMeta(w.updates[0].patch.encMeta!, await w.masterKey())).toMatchObject({ name: 'Biên bản.pdf', mime: 'application/pdf', kind: 'file' });
    expect(JSON.stringify(res)).not.toContain('encMeta');
  });

  it('sends tags and important next to encMeta, and alone when nothing is renamed', async () => {
    const w = await world();
    await w.addItem('A', PDF_META, PDF);
    await w.vault.listVault();
    await w.vault.updateFile('A', { name: 'b.pdf', tags: ['red'], important: true });
    expect(Object.keys(w.updates[0].patch).sort()).toEqual(['encMeta', 'important', 'tags']);
    await w.vault.updateFile('A', { tags: ['blue'] });
    expect(w.updates[1].patch).toEqual({ tags: ['blue'] });
  });

  it('answers not_found for an item it does not own, without a request', async () => {
    const w = await world();
    w.addPlain('PLAIN', { name: 'x.txt', mime: 'text/plain' }, enc('x'));
    expect(await w.vault.updateFile('PLAIN', { name: 'y.txt' })).toMatchObject({ ok: false, error: 'not_found' });
    expect(w.client.update).not.toHaveBeenCalled();
  });

  it('adds a link as an encrypted 32-byte upload, never through the plain /links route', async () => {
    const w = await world();
    const res = await w.vault.addLink('https://example.com/a?x=1', 'Tiêu đề bí mật');
    expect(res).toMatchObject({ ok: true, value: { kind: 'link', url: 'https://example.com/a?x=1', name: 'Tiêu đề bí mật', inVault: true } });
    expect(w.client.addLink).not.toHaveBeenCalled();

    expect(w.created).toHaveLength(1);
    const { req } = w.created[0];
    expect(req).toMatchObject({ name: '', mime: 'application/octet-stream', size: 32, hasThumb: false, device: DEVICE });
    expect(req.size).toBe(vaultCiphertextSize(0));
    expect(JSON.stringify(req)).not.toContain('example.com');
    expect(JSON.stringify(req)).not.toContain('bí mật');
    expect(await decryptMeta(req.vault!.encMeta, await w.masterKey())).toEqual({ kind: 'link', url: 'https://example.com/a?x=1', title: 'Tiêu đề bí mật', name: 'Tiêu đề bí mật', mime: LINK_MIME });

    const put = w.puts.find((p) => p.url === `${R2}/put/vault/N1`)!;
    expect(put.body.length).toBe(32);
    expect(dec(put.body.subarray(0, 4))).toBe('FUV1');
    expect((await decryptBytes(put.body, await unwrapFileKey(req.vault!.encKey, await w.masterKey()))).length).toBe(0);
    expect(w.vault.owns('N1')).toBe(true);
  });

  it('names a link without a title after its host, and refuses a bad address or a closed Vault', async () => {
    const w = await world();
    const ok = await w.vault.addLink('https://example.com/page');
    expect(ok).toMatchObject({ ok: true, value: { name: 'example.com', kind: 'link' } });
    const before = w.created.length;
    expect(await w.vault.addLink('not an address')).toMatchObject({ ok: false, error: 'bad_url' });
    w.vault.vaultClose();
    expect(await w.vault.addLink('https://example.com/other')).toMatchObject({ ok: false, error: 'vault_locked' });
    expect(w.created).toHaveLength(before);
  });
});

describe('web Vault: the encryptor for uploads', () => {
  it('seals metadata under the Vault key and mints a file key, while open', async () => {
    const w = await world();
    const encryptor = w.vault.uploadEncryptor();
    expect(encryptor.isOpen()).toBe(true);
    const meta: VaultMeta = { name: 'a.png', mime: 'image/png', kind: 'image' };
    const sealed = await encryptor.encryptMetaFor(meta);
    expect(await decryptMeta(sealed.encMeta, await w.masterKey())).toEqual(meta);
    const dek = await unwrapFileKey(sealed.encKey, await w.masterKey());
    const cipher = await encryptBytes(enc('hello'), sealed.dek);
    expect(dec(await decryptBytes(cipher, dek))).toBe('hello');
  });

  it('is closed after vaultClose, and then refuses with vault_locked', async () => {
    const w = await world();
    const encryptor = w.vault.uploadEncryptor();
    w.vault.vaultClose();
    expect(encryptor.isOpen()).toBe(false);
    await expect(encryptor.encryptMetaFor({ name: 'a', mime: 'x/y', kind: 'file' })).rejects.toMatchObject({ code: 'vault_locked' });
  });
});

// Plan 2026-11-18-vault-session-6h: the page keeps the Vault open for 6 hours after a successful opening, and says so in `vaultStatus`.
describe('web Vault: the 6-hour session (plan 2026-11-18-vault-session-6h)', () => {
  const HOUR = 60 * 60 * 1000;
  const T0 = 1_700_000_000_000;

  /**
   * A closed Vault with one encrypted photo that has a thumbnail. The fake clock starts only after the world is built (its setup
   * waits on a real timer), and the Vault is then opened under it, so the session timer is a fake one.
   */
  async function openedUnderFakeTime() {
    const w = await world({ open: false });
    await w.addItem('P1', PHOTO_META, PHOTO, { thumb: THUMB });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(T0);
    expect(await w.vault.vaultUnlock(PIN)).toEqual({ ok: true });
    return w;
  }
  const isOpen = async (w: Awaited<ReturnType<typeof world>>) => {
    const res = await w.vault.vaultStatus();
    return res.ok ? (res.value as { open?: boolean }).open : undefined;
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds open to the status: false while closed, true after unlock, false after vaultClose', async () => {
    const w = await world({ open: false });
    expect(await w.vault.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ state: 'ready', open: false }) });
    await w.vault.vaultUnlock(PIN);
    expect(await w.vault.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
    w.vault.vaultClose();
    expect(await w.vault.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
  });

  it('is open right after setup (setup opens the Vault)', async () => {
    const w = await world();
    expect(await w.vault.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
  });

  it('is open until the last millisecond of the 6 hours and closed at the sixth hour', async () => {
    const w = await openedUnderFakeTime();
    vi.advanceTimersByTime(VAULT_SESSION_MS - 1);
    expect(await isOpen(w)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(await isOpen(w)).toBe(false);
  });

  it('revokes every blob: URL it made, and lists as vault_locked, when the timer ends the session', async () => {
    const w = await openedUnderFakeTime();
    const listed = await w.vault.listVault();
    expect(listed.ok && listed.value[0].thumbUrl).toBeNull(); // the Vault lists no thumbnail
    expect(await w.vault.previewUrl('P1')).toEqual({ ok: true, value: expect.stringMatching(/^blob:/) }); // opening a picture makes the URL
    expect(w.made.length).toBeGreaterThan(0);
    expect(w.revoked).toEqual([]);
    vi.advanceTimersByTime(VAULT_SESSION_MS);
    expect(w.revoked).toEqual(w.made.map((m) => m.url));
    expect(await w.vault.listVault()).toEqual({ ok: false, error: 'vault_locked' });
  });

  it('answers vault_locked on use, and revokes the blob: URLs, when the clock is past the 6 hours but the throttled tab ran no timer', async () => {
    const w = await openedUnderFakeTime();
    await w.vault.listVault();
    vi.setSystemTime(T0 + VAULT_SESSION_MS);
    expect(await w.vault.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(w.revoked).toEqual(w.made.map((m) => m.url));
    expect(await isOpen(w)).toBe(false);
  });

  it('does not stop the uploader from seeing a closed Vault after expiry (uploadEncryptor().isOpen() is false)', async () => {
    const w = await openedUnderFakeTime();
    expect(w.vault.uploadEncryptor().isOpen()).toBe(true);
    vi.advanceTimersByTime(VAULT_SESSION_MS);
    expect(w.vault.uploadEncryptor().isOpen()).toBe(false);
  });

  it('does not extend the 6 hours when the Vault is used', async () => {
    const w = await openedUnderFakeTime();
    vi.advanceTimersByTime(5 * HOUR);
    expect((await w.vault.listVault()).ok).toBe(true);
    vi.advanceTimersByTime(HOUR);
    expect(await isOpen(w)).toBe(false);
  });

  it('opens again for another 6 hours with a new unlock after the session ended', async () => {
    const w = await openedUnderFakeTime();
    vi.advanceTimersByTime(VAULT_SESSION_MS);
    expect(await w.vault.vaultUnlock(PIN)).toEqual({ ok: true });
    vi.advanceTimersByTime(VAULT_SESSION_MS - 1);
    expect(await isOpen(w)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(await isOpen(w)).toBe(false);
  });

  it('keeps the Vault open across listings and trash listings (nothing but vaultClose and expiry closes it)', async () => {
    const w = await openedUnderFakeTime();
    await w.vault.listVault();
    await w.vault.listVault({ trash: true });
    vi.advanceTimersByTime(3 * HOUR);
    await w.vault.listVault();
    expect(await isOpen(w)).toBe(true);
    expect(w.revoked).toEqual([]);
  });

  it('retries a legacy (not yet encrypted) Vault item found by listVault in an open session', async () => {
    const w = await openedUnderFakeTime();
    w.addPlain('LEG', { name: 'old.txt', mime: 'text/plain', inVault: true }, enc('written before encryption'));
    expect(w.completesIn).toEqual([]);
    await w.vault.listVault();
    // The conversion runs in the background (crypto + fake fetch). setImmediate is not faked here, so wait on it without moving the fake clock.
    for (let i = 0; i < 300 && w.completesIn.length === 0; i++) await new Promise<void>((resolve) => (globalThis as unknown as { setImmediate(cb: () => void): void }).setImmediate(resolve));
    expect(w.completesIn.map((c) => c.id)).toEqual(['LEG']);
  });
});

// Plan 2026-11-18-vault-session-6h (rewritten decisions 3 to 5): viewing the Vault always needs the PIN; only moving files in skips it
// for 6 hours. `vaultUnlock(pin, 'view' | 'move')`, `vaultLeave()` (view-only close, key kept), `vaultClose()` (full close).
describe('web Vault: viewing and moving are separate rights', () => {
  const T0 = 1_700_000_000_000;

  async function closedWorld() {
    const w = await world({ open: false });
    await w.addItem('P1', PHOTO_META, PHOTO, { thumb: THUMB });
    await w.addItem('D1', PDF_META, PDF);
    w.addPlain('PLAIN', { name: 'a.txt', mime: 'text/plain' }, enc('plain text'));
    return w;
  }
  const status = async (w: Awaited<ReturnType<typeof world>>) => {
    const res = await w.vault.vaultStatus();
    return res.ok ? (res.value as { open?: boolean }).open : undefined;
  };
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('vaultLeave', () => {
    it('is synchronous, revokes every blob: URL, and makes listVault answer vault_locked without a request', async () => {
      const w = await closedWorld();
      await w.vault.vaultUnlock(PIN);
      expect((await w.vault.listVault()).ok).toBe(true);
      expect((await w.vault.previewUrl('P1')).ok).toBe(true);
      expect(w.made.length).toBeGreaterThan(0);
      expect(w.vault.vaultLeave()).toBeUndefined();
      expect(w.revoked).toEqual(w.made.map((m) => m.url));
      w.client.listEverything.mockClear();
      expect(await w.vault.listVault()).toEqual({ ok: false, error: 'vault_locked' });
      expect(w.client.listEverything).not.toHaveBeenCalled();
    });

    it('keeps the key: the status still says open, and moving a plain file in still works with no PIN', async () => {
      const w = await closedWorld();
      await w.vault.vaultUnlock(PIN);
      w.vault.vaultLeave();
      expect(await status(w)).toBe(true);
      expect(await w.vault.vaultMoveIn(['PLAIN'])).toEqual({ ok: true, value: { done: 1, failed: [] } });
      expect(w.completesIn.map((c) => c.id)).toEqual(['PLAIN']);
    });

    it('refuses everything that needs the view right, with vault_locked and no network call', async () => {
      const w = await closedWorld();
      await w.vault.vaultUnlock(PIN);
      await w.vault.listVault();
      w.vault.vaultLeave();
      w.client.downloadUrl.mockClear();
      w.client.update.mockClear();
      w.client.createUpload.mockClear();
      w.client.moveOut.mockClear();
      expect(await w.vault.fileBytes('D1')).toEqual({ ok: false, error: 'vault_locked' });
      expect(await w.vault.copyImageBytes('P1')).toEqual({ ok: false, error: 'vault_locked' });
      expect(await w.vault.download('D1')).toEqual({ ok: false, error: 'vault_locked' });
      expect(await w.vault.previewUrl('D1')).toEqual({ ok: false, error: 'vault_locked' });
      expect(await w.vault.updateFile('D1', { name: 'x.pdf' })).toEqual({ ok: false, error: 'vault_locked' });
      expect(await w.vault.addLink('https://example.com')).toEqual({ ok: false, error: 'vault_locked' });
      expect(await w.vault.vaultMoveOut(['D1'])).toEqual({ ok: false, error: 'vault_locked' });
      expect(w.client.downloadUrl).not.toHaveBeenCalled();
      expect(w.client.update).not.toHaveBeenCalled();
      expect(w.client.createUpload).not.toHaveBeenCalled();
      expect(w.client.moveOut).not.toHaveBeenCalled();
      expect(w.saved).toEqual([]);
    });

    it('changing the PIN is not gated on the view right: after vaultLeave the right old PIN works, a wrong one is the server answer, the new PIN opens', async () => {
      const w = await closedWorld();
      await w.vault.vaultUnlock(PIN);
      w.vault.vaultLeave();
      expect(await w.vault.vaultChangePin(PIN2, '864209')).toMatchObject({ ok: false, reason: 'wrong' });
      expect(await w.vault.vaultChangePin(PIN, PIN2)).toEqual({ ok: true });
      w.vault.vaultClose();
      expect(await w.vault.vaultUnlock(PIN2, 'view')).toEqual({ ok: true });
      expect((await w.vault.listVault()).ok).toBe(true);
    });

    it('keeps owning the ids it listed, so the plain paths never take them', async () => {
      const w = await closedWorld();
      await w.vault.vaultUnlock(PIN);
      await w.vault.listVault();
      w.vault.vaultLeave();
      expect(w.vault.owns('D1')).toBe(true);
    });

    it('is undone by a view unlock, which lists again with the real names', async () => {
      const w = await closedWorld();
      await w.vault.vaultUnlock(PIN);
      w.vault.vaultLeave();
      expect(await w.vault.vaultUnlock(PIN, 'view')).toEqual({ ok: true });
      const listed = await w.vault.listVault();
      expect(listed.ok && listed.value.map((i) => i.name).sort()).toEqual([PDF_META.name, PHOTO_META.name].sort());
    });
  });

  describe("vaultUnlock(pin, 'move')", () => {
    it('holds the key (open: true) but the Vault cannot be viewed: listVault answers vault_locked', async () => {
      const w = await closedWorld();
      expect(await w.vault.vaultUnlock(PIN, 'move')).toEqual({ ok: true });
      expect(await status(w)).toBe(true);
      w.client.listEverything.mockClear();
      expect(await w.vault.listVault()).toEqual({ ok: false, error: 'vault_locked' });
      expect(await w.vault.listVault({ trash: true })).toEqual({ ok: false, error: 'vault_locked' });
      expect(w.client.listEverything).not.toHaveBeenCalled();
    });

    it('changing the PIN works after a move unlock with the right old PIN, and a wrong one gets the server answer', async () => {
      const w = await closedWorld();
      await w.vault.vaultUnlock(PIN, 'move');
      expect(await w.vault.vaultChangePin(PIN2, '864209')).toMatchObject({ ok: false, reason: 'wrong' });
      expect(await w.vault.vaultChangePin(PIN, PIN2)).toEqual({ ok: true });
      w.vault.vaultClose();
      expect(await w.vault.vaultUnlock(PIN2, 'move')).toEqual({ ok: true });
    });

    it('moves a plain file in, which is what the popup is for', async () => {
      const w = await closedWorld();
      await w.vault.vaultUnlock(PIN, 'move');
      expect(await w.vault.vaultMoveIn(['PLAIN'])).toEqual({ ok: true, value: { done: 1, failed: [] } });
    });

    it('refuses moving out, opening, renaming and adding a link', async () => {
      const w = await closedWorld();
      await w.vault.vaultUnlock(PIN, 'move');
      expect(await w.vault.vaultMoveOut(['D1'])).toEqual({ ok: false, error: 'vault_locked' });
      expect(await w.vault.fileBytes('D1')).toEqual({ ok: false, error: 'vault_locked' });
      expect(await w.vault.updateFile('D1', { name: 'x.pdf' })).toEqual({ ok: false, error: 'vault_locked' });
      expect(await w.vault.addLink('https://example.com')).toEqual({ ok: false, error: 'vault_locked' });
    });

    it('still converts the old (not yet encrypted) Vault files in the background: the conversion needs only the key', async () => {
      const w = await closedWorld();
      w.addPlain('LEG', { name: 'old.txt', mime: 'text/plain', inVault: true }, enc('written before encryption'));
      expect(await w.vault.vaultUnlock(PIN, 'move')).toEqual({ ok: true });
      await vi.waitFor(() => expect(w.completesIn.map((c) => c.id)).toEqual(['LEG']));
    });

    it('a wrong PIN holds no key and gives no right', async () => {
      const w = await closedWorld();
      expect(await w.vault.vaultUnlock('999111', 'move')).toMatchObject({ ok: false, reason: 'wrong' });
      expect(await status(w)).toBe(false);
      expect(await w.vault.vaultMoveIn(['PLAIN'])).toEqual({ ok: false, error: 'vault_locked' });
    });
  });

  describe('opening by recovery', () => {
    it('vaultRecover gives the view right at once: listVault works right after, with the new PIN', async () => {
      const w = await closedWorld();
      expect(await w.vault.vaultRecover(w.recoveryKey, PIN2)).toEqual({ ok: true });
      const listed = await w.vault.listVault();
      expect(listed.ok && listed.value.map((i) => i.name).sort()).toEqual([PDF_META.name, PHOTO_META.name].sort());
    });
  });

  describe('expiry and full close', () => {
    it('after the 6 hours a move unlock brings the key back but not the view right', async () => {
      const w = await closedWorld();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      vi.setSystemTime(T0);
      await w.vault.vaultUnlock(PIN, 'view');
      expect((await w.vault.listVault()).ok).toBe(true);
      vi.advanceTimersByTime(VAULT_SESSION_MS);
      expect(await status(w)).toBe(false);
      expect(await w.vault.vaultUnlock(PIN, 'move')).toEqual({ ok: true });
      expect(await w.vault.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    });

    it('vaultLeave does not move the end of the 6 hours', async () => {
      const w = await closedWorld();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      vi.setSystemTime(T0);
      await w.vault.vaultUnlock(PIN, 'move');
      vi.advanceTimersByTime(60 * 60 * 1000);
      w.vault.vaultLeave();
      vi.advanceTimersByTime(VAULT_SESSION_MS - 60 * 60 * 1000 - 1);
      expect(await status(w)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(await status(w)).toBe(false);
    });

    it('vaultClose (lock, reset) drops the key too: moving in answers vault_locked', async () => {
      const w = await closedWorld();
      await w.vault.vaultUnlock(PIN, 'move');
      w.vault.vaultClose();
      expect(await status(w)).toBe(false);
      expect(await w.vault.vaultMoveIn(['PLAIN'])).toEqual({ ok: false, error: 'vault_locked' });
    });
  });
});
