import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import type { SiteCategory } from '@fatup/shared';
import { useI18n } from '../lib/i18n';
import { SITE_LOGOS } from '../lib/siteLogos';

/** Where to look for a site's own icon: the one its page names (read with the preview), then the conventional /favicon.ico. */
export function siteIcons(link: { url: string | null; iconUrl?: string | null }): string[] {
  const out: string[] = [];
  if (link.iconUrl) out.push(link.iconUrl);
  try {
    const u = new URL(link.url ?? '');
    if (u.protocol === 'https:' || u.protocol === 'http:') out.push(`${u.origin}/favicon.ico`);
  } catch {
    // not an address: the globe it is
  }
  return out;
}

/**
 * The platform's logo; for any other site its own icon (`icons`, tried in order) and, when none loads, a globe.
 * Sized in pixels; the tooltip and screen-reader label is the platform name.
 */
export function SiteBadge({ site, size = 18, icons = [] }: { site: SiteCategory; size?: number; icons?: string[] }) {
  const { t } = useI18n();
  const [tried, setTried] = useState(0);
  const key = icons.join(' ');
  useEffect(() => setTried(0), [key]);
  const label = t.siteNames[site];
  if (site === 'internet') {
    const icon = icons[tried];
    if (icon) {
      return (
        <span className="site-badge site-badge--favicon" style={{ width: size, height: size }} title={label} role="img" aria-label={label}>
          <img src={icon} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" draggable={false} onError={() => setTried((n) => n + 1)} />
        </span>
      );
    }
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
