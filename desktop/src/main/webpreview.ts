import { session, WebContentsView, type BrowserWindow } from 'electron';
import type { ViewBounds, WebPreviewState } from '../shared-ipc';

/** Its own in-memory session: nothing the page stores (cookies, logins, cache) outlives the app or touches the app's own session. */
const PARTITION = 'webpreview';
const isHttp = (url: string) => /^https?:\/\//i.test(url);

let sessionReady = false;
function previewSession() {
  const ses = session.fromPartition(PARTITION);
  if (!sessionReady) {
    sessionReady = true;
    ses.setPermissionRequestHandler((_wc, _perm, done) => done(false)); // no camera, location, notifications…
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault()); // a preview never saves files
  }
  return ses;
}

/**
 * A web page shown inside the app window: a sandboxed WebContentsView laid over the preview's frame. Unlike an iframe it isn't
 * stopped by X-Frame-Options, so any site can be read in place. Only one exists at a time.
 */
export class WebPreview {
  private view: WebContentsView | null = null;

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly emit: (channel: 'webPreview:state' | 'webPreview:escape', payload?: WebPreviewState) => void,
  ) {}

  show(url: string, bounds: ViewBounds) {
    const win = this.window();
    if (!win || !isHttp(url)) return;
    if (!this.view) this.view = this.create(win);
    this.setBounds(bounds);
    void this.view.webContents.loadURL(url).catch(() => undefined); // a failed load shows the browser's own error page
  }

  setBounds(b: ViewBounds) {
    const round = (n: number) => Math.max(0, Math.round(n));
    this.view?.setBounds({ x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) });
  }

  navigate(action: 'back' | 'forward' | 'reload') {
    const wc = this.view?.webContents;
    if (!wc) return;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
  }

  /** Removes the page entirely (stops its sound and scripts). Called on close, on lock and when the window goes away. */
  hide() {
    const view = this.view;
    if (!view) return;
    this.view = null;
    this.window()?.contentView.removeChildView(view);
    view.webContents.close();
  }

  private create(win: BrowserWindow) {
    const view = new WebContentsView({
      webPreferences: { session: previewSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
    });
    view.setBackgroundColor('#ffffff');
    const wc = view.webContents;
    // New windows ("open in new tab" links) load in place; anything that isn't http(s) is refused.
    wc.setWindowOpenHandler(({ url }) => {
      if (isHttp(url)) void wc.loadURL(url).catch(() => undefined);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (!isHttp(url)) e.preventDefault();
    });
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        e.preventDefault();
        this.emit('webPreview:escape');
      }
    });
    const report = () =>
      this.emit('webPreview:state', {
        url: wc.getURL(),
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page'] as const) wc.on(ev as 'did-start-loading', report);
    win.contentView.addChildView(view);
    return view;
  }
}
