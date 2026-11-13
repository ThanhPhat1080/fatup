import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { ConfirmDialog } from './Dialog';
import { LockBackdrop } from './LockBackdrop';
import { BOMB_LANDS_S, LockWizard } from './LockWizard';
import { PinInput } from './PinInput';

const BOOM_MS = Math.round((BOMB_LANDS_S + 0.95) * 1000);

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function Lock({ onUnlocked, onReset }: { onUnlocked: () => void; onReset: () => void }) {
  const { t } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [confirmReset, setConfirmReset] = useState(false);
  const [boom, setBoom] = useState(false);
  const boomTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(boomTimer.current), []);

  const locked = lockedUntil > now;

  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [locked]);

  useEffect(() => {
    if (lockedUntil && !locked) setMessage(null);
  }, [locked, lockedUntil]);

  async function submit(pin: string) {
    const res = await window.fatup.unlock(pin);
    if (res.ok) {
      // The right PIN throws the bomb; the app opens once the wizard has been blown away.
      if (prefersReducedMotion()) return onUnlocked();
      setBoom(true);
      boomTimer.current = setTimeout(onUnlocked, BOOM_MS);
      return;
    }
    setErrorKey((k) => k + 1);
    if (res.reason === 'locked') {
      setLockedUntil(res.lockedUntil);
      setNow(Date.now());
    } else {
      setMessage(t.wrongPin(res.attemptsLeft));
    }
  }

  return (
    <div className="lockscreen">
      <LockBackdrop />
      <div className="center-screen lockscreen__center">
      <div className="lockstage">
        <LockWizard boom={boom} panicKey={errorKey}>
          <PinInput label={t.enterPin} onComplete={submit} errorKey={errorKey} disabled={locked || boom} />
        </LockWizard>
        <h1>{t.enterPin}</h1>
        <p className={`error ${message || locked ? '' : 'error--hidden'}`} role="alert">
          {locked ? t.lockedFor(Math.ceil((lockedUntil - now) / 1000)) : (message ?? ' ')}
        </p>
        <button className="btn btn--text" onClick={() => setConfirmReset(true)} disabled={boom}>
          {t.forgotPin}
        </button>
      </div>
      {confirmReset && (
        <ConfirmDialog
          title={t.forgotPin.replace(/\?.*/, '?')}
          body={t.resetConfirm}
          confirmLabel={t.signOut}
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={async () => {
            await window.fatup.reset();
            onReset();
          }}
        />
      )}
      </div>
    </div>
  );
}
