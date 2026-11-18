import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { gateMessage, vaultText, VAULT_PIN_LENGTH, type GateMessage } from '../lib/vault';
import { Dialog } from './Dialog';
import { PinInput } from './PinInput';

/**
 * Small popup over the file list that asks for the Vault PIN before files move in (plan 2026-11-18-vault-session-6h, decision 5).
 * Unlike the Vault screen's gate it stays on the list and has no animation. A right PIN holds the key for 6 hours and calls `onUnlocked`;
 * a wiped or not-yet-set-up Vault calls `onRecover`. Escape and the close button call `onCancel`.
 */
export function VaultPinDialog({
  count,
  onUnlocked,
  onCancel,
  onRecover,
}: {
  count: number;
  onUnlocked: () => void;
  onCancel: () => void;
  onRecover: () => void;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState<GateMessage | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const locked = lockedUntil > now;
  const busyRef = useRef(false);

  // Counts the lock down once a second while it lasts, like the Vault gate.
  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [locked]);

  // A lock that is already running (wrong PINs typed elsewhere) shows its countdown as soon as the popup opens.
  useEffect(() => {
    let cancelled = false;
    void window.fatup
      .vaultStatus()
      .then((res) => {
        const until = res.ok ? res.value.lockedUntil : null;
        if (cancelled || !until || until <= Date.now()) return;
        setLockedUntil((cur) => Math.max(cur, until));
        setNow(Date.now());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(pin: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let res;
    try {
      res = await window.fatup.vaultUnlock(pin, 'move');
    } catch (err) {
      // e.g. the preload is out of date: say so instead of swallowing the PIN.
      busyRef.current = false;
      setBusy(false);
      setErrorKey((k) => k + 1);
      setMessage({ key: 'err_generic' });
      console.error(err);
      return;
    }
    busyRef.current = false;
    setBusy(false);
    if (res.ok) return onUnlocked();
    setErrorKey((k) => k + 1);
    const at = Date.now();
    const msg = gateMessage(res, at);
    if (msg.goRecover || res.reason === 'not_ready') return onRecover();
    if (res.reason === 'locked') {
      setLockedUntil(res.lockedUntil);
      setNow(at);
      setMessage(null);
    } else {
      setMessage(msg);
    }
  }

  const shown: GateMessage | null = locked ? gateMessage({ ok: false, reason: 'locked', lockedUntil }, now) : message;

  return (
    <Dialog title={t.vaultPinDialogTitle} onClose={onCancel}>
      <div className="vault-pin">
        <p className="dialog__body">{t.vaultPinDialogHint({ n: count })}</p>
        <PinInput label={t.vaultPinDialogTitle} onComplete={submit} errorKey={errorKey} disabled={locked || busy} length={VAULT_PIN_LENGTH} />
        <p className={`error ${shown || locked ? '' : 'error--hidden'}`} role="alert">
          {shown ? vaultText(t, shown) : ' '}
        </p>
      </div>
      <div className="row row--end vault-pin__actions">
        <button className="btn btn--text" onClick={onRecover}>
          {t.forgotPin}
        </button>
        <button className="btn btn--text" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </Dialog>
  );
}
