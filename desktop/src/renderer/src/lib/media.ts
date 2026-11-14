import { useSyncExternalStore } from 'react';

/** A phone: a narrow window, or a touch screen turned on its side (short but wide). */
export const PHONE_QUERY = '(max-width: 720px), (max-height: 520px) and (pointer: coarse)';

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
