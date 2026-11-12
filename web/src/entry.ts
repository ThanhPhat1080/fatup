import { installBrowserApi } from './browser-api';

installBrowserApi();
// The UI is shared with the desktop app; only the `window.fatup` bridge differs.
import('../../desktop/src/renderer/src/main');

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
