// Task 8 wiring that unit tests cannot load (Electron main, preload, the HTML): checked as text.
// The behaviour behind it is pinned in vault-ipc.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('wiring (static checks on files the unit tests cannot load)', () => {
  const src = (path: string) => readFileSync(join(__dirname, '..', 'src', path), 'utf8');

  it('allows fatup-vault: pictures in the renderer CSP, and keeps fatup-preview:', () => {
    const html = readFileSync(join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
    const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
    const imgSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('img-src '));
    expect(imgSrc).toBeDefined();
    expect(imgSrc!.split(/\s+/)).toContain('fatup-vault:');
    expect(imgSrc!.split(/\s+/)).toContain('fatup-preview:');
  });

  it('index.ts builds its Vault handlers from vault-ipc and serves the scheme', () => {
    const main = src('main/index.ts');
    expect(main).toContain('createVaultHandlers');
    expect(main).toContain('VAULT_SCHEME');
    const registration = /registerSchemesAsPrivileged\(\[[\s\S]*?\]\)/.exec(main)?.[0] ?? '';
    expect(registration).toContain('VAULT_SCHEME');
  });

  it('index.ts no longer keeps a plain "vault is open" flag or the old IPC names', () => {
    const main = src('main/index.ts');
    expect(main).not.toMatch(/\bvaultOpen\s*=/);
    expect(main).not.toContain("'vaultOpen'");
    expect(main).not.toContain("'setVault'");
  });

  it('the bridge exposes the new Vault calls and not the old ones', () => {
    const preload = src('preload/index.ts');
    const contract = src('shared-ipc.ts');
    for (const name of ['vaultStatus', 'vaultSetup', 'vaultUnlock', 'vaultRecover', 'vaultChangePin', 'vaultClose', 'listVault']) {
      expect(preload, name).toContain(name);
      expect(contract, name).toContain(name);
    }
    for (const old of ['vaultOpen', 'setVault']) {
      expect(preload, old).not.toContain(old);
      expect(contract, old).not.toContain(`${old}(`);
    }
  });

  it('the bridge exposes the two-step Vault setup (review I1): contract, preload and the main-process handlers', () => {
    const preload = src('preload/index.ts');
    const contract = src('shared-ipc.ts');
    const main = src('main/index.ts');
    for (const name of ['vaultSetupPrepare', 'vaultSetupCommit']) {
      expect(contract, `FatupApi.${name}`).toMatch(new RegExp(`\\b${name}\\(`));
      expect(preload, `preload ${name}`).toContain(`${name}:`);
      expect(preload, `preload invoke ${name}`).toContain(`ipcRenderer.invoke('${name}'`);
      expect(main, `ipcMain.handle ${name}`).toContain(`ipcMain.handle('${name}'`);
    }
  });

  it('only a successful commit starts the background conversion in the main process (not the prepare step)', () => {
    const main = src('main/index.ts');
    // The text of one registration: from `ipcMain.handle('<name>'` up to the next registration.
    const registration = (name: string) => main.split('ipcMain.handle(').find((chunk) => chunk.startsWith(`'${name}'`)) ?? '';
    const prepare = registration('vaultSetupPrepare');
    const commit = registration('vaultSetupCommit');
    expect(prepare).not.toBe('');
    expect(commit).not.toBe('');
    expect(prepare).not.toContain('afterOpen');
    expect(commit).toContain('afterOpen');
  });

  it('the vaultMoveIn handler has no legacy setVault loop any more (spec 4.7d: the Vault is set up first, then the files move)', () => {
    const main = src('main/index.ts');
    const registration = main.split('ipcMain.handle(').find((chunk) => chunk.startsWith("'vaultMoveIn'")) ?? '';
    expect(registration).not.toBe('');
    expect(registration).not.toContain('setVault(');
    expect(registration).not.toContain("state === 'none'");
    expect(main).not.toMatch(/\.setVault\(/);
  });
});
