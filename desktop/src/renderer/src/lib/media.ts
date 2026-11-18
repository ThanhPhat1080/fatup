import { useSyncExternalStore } from 'react';

export { PHONE_QUERY } from './phone-query';

/** Whether a CSS media query matches right now, kept up to date as the window is resized or rotated. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener('change', notify);
      return () => list?.removeEventListener('change', notify);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
