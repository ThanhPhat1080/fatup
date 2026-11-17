import { useState, type FormEvent } from 'react';
import { useI18n } from '../lib/i18n';
import { isVaultPinFormat, recoverFailureStep, vaultErrorText, VAULT_PIN_LENGTH } from '../lib/vault';
import { PinInput } from './PinInput';
import { VaultFrame } from './VaultFrame';

type Props = { onDone: () => void; onBack: () => void };
type Step = 'key' | 'pin' | 'again';

/** Sets a new Vault PIN with the recovery key (forgotten PIN, or a wiped Vault). No file is re-encrypted. */
export function VaultRecover({ onDone, onBack }: Props) {
  const { t } = useI18n();
  const dict = t as unknown as Record<string, unknown>;
  const [step, setStep] = useState<Step>('key');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  function fail(code: string) {
    setError(code);
    setShake((k) => k + 1);
  }

  function onKey(e: FormEvent) {
    e.preventDefault();
    if (recoveryKey.trim() === '') return;
    setError(null);
    setStep('pin');
  }

  function onPin(value: string) {
    if (!isVaultPinFormat(value)) return fail('pin_format');
    setError(null);
    setPin(value);
    setStep('again');
  }

  async function onAgain(value: string) {
    if (busy) return;
    if (value !== pin) {
      setPin('');
      setStep('pin');
      return fail('pin_mismatch');
    }
    setBusy(true);
    let res: { ok: true } | { ok: false; error: string };
    try {
      res = await window.fatup.vaultRecover(recoveryKey.trim(), pin);
    } catch (err) {
      console.error(err);
      res = { ok: false, error: 'network' };
    }
    setBusy(false);
    if (res.ok) return onDone();
    const next = recoverFailureStep(res.error);
    setStep(next);
    if (next !== 'again') setPin('');
    setError(null);
    fail(res.error);
  }

  const errorLine = error ? (
    <p className="error" role="alert">
      {vaultErrorText(dict, error)}
    </p>
  ) : null;

  if (step === 'key') {
    return (
      <VaultFrame title={t.vaultRecoverTitle} onBack={onBack}>
        <form className="vault-confirm" onSubmit={onKey}>
          <p className="vault-card__text">{t.vaultRecoverPrompt}</p>
          <label className="vault-confirm__field">
            <span>{t.vaultRecoverKey}</span>
            <input
              className="vault-confirm__input"
              value={recoveryKey}
              onChange={(e) => setRecoveryKey(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </label>
          {errorLine}
          <button className="btn btn--filled vault-card__action" type="submit" disabled={recoveryKey.trim() === ''}>
            {t.next}
          </button>
        </form>
      </VaultFrame>
    );
  }

  const again = step === 'again';
  return (
    <VaultFrame title={t.vaultRecoverTitle} onBack={() => setStep(again ? 'pin' : 'key')}>
      <p className="vault-card__text">{again ? t.vaultPinAgain : t.vaultPinPrompt}</p>
      <PinInput
        key={step}
        label={again ? t.vaultPinAgain : t.vaultPinPrompt}
        length={VAULT_PIN_LENGTH}
        errorKey={shake}
        disabled={busy}
        onComplete={again ? onAgain : onPin}
      />
      {errorLine}
    </VaultFrame>
  );
}
