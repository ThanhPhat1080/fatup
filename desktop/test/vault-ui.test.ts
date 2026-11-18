/**
 * Pure logic of the Vault setup wizard, the 6-digit gate, recovery and PIN change.
 * Module under test: `desktop/src/renderer/src/lib/vault.ts` (no React, no DOM).
 *
 * Exports pinned here:
 * 1. pickConfirmGroups(recoveryKey: string, random: () => number): [number, number]
 *      Two DIFFERENT 0-based group indexes of the dash-separated recovery key, sorted ascending.
 * 2. checkConfirmGroups(recoveryKey: string, picks: [number, number], typed: [string, string]): boolean
 *      Case-insensitive, surrounding spaces ignored; false when a group is wrong or empty.
 * 3. nextSetupState(state, event): the setup wizard reducer. State is `{ step, error?, recoveryKey?, ... }`.
 *      Steps: 'intro' -> 'pin' -> 'pinAgain' -> 'recovery' -> 'confirm' -> 'migrating' -> 'done'.
 *      Events: { type: 'start' }, { type: 'pin', pin }, { type: 'pinAgain', pin },
 *              { type: 'setupResult', result }, { type: 'confirmed' }, { type: 'migrationDone' }.
 * 4. gateMessage(result: VaultUnlockResult, now: number): { key: string; args?: object; goRecover?: true }
 *      Maps a `vaultUnlock` result to an i18n key (args are the object the key's function takes).
 * 5. vaultLockSecondsLeft(lockedUntil: number, now: number): number   (never negative)
 * 6. i18n: every key used above and every setup/recovery/change-PIN string exists in
 *    `dictionaries.en` and `dictionaries.vi`, non-empty; functions work in both languages.
 * 7. isEncrypting(item): boolean. True for `inVault && !encrypted` (legacy Vault item still shown with the encrypting badge).
 * 8. vaultTrashSort(items): items with `deletedAt` set, newest deletion first, ties by id descending.
 * 9. vaultTrashLayout(viewportWidth: number): 'sidebar' | 'overlay'. 'sidebar' above 720 px, 'overlay' at 720 and below.
 * 10. undoVaultDelete(ids: string[]): { op: 'restore'; id: string }[]. One restore per id; no move call.
 * 11. canMoveOut(item): boolean. False for an unreadable item and for an item still encrypting; true for other Vault items.
 * 12. i18n for the Vault mode and Vault trash (en + vi, see the last describe block).
 * 13. Two-step setup (spec 4.7b I1): nextSetupState gains steps 'committing' and the event
 *      { type: 'commitResult', result: { ok: true } | { ok: false, error } } (answer of vaultSetupCommit).
 * 14. vaultMoveInPlan(status: 'none' | 'ready' | 'wiped', open: boolean): 'setup' | 'move' | 'unlock' | 'recover'
 *      (spec 4.7b I2, changed by 4.7d: 'none' and closed -> 'setup', the setup wizard opens first, the files move after it).
 * 14b. vaultItemState(item): 'pending' | 'encrypted' | 'unreadable' | 'plain' (spec 4.7d). 'pending' = `inVault && !encrypted` (the faded cloud),
 *      'encrypted' = `inVault && encrypted` (the green tick), 'unreadable' = `item.unreadable` (wins over 'encrypted': an unreadable item is
 *      an encrypted one that cannot be opened), 'plain' = anything else (not in the Vault). i18n keys `vaultStatePending`, `vaultStateEncrypted`.
 * 14c. moveFailedMessageKey(failed: number): 'vaultMoveFailed' | null (plan 2026-11-18-vault-session-6h, decision 6). null when nothing failed,
 *      otherwise the i18n key `vaultMoveFailed`, a function of `{ n }` in en and vi (the item stays in the Vault as a faded cloud and is encrypted again).
 * 15. Vault error strings (spec 4.7b I4): `err_<code>` in en and vi, read by errorText(dict, code).
 */
import { describe, expect, it } from 'vitest';
import type { Item } from '../src/shared-ipc';
import { dictionaries, errorText } from '../src/renderer/src/lib/i18n';

const lib = () => import('../src/renderer/src/lib/vault');

// 27 symbols (26 base32 + checksum) in 7 groups, as `newRecoveryKey()` prints them.
const RK = 'K7Q2-3MWA-9HZT-R4XN-8VBD-F6YP-CE5';
const NOW = Date.UTC(2026, 10, 17, 9, 0, 0);

type Step = Record<string, unknown>;

async function step(state: Step, event: Record<string, unknown>): Promise<Step> {
  const { nextSetupState } = await lib();
  return nextSetupState(state, event);
}

/** Runs the wizard from the start up to the moment the server answers with `result`. */
async function atSetupResult(result: Record<string, unknown>): Promise<Step> {
  let s = await step({ step: 'intro' }, { type: 'start' });
  s = await step(s, { type: 'pin', pin: '135792' });
  s = await step(s, { type: 'pinAgain', pin: '135792' });
  return step(s, { type: 'setupResult', result });
}

describe('pickConfirmGroups', () => {
  it('picks two different group indexes, sorted, inside a 7-group key', async () => {
    const { pickConfirmGroups } = await lib();
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 200; i++) {
      const [a, b] = pickConfirmGroups(RK, random);
      expect(Number.isInteger(a) && Number.isInteger(b)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(6);
      expect(a).toBeLessThan(b);
    }
  });

  it('still returns two different indexes when random is degenerate', async () => {
    const { pickConfirmGroups } = await lib();
    for (const value of [0, 0.999999]) {
      const [a, b] = pickConfirmGroups(RK, () => value);
      expect(a).not.toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(6);
      expect(a).toBeLessThan(b);
    }
  });

  it('chooses with the injected random, not a fixed pair', async () => {
    const { pickConfirmGroups } = await lib();
    expect(pickConfirmGroups(RK, () => 0)).not.toEqual(pickConfirmGroups(RK, () => 0.9999));
  });
});

describe('checkConfirmGroups', () => {
  // Group 1 is '3MWA', group 4 is '8VBD'.
  it('accepts the right groups in any letter case, ignoring surrounding spaces', async () => {
    const { checkConfirmGroups } = await lib();
    expect(checkConfirmGroups(RK, [1, 4], ['3MWA', '8VBD'])).toBe(true);
    expect(checkConfirmGroups(RK, [1, 4], ['3mwa', '8vbd'])).toBe(true);
    expect(checkConfirmGroups(RK, [1, 4], [' 3MWA ', '  8vbD'])).toBe(true);
  });

  it('refuses when the first typed group is wrong', async () => {
    const { checkConfirmGroups } = await lib();
    expect(checkConfirmGroups(RK, [1, 4], ['3MWB', '8VBD'])).toBe(false);
  });

  it('refuses when the second typed group is wrong', async () => {
    const { checkConfirmGroups } = await lib();
    expect(checkConfirmGroups(RK, [1, 4], ['3MWA', '8VBX'])).toBe(false);
  });

  it('refuses an empty or blank group', async () => {
    const { checkConfirmGroups } = await lib();
    expect(checkConfirmGroups(RK, [1, 4], ['', '8VBD'])).toBe(false);
    expect(checkConfirmGroups(RK, [1, 4], ['3MWA', '   '])).toBe(false);
  });

  it('refuses a correct group typed in the place of another picked group', async () => {
    const { checkConfirmGroups } = await lib();
    // '8VBD' is a real group of the key, but not the one picked at position 0.
    expect(checkConfirmGroups(RK, [1, 4], ['8VBD', '3MWA'])).toBe(false);
  });
});

describe('nextSetupState', () => {
  it('moves from the intro to the first PIN step on start', async () => {
    expect((await step({ step: 'intro' }, { type: 'start' })).step).toBe('pin');
  });

  it('accepts a 6-digit PIN and asks for it again', async () => {
    const s = await step({ step: 'pin' }, { type: 'pin', pin: '135792' });
    expect(s.step).toBe('pinAgain');
    expect(s.error).toBeUndefined();
  });

  it('refuses a PIN with non-digits or the wrong length at the pin step', async () => {
    const pinStep = { step: 'pin' };
    for (const pin of ['12a456', '12345', '1234567', '', '12 456']) {
      const s = await step(pinStep, { type: 'pin', pin });
      expect(s.step, `pin ${JSON.stringify(pin)}`).toBe('pin');
      expect(s.error, `pin ${JSON.stringify(pin)}`).toBe('pin_format');
    }
  });

  it('moves on without error when the repeated PIN matches', async () => {
    let s = await step({ step: 'pin' }, { type: 'pin', pin: '135792' });
    s = await step(s, { type: 'pinAgain', pin: '135792' });
    expect(s.step).not.toBe('pin');
    expect(s.error).toBeUndefined();
  });

  it('goes back to the first PIN step with pin_mismatch when the repeated PIN differs', async () => {
    let s = await step({ step: 'pin' }, { type: 'pin', pin: '135792' });
    s = await step(s, { type: 'pinAgain', pin: '246813' });
    expect(s.step).toBe('pin');
    expect(s.error).toBe('pin_mismatch');
  });

  it('shows weak_pin at once by going back to the PIN step with that error', async () => {
    const s = await atSetupResult({ ok: false, error: 'weak_pin' });
    expect(s.step).toBe('pin');
    expect(s.error).toBe('weak_pin');
  });

  it('shows matches_app_pin at once by going back to the PIN step with that error', async () => {
    const s = await atSetupResult({ ok: false, error: 'matches_app_pin' });
    expect(s.step).toBe('pin');
    expect(s.error).toBe('matches_app_pin');
  });

  it('keeps the current step and shows any other setup error', async () => {
    const before = await step({ step: 'pin' }, { type: 'pin', pin: '135792' });
    const pinAgain = await step(before, { type: 'pinAgain', pin: '135792' });
    const s = await step(pinAgain, { type: 'setupResult', result: { ok: false, error: 'network' } });
    expect(s.step).toBe(pinAgain.step);
    expect(s.error).toBe('network');
  });

  it('shows the recovery key once a setup succeeds', async () => {
    const s = await atSetupResult({ ok: true, recoveryKey: RK });
    expect(s.step).toBe('recovery');
    expect(s.recoveryKey).toBe(RK);
  });

  it('moves from confirm to migrating when the user has confirmed the recovery key', async () => {
    // The event that moves 'recovery' to 'confirm' is not part of the spec; start from 'confirm'.
    const s = await step({ step: 'confirm', recoveryKey: RK }, { type: 'confirmed' });
    expect(s.step).toBe('migrating');
  });

  it('moves from migrating to done when the old files are converted', async () => {
    const s = await step({ step: 'migrating', recoveryKey: RK }, { type: 'migrationDone' });
    expect(s.step).toBe('done');
  });

  it('forgets the recovery key once the wizard is done', async () => {
    let s = await atSetupResult({ ok: true, recoveryKey: RK });
    s = { ...s, step: 'confirm' };
    s = await step(s, { type: 'confirmed' });
    s = await step(s, { type: 'migrationDone' });
    expect(s.step).toBe('done');
    expect(s.recoveryKey).toBeUndefined();
  });

  it('clears the previous error when a valid PIN is entered again', async () => {
    let s = await step({ step: 'pin' }, { type: 'pin', pin: '12a456' });
    expect(s.error).toBe('pin_format');
    s = await step(s, { type: 'pin', pin: '135792' });
    expect(s.step).toBe('pinAgain');
    expect(s.error).toBeUndefined();
  });
});

/**
 * Two-step setup (spec 4.7b I1). Contract of the wizard:
 * - A repeated PIN that matches keeps the step at 'pinAgain' with no error. The reducer never calls the server:
 *   the renderer then calls vaultSetupPrepare(pin) and feeds its answer back as setupResult.
 * - setupResult ok → 'recovery' (recoveryKey, picks). saved → 'confirm'.
 * - confirmGroups with the right groups → 'committing': the renderer calls vaultSetupCommit. The recovery key and picks
 *   are kept there, so a failed commit can be retried. Wrong groups → stay on 'confirm' with error 'confirm_wrong'.
 * - commitResult ok → 'migrating', no recovery key.
 *   commitResult closed | no_prepared_setup | vault_exists → 'intro', recovery key dropped, error set to that code.
 *   commitResult with any other error (e.g. 'network') → 'confirm' with that error, recovery key KEPT.
 * - The recovery key is absent from the state in 'intro', 'migrating' and 'done'.
 */
describe('nextSetupState: two-step setup (spec 4.7b I1)', () => {
  it('walks intro → pin → pinAgain → recovery → confirm → committing → migrating → done', async () => {
    const random = () => 0;
    let s = await step({ step: 'intro' }, { type: 'start' });
    s = await step(s, { type: 'pin', pin: '135792' });
    s = await step(s, { type: 'pinAgain', pin: '135792' });
    expect(s.step, 'a matching repeat does not reach the server, so the step stays pinAgain').toBe('pinAgain');
    s = await step(s, { type: 'setupResult', result: { ok: true, recoveryKey: RK }, random });
    expect(s.step).toBe('recovery');
    s = await step(s, { type: 'saved' });
    expect(s.step).toBe('confirm');
    const picks = s.picks as [number, number];
    const groups = RK.split('-');
    s = await step(s, { type: 'confirmGroups', typed: [groups[picks[0]], groups[picks[1]]] });
    expect(s.step).toBe('committing');
    expect(s.recoveryKey).toBe(RK);
    s = await step(s, { type: 'commitResult', result: { ok: true } });
    expect(s.step).toBe('migrating');
    expect(s.recoveryKey).toBeUndefined();
    s = await step(s, { type: 'migrationDone' });
    expect(s.step).toBe('done');
    expect(s.recoveryKey).toBeUndefined();
  });

  it('stays on confirm with confirm_wrong when the typed groups are wrong, and keeps the key', async () => {
    const s = await step({ step: 'confirm', recoveryKey: RK, picks: [1, 4] }, { type: 'confirmGroups', typed: ['0000', '0000'] });
    expect(s.step).toBe('confirm');
    expect(s.error).toBe('confirm_wrong');
    expect(s.recoveryKey).toBe(RK);
  });

  it('moves to committing when the typed groups are right, keeping the key and picks for a retry', async () => {
    const s = await step({ step: 'confirm', recoveryKey: RK, picks: [1, 4] }, { type: 'confirmGroups', typed: ['3MWA', '8VBD'] });
    expect(s.step).toBe('committing');
    expect(s.recoveryKey).toBe(RK);
    expect(s.picks).toEqual([1, 4]);
    expect(s.error).toBeUndefined();
  });

  it('moves from committing to migrating on a committed setup, and drops the recovery key', async () => {
    const s = await step({ step: 'committing', recoveryKey: RK, picks: [1, 4] }, { type: 'commitResult', result: { ok: true } });
    expect(s.step).toBe('migrating');
    expect(s.recoveryKey).toBeUndefined();
    expect(s.picks).toBeUndefined();
    expect(s.error).toBeUndefined();
  });

  for (const error of ['closed', 'no_prepared_setup', 'vault_exists']) {
    it(`goes back to intro with ${error}, drops the recovery key and shows the error`, async () => {
      const s = await step({ step: 'committing', recoveryKey: RK, picks: [1, 4] }, { type: 'commitResult', result: { ok: false, error } });
      expect(s.step).toBe('intro');
      expect(s.error).toBe(error);
      expect(s.recoveryKey).toBeUndefined();
    });
  }

  it('keeps the recovery key on confirm for any other commit error, so the user can retry', async () => {
    const s = await step({ step: 'committing', recoveryKey: RK, picks: [1, 4] }, { type: 'commitResult', result: { ok: false, error: 'network' } });
    expect(s.step).toBe('confirm');
    expect(s.error).toBe('network');
    expect(s.recoveryKey).toBe(RK);
    expect(s.picks).toEqual([1, 4]);
  });
});

/**
 * Moving a file into the Vault from the main list (spec 4.7b I2). Contract of vaultMoveInPlan(status, open):
 * - 'move' when the Vault is open, whatever its status; or when status is 'none' (legacy path, nothing to unlock).
 * - 'unlock' when status is 'ready' and the Vault is closed: the 6-digit gate comes first.
 * - 'recover' when status is 'wiped' and the Vault is closed: the recovery screen comes first.
 */
describe('vaultMoveInPlan: moving into the Vault from the main list (spec 4.7b I2)', () => {
  it('moves at once when the Vault is open, whatever its status', async () => {
    const { vaultMoveInPlan } = await lib();
    for (const status of ['none', 'ready', 'wiped'] as const) {
      expect(vaultMoveInPlan(status, true), `status ${status}, open`).toBe('move');
    }
  });

  it('opens the setup wizard first when no Vault is set up (spec 4.7d: setup first, then the files move; no legacy plain move)', async () => {
    const { vaultMoveInPlan } = await lib();
    expect(vaultMoveInPlan('none', false)).toBe('setup');
  });

  it('keeps `none` + open defined as move (it cannot happen, an open Vault exists)', async () => {
    const { vaultMoveInPlan } = await lib();
    expect(vaultMoveInPlan('none', true)).toBe('move');
  });

  it('asks for the PIN gate first when the Vault is ready and closed', async () => {
    const { vaultMoveInPlan } = await lib();
    expect(vaultMoveInPlan('ready', false)).toBe('unlock');
  });

  it('sends a wiped and closed Vault to the recovery screen first', async () => {
    const { vaultMoveInPlan } = await lib();
    expect(vaultMoveInPlan('wiped', false)).toBe('recover');
  });
});

/**
 * Vault error strings (spec 4.7b I4). Contract: each new error code has its own text in both languages under the key
 * `err_<code>`, which `errorText(dict, code)` reads. A code without a text of its own falls back to `err_generic`.
 */
describe('vault error strings (spec 4.7b I4)', () => {
  const NEW_KEYS = [
    'err_vault_locked',
    'err_vault_busy',
    'err_item_changed',
    'err_app_outdated',
    'err_vault_not_ready',
    'err_encrypted',
    'err_unreadable',
    'err_closed',
    'err_no_prepared_setup',
    'err_vault_wiped',
    'vaultUnlockToMove',
  ];
  const CODES = [
    'vault_locked',
    'vault_busy',
    'item_changed',
    'app_outdated',
    'vault_not_ready',
    'encrypted',
    'unreadable',
    'closed',
    'no_prepared_setup',
    'vault_wiped',
  ];
  const en = dictionaries.en as Record<string, unknown>;
  const vi = dictionaries.vi as Record<string, unknown>;

  it('has every new key, non-empty, in both English and Vietnamese', () => {
    for (const key of NEW_KEYS) {
      for (const [lang, dict] of [
        ['en', en],
        ['vi', vi],
      ] as const) {
        const value = dict[key];
        expect(typeof value === 'string' && value.trim().length > 0, `${lang}.${key} is a non-empty string`).toBe(true);
      }
    }
  });

  it('shows the matching text for each new code, not the generic one, in both languages', () => {
    for (const code of CODES) {
      for (const [lang, dict] of [
        ['en', dictionaries.en],
        ['vi', dictionaries.vi],
      ] as const) {
        const own = (dict as Record<string, unknown>)[`err_${code}`];
        expect(typeof own, `${lang}.err_${code} exists`).toBe('string');
        const text = errorText(dict, code);
        expect(text, `${lang} errorText(${code})`).toBe(own);
        expect(text, `${lang} err_${code} is not the generic text`).not.toBe(dict.err_generic);
      }
    }
  });

  it('falls back to the generic text for a code without a text of its own', () => {
    expect(errorText(dictionaries.en, 'no_such_code_for_vault')).toBe(dictionaries.en.err_generic);
    expect(errorText(dictionaries.vi, 'no_such_code_for_vault')).toBe(dictionaries.vi.err_generic);
  });

  it('tells the user to update the app for app_outdated, in both languages', () => {
    expect(errorText(dictionaries.en, 'app_outdated')).toMatch(/update/i);
    expect(errorText(dictionaries.vi, 'app_outdated')).toMatch(/cập nhật/i);
  });

  it('names the Vault PIN in the move-into-Vault hint, in both languages', () => {
    expect(String(en.vaultUnlockToMove)).toMatch(/PIN/);
    expect(String(vi.vaultUnlockToMove)).toMatch(/PIN/);
  });
});

describe('gateMessage', () => {
  it('shows how many wrong PIN attempts are left', async () => {
    const { gateMessage } = await lib();
    expect(gateMessage({ ok: false, reason: 'wrong', remaining: 4 }, NOW)).toEqual({
      key: 'vaultWrongPin',
      args: { remaining: 4 },
    });
  });

  it('counts the lock down in whole seconds, rounding up', async () => {
    const { gateMessage } = await lib();
    expect(gateMessage({ ok: false, reason: 'locked', lockedUntil: NOW + 60_000 }, NOW)).toEqual({
      key: 'vaultLockedFor',
      args: { seconds: 60 },
    });
    expect(gateMessage({ ok: false, reason: 'locked', lockedUntil: NOW + 60_001 }, NOW)).toEqual({
      key: 'vaultLockedFor',
      args: { seconds: 61 },
    });
    expect(gateMessage({ ok: false, reason: 'locked', lockedUntil: NOW + 1 }, NOW)).toEqual({
      key: 'vaultLockedFor',
      args: { seconds: 1 },
    });
  });

  it('never shows a negative lock time when the lock has already ended', async () => {
    const { gateMessage } = await lib();
    const msg = gateMessage({ ok: false, reason: 'locked', lockedUntil: NOW - 5_000 }, NOW);
    expect(msg.key).toBe('vaultLockedFor');
    expect((msg.args as { seconds: number }).seconds).toBe(0);
  });

  it('sends a wiped vault to the recovery screen', async () => {
    const { gateMessage } = await lib();
    expect(gateMessage({ ok: false, reason: 'wiped' }, NOW)).toEqual({ key: 'vaultWiped', goRecover: true });
  });

  it('reports a vault that is not set up yet', async () => {
    const { gateMessage } = await lib();
    expect(gateMessage({ ok: false, reason: 'not_ready' }, NOW)).toEqual({ key: 'vaultNotReady' });
  });

  it('falls back to the generic error text for an error result', async () => {
    const { gateMessage } = await lib();
    expect(gateMessage({ ok: false, reason: 'error', error: 'network' }, NOW)).toEqual({ key: 'err_generic' });
  });
});

describe('vaultLockSecondsLeft', () => {
  it('is never negative', async () => {
    const { vaultLockSecondsLeft } = await lib();
    expect(vaultLockSecondsLeft(NOW - 10_000, NOW)).toBe(0);
    expect(vaultLockSecondsLeft(NOW, NOW)).toBe(0);
    expect(vaultLockSecondsLeft(NOW + 90_000, NOW)).toBe(90);
  });
});

describe('vault UI strings', () => {
  const LISTED = [
    'vaultSetupTitle',
    'vaultSetupIntro',
    'vaultPinPrompt',
    'vaultPinAgain',
    'vaultPinMismatch',
    'vaultWeakPin',
    'vaultMatchesAppPin',
    'vaultRecoveryTitle',
    'vaultRecoveryWarn',
    'vaultRecoveryCopy',
    'vaultRecoveryConfirm',
    'vaultRecoveryWrong',
    'vaultMigrating',
    'vaultRecoverTitle',
    'vaultRecoverPrompt',
    'vaultBadRecoveryKey',
    'vaultChangePin',
    'vaultChangePinOld',
    'vaultChangePinUseRecovery',
    // used by gateMessage
    'vaultWiped',
    'vaultNotReady',
    'err_generic',
  ];
  const FUNCTIONS = ['vaultWrongPin', 'vaultLockedFor'];
  const en = dictionaries.en as Record<string, unknown>;
  const vi = dictionaries.vi as Record<string, unknown>;

  it('has every listed string, non-empty, in both English and Vietnamese', () => {
    for (const key of LISTED) {
      for (const [lang, dict] of [
        ['en', en],
        ['vi', vi],
      ] as const) {
        const value = dict[key];
        expect(value, `${lang}.${key}`).toBeDefined();
        expect(typeof value === 'string' && value.trim().length > 0, `${lang}.${key} is a non-empty string`).toBe(true);
      }
    }
  });

  it('has the argument-taking gate strings in both languages', () => {
    for (const key of FUNCTIONS) {
      expect(typeof en[key], `en.${key}`).toBe('function');
      expect(typeof vi[key], `vi.${key}`).toBe('function');
    }
  });

  it('shows the remaining PIN attempts in both languages', () => {
    const wrongEn = (en.vaultWrongPin as (a: { remaining: number }) => string)({ remaining: 3 });
    const wrongVi = (vi.vaultWrongPin as (a: { remaining: number }) => string)({ remaining: 3 });
    expect(wrongEn).toContain('3');
    expect(wrongVi).toContain('3');
    expect(wrongEn).not.toBe(wrongVi);
  });

  it('shows the lock countdown from its argument in both languages', () => {
    for (const dict of [en, vi]) {
      const fn = dict.vaultLockedFor as (a: { seconds: number }) => string;
      const short = fn({ seconds: 5 });
      const long = fn({ seconds: 300 });
      expect(typeof short).toBe('string');
      expect(short.trim().length).toBeGreaterThan(0);
      expect(short).not.toBe(long);
    }
  });
});

/** An item with only the fields the Vault rules look at; the rest of `Item` is irrelevant here. */
const row = (over: Record<string, unknown>) => ({ id: 'X', inVault: false, encrypted: false, deletedAt: null, unreadable: false, ...over }) as unknown as Item;

describe('isEncrypting: legacy Vault items still shown in plain text', () => {
  it('is true for a Vault item that is not encrypted yet', async () => {
    const { isEncrypting } = await lib();
    expect(isEncrypting(row({ inVault: true, encrypted: false }))).toBe(true);
  });

  it('is false for a Vault item that is already encrypted', async () => {
    const { isEncrypting } = await lib();
    expect(isEncrypting(row({ inVault: true, encrypted: true }))).toBe(false);
  });

  it('is false for an item outside the Vault, whether or not it is marked encrypted', async () => {
    const { isEncrypting } = await lib();
    expect(isEncrypting(row({ inVault: false, encrypted: false }))).toBe(false);
    expect(isEncrypting(row({ inVault: false, encrypted: true }))).toBe(false);
  });
});

describe('vaultItemState: pending (faded cloud), encrypted (green tick), unreadable, plain (spec 4.7d)', () => {
  it('is pending for an item in the Vault that is not encrypted yet (put in by vault/in, not finished)', async () => {
    const { vaultItemState } = await lib();
    expect(vaultItemState(row({ inVault: true, encrypted: false }))).toBe('pending');
  });

  it('is pending for such an item in the Vault trash too', async () => {
    const { vaultItemState } = await lib();
    expect(vaultItemState(row({ inVault: true, encrypted: false, deletedAt: 5 }))).toBe('pending');
  });

  it('is encrypted for an item in the Vault that is encrypted', async () => {
    const { vaultItemState } = await lib();
    expect(vaultItemState(row({ inVault: true, encrypted: true }))).toBe('encrypted');
  });

  it('is unreadable for an item that cannot be decrypted, before it is called encrypted', async () => {
    const { vaultItemState } = await lib();
    expect(vaultItemState(row({ inVault: true, encrypted: true, unreadable: true }))).toBe('unreadable');
  });

  it('is plain for an item outside the Vault, encrypted flag or not', async () => {
    const { vaultItemState } = await lib();
    expect(vaultItemState(row({ inVault: false, encrypted: false }))).toBe('plain');
    expect(vaultItemState(row({ inVault: false, encrypted: true }))).toBe('plain');
  });

  it('agrees with isEncrypting: pending exactly when the item is still encrypting', async () => {
    const { vaultItemState, isEncrypting } = await lib();
    for (const inVault of [true, false]) {
      for (const encrypted of [true, false]) {
        const it = row({ inVault, encrypted });
        expect(vaultItemState(it) === 'pending', `inVault ${inVault}, encrypted ${encrypted}`).toBe(isEncrypting(it));
      }
    }
  });

  it('has a text for the pending and the encrypted state in both languages', () => {
    for (const [lang, dict] of [['en', dictionaries.en], ['vi', dictionaries.vi]] as const) {
      for (const key of ['vaultStatePending', 'vaultStateEncrypted']) {
        const value = (dict as Record<string, unknown>)[key];
        expect(typeof value === 'string' && value.trim().length > 0, `${lang}.${key} is a non-empty string`).toBe(true);
      }
    }
    const text = (dict: unknown) => (dict as Record<string, unknown>).vaultStatePending;
    expect(text(dictionaries.vi)).not.toBe(text(dictionaries.en));
  });
});

describe('vaultTrashSort: the Vault trash list', () => {
  it('keeps only trashed items, most recently deleted first', async () => {
    const { vaultTrashSort } = await lib();
    const items = [
      row({ id: 'a', deletedAt: 100 }),
      row({ id: 'b', deletedAt: null }),
      row({ id: 'c', deletedAt: 300 }),
      row({ id: 'd', deletedAt: 200 }),
    ];
    expect(vaultTrashSort(items).map((i: Item) => i.id)).toEqual(['c', 'd', 'a']);
  });

  it('breaks ties on the same deletion time by id, descending', async () => {
    const { vaultTrashSort } = await lib();
    const items = [row({ id: 'm', deletedAt: 100 }), row({ id: 'a', deletedAt: 100 }), row({ id: 'z', deletedAt: 100 })];
    expect(vaultTrashSort(items).map((i: Item) => i.id)).toEqual(['z', 'm', 'a']);
  });

  it('gives an empty list when nothing in the Vault is in the trash', async () => {
    const { vaultTrashSort } = await lib();
    expect(vaultTrashSort([])).toEqual([]);
    expect(vaultTrashSort([row({ id: 'live', deletedAt: null })])).toEqual([]);
  });

  it('does not change the order of the list it was given', async () => {
    const { vaultTrashSort } = await lib();
    const items = [row({ id: 'a', deletedAt: 100 }), row({ id: 'b', deletedAt: 300 })];
    vaultTrashSort(items);
    expect(items.map((i: Item) => i.id)).toEqual(['a', 'b']);
  });
});

describe('vaultTrashLayout: sidebar or full-screen overlay', () => {
  it('uses the 70% sidebar above 720 px', async () => {
    const { vaultTrashLayout } = await lib();
    expect(vaultTrashLayout(721)).toBe('sidebar');
    expect(vaultTrashLayout(1280)).toBe('sidebar');
  });

  it('uses the full-screen overlay at 720 px and below', async () => {
    const { vaultTrashLayout } = await lib();
    expect(vaultTrashLayout(720)).toBe('overlay');
    expect(vaultTrashLayout(400)).toBe('overlay');
  });
});

describe('undoVaultDelete: undoing a delete inside the Vault', () => {
  it('asks for one restore per id, in order, and never a move out of the Vault', async () => {
    const { undoVaultDelete } = await lib();
    expect(undoVaultDelete(['a', 'b'])).toEqual([
      { op: 'restore', id: 'a' },
      { op: 'restore', id: 'b' },
    ]);
  });

  it('asks for nothing when there is nothing to undo', async () => {
    const { undoVaultDelete } = await lib();
    expect(undoVaultDelete([])).toEqual([]);
  });
});

describe('canMoveOut: which Vault items may leave the Vault', () => {
  it('refuses an unreadable item', async () => {
    const { canMoveOut } = await lib();
    expect(canMoveOut(row({ inVault: true, encrypted: true, unreadable: true }))).toBe(false);
  });

  it('refuses an item that is still being encrypted', async () => {
    const { canMoveOut } = await lib();
    expect(canMoveOut(row({ inVault: true, encrypted: false }))).toBe(false);
  });

  it('allows a readable, encrypted item in the Vault', async () => {
    const { canMoveOut } = await lib();
    expect(canMoveOut(row({ inVault: true, encrypted: true, unreadable: false }))).toBe(true);
  });
});

describe('vault mode and trash strings', () => {
  const LISTED = [
    'vaultEncryptedBadge',
    'vaultEncrypting',
    'vaultTrashTitle',
    'vaultTrashSubtitle',
    'vaultTrashOpen',
    'vaultTrashEmpty',
    'vaultTrashRestore',
    'vaultTrashDeleteForever',
    'vaultTrashEmptyAll',
    'vaultTrashConfirmEmpty',
    'vaultUnreadable',
  ];
  const FUNCTIONS = ['vaultMoving', 'movedOutOfVaultFailed'];
  const en = dictionaries.en as Record<string, unknown>;
  const vi = dictionaries.vi as Record<string, unknown>;

  it('has every listed string, non-empty, in both English and Vietnamese', () => {
    for (const key of LISTED) {
      for (const [lang, dict] of [
        ['en', en],
        ['vi', vi],
      ] as const) {
        const value = dict[key];
        expect(typeof value === 'string' && value.trim().length > 0, `${lang}.${key} is a non-empty string`).toBe(true);
      }
    }
  });

  it('has the two argument-taking strings in both languages', () => {
    for (const key of FUNCTIONS) {
      expect(typeof en[key], `en.${key}`).toBe('function');
      expect(typeof vi[key], `vi.${key}`).toBe('function');
    }
  });

  it('marks an encrypted Vault as "lock · encrypted" with the lock icon in both languages', () => {
    expect(String(en.vaultEncryptedBadge)).toContain('🔒');
    expect(String(vi.vaultEncryptedBadge)).toContain('🔒');
    expect(String(en.vaultEncryptedBadge).toLowerCase()).toContain('encrypt');
    expect(String(vi.vaultEncryptedBadge)).toContain('Két sắt');
    expect(String(vi.vaultEncryptedBadge)).toContain('đã mã hóa');
  });

  it('labels a legacy item as being encrypted, in Vietnamese with "đang mã hóa"', () => {
    expect(String(vi.vaultEncrypting)).toContain('đang mã hóa');
    expect(String(en.vaultEncrypting).toLowerCase()).toContain('encrypt');
  });

  it('titles the trash of the Vault exactly as the design says in Vietnamese', () => {
    expect(vi.vaultTrashTitle).toBe('Thùng rác của Két sắt');
  });

  it('says the Vault trash keeps files for 30 days, in both languages', () => {
    expect(String(en.vaultTrashSubtitle)).toContain('30');
    expect(String(vi.vaultTrashSubtitle)).toContain('30');
  });

  it('shows the count of moved files from its arguments in both languages', () => {
    for (const dict of [en, vi]) {
      const fn = dict.vaultMoving as (a: { done: number; total: number }) => string;
      const text = fn({ done: 2, total: 5 });
      expect(typeof text).toBe('string');
      expect(text).toContain('2');
      expect(text).toContain('5');
      expect(fn({ done: 4, total: 9 })).not.toBe(text);
    }
  });

  it('shows the count of failed files from its argument in both languages', () => {
    for (const dict of [en, vi]) {
      const fn = dict.movedOutOfVaultFailed as (a: { n: number }) => string;
      const text = fn({ n: 3 });
      expect(typeof text).toBe('string');
      expect(text).toContain('3');
      expect(fn({ n: 7 })).not.toBe(text);
    }
  });
});

describe('moveFailedMessageKey: what to say when some files could not be moved into the Vault (plan 2026-11-18-vault-session-6h, decision 6)', () => {
  it('says nothing when no file failed', async () => {
    const { moveFailedMessageKey } = await lib();
    expect(moveFailedMessageKey(0)).toBeNull();
  });

  it.each([1, 2, 17])('uses the vaultMoveFailed message when %i file(s) failed', async (n) => {
    const { moveFailedMessageKey } = await lib();
    expect(moveFailedMessageKey(n)).toBe('vaultMoveFailed');
  });

  it('keeps vaultMoveInPlan answering "move" for an open Vault, whatever its status (an open session moves at once, no PIN)', async () => {
    const { vaultMoveInPlan } = await lib();
    for (const status of ['none', 'ready', 'wiped'] as const) expect(vaultMoveInPlan(status, true)).toBe('move');
  });

  it('has vaultMoveFailed in both languages as a function of { n } that shows the count and explains the item is still in the Vault', () => {
    for (const [lang, dict] of [
      ['en', dictionaries.en as Record<string, unknown>],
      ['vi', dictionaries.vi as Record<string, unknown>],
    ] as const) {
      const fn = dict.vaultMoveFailed as (a: { n: number }) => string;
      expect(typeof fn, `${lang}.vaultMoveFailed`).toBe('function');
      const text = fn({ n: 3 });
      expect(text, lang).toContain('3');
      expect(text.trim().length, lang).toBeGreaterThan(10);
      expect(fn({ n: 8 }), lang).not.toBe(text);
    }
    const say = (dict: unknown) => (dict as Record<string, (a: { n: number }) => string>).vaultMoveFailed?.({ n: 3 });
    expect(say(dictionaries.en)).not.toBe(say(dictionaries.vi));
  });
});
