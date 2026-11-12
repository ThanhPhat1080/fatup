import { describe, expect, it } from 'vitest';
import { LOCKOUT_MS, MAX_ATTEMPTS, nextAttempt, open, seal } from './vault';

describe('vault', () => {
  it('opens with the right PIN and rejects a wrong one', async () => {
    const sealed = await seal('secret-token', '1234');
    expect(await open(sealed, '1234')).toBe('secret-token');
    expect(await open(sealed, '1235')).toBeNull();
  });
});

describe('nextAttempt', () => {
  const fresh = { failedAttempts: 0, lockedUntil: 0 };
  it('counts down then locks for 30s', () => {
    let state = fresh;
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const r = nextAttempt(false, state, 1000);
      expect(r).toMatchObject({ ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - i });
      state = r.state;
    }
    const locked = nextAttempt(false, state, 1000);
    expect(locked).toMatchObject({ ok: false, reason: 'locked', lockedUntil: 1000 + LOCKOUT_MS });
    expect(nextAttempt(true, locked.state, 2000)).toMatchObject({ ok: false, reason: 'locked' });
    expect(nextAttempt(true, locked.state, 1000 + LOCKOUT_MS + 1).ok).toBe(true);
  });
});
