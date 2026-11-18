import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_QUERY } from '../src/renderer/src/lib/phone-query';
import { stillGate } from '../src/renderer/src/lib/motion';

/** A window whose matchMedia says yes to exactly the queries listed. */
function windowMatching(...yes: string[]) {
  vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: yes.includes(q) }) });
}

afterEach(() => vi.unstubAllGlobals());

describe('stillGate', () => {
  it('uses the phone definition the lock screen already has: a narrow window, or a touch screen turned on its side', () => {
    expect(PHONE_QUERY).toContain('(max-width: 720px)');
    expect(PHONE_QUERY).toContain('(max-height: 520px) and (pointer: coarse)');
  });

  it('is true on a phone: the right PIN opens the Vault at once, with no bomb and no waiting', () => {
    windowMatching(PHONE_QUERY);
    expect(stillGate()).toBe(true);
  });

  it('is true when the user prefers reduced motion', () => {
    windowMatching('(prefers-reduced-motion: reduce)');
    expect(stillGate()).toBe(true);
  });

  it('is false on a desktop window with motion allowed', () => {
    windowMatching();
    expect(stillGate()).toBe(false);
  });

  it('is false when there is no matchMedia at all', () => {
    vi.stubGlobal('window', {});
    expect(stillGate()).toBe(false);
  });
});
