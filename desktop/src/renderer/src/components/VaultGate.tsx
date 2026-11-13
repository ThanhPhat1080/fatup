import { useEffect, useRef, useState } from 'react';
import { LockBackdrop } from './LockBackdrop';
import { BOMB_LANDS_S, LockWizard } from './LockWizard';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { PinInput } from './PinInput';

const BOOM_MS = Math.round((BOMB_LANDS_S + 0.95) * 1000);
const LEAVE_MS = 3400; // long enough to read what the wizard says

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Shown every time the Vault is opened: the PIN has to be entered again. */
export function VaultGate({ onUnlocked, onBack }: { onUnlocked: () => void; onBack: () => void }) {
  const { t } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const locked = lockedUntil > now;
  const [boom, setBoom] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const boomTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(boomTimer.current), []);

  // Turning back: the wizard lowers his staff, has his say, and then the Vault closes.
  function goBack() {
    if (leaving || boom) return;
    setLeaving(true);
    boomTimer.current = setTimeout(onBack, prefersReducedMotion() ? 0 : LEAVE_MS);
  }

  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [locked]);

  async function submit(pin: string) {
    let res;
    try {
      res = await window.fatup.vaultOpen(pin);
    } catch (err) {
      // e.g. the preload is out of date: say so instead of silently swallowing the PIN.
      setErrorKey((k) => k + 1);
      setMessage(`${t.err_generic} (${(err as Error).message})`);
      return;
    }
    if (res.ok) {
      // The right PIN blows the safe open; the Vault shows once the blast is over.
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
    <div className="lockscreen vaultscreen">
      <LockBackdrop />
      <div className="center-screen lockscreen__center">
        <div className="lockstage">
          <LockWizard boom={boom} panicKey={errorKey} message={leaving ? 'GO BACK TO THE SHADOW!' : undefined} calm={leaving}>
            <PinInput label={t.vaultPrompt} onComplete={submit} errorKey={errorKey} disabled={locked || boom || leaving} />
          </LockWizard>
          <p className={`error ${message || locked ? '' : 'error--hidden'}`} role="alert">
            {locked ? t.lockedFor(Math.ceil((lockedUntil - now) / 1000)) : (message ?? ' ')}
          </p>
          <button className="btn btn--text" onClick={goBack} disabled={boom || leaving}>
            <ArrowLeft size={18} /> {t.goBack}
          </button>
        </div>
      </div>
    </div>
  );
}
