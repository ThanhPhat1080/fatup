import { useEffect, useState, type FormEvent } from 'react';
import { extractUrl, normalizeUrl } from '@fatup/shared';
import { errorText, useI18n } from '../lib/i18n';
import { Dialog } from './Dialog';

/** Bookmark a link by pasting it. The field is pre-filled when the clipboard already holds an address. */
export function AddLinkDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (url: string, title: string) => Promise<string | null> }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Reading the clipboard can be refused (permissions, focus); then the field simply starts empty.
    navigator.clipboard
      ?.readText()
      .then((text) => {
        const found = extractUrl(text);
        if (found) setUrl((cur) => cur || found);
      })
      .catch(() => undefined);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const clean = normalizeUrl(extractUrl(url) ?? url);
    if (!clean) return setError(errorText(t, 'bad_url'));
    setBusy(true);
    const code = await onAdd(clean, title.trim());
    setBusy(false);
    if (code) setError(errorText(t, code));
  };

  return (
    <Dialog title={t.addLink} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="dialog__body">{t.addLinkHint}</p>
        <label className="field">
          <span>{t.linkUrl}</span>
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="https://…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </label>
        <label className="field">
          <span>{t.linkTitleOptional}</span>
          <input value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row row--end">
          <button type="button" className="btn btn--text" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn btn--filled" disabled={busy || url.trim() === ''}>
            {t.save}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
