import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = { label: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode };

/** A small bordered "i" button: its text shows on hover or focus, and stays when clicked until you click away or press Esc. */
export function InfoPopover({ label, open, onOpenChange, children }: Props) {
  const root = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const shown = open || hover;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onOpenChange]);

  return (
    <span ref={root} className="info" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" className="info__btn" aria-label={label} aria-expanded={shown} onClick={() => onOpenChange(!open)}>
        i
      </button>
      {shown && (
        <div className="info__pop" role="tooltip">
          {children}
        </div>
      )}
    </span>
  );
}
