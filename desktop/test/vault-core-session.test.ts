// Plan 2026-11-18-vault-session-6h (decisions 3, 4, 7), core half: `createVaultCore` over a real VaultSession.
//
// Contract pinned here (plan as rewritten): viewing the Vault ALWAYS needs the PIN, only moving files in skips it for 6 hours.
//  - The core has two things: the master key held by the session (`vaultStatus().open`) and its own `viewOpen` flag.
//  - `vaultUnlock(pin, purpose?: 'view' | 'move')`: 'view' (the default, the Vault screen's gate) sets viewOpen; 'move' (the small PIN
//    popup) leaves viewOpen false. The key is held either way, 6 hours from the last correct PIN.
//  - `vaultLeave()` (synchronous): view-only close. viewOpen = false, learnt rows dropped, `views.closeAll()`, key KEPT.
//  - `vaultClose()` stays the full close (lock, reset, expiry): key, rows, views, viewOpen.
//  - Gated by viewOpen (answer `vault_locked` otherwise): listVault, serve, fileBytes/copyImageBytes, download, previewUrl, updateFile,
//    addLink. Not gated by the view right: changePin (the old PIN is the proof, ruling A). Gated by the key only: moving files in (the mover) and the legacy conversion.
//  - Expiry (timer or on use) closes everything: the key and viewOpen. A 'move' unlock afterwards does not bring viewing back.
//  - `vaultStatus()` answers the server's status plus `open: boolean` (= the key is held; the server does not know it).
//  - `VaultCoreDeps.startMigration?: () => void` (new, optional): `listVault` calls it when the raw list holds an item that is
//    `inVault && !encrypted`, so a pending (faded cloud) item of a viewed Vault is retried. The mover's own `startMigration` is what
//    makes it run once at a time; the core just calls the dep (hosts pass `() => mover.startMigration(...)`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VAULT_SESSION_MS, type FileItem, type VaultMeta, type VaultPinRequest, type VaultSetupRequest, type VaultStatus } from '@fatup/shared';
import { ApiError } from '../src/main/api';
import { createVaultCore, type VaultViews } from '../src/vault-handlers';
import { VaultSession } from '../src/vault-session';

const ITERATIONS = 1000;
const PIN = '135792';
const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** Just enough of the Worker for a real VaultSession to set up, unlock, recover and change its PIN. */
function miniServer() {
  const state: { req: VaultSetupRequest | null } = { req: null };
  const status = (): VaultStatus =>
    state.req
      ? { state: 'ready', kdf: { salt: state.req.kdfSalt, iterations: state.req.kdfIterations }, failedAttempts: 0, lockedUntil: null, remaining: 10 }
      : { state: 'none', failedAttempts: 0, lockedUntil: null, remaining: 10 };
  return {
    state,
    vaultStatus: async () => status(),
    vaultSetup: async (req: VaultSetupRequest) => {
      state.req = JSON.parse(JSON.stringify(req)) as VaultSetupRequest;
    },
    vaultUnlock: async () => ({ serverSecret: state.req!.serverSecret, wrappedMkPin: state.req!.wrappedMkPin }),
    vaultRecover: async (req: { rkAuth: string }) => {
      if (req.rkAuth !== state.req!.rkAuth) throw new ApiError('forbidden', 'Forbidden', 403);
      return { wrappedMkRecovery: state.req!.wrappedMkRecovery };
    },
    vaultSetPin: async (req: VaultPinRequest) => {
      state.req = { ...state.req!, kdfSalt: req.kdfSalt, kdfIterations: req.kdfIterations, authKey: req.authKey, serverSecret: req.serverSecret, wrappedMkPin: req.wrappedMkPin };
    },
  };
}

/** Wraps every method of the fake Worker client in a spy, so the tests can count and fail calls. */
function spied(client: ReturnType<typeof miniServer>) {
  return {
    state: client.state,
    vaultStatus: vi.fn(client.vaultStatus),
    vaultSetup: vi.fn(client.vaultSetup),
    vaultUnlock: vi.fn(client.vaultUnlock) as ReturnType<typeof vi.fn<typeof client.vaultUnlock>>,
    vaultRecover: vi.fn(client.vaultRecover),
    vaultSetPin: vi.fn(client.vaultSetPin),
  };
}

function stored(over: Partial<FileItem> = {}): FileItem {
  return {
    id: 'I1',
    name: '',
    mime: 'application/octet-stream',
    size: 100,
    kind: 'file',
    thumbUrl: null,
    device: 'pc',
    createdAt: NOW,
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

/** Setup runs with the Vault closed afterwards (`open: false`): the tests open it with `vaultUnlock`, so every opening happens under fake time. */
async function world() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
  const server = spied(miniServer());
  const session = new VaultSession({ client: () => server as never, appPinMatches: () => false, iterations: ITERATIONS });
  const setup = await session.setup(PIN);
  if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);

  const raw: FileItem[] = [];
  const views: VaultViews = {
    preview: vi.fn(async (id: string) => `fatup-vault://file/${id}`),
    forget: vi.fn(),
    closeAll: vi.fn(),
  };
  const startMigration = vi.fn();
  const client = {
    listEverything: vi.fn(async () => raw.map((r) => ({ ...r }))),
    downloadUrl: vi.fn(async (id: string) => `https://r2.test/vault/${id}`),
    update: vi.fn(),
    createUpload: vi.fn(),
    complete: vi.fn(),
    addLink: vi.fn(),
  };
  const state = { unlocked: true };
  const core = createVaultCore({
    session,
    client: () => client as never,
    isUnlocked: () => state.unlocked,
    saveDownload: async () => 'saved',
    views,
    startMigration,
  });
  /** An encrypted row the way the Worker stores it (the metadata is sealed under the open session's key). */
  async function addEncrypted(id: string) {
    const { encMeta, encKey } = await session.encryptMetaFor(PDF);
    raw.push(stored({ id, encMeta, encKey }));
  }
  session.close(); // setup left it open; the tests open it themselves
  return { core, session, server, views, client, raw, state, startMigration, addEncrypted, recoveryKey: setup.recoveryKey };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('vaultStatus: tells whether the session is open (decision 4)', () => {
  it('is the server status plus open: false while the Vault is closed', async () => {
    const w = await world();
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ state: 'ready', remaining: 10, open: false }) });
  });

  it('says open: true after a successful unlock', async () => {
    const w = await world();
    expect(await w.core.vaultUnlock(PIN)).toEqual({ ok: true });
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ state: 'ready', open: true }) });
  });

  it('says open: true after a successful unlock for a move too (the key is held)', async () => {
    const w = await world();
    expect(await w.core.vaultUnlock(PIN, 'move')).toEqual({ ok: true });
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ state: 'ready', open: true }) });
  });

  it('says open: true after vaultLeave, because open means the key is held, not that the Vault is being viewed', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    w.core.vaultLeave();
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
  });

  it('says open: false after vaultClose', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    w.core.vaultClose();
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
  });

  it('says open: false when the 6 hours are over (the timer fired)', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    vi.advanceTimersByTime(VAULT_SESSION_MS);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
  });

  it('says open: false when the 6 hours are over and no timer ran (checked on use)', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    vi.setSystemTime(NOW + VAULT_SESSION_MS);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
  });

  it('says open: true right up to the last millisecond of the session', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    vi.advanceTimersByTime(VAULT_SESSION_MS - 1);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
  });

  it('says open: false before the Vault exists (state none)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const server = miniServer();
    const session = new VaultSession({ client: () => server as never, appPinMatches: () => false, iterations: ITERATIONS });
    const core = createVaultCore({ session, client: () => ({}) as never, isUnlocked: () => true, saveDownload: async () => '' });
    expect(await core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ state: 'none', open: false }) });
  });

  it('still refuses with "locked" while the app is locked', async () => {
    const w = await world();
    w.state.unlocked = false;
    expect(await w.core.vaultStatus()).toEqual({ ok: false, error: 'locked' });
  });
});

describe('expiry closes the core exactly as vaultClose() does (decision 2)', () => {
  it('revokes every view (closeAll) when the timer ends the session', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    expect(w.views.closeAll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(VAULT_SESSION_MS);
    expect(w.views.closeAll).toHaveBeenCalled();
  });

  it('forgets the rows it learnt (rawItem) but keeps owning their ids, so a late request answers vault_locked and not a plain path', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    expect((await w.core.listVault()).ok).toBe(true);
    expect(w.core.rawItem('E1')).toBeDefined();
    vi.advanceTimersByTime(VAULT_SESSION_MS);
    expect(w.core.rawItem('E1')).toBeUndefined();
    expect(w.core.owns('E1')).toBe(true);
    expect(await w.core.fileBytes('E1')).toEqual({ ok: false, error: 'vault_locked' });
  });

  it('answers vault_locked from listVault after the session ended, without asking the server', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    vi.advanceTimersByTime(VAULT_SESSION_MS);
    w.client.listEverything.mockClear();
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(w.client.listEverything).not.toHaveBeenCalled();
  });

  it('answers vault_locked from listVault when the deadline passed but no timer ran (on-use check), and revokes the views', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    vi.setSystemTime(NOW + VAULT_SESSION_MS + 1);
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(w.views.closeAll).toHaveBeenCalled();
  });

  it('lists normally until the last millisecond of the session', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    vi.advanceTimersByTime(VAULT_SESSION_MS - 1);
    const listed = await w.core.listVault();
    expect(listed.ok && listed.value.map((i) => i.name)).toEqual([PDF.name]);
  });

  it('can be unlocked again after expiry, and then lists again', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    vi.advanceTimersByTime(VAULT_SESSION_MS);
    expect(await w.core.vaultUnlock(PIN)).toEqual({ ok: true });
    expect((await w.core.listVault()).ok).toBe(true);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
  });
});

describe('the core closes the Vault only on vaultClose, expiry, or (for viewing) vaultLeave', () => {
  it('stays open across listings, trash listings and hours of use, until vaultClose', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    await w.core.listVault();
    await w.core.listVault({ trash: true });
    vi.advanceTimersByTime(5 * HOUR);
    await w.core.listVault();
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
    expect(w.views.closeAll).not.toHaveBeenCalled();
    w.core.vaultClose();
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
    expect(w.views.closeAll).toHaveBeenCalled();
  });

  it('does not extend the 6 hours when it is used: the end stays where the opening put it', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    vi.advanceTimersByTime(5 * HOUR);
    await w.core.listVault();
    vi.advanceTimersByTime(HOUR);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
  });

  it('a correct PIN anywhere restarts the 6 hours: a move unlock, then a view unlock three hours later', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN, 'move');
    vi.advanceTimersByTime(3 * HOUR);
    expect(await w.core.vaultUnlock(PIN, 'view')).toEqual({ ok: true });
    vi.advanceTimersByTime(VAULT_SESSION_MS - 1);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
    vi.advanceTimersByTime(1);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
  });
});

describe('vaultLeave: the view-only close (decisions 3 and 4)', () => {
  it('is synchronous and returns nothing', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    expect(w.core.vaultLeave()).toBeUndefined();
  });

  it('makes listVault answer vault_locked without asking the server, while the status still says open', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    expect((await w.core.listVault()).ok).toBe(true);
    w.core.vaultLeave();
    w.client.listEverything.mockClear();
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(w.client.listEverything).not.toHaveBeenCalled();
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
  });

  it('drops the decrypted rows and revokes every view (closeAll), like a close, but keeps owning the ids', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    await w.core.listVault();
    expect(w.core.rawItem('E1')).toBeDefined();
    w.core.vaultLeave();
    expect(w.views.closeAll).toHaveBeenCalled();
    expect(w.core.rawItem('E1')).toBeUndefined();
    expect(w.core.owns('E1')).toBe(true);
    expect(await w.core.fileBytes('E1')).toEqual({ ok: false, error: 'vault_locked' });
  });

  it('keeps the master key: a move in still works (the session can still seal metadata)', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    w.core.vaultLeave();
    expect(w.session.isOpen()).toBe(true);
    await expect(w.session.encryptMetaFor(PDF)).resolves.toMatchObject({ encMeta: expect.any(String) });
  });

  it('does not touch the session timer: the 6 hours still count from the last correct PIN', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    vi.advanceTimersByTime(HOUR);
    w.core.vaultLeave();
    vi.advanceTimersByTime(VAULT_SESSION_MS - HOUR - 1);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
    vi.advanceTimersByTime(1);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
  });

  it('is undone by a new view unlock, which lists again', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    w.core.vaultLeave();
    expect(await w.core.vaultUnlock(PIN, 'view')).toEqual({ ok: true });
    const listed = await w.core.listVault();
    expect(listed.ok && listed.value.map((i) => i.name)).toEqual([PDF.name]);
  });

  it('answers vault_locked and keeps nothing when it runs while a listing is in flight', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    const pending = w.core.listVault();
    w.core.vaultLeave();
    expect(await pending).toEqual({ ok: false, error: 'vault_locked' });
    expect(w.core.rawItem('E1')).toBeUndefined();
  });
});

describe("vaultUnlock(pin, 'move'): the key without the right to view (decisions 3 to 5)", () => {
  /** An item that was listed during a view, then left, then the key re-entered for a move only. */
  async function movedOnly() {
    const w = await world();
    await w.core.vaultUnlock(PIN, 'view');
    await w.addEncrypted('E1');
    await w.core.listVault();
    w.core.vaultLeave();
    expect(await w.core.vaultUnlock(PIN, 'move')).toEqual({ ok: true });
    return w;
  }

  it('holds the key (open: true) but listVault stays vault_locked', async () => {
    const w = await world();
    expect(await w.core.vaultUnlock(PIN, 'move')).toEqual({ ok: true });
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
    expect(w.session.isOpen()).toBe(true);
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(await w.core.listVault({ trash: true })).toEqual({ ok: false, error: 'vault_locked' });
  });

  it("a plain vaultUnlock(pin) is a 'view' unlock: it lists", async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    expect((await w.core.listVault()).ok).toBe(true);
  });

  it("an explicit 'view' unlock lists", async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN, 'view');
    expect((await w.core.listVault()).ok).toBe(true);
  });

  it('refuses fileBytes, copyImageBytes, download and previewUrl with vault_locked and fetches nothing', async () => {
    const w = await movedOnly();
    w.client.downloadUrl.mockClear();
    expect(await w.core.fileBytes('E1')).toEqual({ ok: false, error: 'vault_locked' });
    expect(await w.core.copyImageBytes('E1')).toEqual({ ok: false, error: 'vault_locked' });
    expect(await w.core.download('E1')).toEqual({ ok: false, error: 'vault_locked' });
    expect(await w.core.previewUrl('E1')).toEqual({ ok: false, error: 'vault_locked' });
    expect(w.client.downloadUrl).not.toHaveBeenCalled();
  });

  it('refuses a rename, and addLink, with vault_locked and sends nothing', async () => {
    const w = await movedOnly();
    expect(await w.core.updateFile('E1', { name: 'new name.pdf' })).toEqual({ ok: false, error: 'vault_locked' });
    expect(await w.core.addLink('https://example.com')).toEqual({ ok: false, error: 'vault_locked' });
    expect(w.client.update).not.toHaveBeenCalled();
    expect(w.client.createUpload).not.toHaveBeenCalled();
  });

  it('serves nothing under fatup-vault:// (404) even though the key is held', async () => {
    const w = await movedOnly();
    expect(await w.core.serve('E1', 'file')).toEqual({ status: 404 });
    expect(await w.core.serve('E1', 'thumb')).toEqual({ status: 404 });
  });

  it('changing the Vault PIN is not gated on the view right: the old PIN is the proof (ruling A)', async () => {
    const w = await movedOnly();
    expect(await w.core.vaultChangePin(PIN, '246810')).toEqual({ ok: true });
    expect(w.server.vaultSetPin).toHaveBeenCalledTimes(1);
    expect(w.session.isOpen()).toBe(true);
    // The view right is still not given by it.
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
  });

  it('after vaultLeave (key held, no view) changePin with the right old PIN succeeds and the new PIN opens the session', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN, 'view');
    w.core.vaultLeave();
    expect(await w.core.vaultChangePin(PIN, '246810')).toEqual({ ok: true });
    expect(w.server.vaultSetPin).toHaveBeenCalledTimes(1);
    w.core.vaultClose();
    expect(await w.core.vaultUnlock('246810', 'view')).toEqual({ ok: true });
    expect((await w.core.listVault()).ok).toBe(true);
  });

  it("after vaultUnlock(pin, 'move') changePin with the right old PIN succeeds", async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN, 'move');
    expect(await w.core.vaultChangePin(PIN, '246810')).toEqual({ ok: true });
    expect(w.server.vaultSetPin).toHaveBeenCalledTimes(1);
  });

  it('changePin with a wrong old PIN returns the server wrong-PIN answer, whatever the key and view state', async () => {
    const wrong = () => Object.assign(new ApiError('http', 'Forbidden', 403), { body: { remaining: 9, lockedUntil: null } });
    const left = await world();
    await left.core.vaultUnlock(PIN, 'view');
    left.core.vaultLeave();
    left.server.vaultUnlock.mockRejectedValueOnce(wrong());
    expect(await left.core.vaultChangePin('999111', '246810')).toEqual({ ok: false, reason: 'wrong', remaining: 9 });
    expect(left.server.vaultSetPin).not.toHaveBeenCalled();

    const moved = await world();
    await moved.core.vaultUnlock(PIN, 'move');
    moved.server.vaultUnlock.mockRejectedValueOnce(wrong());
    expect(await moved.core.vaultChangePin('999111', '246810')).toEqual({ ok: false, reason: 'wrong', remaining: 9 });
    expect(moved.server.vaultSetPin).not.toHaveBeenCalled();
  });

  it('still lets the legacy conversion and a move in use the key (the session can seal metadata)', async () => {
    const w = await movedOnly();
    await expect(w.session.encryptMetaFor(PDF)).resolves.toMatchObject({ encMeta: expect.any(String) });
  });

  it('a later view unlock gives the view right back', async () => {
    const w = await movedOnly();
    expect(await w.core.vaultUnlock(PIN, 'view')).toEqual({ ok: true });
    expect((await w.core.listVault()).ok).toBe(true);
  });

  it('a failed unlock (wrong PIN) for a move holds no key and gives no view right', async () => {
    const w = await world();
    w.server.vaultUnlock.mockRejectedValueOnce(Object.assign(new ApiError('http', 'Forbidden', 403), { body: { remaining: 9, lockedUntil: null } }));
    const res = await w.core.vaultUnlock('999111', 'move');
    expect(res.ok).toBe(false);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
  });
});

describe('expiry takes the view right away too (decision 3)', () => {
  it('a view session that expires cannot list after a move unlock: the view right does not survive the 6 hours', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN, 'view');
    await w.addEncrypted('E1');
    expect((await w.core.listVault()).ok).toBe(true);
    vi.advanceTimersByTime(VAULT_SESSION_MS);
    expect(await w.core.vaultUnlock(PIN, 'move')).toEqual({ ok: true });
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(await w.core.fileBytes('E1')).toEqual({ ok: false, error: 'vault_locked' });
  });

  it('the same holds when the deadline passed but no timer ran (on-use check)', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN, 'view');
    vi.setSystemTime(NOW + VAULT_SESSION_MS);
    expect(await w.core.vaultUnlock(PIN, 'move')).toEqual({ ok: true });
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
  });

  it('vaultClose (lock, reset) also takes the view right: a move unlock after it lists nothing', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN, 'view');
    w.core.vaultClose();
    await w.core.vaultUnlock(PIN, 'move');
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
  });
});

/** A core over a Vault that was never set up (nothing on the server), under fake time. */
async function freshWorld() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
  const server = spied(miniServer());
  const session = new VaultSession({ client: () => server as never, appPinMatches: () => false, iterations: ITERATIONS });
  const core = createVaultCore({
    session,
    client: () => ({ listEverything: vi.fn(async () => []), downloadUrl: vi.fn(), update: vi.fn(), createUpload: vi.fn(), complete: vi.fn(), addLink: vi.fn() }) as never,
    isUnlocked: () => true,
    saveDownload: async () => '',
    views: { preview: async (i) => i, forget: () => undefined, closeAll: () => undefined },
  });
  return { core, session, server };
}

// Ruling: vaultLeave also drops a prepared setup (prepareSetup without commitSetup); VaultSetup.tsx uses it to cancel the wizard.
describe('vaultLeave drops a prepared setup, and only that besides the view (ruling)', () => {
  it('prepareSetup, then vaultLeave, then vaultSetupCommit fails with no_prepared_setup', async () => {
    const w = await freshWorld();
    const prepared = await w.core.vaultSetupPrepare(PIN);
    expect(prepared.ok).toBe(true);
    w.core.vaultLeave();
    expect(await w.core.vaultSetupCommit()).toEqual({ ok: false, error: 'no_prepared_setup' });
  });

  it('sends nothing to the server and the Vault stays closed, set up on neither side', async () => {
    const w = await freshWorld();
    await w.core.vaultSetupPrepare(PIN);
    w.core.vaultLeave();
    await w.core.vaultSetupCommit();
    expect(w.server.vaultSetup).not.toHaveBeenCalled();
    expect(w.server.state.req).toBeNull();
    expect(w.session.isOpen()).toBe(false);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ state: 'none', open: false }) });
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
  });

  it('a new prepare after the cancel works and commits normally', async () => {
    const w = await freshWorld();
    await w.core.vaultSetupPrepare(PIN);
    w.core.vaultLeave();
    expect((await w.core.vaultSetupPrepare(PIN)).ok).toBe(true);
    expect(await w.core.vaultSetupCommit()).toEqual({ ok: true });
    expect(w.server.vaultSetup).toHaveBeenCalledTimes(1);
  });

  it('with no setup prepared, vaultLeave keeps a key that is held (only the prepared setup is forgotten)', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    w.core.vaultLeave();
    expect(w.session.isOpen()).toBe(true);
  });
});

// Ruling: vaultSetup / vaultSetupCommit / vaultRecover of the core give the view right (the user just typed a PIN or recovery key on the Vault screens).
describe('opening by setup or recovery gives the view right at once', () => {
  it('vaultSetup: listVault works right after, and the status is open', async () => {
    const w = await freshWorld();
    expect((await w.core.vaultSetup(PIN)).ok).toBe(true);
    expect(await w.core.listVault()).toEqual({ ok: true, value: [] });
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
  });

  it('vaultSetupPrepare + vaultSetupCommit: listVault works right after', async () => {
    const w = await freshWorld();
    await w.core.vaultSetupPrepare(PIN);
    expect(await w.core.vaultSetupCommit()).toEqual({ ok: true });
    expect(await w.core.listVault()).toEqual({ ok: true, value: [] });
  });

  it('vaultSetupPrepare alone gives no view right and no key', async () => {
    const w = await freshWorld();
    await w.core.vaultSetupPrepare(PIN);
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
  });

  it('vaultRecover: listVault works right after, with the new PIN', async () => {
    const w = await world();
    const res = await w.core.vaultRecover(w.recoveryKey, '246810');
    expect(res).toEqual({ ok: true });
    await w.addEncrypted('E1');
    const listed = await w.core.listVault();
    expect(listed.ok && listed.value.map((i) => i.name)).toEqual([PDF.name]);
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: true }) });
  });

  it('a failed vaultRecover (wrong recovery key) gives no view right and no key', async () => {
    const w = await world();
    const res = await w.core.vaultRecover('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAA', '246810');
    expect(res.ok).toBe(false);
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(await w.core.vaultStatus()).toEqual({ ok: true, value: expect.objectContaining({ open: false }) });
  });

  it('vaultLeave after a setup takes the view right away and keeps the key (a setup opened for a move from the main list)', async () => {
    const w = await freshWorld();
    await w.core.vaultSetup(PIN);
    w.core.vaultLeave();
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(w.session.isOpen()).toBe(true);
  });
});

describe('listVault retries pending items by starting the migration (decision 7)', () => {
  it('starts the migration when the list holds an item that is in the Vault but not encrypted yet', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    w.raw.push(stored({ id: 'P1', name: 'old.txt', mime: 'text/plain', encrypted: false, encMeta: undefined, encKey: undefined }));
    w.startMigration.mockClear();
    const listed = await w.core.listVault();
    expect(listed.ok).toBe(true);
    expect(w.startMigration).toHaveBeenCalled();
  });

  it('starts nothing when every item is encrypted', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    await w.addEncrypted('E1');
    await w.addEncrypted('E2');
    w.startMigration.mockClear();
    await w.core.listVault();
    expect(w.startMigration).not.toHaveBeenCalled();
  });

  it('starts nothing for an empty Vault', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN);
    w.startMigration.mockClear();
    await w.core.listVault();
    expect(w.startMigration).not.toHaveBeenCalled();
  });

  it('starts nothing after a move-only unlock (the Vault is not being viewed, so listVault refuses before listing)', async () => {
    const w = await world();
    await w.core.vaultUnlock(PIN, 'move');
    w.raw.push(stored({ id: 'P1', encrypted: false, encMeta: undefined, encKey: undefined }));
    w.startMigration.mockClear();
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(w.startMigration).not.toHaveBeenCalled();
  });

  it('starts nothing while the Vault is closed, even if a pending item exists', async () => {
    const w = await world();
    w.raw.push(stored({ id: 'P1', encrypted: false, encMeta: undefined, encKey: undefined }));
    w.startMigration.mockClear();
    expect(await w.core.listVault()).toEqual({ ok: false, error: 'vault_locked' });
    expect(w.startMigration).not.toHaveBeenCalled();
  });
});
