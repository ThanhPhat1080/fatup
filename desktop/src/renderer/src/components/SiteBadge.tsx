import { Globe } from 'lucide-react';
import type { SiteCategory } from '@fatup/shared';
import { useI18n } from '../lib/i18n';
import { SITE_LOGOS } from '../lib/siteLogos';

/** The platform's logo, or a globe for any other site. Sized in pixels; the tooltip and screen-reader label is the platform name. */
export function SiteBadge({ site, size = 18 }: { site: SiteCategory; size?: number }) {
  const { t } = useI18n();
  const label = t.siteNames[site];
  if (site === 'internet') {
    return (
      <span className="site-badge site-badge--internet" style={{ width: size, height: size }} title={label} role="img" aria-label={label}>
        <Globe size={size} strokeWidth={1.75} />
      </span>
    );
  }
  const { path, color } = SITE_LOGOS[site];
  return (
    <span className="site-badge" style={{ width: size, height: size, color: color ?? 'var(--text)' }} title={label} role="img" aria-label={label}>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
        <path d={path} />
      </svg>
    </span>
  );
}
