import { useI18n } from '../lib/i18n';

/** The important marker: a label pointing right, filled yellow when on, an outline when off (Gmail-style). */
export function ImportantIcon({ on, size = 18 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={`important-icon${on ? ' is-on' : ''}`}>
      <path d="M3.5 6.5h12.2l4.8 5.5-4.8 5.5H3.5l3.6-5.5z" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** Always shown right after an item's checkbox. A click toggles the marker; it never opens or selects the item. */
export function ImportantButton({ on, onToggle }: { on: boolean; onToggle?: () => void }) {
  const { t } = useI18n();
  const label = on ? t.unmarkImportant : t.markImportant;
  if (!onToggle) return on ? <ImportantIcon on /> : null;
  return (
    <button
      className={`icon-btn icon-btn--sm important-btn${on ? ' is-on' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <ImportantIcon on={on} />
    </button>
  );
}
