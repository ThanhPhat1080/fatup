/**
 * Crypto core of the end-to-end encrypted Vault (see the vault E2EE design spec, §4.1, §4.2).
 * WebCrypto only, so the same file runs in Electron main (Node), browsers and the Worker.
 */
import { VAULT_CHUNK_SIZE, VAULT_KDF_ITERATIONS, type VaultMeta, type VaultSetupRequest } from './vault';

export type VaultCryptoErrorCode = 'bad_format' | 'tampered' | 'truncated';

/** Thrown when a ciphertext is not a Vault ciphertext (`bad_format`), was modified (`tampered`) or lost its end (`truncated`). */
export class VaultCryptoError extends Error {
  readonly code: VaultCryptoErrorCode;
  constructor(code: VaultCryptoErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'VaultCryptoError';
    this.code = code;
  }
}

const subtle = () => crypto.subtle;
/** `CryptoKey` taken from the runtime's own typings: the Worker, Node and DOM each declare it differently, and this file is compiled by all three. */
type CryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
/** A byte array backed by a plain ArrayBuffer, which is what WebCrypto's typings accept. */
type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();

const MAGIC = [0x46, 0x55, 0x56, 0x31]; // "FUV1"
const HEADER_BYTES = 16;
const TAG_BYTES = 16;
const NONCE_BYTES = 12;
/** Upper bound on the chunk size a header may announce, so a hostile header cannot make us buffer without limit. */
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;

// ---------- bytes helpers ----------

function randomBytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n));
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Bytes {
  const s = atob(text);
  const out: Bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out: Bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------- PIN and server secret ----------

/** 32 random bytes, base64: the Vault's server-held secret `S`. */
export function newServerSecret(): string {
  return toBase64(randomBytes(32));
}

/** 16 random bytes, base64: the PBKDF2 salt. */
export function randomSalt(): string {
  return toBase64(randomBytes(16));
}

async function hkdfBits(ikm: Uint8Array, info: string, bits = 256): Promise<Uint8Array> {
  const base = await subtle().importKey('raw', ikm as Bytes, 'HKDF', false, ['deriveBits']);
  const out = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, base, bits);
  return new Uint8Array(out);
}

async function hkdfAesKey(ikm: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', ikm as Bytes, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** Stretches the PIN (PBKDF2-SHA256) and splits the result into the proof sent to the server (`authKey`) and the wrapping base that never leaves the device. */
export async function derivePinKeys(pin: string, saltB64: string, iterations: number): Promise<{ authKey: string; wrapBase: Uint8Array }> {
  const material = await subtle().importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(saltB64), iterations }, material, 512);
  const p = new Uint8Array(bits);
  return { authKey: toBase64(await hkdfBits(p, 'fatup-vault-auth')), wrapBase: await hkdfBits(p, 'fatup-vault-wrap') };
}

/** The key-encryption key that wraps the master key: it needs both the PIN (`wrapBase`) and the server secret. */
export function kekFrom(wrapBase: Uint8Array, serverSecretB64: string): Promise<CryptoKey> {
  return hkdfAesKey(concat(wrapBase, fromBase64(serverSecretB64)), 'fatup-vault-kek');
}

// ---------- key wrapping ----------

/** A fresh AES-256 master key. Extractable only so it can be wrapped; day-to-day keys come from `unwrapMasterKey`. */
export async function newMasterKey(): Promise<CryptoKey> {
  return (await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])) as CryptoKey;
}

/** Wraps `key` (must be extractable) with `kek`: AES-GCM, 12-byte nonce prepended, base64. */
export async function wrapKey(key: CryptoKey, kek: CryptoKey): Promise<string> {
  const iv = randomBytes(NONCE_BYTES);
  const wrapped = await subtle().wrapKey('raw', key, kek, { name: 'AES-GCM', iv });
  return toBase64(concat(iv, new Uint8Array(wrapped)));
}

/** Opens a wrapped master key. The result cannot be exported unless `extractable` is set (PIN change only). */
export async function unwrapMasterKey(wrapped: string, kek: CryptoKey, opts: { extractable?: boolean } = {}): Promise<CryptoKey> {
  try {
    const bytes = fromBase64(wrapped);
    return await subtle().unwrapKey(
      'raw',
      bytes.subarray(NONCE_BYTES),
      kek,
      { name: 'AES-GCM', iv: bytes.subarray(0, NONCE_BYTES) },
      { name: 'AES-GCM', length: 256 },
      opts.extractable === true,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new VaultCryptoError('tampered', 'cannot unwrap the master key');
  }
}

/** A per-file key. `wrapped(mk)` is what the server stores as `enc_key`. */
export async function newFileKey(): Promise<{ dek: CryptoKey; wrapped(mk: CryptoKey): Promise<string> }> {
  const raw = randomBytes(32);
  const dek = await subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    dek,
    async wrapped(mk) {
      const iv = randomBytes(NONCE_BYTES);
      return toBase64(concat(iv, new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, mk, raw))));
    },
  };
}

/** Opens a wrapped file key into a non-extractable key. */
export async function unwrapFileKey(wrapped: string, mk: CryptoKey): Promise<CryptoKey> {
  let raw: Bytes | undefined;
  try {
    const bytes = fromBase64(wrapped);
    raw = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, NONCE_BYTES) }, mk, bytes.subarray(NONCE_BYTES)));
    return await subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    throw new VaultCryptoError('tampered', 'cannot unwrap the file key');
  } finally {
    raw?.fill(0);
  }
}

// ---------- recovery key ----------

/** Crockford base32. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RK_BYTES = 16;
/** 128 bits need 26 symbols (130 bits, the last two are zero padding); a 27th symbol is the checksum. */
const RK_SYMBOLS = 26;

/** Odd weights are invertible mod 32, so any single wrong symbol changes the checksum. */
function rkChecksum(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += (2 * i + 1) * values[i];
  return sum % 32;
}

/** A fresh 128-bit recovery key, printed as Crockford base32 in groups of 4 with one checksum character. */
export function newRecoveryKey(): string {
  const bytes = randomBytes(RK_BYTES);
  const values: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      values.push((acc >> (bits - 5)) & 31);
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) values.push((acc << (5 - bits)) & 31);
  values.push(rkChecksum(values));
  const text = values.map((v) => B32[v]).join('');
  return text.match(/.{1,4}/g)!.join('-');
}

/** Reads a typed recovery key (any case, with or without spaces and dashes) back into its 16 bytes, or null when it is not valid. */
export function parseRecoveryKey(text: string): Uint8Array | null {
  const chars = text.replace(/[\s-]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  if (chars.length !== RK_SYMBOLS + 1) return null;
  const values: number[] = [];
  for (const c of chars) {
    const v = B32.indexOf(c);
    if (v < 0) return null;
    values.push(v);
  }
  const check = values.pop()!;
  if (rkChecksum(values) !== check) return null;
  if ((values[RK_SYMBOLS - 1] & 3) !== 0) return null; // padding bits must be zero
  const out = new Uint8Array(RK_BYTES);
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const v of values) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      if (at < RK_BYTES) out[at++] = (acc >> (bits - 8)) & 255;
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

/** The proof sent to the server (`rkAuth`) and the key that wraps the master key (`rkKek`), both derived from the recovery key. */
export async function recoveryKeys(rk: string): Promise<{ rkAuth: string; rkKek: CryptoKey }> {
  const bytes = parseRecoveryKey(rk);
  if (!bytes) throw new VaultCryptoError('bad_format', 'invalid recovery key');
  return { rkAuth: toBase64(await hkdfBits(bytes, 'fatup-vault-rk-auth')), rkKek: await hkdfAesKey(bytes, 'fatup-vault-rk-wrap') };
}

/** Everything the first-time setup needs: the request for `POST /vault/setup`, the recovery key to show once, and the (non-extractable) master key. */
export async function newSetup(
  pin: string,
  { iterations = VAULT_KDF_ITERATIONS }: { iterations?: number } = {},
): Promise<{ request: VaultSetupRequest; recoveryKey: string; mk: CryptoKey }> {
  const kdfSalt = randomSalt();
  const serverSecret = newServerSecret();
  const recoveryKey = newRecoveryKey();
  const mk = await newMasterKey();
  const { authKey, wrapBase } = await derivePinKeys(pin, kdfSalt, iterations);
  const wrappedMkPin = await wrapKey(mk, await kekFrom(wrapBase, serverSecret));
  const { rkAuth, rkKek } = await recoveryKeys(recoveryKey);
  const wrappedMkRecovery = await wrapKey(mk, rkKek);
  const request: VaultSetupRequest = { kdfSalt, kdfIterations: iterations, authKey, serverSecret, wrappedMkPin, rkAuth, wrappedMkRecovery };
  return { request, recoveryKey, mk: await unwrapMasterKey(wrappedMkPin, await kekFrom(wrapBase, serverSecret)) };
}

// ---------- metadata ----------

/** Encrypts an item's name, type and link: AES-GCM over UTF-8 JSON, 12-byte nonce prepended, base64. */
export async function encryptMeta(meta: VaultMeta, mk: CryptoKey): Promise<string> {
  const iv = randomBytes(NONCE_BYTES);
  const sealed = await subtle().encrypt({ name: 'AES-GCM', iv }, mk, enc.encode(JSON.stringify(meta)));
  return toBase64(concat(iv, new Uint8Array(sealed)));
}

/** Opens `encMeta`; throws `tampered` for the wrong key or modified data. */
export async function decryptMeta(encMeta: string, mk: CryptoKey): Promise<VaultMeta> {
  try {
    const bytes = fromBase64(encMeta);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, NONCE_BYTES) }, mk, bytes.subarray(NONCE_BYTES));
    return JSON.parse(new TextDecoder().decode(plain)) as VaultMeta;
  } catch {
    throw new VaultCryptoError('tampered', 'cannot open the metadata');
  }
}

// ---------- FUV1 chunked content encryption ----------

function u32(n: number): Bytes {
  const out: Bytes = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

function sealChunk(dek: CryptoKey, baseNonce: Uint8Array, index: number, plain: Uint8Array, isLast: boolean): Promise<ArrayBuffer> {
  const idx = u32(index);
  return subtle().encrypt(
    { name: 'AES-GCM', iv: concat(baseNonce, idx), additionalData: concat(idx, new Uint8Array([isLast ? 1 : 0])) },
    dek,
    plain as Bytes,
  );
}

/** Returns the plaintext, or null when the chunk does not verify for this index and final flag. */
async function openChunk(dek: CryptoKey, baseNonce: Uint8Array, index: number, data: Uint8Array, isLast: boolean): Promise<Uint8Array | null> {
  const idx = u32(index);
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: concat(baseNonce, idx), additionalData: concat(idx, new Uint8Array([isLast ? 1 : 0])) },
      dek,
      data as Bytes,
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

/** Opens the last chunk; one that only verifies as a non-final chunk means the file lost its end. */
async function openLastChunk(dek: CryptoKey, baseNonce: Uint8Array, index: number, data: Uint8Array): Promise<Uint8Array> {
  const plain = await openChunk(dek, baseNonce, index, data, true);
  if (plain) return plain;
  if (await openChunk(dek, baseNonce, index, data, false)) throw new VaultCryptoError('truncated', 'the final chunk is missing');
  throw new VaultCryptoError('tampered', 'the final chunk does not verify');
}

async function openMiddleChunk(dek: CryptoKey, baseNonce: Uint8Array, index: number, data: Uint8Array): Promise<Uint8Array> {
  const plain = await openChunk(dek, baseNonce, index, data, false);
  if (!plain) throw new VaultCryptoError('tampered', `chunk ${index} does not verify`);
  return plain;
}

function makeHeader(baseNonce: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES);
  out.set(MAGIC, 0);
  out.set(u32(VAULT_CHUNK_SIZE), 4);
  out.set(baseNonce, 8);
  return out;
}

/** Validates a 16-byte header and returns its chunk size and base nonce. */
function parseHeader(header: Uint8Array): { chunkSize: number; baseNonce: Uint8Array } {
  if (header.length < HEADER_BYTES || MAGIC.some((b, i) => header[i] !== b)) throw new VaultCryptoError('bad_format', 'not a Vault ciphertext');
  const chunkSize = new DataView(header.buffer, header.byteOffset + 4, 4).getUint32(0, false);
  if (chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) throw new VaultCryptoError('bad_format', 'unsupported chunk size');
  return { chunkSize, baseNonce: header.slice(8, HEADER_BYTES) };
}

/** Encrypts a whole file in memory. The result is exactly `vaultCiphertextSize(plain.length)` bytes. */
export async function encryptBytes(plain: Uint8Array, dek: CryptoKey): Promise<Uint8Array> {
  const baseNonce = randomBytes(8);
  const count = Math.max(1, Math.ceil(plain.length / VAULT_CHUNK_SIZE));
  const parts: Uint8Array[] = [makeHeader(baseNonce)];
  for (let i = 0; i < count; i++) {
    const piece = plain.subarray(i * VAULT_CHUNK_SIZE, (i + 1) * VAULT_CHUNK_SIZE);
    parts.push(new Uint8Array(await sealChunk(dek, baseNonce, i, piece, i === count - 1)));
  }
  return concat(...parts);
}

/** Decrypts a whole FUV1 ciphertext in memory; throws `VaultCryptoError`. */
export async function decryptBytes(cipher: Uint8Array, dek: CryptoKey): Promise<Uint8Array> {
  const { chunkSize, baseNonce } = parseHeader(cipher.subarray(0, HEADER_BYTES));
  const body = cipher.subarray(HEADER_BYTES);
  if (body.length === 0) throw new VaultCryptoError('truncated', 'no chunk after the header');
  const size = chunkSize + TAG_BYTES;
  const count = Math.ceil(body.length / size);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const piece = body.subarray(i * size, (i + 1) * size);
    parts.push(i === count - 1 ? await openLastChunk(dek, baseNonce, i, piece) : await openMiddleChunk(dek, baseNonce, i, piece));
  }
  return concat(...parts);
}

/** Collects bytes into fixed-size chunks, and only hands one over once more input follows (so the last chunk stays behind for `flush`). */
class Chunker {
  private readonly buf: Uint8Array;
  private filled = 0;
  constructor(private readonly size: number) {
    this.buf = new Uint8Array(size);
  }
  async push(data: Uint8Array, emit: (full: Uint8Array) => Promise<void>): Promise<void> {
    let pos = 0;
    while (pos < data.length) {
      if (this.filled === this.size) {
        await emit(this.buf);
        this.filled = 0;
      }
      const n = Math.min(this.size - this.filled, data.length - pos);
      this.buf.set(data.subarray(pos, pos + n), this.filled);
      this.filled += n;
      pos += n;
    }
  }
  rest(): Uint8Array {
    return this.buf.subarray(0, this.filled);
  }
}

/** Streaming FUV1 encryption: re-chunks any input piece sizes into `VAULT_CHUNK_SIZE` chunks. */
export function encryptStream(dek: CryptoKey): TransformStream<Uint8Array, Uint8Array> {
  const baseNonce = randomBytes(8);
  const chunker = new Chunker(VAULT_CHUNK_SIZE);
  let index = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      controller.enqueue(makeHeader(baseNonce));
    },
    async transform(piece, controller) {
      await chunker.push(piece, async (full) => {
        controller.enqueue(new Uint8Array(await sealChunk(dek, baseNonce, index++, full, false)));
      });
    },
    async flush(controller) {
      controller.enqueue(new Uint8Array(await sealChunk(dek, baseNonce, index, chunker.rest(), true)));
    },
  });
}

/** Streaming FUV1 decryption. It holds back one chunk so it knows which one is the last; errors surface on the readable side. */
export function decryptStream(dek: CryptoKey): TransformStream<Uint8Array, Uint8Array> {
  const header = new Uint8Array(HEADER_BYTES);
  let headerLen = 0;
  let baseNonce: Uint8Array;
  let chunker: Chunker | undefined;
  let index = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(piece, controller) {
      let data = piece;
      if (!chunker) {
        const n = Math.min(HEADER_BYTES - headerLen, data.length);
        header.set(data.subarray(0, n), headerLen);
        headerLen += n;
        data = data.subarray(n);
        if (headerLen < HEADER_BYTES) return;
        const parsed = parseHeader(header);
        baseNonce = parsed.baseNonce;
        chunker = new Chunker(parsed.chunkSize + TAG_BYTES);
      }
      await chunker.push(data, async (full) => {
        controller.enqueue(await openMiddleChunk(dek, baseNonce, index++, full));
      });
    },
    async flush(controller) {
      if (!chunker) throw new VaultCryptoError('bad_format', headerLen === 0 ? 'empty input' : 'shorter than the header');
      const rest = chunker.rest();
      if (rest.length === 0) throw new VaultCryptoError('truncated', 'no chunk after the header');
      controller.enqueue(await openLastChunk(dek, baseNonce, index, rest));
    },
  });
}
