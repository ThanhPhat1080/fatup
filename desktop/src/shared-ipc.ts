/** Contract between the preload bridge and the renderer. */
import type { FileItem, FrameCheck, ShareExpiryDays, ShareInfo, TagColor, UsageResponse, VaultClientStatus } from '@fatup/shared';

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

/** `unreadable`: a Vault item whose metadata could not be decrypted (shown with an empty name; see `VaultSession.decryptList`). */
export type Item = FileItem & { downloaded: boolean; unreadable?: boolean };

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string; detail?: string };

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; lockedUntil: number };

/** Answer of the Vault's PIN checks (open, change PIN). `error` is an API error code such as `network`. */
export type VaultUnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; remaining: number }
  | { ok: false; reason: 'locked'; lockedUntil: number }
  | { ok: false; reason: 'wiped' }
  | { ok: false; reason: 'not_ready' }
  | { ok: false; reason: 'error'; error: string };

/** A new Vault PIN is refused before any request: too easy to guess, or too close to the app PIN. */
export type VaultPinRefusal = { ok: false; error: 'weak_pin' | 'matches_app_pin' };

/** Answer of `vaultSetup`: the recovery key is shown once, here. */
export type VaultSetupResult = { ok: true; recoveryKey: string } | { ok: false; error: string };

/** Answer of `vaultSetupCommit`. `error` is `no_prepared_setup`, `closed` (the Vault was closed meanwhile), `vault_exists` or an API error code. */
export type VaultSetupCommitResult = { ok: true } | { ok: false; error: string };

/** Answer of `vaultRecover`. `error` is `bad_recovery_key`, `weak_pin`, `matches_app_pin` or an API error code. */
export type VaultRecoverResult = { ok: true } | { ok: false; error: string };

/** Answer of `vaultMoveIn` / `vaultMoveOut`: how many items moved and the ids that did not. */
export type VaultMoveResult = { done: number; failed: string[] };

/** Progress of a batch of moves or of the conversion of old files. `current` is the real name of the item in progress; the final event of a conversion run has none. */
export type VaultProgress = { done: number; total: number; current?: string };

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

export type ViewBounds = { x: number; y: number; width: number; height: number };
export type WebPreviewState = { url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean };
/** Desktop only: a real browser view laid over part of the window, for web pages that can't be framed. */
export type WebPreviewApi = {
  show(url: string, bounds: ViewBounds): Promise<void>;
  setBounds(bounds: ViewBounds): void;
  hide(): void;
  navigate(action: 'back' | 'forward' | 'reload'): void;
  onState(cb: (s: WebPreviewState) => void): () => void;
  /** Esc pressed while the page has focus (the app never sees that key press itself). */
  onEscape(cb: () => void): () => void;
};

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
  /** Whether the encrypted Vault is set up (`none`, `ready`, `wiped`), the PIN attempts left and `open`: the key is held now (6 hours after the last correct PIN), so files can be moved in without a PIN. Needs no unlocked Vault. */
  vaultStatus(): Promise<Result<VaultClientStatus>>;
  /** First-time setup with the Vault PIN (6 digits) in one step. Opens the Vault and returns the recovery key, once. The renderer uses the two steps below. */
  vaultSetup(pin: string): Promise<VaultSetupResult>;
  /** First step: checks the PIN, makes the keys and returns the recovery key. Nothing reaches the server and the Vault stays closed. A new call replaces the last. */
  vaultSetupPrepare(pin: string): Promise<VaultSetupResult>;
  /** Second step, after the recovery key was confirmed: sets the Vault up on the server, opens it and starts converting old files. Closing the Vault discards a prepared setup. */
  vaultSetupCommit(): Promise<VaultSetupCommitResult>;
  /**
   * Opens the Vault with the Vault PIN. The server counts wrong attempts, not this app. `purpose` `view` (default: the Vault screen's gate) also
   * allows viewing the Vault; `move` (the PIN popup of the file list) only holds the key for moving files in.
   */
  vaultUnlock(pin: string, purpose?: 'view' | 'move'): Promise<VaultUnlockResult>;
  /** Sets a new Vault PIN with the recovery key and opens the Vault. No file is re-encrypted. */
  vaultRecover(recoveryKey: string, newPin: string): Promise<VaultRecoverResult>;
  /** Changes the Vault PIN, proving with the old one. */
  vaultChangePin(oldPin: string, newPin: string): Promise<VaultUnlockResult | VaultPinRefusal>;
  /** Leaves the Vault screen: the decrypted list and every address of a decrypted picture are dropped and a prepared setup is discarded, but the key is kept. Never refused. */
  vaultLeave(): Promise<void>;
  /** The Vault's items (or its own trash with `trash`), already decrypted. Fails with error 'vault_locked' unless the Vault was opened for viewing (`vaultUnlock` with purpose `view`, setup or recovery). */
  listVault(opts?: { trash?: boolean }): Promise<Result<Item[]>>;
  /** Encrypts plain files here and moves them into the Vault. */
  vaultMoveIn(ids: string[]): Promise<Result<VaultMoveResult>>;
  /** Decrypts Vault files here and moves them back out. */
  vaultMoveOut(ids: string[]): Promise<Result<VaultMoveResult>>;
  onVaultProgress(cb: (p: VaultProgress) => void): () => void;
  /** Changes a file's display name and/or colour tags. Fails with 'not_found' if it is gone or in the trash. */
  updateFile(id: string, patch: { name?: string; tags?: TagColor[]; url?: string; important?: boolean }): Promise<Result<Item>>;
  /** A photo or file's public share link, or null when it is not shared. */
  getShare(id: string): Promise<Result<ShareInfo | null>>;
  /** Creates the share link, or changes its expiry (the link stays the same). `null` = never expires. */
  setShare(id: string, expiresInDays: ShareExpiryDays | null): Promise<Result<ShareInfo>>;
  /** Stops sharing: the link stops working at once. */
  stopShare(id: string): Promise<Result>;
  /** Bookmarks a link. Fails with 'bad_url' for an address that is not http(s). */
  addLink(url: string, title?: string, vault?: boolean): Promise<Result<Item>>;
  /** Web only: a link that arrived through the Android share sheet while the app was locked. Returned once; `url` is empty when the share held no link. */
  takePendingLink?(): Promise<{ url: string; title?: string } | null>;
  /** Has the server read a link's page for its title, and keeps the link's picture on this device (fetched when there is none, or again with `force`). Returns the link ready to show. */
  previewLink(id: string, force?: boolean): Promise<Result<Item>>;
  /** Opens an http(s) address in the system browser. */
  openExternal(url: string): Promise<void>;
  previewUrl(id: string): Promise<Result<string>>;
  /** A file's contents, for showing it inside the app (PDF). */
  fileBytes(id: string): Promise<Result<Uint8Array>>;
  /** Web build only: whether a link's page can be shown in a frame here, and the address to frame. */
  linkFrame?(id: string): Promise<Result<FrameCheck>>;
  webPreview?: WebPreviewApi;
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
