import type { Usage } from '../../../shared-ipc';
import { formatGb, usageLevel } from '../lib/format';
import { useI18n } from '../lib/i18n';

/** R2 storage used vs. the free tier: green, orange from 70%, red from 90%. */
export function StorageMeter({ usage }: { usage: Usage | null }) {
  const { t, locale } = useI18n();
  if (!usage) return null;
  const { usedBytes, limitBytes } = usage;
  const ratio = limitBytes > 0 ? usedBytes / limitBytes : 0;
  const pct = Math.round(ratio * 100);
  const level = usageLevel(usedBytes, limitBytes);
  const free = formatGb(Math.max(0, limitBytes - usedBytes), locale);

  return (
    <div className={`storage storage--${level}`} title={t.storageUsed(pct, free)}>
      <span className="storage__word">{t.storageWord}</span>
      <div className="storage__body">
        <div className="storage__bar" role="progressbar" aria-label={t.storageLabel} aria-valuenow={Math.min(100, pct)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
        <span className="storage__text">
          {formatGb(usedBytes, locale)} / {formatGb(limitBytes, locale)} GB
        </span>
      </div>
    </div>
  );
}
