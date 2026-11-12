import { useEffect, useState } from 'react';
import type { Theme } from '../../../shared-ipc';

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Whether the OS currently prefers dark, kept up to date. */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => query().matches);
  useEffect(() => {
    const mq = query();
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

export const isDark = (theme: Theme, systemDark: boolean) => (theme === 'system' ? systemDark : theme === 'dark');

/** Applies the explicit choice to <html>; "system" removes it so the OS preference decides. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
