import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Download, ExternalLink, Link2, Pencil, RotateCcw, RefreshCw, Trash2 } from 'lucide-react';
import type { Item } from '../../../shared-ipc';
import { useI18n } from '../lib/i18n';
import { VaultIcon } from './VaultIcon';

export type MenuState = { item: Item; x: number; y: number };

type Props = {
  state: MenuState;
  onClose: () => void;
  onDownload: (item: Item) => void;
  onCopy: (item: Item) => void;
  onDelete: (item: Item) => void;
  /** In the trash view the menu offers restore / delete forever instead. */
  /** Move to the Vault, or (when `inVault`) back out of it. */
  onVault?: (item: Item) => void;
  inVault?: boolean;
  trash?: { onRestore: (item: Item) => void; onForever: (item: Item) => void };
  /** Extra actions for link items. */
  link?: { onOpen: (item: Item) => void; onCopy: (item: Item) => void; onEdit: (item: Item, x: number, y: number) => void; onReload: (item: Item) => void };
};

export function ContextMenu({ state, onClose, onDownload, onCopy, onDelete, onVault, inVault, trash, link }: Props) {
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
        {trash ? (
          <>
            <button role="menuitem" onClick={act(trash.onRestore)}>
              <RotateCcw size={18} /> {t.restore}
            </button>
            <hr />
            <button role="menuitem" className="menu__danger" onClick={act(trash.onForever)}>
              <Trash2 size={18} /> {t.deleteForever}
            </button>
          </>
        ) : (
          <>
            {link && state.item.kind === 'link' ? (
              <>
                <button role="menuitem" onClick={act(link.onOpen)}>
                  <ExternalLink size={18} /> {t.openLink}
                </button>
                <button role="menuitem" onClick={act(link.onCopy)}>
                  <Link2 size={18} /> {t.copyLink}
                </button>
                <button role="menuitem" onClick={act((it) => link.onEdit(it, state.x, state.y))}>
                  <Pencil size={18} /> {t.editLink}
                </button>
                <button role="menuitem" onClick={act(link.onReload)}>
                  <RefreshCw size={18} /> {t.reloadPreview}
                </button>
              </>
            ) : (
              <button role="menuitem" onClick={act(onDownload)}>
                <Download size={18} /> {t.download}
              </button>
            )}
            {state.item.kind === 'image' && (
              <button role="menuitem" onClick={act(onCopy)}>
                <Copy size={18} /> {t.copyImage}
              </button>
            )}
            {onVault && (
              <button role="menuitem" onClick={act(onVault)}>
                <VaultIcon size={18} /> {inVault ? t.removeFromVault : t.moveToVault}
              </button>
            )}
            <hr />
            <button role="menuitem" className="menu__danger" onClick={act(onDelete)}>
              <Trash2 size={18} /> {t.moveToTrash}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
