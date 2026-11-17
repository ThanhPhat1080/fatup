import { describe, expect, it } from 'vitest';
import {
  VAULT_CHUNK_SIZE,
  VAULT_KDF_ITERATIONS,
  VaultCryptoError,
  decryptBytes,
  decryptMeta,
  decryptStream,
  derivePinKeys,
  encryptBytes,
  encryptMeta,
  encryptStream,
  kekFrom,
  newFileKey,
  newMasterKey,
  newRecoveryKey,
  newServerSecret,
  newSetup,
  parseRecoveryKey,
  randomSalt,
  recoveryKeys,
  unwrapFileKey,
  unwrapMasterKey,
  vaultCiphertextSize,
  wrapKey,
  type VaultMeta,
} from '@fatup/shared';

// Small on purpose: the real value (600 000) is for production; the tests only need the shape.
const IT = 1000;
const MIB = 1024 * 1024;
const HEADER = 16;
const TAG = 16;
/** Size of one full ciphertext chunk. */
const CHUNK = VAULT_CHUNK_SIZE + TAG;

const toB64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const isB64 = (s: unknown) => typeof s === 'string' && s.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');

/** Random bytes of any length (getRandomValues is capped at 64 KiB per call). */
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Odd-sized pieces, none of them a multiple of the chunk size, so the stream has to re-chunk. */
const ODD_PIECES = [7, 300 * 1024, MIB + 3];

function source(input: Uint8Array, pieces: number[]): ReadableStream<Uint8Array> {
  let pos = 0;
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pos >= input.length) return controller.close();
      const n = pieces[i++ % pieces.length];
      controller.enqueue(input.slice(pos, pos + n));
      pos += n;
    },
  });
}

async function runStream(ts: TransformStream<Uint8Array, Uint8Array>, input: Uint8Array, pieces = ODD_PIECES): Promise<Uint8Array> {
  const reader = source(input, pieces).pipeThrough(ts).getReader();
  const out: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return concat(out);
}

const rejectsWith = (p: Promise<unknown>, code: 'bad_format' | 'tampered' | 'truncated') => expect(p).rejects.toMatchObject({ code });

describe('encryptBytes / decryptBytes', () => {
  it.each([
    ['0 bytes', 0],
    ['1 byte', 1],
    ['exactly 1 MiB', MIB],
    ['1 MiB + 1 byte', MIB + 1],
    ['3.5 MiB of random data', 3.5 * MIB],
  ])('round-trips %s unchanged', async (_name, size) => {
    const { dek } = await newFileKey();
    const plain = randomBytes(size);
    const cipher = await encryptBytes(plain, dek);
    expect(same(await decryptBytes(cipher, dek), plain)).toBe(true);
  });

  it.each([0, 1, MIB - 1, MIB, MIB + 1, 2 * MIB, 3.5 * MIB])('produces exactly vaultCiphertextSize(%i) bytes', async (size) => {
    const { dek } = await newFileKey();
    const cipher = await encryptBytes(randomBytes(size), dek);
    expect(cipher.length).toBe(vaultCiphertextSize(size));
  });

  it('starts the ciphertext with the ASCII magic FUV1', async () => {
    const { dek } = await newFileKey();
    const cipher = await encryptBytes(new Uint8Array([1, 2, 3]), dek);
    expect(Buffer.from(cipher.subarray(0, 4)).toString('ascii')).toBe('FUV1');
  });

  it('records the chunk size (1 MiB) in the header', async () => {
    const { dek } = await newFileKey();
    const cipher = await encryptBytes(new Uint8Array([1]), dek);
    const view = new DataView(cipher.buffer, cipher.byteOffset + 4, 4);
    // The spec fixes the field at 4 bytes but only the nonce counter is spelled out as big-endian.
    expect([view.getUint32(0, false), view.getUint32(0, true)]).toContain(VAULT_CHUNK_SIZE);
  });

  it('gives a different ciphertext every time for the same input, with a fresh base nonce', async () => {
    const { dek } = await newFileKey();
    const plain = randomBytes(1000);
    const a = await encryptBytes(plain, dek);
    const b = await encryptBytes(plain, dek);
    expect(same(a, b)).toBe(false);
    expect(same(a.subarray(8, 16), b.subarray(8, 16))).toBe(false);
  });

  it('does not leave the plaintext visible inside the ciphertext', async () => {
    const { dek } = await newFileKey();
    const plain = new TextEncoder().encode('SECRET-MARKER-SECRET-MARKER-SECRET-MARKER');
    const cipher = await encryptBytes(plain, dek);
    expect(Buffer.from(cipher).includes(Buffer.from('SECRET-MARKER'))).toBe(false);
  });

  it('follows the FUV1 layout: base nonce || block index (big-endian), AAD = block index || final flag', async () => {
    // Independent decryptor written against the spec, so a client in another language can rely on the format.
    const raw = new Uint8Array(32).map((_, i) => i * 7 + 1);
    const dek = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const plain = randomBytes(2.5 * MIB);
    const cipher = await encryptBytes(plain, dek);
    const baseNonce = cipher.subarray(8, 16);
    const parts: Uint8Array[] = [];
    const count = 3;
    for (let i = 0; i < count; i++) {
      const start = HEADER + i * CHUNK;
      const body = cipher.subarray(start, Math.min(cipher.length, start + CHUNK));
      const index = new Uint8Array(4);
      new DataView(index.buffer).setUint32(0, i, false);
      const nonce = concat([baseNonce, index]);
      const additionalData = concat([index, new Uint8Array([i === count - 1 ? 1 : 0])]);
      parts.push(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData }, dek, body)));
    }
    expect(same(concat(parts), plain)).toBe(true);
  });

  it('rejects the wrong key as tampered', async () => {
    const a = await newFileKey();
    const b = await newFileKey();
    const cipher = await encryptBytes(randomBytes(100), a.dek);
    await rejectsWith(decryptBytes(cipher, b.dek), 'tampered');
  });

  it('throws a VaultCryptoError (an Error) carrying a code', async () => {
    const { dek } = await newFileKey();
    const cipher = await encryptBytes(randomBytes(100), dek);
    cipher[cipher.length - 1] ^= 1;
    const error = await decryptBytes(cipher, dek).catch((e) => e);
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('tampered');
  });
});

describe('tampering with the ciphertext', () => {
  async function fixture() {
    const { dek } = await newFileKey();
    const plain = randomBytes(3.5 * MIB); // 4 chunks: 3 full, 1 half
    const cipher = await encryptBytes(plain, dek);
    return { dek, plain, cipher };
  }

  it('detects a flipped byte in the header nonce', async () => {
    const { dek, cipher } = await fixture();
    cipher[10] ^= 0x01;
    await rejectsWith(decryptBytes(cipher, dek), 'tampered');
  });

  it('detects a flipped byte in a middle chunk', async () => {
    const { dek, cipher } = await fixture();
    cipher[HEADER + CHUNK + 1234] ^= 0x80;
    await rejectsWith(decryptBytes(cipher, dek), 'tampered');
  });

  it('detects a flipped byte in a tag', async () => {
    const { dek, cipher } = await fixture();
    cipher[cipher.length - 1] ^= 0x01;
    await rejectsWith(decryptBytes(cipher, dek), 'tampered');
  });

  it('detects a flipped byte in the tag of the first chunk', async () => {
    const { dek, cipher } = await fixture();
    cipher[HEADER + CHUNK - 1] ^= 0x01;
    await rejectsWith(decryptBytes(cipher, dek), 'tampered');
  });

  it('detects a flipped byte in a one-chunk file', async () => {
    const { dek } = await newFileKey();
    const cipher = await encryptBytes(randomBytes(500), dek);
    cipher[HEADER + 100] ^= 0x01;
    await rejectsWith(decryptBytes(cipher, dek), 'tampered');
  });

  it('detects two chunks swapped', async () => {
    const { dek, cipher } = await fixture();
    const a = cipher.slice(HEADER, HEADER + CHUNK);
    const b = cipher.slice(HEADER + CHUNK, HEADER + 2 * CHUNK);
    const swapped = cipher.slice();
    swapped.set(b, HEADER);
    swapped.set(a, HEADER + CHUNK);
    await rejectsWith(decryptBytes(swapped, dek), 'tampered');
  });

  it('detects a dropped last chunk as truncated', async () => {
    const { dek, cipher } = await fixture();
    await rejectsWith(decryptBytes(cipher.slice(0, HEADER + 3 * CHUNK), dek), 'truncated');
  });

  it('detects a file cut down to its first chunk as truncated', async () => {
    const { dek, cipher } = await fixture();
    await rejectsWith(decryptBytes(cipher.slice(0, HEADER + CHUNK), dek), 'truncated');
  });

  it('rejects a ciphertext that has a header but no chunk at all', async () => {
    const { dek, cipher } = await fixture();
    await expect(decryptBytes(cipher.slice(0, HEADER), dek)).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('rejects a ciphertext cut inside a chunk', async () => {
    const { dek, cipher } = await fixture();
    await expect(decryptBytes(cipher.slice(0, cipher.length - 5), dek)).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('rejects a ciphertext shorter than the header', async () => {
    const { dek } = await newFileKey();
    await expect(decryptBytes(new Uint8Array([0x46, 0x55, 0x56]), dek)).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('rejects an extra chunk appended after the final one', async () => {
    const { dek, cipher } = await fixture();
    await expect(decryptBytes(concat([cipher, cipher.slice(HEADER, HEADER + CHUNK)]), dek)).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('rejects trailing garbage after the final chunk', async () => {
    const { dek, cipher } = await fixture();
    await expect(decryptBytes(concat([cipher, randomBytes(40)]), dek)).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('rejects a wrong magic as bad_format', async () => {
    const { dek, cipher } = await fixture();
    cipher[0] = 0x58; // 'X'
    await rejectsWith(decryptBytes(cipher, dek), 'bad_format');
  });

  it('rejects data that is not a Vault ciphertext at all as bad_format', async () => {
    const { dek } = await newFileKey();
    await rejectsWith(decryptBytes(new TextEncoder().encode('This is just a plain text file, not encrypted.'), dek), 'bad_format');
  });
});

describe('encryptStream / decryptStream', () => {
  it.each([
    ['0 bytes', 0],
    ['1 byte', 1],
    ['exactly 1 MiB', MIB],
    ['1 MiB + 1 byte', MIB + 1],
    ['3.5 MiB', 3.5 * MIB],
  ])('encrypts %s so that decryptBytes opens it', async (_name, size) => {
    const { dek } = await newFileKey();
    const plain = randomBytes(size);
    const cipher = await runStream(encryptStream(dek), plain);
    expect(cipher.length).toBe(vaultCiphertextSize(size));
    expect(Buffer.from(cipher.subarray(0, 4)).toString('ascii')).toBe('FUV1');
    expect(same(await decryptBytes(cipher, dek), plain)).toBe(true);
  });

  it.each([
    ['0 bytes', 0],
    ['1 byte', 1],
    ['exactly 1 MiB', MIB],
    ['1 MiB + 1 byte', MIB + 1],
    ['3.5 MiB', 3.5 * MIB],
  ])('decrypts what encryptBytes made for %s', async (_name, size) => {
    const { dek } = await newFileKey();
    const plain = randomBytes(size);
    const cipher = await encryptBytes(plain, dek);
    expect(same(await runStream(decryptStream(dek), cipher), plain)).toBe(true);
  });

  it('round-trips through both streams when fed in odd-sized pieces', async () => {
    const { dek } = await newFileKey();
    const plain = randomBytes(3.5 * MIB);
    const cipher = await runStream(encryptStream(dek), plain, [7, 300 * 1024, MIB + 3]);
    expect(same(await runStream(decryptStream(dek), cipher, [13, 999_983, 1]), plain)).toBe(true);
  });

  it('re-chunks tiny pieces into full 1 MiB chunks', async () => {
    const { dek } = await newFileKey();
    const plain = randomBytes(MIB + 100);
    const cipher = await runStream(encryptStream(dek), plain, [7]);
    expect(cipher.length).toBe(vaultCiphertextSize(MIB + 100));
    expect(same(await decryptBytes(cipher, dek), plain)).toBe(true);
  });

  it('rejects a tampered ciphertext as tampered', async () => {
    const { dek } = await newFileKey();
    const cipher = await encryptBytes(randomBytes(2.5 * MIB), dek);
    cipher[HEADER + CHUNK + 50] ^= 1;
    await rejectsWith(runStream(decryptStream(dek), cipher), 'tampered');
  });

  it('rejects a ciphertext with the last chunk dropped as truncated', async () => {
    const { dek } = await newFileKey();
    const cipher = await encryptBytes(randomBytes(2.5 * MIB), dek);
    await rejectsWith(runStream(decryptStream(dek), cipher.slice(0, HEADER + 2 * CHUNK)), 'truncated');
  });

  it('rejects a wrong magic as bad_format', async () => {
    const { dek } = await newFileKey();
    const cipher = await encryptBytes(randomBytes(100), dek);
    cipher[1] = 0x00;
    await rejectsWith(runStream(decryptStream(dek), cipher), 'bad_format');
  });
});

describe('derivePinKeys', () => {
  it('derives the same keys from the same PIN and salt', async () => {
    const salt = randomSalt();
    const a = await derivePinKeys('482915', salt, IT);
    const b = await derivePinKeys('482915', salt, IT);
    expect(a.authKey).toBe(b.authKey);
    expect(same(a.wrapBase, b.wrapBase)).toBe(true);
  });

  it('gives a base64 authKey and a byte array wrapBase', async () => {
    const { authKey, wrapBase } = await derivePinKeys('482915', randomSalt(), IT);
    expect(isB64(authKey)).toBe(true);
    expect(wrapBase).toBeInstanceOf(Uint8Array);
    expect(wrapBase.length).toBeGreaterThan(0);
  });

  it('derives different keys for a different PIN', async () => {
    const salt = randomSalt();
    const a = await derivePinKeys('482915', salt, IT);
    const b = await derivePinKeys('482916', salt, IT);
    expect(a.authKey).not.toBe(b.authKey);
    expect(same(a.wrapBase, b.wrapBase)).toBe(false);
  });

  it('derives different keys for a different salt', async () => {
    const a = await derivePinKeys('482915', randomSalt(), IT);
    const b = await derivePinKeys('482915', randomSalt(), IT);
    expect(a.authKey).not.toBe(b.authKey);
    expect(same(a.wrapBase, b.wrapBase)).toBe(false);
  });

  it('derives different keys for a different iteration count', async () => {
    const salt = randomSalt();
    const a = await derivePinKeys('482915', salt, 1000);
    const b = await derivePinKeys('482915', salt, 1001);
    expect(a.authKey).not.toBe(b.authKey);
  });

  it('keeps authKey independent of wrapBase: the server-held hash tells nothing about the wrapping key', async () => {
    const { authKey, wrapBase } = await derivePinKeys('482915', randomSalt(), IT);
    const auth = fromB64(authKey);
    expect(hex(wrapBase)).not.toBe(hex(auth));
    expect(hex(wrapBase).includes(hex(auth))).toBe(false);
    expect(hex(wrapBase).includes(hex(auth.subarray(0, 8)))).toBe(false);
    expect(hex(auth).includes(hex(wrapBase.subarray(0, 8)))).toBe(false);
  });
});

describe('key wrapping', () => {
  it('lets newMasterKey make an AES-256 key that wrapKey can wrap', async () => {
    const mk = await newMasterKey();
    expect(mk.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    const kek = await kekFrom(new Uint8Array(32).fill(3), newServerSecret());
    expect(isB64(await wrapKey(mk, kek))).toBe(true);
  });

  it('unwraps a wrapped master key into a key that opens what the original sealed', async () => {
    const mk = await newMasterKey();
    const kek = await kekFrom(randomBytes(32), newServerSecret());
    const opened = await unwrapMasterKey(await wrapKey(mk, kek), kek);
    const meta: VaultMeta = { name: 'a.txt', mime: 'text/plain', kind: 'file' };
    expect(await decryptMeta(await encryptMeta(meta, mk), opened)).toEqual(meta);
  });

  it('returns a non-extractable master key from unwrapMasterKey', async () => {
    const mk = await newMasterKey();
    const kek = await kekFrom(randomBytes(32), newServerSecret());
    const opened = await unwrapMasterKey(await wrapKey(mk, kek), kek);
    expect(opened.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', opened)).rejects.toThrow();
  });

  it('derives the same KEK from the same wrapBase and server secret, and a different one otherwise', async () => {
    const mk = await newMasterKey();
    const base = randomBytes(32);
    const secret = newServerSecret();
    const wrapped = await wrapKey(mk, await kekFrom(base, secret));
    await expect(unwrapMasterKey(wrapped, await kekFrom(base, secret))).resolves.toBeDefined();
    await expect(unwrapMasterKey(wrapped, await kekFrom(base, newServerSecret()))).rejects.toThrow();
    await expect(unwrapMasterKey(wrapped, await kekFrom(randomBytes(32), secret))).rejects.toThrow();
  });

  it('rejects a tampered wrapped key', async () => {
    const mk = await newMasterKey();
    const kek = await kekFrom(randomBytes(32), newServerSecret());
    const bytes = fromB64(await wrapKey(mk, kek));
    bytes[bytes.length - 1] ^= 1;
    await expect(unwrapMasterKey(toB64(bytes), kek)).rejects.toThrow();
  });
});

describe('newServerSecret and randomSalt', () => {
  it('makes a 32-byte base64 server secret that is different every time', () => {
    const a = newServerSecret();
    expect(isB64(a)).toBe(true);
    expect(fromB64(a).length).toBe(32);
    expect(newServerSecret()).not.toBe(a);
  });

  it('makes a base64 salt of at least 16 random bytes', () => {
    const a = randomSalt();
    expect(isB64(a)).toBe(true);
    expect(fromB64(a).length).toBeGreaterThanOrEqual(16);
    expect(randomSalt()).not.toBe(a);
  });
});

describe('recovery key', () => {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

  it('is 128 bits in Crockford base32, groups of 4 joined by dashes, plus one checksum character', () => {
    const rk = newRecoveryKey();
    const chars = rk.replace(/-/g, '');
    expect(chars.length).toBe(27); // 26 characters carry 130 bits (128 used) + 1 checksum
    for (const c of chars) expect(ALPHABET).toContain(c);
    const groups = rk.split('-');
    for (const g of groups.slice(0, -1)) expect(g).toHaveLength(4);
    expect(groups[groups.length - 1].length).toBeGreaterThan(0);
    expect(groups[groups.length - 1].length).toBeLessThanOrEqual(4);
  });

  it('is different every time', () => {
    expect(newRecoveryKey()).not.toBe(newRecoveryKey());
  });

  it('parses back to 16 bytes', () => {
    const bytes = parseRecoveryKey(newRecoveryKey());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes!.length).toBe(16);
  });

  it('parses the same bytes from the key written in lowercase', () => {
    const rk = newRecoveryKey();
    expect(same(parseRecoveryKey(rk.toLowerCase())!, parseRecoveryKey(rk)!)).toBe(true);
  });

  it('parses the same bytes with spaces instead of dashes', () => {
    const rk = newRecoveryKey();
    expect(same(parseRecoveryKey(rk.replace(/-/g, ' '))!, parseRecoveryKey(rk)!)).toBe(true);
    expect(same(parseRecoveryKey(`  ${rk.replace(/-/g, '  ')} \n`)!, parseRecoveryKey(rk)!)).toBe(true);
  });

  it('parses the same bytes when the dashes are missing', () => {
    const rk = newRecoveryKey();
    expect(same(parseRecoveryKey(rk.replace(/-/g, ''))!, parseRecoveryKey(rk)!)).toBe(true);
    expect(same(parseRecoveryKey(rk.replace(/-/g, '').toLowerCase())!, parseRecoveryKey(rk)!)).toBe(true);
  });

  it('returns null when any single character is wrong', () => {
    const rk = newRecoveryKey();
    const chars = rk.replace(/-/g, '');
    for (let i = 0; i < chars.length; i++) {
      const wrong = ALPHABET[(ALPHABET.indexOf(chars[i]) + 1) % ALPHABET.length];
      expect(parseRecoveryKey(chars.slice(0, i) + wrong + chars.slice(i + 1)), `position ${i}`).toBeNull();
    }
  });

  it('returns null for text of the wrong length or with characters outside the alphabet', () => {
    const chars = newRecoveryKey().replace(/-/g, '');
    expect(parseRecoveryKey('')).toBeNull();
    expect(parseRecoveryKey(chars.slice(0, -1))).toBeNull();
    expect(parseRecoveryKey(chars + '0')).toBeNull();
    expect(parseRecoveryKey('!'.repeat(27))).toBeNull();
  });

  it('derives rkAuth and rkKek deterministically from the key', async () => {
    const rk = newRecoveryKey();
    const a = await recoveryKeys(rk);
    const b = await recoveryKeys(rk);
    expect(isB64(a.rkAuth)).toBe(true);
    expect(a.rkAuth).toBe(b.rkAuth);
    const mk = await newMasterKey();
    await expect(unwrapMasterKey(await wrapKey(mk, a.rkKek), b.rkKek)).resolves.toBeDefined();
  });

  it('derives different rkAuth and rkKek for a different key', async () => {
    const a = await recoveryKeys(newRecoveryKey());
    const b = await recoveryKeys(newRecoveryKey());
    expect(a.rkAuth).not.toBe(b.rkAuth);
    const mk = await newMasterKey();
    await expect(unwrapMasterKey(await wrapKey(mk, a.rkKek), b.rkKek)).rejects.toThrow();
  });
});

describe('newSetup', () => {
  const PIN = '482915';
  const META: VaultMeta = { name: 'Hợp đồng thuê nhà.pdf', mime: 'application/pdf', kind: 'file' };

  it('builds a request whose fields are all base64 (except the iteration count)', async () => {
    const { request } = await newSetup(PIN, { iterations: IT });
    expect(request.kdfIterations).toBe(IT);
    for (const field of ['kdfSalt', 'authKey', 'serverSecret', 'wrappedMkPin', 'rkAuth', 'wrappedMkRecovery'] as const) {
      expect(isB64(request[field]), field).toBe(true);
    }
    expect(fromB64(request.serverSecret).length).toBe(32);
  });

  it('uses the production iteration count when none is given', async () => {
    const { request } = await newSetup(PIN);
    expect(request.kdfIterations).toBe(VAULT_KDF_ITERATIONS);
  }, 30_000);

  it('returns a recovery key in the printed format that parses', async () => {
    const { recoveryKey } = await newSetup(PIN, { iterations: IT });
    expect(recoveryKey).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/);
    expect(parseRecoveryKey(recoveryKey)).not.toBeNull();
  });

  it('lets the PIN and the server secret unwrap the master key', async () => {
    const { request, mk } = await newSetup(PIN, { iterations: IT });
    const { wrapBase } = await derivePinKeys(PIN, request.kdfSalt, request.kdfIterations);
    const viaPin = await unwrapMasterKey(request.wrappedMkPin, await kekFrom(wrapBase, request.serverSecret));
    expect(await decryptMeta(await encryptMeta(META, mk), viaPin)).toEqual(META);
  });

  it('lets the recovery key unwrap the same master key', async () => {
    const { request, recoveryKey, mk } = await newSetup(PIN, { iterations: IT });
    const { rkKek } = await recoveryKeys(recoveryKey);
    const viaRecovery = await unwrapMasterKey(request.wrappedMkRecovery, rkKek);
    expect(await decryptMeta(await encryptMeta(META, mk), viaRecovery)).toEqual(META);
  });

  it('opens the same data through both routes', async () => {
    const { request, recoveryKey } = await newSetup(PIN, { iterations: IT });
    const { wrapBase } = await derivePinKeys(PIN, request.kdfSalt, request.kdfIterations);
    const viaPin = await unwrapMasterKey(request.wrappedMkPin, await kekFrom(wrapBase, request.serverSecret));
    const viaRecovery = await unwrapMasterKey(request.wrappedMkRecovery, (await recoveryKeys(recoveryKey)).rkKek);
    expect(await decryptMeta(await encryptMeta(META, viaPin), viaRecovery)).toEqual(META);
    expect(await decryptMeta(await encryptMeta(META, viaRecovery), viaPin)).toEqual(META);
  });

  it('rejects a wrong PIN', async () => {
    const { request } = await newSetup(PIN, { iterations: IT });
    const { wrapBase } = await derivePinKeys('654321', request.kdfSalt, request.kdfIterations);
    await expect(unwrapMasterKey(request.wrappedMkPin, await kekFrom(wrapBase, request.serverSecret))).rejects.toThrow();
  });

  it('rejects the right PIN with a wrong server secret', async () => {
    const { request } = await newSetup(PIN, { iterations: IT });
    const { wrapBase } = await derivePinKeys(PIN, request.kdfSalt, request.kdfIterations);
    await expect(unwrapMasterKey(request.wrappedMkPin, await kekFrom(wrapBase, newServerSecret()))).rejects.toThrow();
  });

  it('rejects a wrong recovery key', async () => {
    const { request } = await newSetup(PIN, { iterations: IT });
    const { rkKek } = await recoveryKeys(newRecoveryKey());
    await expect(unwrapMasterKey(request.wrappedMkRecovery, rkKek)).rejects.toThrow();
  });

  it('sends the keys the server will check: authKey from the PIN and rkAuth from the recovery key', async () => {
    const { request, recoveryKey } = await newSetup(PIN, { iterations: IT });
    expect(request.authKey).toBe((await derivePinKeys(PIN, request.kdfSalt, request.kdfIterations)).authKey);
    expect(request.rkAuth).toBe((await recoveryKeys(recoveryKey)).rkAuth);
    expect(request.authKey).not.toBe(request.rkAuth);
  });

  it('never puts the PIN or the recovery key in the request', async () => {
    const { request, recoveryKey } = await newSetup(PIN, { iterations: IT });
    const json = JSON.stringify(request);
    expect(json).not.toContain(PIN);
    expect(json).not.toContain(recoveryKey);
    expect(json).not.toContain(recoveryKey.replace(/-/g, ''));
  });

  it('makes a fresh salt, server secret, master key and recovery key every time', async () => {
    const a = await newSetup(PIN, { iterations: IT });
    const b = await newSetup(PIN, { iterations: IT });
    expect(a.request.kdfSalt).not.toBe(b.request.kdfSalt);
    expect(a.request.serverSecret).not.toBe(b.request.serverSecret);
    expect(a.request.wrappedMkPin).not.toBe(b.request.wrappedMkPin);
    expect(a.recoveryKey).not.toBe(b.recoveryKey);
    await expect(decryptMeta(await encryptMeta(META, a.mk), b.mk)).rejects.toThrow();
  });
});

describe('per-file keys', () => {
  it('wraps a file key with the master key and unwraps it into a key that decrypts', async () => {
    const mk = await newMasterKey();
    const { dek, wrapped } = await newFileKey();
    const plain = randomBytes(MIB + 5);
    const cipher = await encryptBytes(plain, dek);
    const opened = await unwrapFileKey(await wrapped(mk), mk);
    expect(same(await decryptBytes(cipher, opened), plain)).toBe(true);
  });

  it('gives each file a different key', async () => {
    const mk = await newMasterKey();
    const a = await newFileKey();
    const b = await newFileKey();
    expect(await a.wrapped(mk)).not.toBe(await b.wrapped(mk));
    const cipher = await encryptBytes(randomBytes(10), a.dek);
    await rejectsWith(decryptBytes(cipher, b.dek), 'tampered');
  });

  it('returns a non-extractable key from unwrapFileKey', async () => {
    const mk = await newMasterKey();
    const { wrapped } = await newFileKey();
    const opened = await unwrapFileKey(await wrapped(mk), mk);
    expect(opened.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', opened)).rejects.toThrow();
  });

  it('cannot unwrap a file key with the wrong master key', async () => {
    const { wrapped } = await newFileKey();
    const wrappedKey = await wrapped(await newMasterKey());
    await expect(unwrapFileKey(wrappedKey, await newMasterKey())).rejects.toThrow();
  });
});

describe('encryptMeta / decryptMeta', () => {
  it('keeps a Vietnamese file name', async () => {
    const mk = await newMasterKey();
    const meta: VaultMeta = { name: 'Hợp đồng thuê nhà.pdf', mime: 'application/pdf', kind: 'file' };
    expect(await decryptMeta(await encryptMeta(meta, mk), mk)).toEqual(meta);
  });

  it('keeps a link with its URL and title', async () => {
    const mk = await newMasterKey();
    const meta: VaultMeta = {
      name: 'Bài viết',
      mime: 'text/uri-list',
      kind: 'link',
      url: 'https://example.com/đường-dẫn?q=tìm+kiếm&x=1#phần',
      title: 'Cách nấu phở bò — ngon nhất Hà Nội',
    };
    expect(await decryptMeta(await encryptMeta(meta, mk), mk)).toEqual(meta);
  });

  it('keeps null url and title as they were', async () => {
    const mk = await newMasterKey();
    const meta: VaultMeta = { name: 'a.png', mime: 'image/png', kind: 'image', url: null, title: null };
    expect(await decryptMeta(await encryptMeta(meta, mk), mk)).toEqual(meta);
  });

  it('gives base64 that does not contain the name, and differs every time', async () => {
    const mk = await newMasterKey();
    const meta: VaultMeta = { name: 'secret-plans.pdf', mime: 'application/pdf', kind: 'file' };
    const a = await encryptMeta(meta, mk);
    const b = await encryptMeta(meta, mk);
    expect(isB64(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(Buffer.from(fromB64(a)).includes(Buffer.from('secret-plans'))).toBe(false);
  });

  it('rejects the wrong master key', async () => {
    const meta: VaultMeta = { name: 'a.txt', mime: 'text/plain', kind: 'file' };
    const enc = await encryptMeta(meta, await newMasterKey());
    await expect(decryptMeta(enc, await newMasterKey())).rejects.toThrow();
  });

  it('rejects tampered metadata', async () => {
    const mk = await newMasterKey();
    const bytes = fromB64(await encryptMeta({ name: 'a.txt', mime: 'text/plain', kind: 'file' }, mk));
    bytes[bytes.length - 1] ^= 1;
    await expect(decryptMeta(toB64(bytes), mk)).rejects.toThrow();
  });
});
