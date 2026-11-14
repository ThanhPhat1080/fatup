import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Copy, Download, MoreVertical, Pencil, SquareArrowOutUpRight } from 'lucide-react';
import type { Item } from '../../../shared-ipc';
import { cowsay, formatSize, formatTime, type DateGroup, type SortKey, type SortState } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { CowThumb } from './CowThumb';
import { FileIcon } from './FileIcon';
import { SiteBadge, siteIcons } from './SiteBadge';
import { ImportantButton } from './Important';

type ViewProps = {
  groups: DateGroup<Item>[];
  selected: ReadonlySet<string>;
  onToggle: (item: Item, range: boolean) => void;
  /** `outside` is set for Ctrl/⌘ + click: a link then opens in the browser instead of the preview. */
  onOpen: (item: Item, outside?: boolean) => void;
  onMenu: (item: Item, x: number, y: number) => void;
  /** Opens the rename / tag popover below `anchor`; the pencil is hidden when this is not given (e.g. in the trash). */
  onEdit?: (item: Item, anchor: DOMRect) => void;
  /** Copies a link's address; the copy button on link items is hidden when this is not given (e.g. in the trash). */
  onCopyLink?: (item: Item) => void;
  /** Toggles the important marker; without it (the trash) the marker only shows, as a plain icon, on items that have it. */
  onImportant?: (item: Item) => void;
  /** Grid: a download button over the middle of a file's card on hover or keyboard focus (hidden when not given, e.g. in the trash). */
  onDownload?: (item: Item) => void;
  /** Keys of the folded domain groups (links grouped by site). */
  collapsed?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
};

/** A group's heading: plain text for days, or for a site a button with its icon, name and count that folds the group. */
function GroupHeading({ group, list, collapsed, onToggleGroup }: { group: DateGroup<Item>; list?: boolean; collapsed?: ReadonlySet<string>; onToggleGroup?: (key: string) => void }) {
  const { t } = useI18n();
  if (!group.label) return null;
  const cls = `group__label${list ? ' group__label--list' : ''}`;
  if (!group.domain || !onToggleGroup) return <h3 className={cls}>{group.label}</h3>;
  const open = !collapsed?.has(group.key);
  const d = group.domain;
  return (
    <h3 className={`${cls} group__label--domain`}>
      <button className="group-toggle" aria-expanded={open} onClick={() => onToggleGroup(group.key)} aria-label={t.toggleGroup(group.label, group.items.length)}>
        <ChevronRight size={18} className={`group-toggle__chevron${open ? ' is-open' : ''}`} aria-hidden />
        <SiteBadge site={d.site} size={20} icons={siteIcons({ url: d.url, iconUrl: d.iconUrl })} />
        <span className="group-toggle__name">{group.label}</span>
        <span className="group-toggle__count">{group.items.length}</span>
      </button>
    </h3>
  );
}

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
    onClick: (e: MouseEvent) => {
      if (fired.current) {
        fired.current = false; // the press already selected it; swallow the click that follows
        return;
      }
      if (selecting) onToggle(item, false);
      else onOpen(item, e.metaKey || e.ctrlKey);
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

function RenameButton({ onClick, link }: { onClick: (anchor: DOMRect) => void; link?: boolean }) {
  const { t } = useI18n();
  const label = link ? t.editLink : t.rename;
  return (
    <button
      className="icon-btn icon-btn--sm rename-btn"
      aria-label={label}
      title={label}
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

/** Opens a link in the browser (a new tab on the web app), skipping the in-app preview. */
function OpenOutsideButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      className="icon-btn icon-btn--sm open-out-btn"
      aria-label={t.openInBrowser}
      title={t.openInBrowser}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <SquareArrowOutUpRight size={15} />
    </button>
  );
}

/** Copies a link's address with one click, right where the link is shown. */
function CopyLinkButton({ item, onCopy }: { item: Item; onCopy?: ViewProps['onCopyLink'] }) {
  const { t } = useI18n();
  if (item.kind !== 'link' || !onCopy) return null;
  return (
    <button
      className="icon-btn icon-btn--sm copy-btn"
      aria-label={t.copyLink}
      title={t.copyLink}
      onClick={(e) => {
        e.stopPropagation();
        onCopy(item);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Copy size={15} />
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
  if (item.kind === 'link') {
    // No preview image (yet, or the page has none): a little cow keeps the card from looking broken.
    return (
      <div className="thumb-fallback thumb-fallback--cow">
        <CowThumb size={84} />
      </div>
    );
  }
  return (
    <div className="thumb-fallback">
      <FileIcon name={item.name} mime={item.mime} size={48} />
    </div>
  );
}

/** The little picture before a name in the list: the thumbnail, or (when there is none or it fails to load) the file icon, or the platform logo for a link. The cow is for the grid only. */
function MiniThumb({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false);
  if (item.thumbUrl && !failed) {
    return <img className="list__mini" src={item.thumbUrl} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
  }
  return item.kind === 'link' ? <SiteBadge site={item.site ?? 'internet'} size={24} icons={siteIcons(item)} /> : <FileIcon name={item.name} mime={item.mime} />;
}

/** The small icon before a file's name: the site badge for links, the file-type icon otherwise. */
function KindIcon({ item, size }: { item: Item; size: number }) {
  if (item.kind === 'link' && item.site) return <SiteBadge site={item.site} size={size} icons={siteIcons(item)} />;
  return <FileIcon name={item.name} mime={item.mime} size={size} />;
}

type ItemProps = Pick<ViewProps, 'selected' | 'onToggle' | 'onOpen' | 'onMenu' | 'onEdit' | 'onCopyLink' | 'onImportant' | 'onDownload'> & { item: Item };
type RowProps = ItemProps & { siteColumn: boolean };

function Tile({ item, selected, onToggle, onOpen, onMenu, onEdit, onCopyLink, onImportant, onDownload }: ItemProps) {
  const { t } = useI18n();
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
        <ImportantButton on={!!item.important} onToggle={onImportant && (() => onImportant(item))} />
        <KindIcon item={item} size={18} />
        <span className="tile__name" title={item.name}>
          {item.name}
        </span>
        <TagDots tags={item.tags} />
        {(onEdit || (item.kind === 'link' && onCopyLink)) && (
          <span className="tile__actions">
            {onEdit && <RenameButton link={item.kind === 'link'} onClick={(r) => onEdit(item, r)} />}
            <CopyLinkButton item={item} onCopy={onCopyLink} />
          </span>
        )}
        <MoreButton item={item} onMenu={onMenu} />
      </div>
      <div className="tile__thumb">
        <Thumb item={item} />
        {onDownload && item.kind === 'file' && (
          // Always in the tab order; it shows on hover, on focus of the card, or when reached with Tab.
          <button
            className="tile__download"
            aria-label={t.downloadNamed(item.name)}
            title={t.download}
            onClick={(e) => {
              e.stopPropagation();
              onDownload(item);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Download size={22} />
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ item, selected, onToggle, onOpen, onMenu, onEdit, onCopyLink, onImportant, siteColumn }: RowProps) {
  const press = usePress(item, selected.size > 0, { onToggle, onOpen, onMenu });
  return (
    <div className={`list__row${selected.has(item.id) ? ' list__row--selected' : ''}`} role="row" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(item)} {...press}>
      <span role="cell">
        <Check item={item} selected={selected.has(item.id)} onToggle={onToggle} />
      </span>
      <span role="cell" className="col-important">
        <ImportantButton on={!!item.important} onToggle={onImportant && (() => onImportant(item))} />
      </span>
      {siteColumn && (
        <span role="cell" className="col-site">
          <SiteBadge site={item.site ?? 'internet'} size={22} icons={siteIcons(item)} />
        </span>
      )}
      <span className="list__name" role="cell">
        {!siteColumn && <MiniThumb item={item} />}
        <span className="ellipsis" title={item.url ?? item.name}>
          {item.name}
        </span>
        <TagDots tags={item.tags} />
        {!siteColumn && onEdit && <RenameButton link={item.kind === 'link'} onClick={(r) => onEdit(item, r)} />}
        {!siteColumn && <CopyLinkButton item={item} onCopy={onCopyLink} />}
      </span>
      {siteColumn && (
        // Links: the buttons get their own right-aligned column so they line up on every row; "open outside" joins them on hover or focus.
        <span role="cell" className="col-actions">
          {onEdit && <OpenOutsideButton onClick={() => onOpen(item, true)} />}
          {onEdit && <RenameButton link onClick={(r) => onEdit(item, r)} />}
          <CopyLinkButton item={item} onCopy={onCopyLink} />
        </span>
      )}
      <span role="cell" className="muted col-time">
        {formatTime(item.createdAt)}
      </span>
      {!siteColumn && (
        <span role="cell" className="muted col-size">
          {item.kind === 'link' ? '—' : formatSize(item.size)}
        </span>
      )}
      <span role="cell">
        <MoreButton item={item} onMenu={onMenu} />
      </span>
    </div>
  );
}

export function FileGrid({ groups, selected, onToggle, onOpen, onMenu, onEdit, onCopyLink, onImportant, onDownload, collapsed, onToggleGroup }: ViewProps) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="group">
          <GroupHeading group={g} collapsed={collapsed} onToggleGroup={onToggleGroup} />
          {!collapsed?.has(g.key) && (
            <div className={`grid${selected.size > 0 ? ' grid--selecting' : ''}`}>
              {g.items.map((item) => (
                <Tile key={item.id} item={item} selected={selected} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} onEdit={onEdit} onCopyLink={onCopyLink} onImportant={onImportant} onDownload={onDownload} />
              ))}
            </div>
          )}
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
  /** The links tab: adds a sortable column with each link's platform logo right after the checkbox. */
  siteColumn?: boolean;
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

export function FileList({ groups, selected, onToggle, onOpen, onMenu, onEdit, onCopyLink, onImportant, collapsed, onToggleGroup, sort, onSort, allSelected, someSelected, onToggleAll, timeLabel, siteColumn = false }: ListProps) {
  const { t } = useI18n();
  return (
    <div className={`list${siteColumn ? ' list--site' : ''}`} role="table">
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
        <span role="columnheader" className="col-important" aria-label={t.important} />
        {siteColumn && <SortHead id="site" label={t.colSite} sort={sort} onSort={onSort} className="col-site" />}
        <SortHead id="name" label={t.colName} sort={sort} onSort={onSort} />
        {siteColumn && <span role="columnheader" className="col-actions" />}
        <SortHead id="createdAt" label={timeLabel} sort={sort} onSort={onSort} className="col-time" />
        {!siteColumn && <SortHead id="size" label={t.colSize} sort={sort} onSort={onSort} className="col-size" />}
        <span />
      </div>
      {groups.map((g) => (
        <section key={g.key} role="rowgroup">
          <GroupHeading group={g} list collapsed={collapsed} onToggleGroup={onToggleGroup} />
          {!collapsed?.has(g.key) &&
            g.items.map((item) => (
              <Row key={item.id} item={item} selected={selected} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} onEdit={onEdit} onCopyLink={onCopyLink} onImportant={onImportant} siteColumn={siteColumn} />
            ))}
        </section>
      ))}
    </div>
  );
}

export function EmptyState({ searching, trash, vault, links }: { searching: boolean; trash?: boolean; vault?: boolean; links?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="empty">
      {/* Nothing here, or nothing that matches the search and filters: the same cow either way. */}
      <pre className="cowsay" role="img" aria-label={searching ? t.noMatches : trash ? t.trashEmptyTitle : vault ? t.vaultEmptyTitle : links ? t.cowLinks : t.emptyTitle}>
        {cowsay(searching ? t.noMatches : trash ? t.cowTrash : vault ? t.cowVault : links ? t.cowLinks : t.cowEmpty)}
      </pre>
      <p className="muted">{searching ? t.noMatchesHint : trash ? t.trashEmptyHint : vault ? t.vaultEmptyHint : links ? t.emptyLinksHint : t.emptyHint}</p>
    </div>
  );
}
