import { useState, type MouseEvent } from 'react';
import { CheckCircle2, CloudUpload, MoreVertical, SearchX } from 'lucide-react';
import type { Item } from '../../../shared-ipc';
import { formatSize, formatTime, type DateGroup } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { FileIcon } from './FileIcon';

type ViewProps = {
  groups: DateGroup<Item>[];
  onOpen: (item: Item) => void;
  onMenu: (item: Item, x: number, y: number) => void;
};

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

export function FileGrid({ groups, onOpen, onMenu }: ViewProps) {
  const { t } = useI18n();
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="group">
          <h3 className="group__label">{g.label}</h3>
          <div className="grid">
            {g.items.map((item) => (
              <div
                key={item.id}
                className="tile"
                role="button"
                tabIndex={0}
                onClick={() => onOpen(item)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(item)}
                {...menuHandlers(item, onMenu)}
              >
                <div className="tile__head">
                  <FileIcon name={item.name} mime={item.mime} size={18} />
                  <span className="tile__name" title={item.name}>
                    {item.name}
                  </span>
                  <MoreButton item={item} onMenu={onMenu} />
                </div>
                <div className="tile__thumb">
                  <Thumb item={item} />
                  {item.downloaded && (
                    <span className="badge" title={t.downloaded}>
                      <CheckCircle2 size={18} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function FileList({ groups, onOpen, onMenu }: ViewProps) {
  const { t } = useI18n();
  return (
    <div className="list" role="table">
      <div className="list__row list__row--head" role="row">
        <span role="columnheader">{t.colName}</span>
        <span role="columnheader" className="col-from">
          {t.colFrom}
        </span>
        <span role="columnheader" className="col-time">
          {t.colTime}
        </span>
        <span role="columnheader" className="col-size">
          {t.colSize}
        </span>
        <span />
      </div>
      {groups.map((g) => (
        <section key={g.key} role="rowgroup">
          <h3 className="group__label group__label--list">{g.label}</h3>
          {g.items.map((item) => (
            <div
              key={item.id}
              className="list__row"
              role="row"
              tabIndex={0}
              onClick={() => onOpen(item)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(item)}
              {...menuHandlers(item, onMenu)}
            >
              <span className="list__name" role="cell">
                {item.thumbUrl ? (
                  <img className="list__mini" src={item.thumbUrl} alt="" loading="lazy" draggable={false} />
                ) : (
                  <FileIcon name={item.name} mime={item.mime} />
                )}
                <span className="ellipsis" title={item.name}>
                  {item.name}
                </span>
                {item.downloaded && <CheckCircle2 size={16} className="downloaded" aria-label={t.downloaded} />}
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

export function EmptyState({ searching }: { searching: boolean }) {
  const { t } = useI18n();
  return (
    <div className="empty">
      <div className="empty__art">{searching ? <SearchX size={56} /> : <CloudUpload size={56} />}</div>
      <h2>{searching ? t.noMatches : t.emptyTitle}</h2>
      {!searching && <p className="muted">{t.emptyHint}</p>}
    </div>
  );
}
