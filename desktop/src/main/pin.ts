import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 30_000;

export type PinRecord = { salt: string; hash: string };
export type LockoutState = { failedAttempts: number; lockedUntil: number };

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function hashPin(pin: string, salt = randomBytes(16).toString('hex')): PinRecord {
  const hash = scryptSync(pin, salt, 32).toString('hex');
  return { salt, hash };
}

export function pinMatches(pin: string, record: PinRecord): boolean {
  const candidate = scryptSync(pin, record.salt, 32);
  const expected = Buffer.from(record.hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export type CheckResult =
  | { ok: true; state: LockoutState }
  | { ok: false; reason: 'wrong'; attemptsLeft: number; state: LockoutState }
  | { ok: false; reason: 'locked'; lockedUntil: number; state: LockoutState };

/** Pure lockout state machine: 5 wrong PINs lock input for 30 seconds. */
export function checkPin(pin: string, record: PinRecord, state: LockoutState, now = Date.now()): CheckResult {
  if (state.lockedUntil > now) return { ok: false, reason: 'locked', lockedUntil: state.lockedUntil, state };
  if (isValidPin(pin) && pinMatches(pin, record)) return { ok: true, state: { failedAttempts: 0, lockedUntil: 0 } };

  const failed = state.failedAttempts + 1;
  if (failed >= MAX_ATTEMPTS) {
    const lockedUntil = now + LOCKOUT_MS;
    return { ok: false, reason: 'locked', lockedUntil, state: { failedAttempts: 0, lockedUntil } };
  }
  return { ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - failed, state: { failedAttempts: failed, lockedUntil: 0 } };
}
