import { describe, expect, it } from 'vitest';
import {
  VAULT_CHUNK_SIZE,
  VAULT_HEADER,
  VAULT_KDF_ITERATIONS,
  VAULT_PIN_LENGTH,
  VAULT_PROTOCOL_VERSION,
  VAULT_WIPE_AT,
  isWeakVaultPin,
  vaultCiphertextSize,
  vaultLockMs,
  type CreateUploadRequest,
  type FileItem,
} from '@fatup/shared';

const MiB = 1024 * 1024;
const HEADER = 16; // FUV1 magic (4) + chunk size (4) + base nonce (8); spec 4.2
const TAG = 16; // AES-GCM tag added to every chunk

describe('vault constants', () => {
  it('names the header and protocol version old apps do not send', () => {
    expect(VAULT_HEADER).toBe('X-FatUp-Vault');
    expect(VAULT_PROTOCOL_VERSION).toBe('2');
  });
  it('uses a 6-digit PIN stretched with 600 000 PBKDF2 iterations', () => {
    expect(VAULT_PIN_LENGTH).toBe(6);
    expect(VAULT_KDF_ITERATIONS).toBe(600_000);
  });
  it('encrypts in 1 MiB chunks', () => {
    expect(VAULT_CHUNK_SIZE).toBe(MiB);
  });
  it('wipes the vault keys on the 10th wrong PIN', () => {
    expect(VAULT_WIPE_AT).toBe(10);
  });
});

// VAULT_LOCK_RULES is the table behind `vaultLockMs`; only the helper's behaviour is tested here
// (the table's own shape is the implementation's choice). `failedAttempts` is the counter after
// the wrong attempt that was just recorded.
describe('vaultLockMs', () => {
  it('does not lock after the 1st to 4th wrong PIN', () => {
    for (const n of [1, 2, 3, 4]) expect(vaultLockMs(n)).toBe(0);
  });
  it('locks for one minute after the 5th wrong PIN', () => {
    expect(vaultLockMs(5)).toBe(60_000);
  });
  it('locks for fifteen minutes after each of the 6th to 9th wrong PIN', () => {
    for (const n of [6, 7, 8, 9]) expect(vaultLockMs(n)).toBe(900_000);
  });
});

describe('vaultCiphertextSize', () => {
  it('is just the header plus one empty chunk for a 0-byte file', () => {
    expect(vaultCiphertextSize(0)).toBe(HEADER + TAG);
  });
  it('adds the header and one tag to a 1-byte file', () => {
    expect(vaultCiphertextSize(1)).toBe(HEADER + 1 + TAG);
  });
  it('adds one tag for a file of exactly one chunk', () => {
    expect(vaultCiphertextSize(MiB)).toBe(HEADER + MiB + TAG);
  });
  it('adds a second tag as soon as the file spills into a second chunk', () => {
    expect(vaultCiphertextSize(MiB + 1)).toBe(HEADER + MiB + 1 + 2 * TAG);
  });
  it('counts a partial last chunk for a multi-chunk file', () => {
    expect(vaultCiphertextSize(3.5 * MiB)).toBe(HEADER + 3.5 * MiB + 4 * TAG);
  });
  it('adds exactly the tag count for an exact multiple of the chunk size', () => {
    expect(vaultCiphertextSize(3 * MiB)).toBe(HEADER + 3 * MiB + 3 * TAG);
  });
  it('rejects a negative size', () => {
    expect(vaultCiphertextSize(0)).toBe(HEADER + TAG); // the function exists and works, so the throw below is its own
    expect(() => vaultCiphertextSize(-1)).toThrow();
  });
  it('rejects a non-integer size', () => {
    expect(vaultCiphertextSize(0)).toBe(HEADER + TAG);
    expect(() => vaultCiphertextSize(1.5)).toThrow();
    expect(() => vaultCiphertextSize(Number.NaN)).toThrow();
  });
});

describe('isWeakVaultPin', () => {
  it('flags six identical digits', () => {
    expect(isWeakVaultPin('000000')).toBe(true);
    expect(isWeakVaultPin('111111')).toBe(true);
  });
  it('flags ascending and descending runs', () => {
    for (const pin of ['123456', '012345', '654321', '987654']) expect(isWeakVaultPin(pin)).toBe(true);
  });
  it('flags a PIN that is too short or too long', () => {
    expect(isWeakVaultPin('12345')).toBe(true);
    expect(isWeakVaultPin('1234567')).toBe(true);
  });
  it('flags a PIN with a non-digit', () => {
    expect(isWeakVaultPin('12a456')).toBe(true);
  });
  it('accepts a PIN with no obvious pattern', () => {
    expect(isWeakVaultPin('204781')).toBe(false);
    expect(isWeakVaultPin('135792')).toBe(false);
  });
});

// Type-level: `npm run typecheck` fails until these optional fields exist on the shared types.
describe('vault fields on the shared types', () => {
  it('lets a FileItem carry the encrypted flag, metadata and wrapped key', () => {
    const item: FileItem = {
      id: 'a', name: '', mime: 'application/octet-stream', size: 48, kind: 'file', thumbUrl: null, device: null,
      createdAt: 1, deletedAt: null, inVault: true, tags: [], url: null, site: null, previewed: false,
      encrypted: true, encMeta: 'bWV0YQ==', encKey: 'a2V5',
    };
    expect(item.encrypted).toBe(true);
    expect(item.encMeta).toBe('bWV0YQ==');
    expect(item.encKey).toBe('a2V5');
  });
  it('lets a CreateUploadRequest carry vault metadata and the wrapped key', () => {
    const req: CreateUploadRequest = {
      name: '', mime: 'application/octet-stream', size: 48, hasThumb: false,
      vault: { encMeta: 'bWV0YQ==', encKey: 'a2V5' },
    };
    expect(req.vault).toEqual({ encMeta: 'bWV0YQ==', encKey: 'a2V5' });
  });
});
