import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, ExternalLink, Info, Loader2, Trash2, X } from 'lucide-react';
import { embedOf, type FrameCheck } from '@fatup/shared';
import type { Item } from '../../../shared-ipc';
import { useI18n } from '../lib/i18n';
import { hostOf, opensDirect, setOpensDirect } from '../lib/directHosts';
import { CowThumb } from './CowThumb';
import { SiteBadge, siteIcons } from './SiteBadge';
import { FramedPage, NativePage } from './WebPage';

type Props = {
  /** The links shown in the list right now, in order; ← → steps through them. */
  items: Item[];
  currentId: string;
  onChange: (id: string) => void;
  onClose: () => void;
  onOpenExternal: (item: Item) => void;
  onCopyLink: (item: Item) => void;
  onDelete: (item: Item) => void;
  /** On the web build "outside" is a new browser tab; on the desktop app, the default browser. */
  platform: 'desktop' | 'web';
};

/**
 * A saved link opened inside the app: the platform's own player or post where it offers one (YouTube, TikTok, Instagram, Threads,
 * X, Facebook), otherwise a card with the title and picture and a button to open it outside. Ctrl/⌘ + click in the list skips this.
 */
export function LinkPreview({ items, currentId, onChange, onClose, onOpenExternal, onCopyLink, onDelete, platform }: Props) {
  const { t, locale } = useI18n();
  const index = items.findIndex((it) => it.id === currentId);
  const item = items[index];
  const [loaded, setLoaded] = useState(false);
  const [showInfo, setShowInfo] = useState(() => window.innerWidth >= 1100);
  const [direct, setDirect] = useState(false);
  const embed = item ? embedOf(item.url ?? '') : null;
  // Pages without an official embed: the desktop app opens them in its own browser view; the web app asks the server whether
  // the page may be framed (most big sites say no) and falls back to the card.
  // Facebook shows a login wall to anyone not signed in, so its links get the card (og: title and picture) instead of the page.
  const cardOnly = item?.site === 'facebook';
  const native = !embed && !cardOnly && !!window.fatup.webPreview;
  const [frame, setFrame] = useState<FrameCheck | 'checking' | null>(null);
  useEffect(() => {
    setFrame(null);
    if (!item || embed || native || cardOnly || !window.fatup.linkFrame) return;
    let cancelled = false;
    setFrame('checking');
    void window.fatup.linkFrame(item.id).then((res) => {
      if (!cancelled) setFrame(res.ok ? res.value : { framable: false, url: item.url ?? '' });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.url]);

  useEffect(() => {
    setLoaded(false);
    setDirect(opensDirect(item?.url ?? null));
  }, [item?.id, item?.url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onChange(items[index - 1].id);
      else if (e.key === 'ArrowRight' && index < items.length - 1) onChange(items[index + 1].id);
      else if ((e.key === 'i' || e.key === 'I') && !(e.target instanceof HTMLInputElement)) setShowInfo((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items, onChange, onClose]);

  if (!item) return null;
  const host = hostOf(item.url);
  const site = item.site ?? 'internet';
  const openLabel = platform === 'web' ? t.openInNewTab : t.openInBrowser;
  const when = new Date(item.createdAt).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US');
  const toggleDirect = (on: boolean) => {
    setDirect(on);
    setOpensDirect(item.url, on);
  };

  return (
    <div className="lightbox linkprev" role="dialog" aria-modal aria-label={item.name}>
      <header className="lightbox__bar">
        <button className="icon-btn icon-btn--dark" onClick={onClose} aria-label={t.close} title={t.close}>
          <X size={22} />
        </button>
        <SiteBadge site={site} size={26} icons={siteIcons(item)} />
        <div className="lightbox__title">
          <span className="ellipsis">{item.name}</span>
          <span className="lightbox__meta ellipsis">{host}</span>
        </div>
        <button className="btn btn--outline-dark linkprev__open" onClick={() => onOpenExternal(item)}>
          <ExternalLink size={18} />
          <span>{openLabel}</span>
        </button>
        <button className="icon-btn icon-btn--dark" onClick={() => onCopyLink(item)} aria-label={t.copyLink} title={t.copyLink}>
          <Copy size={20} />
        </button>
        <button className={`icon-btn icon-btn--dark linkprev__infobtn${showInfo ? ' is-active' : ''}`} onClick={() => setShowInfo((v) => !v)} aria-label={t.details} title={t.details} aria-pressed={showInfo}>
          <Info size={20} />
        </button>
        <button className="icon-btn icon-btn--dark" onClick={() => onDelete(item)} aria-label={t.moveToTrash} title={t.moveToTrash}>
          <Trash2 size={20} />
        </button>
      </header>
      <div className="lightbox__body">
        <div className="lightbox__stage linkprev__stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
          {index > 0 && (
            <button className="lightbox__nav lightbox__nav--prev" onClick={() => onChange(items[index - 1].id)} aria-label={t.previous}>
              <ChevronLeft size={28} />
            </button>
          )}
          {embed ? (
            <div className={`linkprev__frame linkprev__frame--${embed.shape}`}>
              {!loaded && <Loader2 size={36} className="spin linkprev__spinner" />}
              <iframe
                key={item.id}
                src={embed.src}
                title={item.name}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
                onLoad={() => setLoaded(true)}
              />
            </div>
          ) : native ? (
            <NativePage url={item.url ?? ''} onEscape={onClose} />
          ) : frame === 'checking' ? (
            <Loader2 size={36} className="spin lightbox__spinner" />
          ) : frame?.framable ? (
            <FramedPage url={frame.url} title={item.name} />
          ) : (
            <article className="linkprev__card">
              <div className="linkprev__pic">{item.thumbUrl ? <img src={item.thumbUrl} alt="" /> : <CowThumb size={120} />}</div>
              <div className="linkprev__cardbody">
                <h2>{item.name}</h2>
                <p>{t.noEmbed(host)}</p>
                <div className="linkprev__cardactions">
                  <button className="btn btn--filled" onClick={() => onOpenExternal(item)}>
                    <ExternalLink size={18} />
                    {openLabel}
                  </button>
                  <button className="btn btn--outline-dark" onClick={() => onCopyLink(item)}>
                    {t.copyLink}
                  </button>
                </div>
                {host && (
                  <label className="linkprev__direct">
                    <input type="checkbox" checked={direct} onChange={(e) => toggleDirect(e.target.checked)} />
                    {t.alwaysOpenDirect(host)}
                  </label>
                )}
              </div>
            </article>
          )}
          {index < items.length - 1 && (
            <button className="lightbox__nav lightbox__nav--next" onClick={() => onChange(items[index + 1].id)} aria-label={t.nextItem}>
              <ChevronRight size={28} />
            </button>
          )}
          <p className="linkprev__keys">{t.previewKeys}</p>
        </div>
        {showInfo && (
          <aside className="lightbox__info linkprev__info" aria-label={t.details}>
            <h2>{t.details}</h2>
            <dl>
              <dt>{t.detAddress}</dt>
              <dd>{item.url}</dd>
              <dt>{t.detSite}</dt>
              <dd>{t.siteNames[site]}</dd>
              <dt>{t.detSaved}</dt>
              <dd>{when}</dd>
              {item.device && (
                <>
                  <dt>{t.detDevice}</dt>
                  <dd>{item.device}</dd>
                </>
              )}
            </dl>
          </aside>
        )}
      </div>
      <footer className="linkprev__footer">
        <button className="btn btn--filled" onClick={() => onOpenExternal(item)}>
          <ExternalLink size={18} />
          {openLabel}
        </button>
      </footer>
    </div>
  );
}
