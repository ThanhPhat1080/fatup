import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppState, Prefs } from '../../shared-ipc';
import { I18nContext, dictionaries, resolveLocale } from './lib/i18n';
import { Setup } from './components/Setup';
import { Lock } from './components/Lock';
import { Main } from './components/Main';

export function App() {
  const [state, setState] = useState<AppState | null>(null);

  const reload = useCallback(async () => setState(await window.fatup.getState()), []);
  useEffect(() => {
    reload();
  }, [reload]);

  const locale = state ? resolveLocale(state.prefs.lang, state.systemLocale) : 'en';
  const i18n = useMemo(() => ({ t: dictionaries[locale], locale }), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  if (!state) return null;

  const updatePrefs = async (prefs: Partial<Prefs>) => {
    const next = await window.fatup.setPrefs(prefs);
    setState((s) => (s ? { ...s, prefs: next } : s));
  };

  let screen;
  if (!state.configured || !state.hasPin) {
    screen = <Setup needsConnection={!state.configured} onDone={reload} />;
  } else if (!state.unlocked) {
    screen = <Lock onUnlocked={reload} onReset={reload} />;
  } else {
    screen = <Main state={state} onPrefs={updatePrefs} onLocked={reload} />;
  }

  return <I18nContext.Provider value={i18n}>{screen}</I18nContext.Provider>;
}
