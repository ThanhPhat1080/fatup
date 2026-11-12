import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Download, Trash2 } from 'lucide-react';
import type { Item } from '../../../shared-ipc';
import { useI18n } from '../lib/i18n';

export type MenuState = { item: Item; x: number; y: number };

type Props = {
  state: MenuState;
  onClose: () => void;
  onDownload: (item: Item) => void;
  onCopy: (item: Item) => void;
  onDelete: (item: Item) => void;
};

export function ContextMenu({ state, onClose, onDownload, onCopy, onDelete }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(state.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(state.y, window.innerHeight - height - 8)),
    });
    el.querySelector('button')?.focus();
  }, [state.x, state.y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const act = (fn: (item: Item) => void) => () => {
    onClose();
    fn(state.item);
  };

  return (
    <div className="menu-layer" onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <div ref={ref} className="menu" role="menu" style={pos} onMouseDown={(e) => e.stopPropagation()}>
        <button role="menuitem" onClick={act(onDownload)}>
          <Download size={18} /> {t.download}
        </button>
        {state.item.kind === 'image' && (
          <button role="menuitem" onClick={act(onCopy)}>
            <Copy size={18} /> {t.copyImage}
          </button>
        )}
        <hr />
        <button role="menuitem" className="menu__danger" onClick={act(onDelete)}>
          <Trash2 size={18} /> {t.delete}
        </button>
      </div>
    </div>
  );
}
