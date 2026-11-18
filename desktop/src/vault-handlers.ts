// The logic behind the encrypted Vault's bridge calls, shared by the desktop main process and the PWA. No Node and no Electron imports.
// Everything is decrypted here: the page gets names, types and decrypted bytes (or a URL for them), never a key (MK, DEK, S),
// `encMeta` or `encKey`. What differs between the two hosts is passed in: where a download goes (`saveDownload`) and what kind of
// address a picture or a file gets (`views`: `fatup-vault://` on the desktop, `blob:` URLs on the web).
import { LINK_MIME, decryptBytes, encryptBytes, normalizeUrl, vaultCiphertextSize, type FileItem, type TagColor, type VaultClientStatus, type VaultMeta } from '@fatup/shared';
import type { Item, Result, VaultSetupCommitResult, VaultUnlockResult } from './shared-ipc';
import type { VaultChangePinResult, VaultRecoverResult, VaultSession, VaultSetupResult } from './vault-session';
import { ApiError, type ApiClient } from './main/api';

/** The scheme the desktop renderer loads decrypted Vault pictures and files through: fatup-vault://file/<id>. */
export const VAULT_SCHEME = 'fatup-vault';

/** How decrypted files are handed to the page. Everything it makes must be dropped by `closeAll`. */
export type VaultViews = {
  /** The address the page opens a file from; `load` fetches and decrypts it. */
  preview(id: string, mime: string, load: () => Promise<Uint8Array>): Promise<string>;
  /** These items left the Vault (moved out): drop what was made for them. */
  forget(ids: string[]): void;
  /** The Vault closed: drop everything made so far, synchronously. */
  closeAll(): void;
};

/** The desktop strategy: the main process serves the bytes itself under `fatup-vault://`, so nothing is fetched until the page asks. */
export const schemeViews: VaultViews = {
  preview: async (id) => `${VAULT_SCHEME}://file/${id}`,
  forget: () => undefined,
  closeAll: () => undefined,
};

export type VaultCoreDeps = {
  /** The one session of this process or page. */
  session: VaultSession;
  /** Throws `ApiError('not_configured')` (desktop) or `ApiError('locked')` (web) when there is no usable server. */
  // `addLink` is listed only so that tests can prove the plain `/links` route is never used for the Vault.
  client(): Pick<ApiClient, 'listEverything' | 'downloadUrl' | 'update' | 'createUpload' | 'complete' | 'addLink'>;
  /** The app (PIN) lock; false = every handler refuses. */
  isUnlocked(): boolean;
  /** Hands a decrypted file to the user under its real name; resolves to where it went (a path on the desktop, a label on the web). */
  saveDownload(name: string, bytes: Uint8Array, mime: string): Promise<string>;
  /** How pictures and files reach the page. Default: `schemeViews`. */
  views?: VaultViews;
  isDownloaded?(id: string): boolean;
  markDownloaded?(id: string): void;
  /** Shown as the sender of items added here (a link added straight into the Vault). */
  device?: string | null;
  /** Presigned GETs and PUTs. Default: the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Asks for the conversion of old (not yet encrypted) Vault items to run; `listVault` calls it when it sees one. The host's mover runs one conversion at a time. */
  startMigration?(): void;
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

export function createVaultCore(deps: VaultCoreDeps) {
  const { session } = deps;
  const views = deps.views ?? schemeViews;
  const fetchImpl = deps.fetchImpl ?? ((input: string | URL | Request, init?: RequestInit) => fetch(input, init));
  const entries = new Map<string, Entry>();
  /** Ids ever seen as encrypted. Kept after the Vault closes so a request for one answers `vault_locked` instead of falling through to the plain paths. Opaque ids only. */
  const known = new Set<string>();
  /** Counts the closes of the Vault: a call that awaited across one must not record what it learnt. */
  let epoch = 0;
  /**
   * The right to view the Vault (list, open, rename, take out, change the PIN): given only by a PIN typed for the Vault screen (or a setup or
   * recovery done there), taken by `vaultLeave`, `vaultClose` and the end of the session. Holding the key (`session.isOpen()`) is not enough.
   */
  let viewOpen = false;

  /** Forgets everything made for viewing: the right to view, the learnt rows and every address handed out. The key is not touched. */
  function dropView(): void {
    epoch++;
    viewOpen = false;
    entries.clear();
    views.closeAll();
  }
  // The session ended by itself (6 hours): same cleanup as `vaultClose`. Optional call: a host may hand over a session without the hook.
  session.onExpire?.(dropView);

  /** True when the key is held and the Vault may be viewed. Asking also ends an expired session (and so clears the view). */
  const viewable = () => session.isOpen() && viewOpen;

  /** Gives the view right to an opening that succeeded, unless the view was dropped while it was waiting. */
  const grantView = (at: number, res: { ok: boolean }) => {
    if (res.ok && at === epoch) viewOpen = true;
  };
  const isDownloaded = (id: string) => deps.isDownloaded?.(id) ?? false;

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
    if (!viewable()) return { ok: false, error: 'vault_locked' };
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

  /**
   * Decrypts the encrypted rows; remembers them once everything is done. The Vault shows NO thumbnail for any item (a picture can be
   * sensitive, and nothing is fetched or decrypted until the user opens it), so every item's `thumbUrl` is null, a not yet encrypted
   * one included.
   * Throws `vault_locked` (and remembers nothing) when the Vault was closed while the rows were being decrypted: the close already
   * cleared what it knew, so a row kept after it would outlive the key it was read with.
   */
  async function present(rows: FileItem[]): Promise<Item[]> {
    const at = epoch;
    const shown = await session.decryptList(rows);
    if (at !== epoch) throw new ApiError('vault_locked', 'The Vault is locked');
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items: Item[] = [];
    for (const it of shown) {
      const row = byId.get(it.id);
      const item: Item = { ...it, thumbUrl: null, downloaded: isDownloaded(it.id) };
      items.push(item);
      if (!row?.encrypted || !row.encMeta || !row.encKey) continue;
      entries.set(it.id, { raw: row, name: it.name, mime: it.mime });
      known.add(it.id);
    }
    return items;
  }

  /** Answers one just-returned encrypted row as the page sees it. */
  async function show(row: FileItem): Promise<Item> {
    const [shown] = await present([row]);
    return shown;
  }

  return {
    /** The server's status plus `open`: whether the key is held now (6 hours after the last PIN), which is what moving files in needs. */
    async vaultStatus(): Promise<Result<VaultClientStatus>> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      try {
        const status = await session.status();
        return { ok: true, value: { ...status, open: session.isOpen() } };
      } catch (err) {
        return failure(err);
      }
    },

    async vaultSetup(pin: string): Promise<VaultSetupResult> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      const at = epoch;
      const res = await session.setup(pin);
      grantView(at, res);
      return res;
    },

    /** First step of the setup: makes the keys and returns the recovery key. Reaches no server; the Vault stays closed until `vaultSetupCommit`. */
    async vaultSetupPrepare(pin: string): Promise<VaultSetupResult> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      return session.prepareSetup(pin);
    },

    /** Second step of the setup, after the user confirmed the recovery key: sets the Vault up on the server and opens it. */
    async vaultSetupCommit(): Promise<VaultSetupCommitResult> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      const at = epoch;
      const res = await session.commitSetup();
      grantView(at, res);
      return res;
    },

    /**
     * Opens the Vault with the PIN. `view` (the Vault screen's gate, the default) also gives the right to view it; `move` (the small PIN
     * popup of the file list) only holds the key, so files can be moved in. Either way a correct PIN restarts the session's 6 hours.
     */
    async vaultUnlock(pin: string, purpose: 'view' | 'move' = 'view'): Promise<VaultUnlockResult> {
      if (!deps.isUnlocked()) return { ok: false, reason: 'error', error: 'locked' };
      session.isOpen(); // ends a session that is over, which also takes its view right, before a new opening can be mistaken for the old one
      const at = epoch;
      const res = await session.unlock(pin);
      if (purpose === 'view') grantView(at, res);
      return res;
    },

    async vaultRecover(recoveryKey: string, newPin: string): Promise<VaultRecoverResult> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      const at = epoch;
      const res = await session.recover(recoveryKey, newPin);
      grantView(at, res);
      return res;
    },

    /** Not gated on the view right: the old PIN is the proof, nothing decrypted comes back, and the form lives in Settings. */
    async vaultChangePin(oldPin: string, newPin: string): Promise<VaultChangePinResult> {
      if (!deps.isUnlocked()) return { ok: false, reason: 'error', error: 'locked' };
      return session.changePin(oldPin, newPin);
    },

    /** Forgets the master key, what was learnt about the items and every address made for them. Never refused, not even while the app is locked. Synchronous on purpose. */
    vaultClose(): void {
      session.close();
      dropView();
    },

    /**
     * Leaving the Vault screen: takes the right to view, forgets the decrypted rows and revokes every address, but keeps the key and its
     * 6 hours so files can still be moved in. Also drops a setup that was prepared and not committed (the wizard cancels with it). Synchronous.
     */
    vaultLeave(): void {
      dropView();
      session.discardSetup?.();
    },

    /** True while the key is held and the Vault may be viewed: what the hosts check before taking files out. */
    canView(): boolean {
      return viewable();
    },

    async listVault(opts: { trash?: boolean } = {}): Promise<Result<Item[]>> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      if (!viewable()) return { ok: false, error: 'vault_locked' };
      const at = epoch;
      try {
        const raw = await deps.client().listEverything({ vault: true, trash: opts.trash === true });
        // `vaultLeave` keeps the key, so the session cannot tell this listing that the view ended while it waited.
        if (at !== epoch) return { ok: false, error: 'vault_locked' };
        const shown = await present(raw);
        // An item in the Vault that is still plain (faded cloud) is retried while the Vault is being viewed.
        if (raw.some((r) => r.inVault && !r.encrypted)) deps.startMigration?.();
        return { ok: true, value: shown };
      } catch (err) {
        return failure(err);
      }
    },

    /** True for an encrypted item that `listVault` returned (even after the Vault closed). Anything else (legacy items included) is the host's to handle. */
    owns(id: string): boolean {
      return known.has(id);
    },

    /** The raw (still encrypted) row of an item that `listVault` or this module returned, for the mover. Never answers to the page. */
    rawItem(id: string): FileItem | undefined {
      return entries.get(id)?.raw;
    },

    /** Stops treating these ids as encrypted Vault items (they were moved out and are plain again, so the plain paths apply). */
    forget(ids: string[]): void {
      for (const id of ids) {
        entries.delete(id);
        known.delete(id);
      }
      views.forget(ids);
    },

    /**
     * Renames an encrypted item or changes the address of an encrypted link: the new name/address is sealed into a new `encMeta`
     * (the plain value is never sent). `tags` and `important` stay plain by design and travel next to it.
     */
    async updateFile(id: string, patch: { name?: string; url?: string; tags?: TagColor[]; important?: boolean }): Promise<Result<Item>> {
      const found = resolve(id);
      if (!found.ok) return found;
      try {
        const send: { encMeta?: string; tags?: TagColor[]; important?: boolean } = {};
        if (patch.name !== undefined || patch.url !== undefined) send.encMeta = await session.reencryptMeta(found.entry.raw, { name: patch.name, url: patch.url });
        if (patch.tags !== undefined) send.tags = patch.tags;
        if (patch.important !== undefined) send.important = patch.important;
        if (Object.keys(send).length === 0) return { ok: true, value: await show(found.entry.raw) };
        const row = await deps.client().update(id, send);
        // A row from an older server may lack the key; the one we already hold still opens the file.
        return { ok: true, value: await show({ ...row, encMeta: row.encMeta ?? send.encMeta ?? found.entry.raw.encMeta, encKey: row.encKey ?? found.entry.raw.encKey }) };
      } catch (err) {
        return failure(err);
      }
    },

    /**
     * Adds a link straight into the Vault, never as a plain link first: an upload whose metadata is `{ kind: 'link', url, title }`
     * and whose content is the ciphertext of 0 bytes. The server cannot read, preview or de-duplicate it.
     */
    async addLink(rawUrl: string, title?: string): Promise<Result<Item>> {
      if (!deps.isUnlocked()) return { ok: false, error: 'locked' };
      if (!viewable()) return { ok: false, error: 'vault_locked' };
      try {
        const url = normalizeUrl(rawUrl);
        if (!url) return { ok: false, error: 'bad_url' };
        const label = title?.trim().slice(0, 200) ?? '';
        const meta: VaultMeta = { kind: 'link', url, title: label || null, name: label || new URL(url).hostname, mime: LINK_MIME };
        const { encMeta, encKey, dek } = await session.encryptMetaFor(meta);
        const body = await encryptBytes(new Uint8Array(), dek);
        const ticket = await deps.client().createUpload({
          name: '',
          mime: 'application/octet-stream',
          size: vaultCiphertextSize(0),
          hasThumb: false,
          device: deps.device ?? undefined,
          vault: { encMeta, encKey },
        });
        let res: Response;
        try {
          res = await fetchImpl(ticket.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) },
            body: body as BodyInit,
            signal: AbortSignal.timeout(60_000),
          });
        } catch (err) {
          throw new ApiError('network', (err as Error).message);
        }
        if (!res.ok) throw new ApiError('upload_failed', `HTTP ${res.status}`, res.status);
        const row = await deps.client().complete(ticket.id);
        return { ok: true, value: await show({ ...row, encMeta: row.encMeta ?? encMeta, encKey: row.encKey ?? encKey }) };
      } catch (err) {
        return failure(err);
      }
    },

    fileBytes: plainBytes,
    copyImageBytes: plainBytes,

    /** Hands the decrypted file to the user under its real name (`saveDownload`); returns where it went. */
    async download(id: string): Promise<Result<string>> {
      const bytes = await plainBytes(id);
      if (!bytes.ok) return bytes;
      const entry = entries.get(id)!;
      try {
        const where = await deps.saveDownload(entry.name || id, bytes.value, entry.mime);
        deps.markDownloaded?.(id);
        return { ok: true, value: where };
      } catch (err) {
        return failure(err);
      }
    },

    async previewUrl(id: string): Promise<Result<string>> {
      const found = resolve(id);
      if (!found.ok) return found;
      try {
        const load = async () => {
          const bytes = await plainBytes(id);
          if (!bytes.ok) throw new ApiError(bytes.error, bytes.detail ?? bytes.error);
          return bytes.value;
        };
        return { ok: true, value: await views.preview(id, found.entry.mime, load) };
      } catch (err) {
        return failure(err);
      }
    },

    /** The decrypted bytes of an item's file (never a thumbnail: the Vault has none), for a host that serves them itself (`fatup-vault://`). 404 unless the app is unlocked and the Vault open. */
    async serve(id: string, kind: 'file' | 'thumb'): Promise<VaultProtocolResponse> {
      const notFound: VaultProtocolResponse = { status: 404 };
      // There is no thumbnail to serve: the Vault never shows one.
      if (kind === 'thumb' || !deps.isUnlocked() || !viewable()) return notFound;
      const entry = entries.get(id);
      if (!entry) return notFound;
      const source = await deps.client().downloadUrl(id).catch(() => null);
      if (!source) return notFound;
      try {
        const body = await fetchPlain(entry, source);
        return { status: 200, body, type: entry.mime };
      } catch {
        return { status: 500 };
      }
    },
  };
}

export type VaultCore = ReturnType<typeof createVaultCore>;
