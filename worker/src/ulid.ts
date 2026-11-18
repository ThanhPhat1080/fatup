const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID from a time (epoch ms) and 16 bytes that fill the randomness part. Same input, same id. */
export function ulidFrom(time: number, random: Uint8Array): string {
  let head = '';
  let t = time;
  for (let i = 0; i < 10; i++) {
    head = ALPHABET[t % 32] + head;
    t = Math.floor(t / 32);
  }
  let tail = '';
  for (let i = 0; i < 16; i++) tail += ALPHABET[random[i] % 32];
  return head + tail;
}

/** Crockford base32 ULID: 10 chars of time + 16 chars of randomness. */
export function ulid(now = Date.now()): string {
  return ulidFrom(now, crypto.getRandomValues(new Uint8Array(16)));
}

export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
