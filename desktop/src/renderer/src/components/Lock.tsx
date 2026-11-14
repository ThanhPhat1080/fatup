import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { ConfirmDialog } from './Dialog';
import { useMediaQuery, PHONE_QUERY } from '../lib/media';
import { LockGate } from './LockGate';
import { DOORS_OPEN_S, LockMoria } from './LockMoria';
import { PinInput } from './PinInput';

const OPEN_MS = Math.round(DOORS_OPEN_S * 1000);

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function Lock({ onUnlocked, onReset }: { onUnlocked: () => void; onReset: () => void }) {
  const { t } = useI18n();
  // On a phone the lock screen is only the door of Moria (the full scene makes phones lag), but it still reacts: a wrong PIN stutters its
  // lights and shakes the PIN, the right one opens it.
  const phone = useMediaQuery(PHONE_QUERY);
  const [message, setMessage] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [confirmReset, setConfirmReset] = useState(false);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(openTimer.current), []);

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
      setMessage(null); // the last wrong-PIN line must not hang over the opening door
      // The right PIN swings the Doors of Durin open; the app appears once the light has flooded the screen.
      if (prefersReducedMotion()) return onUnlocked();
      setOpen(true);
      openTimer.current = setTimeout(onUnlocked, OPEN_MS);
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

  const below = (
    <>
      <p className={`error ${message || locked ? '' : 'error--hidden'}`} role="alert">
        {locked ? t.lockedFor(Math.ceil((lockedUntil - now) / 1000)) : (message ?? ' ')}
      </p>
      <button className="btn btn--text" onClick={() => setConfirmReset(true)} disabled={open}>
        {t.forgotPin}
      </button>
    </>
  );
  const pin = <PinInput label={t.enterPin} onComplete={submit} errorKey={errorKey} disabled={locked || open} />;

  return (
    <div className="moria-lock">
      {phone ? (
        <LockGate open={open} panicKey={errorKey} below={below}>
          {pin}
        </LockGate>
      ) : (
        <LockMoria open={open} panicKey={errorKey} below={below}>
          {pin}
        </LockMoria>
      )}
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
