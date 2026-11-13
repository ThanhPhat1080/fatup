import { installBrowserApi } from './browser-api';
import { stashSharedLink, takeSharedLink } from './share';

// Opened from the Android share sheet: keep the shared link for after the PIN screen, and clean the address bar.
const search = new URLSearchParams(location.search);
if (['title', 'text', 'url'].some((k) => search.has(k))) {
  stashSharedLink(takeSharedLink(location.search) ?? { url: '' });
  history.replaceState(null, '', location.pathname);
}

installBrowserApi();
// The UI is shared with the desktop app; only the `window.fatup` bridge differs.
import('../../desktop/src/renderer/src/main');

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
