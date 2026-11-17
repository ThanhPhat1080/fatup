import { useEffect, useState, type FormEvent } from 'react';
import { Copy } from 'lucide-react';
import type { VaultProgress, VaultSetupResult } from '../../../shared-ipc';
import { useI18n } from '../lib/i18n';
import { nextSetupState, vaultErrorText, VAULT_PIN_LENGTH, type SetupState } from '../lib/vault';
import { PinInput } from './PinInput';
import { VaultFrame } from './VaultFrame';

type Props = { onDone: () => void; onBack: () => void };

/** First-time setup of the Vault: PIN, recovery key, confirmation, then the conversion of old files. The recovery key lives only in this state. */
export function VaultSetup({ onDone, onBack }: Props) {
  const { t } = useI18n();
  const dict = t as unknown as Record<string, unknown>;
  const [state, setState] = useState<SetupState>({ step: 'intro' });
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [progress, setProgress] = useState<VaultProgress | null>(null);
  const [copied, setCopied] = useState(false);
  const [typed, setTyped] = useState<[string, string]>(['', '']);

  // The main process converts old files as soon as the Vault opens, which can be during the recovery screen; listen from the start.
  useEffect(() => window.fatup.onVaultProgress(setProgress), []);

  // Every conversion run ends with a progress event that has no `current`, also when there was nothing to convert: that is the done signal.
  useEffect(() => {
    if (state.step === 'migrating' && progress && progress.current === undefined) {
      setState((s) => nextSetupState(s, { type: 'migrationDone' }));
    }
  }, [state.step, progress]);

  function onPin(pin: string) {
    const next = nextSetupState(state, { type: 'pin', pin });
    setState(next);
    if (next.error) setShake((k) => k + 1);
  }

  async function onPinAgain(pin: string) {
    if (busy) return;
    const next = nextSetupState(state, { type: 'pinAgain', pin });
    setState(next);
    if (next.error) return setShake((k) => k + 1);
    if (!next.pin || next.step !== 'pinAgain') return;
    setBusy(true);
    let result: VaultSetupResult;
    try {
      result = await window.fatup.vaultSetup(next.pin);
    } catch (err) {
      console.error(err);
      result = { ok: false, error: 'network' };
    }
    setBusy(false);
    if (!result.ok) setShake((k) => k + 1);
    setState((s) => nextSetupState(s, { type: 'setupResult', result }));
  }

  function onConfirm(e: FormEvent) {
    e.preventDefault();
    const next = nextSetupState(state, { type: 'confirmGroups', typed });
    setState(next);
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(state.recoveryKey ?? '');
      setCopied(true);
    } catch (err) {
      console.error(err);
    }
  }

  const errorLine = state.error ? <p className="error" role="alert">{vaultErrorText(dict, state.error)}</p> : null;

  if (state.step === 'intro') {
    return (
      <VaultFrame title={t.vaultSetupTitle} onBack={onBack}>
        <p className="vault-card__text">{t.vaultSetupIntro}</p>
        <button className="btn btn--filled vault-card__action" onClick={() => setState((s) => nextSetupState(s, { type: 'start' }))}>
          {t.vaultStart}
        </button>
      </VaultFrame>
    );
  }

  if (state.step === 'pin' || state.step === 'pinAgain') {
    const again = state.step === 'pinAgain';
    return (
      <VaultFrame title={t.vaultSetupTitle} onBack={again ? () => setState({ step: 'pin' }) : onBack}>
        <p className="vault-card__text">{again ? t.vaultPinAgain : t.vaultPinPrompt}</p>
        <PinInput
          key={state.step}
          label={again ? t.vaultPinAgain : t.vaultPinPrompt}
          length={VAULT_PIN_LENGTH}
          errorKey={shake}
          disabled={busy}
          onComplete={again ? onPinAgain : onPin}
        />
        {errorLine}
      </VaultFrame>
    );
  }

  if (state.step === 'recovery') {
    return (
      <VaultFrame title={t.vaultRecoveryTitle}>
        <p className="vault-card__text">{t.vaultRecoveryWarn}</p>
        <code className="vault-key" aria-label={t.vaultRecoveryTitle}>
          {state.recoveryKey}
        </code>
        <button className="btn btn--outlined" onClick={copyKey}>
          <Copy size={16} /> {copied ? t.vaultRecoveryCopied : t.vaultRecoveryCopy}
        </button>
        <button className="btn btn--filled vault-card__action" onClick={() => setState((s) => nextSetupState(s, { type: 'saved' }))}>
          {t.next}
        </button>
      </VaultFrame>
    );
  }

  if (state.step === 'confirm') {
    const picks = state.picks ?? [0, 1];
    return (
      <VaultFrame title={t.vaultRecoveryTitle}>
        <form className="vault-confirm" onSubmit={onConfirm}>
          <p className="vault-card__text">{t.vaultRecoveryConfirm}</p>
          {picks.map((group, i) => (
            <label key={group} className="vault-confirm__field">
              <span>{t.vaultRecoveryGroup({ n: group + 1 })}</span>
              <input
                className="vault-confirm__input"
                value={typed[i]}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => setTyped((cur) => (i === 0 ? [e.target.value, cur[1]] : [cur[0], e.target.value]))}
              />
            </label>
          ))}
          {errorLine}
          <button className="btn btn--filled vault-card__action" type="submit" disabled={typed.some((v) => v.trim() === '')}>
            {t.next}
          </button>
        </form>
      </VaultFrame>
    );
  }

  if (state.step === 'migrating') {
    const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <VaultFrame title={t.vaultSetupTitle}>
        <p className="vault-card__text">{t.vaultMigrating}</p>
        {progress && (
          <>
            <div className="vault-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <p className="muted">
              {progress.done} / {progress.total}
            </p>
          </>
        )}
      </VaultFrame>
    );
  }

  return (
    <VaultFrame title={t.vaultSetupTitle}>
      <p className="vault-card__text">{t.vaultSetupDone}</p>
      <button className="btn btn--filled vault-card__action" onClick={onDone}>
        {t.vaultOpen}
      </button>
    </VaultFrame>
  );
}
