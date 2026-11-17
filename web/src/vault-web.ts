// The encrypted Vault in the browser. Everything runs in page memory: the master key (inside the VaultSession), the decrypted names and
// the object URLs of decrypted pictures and files. Nothing is written to localStorage, IndexedDB or Cache Storage, and nothing goes
// to the link-picture store. `browser-api.ts` builds one of these and routes the Vault calls of `window.fatup` to it.
// The logic is the desktop's: VaultSession (keys), createVaultCore (the bridge calls, shared with the main process) and createVaultMover
// (moves and the conversion of old Vault files). Only the host parts differ: downloads go to `saveFile`, pictures and files become
// `blob:` URLs made from decrypted bytes, and every one of them is revoked when the Vault closes.
import type { FileItem } from '@fatup/shared';
import type { Result, VaultMoveResult, VaultProgress } from '../../desktop/src/shared-ipc';
import { ApiError, type ApiClient } from '../../desktop/src/main/api';
import { createVaultMover, toVaultProgress, type MoveProgress } from '../../desktop/src/main/vault-mover';
import { createVaultCore, type VaultViews } from '../../desktop/src/vault-handlers';
import { VaultSession, type VaultClient } from '../../desktop/src/vault-session';

/** The part of `ApiClient` the Vault needs. Throws `ApiError('locked')` when the app is locked or not configured. */
export type WebVaultClient = VaultClient &
  Pick<ApiClient, 'listEverything' | 'downloadUrl' | 'update' | 'createUpload' | 'complete' | 'addLink' | 'moveIn' | 'moveInComplete' | 'moveOut' | 'moveOutComplete'>;

export type WebVaultDeps = {
  client(): WebVaultClient;
  /** The app (PIN) lock; false = every handler refuses (`vaultClose` never). */
  isUnlocked(): boolean;
  /** True when `pin4` is the app PIN. Async on the web (PBKDF2 over the sealed token). Must not count against the lock screen's attempts. */
  appPinMatches(pin4: string): Promise<boolean> | boolean;
  /** What `download` hands the browser (an `<a download>` in production). */
  saveFile(name: string, bytes: Uint8Array, mime: string): void;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  /** Presigned GETs and PUTs. Default: the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Sender shown for a link added straight into the Vault. */
  device: string | null;
  /** PBKDF2 rounds of a NEW Vault PIN. Production uses the default; tests pass a small number. */
  iterations?: number;
};

/** `blob:` URLs of decrypted bytes. All of them are revoked by `closeAll`; nothing is made once it ran (or while it runs). */
function blobViews(deps: Pick<WebVaultDeps, 'createObjectURL' | 'revokeObjectURL'>): VaultViews {
  /** Bumped by every close: a picture that was still being decrypted then must not make a URL the close can no longer revoke. */
  let epoch = 0;
  const thumbs = new Map<string, string>();
  const files = new Map<string, string>();
  const make = (bytes: Uint8Array, type: string) => deps.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const revoke = (map: Map<string, string>, id?: string) => {
    for (const [key, url] of map) {
      if (id !== undefined && key !== id) continue;
      deps.revokeObjectURL(url);
      map.delete(key);
    }
  };
  return {
    async thumbnail(id, current, load) {
      if (!current) return null;
      const cached = thumbs.get(id);
      if (cached) return cached;
      const at = epoch;
      const bytes = await load();
      if (at !== epoch) return null;
      const url = make(bytes, 'image/jpeg');
      thumbs.set(id, url);
      return url;
    },
    async preview(id, mime, load) {
      const cached = files.get(id);
      if (cached) return cached;
      const at = epoch;
      const bytes = await load();
      if (at !== epoch) throw new ApiError('vault_locked', 'The Vault is locked');
      const url = make(bytes, mime);
      files.set(id, url);
      return url;
    },
    forget(ids) {
      for (const id of ids) {
        revoke(thumbs, id);
        revoke(files, id);
      }
    },
    closeAll() {
      epoch++;
      revoke(thumbs);
      revoke(files);
    },
  };
}

export function createWebVault(deps: WebVaultDeps) {
  const fetchImpl = deps.fetchImpl ?? ((input: string | URL | Request, init?: RequestInit) => fetch(input, init));
  const session = new VaultSession({ client: () => deps.client(), appPinMatches: (pin4) => deps.appPinMatches(pin4), iterations: deps.iterations });
  const core = createVaultCore({
    session,
    client: () => deps.client(),
    isUnlocked: () => deps.isUnlocked(),
    saveDownload: async (name, bytes, mime) => {
      deps.saveFile(name, bytes, mime);
      return 'Downloads';
    },
    views: blobViews(deps),
    device: deps.device,
    fetchImpl,
  });
  const mover = createVaultMover({ session, client: () => deps.client(), fetchImpl });
  const progressListeners = new Set<(p: VaultProgress) => void>();

  /** Tells the page how far a batch of moves or the conversion of old Vault files is. `rows` names the item in progress when it is known. */
  const sendProgress = (p: MoveProgress, rows: FileItem[]) => {
    const progress = toVaultProgress(p, rows);
    for (const cb of [...progressListeners]) cb(progress);
  };

  /** After a call that opens the Vault (setup, unlock, recovery): convert the old files, without making the caller wait for it. */
  const afterOpen = <T extends { ok: boolean }>(res: T): T => {
    if (res.ok) mover.startMigration((p) => sendProgress(p, []));
    return res;
  };

  const summary = (res: { done: string[]; failed: string[] }): Result<VaultMoveResult> => ({ ok: true, value: { done: res.done.length, failed: res.failed } });
  const failure = (err: unknown): { ok: false; error: string } => ({ ok: false, error: (err as { code?: unknown } | null)?.code === undefined ? 'unknown' : String((err as { code: unknown }).code) });

  /** The refusal that applies before any move: the app is locked, or the Vault is closed. */
  const refusal = (): { ok: false; error: string } | null => (!deps.isUnlocked() ? { ok: false, error: 'locked' } : !session.isOpen() ? { ok: false, error: 'vault_locked' } : null);

  return {
    vaultStatus: core.vaultStatus,
    vaultSetup: async (pin: string) => afterOpen(await core.vaultSetup(pin)),
    vaultUnlock: async (pin: string) => afterOpen(await core.vaultUnlock(pin)),
    vaultRecover: async (recoveryKey: string, newPin: string) => afterOpen(await core.vaultRecover(recoveryKey, newPin)),
    vaultChangePin: core.vaultChangePin,

    /** Forgets the key and revokes every object URL, synchronously. Never refused. */
    vaultClose: core.vaultClose,

    listVault: core.listVault,
    owns: core.owns,
    fileBytes: core.fileBytes,
    copyImageBytes: core.copyImageBytes,
    download: core.download,
    previewUrl: core.previewUrl,
    updateFile: core.updateFile,
    addLink: core.addLink,

    /** Encrypts plain files here and moves them into the Vault. Ids that are not plain items of the file list are reported as failed. */
    async vaultMoveIn(ids: string[]): Promise<Result<VaultMoveResult>> {
      const refused = refusal();
      if (refused) return refused;
      try {
        const plain = new Map((await deps.client().listEverything()).map((it) => [it.id, it]));
        const rows = ids.map((id) => plain.get(id)).filter((it): it is FileItem => it !== undefined && !it.encrypted);
        const unknown = ids.filter((id) => !rows.some((r) => r.id === id));
        const res = await mover.moveIn(rows, (p) => sendProgress(p, rows));
        return summary({ done: res.done, failed: [...res.failed, ...unknown] });
      } catch (err) {
        return failure(err);
      }
    },

    /** Decrypts Vault files here and moves them back out (old, still plain Vault files are encrypted first). */
    async vaultMoveOut(ids: string[]): Promise<Result<VaultMoveResult>> {
      const refused = refusal();
      if (refused) return refused;
      try {
        const res = await mover.moveOutIds(ids, (id) => core.rawItem(id), (p) => sendProgress(p, []));
        core.forget(res.done); // plain again: the plain paths apply
        return summary(res);
      } catch (err) {
        return failure(err);
      }
    },

    onVaultProgress(cb: (p: VaultProgress) => void): () => void {
      progressListeners.add(cb);
      return () => void progressListeners.delete(cb);
    },

    /** What `WebUploadManager` needs to encrypt an upload into the Vault. */
    uploadEncryptor() {
      return {
        isOpen: () => session.isOpen(),
        encryptMetaFor: (meta: Parameters<VaultSession['encryptMetaFor']>[0]) => session.encryptMetaFor(meta),
      };
    },
  };
}

export type WebVault = ReturnType<typeof createWebVault>;
