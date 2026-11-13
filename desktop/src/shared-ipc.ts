/** Contract between the preload bridge and the renderer. */
import type { FileItem, TagColor, UsageResponse } from '@fatup/shared';

export type Lang = 'auto' | 'en' | 'vi';
export type Theme = 'system' | 'light' | 'dark';
export type ViewMode = 'grid' | 'list';
export type Tab = 'all' | 'image' | 'file' | 'link';

export type Prefs = {
  lang: Lang;
  theme: Theme;
  viewModes: Record<Tab, ViewMode>;
};

export type AppState = {
  /** Which shell is hosting the UI; the web (PWA) build hides desktop-only features. */
  platform: 'desktop' | 'web';
  /** Pre-filled server URL for first setup (the web build is served by the Worker itself). */
  defaultServerUrl?: string;
  configured: boolean;
  hasPin: boolean;
  unlocked: boolean;
  systemLocale: string;
  prefs: Prefs;
  serverUrl: string | null;
};

export type Usage = UsageResponse;

export type Item = FileItem & { downloaded: boolean };

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string; detail?: string };

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; lockedUntil: number };

export type UpdateCheck =
  | { status: 'latest'; current: string }
  | { status: 'available'; current: string; version: string; auto: boolean }
  | { status: 'error'; detail?: string };

export type UploadJob = {
  id: string;
  name: string;
  size: number;
  sent: number;
  state: 'queued' | 'uploading' | 'done' | 'error' | 'canceled';
  /** Error code (see errorText) when state is 'error'. */
  error?: string;
};

export type UpdateProgress = { percent: number };

export type FatupApi = {
  getState(): Promise<AppState>;
  testConnection(serverUrl: string, token: string): Promise<Result>;
  saveConnection(serverUrl: string, token: string): Promise<Result>;
  setPin(pin: string): Promise<Result>;
  unlock(pin: string): Promise<UnlockResult>;
  lock(): Promise<void>;
  reset(): Promise<void>;
  changePin(oldPin: string, newPin: string): Promise<UnlockResult>;
  setPrefs(prefs: Partial<Prefs>): Promise<Prefs>;
  list(): Promise<Result<Item[]>>;
  listTrash(): Promise<Result<Item[]>>;
  usage(): Promise<Result<Usage>>;
  /** Re-checks the PIN and opens the Vault for this session. Shares the PIN attempt limit with the lock screen. */
  vaultOpen(pin: string): Promise<UnlockResult>;
  vaultClose(): Promise<void>;
  /** Fails with error 'vault_locked' unless vaultOpen succeeded. */
  listVault(): Promise<Result<Item[]>>;
  setVault(id: string, inVault: boolean): Promise<Result>;
  /** Changes a file's display name and/or colour tags. Fails with 'not_found' if it is gone or in the trash. */
  updateFile(id: string, patch: { name?: string; tags?: TagColor[]; url?: string }): Promise<Result<Item>>;
  /** Bookmarks a link. Fails with 'bad_url' for an address that is not http(s). */
  addLink(url: string, title?: string, vault?: boolean): Promise<Result<Item>>;
  /** Web only: a link that arrived through the Android share sheet while the app was locked. Returned once; `url` is empty when the share held no link. */
  takePendingLink?(): Promise<{ url: string; title?: string } | null>;
  /** Has the server fetch a link's title and image (once, or again with `force`). */
  previewLink(id: string, force?: boolean): Promise<Result<Item>>;
  /** Opens an http(s) address in the system browser. */
  openExternal(url: string): Promise<void>;
  previewUrl(id: string): Promise<Result<string>>;
  /** Saves a file to the downloads folder. `reveal` (default true) also shows it in the file manager; bulk downloads pass false for all but the last. */
  download(id: string, reveal?: boolean): Promise<Result<string>>;
  copyImage(id: string): Promise<Result>;
  /** Moves a file to the trash (it can be restored for 30 days). */
  remove(id: string): Promise<Result>;
  restore(id: string): Promise<Result>;
  removeForever(id: string): Promise<Result>;
  emptyTrash(): Promise<Result<number>>;
  pairingQr(pin: string): Promise<UnlockResult & { qr?: string }>;
  /** Opens the system file picker and queues the chosen files for upload. */
  uploadPick(vault?: boolean): Promise<void>;
  /** Queues files by absolute path (used for drag and drop). */
  uploadPaths(paths: string[], vault?: boolean): Promise<void>;
  uploadCancel(id: string): Promise<void>;
  uploadClear(): Promise<void>;
  uploadList(): Promise<UploadJob[]>;
  onUploads(cb: (jobs: UploadJob[]) => void): () => void;
  /** Absolute paths of dropped File objects (empty entries are skipped). */
  pathsForFiles(files: File[]): string[];
  appVersion(): Promise<string>;
  checkForUpdate(): Promise<UpdateCheck>;
  /** Downloads and installs the update (restarting the app), or opens the release page when auto-install isn't possible. */
  installUpdate(): Promise<Result>;
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void;
};
