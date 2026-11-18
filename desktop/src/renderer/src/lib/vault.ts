/**
 * Pure decision logic of the Vault UI: the setup wizard, the 6-digit gate, recovery and PIN change.
 * No React, no DOM: components call these and only render the result, so the logic is unit-tested (test/vault-ui.test.ts).
 */
import type { Item, VaultPinRefusal, VaultSetupCommitResult, VaultUnlockResult } from '../../../shared-ipc';

export const VAULT_PIN_LENGTH = 6;

/** Whether `pin` is exactly six ASCII digits. The server still decides weak PINs and PINs equal to the app PIN. */
export function isVaultPinFormat(pin: string): boolean {
  return new RegExp(`^[0-9]{${VAULT_PIN_LENGTH}}$`).test(pin);
}

/** Two different 0-based group indexes of a dash-separated recovery key, sorted ascending. */
export function pickConfirmGroups(recoveryKey: string, random: () => number): [number, number] {
  const count = recoveryKey.split('-').length;
  const pick = (max: number) => Math.min(max - 1, Math.max(0, Math.floor(random() * max)));
  const a = pick(count);
  let b = pick(count - 1);
  if (b >= a) b += 1; // skip `a`, so the two indexes always differ
  return a < b ? [a, b] : [b, a];
}

/** Whether the two typed groups match the picked groups of the key. Case and surrounding spaces are ignored. */
export function checkConfirmGroups(recoveryKey: string, picks: [number, number], typed: [string, string]): boolean {
  const groups = recoveryKey.split('-');
  return picks.every((index, i) => {
    const expected = groups[index];
    const value = typed[i].trim().toUpperCase();
    return expected !== undefined && value !== '' && value === expected.toUpperCase();
  });
}

export type SetupStep = 'intro' | 'pin' | 'pinAgain' | 'recovery' | 'confirm' | 'committing' | 'migrating' | 'done';

/**
 * State of the setup wizard. `pin` is kept only between the first and the repeated PIN and until the prepare call answers;
 * `recoveryKey` and `picks` live from the recovery screen until the commit succeeds (a failed commit can be retried), then are dropped.
 */
export type SetupState = {
  step: SetupStep;
  error?: string;
  pin?: string;
  recoveryKey?: string;
  picks?: [number, number];
};

export type SetupEvent =
  | { type: 'start' }
  | { type: 'pin'; pin: string }
  | { type: 'pinAgain'; pin: string }
  | { type: 'setupResult'; result: { ok: true; recoveryKey: string } | { ok: false; error: string }; random?: () => number }
  | { type: 'saved' }
  | { type: 'confirmGroups'; typed: [string, string] }
  | { type: 'commitResult'; result: VaultSetupCommitResult }
  | { type: 'confirmed' }
  | { type: 'migrationDone' };

/** Commit errors that end the setup: the wizard goes back to the start and the recovery key is dropped. */
const RESTART_ERRORS = new Set(['closed', 'no_prepared_setup', 'vault_exists']);

/** Plain objects are accepted too: the wizard is also driven from untyped input (test/vault-ui.test.ts). The result is always a SetupState. */
type Loose = Record<string, unknown>;

/** Setup errors that send the wizard back to the first PIN step at once. Any other setup error keeps the current step. */
const BACK_TO_PIN_ERRORS = new Set(['weak_pin', 'matches_app_pin']);

/** A copy of `s` without its error. */
function withoutError(s: SetupState): SetupState {
  const next: SetupState = { ...s };
  delete next.error;
  return next;
}

/** The setup wizard reducer. Returns a new state; events that do not apply to the current step change nothing. */
export function nextSetupState(state: SetupState | Loose, event: SetupEvent | Loose): SetupState {
  const s = state as SetupState;
  const e = event as SetupEvent;

  switch (e.type) {
    case 'start':
      return s.step === 'intro' ? { ...withoutError(s), step: 'pin' } : s;

    case 'pin':
      if (s.step !== 'pin') return s;
      if (!isVaultPinFormat(e.pin)) return { ...withoutError(s), error: 'pin_format' };
      return { step: 'pinAgain', pin: e.pin };

    case 'pinAgain':
      if (s.step !== 'pinAgain') return s;
      if (e.pin !== s.pin) return { step: 'pin', error: 'pin_mismatch' };
      return withoutError(s);

    case 'setupResult': {
      if (s.step !== 'pinAgain') return s;
      const { result } = e;
      if (result.ok) {
        const random = e.random ?? Math.random;
        return { step: 'recovery', recoveryKey: result.recoveryKey, picks: pickConfirmGroups(result.recoveryKey, random) };
      }
      if (BACK_TO_PIN_ERRORS.has(result.error)) return { step: 'pin', error: result.error };
      return { ...s, error: result.error };
    }

    case 'saved':
      return s.step === 'recovery' ? { ...withoutError(s), step: 'confirm' } : s;

    case 'confirmGroups': {
      if (s.step !== 'confirm' || !s.recoveryKey || !s.picks) return s;
      // The key and picks stay: the commit is made from 'committing', and a failed commit goes back here with them.
      if (!checkConfirmGroups(s.recoveryKey, s.picks, e.typed)) return { ...s, error: 'confirm_wrong' };
      return { ...withoutError(s), step: 'committing' };
    }

    case 'commitResult': {
      if (s.step !== 'committing') return s;
      const { result } = e;
      if (result.ok) return { step: 'migrating' };
      if (RESTART_ERRORS.has(result.error)) return { step: 'intro', error: result.error };
      return { step: 'confirm', error: result.error, recoveryKey: s.recoveryKey, picks: s.picks };
    }

    case 'confirmed':
      return s.step === 'confirm' ? { ...withoutError(s), step: 'migrating' } : s;

    case 'migrationDone':
      // Drops the recovery key and the picks: the wizard no longer needs them.
      return s.step === 'migrating' ? { step: 'done' } : s;

    default:
      return s;
  }
}

/** The i18n key for a setup, recovery or PIN error code. Other API codes map to `err_<code>`, the key `errorText` uses. */
export function vaultErrorKey(code: string): string {
  switch (code) {
    case 'pin_format':
      return 'pin_format';
    case 'pin_mismatch':
      return 'vaultPinMismatch';
    case 'weak_pin':
      return 'vaultWeakPin';
    case 'matches_app_pin':
      return 'vaultMatchesAppPin';
    case 'bad_recovery_key':
      return 'vaultBadRecoveryKey';
    case 'confirm_wrong':
      return 'vaultRecoveryWrong';
    default:
      return `err_${code}`;
  }
}

/** The text for a setup, recovery or PIN error code; codes without a string of their own show the generic text. */
export function vaultErrorText(dict: Record<string, unknown>, code: string): string {
  const value = dict[vaultErrorKey(code)];
  if (typeof value === 'string') return value;
  return typeof dict.err_generic === 'string' ? dict.err_generic : '';
}

/** Seconds left of a lock, rounded up, never negative. */
export function vaultLockSecondsLeft(lockedUntil: number, now: number): number {
  return Math.max(0, Math.ceil((lockedUntil - now) / 1000));
}

/** What the gate shows for an unlock answer: an i18n key, its arguments, and whether to switch to the recovery screen. */
export type GateMessage = { key: string; args?: Record<string, number>; goRecover?: true };

export function gateMessage(result: Extract<VaultUnlockResult, { ok: false }>, now: number): GateMessage {
  switch (result.reason) {
    case 'wrong':
      return { key: 'vaultWrongPin', args: { remaining: result.remaining } };
    case 'locked':
      return { key: 'vaultLockedFor', args: { seconds: vaultLockSecondsLeft(result.lockedUntil, now) } };
    case 'wiped':
      return { key: 'vaultWiped', goRecover: true };
    case 'not_ready':
      return { key: 'vaultNotReady' };
    default:
      return { key: 'err_generic' };
  }
}

/** Resolves a message's key in a dictionary: a plain string, or a function called with the message's arguments. */
export function vaultText(dict: Record<string, unknown>, message: GateMessage): string {
  const value = dict[message.key];
  if (typeof value === 'function') return (value as (args: Record<string, number>) => string)(message.args ?? {});
  return typeof value === 'string' ? value : '';
}

/**
 * Where a move into the Vault starts (spec 4.7b I2, 4.7d). `open` means the Vault key is held (the 6-hour session after a correct PIN),
 * not that the Vault screen is showing: an open Vault moves at once, whatever its status, with no PIN. A set-up Vault that is closed
 * asks for the 6-digit PIN first (a small popup over the list), a wiped one goes to the recovery screen first. A Vault that is not set
 * up opens the setup wizard first, and the files move once it is done (there is no plain move any more). `none` with an open Vault
 * cannot happen; it moves.
 */
export function vaultMoveInPlan(status: 'none' | 'ready' | 'wiped', open: boolean): 'setup' | 'move' | 'unlock' | 'recover' {
  if (open) return 'move';
  if (status === 'ready') return 'unlock';
  if (status === 'wiped') return 'recover';
  return 'setup';
}

/**
 * The i18n key of the message for files that could not be moved into the Vault, or null when none failed. The failed files stay in the
 * Vault as pending (faded cloud) and are encrypted again later, so the message is a function of the count (`{ n }`).
 */
export function moveFailedMessageKey(failed: number): 'vaultMoveFailed' | null {
  return failed > 0 ? 'vaultMoveFailed' : null;
}

/** Where the recovery screen goes after a failed `vaultRecover`: back to the key, back to the PIN, or stay on the repeat step. */
export function recoverFailureStep(error: string): 'key' | 'pin' | 'again' {
  if (error === 'bad_recovery_key') return 'key';
  if (error === 'weak_pin' || error === 'matches_app_pin') return 'pin';
  return 'again';
}

/** Where the PIN-change form goes after a refused change, and what it says. `closed` means the form is done (wiped or not set up). */
export function changePinFailure(result: Extract<VaultUnlockResult, { ok: false }> | VaultPinRefusal, now: number): { stage: 'old' | 'new' | 'closed'; message: GateMessage } {
  if (!('reason' in result)) return { stage: 'new', message: { key: vaultErrorKey(result.error) } };
  if (result.reason === 'wiped' || result.reason === 'not_ready') return { stage: 'closed', message: gateMessage(result, now) };
  return { stage: 'old', message: gateMessage(result, now) };
}

/** A file in the Vault whose content is not encrypted yet (put there before the Vault was encrypted): shown with the encrypting badge. */
export function isEncrypting(item: Item): boolean {
  return item.inVault && !item.encrypted;
}

/**
 * What a Vault row shows (spec 4.7d): `pending` (faded cloud) is in the Vault but not encrypted yet, `encrypted` (green tick) is done,
 * `unreadable` is an encrypted item that cannot be opened (it wins over `encrypted`), `plain` is anything outside the Vault.
 */
export function vaultItemState(item: Item): 'pending' | 'encrypted' | 'unreadable' | 'plain' {
  if (isEncrypting(item)) return 'pending';
  if (!item.inVault) return 'plain';
  return item.unreadable ? 'unreadable' : 'encrypted';
}

/** Whether a Vault item may leave the Vault: it must be readable, and encrypted (not still being converted). */
export function canMoveOut(item: Item): boolean {
  return !item.unreadable && !isEncrypting(item);
}

/** The Vault's trash: only deleted items, most recently deleted first; ties by id, descending. Returns a new array. */
export function vaultTrashSort(items: Item[]): Item[] {
  return items
    .filter((it) => it.deletedAt !== null)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** The Vault trash is a sidebar above 720 px and a full-screen overlay at 720 px and below. */
export function vaultTrashLayout(viewportWidth: number): 'sidebar' | 'overlay' {
  return viewportWidth > 720 ? 'sidebar' : 'overlay';
}

/** Undoing a delete inside the Vault: one restore per id, in order. The item stays in the Vault, so there is never a move. */
export function undoVaultDelete(ids: string[]): { op: 'restore'; id: string }[] {
  return ids.map((id) => ({ op: 'restore' as const, id }));
}
