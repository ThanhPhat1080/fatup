import type { FileItem } from '@fatup/shared';
import type { AppState, FatupApi, Item, Prefs, Result, UnlockResult, UploadJob } from '../../desktop/src/shared-ipc';
import { ApiClient, ApiError, normalizeServerUrl } from '../../desktop/src/main/api';
import { nextAttempt, open, seal, type Lockout, type Sealed } from './vault';
import { WebUploadManager, deviceName } from './uploader';
import { popSharedLink } from './share';
import { PreviewCache, fetchPicture } from '../../desktop/src/preview-cache';
import { CacheStoragePreviewStore } from './preview-store';
import { createWebVault } from './vault-web';

const STORAGE_KEY = 'fatup.web.v1';
const MAX_DOWNLOADED = 2000;

type Stored = {
  serverUrl: string | null;
  token: Sealed | null;
  lockout: Lockout;
  prefs: Prefs;
  downloaded: string[];
};

const DEFAULT_PREFS: Prefs = { lang: 'auto', theme: 'system', viewModes: { all: 'list', image: 'grid', file: 'list', link: 'list' } };

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

/** Hands a file to the browser's download manager under `name`. The object URL lives only long enough for the browser to start the save. */
function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Phone keyboards and chat apps slip in zero-width spaces, newlines and smart punctuation when a token is pasted; fetch then rejects the header outright. Tokens are plain printable ASCII. */
const cleanToken = (raw: string) => raw.replace(/[^\x21-\x7e]/g, '');

/** Implements the same `window.fatup` bridge the desktop app gets from Electron, on top of fetch + localStorage. */
export function installBrowserApi(): void {
  let data = load();
  let unlockedToken: string | null = null; // decrypted token, memory only
  let pendingToken: { serverUrl: string; token: string } | null = null; // between "connect" and "set PIN"
  const itemCache = new Map<string, FileItem>();
  // Link pictures are kept in this browser (the server only names their address). Browsers often cannot read a picture from another
  // site (no CORS), so then it is shown from its own address for the session instead.
  const previews = new PreviewCache(new CacheStoragePreviewStore(), { fetchPicture: (url) => fetchPicture(url), hotlink: true });
  // Browser files have no path, so the shared "paths" are opaque handles into this table.
  const handles = new Map<string, File>();
  let nextHandle = 1;
  const uploadListeners = new Set<(jobs: UploadJob[]) => void>();
  // The encrypted Vault: the key, the decrypted names and the object URLs of decrypted pictures all stay in page memory (vault-web.ts).
  // It never touches `previews` (Cache Storage) or localStorage.
  const webVault = createWebVault({
    client: () => client(),
    isUnlocked: () => unlockedToken !== null,
    // The Vault PIN may not share its first or last four digits with the app PIN. Tries the sealed token; does not count as an attempt.
    appPinMatches: async (pin4) => (data.token ? (await open(data.token, pin4)) !== null : false),
    saveFile: (name, bytes, mime) => saveBlob(name, new Blob([bytes as BlobPart], { type: mime })),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    device: deviceName(),
  });
  const uploads = new WebUploadManager({
    client: () => client(),
    device: deviceName(),
    vault: webVault.uploadEncryptor(),
    onChange: (jobs) => uploadListeners.forEach((cb) => cb(jobs)),
  });
  const takeHandles = (paths: string[]) => paths.flatMap((p) => {
    const file = handles.get(p);
    handles.delete(p);
    return file ? [file] : [];
  });
  const pickFiles = (vault: boolean) => {
    // Must run inside the click that asked for it, or the browser refuses to open the picker.
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => {
      if (input.files?.length) uploads.add(Array.from(input.files), vault);
    };
    input.click();
  };

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

  /** Vault items come back with `downloaded: false` (the Vault does not know what this browser saved); fill it in. */
  const withDownloaded = (res: Result<Item>): Result<Item> => (res.ok ? { ok: true, value: { ...res.value, downloaded: data.downloaded.includes(res.value.id) } } : res);
  const markDownloaded = (id: string) => {
    data.downloaded = [...data.downloaded.filter((x) => x !== id), id].slice(-MAX_DOWNLOADED);
    save();
  };

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

    testConnection: async (rawUrl, rawToken) => {
      const token = cleanToken(rawToken);
      try {
        await new ApiClient(normalizeServerUrl(rawUrl), token.trim()).verify();
        return { ok: true, value: undefined };
      } catch (err) {
        return err instanceof TypeError && !(err instanceof ApiError) && /URL/i.test(err.message) ? { ok: false, error: 'invalid_url' } : fail(err);
      }
    },

    saveConnection: async (rawUrl, rawToken) => {
      const token = cleanToken(rawToken);
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
      uploads.cancelAll();
      unlockedToken = null;
      webVault.vaultClose(); // forgets the Vault key and revokes every decrypted picture URL
      itemCache.clear();
    },

    reset: async () => {
      uploads.cancelAll();
      data = { serverUrl: null, token: null, lockout: { failedAttempts: 0, lockedUntil: 0 }, prefs: data.prefs, downloaded: [] };
      unlockedToken = null;
      pendingToken = null;
      webVault.vaultClose();
      itemCache.clear();
      save();
      await previews.clear().catch(() => undefined); // pictures of the old account's links must not outlive the connection
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
        const items = await client().listEverything();
        itemCache.clear();
        for (const it of items) itemCache.set(it.id, it);
        const downloaded = new Set(data.downloaded);
        return previews.decorate(items.map((it) => ({ ...it, downloaded: downloaded.has(it.id) })));
      }),

    listTrash: () => guarded(async (): Promise<Item[]> => previews.decorate((await client().listEverything({ trash: true })).map((it) => ({ ...it, downloaded: false })))),

    getShare: (id) => guarded(() => client().getShare(id)),
    setShare: (id, days) => guarded(() => client().setShare(id, days)),
    stopShare: (id) => guarded(() => client().stopShare(id)),

    // An encrypted Vault item is renamed through a new encMeta (vault-web.ts); its plain name or address never reaches the server.
    updateFile: async (id, patch) => {
      if (webVault.owns(id)) return withDownloaded(await webVault.updateFile(id, patch));
      return guarded(async (): Promise<Item> => {
        const item = await client().update(id, patch);
        itemCache.set(id, item);
        if (patch.url) await previews.forget([id]); // the old picture belongs to the old address
        return (await previews.decorate([{ ...item, downloaded: data.downloaded.includes(id) }]))[0];
      });
    },

    // A link for the Vault is encrypted here and uploaded as a Vault item; it is never created as a plain link first.
    addLink: async (url, title, intoVault) => {
      if (intoVault) return withDownloaded(await webVault.addLink(url, title));
      return guarded(async (): Promise<Item> => {
        const item = await client().addLink({ url, title, device: deviceName() });
        itemCache.set(item.id, item);
        return (await previews.decorate([{ ...item, downloaded: false }]))[0];
      });
    },

    previewLink: (id, force) =>
      guarded(async (): Promise<Item> => {
        const res = await client().previewLink(id);
        const { previewImage: _address, ...item } = res;
        itemCache.set(id, item);
        return previews.learn(res, force === true);
      }),

    takePendingLink: async () => popSharedLink(),

    openExternal: async (url) => {
      if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
    },

    // The encrypted Vault. All of the logic is in vault-web.ts; Vault items are never handed to `previews` (Cache Storage).
    vaultStatus: () => webVault.vaultStatus(),
    vaultSetup: (pin) => webVault.vaultSetup(pin),
    vaultSetupPrepare: (pin) => webVault.vaultSetupPrepare(pin),
    vaultSetupCommit: () => webVault.vaultSetupCommit(),
    vaultUnlock: (pin) => webVault.vaultUnlock(pin),
    vaultRecover: (recoveryKey, newPin) => webVault.vaultRecover(recoveryKey, newPin),
    vaultChangePin: (oldPin, newPin) => webVault.vaultChangePin(oldPin, newPin),
    vaultClose: async () => webVault.vaultClose(),
    listVault: async (opts) => {
      const res = await webVault.listVault(opts);
      if (!res.ok) return res;
      const saved = new Set(data.downloaded);
      return { ok: true, value: res.value.map((it) => ({ ...it, downloaded: saved.has(it.id) })) };
    },
    vaultMoveIn: async (ids) => {
      const res = await webVault.vaultMoveIn(ids);
      if (res.ok) {
        // The Vault leaves no pictures of its links on this device.
        const moved = ids.filter((id) => !res.value.failed.includes(id));
        for (const id of moved) itemCache.delete(id);
        await previews.forget(moved).catch(() => undefined);
      }
      return res;
    },
    vaultMoveOut: (ids) => webVault.vaultMoveOut(ids),
    onVaultProgress: (cb) => webVault.onVaultProgress(cb),

    usage: () => guarded(() => client().usage()),

    restore: (id) =>
      guarded(async () => {
        await client().restore(id);
      }),

    removeForever: (id) =>
      guarded(async () => {
        await client().removeForever(id);
        await previews.forget([id]);
      }),

    emptyTrash: () =>
      guarded(async () => {
        const inTrash = await client().listEverything({ trash: true }).catch(() => []);
        const count = await client().emptyTrash();
        await previews.forget(inTrash.filter((it) => it.kind === 'link').map((it) => it.id));
        return count;
      }),

    previewUrl: (id) => (webVault.owns(id) ? webVault.previewUrl(id) : guarded(() => client().downloadUrl(id))),

    fileBytes: async (id) => {
      if (webVault.owns(id)) return webVault.fileBytes(id);
      return guarded(async () => {
        const res = await fetch(await client().downloadUrl(id), { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new ApiError('download_failed', `HTTP ${res.status}`, res.status);
        return new Uint8Array(await res.arrayBuffer());
      });
    },

    linkFrame: (id) => guarded(() => client().linkFrame(id)),

    download: async (id) => {
      if (webVault.owns(id)) {
        const res = await webVault.download(id); // decrypted in this page, then saved under its real name
        if (res.ok) markDownloaded(id);
        return res;
      }
      return guarded(async () => {
        const url = await client().downloadUrl(id);
        // The presigned URL carries Content-Disposition: attachment, so the browser saves it instead of navigating.
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        a.download = itemCache.get(id)?.name ?? '';
        document.body.appendChild(a);
        a.click();
        a.remove();
        markDownloaded(id);
        return 'Downloads';
      });
    },

    copyImage: async (id) => {
      if (webVault.owns(id)) {
        const bytes = await webVault.copyImageBytes(id);
        if (!bytes.ok) return bytes;
        return guarded(async () => {
          const png = await toPng(new Blob([bytes.value as BlobPart])).catch(() => null);
          if (!png) throw new ApiError('unsupported_image', 'Cannot copy image');
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        });
      }
      return guarded(async () => {
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
      });
    },

    remove: (id) =>
      guarded(async () => {
        await client().remove(id);
        itemCache.delete(id);
      }),

    uploadPick: async (vault = false) => pickFiles(vault),
    uploadPaths: async (paths, vault = false) => {
      if (!unlockedToken) return;
      uploads.add(takeHandles(paths), vault);
    },
    uploadCancel: async (id) => uploads.cancel(id),
    uploadClear: async () => uploads.clearFinished(),
    uploadList: async () => uploads.snapshot(),
    onUploads: (cb) => {
      uploadListeners.add(cb);
      return () => uploadListeners.delete(cb);
    },
    pathsForFiles: (files) =>
      files.map((f) => {
        const handle = `web:${nextHandle++}`;
        handles.set(handle, f);
        return handle;
      }),
    // Desktop-only features; the UI hides them when platform === 'web'.
    pairingQr: async () => ({ ok: false, reason: 'wrong', attemptsLeft: 0 }),
    appVersion: async () => '',
    checkForUpdate: async () => ({ status: 'error' }),
    installUpdate: async () => ({ ok: false, error: 'no_update' }),
    onUpdateProgress: () => () => undefined,
  };

  window.fatup = api;
}
