import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { changePinFailure, isVaultPinFormat, vaultText, VAULT_PIN_LENGTH, type GateMessage } from '../lib/vault';
import { PinInput } from './PinInput';

type Stage = 'closed' | 'old' | 'new' | 'again';

/** Settings row to change the Vault PIN: the current PIN (or the recovery key, on another screen), then the new PIN twice. */
export function VaultPinChange({ onRecover, onToast }: { onRecover: () => void; onToast: (text: string, error?: boolean) => void }) {
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>('closed');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [message, setMessage] = useState<GateMessage | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  const fail = (next: GateMessage) => {
    setMessage(next);
    setShake((k) => k + 1);
  };

  function close() {
    setStage('closed');
    setOldPin('');
    setNewPin('');
    setMessage(null);
  }

  function toggle() {
    if (stage === 'closed') setStage('old');
    else close();
  }

  function onOld(pin: string) {
    setOldPin(pin);
    setMessage(null);
    setStage('new');
  }

  function onNew(pin: string) {
    if (!isVaultPinFormat(pin)) return fail({ key: 'pin_format' });
    setNewPin(pin);
    setMessage(null);
    setStage('again');
  }

  async function onAgain(pin: string) {
    if (busy) return;
    if (pin !== newPin) {
      setNewPin('');
      setStage('new');
      return fail({ key: 'vaultPinMismatch' });
    }
    setBusy(true);
    let res;
    try {
      res = await window.fatup.vaultChangePin(oldPin, pin);
    } catch (err) {
      console.error(err);
      setBusy(false);
      return fail({ key: 'err_generic' });
    }
    setBusy(false);
    if (res.ok) {
      onToast(t.vaultPinChanged);
      return close();
    }
    const failure = changePinFailure(res, Date.now());
    if (failure.stage === 'closed') {
      close();
      setMessage(failure.message);
      return;
    }
    setOldPin('');
    setNewPin('');
    setStage(failure.stage);
    fail(failure.message);
  }

  const dict = t as unknown as Record<string, unknown>;

  return (
    <>
      <button className="settings__row settings__row--btn" onClick={toggle} aria-expanded={stage !== 'closed'}>
        <KeyRound size={20} className="settings__icon" />
        <span className="settings__label">{t.vaultChangePin}</span>
      </button>
      {stage !== 'closed' && (
        <div className="settings__panel">
          {stage === 'old' && (
            <>
              <p className="muted">{t.vaultChangePinOld}</p>
              <PinInput key="old" label={t.vaultChangePinOld} length={VAULT_PIN_LENGTH} errorKey={shake} disabled={busy} onComplete={onOld} />
              <button className="btn btn--text" onClick={onRecover}>
                {t.vaultChangePinUseRecovery}
              </button>
            </>
          )}
          {stage === 'new' && (
            <>
              <p className="muted">{t.vaultPinPrompt}</p>
              <PinInput key="new" label={t.vaultPinPrompt} length={VAULT_PIN_LENGTH} errorKey={shake} disabled={busy} onComplete={onNew} />
            </>
          )}
          {stage === 'again' && (
            <>
              <p className="muted">{t.vaultPinAgain}</p>
              <PinInput key="again" label={t.vaultPinAgain} length={VAULT_PIN_LENGTH} errorKey={shake} disabled={busy} onComplete={onAgain} />
            </>
          )}
          {message && (
            <p className="error" role="alert">
              {vaultText(dict, message)}
            </p>
          )}
        </div>
      )}
    </>
  );
}
