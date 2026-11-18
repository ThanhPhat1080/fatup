import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { LockBackdrop } from './LockBackdrop';

/** The full-screen dark frame of the Vault's setup and recovery screens, in the same look as the gate. */
export function VaultFrame({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="lockscreen vaultscreen">
      <LockBackdrop />
      <div className="center-screen lockscreen__center">
        <div className="vault-card">
          <h1 className="vault-card__title">{title}</h1>
          {children}
          {onBack && (
            <button className="btn btn--text vault-card__back" onClick={onBack}>
              <ArrowLeft size={18} /> {t.goBack}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
