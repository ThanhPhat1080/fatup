import { app, BrowserWindow, clipboard, ClipboardItem, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, shell } from 'electron';
import { createWriteStream, existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import QRCode from 'qrcode';
import type { FileItem } from '@fatup/shared';
import { autoUpdater } from 'electron-updater';
import type { AppState, Item, Prefs, Result, UnlockResult, UpdateCheck } from '../shared-ipc';
import { ApiClient, ApiError, normalizeServerUrl } from './api';
import { ConfigStore } from './config';
import { uniqueFileName } from './filename';
import { checkPin, hashPin, isValidPin } from './pin';
import { fetchLatestRelease, isNewer, type ReleaseInfo } from './updater';

if (process.env.FATUP_USER_DATA) app.setPath('userData', process.env.FATUP_USER_DATA);

let config: ConfigStore;
let unlocked = false;
let mainWindow: BrowserWindow | null = null;
const itemCache = new Map<string, FileItem>();
let pendingRelease: ReleaseInfo | null = null;

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
    itemCache.clear();
  });

  ipcMain.handle('reset', () => {
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

  ipcMain.handle('setPrefs', (_e, prefs: Partial<Prefs>) => config.setPrefs(prefs));

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
    'previewUrl',
    guarded(async (id: string) => client().downloadUrl(id)),
  );

  ipcMain.handle(
    'download',
    guarded(async (id: string) => {
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
      shell.showItemInFolder(target);
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

function createWindow() {
  mainWindow = new BrowserWindow({
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
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
