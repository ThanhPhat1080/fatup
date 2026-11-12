import { useState, type MouseEvent } from 'react';
import { ArrowDown, ArrowUp, CloudUpload, MoreVertical, SearchX, Trash2 } from 'lucide-react';
import type { Item } from '../../../shared-ipc';
import { formatSize, formatTime, type DateGroup, type SortKey, type SortState } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { VaultIcon } from './VaultIcon';
import { FileIcon } from './FileIcon';

type ViewProps = {
  groups: DateGroup<Item>[];
  selected: ReadonlySet<string>;
  onToggle: (item: Item, range: boolean) => void;
  onOpen: (item: Item) => void;
  onMenu: (item: Item, x: number, y: number) => void;
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

function menuHandlers(item: Item, onMenu: ViewProps['onMenu']) {
  return {
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      onMenu(item, e.clientX, e.clientY);
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

export function FileGrid({ groups, selected, onToggle, onOpen, onMenu }: ViewProps) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="group">
          {g.label && <h3 className="group__label">{g.label}</h3>}
          <div className={`grid${selected.size > 0 ? ' grid--selecting' : ''}`}>
            {g.items.map((item) => (
              <div
                key={item.id}
                className={`tile${selected.has(item.id) ? ' tile--selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(item)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(item)}
                {...menuHandlers(item, onMenu)}
              >
                <div className="tile__head">
                  <span className="tile__check">
                    <Check item={item} selected={selected.has(item.id)} onToggle={onToggle} />
                  </span>
                  <FileIcon name={item.name} mime={item.mime} size={18} />
                  <span className="tile__name" title={item.name}>
                    {item.name}
                  </span>
                  <MoreButton item={item} onMenu={onMenu} />
                </div>
                <div className="tile__thumb">
                  <Thumb item={item} />
                </div>
              </div>
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

export function FileList({ groups, selected, onToggle, onOpen, onMenu, sort, onSort, allSelected, someSelected, onToggleAll, timeLabel }: ListProps) {
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
            <div
              key={item.id}
              className={`list__row${selected.has(item.id) ? ' list__row--selected' : ''}`}
              role="row"
              tabIndex={0}
              onClick={() => onOpen(item)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(item)}
              {...menuHandlers(item, onMenu)}
            >
              <span role="cell">
                <Check item={item} selected={selected.has(item.id)} onToggle={onToggle} />
              </span>
              <span className="list__name" role="cell">
                {item.thumbUrl ? (
                  <img className="list__mini" src={item.thumbUrl} alt="" loading="lazy" draggable={false} />
                ) : (
                  <FileIcon name={item.name} mime={item.mime} />
                )}
                <span className="ellipsis" title={item.name}>
                  {item.name}
                </span>
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
      <div className="empty__art">{searching ? <SearchX size={56} /> : trash ? <Trash2 size={56} /> : vault ? <VaultIcon size={56} /> : <CloudUpload size={56} />}</div>
      <h2>{searching ? t.noMatches : trash ? t.trashEmptyTitle : vault ? t.vaultEmptyTitle : t.emptyTitle}</h2>
      {!searching && <p className="muted">{trash ? t.trashEmptyHint : vault ? t.vaultEmptyHint : t.emptyHint}</p>}
    </div>
  );
}
