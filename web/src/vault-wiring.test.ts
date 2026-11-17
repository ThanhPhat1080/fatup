// Task 10 wiring that unit tests cannot load (browser-api.ts needs a page: window, localStorage, the renderer): checked as text.
// The behaviour behind it is pinned in vault-web.test.ts and uploader.test.ts.
import { describe, expect, it } from 'vitest';
// `?raw` gives the file's text (the web tsconfig has no Node types, so no `node:fs`).
import apiSource from './browser-api.ts?raw';
import viteConfigSource from '../vite.config.ts?raw';

const between = (text: string, from: RegExp, to: RegExp): string => {
  const start = text.search(from);
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  const end = rest.search(to);
  return end < 0 ? rest : rest.slice(0, end);
};

describe('wiring (static checks on files the unit tests cannot load)', () => {
  const api: string = apiSource;

  it('browser-api.ts builds the Vault bridge from createWebVault', () => {
    expect(api).toContain('createWebVault');
    expect(api).toMatch(/from '\.\/vault-web'/);
  });

  it('browser-api.ts no longer keeps the plain "vault is open" flag, the legacy moves or the not_supported stubs', () => {
    expect(api).not.toContain('vaultIsOpen');
    expect(api).not.toContain('moveLegacy');
    expect(api).not.toContain('not_supported');
    expect(api).not.toMatch(/setVault\(/);
  });

  it('browser-api.ts hands the uploader the Vault encryptor, so Vault uploads are encrypted', () => {
    expect(api).toContain('uploadEncryptor');
  });

  it('lock and reset close the Vault (the key and the object URLs must not outlive them)', () => {
    const lock = between(api, /\n    lock: async/, /\n    reset: async/);
    const reset = between(api, /\n    reset: async/, /\n    changePin: async/);
    expect(lock).toMatch(/vaultClose\(\)/);
    expect(reset).toMatch(/vaultClose\(\)/);
  });

  it('the dev server proxies /vault to the Worker (a new top-level API path must be listed in API_PATHS)', () => {
    const line = /const API_PATHS = \[([^\]]*)\]/.exec(viteConfigSource)?.[1] ?? '';
    expect(line).toContain("'vault'");
  });

  it('browser-api.ts exposes the two-step Vault setup through the web Vault (review I1)', () => {
    expect(api).toMatch(/vaultSetupPrepare:\s*\(?[^\n]*webVault\.vaultSetupPrepare/);
    expect(api).toMatch(/vaultSetupCommit:\s*\(?[^\n]*webVault\.vaultSetupCommit/);
  });
});
