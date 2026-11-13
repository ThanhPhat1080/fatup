import type { FileItem } from '@fatup/shared';
import type { AppState, FatupApi, Item, Prefs, Result, UnlockResult } from '../../desktop/src/shared-ipc';
import { ApiClient, ApiError, normalizeServerUrl } from '../../desktop/src/main/api';
import { nextAttempt, open, seal, type Lockout, type Sealed } from './vault';

const STORAGE_KEY = 'fatup.web.v1';
const MAX_DOWNLOADED = 2000;

type Stored = {
  serverUrl: string | null;
  token: Sealed | null;
  lockout: Lockout;
  prefs: Prefs;
  downloaded: string[];
};

const DEFAULT_PREFS: Prefs = { lang: 'auto', theme: 'system', viewModes: { all: 'list', image: 'grid', file: 'list' } };

function load(): Stored {
  const base: Stored = { serverUrl: null, token: null, lockout: { failedAttempts: 0, lockedUntil: 0 }, prefs: structuredClone(DEFAULT_PREFS), downloaded: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null;
    if (!parsed) return base;
    return {
      ...base,
      ...parsed,
      lockout: { ...base.lockout, ...parsed.lockout },
      prefs: { ...base.prefs, ...parsed.prefs, viewModes: { ...base.prefs.viewModes, ...parsed.prefs?.viewModes } },
      downloaded: Array.isArray(parsed.downloaded) ? parsed.downloaded : [],
    };
  } catch {
    return base;
  }
}

const fail = (err: unknown): { ok: false; error: string; detail?: string } =>
  err instanceof ApiError ? { ok: false, error: err.code, detail: err.message } : { ok: false, error: 'unknown', detail: (err as Error)?.message };

/** Re-encodes any image the browser can decode to PNG, the only type the async clipboard accepts for images. */
async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

/** Implements the same `window.fatup` bridge the desktop app gets from Electron, on top of fetch + localStorage. */
export function installBrowserApi(): void {
  let data = load();
  let unlockedToken: string | null = null; // decrypted token, memory only
  let vaultIsOpen = false;
  let pendingToken: { serverUrl: string; token: string } | null = null; // between "connect" and "set PIN"
  const itemCache = new Map<string, FileItem>();

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* private mode / quota: keep working in memory */
    }
  };
  const client = () => {
    if (!data.serverUrl || !unlockedToken) throw new ApiError('locked', 'Locked');
    return new ApiClient(data.serverUrl, unlockedToken);
  };
  const guarded = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
    if (!unlockedToken) return { ok: false, error: 'locked' };
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      return fail(err);
    }
  };
  const asUnlockFailure = (res: Exclude<ReturnType<typeof nextAttempt>, { ok: true }>): UnlockResult =>
    res.reason === 'locked' ? { ok: false, reason: 'locked', lockedUntil: res.lockedUntil } : { ok: false, reason: 'wrong', attemptsLeft: res.attemptsLeft };

  async function tryUnlock(pin: string): Promise<{ result: UnlockResult; token: string | null }> {
    if (!data.token) return { result: { ok: false, reason: 'wrong', attemptsLeft: 0 }, token: null };
    const now = Date.now();
    // Don't burn CPU on PBKDF2 while locked out.
    if (data.lockout.lockedUntil > now) return { result: { ok: false, reason: 'locked', lockedUntil: data.lockout.lockedUntil }, token: null };
    const token = /^\d{4}$/.test(pin) ? await open(data.token, pin) : null;
    const res = nextAttempt(token !== null, data.lockout, now);
    data.lockout = res.state;
    save();
    return { result: res.ok ? { ok: true } : asUnlockFailure(res), token };
  }

  const api: FatupApi = {
    getState: async (): Promise<AppState> => ({
      platform: 'web',
      defaultServerUrl: location.origin,
      configured: Boolean(data.serverUrl && data.token),
      hasPin: Boolean(data.token),
      unlocked: unlockedToken !== null,
      systemLocale: navigator.language || 'en',
      prefs: data.prefs,
      serverUrl: data.serverUrl,
    }),

    testConnection: async (rawUrl, token) => {
      try {
        await new ApiClient(normalizeServerUrl(rawUrl), token.trim()).verify();
        return { ok: true, value: undefined };
      } catch (err) {
        return err instanceof TypeError && !(err instanceof ApiError) && /URL/i.test(err.message) ? { ok: false, error: 'invalid_url' } : fail(err);
      }
    },

    saveConnection: async (rawUrl, token) => {
      if (data.token && !unlockedToken) return { ok: false, error: 'locked' };
      try {
        const url = normalizeServerUrl(rawUrl);
        await new ApiClient(url, token.trim()).verify();
        pendingToken = { serverUrl: url, token: token.trim() };
        return { ok: true, value: undefined };
      } catch (err) {
        return err instanceof TypeError && /URL/i.test(err.message) ? { ok: false, error: 'invalid_url' } : fail(err);
      }
    },

    setPin: async (pin) => {
      if (data.token && !unlockedToken) return { ok: false, error: 'locked' };
      if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'invalid_pin' };
      const source = pendingToken ?? (data.serverUrl && unlockedToken ? { serverUrl: data.serverUrl, token: unlockedToken } : null);
      if (!source) return { ok: false, error: 'not_configured' };
      data.serverUrl = source.serverUrl;
      data.token = await seal(source.token, pin);
      data.lockout = { failedAttempts: 0, lockedUntil: 0 };
      save();
      unlockedToken = source.token;
      pendingToken = null;
      return { ok: true, value: undefined };
    },

    unlock: async (pin) => {
      const { result, token } = await tryUnlock(pin);
      if (result.ok) unlockedToken = token;
      return result;
    },

    lock: async () => {
      unlockedToken = null;
      vaultIsOpen = false;
      itemCache.clear();
    },

    reset: async () => {
      data = { serverUrl: null, token: null, lockout: { failedAttempts: 0, lockedUntil: 0 }, prefs: data.prefs, downloaded: [] };
      unlockedToken = null;
      pendingToken = null;
      vaultIsOpen = false;
      itemCache.clear();
      save();
    },

    changePin: async (oldPin, newPin) => {
      if (!unlockedToken || !/^\d{4}$/.test(newPin)) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
      const { result, token } = await tryUnlock(oldPin);
      if (result.ok && token) {
        data.token = await seal(token, newPin);
        save();
      }
      return result;
    },

    setPrefs: async (prefs) => {
      data.prefs = { ...data.prefs, ...prefs, viewModes: { ...data.prefs.viewModes, ...prefs.viewModes } };
      save();
      return data.prefs;
    },

    list: () =>
      guarded(async (): Promise<Item[]> => {
        const items = await client().listAll();
        itemCache.clear();
        for (const it of items) itemCache.set(it.id, it);
        const downloaded = new Set(data.downloaded);
        return items.map((it) => ({ ...it, downloaded: downloaded.has(it.id) }));
      }),

    listTrash: () => guarded(async (): Promise<Item[]> => (await client().listAll({ trash: true })).map((it) => ({ ...it, downloaded: false }))),

    updateFile: (id, patch) =>
      guarded(async (): Promise<Item> => {
        const item = await client().update(id, patch);
        itemCache.set(id, item);
        return { ...item, downloaded: data.downloaded.includes(id) };
      }),

    vaultOpen: async (pin) => {
      if (!unlockedToken) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
      const { result } = await tryUnlock(pin);
      if (result.ok) vaultIsOpen = true;
      return result;
    },
    vaultClose: async () => {
      vaultIsOpen = false;
    },
    listVault: async (): Promise<Result<Item[]>> => {
      if (!unlockedToken) return { ok: false, error: 'locked' };
      if (!vaultIsOpen) return { ok: false, error: 'vault_locked' };
      try {
        const items = await client().listAll({ vault: true });
        for (const it of items) itemCache.set(it.id, it);
        const downloaded = new Set(data.downloaded);
        return { ok: true, value: items.map((it) => ({ ...it, downloaded: downloaded.has(it.id) })) };
      } catch (err) {
        return fail(err);
      }
    },
    setVault: async (id, inVault) => {
      if (!unlockedToken) return { ok: false, error: 'locked' };
      if (!inVault && !vaultIsOpen) return { ok: false, error: 'vault_locked' };
      try {
        await client().setVault(id, inVault);
        return { ok: true, value: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    usage: () => guarded(() => client().usage()),

    restore: (id) =>
      guarded(async () => {
        await client().restore(id);
      }),

    removeForever: (id) => guarded(() => client().removeForever(id)),

    emptyTrash: () => guarded(() => client().emptyTrash()),

    previewUrl: (id) => guarded(() => client().downloadUrl(id)),

    download: (id) =>
      guarded(async () => {
        const url = await client().downloadUrl(id);
        // The presigned URL carries Content-Disposition: attachment, so the browser saves it instead of navigating.
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        a.download = itemCache.get(id)?.name ?? '';
        document.body.appendChild(a);
        a.click();
        a.remove();
        data.downloaded = [...data.downloaded.filter((x) => x !== id), id].slice(-MAX_DOWNLOADED);
        save();
        return 'Downloads';
      }),

    copyImage: (id) =>
      guarded(async () => {
        const item = itemCache.get(id);
        const grab = async (url: string) => {
          const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
          if (!res.ok) throw new ApiError('download_failed', `HTTP ${res.status}`, res.status);
          return res.blob();
        };
        let png: Blob | null = null;
        try {
          png = await toPng(await grab(await client().downloadUrl(id)));
        } catch {
          // Original blocked by CORS or undecodable (HEIC): try the JPEG preview.
          if (item?.thumbUrl) png = await toPng(await grab(item.thumbUrl)).catch(() => null);
        }
        if (!png) throw new ApiError('unsupported_image', 'Cannot copy image');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      }),

    remove: (id) =>
      guarded(async () => {
        await client().remove(id);
        itemCache.delete(id);
      }),

    uploadPick: async () => undefined,
    uploadPaths: async () => undefined,
    uploadCancel: async () => undefined,
    uploadClear: async () => undefined,
    uploadList: async () => [],
    onUploads: () => () => undefined,
    pathsForFiles: () => [],
    // Desktop-only features; the UI hides them when platform === 'web'.
    pairingQr: async () => ({ ok: false, reason: 'wrong', attemptsLeft: 0 }),
    appVersion: async () => '',
    checkForUpdate: async () => ({ status: 'error' }),
    installUpdate: async () => ({ ok: false, error: 'no_update' }),
    onUpdateProgress: () => () => undefined,
  };

  window.fatup = api;
}
