import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { SHARE_EXPIRY_DAYS, formatShareList, type ShareExpiryDays, type ShareInfo } from '@fatup/shared';
import type { Item } from '../../../shared-ipc';
import { errorText, useI18n, type Dict } from '../lib/i18n';
import { Dialog } from './Dialog';
import { usePopover } from './Tags';

type Choice = ShareExpiryDays | null;
const CHOICES: Choice[] = [null, ...SHARE_EXPIRY_DAYS];
const DAY = 24 * 60 * 60 * 1000;
const POPOVER_WIDTH = 340;

const choiceLabel = (t: Dict, c: Choice) => (c === null ? t.shareNever : t.shareDays(c));

/** The preset closest to an existing link's expiry (a link only ever has one of the presets, counted from when it was set). */
function choiceOf(info: ShareInfo): Choice {
  if (info.expiresAt === null) return null;
  const left = info.expiresAt - Date.now();
  return SHARE_EXPIRY_DAYS.reduce((best, d) => (Math.abs(left - d * DAY) < Math.abs(left - best * DAY) ? d : best), SHARE_EXPIRY_DAYS[0]);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Handlers = {
  /** The file's link was created (true) or stopped (false). */
  onChanged: (id: string, shared: boolean) => void;
  onToast: (message: string, isError?: boolean) => void;
  onClose: () => void;
};

/** The link of one file: create it, copy it, change its expiry, stop it. The same content serves the dialog and the popover. */
function ShareBody({ item, compact, onChanged, onToast, onClose }: { item: Item; compact?: boolean } & Handlers) {
  const { t } = useI18n();
  const [info, setInfo] = useState<ShareInfo | null | undefined>(undefined); // undefined while loading
  const [choice, setChoice] = useState<Choice>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    void window.fatup.getShare(item.id).then((res) => {
      if (!live.current) return;
      if (!res.ok) {
        onToast(errorText(t, res.error), true);
        return onClose();
      }
      setInfo(res.value);
      if (res.value) setChoice(choiceOf(res.value));
    });
    return () => {
      live.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const create = async () => {
    setBusy(true);
    const res = await window.fatup.setShare(item.id, choice);
    setBusy(false);
    if (!res.ok) return onToast(errorText(t, res.error), true);
    setInfo(res.value);
    onChanged(item.id, true);
    onToast((await copyText(res.value.url)) ? t.linkCopied : t.err_generic, false);
  };

  const pickExpiry = async (next: Choice) => {
    setChoice(next);
    if (!info) return; // before the link exists the choice is only remembered for "create"
    const res = await window.fatup.setShare(item.id, next);
    if (res.ok) setInfo(res.value);
    else onToast(errorText(t, res.error), true);
  };

  const stop = async () => {
    setBusy(true);
    const res = await window.fatup.stopShare(item.id);
    setBusy(false);
    if (!res.ok) return onToast(errorText(t, res.error), true);
    onChanged(item.id, false);
    onToast(t.shareStopped);
    onClose();
  };

  const copy = async () => {
    if (info) onToast((await copyText(info.url)) ? t.linkCopied : t.err_generic, false);
  };

  if (info === undefined) return <div className="share__loading" aria-busy />;

  const chips = (
    <div className="share__opts" role="group" aria-label={t.shareExpiresAfter}>
      {CHOICES.map((c) => (
        <button key={String(c)} type="button" className={`chip${choice === c ? ' chip--on' : ''}`} aria-pressed={choice === c} onClick={() => void pickExpiry(c)}>
          {choiceLabel(t, c)}
        </button>
      ))}
    </div>
  );

  return info ? (
    <div className="share">
      {!compact && <p className="dialog__body share__intro">{t.shareAnyone}</p>}
      <div className="share__link">
        <input readOnly value={info.url} aria-label={t.copyLink} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn--filled" onClick={() => void copy()}>
          <Copy size={16} /> {compact ? null : t.shareCopy}
        </button>
      </div>
      <span className="share__label">{t.shareExpiresAfter}</span>
      {chips}
      <div className="share__stats">
        <div>
          <b>{info.downloads}</b>
          {t.shareDownloads}
        </div>
        <div>
          <b>{info.lastAccessAt === null ? t.shareNobody : new Date(info.lastAccessAt).toLocaleString()}</b>
          {t.shareLastOpened}
        </div>
      </div>
      {!compact && <p className="share__note">{t.shareNote}</p>}
      <div className="row row--end">
        <button type="button" className="btn btn--text share__stop" disabled={busy} onClick={() => void stop()}>
          {t.shareStop}
        </button>
        {!compact && (
          <button type="button" className="btn btn--text" onClick={onClose}>
            {t.close}
          </button>
        )}
      </div>
    </div>
  ) : (
    <div className="share">
      <p className="dialog__body share__intro">{t.shareIntro}</p>
      <span className="share__label">{t.shareExpiresAfter}</span>
      {chips}
      <div className="row row--end">
        <button type="button" className="btn btn--text" onClick={onClose}>
          {t.cancel}
        </button>
        <button type="button" className="btn btn--filled" disabled={busy} onClick={() => void create()}>
          <Link2 size={16} /> {t.shareCreate}
        </button>
      </div>
    </div>
  );
}

/** Variant A: opened from the menu's "Share…". */
export function ShareDialog({ item, ...handlers }: { item: Item } & Handlers) {
  const { t } = useI18n();
  return (
    <Dialog title={t.shareTitle(item.name)} onClose={handlers.onClose} wide>
      <ShareBody item={item} {...handlers} />
    </Dialog>
  );
}

/** Variant B: opened by clicking the shared icon, anchored to it, a quick way to the same settings. */
export function SharePopover({ item, anchor, ...handlers }: { item: Item; anchor: DOMRect } & Handlers) {
  const { t } = useI18n();
  const { box, pos } = usePopover(anchor, handlers.onClose, POPOVER_WIDTH);
  return (
    <div
      ref={box}
      className="popover popover--share"
      role="dialog"
      aria-label={t.manageShare}
      style={{ left: pos.left, top: pos.top, width: POPOVER_WIDTH }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') handlers.onClose();
      }}
    >
      <ShareBody item={item} compact {...handlers} />
    </div>
  );
}

/** After sharing several files at once: one link per file, to copy one by one or all together. */
export function ShareListDialog({ rows, onClose, onToast }: { rows: { id: string; name: string; url: string }[]; onClose: () => void; onToast: (m: string, isError?: boolean) => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);
  const one = async (id: string, url: string) => {
    if (await copyText(url)) {
      setCopied(id);
      onToast(t.linkCopied);
    } else onToast(t.err_generic, true);
  };
  const all = async () => onToast((await copyText(formatShareList(rows))) ? t.linkCopied : t.err_generic, false);
  return (
    <Dialog title={t.shareLinksTitle} onClose={onClose} wide>
      <p className="dialog__body share__intro">{t.shareBulkHint}</p>
      <ul className="share__list">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="ellipsis" title={r.name}>
              {r.name}
            </span>
            <button type="button" className="icon-btn icon-btn--sm" aria-label={t.shareCopy} title={t.shareCopy} onClick={() => void one(r.id, r.url)}>
              {copied === r.id ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </li>
        ))}
      </ul>
      <div className="row row--end">
        <button type="button" className="btn btn--text" onClick={onClose}>
          {t.close}
        </button>
        <button type="button" className="btn btn--filled" onClick={() => void all()}>
          <Copy size={16} /> {t.shareCopyAll}
        </button>
      </div>
    </Dialog>
  );
}
