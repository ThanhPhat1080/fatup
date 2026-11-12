/** Contract between the preload bridge and the renderer. */
import type { FileItem } from '@fatup/shared';

export type Lang = 'auto' | 'en' | 'vi';
export type ViewMode = 'grid' | 'list';
export type Tab = 'all' | 'image' | 'file';

export type Prefs = {
  lang: Lang;
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
  previewUrl(id: string): Promise<Result<string>>;
  download(id: string): Promise<Result<string>>;
  copyImage(id: string): Promise<Result>;
  remove(id: string): Promise<Result>;
  pairingQr(pin: string): Promise<UnlockResult & { qr?: string }>;
  appVersion(): Promise<string>;
  checkForUpdate(): Promise<UpdateCheck>;
  /** Downloads and installs the update (restarting the app), or opens the release page when auto-install isn't possible. */
  installUpdate(): Promise<Result>;
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void;
};
