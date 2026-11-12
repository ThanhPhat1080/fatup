/** Encrypts the API token with a key derived from the PIN, and tracks PIN-attempt lockout. */

const ITERATIONS = 310_000;
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 30_000;

export type Sealed = { salt: string; iv: string; data: string };
export type Lockout = { failedAttempts: number; lockedUntil: number };

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFor(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function seal(secret: string, pin: string): Promise<Sealed> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(pin, salt);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret)));
  return { salt: b64(salt), iv: b64(iv), data: b64(data) };
}

/** Returns null when the PIN is wrong (AES-GCM authentication fails). */
export async function open(sealed: Sealed, pin: string): Promise<string | null> {
  try {
    const key = await keyFor(pin, unb64(sealed.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource }, key, unb64(sealed.data) as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export type Attempt =
  | { ok: true; state: Lockout }
  | { ok: false; reason: 'wrong'; attemptsLeft: number; state: Lockout }
  | { ok: false; reason: 'locked'; lockedUntil: number; state: Lockout };

/** Same rule as the desktop app: 5 wrong PINs lock input for 30 seconds. */
export function nextAttempt(success: boolean, state: Lockout, now = Date.now()): Attempt {
  if (state.lockedUntil > now) return { ok: false, reason: 'locked', lockedUntil: state.lockedUntil, state };
  if (success) return { ok: true, state: { failedAttempts: 0, lockedUntil: 0 } };
  const failed = state.failedAttempts + 1;
  if (failed >= MAX_ATTEMPTS) {
    const lockedUntil = now + LOCKOUT_MS;
    return { ok: false, reason: 'locked', lockedUntil, state: { failedAttempts: 0, lockedUntil } };
  }
  return { ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - failed, state: { failedAttempts: failed, lockedUntil: 0 } };
}
