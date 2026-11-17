/** Types and constants for the end-to-end encrypted Vault (see the vault E2EE design spec). */
import type { FileKind } from './index';

/** Request header that tells the server the client understands the encrypted Vault. Old apps never send it. */
export const VAULT_HEADER = 'X-FatUp-Vault';
export const VAULT_PROTOCOL_VERSION = '2';

export const VAULT_PIN_LENGTH = 6;
/** PBKDF2 iterations used to stretch the Vault PIN. */
export const VAULT_KDF_ITERATIONS = 600_000;
/** Plaintext bytes per AES-GCM chunk. */
export const VAULT_CHUNK_SIZE = 1024 * 1024;
/** The wrong PIN at this count wipes the server-held keys. */
export const VAULT_WIPE_AT = 10;

/** Ciphertext header: `FUV1` magic (4) + chunk size (4) + base nonce (8). */
const VAULT_HEADER_BYTES = 16;
/** AES-GCM tag added to every chunk. */
const VAULT_TAG_BYTES = 16;

/** Lock applied once the failed-attempt counter reaches `from` (until the next rule). */
export const VAULT_LOCK_RULES: readonly { from: number; ms: number }[] = [
  { from: 5, ms: 60_000 },
  { from: 6, ms: 15 * 60_000 },
];

/** How long the Vault stays locked after a wrong PIN; `failedAttempts` is the counter after that attempt. */
export function vaultLockMs(failedAttempts: number): number {
  let ms = 0;
  for (const rule of VAULT_LOCK_RULES) if (failedAttempts >= rule.from && failedAttempts < VAULT_WIPE_AT) ms = rule.ms;
  return ms;
}

/** Exact size of the ciphertext for a plaintext of `plainSize` bytes. An empty file is still one empty chunk. */
export function vaultCiphertextSize(plainSize: number): number {
  if (!Number.isInteger(plainSize) || plainSize < 0) throw new RangeError('plainSize must be a non-negative integer');
  const chunks = Math.max(1, Math.ceil(plainSize / VAULT_CHUNK_SIZE));
  return VAULT_HEADER_BYTES + plainSize + chunks * VAULT_TAG_BYTES;
}

/** True unless the PIN is exactly 6 digits that are not all the same and not a run of consecutive digits (up or down). */
export function isWeakVaultPin(pin: string): boolean {
  if (!/^[0-9]+$/.test(pin) || pin.length !== VAULT_PIN_LENGTH) return true;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

export type VaultState = 'none' | 'ready' | 'wiped';

/** What `GET /vault` returns. Never carries any secret. */
export type VaultStatus = {
  state: VaultState;
  /** Present once the Vault is set up. `salt` is base64. */
  kdf?: { salt: string; iterations: number };
  failedAttempts: number;
  /** Epoch milliseconds until which unlocking is refused, or null. */
  lockedUntil: number | null;
  /** Wrong PINs left before the keys are wiped. */
  remaining: number;
};

/** Plaintext of an encrypted item's `encMeta`. */
export type VaultMeta = {
  name: string;
  mime: string;
  kind: FileKind;
  url?: string | null;
  title?: string | null;
};

/** `POST /vault/setup`. All values are base64 strings except `kdfIterations`. */
export type VaultSetupRequest = {
  kdfSalt: string;
  kdfIterations: number;
  authKey: string;
  serverSecret: string;
  wrappedMkPin: string;
  rkAuth: string;
  wrappedMkRecovery: string;
};

export type VaultUnlockRequest = { authKey: string };
export type VaultUnlockResponse = { serverSecret: string; wrappedMkPin: string };
/** Body of the 403 (wrong PIN) and 423 (locked) answers of `POST /vault/unlock`. */
export type VaultUnlockError = { remaining: number; lockedUntil: number | null };

export type VaultRecoverRequest = { rkAuth: string };
export type VaultRecoverResponse = { wrappedMkRecovery: string };

/** `PUT /vault/pin`: prove with the old `authKey` or with `rkAuth`, then set the new PIN's material. */
export type VaultPinRequest = {
  proof: { authKey: string } | { rkAuth: string };
  kdfSalt: string;
  kdfIterations: number;
  authKey: string;
  serverSecret: string;
  wrappedMkPin: string;
};

/** `POST /files/:id/vault/in/complete`. */
export type VaultMoveInComplete = {
  encMeta: string;
  encKey: string;
  size: number;
  hasThumb: boolean;
  /** The ETag R2 returned for the PUT of vault/<id>. Required for anything but a link; a mismatch answers 409 `item_changed`. */
  etag?: string;
  /** The `claim` that `vault/in` returned. Required while the row is claimed: a missing, wrong or expired claim answers 409 `item_busy`. Moves out do not send one. */
  claim?: string;
};
/** `POST /files/:id/vault/out/complete`. */
export type VaultMoveOutComplete = {
  name: string;
  mime: string;
  url?: string | null;
  title?: string | null;
  size: number;
  hasThumb: boolean;
};
/** What `POST /files/:id/vault/in|out` returns: presigned addresses for the source object and the target object. */
export type VaultMoveUrls = {
  uploadUrl: string;
  thumbUploadUrl: string | null;
  /** Null for links, which have no file object to download. */
  downloadUrl: string | null;
  thumbUrl: string | null;
  /** Only `vault/in` sets it: the token that gives this device the sole right to write vault/<id> for 2 hours (shortened to 16 minutes after a refused complete). Send it back to `vault/in/complete`. */
  claim?: string;
};
