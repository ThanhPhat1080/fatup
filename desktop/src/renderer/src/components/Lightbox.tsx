import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, Info, Loader2, Maximize, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Item } from '../../../shared-ipc';
import { formatSize } from '../lib/format';
import { useI18n } from '../lib/i18n';

type Props = {
  items: Item[];
  currentId: string;
  onChange: (id: string) => void;
  onClose: () => void;
  onDownload: (item: Item) => void;
  onCopy: (item: Item) => void;
  onDelete: (item: Item) => void;
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const STEP = 1.25;
const clamp = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));

export function Lightbox({ items, currentId, onChange, onClose, onDownload, onCopy, onDelete }: Props) {
  const { t, locale } = useI18n();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showInfo, setShowInfo] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const index = items.findIndex((it) => it.id === currentId);
  const item = items[index];
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [fullFailed, setFullFailed] = useState(false);
  const [fullReady, setFullReady] = useState(false);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setFullUrl(null);
    setFullFailed(false);
    setFullReady(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDims(null);
    window.fatup.previewUrl(item.id).then((res) => {
      if (!cancelled && res.ok) setFullUrl(res.value);
    });
    return () => {
      cancelled = true;
    };
  }, [item?.id]);

  // Warm the cache for the neighbours so stepping through photos doesn't flash an empty frame.
  useEffect(() => {
    for (const n of [items[index - 1], items[index + 1]]) {
      if (n?.thumbUrl) new Image().src = n.thumbUrl;
    }
  }, [index, items]);

  const applyZoom = useCallback((next: number) => {
    const z = clamp(next);
    setZoom(z);
    if (z <= 1) setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') applyZoom(zoom * STEP);
      if (e.key === '-') applyZoom(zoom / STEP);
      if (e.key === 'ArrowUp') applyZoom(zoom / STEP);
      if (e.key === 'ArrowDown') applyZoom(zoom * STEP);
      if (e.key === '0') applyZoom(1);
      if (e.key === 'i' || e.key === 'I') setShowInfo((v) => !v);
      if (e.key === 'ArrowLeft' && index > 0) onChange(items[index - 1].id);
      if (e.key === 'ArrowRight' && index < items.length - 1) onChange(items[index + 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items, onChange, onClose, zoom, applyZoom]);

  if (!item) return null;
  const onWheel = (e: React.WheelEvent) => applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const when = new Date(item.createdAt).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US');
  const imgStyle = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'default' };
  const imgHandlers = { onDoubleClick: () => applyZoom(zoom > 1 ? 1 : 2.5), onPointerDown, onPointerMove, onPointerUp };

  return (
    <div className="lightbox" role="dialog" aria-modal aria-label={item.name}>
      <header className="lightbox__bar">
        <button className="icon-btn icon-btn--dark" onClick={onClose} aria-label={t.close} title={t.close}>
          <X size={22} />
        </button>
        <div className="lightbox__title">
          <span className="ellipsis">{item.name}</span>
          <span className="lightbox__meta">
            {formatSize(item.size)}
            {item.device ? ` · ${item.device}` : ''}
          </span>
        </div>
        <button className="icon-btn icon-btn--dark" onClick={() => applyZoom(zoom / STEP)} disabled={zoom <= MIN_ZOOM} aria-label={t.zoomOut} title={t.zoomOut}>
          <ZoomOut size={20} />
        </button>
        <button className="lightbox__zoom" onClick={() => applyZoom(1)} aria-label={t.zoomFit} title={t.zoomFit}>
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn icon-btn--dark" onClick={() => applyZoom(zoom * STEP)} disabled={zoom >= MAX_ZOOM} aria-label={t.zoomIn} title={t.zoomIn}>
          <ZoomIn size={20} />
        </button>
        <button className="icon-btn icon-btn--dark" onClick={() => applyZoom(1)} aria-label={t.zoomFit} title={t.zoomFit}>
          <Maximize size={20} />
        </button>
        <button className={`icon-btn icon-btn--dark${showInfo ? ' is-active' : ''}`} onClick={() => setShowInfo((v) => !v)} aria-label={t.details} title={t.details} aria-pressed={showInfo}>
          <Info size={20} />
        </button>
        <button className="icon-btn icon-btn--dark" onClick={() => onCopy(item)} aria-label={t.copyImage} title={t.copyImage}>
          <Copy size={20} />
        </button>
        <button className="icon-btn icon-btn--dark" onClick={() => onDownload(item)} aria-label={t.download} title={t.download}>
          <Download size={20} />
        </button>
        <button className="icon-btn icon-btn--dark" onClick={() => onDelete(item)} aria-label={t.delete} title={t.delete}>
          <Trash2 size={20} />
        </button>
      </header>
      <div className="lightbox__body">
      <div className="lightbox__stage" onWheel={onWheel} onClick={(e) => e.target === e.currentTarget && onClose()}>
        {index > 0 && (
          <button className="lightbox__nav lightbox__nav--prev" onClick={() => onChange(items[index - 1].id)} aria-label={t.previous}>
            <ChevronLeft size={28} />
          </button>
        )}
        {item.thumbUrl || (fullUrl && !fullFailed) ? (
          <>
            {/* The preview stays put underneath; the original fades in on top once decoded, so nothing blinks. */}
            {item.thumbUrl && <img key={`t-${item.id}`} src={item.thumbUrl} alt={item.name} style={imgStyle} {...imgHandlers} draggable={false} />}
            {fullUrl && !fullFailed && (
              <img
                key={`f-${item.id}`}
                className={`lightbox__full${fullReady ? ' is-ready' : ''}`}
                src={fullUrl}
                alt={item.name}
                style={imgStyle}
                {...imgHandlers}
                onLoad={(e) => {
                  setFullReady(true);
                  setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
                }}
                onError={() => setFullFailed(true)}
                draggable={false}
              />
            )}
          </>
        ) : (
          <Loader2 size={40} className="spin lightbox__spinner" />
        )}
        {!fullReady && !fullFailed && (item.thumbUrl || fullUrl) && <Loader2 size={22} className="spin lightbox__loading" />}
        {index < items.length - 1 && (
          <button className="lightbox__nav lightbox__nav--next" onClick={() => onChange(items[index + 1].id)} aria-label={t.nextItem}>
            <ChevronRight size={28} />
          </button>
        )}
      </div>
      {showInfo && (
        <aside className="lightbox__info" aria-label={t.details}>
          <h2>{t.details}</h2>
          <dl>
            <dt>{t.detName}</dt>
            <dd>{item.name}</dd>
            <dt>{t.detType}</dt>
            <dd>{item.mime}</dd>
            <dt>{t.detSize}</dt>
            <dd>{formatSize(item.size)}</dd>
            {dims && (
              <>
                <dt>{t.detDimensions}</dt>
                <dd>{dims.w} × {dims.h}</dd>
              </>
            )}
            <dt>{t.detUploaded}</dt>
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
    </div>
  );
}
