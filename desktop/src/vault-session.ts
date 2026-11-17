// The unlocked state of the encrypted Vault: holds the master key in memory and does every Vault operation that needs it.
// No Node imports: the desktop main process and the PWA both run this class (each passes its own client and app-PIN check).
// The master key lives in a #private field, is never extractable, and is dropped by close(). It is only ever extractable
// for a moment inside recover() and changePin(), where it has to be re-wrapped, and that copy never reaches the instance.
import {
  decryptMeta,
  derivePinKeys,
  encryptMeta,
  isWeakVaultPin,
  kekFrom,
  newFileKey,
  newServerSecret,
  newSetup,
  parseRecoveryKey,
  randomSalt,
  recoveryKeys,
  unwrapFileKey,
  unwrapMasterKey,
  wrapKey,
  VAULT_KDF_ITERATIONS,
  type FileItem,
  type VaultMeta,
  type VaultStatus,
} from '@fatup/shared';
import { ApiError, type ApiClient } from './main/api';
import type { VaultPinRefusal, VaultRecoverResult, VaultSetupCommitResult, VaultSetupResult, VaultUnlockResult } from './shared-ipc';

export type { VaultRecoverResult, VaultSetupResult };

/** `CryptoKey` taken from the runtime's own typings (Node, DOM and the Worker each declare it differently). */
type CryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** The part of `ApiClient` the session talks to. */
export type VaultClient = Pick<ApiClient, 'vaultStatus' | 'vaultSetup' | 'vaultUnlock' | 'vaultRecover' | 'vaultSetPin'>;

export type VaultSessionDeps = {
  client(): VaultClient;
  /** True when `pin4` is the app PIN. Must not count against the lock screen's attempt limit. Async on the web (PBKDF2 over the sealed token). */
  appPinMatches(pin4: string): boolean | Promise<boolean>;
  /** PBKDF2 rounds for a new PIN. Production uses the default; tests pass a small number. */
  iterations?: number;
};

/** An item as `decryptList` shows it. `unreadable` is set only on an item whose metadata could not be opened. */
export type ListedItem = FileItem & { unreadable?: boolean };

export type VaultChangePinResult = VaultUnlockResult | VaultPinRefusal;

/** Thrown by everything that needs the master key while the Vault is closed. */
export class VaultLockedError extends Error {
  readonly code = 'vault_locked';
  constructor() {
    super('vault_locked');
    this.name = 'VaultLockedError';
  }
}

const THUMB_SCHEME = 'fatup-vault://thumb/';

const errorCode = (err: unknown): string => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
};

const bodyNumber = (err: ApiError, field: string): number | null => {
  const value = (err.body as Record<string, unknown> | null)?.[field];
  return typeof value === 'number' ? value : null;
};

/** The answer of a PIN check that failed with `err` (403 wrong, 423 locked, 410 wiped, 409 not ready, anything else an error). */
function unlockFailure(err: unknown): VaultUnlockResult {
  if (!(err instanceof ApiError)) return { ok: false, reason: 'error', error: errorCode(err) };
  if (err.status === 403) return { ok: false, reason: 'wrong', remaining: bodyNumber(err, 'remaining') ?? 0 };
  if (err.status === 423) return { ok: false, reason: 'locked', lockedUntil: bodyNumber(err, 'lockedUntil') ?? 0 };
  if (err.status === 410 || err.code === 'vault_wiped') return { ok: false, reason: 'wiped' };
  if (err.code === 'vault_not_ready') return { ok: false, reason: 'not_ready' };
  return { ok: false, reason: 'error', error: err.code };
}

/** What `newSetup` made and `commitSetup` has yet to post. Holds a non-extractable master key. */
type PreparedSetup = { request: Awaited<ReturnType<typeof newSetup>>['request']; mk: CryptoKey };

/** What an opening call answers when `close()` ran while it was waiting. */
const CLOSED = 'closed';

export class VaultSession {
  #mk: CryptoKey | null = null;
  /** The first-time setup made by `prepareSetup`, waiting for `commitSetup`. Single-use; dropped by `close()`. */
  #prepared: PreparedSetup | null = null;
  /** Counts the calls of `close()`. An opening call that finds it changed after an await must not keep the key it derived. */
  #generation = 0;
  readonly #deps: VaultSessionDeps;

  constructor(deps: VaultSessionDeps) {
    this.#deps = deps;
  }

  status(): Promise<VaultStatus> {
    return this.#deps.client().vaultStatus();
  }

  isOpen(): boolean {
    return this.#mk !== null;
  }

  /** Forgets the master key and any prepared setup, and makes every opening call that is still waiting give up. */
  close(): void {
    this.#generation++;
    this.#mk = null;
    this.#prepared = null;
  }

  /** Why `pin` cannot be a Vault PIN, or null. Both ends are always checked against the app PIN. */
  async #refusePin(pin: string): Promise<VaultPinRefusal | null> {
    if (isWeakVaultPin(pin)) return { ok: false, error: 'weak_pin' };
    const [first, last] = await Promise.all([this.#deps.appPinMatches(pin.slice(0, 4)), this.#deps.appPinMatches(pin.slice(2))]);
    if (first || last) return { ok: false, error: 'matches_app_pin' };
    return null;
  }

  #requireKey(): CryptoKey {
    if (!this.#mk) throw new VaultLockedError();
    return this.#mk;
  }

  /**
   * First step of the first-time setup: checks the PIN, makes the keys and the recovery key, and returns the recovery key.
   * Nothing reaches the server and the Vault stays closed until `commitSetup`, so the key can be shown and confirmed first.
   * A second call replaces the first.
   */
  async prepareSetup(pin: string): Promise<VaultSetupResult> {
    this.#prepared = null;
    const generation = this.#generation;
    const refused = await this.#refusePin(pin);
    if (refused) return refused;
    try {
      const { request, recoveryKey, mk } = await newSetup(pin, { iterations: this.#deps.iterations ?? VAULT_KDF_ITERATIONS });
      if (generation !== this.#generation) return { ok: false, error: CLOSED };
      this.#prepared = { request, mk };
      return { ok: true, recoveryKey };
    } catch (err) {
      return { ok: false, error: errorCode(err) };
    }
  }

  /**
   * Second step: posts the prepared request and opens the Vault. Answers `no_prepared_setup` when nothing is prepared (also after
   * `close()`), `closed` when `close()` ran while the request was in flight. The prepared request is single-use once the server took it
   * (or answered that the Vault exists); after any other failure it stays, so the same step can be tried again.
   */
  async commitSetup(): Promise<VaultSetupCommitResult> {
    const prepared = this.#prepared;
    if (!prepared) return { ok: false, error: 'no_prepared_setup' };
    const generation = this.#generation;
    try {
      await this.#deps.client().vaultSetup(prepared.request);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'vault_exists' && this.#prepared === prepared) this.#prepared = null;
      return { ok: false, error: code };
    }
    if (generation !== this.#generation) return { ok: false, error: CLOSED };
    this.#prepared = null;
    this.#mk = prepared.mk;
    return { ok: true };
  }

  /** First-time setup in one call: `prepareSetup` then `commitSetup`. The request carries only what the PIN and the recovery key derive; the recovery key is returned once. */
  async setup(pin: string): Promise<VaultSetupResult> {
    const prepared = await this.prepareSetup(pin);
    if (!prepared.ok) return prepared;
    const committed = await this.commitSetup();
    return committed.ok ? prepared : committed;
  }

  async unlock(pin: string): Promise<VaultUnlockResult> {
    const generation = this.#generation;
    try {
      const client = this.#deps.client();
      const status = await client.vaultStatus();
      if (status.state === 'none' || !status.kdf) return { ok: false, reason: 'not_ready' };
      if (status.state === 'wiped') return { ok: false, reason: 'wiped' };
      const { authKey, wrapBase } = await derivePinKeys(pin, status.kdf.salt, status.kdf.iterations);
      const { serverSecret, wrappedMkPin } = await client.vaultUnlock({ authKey });
      const mk = await unwrapMasterKey(wrappedMkPin, await kekFrom(wrapBase, serverSecret));
      if (generation !== this.#generation) return { ok: false, reason: 'error', error: CLOSED };
      this.#mk = mk;
      return { ok: true };
    } catch (err) {
      return unlockFailure(err);
    }
  }

  /** Sets a new PIN with the recovery key (also when the server has wiped its keys), then opens the Vault. No file is re-encrypted. */
  async recover(recoveryKey: string, newPin: string): Promise<VaultRecoverResult> {
    // Taken before the app PIN check awaits: a close() during that wait must still win.
    const generation = this.#generation;
    const refused = await this.#refusePin(newPin);
    if (refused) return refused;
    if (generation !== this.#generation) return { ok: false, error: CLOSED };
    if (!parseRecoveryKey(recoveryKey)) return { ok: false, error: 'bad_recovery_key' };
    try {
      const client = this.#deps.client();
      const { rkAuth, rkKek } = await recoveryKeys(recoveryKey);
      let wrappedMkRecovery: string;
      try {
        ({ wrappedMkRecovery } = await client.vaultRecover({ rkAuth }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) return { ok: false, error: 'bad_recovery_key' };
        throw err;
      }
      // Extractable only for the re-wrap below; this copy is a local and is dropped when the method returns.
      const transient = await unwrapMasterKey(wrappedMkRecovery, rkKek, { extractable: true });
      const next = await this.#wrapForPin(transient, newPin);
      await client.vaultSetPin({ proof: { rkAuth }, ...next.request });
      const mk = await unwrapMasterKey(next.request.wrappedMkPin, next.kek);
      if (generation !== this.#generation) return { ok: false, error: CLOSED };
      this.#mk = mk;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorCode(err) };
    }
  }

  /** Sets a new PIN, proving with the old one. The master key is unchanged, so no file is touched. */
  async changePin(oldPin: string, newPin: string): Promise<VaultChangePinResult> {
    const generation = this.#generation;
    const refused = await this.#refusePin(newPin);
    if (refused) return refused;
    try {
      const client = this.#deps.client();
      const status = await client.vaultStatus();
      if (status.state === 'none' || !status.kdf) return { ok: false, reason: 'not_ready' };
      if (status.state === 'wiped') return { ok: false, reason: 'wiped' };
      const { authKey, wrapBase } = await derivePinKeys(oldPin, status.kdf.salt, status.kdf.iterations);
      const { serverSecret, wrappedMkPin } = await client.vaultUnlock({ authKey });
      // Extractable only for the re-wrap below; this copy is a local and is dropped when the method returns.
      const transient = await unwrapMasterKey(wrappedMkPin, await kekFrom(wrapBase, serverSecret), { extractable: true });
      const next = await this.#wrapForPin(transient, newPin);
      await client.vaultSetPin({ proof: { authKey }, ...next.request });
      const mk = await unwrapMasterKey(next.request.wrappedMkPin, next.kek);
      if (generation !== this.#generation) return { ok: false, reason: 'error', error: CLOSED };
      this.#mk = mk;
      return { ok: true };
    } catch (err) {
      return unlockFailure(err);
    }
  }

  /** Wraps `mk` for `pin` with a fresh salt and server secret. The returned request has no PIN in it. */
  async #wrapForPin(mk: CryptoKey, pin: string) {
    const kdfSalt = randomSalt();
    const kdfIterations = this.#deps.iterations ?? VAULT_KDF_ITERATIONS;
    const serverSecret = newServerSecret();
    const { authKey, wrapBase } = await derivePinKeys(pin, kdfSalt, kdfIterations);
    const kek = await kekFrom(wrapBase, serverSecret);
    const wrappedMkPin = await wrapKey(mk, kek);
    return { kek, request: { kdfSalt, kdfIterations, authKey, serverSecret, wrappedMkPin } };
  }

  /** Encrypts an item's metadata and mints its file key. `dek` encrypts the content; `encMeta` and `encKey` go to the server. */
  async encryptMetaFor(meta: VaultMeta): Promise<{ encMeta: string; encKey: string; dek: CryptoKey }> {
    const mk = this.#requireKey();
    const { dek, wrapped } = await newFileKey();
    return { encMeta: await encryptMeta(meta, mk), encKey: await wrapped(mk), dek };
  }

  /** The (non-extractable) file key of an encrypted item. */
  async fileKey(item: Pick<FileItem, 'encKey'>): Promise<CryptoKey> {
    const mk = this.#requireKey();
    if (!item.encKey) throw new Error('not_encrypted');
    return unwrapFileKey(item.encKey, mk);
  }

  /**
   * New `encMeta` for an item whose name and/or link address changed: the old metadata is opened, patched and sealed again under the
   * Vault key. The file key (`encKey`) and the item stay as they are, so nothing but `encMeta` goes to the server. Renaming a link sets
   * its title, because that is the name shown for it. Rejects when the old metadata cannot be opened.
   */
  async reencryptMeta(item: Pick<FileItem, 'encMeta'>, patch: { name?: string; url?: string }): Promise<string> {
    const mk = this.#requireKey();
    if (!item.encMeta) throw new Error('not_encrypted');
    const meta = await decryptMeta(item.encMeta, mk);
    const next: VaultMeta = { ...meta };
    if (patch.name !== undefined) {
      next.name = patch.name;
      if (meta.kind === 'link' || meta.title) next.title = patch.name;
    }
    if (patch.url !== undefined) next.url = patch.url;
    return encryptMeta(next, mk);
  }

  /**
   * Shows encrypted items with their real name, type, kind and link; `encMeta` and `encKey` are dropped and the thumbnail
   * points at the `fatup-vault://` scheme. Items that are not encrypted yet pass through untouched. An item whose metadata cannot
   * be opened (damaged, or sealed under another key) is shown with an empty name and `unreadable: true`; it never hides the others.
   */
  async decryptList(items: FileItem[]): Promise<ListedItem[]> {
    const mk = this.#requireKey();
    return Promise.all(
      items.map(async (item): Promise<ListedItem> => {
        if (!item.encrypted) return item;
        const { encMeta, encKey: _key, ...rest } = item;
        try {
          if (!encMeta) throw new Error('no_metadata');
          const meta = await decryptMeta(encMeta, mk);
          return {
            ...rest,
            name: meta.title || meta.name,
            mime: meta.mime,
            kind: meta.kind,
            url: meta.url ?? null,
            thumbUrl: item.thumbUrl ? `${THUMB_SCHEME}${item.id}` : null,
          };
        } catch {
          return { ...rest, name: '', url: null, thumbUrl: null, unreadable: true };
        }
      }),
    );
  }
}
