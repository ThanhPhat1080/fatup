import { useEffect, useState } from 'react';
import { VaultIcon } from './VaultIcon';
import { useI18n } from '../lib/i18n';
import { PinInput } from './PinInput';

/** Shown every time the Vault is opened: the PIN has to be entered again. */
export function VaultGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const locked = lockedUntil > now;

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
    <div className="vault-gate">
      <div className="empty__art">
        <VaultIcon size={56} />
      </div>
      <h2>{t.vault}</h2>
      <p className="muted">{t.vaultPrompt}</p>
      <PinInput label={t.vaultPrompt} onComplete={submit} errorKey={errorKey} disabled={locked} />
      <p className={`error ${message || locked ? '' : 'error--hidden'}`} role="alert">
        {locked ? t.lockedFor(Math.ceil((lockedUntil - now) / 1000)) : (message ?? ' ')}
      </p>
    </div>
  );
}
