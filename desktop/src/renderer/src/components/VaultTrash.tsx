import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RotateCcw, Trash2, X } from 'lucide-react';
import type { Item, Result } from '../../../shared-ipc';
import { formatTime } from '../lib/format';
import { errorText, useI18n } from '../lib/i18n';
import { vaultTrashLayout, vaultTrashSort } from '../lib/vault';
import { ConfirmDialog } from './Dialog';
import { FileIcon } from './FileIcon';
import { VaultTrashIcon } from './VaultTrashIcon';

type Props = {
  onClose: () => void;
  /** Called after a restore or a delete, so the Vault list behind the panel is reloaded. */
  onChanged: () => void;
  /** The app locked while the panel was doing something: the caller takes over. */
  onLocked: () => void;
};

/**
 * The trash of the open Vault: a sidebar above 720 px (the Vault stays open behind it), a full-screen page at 720 px and below.
 * Lists the deleted Vault items; restore, delete forever, and empty (after a confirmation). Never closes the Vault.
 */
export function VaultTrash({ onClose, onChanged, onLocked }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [layout, setLayout] = useState(() => vaultTrashLayout(window.innerWidth));

  useEffect(() => {
    const onResize = () => setLayout(vaultTrashLayout(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const load = useCallback(async () => {
    const res = await window.fatup.listVault({ trash: true });
    if (res.ok) setItems(vaultTrashSort(res.value));
    else if (res.error === 'locked') onLocked();
    else setError(errorText(t, res.error));
  }, [onLocked, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the panel, unless the confirmation over it is open (that one handles Escape itself).
  useEffect(() => {
    if (confirmEmpty) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmEmpty, onClose]);

  /** Runs `call` for each id, one after another; the ids that are gone (or were) leave the list. */
  async function apply(ids: string[], call: (id: string) => Promise<Result>) {
    if (ids.length === 0) return;
    setBusy(true);
    const gone = new Set<string>();
    let locked = false;
    for (const id of ids) {
      const res = await call(id);
      if (res.ok || res.error === 'not_found') gone.add(id);
      else if (res.error === 'locked') {
        locked = true;
        break;
      }
    }
    setBusy(false);
    if (locked) return onLocked();
    setItems((list) => list?.filter((it) => !gone.has(it.id)) ?? null);
    if (gone.size < ids.length) setError(t.partialFail(gone.size, ids.length - gone.size));
    else setError(null);
    onChanged();
  }

  const restore = (id: string) => apply([id], (x) => window.fatup.restore(x));
  const deleteForever = (id: string) => apply([id], (x) => window.fatup.removeForever(x));
  const emptyAll = () => {
    setConfirmEmpty(false);
    void apply(
      (items ?? []).map((it) => it.id),
      (x) => window.fatup.removeForever(x),
    );
  };

  const count = items?.length ?? 0;
  const overlay = layout === 'overlay';

  return (
    <>
      {!overlay && <div className="vault-trash-scrim" onClick={onClose} aria-hidden />}
      <aside className={`vault-trash vault-trash--${layout}`} role="dialog" aria-label={t.vaultTrashTitle}>
        <header className="vault-trash__head">
          {overlay && (
            <button className="icon-btn" onClick={onClose} title={t.backToFiles} aria-label={t.backToFiles}>
              <ArrowLeft size={20} />
            </button>
          )}
          <VaultTrashIcon size={26} />
          <div className="vault-trash__titles">
            <h2>{t.vaultTrashTitle}</h2>
            <p>{t.vaultTrashSubtitle}</p>
          </div>
          {!overlay && (
            <button className="icon-btn" onClick={onClose} title={t.close} aria-label={t.close}>
              <X size={20} />
            </button>
          )}
        </header>

        <div className="vault-trash__bar">
          <span className="muted">{items === null ? '' : t.vaultTrashCount({ n: count })}</span>
          <button className="btn btn--text btn--danger-text" disabled={busy || count === 0} onClick={() => setConfirmEmpty(true)}>
            <Trash2 size={18} /> {t.vaultTrashEmpty}
          </button>
        </div>

        {error && (
          <div className="banner" role="alert">
            {error}
          </div>
        )}

        <div className="vault-trash__list">
          {items === null ? (
            <div className="skeleton" aria-busy />
          ) : count === 0 ? (
            <p className="muted vault-trash__empty">{t.trashEmptyTitle}</p>
          ) : (
            items.map((it) => (
              <div className="vault-trash__row" key={it.id}>
                <FileIcon name={it.name} mime={it.mime} />
                <span className="vault-trash__info">
                  <span className="vault-trash__name ellipsis" title={it.unreadable ? undefined : it.name}>
                    {it.unreadable ? t.vaultUnreadable : it.name}
                  </span>
                  <span className="muted">{formatTime(it.deletedAt ?? it.createdAt)}</span>
                </span>
                <button className="btn btn--text" disabled={busy} onClick={() => void restore(it.id)}>
                  <RotateCcw size={18} /> {t.vaultTrashRestore}
                </button>
                <button className="btn btn--text btn--danger-text" disabled={busy} onClick={() => void deleteForever(it.id)}>
                  <Trash2 size={18} /> {t.vaultTrashDeleteForever}
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {confirmEmpty && (
        // The wrapper lets the CSS lift this dialog above the sidebar (see `.vault-trash-confirm` in styles.css).
        <div className="vault-trash-confirm">
          <ConfirmDialog
            title={t.vaultTrashEmptyAll}
            body={t.vaultTrashEmptyBody}
            confirmLabel={t.vaultTrashConfirmEmpty}
            danger
            onCancel={() => setConfirmEmpty(false)}
            onConfirm={emptyAll}
          />
        </div>
      )}
    </>
  );
}
