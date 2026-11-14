import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronsDownUp, ChevronsUpDown, Download, LayoutGrid, Link2, List, Plus, RotateCcw, RotateCw, Search, Settings as SettingsIcon, Trash2, Upload, UploadCloud, X } from 'lucide-react';
import type { AppState, Item, Prefs, Tab, UploadJob, Usage } from '../../../shared-ipc';
import { DEFAULT_QUOTA_BYTES, type TagColor } from '@fatup/shared';
import { DEFAULT_SORT, groupByDay, groupByDomain, inTab, matchesLink, matchesQuery, matchesSite, matchesTags, singleGroup, siteCounts, sortItems, type SiteFilter, type SortKey, type SortState } from '../lib/format';
import { errorText, useI18n } from '../lib/i18n';
import { AddLinkDialog } from './AddLinkDialog';
import { ConfirmDialog } from './Dialog';
import { EmptyState, FileGrid, FileList } from './Files';
import { Lightbox } from './Lightbox';
import { LinkPreview } from './LinkPreview';
import { IconSwitch } from './IconSwitch';
import { ImportantIcon } from './Important';
import { PdfPreview, isPdf } from './PdfPreview';
import { opensDirect } from '../lib/directHosts';
import { Logo } from './Logo';
import { ContextMenu, type MenuState } from './Menu';
import { Settings } from './Settings';
import { VaultIcon } from './VaultIcon';
import { TrashIcon } from './TrashIcon';
import { InfoPopover } from './InfoPopover';
import { VaultGate } from './VaultGate';
import { StorageMeter } from './StorageMeter';
import { SiteFilterBar } from './SiteFilterBar';
import { EditPopover, LinkEditPopover, TagFilter } from './Tags';
import { useToast } from './Toast';
import { UploadPanel } from './UploadPanel';

let sharedLinkTaken = false; // a link shared into the PWA is handled once per page load, even if the lock screen comes and goes
const POLL_MS = 60_000;
const FOCUS_REFRESH_MIN_GAP_MS = 5_000;
/** Previews are fetched when the app opens, newest links first, a couple at a time and not more than this many per session. */
const PREVIEW_BUDGET = 20;
const PREVIEW_PARALLEL = 2;

export function Main({ state, onPrefs, onLocked }: { state: AppState; onPrefs: (p: Partial<Prefs>) => void; onLocked: () => void }) {
  const { t, locale } = useI18n();
  const { toast, toastNode } = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [tagFilter, setTagFilter] = useState<TagColor[]>([]);
  const [siteFilter, setSiteFilter] = useState<SiteFilter>('all');
  const [importantOnly, setImportantOnly] = useState(false);
  /** Items that were important when the list was last loaded. They go first in their group; marking one later leaves it in place
   *  until the next load, so nothing jumps under the mouse. */
  const [topIds, setTopIds] = useState<ReadonlySet<string>>(new Set());
  /** Folded domain groups on the links tab. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [addingLink, setAddingLink] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [linkPreviewId, setLinkPreviewId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [trashItems, setTrashItems] = useState<Item[] | null>(null);
  const [inTrash, setInTrash] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [inVault, setInVault] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultItems, setVaultItems] = useState<Item[] | null>(null);
  const [shiver, setShiver] = useState(0);
  const [trashKick, setTrashKick] = useState(0); // bumped when the trash opens, to replay its lid animation
  const [trashInfoOpen, setTrashInfoOpen] = useState(false);
  const vaultActive = inVault && vaultUnlocked;
  const vaultActiveRef = useRef(false);
  vaultActiveRef.current = vaultActive;
  const [confirm, setConfirm] = useState<{ kind: 'forever'; items: Item[] } | { kind: 'empty' } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const canUpload = true; // desktop streams from disk, the web build uploads File objects; both satisfy the same bridge
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Prefer the server's figure; if it isn't available (e.g. an older server), add up the files we already have.
  const shownUsage = useMemo<Usage | null>(() => {
    if (usage) return usage;
    if (items === null) return null;
    const total = [...items, ...(trashItems ?? []), ...(vaultItems ?? [])].reduce((sum, it) => sum + it.size, 0);
    return { usedBytes: total, limitBytes: DEFAULT_QUOTA_BYTES };
  }, [usage, items, trashItems, vaultItems]);
  const lastPicked = useRef<string | null>(null);
  const lastRefresh = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    lastRefresh.current = Date.now();
    setLoading(true);
    const [res, trashRes, usageRes, vaultRes] = await Promise.all([
      window.fatup.list(),
      window.fatup.listTrash(),
      window.fatup.usage(),
      vaultActive ? window.fatup.listVault() : Promise.resolve(null),
    ]);
    setLoading(false);
    if (vaultRes) {
      if (vaultRes.ok) setVaultItems(vaultRes.value);
      else if (vaultRes.error === 'vault_locked') setVaultUnlocked(false);
      else if (vaultRes.error !== 'locked') setError(errorText(t, vaultRes.error));
    }
    if (res.ok) {
      setItems(res.value);
      setTopIds(new Set([...res.value, ...(vaultRes?.ok ? vaultRes.value : [])].filter((it) => it.important).map((it) => it.id)));
      if (trashRes.ok) setTrashItems(trashRes.value);
      if (usageRes.ok) setUsage(usageRes.value);
      setError(null);
    } else if (res.error === 'locked') {
      onLocked();
    } else {
      setError(errorText(t, res.error));
    }
  }, [onLocked, t, vaultActive]);

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

  // In the trash the "time" shown and sorted on is when a file was deleted, so we feed it through createdAt.
  const source = useMemo(
    () => (inTrash ? (trashItems ?? []).map((it) => ({ ...it, createdAt: it.deletedAt ?? it.createdAt })) : inVault ? (vaultItems ?? []) : (items ?? [])),
    [inTrash, inVault, trashItems, vaultItems, items],
  );
  const loaded = inTrash ? trashItems !== null : inVault ? vaultItems !== null : items !== null;
  const linkTab = tab === 'link' && !inTrash;
  const visible = useMemo(
    () =>
      source.filter(
        (it) =>
          (inTrash || inTab(it, tab)) &&
          (it.kind === 'link' ? matchesLink(it, query) : matchesQuery(it.name, query)) &&
          matchesTags(it.tags, tagFilter) &&
          (inTrash || !importantOnly || !!it.important) &&
          (!linkTab || matchesSite(it, siteFilter)),
      ),
    [source, inTrash, tab, query, tagFilter, importantOnly, linkTab, siteFilter],
  );
  const counts = useMemo(() => siteCounts(source.filter((it) => it.kind === 'link')), [source]);
  const kindCounts = useMemo(
    () => ({ image: source.filter((it) => inTab(it, 'image')).length, file: source.filter((it) => inTab(it, 'file')).length, link: source.filter((it) => inTab(it, 'link')).length }),
    [source],
  );
  const sorted = useMemo(() => sortItems(visible, sort), [visible, sort]);
  // Day headings only make sense when ordered by upload time.
  // Links tab with "All" platforms: one group per site (important links first in each); otherwise day headings when ordered by time.
  const byDomain = linkTab && siteFilter === 'all';
  const groups = useMemo(
    () =>
      byDomain ? groupByDomain(sorted, (s) => t.siteNames[s], (it) => topIds.has(it.id)) : sort.key === 'createdAt' ? groupByDay(sorted, Date.now(), t, locale) : singleGroup(sorted),
    [byDomain, sorted, sort.key, t, locale, topIds],
  );
  const allExpanded = !byDomain || groups.every((g) => !collapsed.has(g.key));
  const toggleGroup = useCallback(
    (key: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );

  // Selection only ever acts on what's currently visible, so a filter can't hide files from a bulk delete.
  const picked = useMemo(() => sorted.filter((it) => selected.has(it.id)), [sorted, selected]);
  const allSelected = sorted.length > 0 && picked.length === sorted.length;

  const toggle = useCallback(
    (item: Item, range: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const from = lastPicked.current ? sorted.findIndex((it) => it.id === lastPicked.current) : -1;
        if (range && from >= 0) {
          const to = sorted.findIndex((it) => it.id === item.id);
          for (const it of sorted.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(it.id);
        } else if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      lastPicked.current = item.id;
    },
    [sorted],
  );
  const selectAll = useCallback(() => setSelected(new Set(sorted.map((it) => it.id))), [sorted]);
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    lastPicked.current = null;
  }, []);
  const changeSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'site' ? 'asc' : 'desc' }));

  // Drop selections for files that no longer exist (deleted elsewhere, expired).
  useEffect(() => {
    const ids = new Set(source.map((it) => it.id));
    setSelected((prev) => (Array.from(prev).every((id) => ids.has(id)) ? prev : new Set(Array.from(prev).filter((id) => ids.has(id)))));
  }, [source]);

  // The Vault closes whenever you leave it, so coming back always asks for the PIN again.
  const leaveVault = useCallback(() => {
    void window.fatup.vaultClose();
    setInVault(false);
    setVaultUnlocked(false);
    setVaultItems(null);
  }, []);
  useEffect(() => () => void window.fatup.vaultClose(), []);

  const toggleTrash = () => {
    if (inVault) leaveVault();
    if (!inTrash) setTrashKick((n) => n + 1);
    setTrashInfoOpen(false);
    setInTrash((v) => !v);
    clearSelection();
  };
  /** The FatUp logo: back to the plain file list, with nothing filtered, selected or open. */
  const goHome = () => {
    if (inVault) leaveVault();
    setInTrash(false);
    setTab('all');
    setSiteFilter('all');
    setQuery('');
    setSettingsOpen(false);
    setLightboxId(null);
    setLinkPreviewId(null);
    setPdfId(null);
    setMenu(null);
    clearSelection();
  };
  const toggleVault = () => {
    setShiver((n) => n + 1);
    if (inVault) leaveVault();
    else {
      setInTrash(false);
      setInVault(true);
    }
    clearSelection();
  };

  /** Runs `fn` over the targets four at a time; returns the ids that succeeded. "Already gone" counts as success. */
  async function batch(targets: Item[], fn: (id: string) => Promise<{ ok: boolean; error?: string }>, limit = 4) {
    const done = new Set<string>();
    let locked = false;
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const item = targets[cursor++];
        const res = await fn(item.id);
        if (res.ok || res.error === 'not_found') done.add(item.id);
        else if (res.error === 'locked') locked = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));
    if (locked) onLocked();
    return { done, failed: targets.length - done.size, locked };
  }

  const report = (ok: number, failed: number, success: string, action?: { label: string; onClick: () => void }) =>
    failed === 0 ? toast(success, false, action) : toast(t.partialFail(ok, failed), true);

  async function restoreMany(targets: Item[], backToVault = false) {
    const { done, failed, locked } = await batch(targets, (id) => window.fatup.restore(id));
    if (locked) return;
    // Deleting takes a file out of the Vault, so an "Undo" has to put it back.
    if (backToVault) await batch(targets.filter((it) => done.has(it.id)), (id) => window.fatup.setVault(id, true));
    setTrashItems((list) => list?.filter((it) => !done.has(it.id)) ?? null);
    clearSelection();
    report(done.size, failed, t.restored(done.size));
    refresh();
  }

  /** Moves files to the trash. No confirmation: the toast offers Undo. */
  async function moveToTrash(targets: Item[]) {
    if (targets.length === 0) return;
    setLightboxId((id) => (id && targets.some((it) => it.id === id) ? null : id));
    setLinkPreviewId((id) => (id && targets.some((it) => it.id === id) ? null : id));
    setPdfId((id) => (id && targets.some((it) => it.id === id) ? null : id));
    const { done, failed, locked } = await batch(targets, (id) => window.fatup.remove(id));
    if (locked) return;
    setItems((list) => list?.filter((it) => !done.has(it.id)) ?? null);
    setVaultItems((list) => list?.filter((it) => !done.has(it.id)) ?? null);
    clearSelection();
    const moved = targets.filter((it) => done.has(it.id));
    const fromVault = vaultActive;
    report(done.size, failed, t.movedToTrash(done.size), {
      label: t.undo,
      onClick: () => void restoreMany(moved, fromVault),
    });
    refresh();
  }

  async function moveToVault(targets: Item[]) {
    if (targets.length === 0) return;
    setLightboxId(null);
    setLinkPreviewId(null);
    setPdfId(null);
    const { done, failed, locked } = await batch(targets, (id) => window.fatup.setVault(id, true));
    if (locked) return;
    setItems((list) => list?.filter((it) => !done.has(it.id)) ?? null);
    clearSelection();
    report(done.size, failed, t.movedToVault(done.size));
    refresh();
  }

  async function removeFromVault(targets: Item[]) {
    if (targets.length === 0) return;
    setLightboxId(null);
    setLinkPreviewId(null);
    setPdfId(null);
    const { done, failed, locked } = await batch(targets, (id) => window.fatup.setVault(id, false));
    if (locked) return;
    setVaultItems((list) => list?.filter((it) => !done.has(it.id)) ?? null);
    clearSelection();
    report(done.size, failed, t.removedFromVault(done.size));
    refresh();
  }

  async function foreverMany(targets: Item[]) {
    setConfirm(null);
    const { done, failed, locked } = await batch(targets, (id) => window.fatup.removeForever(id));
    if (locked) return;
    setTrashItems((list) => list?.filter((it) => !done.has(it.id)) ?? null);
    clearSelection();
    report(done.size, failed, t.trashEmptied(done.size));
  }

  async function emptyTrashNow() {
    setConfirm(null);
    const res = await window.fatup.emptyTrash();
    if (!res.ok) {
      if (res.error === 'locked') return onLocked();
      return toast(errorText(t, res.error), true);
    }
    setTrashItems([]);
    clearSelection();
    toast(t.trashEmptied(res.value));
  }

  // Uploads: mirror the queue from the main process and refresh the list whenever one finishes.
  const doneCount = uploadJobs.filter((j) => j.state === 'done').length;
  const prevDone = useRef(0);
  useEffect(() => {
    if (!canUpload) return;
    window.fatup.uploadList().then(setUploadJobs);
    return window.fatup.onUploads(setUploadJobs);
  }, [canUpload]);
  useEffect(() => {
    if (doneCount > prevDone.current) refresh();
    prevDone.current = doneCount;
  }, [doneCount, refresh]);

  // Drag files from the OS onto the window; Ctrl/Cmd+U opens the picker.
  useEffect(() => {
    if (!canUpload) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const paths = window.fatup.pathsForFiles(Array.from(e.dataTransfer?.files ?? []));
      if (paths.length > 0) window.fatup.uploadPaths(paths, vaultActiveRef.current);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        window.fatup.uploadPick(vaultActiveRef.current);
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('keydown', key);
    };
  }, [canUpload]);

  const images = useMemo(() => visible.filter((it) => it.kind === 'image'), [visible]);
  const links = useMemo(() => visible.filter((it) => it.kind === 'link'), [visible]);
  const pdfs = useMemo(() => visible.filter(isPdf), [visible]);
  const modeKey: Tab = inTrash ? 'all' : tab;
  const view = state.prefs.viewModes[modeKey];

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

  /** Saves every selected file, one after another; the folder is opened once, on the last one. */
  async function downloadMany(targets: Item[]) {
    if (targets.length === 0) return;
    const last = targets[targets.length - 1].id;
    const { done, failed, locked } = await batch(targets, (id) => window.fatup.download(id, id === last), 1);
    if (locked) return;
    const mark = (list: Item[] | null) => list?.map((it) => (done.has(it.id) ? { ...it, downloaded: true } : it)) ?? null;
    setItems(mark);
    setVaultItems(mark);
    clearSelection();
    report(done.size, failed, t.downloadedN(done.size));
  }

  /** Applies a name/tag change right away and rolls back by reloading if the server refuses it. */
  async function updateFile(item: Item, patch: { name?: string; tags?: TagColor[] }) {
    const apply = (list: Item[] | null) => list?.map((it) => (it.id === item.id ? { ...it, ...patch } : it)) ?? null;
    setItems(apply);
    setVaultItems(apply);
    const res = await window.fatup.updateFile(item.id, patch);
    if (res.ok) return;
    if (res.error === 'locked') onLocked();
    else toast(errorText(t, res.error), true);
    refresh();
  }

  /** Flips the important marker at once, then keeps the server's copy (or puts it back if the server refused). */
  const toggleImportant = useCallback(
    async (item: Item) => {
      const important = !item.important;
      const swap = (list: Item[] | null) => list?.map((it) => (it.id === item.id ? { ...it, important } : it)) ?? null;
      setItems(swap);
      setVaultItems(swap);
      const res = await window.fatup.updateFile(item.id, { important });
      if (res.ok) applyItem(res.value);
      else {
        const back = (list: Item[] | null) => list?.map((it) => (it.id === item.id ? { ...it, important: item.important } : it)) ?? null;
        setItems(back);
        setVaultItems(back);
        toast(errorText(t, res.error), true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  /** Swaps in the server's copy of an item (after a preview or an edit) wherever it is listed. */
  const applyItem = useCallback((next: Item) => {
    const swap = (list: Item[] | null) => list?.map((it) => (it.id === next.id ? { ...next, downloaded: it.downloaded } : it)) ?? null;
    setItems(swap);
    setVaultItems(swap);
  }, []);

  // Previews: fetched by the server the first time a link is seen here, not when it is saved.
  const previewed = useRef(new Set<string>());
  const previewBudget = useRef(PREVIEW_BUDGET);
  const previewing = useRef(false);
  const previewNow = useCallback(
    async (id: string, force = false) => {
      const res = await window.fatup.previewLink(id, force);
      if (res.ok) applyItem(res.value);
      else if (res.error === 'locked') onLocked();
      return res;
    },
    [applyItem, onLocked],
  );
  useEffect(() => {
    if (items === null || previewing.current) return;
    const queue = [...items, ...(vaultActive ? (vaultItems ?? []) : [])]
      .filter((it) => it.kind === 'link' && !it.previewed && !previewed.current.has(it.id))
      .slice(0, previewBudget.current);
    if (queue.length === 0) return;
    for (const it of queue) previewed.current.add(it.id);
    previewBudget.current -= queue.length;
    previewing.current = true;
    let next = 0;
    const worker = async () => {
      while (next < queue.length) await previewNow(queue[next++].id);
    };
    void Promise.all(Array.from({ length: PREVIEW_PARALLEL }, worker)).finally(() => {
      previewing.current = false;
    });
  }, [items, vaultItems, vaultActive, previewNow]);

  /** Saves a link's title and/or address. Resolves to an error code (so the popover can say why), or null when stored. */
  async function saveLink(item: Item, patch: { name?: string; url?: string }): Promise<string | null> {
    const res = await window.fatup.updateFile(item.id, patch);
    if (!res.ok) {
      if (res.error === 'locked') onLocked();
      return res.error;
    }
    applyItem(res.value);
    if (patch.url) {
      previewed.current.add(item.id);
      void previewNow(item.id);
    }
    return null;
  }

  async function addLink(url: string, title: string): Promise<string | null> {
    const res = await window.fatup.addLink(url, title || undefined, vaultActive);
    if (!res.ok) {
      if (res.error === 'locked') onLocked();
      return res.error;
    }
    setAddingLink(false);
    setTab('link');
    setSiteFilter('all');
    const added = res.value;
    const put = (list: Item[] | null) => (list ? [added, ...list.filter((it) => it.id !== added.id)] : list);
    if (vaultActive) setVaultItems(put);
    else setItems(put);
    toast(t.linkAdded);
    refresh();
    if (!added.previewed) {
      previewed.current.add(added.id);
      void previewNow(added.id);
    }
    return null;
  }

  // A link shared from Android while the app was locked is saved as soon as the app is open.
  useEffect(() => {
    if (sharedLinkTaken || !window.fatup.takePendingLink) return;
    sharedLinkTaken = true;
    void window.fatup.takePendingLink().then(async (link) => {
      if (!link) return;
      if (!link.url) return toast(t.noLinkFound, true);
      const code = await addLink(link.url, link.title ?? '');
      if (code) toast(errorText(t, code), true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyLink(item: Item) {
    try {
      await navigator.clipboard.writeText(item.url ?? '');
      toast(t.linkCopied);
    } catch {
      toast(t.err_generic, true);
    }
  }

  const closeEditor = useCallback(() => setEditing(null), []);
  const editItem = editing ? [...(items ?? []), ...(vaultItems ?? [])].find((it) => it.id === editing.id) ?? null : null;
  const openEditor = (item: Item, anchor: DOMRect) => setEditing((cur) => (cur?.id === item.id ? null : { id: item.id, anchor }));

  async function copy(item: Item) {
    const res = await window.fatup.copyImage(item.id);
    toast(res.ok ? t.copied : errorText(t, res.error), !res.ok);
  }

  // Keyboard: Ctrl/Cmd+A selects everything shown, Esc clears, Delete removes the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && (e.target as HTMLInputElement).type !== 'checkbox';
      const overlay = lightboxId || linkPreviewId || pdfId || settingsOpen || menu || confirm || (inVault && !vaultUnlocked);
      if (typing || overlay) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Escape') clearSelection();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && picked.length > 0) {
        if (inTrash) setConfirm({ kind: 'forever', items: picked });
        else void moveToTrash(picked);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxId, linkPreviewId, pdfId, settingsOpen, menu, confirm, picked, inTrash, inVault, vaultUnlocked, selectAll, clearSelection]);

  // Trashed files can't be opened; restore them first.
  // Links open in the in-app preview; Ctrl/⌘ + click, or a site the person chose to always open directly, goes straight outside.
  const open = (item: Item, outside = false) => {
    if (inTrash) return;
    if (item.kind === 'link') {
      if (outside || opensDirect(item.url)) void window.fatup.openExternal(item.url ?? '');
      else setLinkPreviewId(item.id);
    }
    else if (item.kind === 'image') setLightboxId(item.id);
    else if (isPdf(item) && !outside) setPdfId(item.id);
    else void download(item);
  };
  const openMenu = (item: Item, x: number, y: number) => setMenu({ item, x, y });

  // "← Vault", the same header the Trash has.
  const vaultBackBar = (
    <div className="trashbar">
      <button className="icon-btn" onClick={toggleVault} title={t.backToFiles} aria-label={t.backToFiles}>
        <ArrowLeft size={20} />
      </button>
      <h2 className="trashbar__title">{t.vault}</h2>
    </div>
  );

  // No "All" tab: the kinds work as toggles, and with none pressed everything shows. Each carries how many it holds.
  const tabs: { id: Exclude<Tab, 'all'>; label: string }[] = [
    { id: 'image', label: t.tabImages },
    { id: 'file', label: t.tabFiles },
    { id: 'link', label: t.tabLinks },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={goHome} title={t.goHome} aria-label={`${t.appName} – ${t.goHome}`}>
          <Logo />
          <span className="brand__text">{t.appName}</span>
        </button>
        <label className="search">
          <Search size={20} aria-hidden />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} />
          {query && (
            <button className="icon-btn icon-btn--sm" onClick={() => setQuery('')} aria-label={t.close}>
              <X size={18} />
            </button>
          )}
        </label>
        <StorageMeter usage={shownUsage} />
        <div className="topbar__actions">
          {canUpload && (
            <button className="btn btn--filled upload-btn" onClick={() => window.fatup.uploadPick(vaultActive)} title={`${t.upload} (Ctrl+U)`}>
              <Upload size={18} />
              <span className="upload-btn__label">{t.upload}</span>
            </button>
          )}
          <button className="icon-btn addlink-btn" onClick={() => setAddingLink(true)} title={t.addLink} aria-label={t.addLink}>
            <Link2 size={20} />
            <span className="addlink-btn__plus" aria-hidden>
              <Plus size={11} strokeWidth={3.5} />
            </span>
          </button>
          <button key={shiver} className={`icon-btn${inVault ? ' is-active' : ''}${shiver > 0 ? ' vault-btn--shiver' : ''}`} onClick={toggleVault} title={inVault ? t.closeVault : t.vault} aria-label={inVault ? t.closeVault : t.vault} aria-pressed={inVault}>
            <VaultIcon size={26} />
          </button>
          <button key={`trash${trashKick}`} className={`icon-btn${inTrash ? ' is-active trash-btn--active' : ''}${trashKick > 0 && inTrash ? ' trash-btn--open' : ''}`} onClick={toggleTrash} title={inTrash ? t.backToFiles : t.trash} aria-label={inTrash ? t.backToFiles : t.trash} aria-pressed={inTrash}>
            <TrashIcon size={20} />
          </button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} title={t.settings} aria-label={t.settings}>
            <SettingsIcon size={20} />
          </button>
        </div>
      </header>

      <main className="panel">
        {inVault && !vaultUnlocked ? (
          <VaultGate onUnlocked={() => setVaultUnlocked(true)} onBack={leaveVault} />
        ) : (
          <>
        {picked.length > 0 ? (
          <div className="selbar" role="toolbar" aria-label={t.selectedN(picked.length)}>
            <button className="icon-btn" onClick={clearSelection} title={t.clearSelection} aria-label={t.clearSelection}>
              <X size={20} />
            </button>
            <span className="selbar__count">{t.selectedN(picked.length)}</span>
            {!allSelected && (
              <button className="btn btn--text" onClick={selectAll}>
                {t.selectAll}
              </button>
            )}
            <span className="spacer" />
            {inTrash ? (
              <>
                <button className="btn btn--text" onClick={() => void restoreMany(picked)}>
                  <RotateCcw size={18} /> {t.restore}
                </button>
                <button className="btn btn--text btn--danger-text" onClick={() => setConfirm({ kind: 'forever', items: picked })}>
                  <Trash2 size={18} /> {t.deleteForever}
                </button>
              </>
            ) : (
              <>
                <button className="btn btn--text" onClick={() => void (vaultActive ? removeFromVault(picked) : moveToVault(picked))}>
                  <VaultIcon size={18} /> {vaultActive ? t.removeFromVault : t.moveToVault}
                </button>
                {picked.some((it) => it.kind !== 'link') && (
                  <button className="btn btn--outlined" onClick={() => void downloadMany(picked.filter((it) => it.kind !== 'link'))}>
                    <Download size={18} /> {t.downloadAll}
                  </button>
                )}
                <button className="btn btn--text btn--danger-text" onClick={() => void moveToTrash(picked)}>
                  <Trash2 size={18} /> {t.moveToTrash}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="chips-row island">
            {inTrash ? (
              <div className="trashbar">
                <button className="icon-btn" onClick={toggleTrash} title={t.backToFiles} aria-label={t.backToFiles}>
                  <ArrowLeft size={20} />
                </button>
                <h2 className="trashbar__title">{t.trash}</h2>
                <InfoPopover label={t.trashInfo} open={trashInfoOpen} onOpenChange={setTrashInfoOpen}>
                  {t.trashNote}
                </InfoPopover>
                {(trashItems?.length ?? 0) > 0 && (
                  <button className="btn btn--text" onClick={() => setConfirm({ kind: 'empty' })}>
                    {t.emptyTrash}
                  </button>
                )}
              </div>
            ) : (
              <div className="chips-left">
                {inVault && vaultBackBar}
                <button
                  className={`chip chip--icon chip--important${importantOnly ? ' chip--on' : ''}`}
                  aria-pressed={importantOnly}
                  aria-label={t.importantOnly}
                  title={t.importantOnly}
                  onClick={() => setImportantOnly((v) => !v)}
                >
                  <ImportantIcon on={importantOnly} size={20} />
                </button>
                <span className="chips-divider" aria-hidden />
                <nav className="chips kind-tabs" aria-label={t.kindFilter}>
                  {tabs.map((tb) => (
                    <button
                      key={tb.id}
                      aria-pressed={tab === tb.id}
                      className={`chip chip--site ${tab === tb.id ? 'chip--on' : ''}`}
                      onClick={() => setTab(tab === tb.id ? 'all' : tb.id)}
                    >
                      {tb.label}
                      <span className="chip__count">{kindCounts[tb.id]}</span>
                    </button>
                  ))}
                </nav>
              </div>
            )}
            <div className="chips-row__tools">
              <TagFilter value={tagFilter} onChange={setTagFilter} />
              <button className="icon-btn" onClick={refresh} title={`${t.refresh} (Ctrl+R)`} aria-label={t.refresh} disabled={loading}>
                <RotateCw size={20} className={loading ? 'spin' : ''} />
              </button>
              {/* Always there on the links tab (so the bar never shifts under the mouse); greyed out when nothing is grouped. */}
              {linkTab && (
                <IconSwitch
                  disabled={!byDomain || groups.length === 0}
                  checked={allExpanded}
                  onChange={(expand) => setCollapsed(expand ? new Set() : new Set(groups.map((g) => g.key)))}
                  off={ChevronsDownUp}
                  on={ChevronsUpDown}
                  label={allExpanded ? t.collapseAll : t.expandAll}
                />
              )}
              <IconSwitch
                checked={view === 'list'}
                onChange={(list) => onPrefs({ viewModes: { ...state.prefs.viewModes, [modeKey]: list ? 'list' : 'grid' } })}
                off={LayoutGrid}
                on={List}
                label={view === 'grid' ? t.listView : t.gridView}
              />
            </div>
          </div>
        )}

        {linkTab && <SiteFilterBar value={siteFilter} onChange={setSiteFilter} counts={counts} />}

        {error && (
          <div className="banner" role="alert">
            {error}
            <button className="btn btn--text" onClick={refresh}>
              {t.refresh}
            </button>
          </div>
        )}

        <div className="panel__scroll">
          {!loaded ? (
            <div className="skeleton" aria-busy />
          ) : visible.length === 0 ? (
            <EmptyState searching={(query !== '' || tagFilter.length > 0 || (importantOnly && !inTrash) || (linkTab && siteFilter !== 'all')) && source.length > 0} trash={inTrash} vault={vaultActive} links={linkTab} />
          ) : view === 'grid' ? (
            <FileGrid
              groups={groups}
              selected={selected}
              onToggle={toggle}
              onOpen={open}
              onMenu={openMenu}
              onEdit={inTrash ? undefined : openEditor}
              onCopyLink={inTrash ? undefined : (it) => void copyLink(it)}
              onImportant={inTrash ? undefined : (it) => void toggleImportant(it)}
              onDownload={inTrash ? undefined : (it) => void download(it)}
              collapsed={collapsed}
              onToggleGroup={toggleGroup}
            />
          ) : (
            <FileList
              groups={groups}
              selected={selected}
              onToggle={toggle}
              onOpen={open}
              onMenu={openMenu}
              onEdit={inTrash ? undefined : openEditor}
              onCopyLink={inTrash ? undefined : (it) => void copyLink(it)}
              onImportant={inTrash ? undefined : (it) => void toggleImportant(it)}
              collapsed={collapsed}
              onToggleGroup={toggleGroup}
              sort={sort}
              onSort={changeSort}
              allSelected={allSelected}
              someSelected={picked.length > 0}
              onToggleAll={() => (allSelected ? clearSelection() : selectAll())}
              timeLabel={inTrash ? t.colDeleted : t.colTime}
              siteColumn={linkTab}
            />
          )}
        </div>
          </>
        )}
      </main>

      {menu && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onDownload={download}
          onCopy={copy}
          onDelete={(it) => void moveToTrash([it])}
          onVault={(it) => void (vaultActive ? removeFromVault([it]) : moveToVault([it]))}
          inVault={vaultActive}
          link={{
            onOpen: open,
            onCopy: (it) => void copyLink(it),
            onEdit: (it, x, y) => openEditor(it, new DOMRect(x, y, 0, 0)),
            onReload: (it) => void previewNow(it.id, true),
          }}
          trash={inTrash ? { onRestore: (it) => void restoreMany([it]), onForever: (it) => setConfirm({ kind: 'forever', items: [it] }) } : undefined}
        />
      )}
      {linkPreviewId && (
        <LinkPreview
          items={links}
          currentId={linkPreviewId}
          onChange={setLinkPreviewId}
          onClose={() => setLinkPreviewId(null)}
          onOpenExternal={(it) => void window.fatup.openExternal(it.url ?? '')}
          onCopyLink={(it) => void copyLink(it)}
          onDelete={(it) => void moveToTrash([it])}
          platform={state.platform}
        />
      )}
      {pdfId && (
        <PdfPreview
          items={pdfs}
          currentId={pdfId}
          onChange={setPdfId}
          onClose={() => setPdfId(null)}
          onDownload={download}
          onDelete={(it) => void moveToTrash([it])}
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
          onDelete={(it) => void moveToTrash([it])}
        />
      )}
      {confirm?.kind === 'forever' && (
        <ConfirmDialog
          title={t.foreverTitle(confirm.items.length)}
          body={t.foreverBody(confirm.items.length)}
          confirmLabel={t.deleteForever}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => void foreverMany(confirm.items)}
        />
      )}
      {confirm?.kind === 'empty' && (
        <ConfirmDialog
          title={t.emptyTrashTitle}
          body={t.emptyTrashBody(trashItems?.length ?? 0)}
          confirmLabel={t.emptyTrash}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => void emptyTrashNow()}
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
      {canUpload && <UploadPanel jobs={uploadJobs} onCancel={(id) => window.fatup.uploadCancel(id)} onClear={() => window.fatup.uploadClear()} />}
      {dragging && (
        <div className="dropzone" aria-hidden>
          <UploadCloud size={56} />
          <p>{t.dropToUpload}</p>
        </div>
      )}
      {editing && editItem && editItem.kind === 'link' && (
        <LinkEditPopover
          key={editItem.id}
          item={editItem}
          anchor={editing.anchor}
          onClose={closeEditor}
          onSave={(patch) => saveLink(editItem, patch)}
          onError={(code) => toast(errorText(t, code), true)}
          onTags={(tags) => void updateFile(editItem, { tags })}
        />
      )}
      {editing && editItem && editItem.kind !== 'link' && (
        <EditPopover
          key={editItem.id}
          item={editItem}
          anchor={editing.anchor}
          onClose={closeEditor}
          onRename={(name) => void updateFile(editItem, { name })}
          onTags={(tags) => void updateFile(editItem, { tags })}
        />
      )}
      {addingLink && <AddLinkDialog onClose={() => setAddingLink(false)} onAdd={addLink} />}
      {toastNode}
    </div>
  );
}
