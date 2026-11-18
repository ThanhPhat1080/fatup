import { PHONE_QUERY } from './phone-query';

// `globalThis.window` rather than `window`: this file is also type-checked by the project that has no DOM lib (the unit tests).
const matches = (query: string): boolean => (globalThis as { window?: { matchMedia?: (q: string) => { matches: boolean } } }).window?.matchMedia?.(query).matches ?? false;

/**
 * Whether the Vault gate is a still picture: on a phone (`PHONE_QUERY`, the same definition the lock screen uses; the fire and the bouncing
 * wizard make the gate lag there, and the stylesheet removes them under the same query) and when the user prefers reduced motion. Then a right
 * PIN opens the Vault at once, with no bomb, and going back does not wait for the wizard to finish speaking.
 */
export function stillGate(): boolean {
  return matches(PHONE_QUERY) || matches('(prefers-reduced-motion: reduce)');
}
