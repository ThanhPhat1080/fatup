import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, shell } from 'electron';
import { hostname } from 'node:os';
import { createWriteStream, existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import QRCode from 'qrcode';
import type { FileItem, TagColor } from '@fatup/shared';
import { autoUpdater } from 'electron-updater';
import type { AppState, Item, Prefs, Result, UnlockResult, UpdateCheck } from '../shared-ipc';
import { ApiClient, ApiError, normalizeServerUrl } from './api';
import { ConfigStore } from './config';
import { uniqueFileName } from './filename';
import { checkPin, hashPin, isValidPin } from './pin';
import { UploadManager } from './uploader';
import { fetchLatestRelease, isNewer, type ReleaseInfo } from './updater';

if (process.env.FATUP_USER_DATA) app.setPath('userData', process.env.FATUP_USER_DATA);

let config: ConfigStore;
let unlocked = false;
/** True only while the Vault view is open and the PIN was re-entered. Never persisted. */
let vaultOpen = false;
let mainWindow: BrowserWindow | null = null;
const itemCache = new Map<string, FileItem>();
let pendingRelease: ReleaseInfo | null = null;

const THUMB_EDGE = 400;
/** 400px JPEG preview, same as the Android app. Returns null for formats Electron can't decode. */
function makeThumbnail(path: string): Buffer | null {
  try {
    const image = nativeImage.createFromPath(path);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const scale = Math.min(1, THUMB_EDGE / Math.max(width, height));
    const small = scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : image;
    return small.toJPEG(80);
  } catch {
    return null;
  }
}

const uploads = new UploadManager({
  client: () => client(),
  // Shown as "From" in the file list. FATUP_DEVICE_NAME overrides it (handy for demos); "Tracys-MacBook-Air.local" becomes "Tracys-MacBook-Air".
  device: (process.env.FATUP_DEVICE_NAME || hostname().replace(/\.local$/i, '')).slice(0, 64) || null,
  thumbnail: makeThumbnail,
  onChange: (jobs) => mainWindow?.webContents.send('uploads', jobs),
});

/**
 * In-app install needs a signed app on macOS and a package we can replace in place on Linux (AppImage).
 * Everywhere else we open the release page instead.
 */
const canAutoInstall = () =>
  app.isPackaged && (process.platform === 'win32' || (process.platform === 'linux' && Boolean(process.env.APPIMAGE)));

const downloadDir = () => process.env.FATUP_DOWNLOAD_DIR || app.getPath('downloads');

function client(): ApiClient {
  const token = config.token;
  if (!config.snapshot.serverUrl || !token) throw new ApiError('not_configured', 'Not configured');
  return new ApiClient(config.snapshot.serverUrl, token);
}

function fail(err: unknown): { ok: false; error: string; detail?: string } {
  if (err instanceof ApiError) return { ok: false, error: err.code, detail: err.message };
  return { ok: false, error: 'unknown', detail: (err as Error)?.message };
}

/** Wraps a handler that needs an unlocked app and turns errors into Result values. */
function guarded<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  return async (_e: Electron.IpcMainInvokeEvent, ...args: A): Promise<Result<T>> => {
    if (!unlocked) return { ok: false, error: 'locked' };
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return fail(err);
    }
  };
}

function tryUnlock(pin: string): UnlockResult {
  const record = config.snapshot.pin;
  if (!record) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
  const res = checkPin(pin, record, config.snapshot.lockout);
  config.setLockout(res.state);
  if (res.ok) return { ok: true };
  return res.reason === 'locked'
    ? { ok: false, reason: 'locked', lockedUntil: res.lockedUntil }
    : { ok: false, reason: 'wrong', attemptsLeft: res.attemptsLeft };
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new ApiError('download_failed', `HTTP ${res.status}`, res.status);
  return Buffer.from(await res.arrayBuffer());
}

function registerIpc() {
  ipcMain.handle('uploadPick', async (_e, vault?: boolean) => {
    if (!unlocked || !mainWindow || (vault && !vaultOpen)) return;
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
    if (!res.canceled) uploads.add(res.filePaths, vault === true);
  });
  ipcMain.handle('uploadPaths', (_e, paths: unknown, vault?: boolean) => {
    if (!unlocked || !Array.isArray(paths) || (vault && !vaultOpen)) return;
    uploads.add(paths.filter((p): p is string => typeof p === 'string' && p !== ''), vault === true);
  });
  ipcMain.handle('uploadCancel', (_e, id: string) => uploads.cancel(id));
  ipcMain.handle('uploadClear', () => uploads.clearFinished());
  ipcMain.handle('uploadList', () => uploads.snapshot());

  ipcMain.handle('appVersion', () => app.getVersion());

  ipcMain.handle('checkForUpdate', async (): Promise<UpdateCheck> => {
    try {
      const release = await fetchLatestRelease();
      const current = app.getVersion();
      if (!isNewer(release.version, current)) {
        pendingRelease = null;
        return { status: 'latest', current };
      }
      pendingRelease = release;
      return { status: 'available', current, version: release.version, auto: canAutoInstall() };
    } catch (err) {
      return { status: 'error', detail: (err as Error).message };
    }
  });

  ipcMain.handle('installUpdate', async (): Promise<Result> => {
    if (!pendingRelease) return { ok: false, error: 'no_update' };
    try {
      if (!canAutoInstall()) {
        await shell.openExternal(pendingRelease.url);
        return { ok: true, value: undefined };
      }
      autoUpdater.autoDownload = false;
      autoUpdater.on('download-progress', (p) => mainWindow?.webContents.send('updateProgress', { percent: Math.round(p.percent) }));
      const found = await autoUpdater.checkForUpdates();
      if (!found?.isUpdateAvailable) return { ok: false, error: 'no_update' };
      await autoUpdater.downloadUpdate();
      // Give the renderer a moment to show "restarting", then swap in the new version.
      setTimeout(() => autoUpdater.quitAndInstall(), 500);
      return { ok: true, value: undefined };
    } catch (err) {
      autoUpdater.removeAllListeners('download-progress');
      return { ok: false, error: 'update_failed', detail: (err as Error).message };
    }
  });

  ipcMain.handle('state', (): AppState => {
    const s = config.snapshot;
    return {
      platform: 'desktop',
      configured: Boolean(s.serverUrl && config.token),
      hasPin: Boolean(s.pin),
      unlocked,
      systemLocale: app.getLocale(),
      prefs: s.prefs,
      serverUrl: s.serverUrl,
    };
  });

  ipcMain.handle('testConnection', async (_e, rawUrl: string, token: string): Promise<Result> => {
    try {
      await new ApiClient(normalizeServerUrl(rawUrl), token.trim()).verify();
      return { ok: true, value: undefined };
    } catch (err) {
      if (err instanceof TypeError) return { ok: false, error: 'invalid_url' };
      return fail(err);
    }
  });

  ipcMain.handle('saveConnection', async (_e, rawUrl: string, token: string): Promise<Result> => {
    // Only allowed during first setup, or once unlocked.
    if (config.snapshot.pin && !unlocked) return { ok: false, error: 'locked' };
    try {
      const url = normalizeServerUrl(rawUrl);
      await new ApiClient(url, token.trim()).verify();
      config.setConnection(url, token.trim());
      return { ok: true, value: undefined };
    } catch (err) {
      if (err instanceof TypeError) return { ok: false, error: 'invalid_url' };
      return fail(err);
    }
  });

  ipcMain.handle('setPin', (_e, pin: string): Result => {
    if (config.snapshot.pin && !unlocked) return { ok: false, error: 'locked' };
    if (!isValidPin(pin)) return { ok: false, error: 'invalid_pin' };
    config.setPin(hashPin(pin));
    unlocked = true;
    return { ok: true, value: undefined };
  });

  ipcMain.handle('unlock', (_e, pin: string): UnlockResult => {
    const res = tryUnlock(pin);
    if (res.ok) unlocked = true;
    return res;
  });

  ipcMain.handle('lock', () => {
    unlocked = false;
    vaultOpen = false;
    uploads.cancelAll();
    itemCache.clear();
  });

  ipcMain.handle('reset', () => {
    vaultOpen = false;
    uploads.cancelAll();
    config.reset();
    unlocked = false;
    itemCache.clear();
  });

  ipcMain.handle('changePin', (_e, oldPin: string, newPin: string): UnlockResult => {
    if (!unlocked) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
    if (!isValidPin(newPin)) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
    const res = tryUnlock(oldPin);
    if (res.ok) config.setPin(hashPin(newPin));
    return res;
  });

  ipcMain.handle('setPrefs', (_e, prefs: Partial<Prefs>) => {
    const next = config.setPrefs(prefs);
    // Keeps native chrome (scrollbars, dialogs, menus) and prefers-color-scheme in step with the in-app choice.
    nativeTheme.themeSource = next.theme;
    return next;
  });

  ipcMain.handle(
    'list',
    guarded(async (): Promise<Item[]> => {
      const items = await client().listAll();
      itemCache.clear();
      for (const it of items) itemCache.set(it.id, it);
      const downloaded = new Set(config.snapshot.downloaded);
      return items.map((it) => ({ ...it, downloaded: downloaded.has(it.id) }));
    }),
  );

  ipcMain.handle(
    'listTrash',
    guarded(async (): Promise<Item[]> => (await client().listAll({ trash: true })).map((it) => ({ ...it, downloaded: false }))),
  );

  ipcMain.handle(
    'updateFile',
    guarded(async (id: string, patch: { name?: string; tags?: TagColor[] }): Promise<Item> => {
      const item = await client().update(id, patch);
      itemCache.set(id, item);
      return { ...item, downloaded: config.snapshot.downloaded.includes(id) };
    }),
  );

  ipcMain.handle('vaultOpen', (_e, pin: string): UnlockResult => {
    if (!unlocked) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
    const res = tryUnlock(pin);
    if (res.ok) vaultOpen = true;
    return res;
  });
  ipcMain.handle('vaultClose', () => {
    vaultOpen = false;
  });
  ipcMain.handle('listVault', async (): Promise<Result<Item[]>> => {
    if (!unlocked) return { ok: false, error: 'locked' };
    if (!vaultOpen) return { ok: false, error: 'vault_locked' };
    try {
      const items = await client().listAll({ vault: true });
      for (const it of items) itemCache.set(it.id, it);
      const downloaded = new Set(config.snapshot.downloaded);
      return { ok: true, value: items.map((it) => ({ ...it, downloaded: downloaded.has(it.id) })) };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('setVault', async (_e, id: string, inVault: boolean): Promise<Result> => {
    if (!unlocked) return { ok: false, error: 'locked' };
    // Taking a file out of the Vault reveals it, so that needs the Vault open too.
    if (!inVault && !vaultOpen) return { ok: false, error: 'vault_locked' };
    try {
      await client().setVault(id, inVault);
      return { ok: true, value: undefined };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'usage',
    guarded(async () => client().usage()),
  );

  ipcMain.handle(
    'previewUrl',
    guarded(async (id: string) => client().downloadUrl(id)),
  );

  ipcMain.handle(
    'download',
    guarded(async (id: string, reveal = true) => {
      const item = itemCache.get(id);
      const url = await client().downloadUrl(id);
      const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
      if (!res.ok || !res.body) throw new ApiError('download_failed', `HTTP ${res.status}`, res.status);

      const dir = downloadDir();
      const name = uniqueFileName(item?.name ?? id, (n) => existsSync(join(dir, n)) || existsSync(join(dir, `${n}.part`)));
      const target = join(dir, name);
      const partial = `${target}.part`;
      try {
        await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(partial));
        renameSync(partial, target);
      } catch (err) {
        rmSync(partial, { force: true });
        throw err;
      }
      config.markDownloaded(id);
      if (reveal) shell.showItemInFolder(target);
      return target;
    }),
  );

  ipcMain.handle(
    'copyImage',
    guarded(async (id: string) => {
      const item = itemCache.get(id);
      let image = nativeImage.createFromBuffer(await fetchBytes(await client().downloadUrl(id)));
      // Formats such as HEIC can't be decoded here; fall back to the JPEG preview.
      if (image.isEmpty() && item?.thumbUrl) image = nativeImage.createFromBuffer(await fetchBytes(item.thumbUrl));
      if (image.isEmpty()) throw new ApiError('unsupported_image', 'Cannot decode image');
      const png = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' });
      await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    }),
  );

  ipcMain.handle(
    'remove',
    guarded(async (id: string) => {
      await client().remove(id);
      itemCache.delete(id);
    }),
  );

  ipcMain.handle(
    'restore',
    guarded(async (id: string) => {
      await client().restore(id);
    }),
  );

  ipcMain.handle(
    'removeForever',
    guarded(async (id: string) => client().removeForever(id)),
  );

  ipcMain.handle(
    'emptyTrash',
    guarded(async () => client().emptyTrash()),
  );

  ipcMain.handle('pairingQr', async (_e, pin: string) => {
    if (!unlocked) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
    const res = tryUnlock(pin);
    if (!res.ok) return res;
    const { serverUrl } = config.snapshot;
    const token = config.token;
    if (!serverUrl || !token) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
    const payload = `fatup://setup?${new URLSearchParams({ url: serverUrl, token })}`;
    const qr = await QRCode.toDataURL(payload, { margin: 1, width: 280, errorCorrectionLevel: 'M' });
    return { ok: true, qr };
  });
}

/** Linux needs the window icon spelled out; macOS and Windows take it from the app bundle. */
const windowIcon = () =>
  process.platform === 'linux' ? (app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icons/512x512.png')) : undefined;

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: windowIcon(),
    width: 1100,
    height: 740,
    minWidth: 420,
    minHeight: 480,
    show: false,
    title: 'FatUp',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#131314' : '#f8fafd',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  config = new ConfigStore(join(app.getPath('userData'), 'config.json'), safeStorage);
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  nativeTheme.themeSource = config.snapshot.prefs.theme ?? 'system';
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
