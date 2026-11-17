// Task 8: the main-process half of the encrypted Vault, as a module with no Electron imports.
//
// `desktop/src/main/index.ts` registers IPC handlers inline and cannot be unit-tested, so Task 8 moves the Vault logic into
// `desktop/src/main/vault-ipc.ts`, which `index.ts` calls from its `ipcMain.handle(...)` lines and from `protocol.handle(...)`.
// This file is the contract for that module. The implementer follows it:
//
//   export const VAULT_SCHEME = 'fatup-vault';
//
//   export type VaultHandlerDeps = {
//     session: VaultSession;                                   // the one session of the main process
//     client(): Pick<ApiClient, 'listEverything' | 'downloadUrl'>; // throws ApiError('not_configured') when there is no server
//     isUnlocked(): boolean;                                   // the app (PIN) lock; false = every handler refuses
//     downloadsDir: string;                                    // where `download` saves
//     writeFile(path: string, bytes: Uint8Array): Promise<void>;
//     fileExists(path: string): boolean;                       // for uniqueFileName (a name already in downloadsDir)
//     isDownloaded(id: string): boolean;                       // fills Item.downloaded
//     markDownloaded(id: string): void;
//     fetchImpl?: typeof fetch;                                // presigned GETs; default global fetch
//   };
//
//   createVaultHandlers(deps) returns plain async functions (arguments = what the renderer sends, no IpcMainInvokeEvent):
//     vaultStatus(): Result<VaultStatus>
//     vaultSetup(pin) / vaultUnlock(pin) / vaultRecover(rk, newPin) / vaultChangePin(old, new): the session's own result, unchanged
//     vaultClose(): void                                       // session.close(); never refused, not even while the app is locked
//     listVault({ trash? }): Result<Item[]>
//     owns(id): boolean                                        // true for an encrypted item seen by listVault; index.ts sends only these here
//     fileBytes(id) / copyImageBytes(id): Result<Uint8Array>   // decrypted in main
//     download(id): Result<string>                             // path of the file written under its decrypted name
//     previewUrl(id): Result<string>                           // `fatup-vault://file/<id>`
//     vaultProtocol(url: string): Promise<{ status: number; body?: Uint8Array; type?: string }>
//
// Refusals: while the app is locked every handler except vaultClose answers `{ ok: false, error: 'locked' }`; the PIN-check ones
// (vaultUnlock, vaultChangePin) answer `{ ok: false, reason: 'error', error: 'locked' }` instead, because that is their result shape.
// In both cases the session is not touched. While the session is closed, the file handlers answer `{ ok: false, error: 'vault_locked' }`
// and nothing is fetched. An id that listVault never returned as encrypted answers `{ ok: false, error: 'not_found' }`.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  derivePinKeys,
  encryptBytes,
  kekFrom,
  unwrapMasterKey,
  type FileItem,
  type VaultMeta,
  type VaultSetupRequest,
  type VaultStatus,
} from '@fatup/shared';
import { ApiError } from '../src/main/api';
import { VAULT_SCHEME, createVaultHandlers, type VaultHandlerDeps } from '../src/main/vault-ipc';
import { VaultSession } from '../src/vault-session';

const ITERATIONS = 1000;
const PIN = '135792';
const DOWNLOADS = join(tmpdir(), 'fatup-vault-ipc-downloads');

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** Just enough of the Worker for a real VaultSession to set up and unlock. */
function miniServer() {
  const state: { req: VaultSetupRequest | null } = { req: null };
  const status = (): VaultStatus =>
    state.req
      ? { state: 'ready', kdf: { salt: state.req.kdfSalt, iterations: state.req.kdfIterations }, failedAttempts: 0, lockedUntil: null, remaining: 10 }
      : { state: 'none', failedAttempts: 0, lockedUntil: null, remaining: 10 };
  const client = {
    vaultStatus: async () => status(),
    vaultSetup: async (req: VaultSetupRequest) => {
      state.req = JSON.parse(JSON.stringify(req)) as VaultSetupRequest;
    },
    vaultUnlock: async () => ({ serverSecret: state.req!.serverSecret, wrappedMkPin: state.req!.wrappedMkPin }),
    vaultRecover: async () => {
      throw new Error('not used');
    },
    vaultSetPin: async () => {
      throw new Error('not used');
    },
  };
  return { state, client };
}

type Written = { path: string; bytes: Uint8Array };

/** A real open session, a fake Worker client, a fake presigned-URL fetch and spies around everything that leaves the process. */
async function world(opts: { unlocked?: boolean } = {}) {
  const server = miniServer();
  const session = new VaultSession({ client: () => server.client as never, appPinMatches: () => false, iterations: ITERATIONS });
  const setup = await session.setup(PIN);
  if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);

  const objects = new Map<string, Uint8Array>();
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const body = objects.get(String(input));
    return body ? new Response(body as unknown as BodyInit) : new Response('missing', { status: 404 });
  });
  const raw: FileItem[] = [];
  const client = {
    listEverything: vi.fn(async (_opts?: { trash?: boolean; vault?: boolean }) => raw.map((r) => ({ ...r }))),
    downloadUrl: vi.fn(async (id: string) => `https://r2.test/vault/${id}`),
  };
  const written: Written[] = [];
  const downloaded = new Set<string>();
  const state = { unlocked: opts.unlocked ?? true };
  const writeFile = vi.fn(async (path: string, bytes: Uint8Array) => {
    written.push({ path, bytes });
  });
  const markDownloaded = vi.fn((id: string) => void downloaded.add(id));
  const deps: VaultHandlerDeps = {
    session,
    client: () => client,
    isUnlocked: () => state.unlocked,
    downloadsDir: DOWNLOADS,
    writeFile,
    fileExists: (path) => written.some((w) => w.path === path),
    isDownloaded: (id) => downloaded.has(id),
    markDownloaded,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  const handlers = createVaultHandlers(deps);

  /** Stores an encrypted item the way the Worker would: ciphertext objects in R2, `encMeta`/`encKey` on the row. */
  async function addItem(id: string, meta: VaultMeta, plain: Uint8Array, opts: { thumb?: Uint8Array; tamper?: boolean } = {}) {
    const { encMeta, encKey, dek } = await session.encryptMetaFor(meta);
    const cipher = await encryptBytes(plain, dek);
    if (opts.tamper) cipher[cipher.length - 1] ^= 1;
    objects.set(`https://r2.test/vault/${id}`, cipher);
    let thumbUrl: string | null = null;
    if (opts.thumb) {
      thumbUrl = `https://r2.test/vault/${id}.thumb`;
      objects.set(thumbUrl, await encryptBytes(opts.thumb, dek));
    }
    raw.push(storedItem({ id, encMeta, encKey, thumbUrl, size: cipher.length }));
  }
  return { server, session, handlers, deps, client, fetchImpl, written, writeFile, markDownloaded, raw, state, addItem, recoveryKey: setup.recoveryKey };
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

const PDF: VaultMeta = { name: 'Hợp đồng.pdf', mime: 'application/pdf', kind: 'file' };
const PHOTO: VaultMeta = { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' };

/** A session whose methods are spies, for the "returns the session's answer unchanged" checks. */
function stubSession() {
  const stub = {
    status: vi.fn(async () => ({ state: 'ready', failedAttempts: 0, lockedUntil: null, remaining: 10 }) as VaultStatus),
    setup: vi.fn(async (_pin: string): Promise<unknown> => ({ ok: true, recoveryKey: 'AAAA-BBBB' })),
    unlock: vi.fn(async (_pin: string): Promise<unknown> => ({ ok: true })),
    recover: vi.fn(async (_rk: string, _pin: string): Promise<unknown> => ({ ok: true })),
    changePin: vi.fn(async (_old: string, _next: string): Promise<unknown> => ({ ok: true })),
    close: vi.fn(),
    isOpen: vi.fn(() => true),
  };
  return stub;
}

function stubbed(unlocked = true) {
  const session = stubSession();
  const handlers = createVaultHandlers({
    session: session as unknown as VaultSession,
    client: () => ({ listEverything: vi.fn(async () => []), downloadUrl: vi.fn(async () => 'x') }),
    isUnlocked: () => unlocked,
    downloadsDir: DOWNLOADS,
    writeFile: vi.fn(async () => undefined),
    fileExists: () => false,
    isDownloaded: () => false,
    markDownloaded: vi.fn(),
  });
  return { session, handlers };
}

describe('Vault handlers: PIN, setup and recovery', () => {
  it('returns the status wrapped as a Result', async () => {
    const { session, handlers } = stubbed();
    expect(await handlers.vaultStatus()).toEqual({ ok: true, value: { state: 'ready', failedAttempts: 0, lockedUntil: null, remaining: 10 } });
  });

  it('turns a failing status call into a Result error carrying the API code', async () => {
    const { session, handlers } = stubbed();
    session.status.mockRejectedValueOnce(new ApiError('network', 'offline'));
    expect(await handlers.vaultStatus()).toMatchObject({ ok: false, error: 'network' });
  });

  it('hands the PIN to the session and returns the recovery key it answers with', async () => {
    const { session, handlers } = stubbed();
    expect(await handlers.vaultSetup(PIN)).toEqual({ ok: true, recoveryKey: 'AAAA-BBBB' });
    expect(session.setup).toHaveBeenCalledWith(PIN);
  });

  it.each([
    [{ ok: false, error: 'weak_pin' }],
    [{ ok: false, error: 'matches_app_pin' }],
    [{ ok: false, error: 'vault_exists' }],
  ])('returns a refused setup unchanged: %j', async (answer) => {
    const { session, handlers } = stubbed();
    session.setup.mockResolvedValueOnce(answer);
    expect(await handlers.vaultSetup(PIN)).toEqual(answer);
  });

  it.each([
    [{ ok: true }],
    [{ ok: false, reason: 'wrong', remaining: 3 }],
    [{ ok: false, reason: 'locked', lockedUntil: 1_700_000_060_000 }],
    [{ ok: false, reason: 'wiped' }],
    [{ ok: false, reason: 'not_ready' }],
    [{ ok: false, reason: 'error', error: 'network' }],
  ])('returns the answer of a PIN check unchanged: %j', async (answer) => {
    const { session, handlers } = stubbed();
    session.unlock.mockResolvedValueOnce(answer);
    session.changePin.mockResolvedValueOnce(answer);
    expect(await handlers.vaultUnlock(PIN)).toEqual(answer);
    expect(await handlers.vaultChangePin(PIN, '246810')).toEqual(answer);
    expect(session.unlock).toHaveBeenCalledWith(PIN);
    expect(session.changePin).toHaveBeenCalledWith(PIN, '246810');
  });

  it('passes the recovery key and the new PIN on and returns the answer unchanged', async () => {
    const { session, handlers } = stubbed();
    expect(await handlers.vaultRecover('RK-TEXT', '246810')).toEqual({ ok: true });
    expect(session.recover).toHaveBeenCalledWith('RK-TEXT', '246810');
    session.recover.mockResolvedValueOnce({ ok: false, error: 'bad_recovery_key' });
    expect(await handlers.vaultRecover('nope', '246810')).toEqual({ ok: false, error: 'bad_recovery_key' });
  });

  it('closes the session on vaultClose', async () => {
    const { session, handlers } = stubbed();
    await handlers.vaultClose();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('refuses every Vault call with "locked" while the app is locked, without touching the session', async () => {
    const { session, handlers } = stubbed(false);
    expect(await handlers.vaultStatus()).toMatchObject({ ok: false, error: 'locked' });
    expect(await handlers.vaultSetup(PIN)).toEqual({ ok: false, error: 'locked' });
    expect(await handlers.vaultRecover('RK', PIN)).toEqual({ ok: false, error: 'locked' });
    expect(await handlers.vaultUnlock(PIN)).toEqual({ ok: false, reason: 'error', error: 'locked' });
    expect(await handlers.vaultChangePin(PIN, '246810')).toEqual({ ok: false, reason: 'error', error: 'locked' });
    for (const spy of [session.status, session.setup, session.unlock, session.recover, session.changePin]) expect(spy).not.toHaveBeenCalled();
  });

  it('still closes the Vault while the app is locked (closing is never refused)', async () => {
    const { session, handlers } = stubbed(false);
    await handlers.vaultClose();
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});

describe('listVault', () => {
  it('answers vault_locked while the session is closed, without asking the server for anything', async () => {
    const w = await world();
    w.session.close();
    expect(await w.handlers.listVault({})).toMatchObject({ ok: false, error: 'vault_locked' });
    expect(w.client.listEverything).not.toHaveBeenCalled();
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it('answers locked while the app is locked', async () => {
    const w = await world({ unlocked: false });
    expect(await w.handlers.listVault({})).toMatchObject({ ok: false, error: 'locked' });
    expect(w.client.listEverything).not.toHaveBeenCalled();
  });

  it('lists the Vault (not the trash by default) and shows real names, types and kinds', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('pdf bytes'));
    await w.addItem('I2', PHOTO, enc('jpg bytes'), { thumb: enc('thumb') });
    const res = await w.handlers.listVault({});
    expect(res.ok).toBe(true);
    const call = w.client.listEverything.mock.calls[0]![0]!;
    expect(call.vault).toBe(true);
    expect(call.trash).toBeFalsy();
    const items = (res as { ok: true; value: { id: string; name: string; mime: string; kind: string; thumbUrl: string | null }[] }).value;
    expect(items.map((i) => [i.id, i.name, i.mime, i.kind])).toEqual([
      ['I1', 'Hợp đồng.pdf', 'application/pdf', 'file'],
      ['I2', 'photo.jpg', 'image/jpeg', 'image'],
    ]);
    expect(items[0].thumbUrl).toBeNull();
    expect(items[1].thumbUrl).toBe('fatup-vault://thumb/I2');
  });

  it('asks for the Vault trash with trash: true', async () => {
    const w = await world();
    await w.handlers.listVault({ trash: true });
    expect(w.client.listEverything.mock.calls[0]![0]).toMatchObject({ vault: true, trash: true });
  });

  it('marks items already saved on this device as downloaded', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('a'));
    await w.addItem('I2', PHOTO, enc('b'));
    const before = await w.handlers.listVault({});
    expect(before.ok && before.value.map((i) => [i.id, i.downloaded])).toEqual([
      ['I1', false],
      ['I2', false],
    ]);
    await w.handlers.download('I1');
    const after = await w.handlers.listVault({});
    expect(after.ok && after.value.map((i) => [i.id, i.downloaded])).toEqual([
      ['I1', true],
      ['I2', false],
    ]);
  });

  it('gives the renderer no encMeta and no encKey', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('a'));
    const text = JSON.stringify(await w.handlers.listVault({}));
    expect(text).not.toContain('encMeta');
    expect(text).not.toContain('encKey');
    expect(text).not.toContain(w.raw[0].encMeta!);
    expect(text).not.toContain(w.raw[0].encKey!);
  });

  it('passes an item that is not encrypted yet through untouched, and does not claim it', async () => {
    const w = await world();
    w.raw.push(storedItem({ id: 'OLD', name: 'old.txt', mime: 'text/plain', encrypted: false, thumbUrl: 'https://r2.test/thumbs/OLD.jpg' }));
    const res = await w.handlers.listVault({});
    expect(res).toMatchObject({ ok: true, value: [{ id: 'OLD', name: 'old.txt', mime: 'text/plain', thumbUrl: 'https://r2.test/thumbs/OLD.jpg', downloaded: false }] });
    expect(w.handlers.owns('OLD')).toBe(false);
  });

  it('claims encrypted items it has listed, and nothing else', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('a'));
    expect(w.handlers.owns('I1')).toBe(false); // not listed yet
    await w.handlers.listVault({});
    expect(w.handlers.owns('I1')).toBe(true);
    expect(w.handlers.owns('someone-else')).toBe(false);
  });

  it('turns a server error into a Result error carrying its code', async () => {
    const w = await world();
    w.client.listEverything.mockRejectedValueOnce(new ApiError('app_outdated', 'Update the app', 426));
    expect(await w.handlers.listVault({})).toMatchObject({ ok: false, error: 'app_outdated' });
  });
});

describe('opening encrypted files in main', () => {
  it('fileBytes returns the decrypted contents, fetching only the file object', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('the real pdf'));
    await w.handlers.listVault({});
    const res = await w.handlers.fileBytes('I1');
    expect(res.ok && dec(res.value)).toBe('the real pdf');
    expect(w.fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(w.fetchImpl.mock.calls[0]![0])).toBe('https://r2.test/vault/I1');
  });

  it('decrypts a file longer than one chunk, and an empty one', async () => {
    const w = await world();
    const big = new Uint8Array(2.5 * 1024 * 1024).map((_, i) => (i * 31 + 7) & 0xff);
    await w.addItem('BIG', PDF, big);
    await w.addItem('EMPTY', PDF, new Uint8Array());
    await w.handlers.listVault({});
    const bigRes = await w.handlers.fileBytes('BIG');
    expect(bigRes.ok && Buffer.compare(Buffer.from(bigRes.value), Buffer.from(big))).toBe(0);
    const emptyRes = await w.handlers.fileBytes('EMPTY');
    expect(emptyRes.ok && emptyRes.value.length).toBe(0);
  });

  it('copyImageBytes returns the decrypted picture', async () => {
    const w = await world();
    await w.addItem('I2', PHOTO, enc('jpeg pixels'));
    await w.handlers.listVault({});
    const res = await w.handlers.copyImageBytes('I2');
    expect(res.ok && dec(res.value)).toBe('jpeg pixels');
  });

  it('download writes the decrypted bytes to the downloads folder under the decrypted name, and returns that path', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('the real pdf'));
    await w.handlers.listVault({});
    const res = await w.handlers.download('I1');
    expect(res).toEqual({ ok: true, value: join(DOWNLOADS, 'Hợp đồng.pdf') });
    expect(w.written).toHaveLength(1);
    expect(w.written[0].path).toBe(join(DOWNLOADS, 'Hợp đồng.pdf'));
    expect(dec(w.written[0].bytes)).toBe('the real pdf');
    expect(w.markDownloaded).toHaveBeenCalledWith('I1');
  });

  it('download makes the name safe for the file system and never reuses a name already taken', async () => {
    const w = await world();
    await w.addItem('A', { name: 'a:b?.pdf', mime: 'application/pdf', kind: 'file' }, enc('one'));
    await w.addItem('B', { name: 'a:b?.pdf', mime: 'application/pdf', kind: 'file' }, enc('two'));
    await w.handlers.listVault({});
    const first = await w.handlers.download('A');
    const second = await w.handlers.download('B');
    expect(first).toEqual({ ok: true, value: join(DOWNLOADS, 'a_b_.pdf') });
    expect(second).toEqual({ ok: true, value: join(DOWNLOADS, 'a_b_ (1).pdf') });
  });

  it.each(['fileBytes', 'copyImageBytes', 'download', 'previewUrl'] as const)('%s answers vault_locked once the Vault is closed, and fetches nothing', async (name) => {
    const w = await world();
    await w.addItem('I1', PDF, enc('x'));
    await w.handlers.listVault({});
    w.session.close();
    expect(await w.handlers[name]('I1')).toMatchObject({ ok: false, error: 'vault_locked' });
    expect(w.fetchImpl).not.toHaveBeenCalled();
    expect(w.writeFile).not.toHaveBeenCalled();
  });

  it.each(['fileBytes', 'copyImageBytes', 'download', 'previewUrl'] as const)('%s answers locked while the app is locked', async (name) => {
    const w = await world();
    await w.addItem('I1', PDF, enc('x'));
    await w.handlers.listVault({});
    w.state.unlocked = false;
    expect(await w.handlers[name]('I1')).toMatchObject({ ok: false, error: 'locked' });
    expect(w.fetchImpl).not.toHaveBeenCalled();
    expect(w.writeFile).not.toHaveBeenCalled();
  });

  it.each(['fileBytes', 'copyImageBytes', 'download', 'previewUrl'] as const)('%s answers not_found for an id the Vault list never returned', async (name) => {
    const w = await world();
    await w.addItem('I1', PDF, enc('x'));
    expect(await w.handlers[name]('I1')).toMatchObject({ ok: false, error: 'not_found' }); // not listed yet
    expect(await w.handlers[name]('nope')).toMatchObject({ ok: false, error: 'not_found' });
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a ciphertext that was modified: an error, and nothing is written', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('x'), { tamper: true });
    await w.handlers.listVault({});
    expect(await w.handlers.download('I1')).toMatchObject({ ok: false, error: 'tampered' });
    expect(await w.handlers.fileBytes('I1')).toMatchObject({ ok: false, error: 'tampered' });
    expect(w.writeFile).not.toHaveBeenCalled();
  });

  it('reports a failed presigned download as download_failed', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('x'));
    await w.handlers.listVault({});
    w.fetchImpl.mockResolvedValueOnce(new Response('no', { status: 403 }));
    expect(await w.handlers.fileBytes('I1')).toMatchObject({ ok: false, error: 'download_failed' });
  });

  it('previewUrl is the fatup-vault address of the file, and fetches nothing', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('x'));
    await w.handlers.listVault({});
    expect(await w.handlers.previewUrl('I1')).toEqual({ ok: true, value: `${VAULT_SCHEME}://file/I1` });
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it('exports the scheme name', () => {
    expect(VAULT_SCHEME).toBe('fatup-vault');
  });
});

describe('the fatup-vault:// scheme', () => {
  it('serves a file decrypted, with its real type', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('the real pdf'));
    await w.handlers.listVault({});
    const res = await w.handlers.vaultProtocol('fatup-vault://file/I1');
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/pdf');
    expect(dec(res.body!)).toBe('the real pdf');
  });

  it('serves a thumbnail decrypted, as image/jpeg whatever the file type is', async () => {
    const w = await world();
    await w.addItem('I2', { name: 'clip.png', mime: 'image/png', kind: 'image' }, enc('png bytes'), { thumb: enc('jpeg thumb') });
    await w.handlers.listVault({});
    const res = await w.handlers.vaultProtocol('fatup-vault://thumb/I2');
    expect(res.status).toBe(200);
    expect(res.type).toBe('image/jpeg');
    expect(dec(res.body!)).toBe('jpeg thumb');
    expect(String(w.fetchImpl.mock.calls[0]![0])).toBe('https://r2.test/vault/I2.thumb');
  });

  it('serves the address that listVault gave for a thumbnail', async () => {
    const w = await world();
    await w.addItem('I2', PHOTO, enc('jpg'), { thumb: enc('jpeg thumb') });
    const listed = await w.handlers.listVault({});
    const thumbUrl = listed.ok ? listed.value[0].thumbUrl : null;
    expect(thumbUrl).toBe('fatup-vault://thumb/I2');
    expect(dec((await w.handlers.vaultProtocol(thumbUrl!)).body!)).toBe('jpeg thumb');
  });

  it('never writes anything to disk', async () => {
    const w = await world();
    await w.addItem('I2', PHOTO, enc('jpg'), { thumb: enc('t') });
    await w.handlers.listVault({});
    await w.handlers.vaultProtocol('fatup-vault://thumb/I2');
    await w.handlers.vaultProtocol('fatup-vault://file/I2');
    await w.handlers.vaultProtocol('fatup-vault://file/unknown');
    expect(w.writeFile).not.toHaveBeenCalled();
  });

  it('answers 404 for every request while the Vault is closed, and fetches nothing', async () => {
    const w = await world();
    await w.addItem('I2', PHOTO, enc('jpg'), { thumb: enc('t') });
    await w.handlers.listVault({});
    w.session.close();
    for (const url of ['fatup-vault://thumb/I2', 'fatup-vault://file/I2']) {
      const res = await w.handlers.vaultProtocol(url);
      expect(res.status).toBe(404);
      expect(res.body === undefined || res.body.length === 0).toBe(true);
    }
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it('answers 404 while the app is locked even if the session is still open', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('x'));
    await w.handlers.listVault({});
    w.state.unlocked = false;
    expect((await w.handlers.vaultProtocol('fatup-vault://file/I1')).status).toBe(404);
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown id', 'fatup-vault://file/NOPE'],
    ['a thumbnail of an item without one', 'fatup-vault://thumb/I1'],
    ['a path that climbs out', 'fatup-vault://../x'],
    ['another host', 'fatup-vault://other/I1'],
    ['no id', 'fatup-vault://file/'],
    ['extra path segments', 'fatup-vault://file/I1/extra'],
    ['another scheme', 'https://file/I1'],
    ['something that is not a URL', 'not a url'],
  ])('answers 404 for %s', async (_what, url) => {
    const w = await world();
    await w.addItem('I1', PDF, enc('secret contents'));
    await w.handlers.listVault({});
    const res = await w.handlers.vaultProtocol(url);
    expect(res.status).toBe(404);
    expect(res.body === undefined || res.body.length === 0).toBe(true);
    expect(w.writeFile).not.toHaveBeenCalled();
  });

  it('does not hand out bytes it cannot verify', async () => {
    const w = await world();
    await w.addItem('I1', PDF, enc('x'), { tamper: true });
    await w.handlers.listVault({});
    const res = await w.handlers.vaultProtocol('fatup-vault://file/I1');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body === undefined || res.body.length === 0).toBe(true);
  });
});

describe('Vault handlers keep their secrets', () => {
  it('returns nothing that contains the server secret, the master key, the recovery key, encMeta or encKey', async () => {
    const w = await world();
    const req = w.server.state.req!;
    const { wrapBase } = await derivePinKeys(PIN, req.kdfSalt, req.kdfIterations);
    const mk = await unwrapMasterKey(req.wrappedMkPin, await kekFrom(wrapBase, req.serverSecret), { extractable: true });
    const rawMk = Buffer.from(await crypto.subtle.exportKey('raw', mk));
    const forbidden = [
      req.serverSecret,
      w.recoveryKey,
      w.recoveryKey.replace(/-/g, ''),
      rawMk.toString('base64'),
      rawMk.toString('hex'),
      rawMk.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    ];

    await w.addItem('I1', PDF, enc('contents'), { thumb: enc('thumb') });
    forbidden.push(w.raw[0].encMeta!, w.raw[0].encKey!);

    const results: unknown[] = [];
    results.push(await w.handlers.vaultStatus());
    results.push(await w.handlers.listVault({}));
    results.push(await w.handlers.listVault({ trash: true }));
    results.push(await w.handlers.previewUrl('I1'));
    results.push(await w.handlers.download('I1'));
    // The decrypted contents themselves are the point of fileBytes; what must not travel with them is any key.
    results.push(await w.handlers.vaultProtocol('fatup-vault://file/I1'));
    results.push(await w.handlers.vaultProtocol('fatup-vault://thumb/I1'));
    results.push(await w.handlers.vaultUnlock(PIN));
    results.push(await w.handlers.vaultSetup(PIN)); // already set up: a refusal, not a second recovery key
    w.handlers.vaultClose();
    results.push(await w.handlers.listVault({}), await w.handlers.fileBytes('I1'), await w.handlers.download('I1'), await w.handlers.vaultProtocol('fatup-vault://file/I1'));
    w.state.unlocked = false;
    results.push(await w.handlers.fileBytes('I1'), await w.handlers.vaultUnlock(PIN), await w.handlers.vaultSetup(PIN));

    const text = results.map((r) => JSON.stringify(r)).join('\n');
    for (const secret of forbidden) expect(text).not.toContain(secret);
  });
});
