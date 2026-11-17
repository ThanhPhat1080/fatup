import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeImage, nativeTheme, protocol, safeStorage, session, shell } from 'electron';
import { hostname } from 'node:os';
import { createWriteStream, existsSync, renameSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import QRCode from 'qrcode';
import type { FileItem, ShareExpiryDays, ShareInfo, TagColor } from '@fatup/shared';
import { autoUpdater } from 'electron-updater';
import type { AppState, Item, Prefs, Result, UnlockResult, UpdateCheck, ViewBounds, VaultMoveResult } from '../shared-ipc';
import { WebPreview } from './webpreview';
import { ApiClient, ApiError, normalizeServerUrl } from './api';
import { ConfigStore } from './config';
import { uniqueFileName } from './filename';
import { checkPin, hashPin, isValidPin, pinMatches } from './pin';
import { PreviewCache, fetchPicture } from '../preview-cache';
import { FilePreviewStore, PREVIEW_SCHEME } from './previews';
import { UploadManager } from './uploader';
import { VaultSession } from '../vault-session';
import { VAULT_SCHEME, createVaultHandlers, type VaultHandlers } from './vault-ipc';
import { fetchLatestRelease, isNewer, type ReleaseInfo } from './updater';

if (process.env.FATUP_USER_DATA) app.setPath('userData', process.env.FATUP_USER_DATA);
// Cached link pictures are loaded by the renderer as fatup-preview://p/<id>; the scheme has to be declared before the app is ready.
// Decrypted Vault pictures are served from memory as fatup-vault://thumb/<id> and fatup-vault://file/<id> (see vault-ipc.ts).
protocol.registerSchemesAsPrivileged([
  { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: VAULT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let config: ConfigStore;
let unlocked = false;
// Web pages opened from the link preview; created lazily, torn down on close and on lock.
const webPreview = new WebPreview(
  () => mainWindow,
  (channel, payload) => mainWindow?.webContents.send(channel, payload),
);
/**
 * The one encrypted-Vault session of this process: the master key lives only inside it. It is closed by `vaultClose`, `lock` and `reset`
 * (through `vault.vaultClose()`), and never leaves main.
 */
const vaultSession = new VaultSession({
  client: () => client(),
  // The Vault PIN may not share its first or last four digits with the app PIN; this check does not count against the lock screen's attempts.
  appPinMatches: (pin4) => {
    const record = config.snapshot.pin;
    return record ? pinMatches(pin4, record) : false;
  },
});
/** Vault IPC logic (no Electron imports); created once the app is ready because it needs the downloads folder. */
let vault: VaultHandlers;
let mainWindow: BrowserWindow | null = null;
const itemCache = new Map<string, FileItem>();
let pendingRelease: ReleaseInfo | null = null;
let previewFiles: FilePreviewStore;
/** Link pictures kept on this device (the server only names their address). */
let previews: PreviewCache;

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

// Shown as "From" in the file list. FATUP_DEVICE_NAME overrides it (handy for demos); "Tracys-MacBook-Air.local" becomes "Tracys-MacBook-Air".
const DEVICE_NAME = (process.env.FATUP_DEVICE_NAME || hostname().replace(/\.local$/i, '')).slice(0, 64) || null;

const uploads = new UploadManager({
  client: () => client(),
  device: DEVICE_NAME,
  thumbnail: makeThumbnail,
  onChange: (jobs) => mainWindow?.webContents.send('uploads', jobs),
  vault: vaultSession,
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
  ipcMain.handle('uploadPick', async (_e, intoVault?: boolean) => {
    if (!unlocked || !mainWindow || (intoVault && !vaultSession.isOpen())) return;
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
    if (!res.canceled) uploads.add(res.filePaths, intoVault === true);
  });
  ipcMain.handle('uploadPaths', (_e, paths: unknown, intoVault?: boolean) => {
    if (!unlocked || !Array.isArray(paths) || (intoVault && !vaultSession.isOpen())) return;
    uploads.add(paths.filter((p): p is string => typeof p === 'string' && p !== ''), intoVault === true);
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
      // `FATUP_SERVER=https://… npm run dev:desktop` pre-fills the setup screen with that server.
      defaultServerUrl: process.env.FATUP_SERVER || undefined,
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
    webPreview.hide();
    vault.vaultClose(); // closes the Vault session: the master key is forgotten
    uploads.cancelAll();
    itemCache.clear();
  });

  ipcMain.handle('reset', async () => {
    vault.vaultClose(); // closes the Vault session: the master key is forgotten
    uploads.cancelAll();
    config.reset();
    unlocked = false;
    webPreview.hide();
    itemCache.clear();
    await previews.clear(); // pictures of the old account's links must not outlive the connection
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
      const items = await client().listEverything();
      itemCache.clear();
      for (const it of items) itemCache.set(it.id, it);
      const downloaded = new Set(config.snapshot.downloaded);
      return previews.decorate(items.map((it) => ({ ...it, downloaded: downloaded.has(it.id) })));
    }),
  );

  ipcMain.handle(
    'listTrash',
    guarded(async (): Promise<Item[]> => previews.decorate((await client().listEverything({ trash: true })).map((it) => ({ ...it, downloaded: false })))),
  );

  ipcMain.handle(
    'updateFile',
    guarded(async (id: string, patch: { name?: string; tags?: TagColor[]; url?: string; important?: boolean }): Promise<Item> => {
      const item = await client().update(id, patch);
      itemCache.set(id, item);
      if (patch.url) await previews.forget([id]); // the old picture belongs to the old address
      return (await previews.decorate([{ ...item, downloaded: config.snapshot.downloaded.includes(id) }]))[0];
    }),
  );

  ipcMain.handle(
    'getShare',
    guarded(async (id: string): Promise<ShareInfo | null> => client().getShare(id)),
  );
  ipcMain.handle(
    'setShare',
    guarded(async (id: string, days: ShareExpiryDays | null): Promise<ShareInfo> => client().setShare(id, days)),
  );
  ipcMain.handle(
    'stopShare',
    guarded(async (id: string): Promise<void> => client().stopShare(id)),
  );

  ipcMain.handle(
    'addLink',
    guarded(async (url: string, title: string | undefined, intoVault: boolean | undefined): Promise<Item> => {
      let item = await client().addLink({ url, title, device: DEVICE_NAME ?? undefined });
      if (intoVault) item = await client().setVault(item.id, true);
      itemCache.set(item.id, item);
      return (await previews.decorate([{ ...item, downloaded: false }]))[0];
    }),
  );

  ipcMain.handle(
    'previewLink',
    guarded(async (id: string, force?: boolean): Promise<Item> => {
      const res = await client().previewLink(id);
      const { previewImage: _address, ...item } = res;
      itemCache.set(id, item);
      return previews.learn(res, force === true);
    }),
  );

  ipcMain.handle('openExternal', async (_e, url: string) => {
    if (unlocked && /^https?:\/\//i.test(url)) await shell.openExternal(url);
  });

  // The encrypted Vault. All of the logic is in vault-ipc.ts; these lines only route (and check the shape of what the renderer sends).
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  ipcMain.handle('vaultStatus', () => vault.vaultStatus());
  ipcMain.handle('vaultSetup', (_e, pin: unknown) => vault.vaultSetup(text(pin)));
  ipcMain.handle('vaultUnlock', (_e, pin: unknown) => vault.vaultUnlock(text(pin)));
  ipcMain.handle('vaultRecover', (_e, recoveryKey: unknown, newPin: unknown) => vault.vaultRecover(text(recoveryKey), text(newPin)));
  ipcMain.handle('vaultChangePin', (_e, oldPin: unknown, newPin: unknown) => vault.vaultChangePin(text(oldPin), text(newPin)));
  ipcMain.handle('vaultClose', () => vault.vaultClose());
  ipcMain.handle('listVault', (_e, opts?: { trash?: boolean }) => vault.listVault({ trash: opts?.trash === true }));
  // Task 9 (vault-mover.ts) implements moving files in and out; the legacy PUT /files/:id/vault is refused (426) once the Vault is set up.
  ipcMain.handle('vaultMoveIn', async (): Promise<Result<VaultMoveResult>> => ({ ok: false, error: 'not_supported' }));
  ipcMain.handle('vaultMoveOut', async (): Promise<Result<VaultMoveResult>> => ({ ok: false, error: 'not_supported' }));

  ipcMain.handle(
    'usage',
    guarded(async () => client().usage()),
  );

  // Encrypted Vault items are decrypted in main (vault-ipc.ts); everything else, legacy Vault items included, takes the plain path.
  const plainPreviewUrl = guarded(async (id: string) => client().downloadUrl(id));
  ipcMain.handle('previewUrl', (e, id: string) => (vault.owns(id) ? vault.previewUrl(id) : plainPreviewUrl(e, id)));
  const plainFileBytes = guarded(async (id: string) => new Uint8Array(await fetchBytes(await client().downloadUrl(id))));
  ipcMain.handle('fileBytes', (e, id: string) => (vault.owns(id) ? vault.fileBytes(id) : plainFileBytes(e, id)));
  ipcMain.handle('webPreview:show', (_e, url: string, bounds: ViewBounds) => {
    if (unlocked) webPreview.show(url, bounds);
  });
  ipcMain.on('webPreview:bounds', (_e, bounds: ViewBounds) => webPreview.setBounds(bounds));
  ipcMain.on('webPreview:hide', () => webPreview.hide());
  ipcMain.on('webPreview:navigate', (_e, action: 'back' | 'forward' | 'reload') => {
    if (['back', 'forward', 'reload'].includes(action)) webPreview.navigate(action);
  });

  const plainDownload = guarded(async (id: string, reveal = true) => {
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
    });
  ipcMain.handle('download', async (e, id: string, reveal = true) => {
    if (!vault.owns(id)) return plainDownload(e, id, reveal);
    const res = await vault.download(id);
    if (res.ok && reveal) shell.showItemInFolder(res.value);
    return res;
  });

  const copyToClipboard = async (image: Electron.NativeImage) => {
    if (image.isEmpty()) throw new ApiError('unsupported_image', 'Cannot decode image');
    const png = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
  };
  const plainCopyImage = guarded(async (id: string) => {
    const item = itemCache.get(id);
    let image = nativeImage.createFromBuffer(await fetchBytes(await client().downloadUrl(id)));
    // Formats such as HEIC can't be decoded here; fall back to the JPEG preview.
    if (image.isEmpty() && item?.thumbUrl) image = nativeImage.createFromBuffer(await fetchBytes(item.thumbUrl));
    await copyToClipboard(image);
  });
  ipcMain.handle('copyImage', async (e, id: string): Promise<Result> => {
    if (!vault.owns(id)) return plainCopyImage(e, id);
    const bytes = await vault.copyImageBytes(id);
    if (!bytes.ok) return bytes;
    try {
      let image = nativeImage.createFromBuffer(Buffer.from(bytes.value));
      if (image.isEmpty()) {
        // Same fallback as above: the decrypted JPEG preview.
        const thumb = await vault.vaultProtocol(`${VAULT_SCHEME}://thumb/${id}`);
        if (thumb.status === 200 && thumb.body) image = nativeImage.createFromBuffer(Buffer.from(thumb.body));
      }
      await copyToClipboard(image);
      return { ok: true, value: undefined };
    } catch (err) {
      return fail(err);
    }
  });

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
    guarded(async (id: string) => {
      await client().removeForever(id);
      await previews.forget([id]);
    }),
  );

  ipcMain.handle(
    'emptyTrash',
    guarded(async () => {
      const inTrash = await client().listEverything({ trash: true }).catch(() => []);
      const count = await client().emptyTrash();
      await previews.forget(inTrash.filter((it) => it.kind === 'link').map((it) => it.id));
      return count;
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
      plugins: true, // Chromium's built-in PDF viewer, for PDFs opened in the preview
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // Links clicked inside an embedded post or player ("Watch on YouTube") open in the browser, never in a new app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (unlocked && /^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  config = new ConfigStore(join(app.getPath('userData'), 'config.json'), safeStorage);
  previewFiles = new FilePreviewStore(join(app.getPath('userData'), 'previews'));
  // The end-to-end test serves its pictures from localhost, which is otherwise refused.
  const allowed = process.env.FATUP_E2E_LOCAL_PREVIEWS === '1' ? (u: string) => u.startsWith('http://127.0.0.1:') : undefined;
  previews = new PreviewCache(previewFiles, { fetchPicture: (url) => fetchPicture(url, undefined, allowed) });
  vault = createVaultHandlers({
    session: vaultSession,
    client: () => client(),
    isUnlocked: () => unlocked,
    downloadsDir: downloadDir(),
    // Written under a .part name and renamed, like every other download.
    writeFile: async (path, bytes) => {
      const partial = `${path}.part`;
      try {
        await writeFile(partial, bytes);
        renameSync(partial, path);
      } catch (err) {
        rmSync(partial, { force: true });
        throw err;
      }
    },
    fileExists: (path) => existsSync(path) || existsSync(`${path}.part`),
    isDownloaded: (id) => config.snapshot.downloaded.includes(id),
    markDownloaded: (id) => config.markDownloaded(id),
  });
  // Decrypted Vault pictures live only in memory: never cached by Chromium (no-store) and never written to the previews folder.
  protocol.handle(VAULT_SCHEME, async (req) => {
    const res = await vault.vaultProtocol(req.url);
    return new Response(res.body ? new Uint8Array(res.body) : null, {
      status: res.status,
      headers: { 'content-type': res.type ?? 'text/plain', 'cache-control': 'no-store' },
    });
  });
  protocol.handle(PREVIEW_SCHEME, async (req) => {
    const got = await previewFiles.read(new URL(req.url).pathname.slice(1));
    if (!got) return new Response('not found', { status: 404 });
    return new Response(new Uint8Array(got.bytes), { headers: { 'content-type': got.type, 'cache-control': 'max-age=31536000, immutable' } });
  });
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  nativeTheme.themeSource = config.snapshot.prefs.theme ?? 'system';
  registerIpc();
  // The app page is a file:// page, which sends no Referer, and YouTube refuses to play embeds without one (error 153).
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*'] }, (details, done) => {
    const headers = details.requestHeaders;
    if (!headers.Referer && !headers.referer) headers.Referer = 'https://fatup.app/';
    done({ requestHeaders: headers });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
