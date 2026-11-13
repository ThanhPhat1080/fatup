import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { errorText, useI18n } from '../lib/i18n';
import { Logo } from './Logo';
import { PinInput } from './PinInput';

type Step = 'connection' | 'pin' | 'confirm';

export function Setup({ needsConnection, defaultUrl, onDone }: { needsConnection: boolean; defaultUrl?: string; onDone: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(needsConnection ? 'connection' : 'pin');
  const [url, setUrl] = useState(defaultUrl ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const [firstPin, setFirstPin] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const canSubmit = url.trim() !== '' && token.trim() !== '' && !busy;

  // A network failure carries the browser's own reason (blocked, bad certificate, bad header...), which is the only clue to the cause.
  const describe = (res: { error: string; detail?: string }) => errorText(t, res.error) + (res.error === 'network' && res.detail ? ` (${res.detail})` : '');

  async function test() {
    setBusy(true);
    setError(null);
    const res = await window.fatup.testConnection(url, token);
    setBusy(false);
    setTested(res.ok);
    if (!res.ok) setError(describe(res));
  }

  async function saveConnection() {
    setBusy(true);
    setError(null);
    const res = await window.fatup.saveConnection(url, token);
    setBusy(false);
    if (res.ok) setStep('pin');
    else setError(describe(res));
  }

  async function confirmPin(pin: string) {
    if (pin !== firstPin) {
      setError(t.pinMismatch);
      setFirstPin('');
      setStep('pin');
      setErrorKey((k) => k + 1);
      return;
    }
    const res = await window.fatup.setPin(pin);
    if (res.ok) onDone();
    else setError(errorText(t, res.error));
  }

  return (
    <div className="center-screen">
      <div className="card setup">
        <Logo size={44} />
        {step === 'connection' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) saveConnection();
            }}
          >
            <h1>{t.setupTitle}</h1>
            <p className="muted">{t.setupHint}</p>
            <label className="field">
              <span>{t.serverUrl}</span>
              <input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setTested(false);
                }}
                placeholder="https://fatup.your-name.workers.dev"
                autoFocus
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>{t.token}</span>
              <input
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setTested(false);
                }}
                type="password"
                spellCheck={false}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="row row--end">
              <button type="button" className="btn btn--text" disabled={!canSubmit} onClick={test}>
                {tested ? <Check size={18} /> : busy ? <Loader2 size={18} className="spin" /> : null}
                {tested ? t.connectionOk : t.testConnection}
              </button>
              <button type="submit" className="btn btn--filled" disabled={!canSubmit}>
                {t.next}
              </button>
            </div>
          </form>
        )}

        {step === 'pin' && (
          <div className="setup__pin">
            <h1>{t.createPin}</h1>
            <p className="muted">{t.createPinHint}</p>
            <PinInput
              label={t.createPin}
              errorKey={errorKey}
              onComplete={(pin) => {
                setFirstPin(pin);
                setError(null);
                setStep('confirm');
              }}
            />
            {error && <p className="error">{error}</p>}
          </div>
        )}

        {step === 'confirm' && (
          <div className="setup__pin">
            <h1>{t.confirmPin}</h1>
            <p className="muted">{t.createPinHint}</p>
            <PinInput label={t.confirmPin} onComplete={confirmPin} />
            <button className="btn btn--text" onClick={() => setStep('pin')}>
              {t.back}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
