import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy } from 'lucide-react';
import type { VaultProgress, VaultSetupCommitResult, VaultSetupResult } from '../../../shared-ipc';
import { useI18n } from '../lib/i18n';
import { nextSetupState, vaultErrorText, VAULT_PIN_LENGTH, type SetupState } from '../lib/vault';
import { PinInput } from './PinInput';
import { VaultFrame } from './VaultFrame';

type Props = { onDone: () => void; onBack: () => void };

/**
 * First-time setup of the Vault, in two steps (spec 4.7b I1): PIN, recovery key, confirmation (all local: `vaultSetupPrepare` only
 * makes the keys), then `vaultSetupCommit` sets the Vault up on the server, and the conversion of old files follows.
 * The recovery key lives only in this state. Leaving the wizard before the commit closes the Vault, which discards the prepared setup.
 */
export function VaultSetup({ onDone, onBack }: Props) {
  const { t } = useI18n();
  const dict = t as unknown as Record<string, unknown>;
  const [state, setState] = useState<SetupState>({ step: 'intro' });
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [progress, setProgress] = useState<VaultProgress | null>(null);
  const [copied, setCopied] = useState(false);
  const [typed, setTyped] = useState<[string, string]>(['', '']);
  const committing = useRef(false); // a second click while the commit runs must not send a second commit
  const committed = useRef(false); // once committed the Vault stays open for the user: leaving the wizard must not close it

  // The main process converts old files as soon as the Vault opens, which can be during the recovery screen; listen from the start.
  useEffect(() => window.fatup.onVaultProgress(setProgress), []);

  // Leaving the wizard before the commit discards the prepared setup (the Vault is closed, its keys forgotten).
  useEffect(
    () => () => {
      if (!committed.current) void window.fatup.vaultClose();
    },
    [],
  );

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
    // Step one: checks the PIN and makes the keys. Nothing is sent to the server yet.
    let result: VaultSetupResult;
    try {
      result = await window.fatup.vaultSetupPrepare(next.pin);
    } catch (err) {
      console.error(err);
      result = { ok: false, error: 'network' };
    }
    setBusy(false);
    if (!result.ok) setShake((k) => k + 1);
    setState((s) => nextSetupState(s, { type: 'setupResult', result }));
  }

  /** Step two, after the recovery key was confirmed: the server gets the Vault, and the Vault opens. */
  async function commit() {
    if (committing.current) return;
    committing.current = true;
    let result: VaultSetupCommitResult;
    try {
      result = await window.fatup.vaultSetupCommit();
    } catch (err) {
      console.error(err);
      result = { ok: false, error: 'network' };
    }
    committing.current = false;
    if (result.ok) committed.current = true;
    setState((s) => nextSetupState(s, { type: 'commitResult', result }));
  }

  function onConfirm(e: FormEvent) {
    e.preventDefault();
    const next = nextSetupState(state, { type: 'confirmGroups', typed });
    setState(next);
    if (next.step === 'committing') void commit();
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
        {errorLine}
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
          {/* Each group keeps its dash, and a group never splits: the key wraps only between groups. The text is still the exact key. */}
          {(state.recoveryKey ?? '').split('-').map((group, i, all) => (
            <span className="vault-key__group" key={i}>
              {group}
              {i < all.length - 1 ? '-' : ''}
            </span>
          ))}
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

  if (state.step === 'committing') {
    return (
      <VaultFrame title={t.vaultSetupTitle}>
        <p className="vault-card__text" role="status">
          {t.vaultCommitting}
        </p>
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
