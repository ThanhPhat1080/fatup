import { useState } from 'react';
import { KeyRound, Languages, Lock as LockIcon, LogOut, QrCode, Server } from 'lucide-react';
import type { AppState, Lang, Prefs } from '../../../shared-ipc';
import { useI18n } from '../lib/i18n';
import { ConfirmDialog, Dialog } from './Dialog';
import { PinInput } from './PinInput';

type Props = {
  state: AppState;
  onClose: () => void;
  onPrefs: (p: Partial<Prefs>) => void;
  onToast: (text: string, error?: boolean) => void;
  onLock: () => void;
  onSignOut: () => void;
};

type Panel = null | 'qr' | 'pin';

export function Settings({ state, onClose, onPrefs, onToast, onLock, onSignOut }: Props) {
  const { t } = useI18n();
  const [panel, setPanel] = useState<Panel>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [oldPin, setOldPin] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  function showPanel(p: Panel) {
    setPanel(panel === p ? null : p);
    setQr(null);
    setOldPin(null);
    setPinError(null);
  }

  async function revealQr(pin: string) {
    const res = await window.fatup.pairingQr(pin);
    if (res.ok && res.qr) {
      setQr(res.qr);
      setPinError(null);
    } else {
      setErrorKey((k) => k + 1);
      if (!res.ok) setPinError(res.reason === 'locked' ? t.lockedFor(Math.ceil((res.lockedUntil - Date.now()) / 1000)) : t.wrongPin(res.attemptsLeft));
    }
  }

  async function changePin(newPin: string) {
    if (!oldPin) return;
    const res = await window.fatup.changePin(oldPin, newPin);
    if (res.ok) {
      onToast(t.pinChanged);
      setPanel(null);
      setOldPin(null);
    } else {
      setOldPin(null);
      setErrorKey((k) => k + 1);
      setPinError(res.reason === 'locked' ? t.lockedFor(Math.ceil((res.lockedUntil - Date.now()) / 1000)) : t.wrongPin(res.attemptsLeft));
    }
  }

  return (
    <Dialog title={t.settings} onClose={onClose} wide>
      <div className="settings">
        <div className="settings__row">
          <Languages size={20} className="settings__icon" />
          <span className="settings__label">{t.language}</span>
          <select value={state.prefs.lang} onChange={(e) => onPrefs({ lang: e.target.value as Lang })} aria-label={t.language}>
            <option value="auto">{t.langAuto}</option>
            <option value="en">English</option>
            <option value="vi">Tiếng Việt</option>
          </select>
        </div>

        <div className="settings__row">
          <Server size={20} className="settings__icon" />
          <span className="settings__label">{t.server}</span>
          <span className="muted ellipsis settings__value" title={state.serverUrl ?? ''}>
            {state.serverUrl}
          </span>
        </div>

        <button className="settings__row settings__row--btn" onClick={() => showPanel('qr')} aria-expanded={panel === 'qr'}>
          <QrCode size={20} className="settings__icon" />
          <span className="settings__label">{t.pairAndroid}</span>
        </button>
        {panel === 'qr' && (
          <div className="settings__panel">
            {qr ? (
              <>
                <img className="qr" src={qr} alt="QR" />
                <p className="muted">{t.pairHint}</p>
              </>
            ) : (
              <>
                <p className="muted">{t.pairPinPrompt}</p>
                <PinInput label={t.pairPinPrompt} onComplete={revealQr} errorKey={errorKey} />
                {pinError && <p className="error">{pinError}</p>}
              </>
            )}
          </div>
        )}

        <button className="settings__row settings__row--btn" onClick={() => showPanel('pin')} aria-expanded={panel === 'pin'}>
          <KeyRound size={20} className="settings__icon" />
          <span className="settings__label">{t.changePin}</span>
        </button>
        {panel === 'pin' && (
          <div className="settings__panel">
            <p className="muted">{oldPin ? t.newPin : t.currentPin}</p>
            {oldPin ? (
              <PinInput key="new" label={t.newPin} onComplete={changePin} />
            ) : (
              <PinInput
                key="old"
                label={t.currentPin}
                errorKey={errorKey}
                onComplete={(p) => {
                  setPinError(null);
                  setOldPin(p);
                }}
              />
            )}
            {pinError && <p className="error">{pinError}</p>}
          </div>
        )}

        <button className="settings__row settings__row--btn" onClick={onLock}>
          <LockIcon size={20} className="settings__icon" />
          <span className="settings__label">{t.lockNow}</span>
        </button>
        <button className="settings__row settings__row--btn settings__row--danger" onClick={() => setConfirmSignOut(true)}>
          <LogOut size={20} className="settings__icon" />
          <span className="settings__label">{t.signOut}</span>
        </button>
      </div>
      {confirmSignOut && (
        <ConfirmDialog
          title={t.signOut}
          body={t.resetConfirm}
          confirmLabel={t.signOut}
          danger
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={onSignOut}
        />
      )}
    </Dialog>
  );
}
