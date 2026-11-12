import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'dialog--wide' : ''}`} role="dialog" aria-modal aria-label={title}>
        <header className="dialog__header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t.close} title={t.close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog title={props.title} onClose={props.onCancel}>
      <p className="dialog__body">{props.body}</p>
      <div className="row row--end">
        <button className="btn btn--text" onClick={props.onCancel} autoFocus>
          {t.cancel}
        </button>
        <button className={`btn ${props.danger ? 'btn--danger' : 'btn--filled'}`} onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
