import { useEffect, useRef, useState } from 'react';
import { VaultHeist } from './VaultHeist';
import { useI18n } from '../lib/i18n';
import { PinInput } from './PinInput';

const BOOM_MS = 1250;

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const pad = (n: number) => String(n).padStart(2, '0');

/** Digits that jump around at random, just for fun. Static when the user asked for less motion. */
function useJumpingTimer(): string {
  const [text, setText] = useState('00:59');
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = setInterval(() => setText(`${pad(Math.floor(Math.random() * 60))}:${pad(Math.floor(Math.random() * 60))}`), 90);
    return () => clearInterval(timer);
  }, []);
  return text;
}

/** Shown every time the Vault is opened: the PIN has to be entered again. */
export function VaultGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const locked = lockedUntil > now;
  const [boom, setBoom] = useState(false);
  const timer = useJumpingTimer();
  const boomTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(boomTimer.current), []);

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
    <div className="vault-gate">
      <VaultHeist boom={boom} panicKey={errorKey} timer={timer}>
        <PinInput label={t.vaultPrompt} onComplete={submit} errorKey={errorKey} disabled={locked || boom} />
      </VaultHeist>
      <h2>{t.vault}</h2>
      <p className="muted">{t.vaultPrompt}</p>
      <p className={`error ${message || locked ? '' : 'error--hidden'}`} role="alert">
        {locked ? t.lockedFor(Math.ceil((lockedUntil - now) / 1000)) : (message ?? ' ')}
      </p>
    </div>
  );
}
