import { useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { UploadJob } from '../../../shared-ipc';
import { errorText, useI18n } from '../lib/i18n';
import { formatSize } from '../lib/format';
import { FileIcon } from './FileIcon';

type Props = { jobs: UploadJob[]; onCancel: (id: string) => void; onClear: () => void };

/** Google Drive-style progress card, pinned to the bottom-right corner. */
export function UploadPanel({ jobs, onCancel, onClear }: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  if (jobs.length === 0) return null;

  const active = jobs.filter((j) => j.state === 'queued' || j.state === 'uploading').length;
  const done = jobs.filter((j) => j.state === 'done').length;
  const failed = jobs.filter((j) => j.state === 'error').length;
  const title = active > 0 ? t.uploadingN(active) : failed > 0 ? `${t.uploadsDone(done)} · ${t.uploadsFailed(failed)}` : t.uploadsDone(done);

  return (
    <section className="uploads" aria-label={t.upload} role="status">
      <header className="uploads__head">
        <span className="uploads__title">{title}</span>
        <button className="icon-btn icon-btn--sm" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? t.expand : t.collapse} title={collapsed ? t.expand : t.collapse}>
          {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {active === 0 && (
          <button className="icon-btn icon-btn--sm" onClick={onClear} aria-label={t.close} title={t.close}>
            <X size={18} />
          </button>
        )}
      </header>
      {!collapsed && (
        <ul className="uploads__list">
          {jobs.map((j) => {
            const pct = j.size > 0 ? Math.min(100, Math.round((j.sent / j.size) * 100)) : 0;
            const running = j.state === 'uploading' || j.state === 'queued';
            return (
              <li key={j.id} className="uploads__row">
                <FileIcon name={j.name} mime="" size={20} />
                <div className="uploads__info">
                  <span className="ellipsis" title={j.name}>
                    {j.name}
                  </span>
                  <span className={`uploads__sub${j.state === 'error' ? ' error' : ''}`}>
                    {j.state === 'queued' && t.uploadWaiting}
                    {j.state === 'uploading' && `${pct}% · ${formatSize(j.sent)} / ${formatSize(j.size)}`}
                    {j.state === 'done' && formatSize(j.size)}
                    {j.state === 'canceled' && t.uploadCanceled}
                    {j.state === 'error' && errorText(t, j.error ?? 'upload_failed')}
                  </span>
                  {j.state === 'uploading' && (
                    <div className="uploads__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                {running && (
                  <button className="icon-btn icon-btn--sm" onClick={() => onCancel(j.id)} aria-label={t.cancel} title={t.cancel}>
                    <X size={18} />
                  </button>
                )}
                {j.state === 'done' && <CheckCircle2 size={20} className="downloaded" aria-label={t.uploadDone} />}
                {j.state === 'error' && <AlertCircle size={20} className="uploads__err" aria-hidden />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
