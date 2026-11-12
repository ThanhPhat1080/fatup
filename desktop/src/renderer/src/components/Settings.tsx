import { useEffect, useState } from 'react';
import { Download, KeyRound, Languages, Moon, Sun, Loader2, Lock as LockIcon, LogOut, QrCode, RefreshCw, Server } from 'lucide-react';
import type { AppState, Lang, Prefs } from '../../../shared-ipc';
import { useI18n } from '../lib/i18n';
import { isDark, useSystemDark } from '../lib/theme';
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

type UpdateUi =
  | { s: 'idle' }
  | { s: 'checking' }
  | { s: 'latest' }
  | { s: 'available'; version: string; auto: boolean }
  | { s: 'installing'; percent: number }
  | { s: 'restarting' }
  | { s: 'error'; key: 'updateCheckFailed' | 'updateFailed' };

type Panel = null | 'qr' | 'pin';

export function Settings({ state, onClose, onPrefs, onToast, onLock, onSignOut }: Props) {
  const { t } = useI18n();
  const [panel, setPanel] = useState<Panel>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [oldPin, setOldPin] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const systemDark = useSystemDark();
  const dark = isDark(state.prefs.theme, systemDark);
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateUi>({ s: 'idle' });

  useEffect(() => {
    window.fatup.appVersion().then(setVersion);
    return window.fatup.onUpdateProgress(({ percent }) => setUpdate((u) => (u.s === 'installing' ? { s: 'installing', percent } : u)));
  }, []);

  async function checkUpdate() {
    setUpdate({ s: 'checking' });
    const res = await window.fatup.checkForUpdate();
    if (res.status === 'latest') setUpdate({ s: 'latest' });
    else if (res.status === 'available') setUpdate({ s: 'available', version: res.version, auto: res.auto });
    else setUpdate({ s: 'error', key: 'updateCheckFailed' });
  }

  async function installUpdate(auto: boolean) {
    if (auto) setUpdate({ s: 'installing', percent: 0 });
    const res = await window.fatup.installUpdate();
    if (!res.ok) setUpdate({ s: 'error', key: 'updateFailed' });
    else if (auto) setUpdate({ s: 'restarting' });
  }

  const updateText =
    update.s === 'checking'
      ? t.checking
      : update.s === 'latest'
        ? t.upToDate
        : update.s === 'available'
          ? t.updateAvailable(update.version)
          : update.s === 'installing'
            ? t.updateDownloading(update.percent)
            : update.s === 'restarting'
              ? t.updateRestarting
              : update.s === 'error'
                ? t[update.key]
                : '';
  const busy = update.s === 'checking' || update.s === 'installing' || update.s === 'restarting';

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
          {dark ? <Moon size={20} className="settings__icon" /> : <Sun size={20} className="settings__icon" />}
          <span className="settings__label">{t.appearance}</span>
          <button
            role="switch"
            aria-checked={dark}
            className="theme-switch"
            onClick={() => onPrefs({ theme: dark ? 'light' : 'dark' })}
            title={dark ? t.themeToLight : t.themeToDark}
            aria-label={dark ? t.themeToLight : t.themeToDark}
          >
            <span className="theme-switch__thumb" />
            <Sun size={16} className="theme-switch__sun" />
            <Moon size={16} className="theme-switch__moon" />
          </button>
        </div>

        <div className="settings__row">
          <Server size={20} className="settings__icon" />
          <span className="settings__label">{t.server}</span>
          <span className="muted ellipsis settings__value" title={state.serverUrl ?? ''}>
            {state.serverUrl}
          </span>
        </div>

        {state.platform === 'desktop' && (
        <div className="settings__row settings__row--update">
          <RefreshCw size={20} className="settings__icon" />
          <span className="settings__label">
            {t.version} {version}
            {updateText && (
              <span className={`settings__sub${update.s === 'error' ? ' error' : ''}`} role="status">
                {updateText}
              </span>
            )}
          </span>
          {update.s === 'available' ? (
            <button className="btn btn--filled" onClick={() => installUpdate(update.auto)}>
              <Download size={16} /> {update.auto ? t.updateNow : t.updateOpenPage}
            </button>
          ) : (
            <button className="btn btn--text" onClick={checkUpdate} disabled={busy}>
              {busy && <Loader2 size={16} className="spin" />} {t.checkUpdate}
            </button>
          )}
        </div>
        )}

        {state.platform === 'desktop' && (
        <button className="settings__row settings__row--btn" onClick={() => showPanel('qr')} aria-expanded={panel === 'qr'}>
          <QrCode size={20} className="settings__icon" />
          <span className="settings__label">{t.pairAndroid}</span>
        </button>
        )}
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
