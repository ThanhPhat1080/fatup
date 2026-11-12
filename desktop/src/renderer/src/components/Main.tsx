import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, List, RotateCw, Search, Settings as SettingsIcon, X } from 'lucide-react';
import type { AppState, Item, Prefs, Tab } from '../../../shared-ipc';
import { groupByDay, matchesQuery } from '../lib/format';
import { errorText, useI18n } from '../lib/i18n';
import { ConfirmDialog } from './Dialog';
import { EmptyState, FileGrid, FileList } from './Files';
import { Lightbox } from './Lightbox';
import { Logo } from './Logo';
import { ContextMenu, type MenuState } from './Menu';
import { Settings } from './Settings';
import { useToast } from './Toast';

const POLL_MS = 60_000;
const FOCUS_REFRESH_MIN_GAP_MS = 5_000;

export function Main({ state, onPrefs, onLocked }: { state: AppState; onPrefs: (p: Partial<Prefs>) => void; onLocked: () => void }) {
  const { t, locale } = useI18n();
  const { toast, toastNode } = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Item | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastRefresh = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    lastRefresh.current = Date.now();
    setLoading(true);
    const res = await window.fatup.list();
    setLoading(false);
    if (res.ok) {
      setItems(res.value);
      setError(null);
    } else if (res.error === 'locked') {
      onLocked();
    } else {
      setError(errorText(t, res.error));
    }
  }, [onLocked, t]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const onFocus = () => {
      if (Date.now() - lastRefresh.current > FOCUS_REFRESH_MIN_GAP_MS) refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        refresh();
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh]);

  const visible = useMemo(
    () => (items ?? []).filter((it) => (tab === 'all' || it.kind === tab) && matchesQuery(it.name, query)),
    [items, tab, query],
  );
  const groups = useMemo(() => groupByDay(visible, Date.now(), t, locale), [visible, t, locale]);
  const images = useMemo(() => visible.filter((it) => it.kind === 'image'), [visible]);
  const view = state.prefs.viewModes[tab];

  const inFlight = useRef(new Set<string>());

  async function download(item: Item) {
    // A double-click fires two clicks; never start the same download twice.
    if (inFlight.current.has(item.id)) return;
    inFlight.current.add(item.id);
    const res = await window.fatup.download(item.id).finally(() => inFlight.current.delete(item.id));
    if (res.ok) {
      setItems((list) => list?.map((it) => (it.id === item.id ? { ...it, downloaded: true } : it)) ?? null);
      toast(t.savedTo(res.value));
    } else toast(errorText(t, res.error), true);
  }

  async function copy(item: Item) {
    const res = await window.fatup.copyImage(item.id);
    toast(res.ok ? t.copied : errorText(t, res.error), !res.ok);
  }

  async function remove(item: Item) {
    setToDelete(null);
    setLightboxId((id) => (id === item.id ? null : id));
    const res = await window.fatup.remove(item.id);
    if (res.ok || res.error === 'not_found') {
      setItems((list) => list?.filter((it) => it.id !== item.id) ?? null);
      toast(t.deleted);
    } else toast(errorText(t, res.error), true);
  }

  const open = (item: Item) => (item.kind === 'image' ? setLightboxId(item.id) : download(item));
  const openMenu = (item: Item, x: number, y: number) => setMenu({ item, x, y });

  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: t.tabAll },
    { id: 'image', label: t.tabImages },
    { id: 'file', label: t.tabFiles },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>{t.appName}</span>
        </div>
        <label className="search">
          <Search size={20} aria-hidden />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} />
          {query && (
            <button className="icon-btn icon-btn--sm" onClick={() => setQuery('')} aria-label={t.close}>
              <X size={18} />
            </button>
          )}
        </label>
        <div className="topbar__actions">
          <button className="icon-btn" onClick={refresh} title={`${t.refresh} (Ctrl+R)`} aria-label={t.refresh} disabled={loading}>
            <RotateCw size={20} className={loading ? 'spin' : ''} />
          </button>
          <button
            className="icon-btn"
            onClick={() => onPrefs({ viewModes: { ...state.prefs.viewModes, [tab]: view === 'grid' ? 'list' : 'grid' } })}
            title={view === 'grid' ? t.listView : t.gridView}
            aria-label={view === 'grid' ? t.listView : t.gridView}
          >
            {view === 'grid' ? <List size={20} /> : <LayoutGrid size={20} />}
          </button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} title={t.settings} aria-label={t.settings}>
            <SettingsIcon size={20} />
          </button>
        </div>
      </header>

      <main className="panel">
        <nav className="chips" role="tablist">
          {tabs.map((tb) => (
            <button key={tb.id} role="tab" aria-selected={tab === tb.id} className={`chip ${tab === tb.id ? 'chip--on' : ''}`} onClick={() => setTab(tb.id)}>
              {tb.label}
            </button>
          ))}
        </nav>

        {error && (
          <div className="banner" role="alert">
            {error}
            <button className="btn btn--text" onClick={refresh}>
              {t.refresh}
            </button>
          </div>
        )}

        <div className="panel__scroll">
          {items === null ? (
            <div className="skeleton" aria-busy />
          ) : visible.length === 0 ? (
            <EmptyState searching={query !== '' && (items?.length ?? 0) > 0} />
          ) : view === 'grid' ? (
            <FileGrid groups={groups} onOpen={open} onMenu={openMenu} />
          ) : (
            <FileList groups={groups} onOpen={open} onMenu={openMenu} />
          )}
          {visible.length > 0 && <p className="footnote">{t.expiresNote}</p>}
        </div>
      </main>

      {menu && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onDownload={download}
          onCopy={copy}
          onDelete={(it) => setToDelete(it)}
        />
      )}
      {lightboxId && (
        <Lightbox
          items={images}
          currentId={lightboxId}
          onChange={setLightboxId}
          onClose={() => setLightboxId(null)}
          onDownload={download}
          onCopy={copy}
          onDelete={(it) => setToDelete(it)}
        />
      )}
      {toDelete && (
        <ConfirmDialog
          title={t.deleteTitle}
          body={t.deleteBody(toDelete.name)}
          confirmLabel={t.delete}
          danger
          onCancel={() => setToDelete(null)}
          onConfirm={() => remove(toDelete)}
        />
      )}
      {settingsOpen && (
        <Settings
          state={state}
          onClose={() => setSettingsOpen(false)}
          onPrefs={onPrefs}
          onToast={toast}
          onLock={async () => {
            await window.fatup.lock();
            onLocked();
          }}
          onSignOut={async () => {
            await window.fatup.reset();
            onLocked();
          }}
        />
      )}
      {toastNode}
    </div>
  );
}
