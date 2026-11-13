import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Share2 } from 'lucide-react';
import type { SiteCategory } from '@fatup/shared';
import { BOXED_SITES, PINNED_SITES, type SiteFilter } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { SiteBadge } from './SiteBadge';

const OPEN_STEP_MS = 55;
const CLOSE_STEP_MS = 30;
const SLOT = 48; // icon button width + gap, used to start each icon from inside the box

/**
 * The link filter: "All", then the icons of Internet, YouTube, X and Threads, a divider, then a box. Opening the box hops the other platforms out to its
 * right, one after another (the same hop as the colour-tag box); closing hops them back in. Closing keeps the filter, and the box
 * shows the logo of the platform that is still selected.
 */
export function SiteFilterBar({ value, onChange, counts }: { value: SiteFilter; onChange: (next: SiteFilter) => void; counts: Record<SiteFilter, number> }) {
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
      setClosing(true);
      timer.current = window.setTimeout(() => {
        setOpen(false);
        setClosing(false);
      }, BOXED_SITES.length * CLOSE_STEP_MS + 260);
    } else {
      setClosing(false);
      setOpen(true);
    }
  };

  const pick = (site: SiteFilter) => onChange(value === site ? 'all' : site);
  const platformButton = (site: SiteCategory, style?: CSSProperties) => {
    const label = t.filterBySite(t.siteNames[site]);
    return (
      <button
        key={site}
        type="button"
        className={`chip chip--site chip--icon ${value === site ? 'chip--on' : ''}`}
        style={style}
        aria-pressed={value === site}
        aria-label={label}
        title={`${t.siteNames[site]} (${counts[site]})`}
        onClick={() => pick(site)}
      >
        <SiteBadge site={site} size={22} />
      </button>
    );
  };

  const shown = open && !closing;
  const hidden = !shown && (BOXED_SITES as string[]).includes(value) ? (value as SiteCategory) : null; // a selected platform tucked inside the box
  return (
    <nav className="site-chips" aria-label={t.tabLinks}>
      <button type="button" className={`chip chip--site ${value === 'all' ? 'chip--on' : ''}`} aria-pressed={value === 'all'} title={t.allSites} onClick={() => onChange('all')}>
        {t.allSites}
        <span className="chip__count">{counts.all}</span>
      </button>
      {PINNED_SITES.map((site) => platformButton(site))}
      <span className="site-chips__sep" aria-hidden />
      <button
        key={bounce}
        type="button"
        className={`icon-btn tag-box site-box${bounce > 0 ? ' tag-box--bounce' : ''}${hidden ? ' is-active' : ''}`}
        title={t.moreSites}
        aria-label={t.moreSites}
        aria-expanded={shown}
        onClick={toggle}
      >
        <Share2 size={26} strokeWidth={1.75} />
        {hidden && (
          <span className="site-box__badge">
            <SiteBadge site={hidden} size={14} />
          </span>
        )}
      </button>
      {open && (
        <div className={`site-chips__hop${closing ? ' is-closing' : ''}`}>
          {BOXED_SITES.map((site, i) =>
            platformButton(site, {
              '--hop-from': `${-(i + 1) * SLOT}px`,
              '--hop-delay': `${closing ? (BOXED_SITES.length - 1 - i) * CLOSE_STEP_MS : i * OPEN_STEP_MS}ms`,
            } as CSSProperties),
          )}
        </div>
      )}
    </nav>
  );
}
