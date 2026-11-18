import { describe, expect, it } from 'vitest';
import {
  VaultCryptoError,
  decryptBytes,
  decryptMeta,
  derivePinKeys,
  encryptBytes,
  encryptMeta,
  kekFrom,
  newFileKey,
  newSetup,
  recoveryKeys,
  unwrapMasterKey,
  vaultCiphertextSize,
  type VaultMeta,
} from '@fatup/shared';

// A short smoke subset of desktop/test/vault-crypto.test.ts: it proves the module runs in the web test environment.
const IT = 1000;
const MIB = 1024 * 1024;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('vault crypto in the web environment', () => {
  it('round-trips bytes across a chunk boundary and has the predicted size', async () => {
    const { dek } = await newFileKey();
    const plain = randomBytes(MIB + 1);
    const cipher = await encryptBytes(plain, dek);
    expect(cipher.length).toBe(vaultCiphertextSize(plain.length));
    expect(same(await decryptBytes(cipher, dek), plain)).toBe(true);
  });

  it('round-trips an empty file', async () => {
    const { dek } = await newFileKey();
    const cipher = await encryptBytes(new Uint8Array(0), dek);
    expect(cipher.length).toBe(vaultCiphertextSize(0));
    expect((await decryptBytes(cipher, dek)).length).toBe(0);
  });

  it('round-trips metadata with a Vietnamese name', async () => {
    const { request, mk } = await newSetup('482915', { iterations: IT });
    expect(request.kdfIterations).toBe(IT);
    const meta: VaultMeta = { name: 'Hợp đồng thuê nhà.pdf', mime: 'application/pdf', kind: 'file' };
    expect(await decryptMeta(await encryptMeta(meta, mk), mk)).toEqual(meta);
  });

  it('detects a flipped byte as tampered', async () => {
    const { dek } = await newFileKey();
    const cipher = await encryptBytes(randomBytes(500), dek);
    cipher[cipher.length - 1] ^= 1;
    const error = await decryptBytes(cipher, dek).catch((e) => e);
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error.code).toBe('tampered');
  });

  it('opens the same master key from the PIN plus the server secret and from the recovery key', async () => {
    const pin = '482915';
    const { request, recoveryKey, mk } = await newSetup(pin, { iterations: IT });
    const meta: VaultMeta = { name: 'a.txt', mime: 'text/plain', kind: 'file' };
    const enc = await encryptMeta(meta, mk);

    const { wrapBase } = await derivePinKeys(pin, request.kdfSalt, request.kdfIterations);
    const viaPin = await unwrapMasterKey(request.wrappedMkPin, await kekFrom(wrapBase, request.serverSecret));
    expect(await decryptMeta(enc, viaPin)).toEqual(meta);

    const viaRecovery = await unwrapMasterKey(request.wrappedMkRecovery, (await recoveryKeys(recoveryKey)).rkKek);
    expect(await decryptMeta(enc, viaRecovery)).toEqual(meta);
  });
});
