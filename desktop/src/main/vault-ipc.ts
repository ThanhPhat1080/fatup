// The main-process half of the encrypted Vault, with no Electron imports so it can be unit-tested.
// `index.ts` calls these functions from its `ipcMain.handle(...)` lines and from `protocol.handle(...)`.
// Everything is decrypted here: the renderer gets names, types and decrypted bytes, never a key (MK, DEK, S), `encMeta` or `encKey`.
// Nothing decrypted is written to disk except by `download`, which is the user's explicit request.
import { join } from 'node:path';
import { decryptBytes, type FileItem, type VaultStatus } from '@fatup/shared';
import type { Item, Result, VaultUnlockResult } from '../shared-ipc';
import type { VaultChangePinResult, VaultRecoverResult, VaultSession, VaultSetupResult } from '../vault-session';
import { ApiError, type ApiClient } from './api';
import { uniqueFileName } from './filename';

/** The scheme the renderer loads decrypted Vault pictures and files through: fatup-vault://thumb/<id>, fatup-vault://file/<id>. */
export const VAULT_SCHEME = 'fatup-vault';

export type VaultHandlerDeps = {
  /** The one session of the main process. */
  session: VaultSession;
  /** Throws `ApiError('not_configured')` when there is no server. */
  client(): Pick<ApiClient, 'listEverything' | 'downloadUrl'>;
  /** The app (PIN) lock; false = every handler refuses. */
  isUnlocked(): boolean;
  /** Where `download` saves. */
  downloadsDir: string;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** For `uniqueFileName`: is this path already taken? */
  fileExists(path: string): boolean;
  isDownloaded(id: string): boolean;
  markDownloaded(id: string): void;
  /** Presigned GETs. Default: the global `fetch`. */
  fetchImpl?: typeof fetch;
};

export type VaultProtocolResponse = { status: number; body?: Uint8Array; type?: string };

/** What is remembered about an encrypted item seen by `listVault`: the raw row (for its file key and thumbnail address) and its real name and type. */
type Entry = { raw: FileItem; name: string; mime: string };

/** The `code` of an error (ApiError, VaultLockedError, VaultCryptoError…), or `unknown`. */
const codeOf = (err: unknown): string => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
};

const failure = (err: unknown): { ok: false; error: string; detail?: string } => ({
  ok: false,
  error: codeOf(err),
  detail: err instanceof ApiError ? err.message : undefined,
});

export function createVaultHandlers(deps: VaultHandlerDeps) {
  const { session } = deps;
  const fetchImpl = deps.fetchImpl ?? ((input: string | URL | Request, init?: RequestInit) => fetch(input, init));
  const entries = new Map<string, Entry>();
  /** Ids ever seen as encrypted. Kept after the Vault closes so a request for one answers `vault_locked` instead of falling through to the plain paths. Opaque ids only. */
  const known = new Set<string>();

  /** GETs a presigned URL and decrypts it with the item's file key. Throws ApiError / VaultCryptoError / VaultLockedError. */
  async function fetchPlain(entry: Entry, url: string): Promise<Uint8Array> {
    const dek = await session.fileKey(entry.raw);
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(10 * 60_000) });
    } catch (err) {
      throw new ApiError('network', (err as Error).message);
    }
    if (!res.ok) throw new ApiError('download_failed', `HTTP ${res.status}`, res.status);
    return decryptBytes(new Uint8Array(await res.arrayBuffer()), dek);
  }

  /** Common checks of every handler that opens one item: app unlocked, Vault open, item known (in that order). */
  function resolve(id: string): { ok: true; entry: Entry } | { ok: false; error: string } {
    if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
    if (!session.isOpen()) return { ok: false, error: 'vault_locked' };
    const entry = entries.get(id);
    if (!entry) return { ok: false, error: 'not_found' };
    return { ok: true, entry };
  }

  async function plainBytes(id: string): Promise<Result<Uint8Array>> {
    const found = resolve(id);
    if (!found.ok) return found;
    try {
      return { ok: true, value: await fetchPlain(found.entry, await deps.client().downloadUrl(id)) };
    } catch (err) {
      return failure(err);
    }
  }

  return {
    async vaultStatus(): Promise<Result<VaultStatus>> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      try {
        return { ok: true, value: await session.status() };
      } catch (err) {
        return failure(err);
      }
    },

    async vaultSetup(pin: string): Promise<VaultSetupResult> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      return session.setup(pin);
    },

    async vaultUnlock(pin: string): Promise<VaultUnlockResult> {
      if (!deps.isUnlocked()) return { ok: false, reason: 'error', error: 'locked' };
      return session.unlock(pin);
    },

    async vaultRecover(recoveryKey: string, newPin: string): Promise<VaultRecoverResult> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      return session.recover(recoveryKey, newPin);
    },

    async vaultChangePin(oldPin: string, newPin: string): Promise<VaultChangePinResult> {
      if (!deps.isUnlocked()) return { ok: false, reason: 'error', error: 'locked' };
      return session.changePin(oldPin, newPin);
    },

    /** Forgets the master key and what was learnt about the items. Never refused, not even while the app is locked. Synchronous on purpose. */
    vaultClose(): void {
      session.close();
      entries.clear();
    },

    async listVault(opts: { trash?: boolean } = {}): Promise<Result<Item[]>> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      if (!session.isOpen()) return { ok: false, error: 'vault_locked' };
      try {
        const raw = await deps.client().listEverything({ vault: true, trash: opts.trash === true });
        const shown = await session.decryptList(raw);
        const byId = new Map(raw.map((r) => [r.id, r]));
        const items = shown.map((it): Item => {
          const row = byId.get(it.id);
          if (row?.encrypted && row.encMeta && row.encKey) {
            entries.set(it.id, { raw: row, name: it.name, mime: it.mime });
            known.add(it.id);
          }
          return { ...it, downloaded: deps.isDownloaded(it.id) };
        });
        return { ok: true, value: items };
      } catch (err) {
        return failure(err);
      }
    },

    /** True for an encrypted item that `listVault` returned (even after the Vault closed). Anything else (legacy items included) is `index.ts`'s to handle. */
    owns(id: string): boolean {
      return known.has(id);
    },

    fileBytes: plainBytes,
    copyImageBytes: plainBytes,

    /** Writes the decrypted file to the downloads folder under its real name; returns the path. */
    async download(id: string): Promise<Result<string>> {
      const bytes = await plainBytes(id);
      if (!bytes.ok) return bytes;
      const entry = entries.get(id)!;
      try {
        const name = uniqueFileName(entry.name || id, (n) => deps.fileExists(join(deps.downloadsDir, n)));
        const target = join(deps.downloadsDir, name);
        await deps.writeFile(target, bytes.value);
        deps.markDownloaded(id);
        return { ok: true, value: target };
      } catch (err) {
        return failure(err);
      }
    },

    async previewUrl(id: string): Promise<Result<string>> {
      const found = resolve(id);
      if (!found.ok) return found;
      return { ok: true, value: `${VAULT_SCHEME}://file/${id}` };
    },

    /** Serves `fatup-vault://thumb/<id>` and `fatup-vault://file/<id>` from memory. Writes nothing; 404 unless the app is unlocked and the Vault open. */
    async vaultProtocol(rawUrl: string): Promise<VaultProtocolResponse> {
      const notFound: VaultProtocolResponse = { status: 404 };
      if (!deps.isUnlocked() || !session.isOpen()) return notFound;
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return notFound;
      }
      if (url.protocol !== `${VAULT_SCHEME}:`) return notFound;
      const kind = url.hostname;
      if (kind !== 'file' && kind !== 'thumb') return notFound;
      const id = /^\/([\w-]{1,64})$/.exec(url.pathname)?.[1];
      if (!id) return notFound;
      const entry = entries.get(id);
      if (!entry) return notFound;
      const source = kind === 'thumb' ? entry.raw.thumbUrl : await deps.client().downloadUrl(id).catch(() => null);
      if (!source) return notFound;
      try {
        const body = await fetchPlain(entry, source);
        return { status: 200, body, type: kind === 'thumb' ? 'image/jpeg' : entry.mime };
      } catch {
        return { status: 500 };
      }
    },
  };
}

export type VaultHandlers = ReturnType<typeof createVaultHandlers>;
