import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Package, PackageOpen, Plus } from 'lucide-react';
import { MAX_TAGS, TAG_COLORS, type TagColor } from '@fatup/shared';
import type { Item } from '../../../shared-ipc';
import { splitExt } from '../lib/format';
import { useI18n } from '../lib/i18n';

const POPOVER_WIDTH = 264;

type EditProps = {
  /** Always the latest copy of the file, so tags toggled here show up straight away. */
  item: Item;
  anchor: DOMRect;
  onClose: () => void;
  /** Called with the full name (extension included) when it changed. */
  onRename: (name: string) => void;
  onTags: (tags: TagColor[]) => void;
};

/**
 * Finder-style popover: a name field (the extension stays fixed) above a row of colour dots.
 * Tags apply immediately. Enter or clicking away saves a changed name; Esc discards it.
 */
export function EditPopover({ item, anchor, onClose, onRename, onTags }: EditProps) {
  const { t } = useI18n();
  const { stem, ext } = splitExt(item.name);
  const [value, setValue] = useState(stem);
  const [hover, setHover] = useState<TagColor | null>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 });
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const discarded = useRef(false);
  const latest = useRef({ value, stem, ext, onRename });
  latest.current = { value, stem, ext, onRename };

  const commitName = () => {
    const { value: v, stem: s, ext: e, onRename: save } = latest.current;
    const next = v.trim();
    if (next !== '' && next !== s) save(next + e);
  };

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    // Whichever way the popover goes away (click away, another file's pencil, a tab change), a typed name is kept unless Esc was pressed.
    return () => {
      if (!discarded.current) commitName();
    };
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { height } = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - POPOVER_WIDTH - 8));
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 6) : below;
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const away = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (box.current?.contains(target)) return;
      if (e.type === 'pointerdown' && target?.closest('.rename-btn')) return; // the pencil toggles the popover itself
      onClose();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [onClose]);

  const full = item.tags.length >= MAX_TAGS;
  const toggle = (color: TagColor) => {
    if (item.tags.includes(color)) onTags(item.tags.filter((c) => c !== color));
    else if (!full) onTags([...item.tags, color]);
  };
  const label = (() => {
    if (!hover) return t.tagsHint;
    if (item.tags.includes(hover)) return t.removeTag(t.tagNames[hover]);
    return full ? t.tagsFull : t.addTag(t.tagNames[hover]);
  })();

  return (
    <div
      ref={box}
      className="popover"
      role="dialog"
      aria-label={t.rename}
      style={{ left: pos.left, top: pos.top, width: POPOVER_WIDTH }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onClose();
        else if (e.key === 'Escape') {
          discarded.current = true;
          onClose();
        }
      }}
    >
      <div className="rename">
        <input
          ref={input}
          className="rename__input"
          value={value}
          maxLength={255 - ext.length}
          aria-label={t.rename}
          onChange={(e) => setValue(e.target.value)}
        />
        {ext && <span className="rename__ext">{ext}</span>}
      </div>
      <hr className="popover__rule" />
      <div className="tag-picker" onMouseLeave={() => setHover(null)}>
        {TAG_COLORS.map((color) => {
          const on = item.tags.includes(color);
          const blocked = !on && full;
          return (
            <button
              key={color}
              type="button"
              className={`tag-pick${on ? ' tag-pick--on' : ''}${blocked ? ' tag-pick--blocked' : ''}`}
              style={{ background: `var(--tag-${color})` }}
              aria-label={on ? t.removeTag(t.tagNames[color]) : t.addTag(t.tagNames[color])}
              aria-pressed={on}
              aria-disabled={blocked}
              onMouseEnter={() => setHover(color)}
              onFocus={() => setHover(color)}
              onBlur={() => setHover(null)}
              onClick={() => toggle(color)}
            >
              {on ? <Check size={14} strokeWidth={3} /> : <Plus size={14} strokeWidth={3} className="tag-pick__plus" />}
            </button>
          );
        })}
      </div>
      <p className="popover__label">{label}</p>
    </div>
  );
}

const HOP_STEP_MS = 55;
const DOT_SLOT = 24; // dot width + gap, used to start each dot from inside the box

/**
 * A little box next to the refresh button. Opening it hops the colour dots out to its left, one after another;
 * the chosen ones swell and sit higher. Closing hops them back in. Closing it also clears the filter.
 */
export function TagFilter({ value, onChange }: { value: TagColor[]; onChange: (next: TagColor[]) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [bounce, setBounce] = useState(0); // bumped on every click to replay the box animation
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toggle = () => {
    setBounce((n) => n + 1);
    window.clearTimeout(timer.current);
    if (open && !closing) {
      onChange([]); // collapsing the box drops the filter
      setClosing(true);
      timer.current = window.setTimeout(() => {
        setOpen(false);
        setClosing(false);
      }, TAG_COLORS.length * 30 + 260);
    } else {
      setClosing(false);
      setOpen(true);
    }
  };

  const shown = open && !closing;
  const Icon = shown ? PackageOpen : Package;
  return (
    <div className="tag-filter" role="group" aria-label={t.filterByTagToggle}>
      {open && (
        <div className={`tag-filter__dots${closing ? ' is-closing' : ''}`}>
          {TAG_COLORS.map((color, i) => {
            const on = value.includes(color);
            const fromBox = (TAG_COLORS.length - i) * DOT_SLOT;
            return (
              <button
                key={color}
                type="button"
                className={`tag-filter__dot${on ? ' tag-filter__dot--on' : ''}`}
                style={
                  {
                    background: `var(--tag-${color})`,
                    '--hop-from': `${fromBox}px`,
                    '--hop-delay': `${(closing ? i : TAG_COLORS.length - 1 - i) * (closing ? 30 : HOP_STEP_MS)}ms`,
                  } as CSSProperties
                }
                title={t.filterByTag(t.tagNames[color])}
                aria-label={t.filterByTag(t.tagNames[color])}
                aria-pressed={on}
                onClick={() => onChange(on ? value.filter((c) => c !== color) : [...value, color])}
              />
            );
          })}
        </div>
      )}
      <button
        key={bounce}
        type="button"
        className={`icon-btn tag-box${bounce > 0 ? ' tag-box--bounce' : ''}${value.length > 0 ? ' is-active' : ''}`}
        title={t.filterByTagToggle}
        aria-label={t.filterByTagToggle}
        aria-expanded={shown}
        onClick={toggle}
      >
        <Icon size={20} />
              </button>
    </div>
  );
}
