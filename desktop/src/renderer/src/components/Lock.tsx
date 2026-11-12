import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { ConfirmDialog } from './Dialog';
import { Logo } from './Logo';
import { PinInput } from './PinInput';

export function Lock({ onUnlocked, onReset }: { onUnlocked: () => void; onReset: () => void }) {
  const { t } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [confirmReset, setConfirmReset] = useState(false);

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
    if (res.ok) return onUnlocked();
    setErrorKey((k) => k + 1);
    if (res.reason === 'locked') {
      setLockedUntil(res.lockedUntil);
      setNow(Date.now());
    } else {
      setMessage(t.wrongPin(res.attemptsLeft));
    }
  }

  return (
    <div className="center-screen">
      <div className="card lock">
        <Logo size={44} />
        <h1>{t.enterPin}</h1>
        <PinInput label={t.enterPin} onComplete={submit} errorKey={errorKey} disabled={locked} />
        <p className={`error ${message || locked ? '' : 'error--hidden'}`} role="alert">
          {locked ? t.lockedFor(Math.ceil((lockedUntil - now) / 1000)) : (message ?? ' ')}
        </p>
        <button className="btn btn--text" onClick={() => setConfirmReset(true)}>
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
  );
}
