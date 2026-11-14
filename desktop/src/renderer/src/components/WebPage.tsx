import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Lock, RotateCw } from 'lucide-react';
import type { WebPreviewState } from '../../../shared-ipc';
import { useI18n } from '../lib/i18n';

/** The little browser bar over a page: back, forward, reload and the address. */
function BrowserBar({ state, onNavigate }: { state: WebPreviewState; onNavigate?: (a: 'back' | 'forward' | 'reload') => void }) {
  const { t } = useI18n();
  const secure = state.url.startsWith('https:');
  return (
    <div className="webpage__bar">
      {onNavigate && (
        <>
          <button className="icon-btn icon-btn--dark icon-btn--sm" onClick={() => onNavigate('back')} disabled={!state.canGoBack} aria-label={t.back} title={t.back}>
            <ArrowLeft size={18} />
          </button>
          <button className="icon-btn icon-btn--dark icon-btn--sm" onClick={() => onNavigate('forward')} disabled={!state.canGoForward} aria-label={t.pageForward} title={t.pageForward}>
            <ArrowRight size={18} />
          </button>
        </>
      )}
      <button className="icon-btn icon-btn--dark icon-btn--sm" onClick={() => onNavigate?.('reload')} aria-label={t.pageReload} title={t.pageReload}>
        {state.loading ? <Loader2 size={18} className="spin" /> : <RotateCw size={18} />}
      </button>
      <div className="webpage__address">
        {secure && <Lock size={13} aria-hidden />}
        <span className="ellipsis">{state.url}</span>
      </div>
      <span className="webpage__note">{t.privateSession}</span>
    </div>
  );
}

/**
 * Desktop: a real browser view (Electron WebContentsView) laid exactly over this box, so any site loads, framing rules or not.
 * The box only reserves the space and reports where it is; the page itself is drawn by the main process on top.
 */
export function NativePage({ url, onEscape }: { url: string; onEscape: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const escape = useRef(onEscape);
  escape.current = onEscape;
  const [state, setState] = useState<WebPreviewState>({ url, loading: true, canGoBack: false, canGoForward: false });

  useEffect(() => {
    const api = window.fatup.webPreview;
    const el = box.current;
    if (!api || !el) return;
    const bounds = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    setState({ url, loading: true, canGoBack: false, canGoForward: false });
    void api.show(url, bounds());
    const sync = () => api.setBounds(bounds());
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener('resize', sync);
    const offState = api.onState(setState);
    const offEscape = api.onEscape(() => escape.current());
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
      offState();
      offEscape();
      api.hide();
    };
  }, [url]);

  return (
    <div className="webpage">
      <BrowserBar state={state} onNavigate={(a) => window.fatup.webPreview?.navigate(a)} />
      <div className="webpage__view" ref={box} />
    </div>
  );
}

/** Web app: the page in a sandboxed iframe. Only used once the server has said the page allows being framed. */
export function FramedPage({ url, title }: { url: string; title: string }) {
  const [reloads, setReloads] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => setLoading(true), [url, reloads]);
  return (
    <div className="webpage">
      <BrowserBar state={{ url, loading, canGoBack: false, canGoForward: false }} onNavigate={() => setReloads((n) => n + 1)} />
      <iframe
        key={`${url}#${reloads}`}
        className="webpage__view"
        src={url}
        title={title}
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        onLoad={() => setLoading(false)}
      />
    </div>
  );
}
