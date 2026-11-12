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
};
