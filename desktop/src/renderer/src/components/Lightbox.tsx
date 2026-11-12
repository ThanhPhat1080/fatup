import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, Loader2, Trash2, X } from 'lucide-react';
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

export function Lightbox({ items, currentId, onChange, onClose, onDownload, onCopy, onDelete }: Props) {
  const { t } = useI18n();
  const index = items.findIndex((it) => it.id === currentId);
  const item = items[index];
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [fullFailed, setFullFailed] = useState(false);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setFullUrl(null);
    setFullFailed(false);
    window.fatup.previewUrl(item.id).then((res) => {
      if (!cancelled && res.ok) setFullUrl(res.value);
    });
    return () => {
      cancelled = true;
    };
  }, [item?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onChange(items[index - 1].id);
      if (e.key === 'ArrowRight' && index < items.length - 1) onChange(items[index + 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items, onChange, onClose]);

  if (!item) return null;
  // Show the thumbnail while the original loads, and keep it if the browser can't decode the original (e.g. HEIC).
  const src = fullUrl && !fullFailed ? fullUrl : item.thumbUrl;

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
      <div className="lightbox__stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {index > 0 && (
          <button className="lightbox__nav lightbox__nav--prev" onClick={() => onChange(items[index - 1].id)} aria-label={t.previous}>
            <ChevronLeft size={28} />
          </button>
        )}
        {src ? (
          <img key={src} src={src} alt={item.name} onError={() => fullUrl && setFullFailed(true)} draggable={false} />
        ) : (
          <Loader2 size={40} className="spin lightbox__spinner" />
        )}
        {fullUrl === null && src && <Loader2 size={22} className="spin lightbox__loading" />}
        {index < items.length - 1 && (
          <button className="lightbox__nav lightbox__nav--next" onClick={() => onChange(items[index + 1].id)} aria-label={t.nextItem}>
            <ChevronRight size={28} />
          </button>
        )}
      </div>
    </div>
  );
}
