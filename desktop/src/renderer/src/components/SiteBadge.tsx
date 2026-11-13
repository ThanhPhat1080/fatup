import { Globe } from 'lucide-react';
import type { SiteCategory } from '@fatup/shared';
import { useI18n } from '../lib/i18n';

/** Simple letter badges in loosely brand-like colours; deliberately not the real logos. */
const LOOK: Record<Exclude<SiteCategory, 'internet'>, { bg: string; glyph: string }> = {
  facebook: { bg: '#1877f2', glyph: 'f' },
  youtube: { bg: '#e00000', glyph: '▶' },
  instagram: { bg: 'linear-gradient(135deg,#feda75,#d62976 55%,#4f5bd5)', glyph: 'ig' },
  threads: { bg: '#101010', glyph: '@' },
  shopee: { bg: '#ee4d2d', glyph: 'S' },
  tiktok: { bg: '#161823', glyph: '♪' },
};

export function SiteBadge({ site, size = 18 }: { site: SiteCategory; size?: number }) {
  const { t } = useI18n();
  const label = t.siteNames[site];
  if (site === 'internet') {
    return (
      <span className="site-badge site-badge--internet" style={{ width: size, height: size }} title={label} role="img" aria-label={label}>
        <Globe size={size - 4} />
      </span>
    );
  }
  const { bg, glyph } = LOOK[site];
  return (
    <span className="site-badge" style={{ width: size, height: size, background: bg, fontSize: Math.round(size * (glyph.length > 1 ? 0.5 : 0.62)) }} title={label} role="img" aria-label={label}>
      {glyph}
    </span>
  );
}
