import { useEffect, useRef, useState } from 'react';
import { LockBackdrop } from './LockBackdrop';
import { BOMB_LANDS_S, LockWizard } from './LockWizard';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { gateMessage, vaultText, VAULT_PIN_LENGTH, type GateMessage } from '../lib/vault';
import { stillGate } from '../lib/motion';
import { vaultGateStill } from '../lib/lock-scene';
import { PinInput } from './PinInput';
import { SimpleDoor } from './SimpleDoor';

const BOOM_MS = Math.round((BOMB_LANDS_S + 0.95) * 1000);
const LEAVE_MS = 3400; // long enough to read what the wizard says

/**
 * Shown every time the Vault is opened: the PIN has to be entered again. `hint` says why it is asked (moving files in from the list).
 */
export function VaultGate({ lotr, onUnlocked, onBack, onRecover, hint }: { lotr: boolean; onUnlocked: () => void; onBack: () => void; onRecover: () => void; hint?: string }) {
  const { t } = useI18n();
  const [message, setMessage] = useState<GateMessage | null>(null);
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
    boomTimer.current = setTimeout(onBack, vaultGateStill(lotr, stillGate()) ? 0 : LEAVE_MS);
  }

  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [locked]);

  async function submit(pin: string) {
    let res;
    try {
      res = await window.fatup.vaultUnlock(pin);
    } catch (err) {
      // e.g. the preload is out of date: say so instead of silently swallowing the PIN.
      setErrorKey((k) => k + 1);
      setMessage({ key: 'err_generic' });
      console.error(err);
      return;
    }
    if (res.ok) {
      // The right PIN blows the safe open; the Vault shows once the blast is over.
      if (vaultGateStill(lotr, stillGate())) return onUnlocked();
      setBoom(true);
      boomTimer.current = setTimeout(onUnlocked, BOOM_MS);
      return;
    }
    setErrorKey((k) => k + 1);
    const at = Date.now();
    const msg = gateMessage(res, at);
    if (msg.goRecover) return onRecover();
    if (res.reason === 'locked') {
      setLockedUntil(res.lockedUntil);
      setNow(at);
      setMessage(null);
    } else {
      setMessage(msg);
    }
  }

  const shown: GateMessage | null = locked ? gateMessage({ ok: false, reason: 'locked', lockedUntil }, now) : message;

  const back = (
    <button className="btn btn--text" onClick={goBack} disabled={boom || leaving}>
      <ArrowLeft size={18} /> {t.goBack}
    </button>
  );

  if (!lotr) {
    // Simple lock: the light door with VAULT on it. No wizard, no flames, no boom: a wrong PIN only shakes the cells.
    const err = (
      <p className={`error ${shown || locked ? '' : 'error--hidden'}`} role="alert">
        {shown ? vaultText(t, shown) : ' '}
      </p>
    );
    return (
      <div className="vaultscreen vaultscreen--simple">
        <SimpleDoor open={false} cells={6} label="VAULT" below={<>{hint && <p className="vault-card__text">{hint}</p>}{err}{back}</>}>
          <PinInput label={t.vaultPrompt} onComplete={submit} errorKey={errorKey} disabled={locked || leaving} length={VAULT_PIN_LENGTH} />
        </SimpleDoor>
      </div>
    );
  }

  return (
    <div className="lockscreen vaultscreen">
      <LockBackdrop />
      <div className="center-screen lockscreen__center">
        <div className="lockstage">
          {/* Above the wizard, on the dark sky: the flames below the wizard would make the text hard to read. */}
          {hint && <p className="vault-card__text" style={{ marginBottom: 12 }}>{hint}</p>}
          <LockWizard wide boom={boom} panicKey={errorKey} message={leaving ? 'GO BACK TO THE SHADOW!' : undefined} calm={leaving}>
            <PinInput label={t.vaultPrompt} onComplete={submit} errorKey={errorKey} disabled={locked || boom || leaving} length={VAULT_PIN_LENGTH} />
          </LockWizard>
          <p className={`error ${shown || locked ? '' : 'error--hidden'}`} role="alert">
            {shown ? vaultText(t, shown) : ' '}
          </p>
          {back}
        </div>
      </div>
    </div>
  );
}
