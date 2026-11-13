import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, MoreVertical, Pencil, SearchX } from 'lucide-react';
import type { Item } from '../../../shared-ipc';
import { cowsay, formatSize, formatTime, type DateGroup, type SortKey, type SortState } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { FileIcon } from './FileIcon';

type ViewProps = {
  groups: DateGroup<Item>[];
  selected: ReadonlySet<string>;
  onToggle: (item: Item, range: boolean) => void;
  onOpen: (item: Item) => void;
  onMenu: (item: Item, x: number, y: number) => void;
  /** Opens the rename / tag popover below `anchor`; the pencil is hidden when this is not given (e.g. in the trash). */
  onEdit?: (item: Item, anchor: DOMRect) => void;
};

function Check({ item, selected, onToggle }: { item: Item; selected: boolean; onToggle: ViewProps['onToggle'] }) {
  const { t } = useI18n();
  return (
    <input
      type="checkbox"
      className="check"
      checked={selected}
      aria-label={t.selectItem(item.name)}
      onChange={() => undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(item, e.shiftKey);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

const LONG_PRESS_MS = 450;

/**
 * Touch gestures for a file: press and hold toggles its selection (the phone version of the hover checkbox), and once something
 * is selected a plain tap toggles too. Mouse and pen are untouched. The context menu that long-press would raise is suppressed
 * for touch, since the gesture already means "select".
 */
function usePress(item: Item, selecting: boolean, { onToggle, onOpen, onMenu }: Pick<ViewProps, 'onToggle' | 'onOpen' | 'onMenu'>) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const touched = useRef(false);
  const clear = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      touched.current = e.pointerType === 'touch';
      if (!touched.current) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(15);
        onToggle(item, false);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear(); // a scroll, not a press
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onClick: () => {
      if (fired.current) {
        fired.current = false; // the press already selected it; swallow the click that follows
        return;
      }
      if (selecting) onToggle(item, false);
      else onOpen(item);
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      if (!touched.current) onMenu(item, e.clientX, e.clientY);
    },
  };
}

function MoreButton({ item, onMenu }: { item: Item; onMenu: ViewProps['onMenu'] }) {
  const { t } = useI18n();
  return (
    <button
      className="icon-btn icon-btn--sm"
      aria-label={t.more}
      title={t.more}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onMenu(item, r.right, r.bottom);
      }}
    >
      <MoreVertical size={18} />
    </button>
  );
}

function RenameButton({ onClick }: { onClick: (anchor: DOMRect) => void }) {
  const { t } = useI18n();
  return (
    <button
      className="icon-btn icon-btn--sm rename-btn"
      aria-label={t.rename}
      title={t.rename}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e.currentTarget.getBoundingClientRect());
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Pencil size={15} />
    </button>
  );
}

/** Up to three colour dots shown beside a file name. */
export function TagDots({ tags }: { tags: Item['tags'] }) {
  const { t } = useI18n();
  if (tags.length === 0) return null;
  return (
    <span className="tag-dots" aria-label={tags.map((c) => t.tagNames[c]).join(', ')}>
      {tags.map((c) => (
        <span key={c} className="tag-dot" style={{ background: `var(--tag-${c})` }} />
      ))}
    </span>
  );
}

function Thumb({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false);
  if (item.thumbUrl && !failed) {
    return <img src={item.thumbUrl} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
  }
  return (
    <div className="thumb-fallback">
      <FileIcon name={item.name} mime={item.mime} size={48} />
    </div>
  );
}

type ItemProps = Pick<ViewProps, 'selected' | 'onToggle' | 'onOpen' | 'onMenu' | 'onEdit'> & { item: Item };

function Tile({ item, selected, onToggle, onOpen, onMenu, onEdit }: ItemProps) {
  const press = usePress(item, selected.size > 0, { onToggle, onOpen, onMenu });
  return (
    <div
      className={`tile${selected.has(item.id) ? ' tile--selected' : ''}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(item)}
      {...press}
    >
      <div className="tile__head">
        <span className="tile__check">
          <Check item={item} selected={selected.has(item.id)} onToggle={onToggle} />
        </span>
        <FileIcon name={item.name} mime={item.mime} size={18} />
        <span className="tile__name" title={item.name}>
          {item.name}
        </span>
        <TagDots tags={item.tags} />
        {onEdit && <RenameButton onClick={(r) => onEdit(item, r)} />}
        <MoreButton item={item} onMenu={onMenu} />
      </div>
      <div className="tile__thumb">
        <Thumb item={item} />
      </div>
    </div>
  );
}

function Row({ item, selected, onToggle, onOpen, onMenu, onEdit }: ItemProps) {
  const press = usePress(item, selected.size > 0, { onToggle, onOpen, onMenu });
  return (
    <div className={`list__row${selected.has(item.id) ? ' list__row--selected' : ''}`} role="row" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(item)} {...press}>
      <span role="cell">
        <Check item={item} selected={selected.has(item.id)} onToggle={onToggle} />
      </span>
      <span className="list__name" role="cell">
        {item.thumbUrl ? <img className="list__mini" src={item.thumbUrl} alt="" loading="lazy" draggable={false} /> : <FileIcon name={item.name} mime={item.mime} />}
        <span className="ellipsis" title={item.name}>
          {item.name}
        </span>
        <TagDots tags={item.tags} />
        {onEdit && <RenameButton onClick={(r) => onEdit(item, r)} />}
      </span>
      <span role="cell" className="muted col-from ellipsis">
        {item.device ?? '—'}
      </span>
      <span role="cell" className="muted col-time">
        {formatTime(item.createdAt)}
      </span>
      <span role="cell" className="muted col-size">
        {formatSize(item.size)}
      </span>
      <span role="cell">
        <MoreButton item={item} onMenu={onMenu} />
      </span>
    </div>
  );
}

export function FileGrid({ groups, selected, onToggle, onOpen, onMenu, onEdit }: ViewProps) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="group">
          {g.label && <h3 className="group__label">{g.label}</h3>}
          <div className={`grid${selected.size > 0 ? ' grid--selecting' : ''}`}>
            {g.items.map((item) => (
              <Tile key={item.id} item={item} selected={selected} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} onEdit={onEdit} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

type ListProps = ViewProps & {
  sort: SortState;
  onSort: (key: SortKey) => void;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
  /** Heading of the time column: "Uploaded", or "Deleted" in the trash. */
  timeLabel: string;
};

function SortHead({ id, label, sort, onSort, className }: { id: SortKey; label: string; sort: SortState; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === id;
  return (
    <span role="columnheader" className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className={`sort-head${active ? ' sort-head--on' : ''}`} onClick={() => onSort(id)}>
        {label}
        {active && (sort.dir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
      </button>
    </span>
  );
}

export function FileList({ groups, selected, onToggle, onOpen, onMenu, onEdit, sort, onSort, allSelected, someSelected, onToggleAll, timeLabel }: ListProps) {
  const { t } = useI18n();
  return (
    <div className="list" role="table">
      <div className="list__row list__row--head" role="row">
        <span role="columnheader">
          <input
            type="checkbox"
            className="check"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected && !allSelected;
            }}
            aria-label={t.selectAll}
            onChange={onToggleAll}
          />
        </span>
        <SortHead id="name" label={t.colName} sort={sort} onSort={onSort} />
        <span role="columnheader" className="col-from">
          {t.colFrom}
        </span>
        <SortHead id="createdAt" label={timeLabel} sort={sort} onSort={onSort} className="col-time" />
        <SortHead id="size" label={t.colSize} sort={sort} onSort={onSort} className="col-size" />
        <span />
      </div>
      {groups.map((g) => (
        <section key={g.key} role="rowgroup">
          {g.label && <h3 className="group__label group__label--list">{g.label}</h3>}
          {g.items.map((item) => (
            <Row key={item.id} item={item} selected={selected} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} onEdit={onEdit} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function EmptyState({ searching, trash, vault }: { searching: boolean; trash?: boolean; vault?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="empty">
      {searching ? (
        <>
          <div className="empty__art">
            <SearchX size={56} />
          </div>
          <h2>{t.noMatches}</h2>
        </>
      ) : (
        <pre className="cowsay" role="img" aria-label={trash ? t.trashEmptyTitle : vault ? t.vaultEmptyTitle : t.emptyTitle}>
          {cowsay(trash ? t.cowTrash : vault ? t.cowVault : t.cowEmpty)}
        </pre>
      )}
      {!searching && <p className="muted">{trash ? t.trashEmptyHint : vault ? t.vaultEmptyHint : t.emptyHint}</p>}
    </div>
  );
}
