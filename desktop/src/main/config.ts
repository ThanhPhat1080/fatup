import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Prefs } from '../shared-ipc';
import type { LockoutState, PinRecord } from './pin';

export type Crypter = {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(enc: Buffer): string;
};

type StoredToken = { encrypted: boolean; data: string };

export type ConfigData = {
  version: 1;
  serverUrl: string | null;
  token: StoredToken | null;
  pin: PinRecord | null;
  lockout: LockoutState;
  prefs: Prefs;
  /** Ids already saved to this computer, newest last. */
  downloaded: string[];
};

export const DEFAULT_PREFS: Prefs = {
  lang: 'auto',
  viewModes: { all: 'list', image: 'grid', file: 'list' },
};

const MAX_DOWNLOADED = 2000;

function defaults(): ConfigData {
  return {
    version: 1,
    serverUrl: null,
    token: null,
    pin: null,
    lockout: { failedAttempts: 0, lockedUntil: 0 },
    prefs: structuredClone(DEFAULT_PREFS),
    downloaded: [],
  };
}

/** Small JSON file in userData. Writes are atomic (temp file + rename). */
export class ConfigStore {
  private data: ConfigData;

  constructor(
    private readonly file: string,
    private readonly crypter: Crypter,
  ) {
    this.data = this.load();
  }

  private load(): ConfigData {
    if (!existsSync(this.file)) return defaults();
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ConfigData>;
      const base = defaults();
      return {
        ...base,
        ...parsed,
        lockout: { ...base.lockout, ...parsed.lockout },
        prefs: { ...base.prefs, ...parsed.prefs, viewModes: { ...base.prefs.viewModes, ...parsed.prefs?.viewModes } },
        downloaded: Array.isArray(parsed.downloaded) ? parsed.downloaded : [],
      };
    } catch {
      return defaults();
    }
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  get snapshot(): Readonly<ConfigData> {
    return this.data;
  }

  get token(): string | null {
    const t = this.data.token;
    if (!t) return null;
    try {
      return t.encrypted ? this.crypter.decryptString(Buffer.from(t.data, 'base64')) : Buffer.from(t.data, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  setConnection(serverUrl: string, token: string) {
    const encrypted = this.crypter.isEncryptionAvailable();
    const data = encrypted ? this.crypter.encryptString(token).toString('base64') : Buffer.from(token, 'utf8').toString('base64');
    this.data.serverUrl = serverUrl;
    this.data.token = { encrypted, data };
    this.save();
  }

  setPin(pin: PinRecord) {
    this.data.pin = pin;
    this.data.lockout = { failedAttempts: 0, lockedUntil: 0 };
    this.save();
  }

  setLockout(lockout: LockoutState) {
    this.data.lockout = lockout;
    this.save();
  }

  setPrefs(prefs: Partial<Prefs>): Prefs {
    this.data.prefs = {
      ...this.data.prefs,
      ...prefs,
      viewModes: { ...this.data.prefs.viewModes, ...prefs.viewModes },
    };
    this.save();
    return this.data.prefs;
  }

  markDownloaded(id: string) {
    const list = this.data.downloaded.filter((x) => x !== id);
    list.push(id);
    this.data.downloaded = list.slice(-MAX_DOWNLOADED);
    this.save();
  }

  /** Wipes connection, PIN and history but keeps display preferences. */
  reset() {
    const prefs = this.data.prefs;
    this.data = { ...defaults(), prefs };
    this.save();
  }
}
