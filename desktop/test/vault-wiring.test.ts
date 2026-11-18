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
    for (const name of ['vaultStatus', 'vaultSetup', 'vaultUnlock', 'vaultRecover', 'vaultChangePin', 'vaultLeave', 'listVault']) {
      expect(preload, name).toContain(name);
      expect(contract, name).toContain(name);
    }
    for (const old of ['vaultOpen', 'setVault']) {
      expect(preload, old).not.toContain(old);
      expect(contract, old).not.toContain(`${old}(`);
    }
  });

  // Plan 2026-11-18-vault-session-6h, decision 4: the renderer's `vaultClose` is now `vaultLeave` (view-only close); only the main process
  // (lock, reset, expiry) fully closes the Vault.
  it('the renderer bridge calls it vaultLeave, not vaultClose: contract, preload and the main-process handler', () => {
    const preload = src('preload/index.ts');
    const contract = src('shared-ipc.ts');
    const main = src('main/index.ts');
    expect(contract).toMatch(/\bvaultLeave\(/);
    expect(preload).toContain('vaultLeave:');
    expect(preload).toContain("ipcRenderer.invoke('vaultLeave'");
    expect(main).toContain("ipcMain.handle('vaultLeave'");
    expect(contract).not.toContain('vaultClose');
    expect(preload).not.toContain('vaultClose');
    expect(main).not.toContain("ipcMain.handle('vaultClose'");
  });

  it('the main process maps vaultLeave to the core vaultLeave, and still fully closes the Vault on lock and reset', () => {
    const main = src('main/index.ts');
    expect(main).toMatch(/ipcMain\.handle\('vaultLeave',[^)]*\)\s*=>\s*vault\.vaultLeave\(\)/);
    expect(main.match(/vault\.vaultClose\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('vaultUnlock carries the purpose through the bridge (preload and main handler)', () => {
    const preload = src('preload/index.ts');
    const contract = src('shared-ipc.ts');
    const main = src('main/index.ts');
    expect(contract).toMatch(/vaultUnlock\(pin: string, purpose\??: 'view' \| 'move'\)/);
    expect(preload).toMatch(/vaultUnlock:\s*\(pin, purpose\)\s*=>\s*ipcRenderer\.invoke\('vaultUnlock', pin, purpose\)/);
    expect(main).toMatch(/ipcMain\.handle\('vaultUnlock',\s*async \(_e, pin: unknown, purpose: unknown\)/);
  });

  it('Main.tsx calls vaultLeave (leaving the Vault screen) and never the full close', () => {
    const main = src('renderer/src/components/Main.tsx');
    expect(main).not.toContain('fatup.vaultClose');
    expect(main).toContain('fatup.vaultLeave');
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
