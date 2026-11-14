import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Trash2, X } from 'lucide-react';
import type { Item } from '../../../shared-ipc';
import { formatSize } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { FileIcon } from './FileIcon';

/** Bigger files are only offered for download: the whole file is read into memory to be shown. */
const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;

export function isPdf(item: Pick<Item, 'kind' | 'mime' | 'name'>): boolean {
  return item.kind !== 'link' && (item.mime === 'application/pdf' || /\.pdf$/i.test(item.name));
}

type Props = {
  /** The PDFs shown in the list right now, in order; ← → steps through them. */
  items: Item[];
  currentId: string;
  onChange: (id: string) => void;
  onClose: () => void;
  onDownload: (item: Item) => void;
  onDelete: (item: Item) => void;
};

/**
 * A PDF opened inside the app with the browser's own PDF viewer (pages, zoom, search, print). The file is read once and handed to
 * the viewer as a blob, because the stored copy is served as a download. Phones whose browser has no PDF viewer get a download card.
 */
export function PdfPreview({ items, currentId, onChange, onClose, onDownload, onDelete }: Props) {
  const { t } = useI18n();
  const index = items.findIndex((it) => it.id === currentId);
  const item = items[index];
  const viewer = navigator.pdfViewerEnabled !== false;
  const canShow = !!item && viewer && item.size <= MAX_PREVIEW_BYTES;
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(null);
    setFailed(false);
    if (!item || !canShow) return;
    let cancelled = false;
    let url: string | null = null;
    void window.fatup.fileBytes(item.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) return setFailed(true);
      url = URL.createObjectURL(new Blob([res.value as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item?.id, canShow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onChange(items[index - 1].id);
      else if (e.key === 'ArrowRight' && index < items.length - 1) onChange(items[index + 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items, onChange, onClose]);

  if (!item) return null;

  return (
    <div className="lightbox linkprev pdfprev" role="dialog" aria-modal aria-label={item.name}>
      <header className="lightbox__bar">
        <button className="icon-btn icon-btn--dark" onClick={onClose} aria-label={t.close} title={t.close}>
          <X size={22} />
        </button>
        <FileIcon name={item.name} mime={item.mime} size={26} />
        <div className="lightbox__title">
          <span className="ellipsis">{item.name}</span>
          <span className="lightbox__meta">
            {formatSize(item.size)}
            {item.device ? ` · ${item.device}` : ''}
          </span>
        </div>
        <button className="btn btn--filled linkprev__open" onClick={() => onDownload(item)}>
          <Download size={18} />
          <span>{t.download}</span>
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
          {src ? (
            <iframe key={item.id} className="pdfprev__doc" src={`${src}#view=FitH`} title={item.name} />
          ) : canShow && !failed ? (
            <Loader2 size={36} className="spin lightbox__spinner" />
          ) : (
            <article className="linkprev__card">
              <div className="linkprev__pic">
                <FileIcon name={item.name} mime={item.mime} size={72} />
              </div>
              <div className="linkprev__cardbody">
                <h2>{item.name}</h2>
                <p>{t.pdfCantShow}</p>
                <div className="linkprev__cardactions">
                  <button className="btn btn--filled" onClick={() => onDownload(item)}>
                    <Download size={18} />
                    {t.download}
                  </button>
                </div>
              </div>
            </article>
          )}
          {index < items.length - 1 && (
            <button className="lightbox__nav lightbox__nav--next" onClick={() => onChange(items[index + 1].id)} aria-label={t.nextItem}>
              <ChevronRight size={28} />
            </button>
          )}
        </div>
      </div>
      <footer className="linkprev__footer">
        <button className="btn btn--filled" onClick={() => onDownload(item)}>
          <Download size={18} />
          {t.download}
        </button>
      </footer>
    </div>
  );
}
