import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore, DEFAULT_PREFS, type Crypter } from '../src/main/config';
import { lockScene, vaultGateStill } from '../src/renderer/src/lib/lock-scene';

describe('lockScene', () => {
  it('uses the simple door when the LOTR lock is off', () => {
    expect(lockScene(false, false)).toBe('simple');
    expect(lockScene(false, true)).toBe('simple');
  });
  it('uses Moria on wide screens and the gate on phones when on', () => {
    expect(lockScene(true, false)).toBe('moria');
    expect(lockScene(true, true)).toBe('gate');
  });
});

describe('vaultGateStill', () => {
  it('is always still when the LOTR lock is off', () => {
    expect(vaultGateStill(false, false)).toBe(true);
    expect(vaultGateStill(false, true)).toBe(true);
  });
  it('follows the still flag when on', () => {
    expect(vaultGateStill(true, false)).toBe(false);
    expect(vaultGateStill(true, true)).toBe(true);
  });
});

describe('lotrLock pref default', () => {
  const crypter: Crypter = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => b.toString().replace(/^enc:/, ''),
  };
  it('defaults to false', () => {
    expect(DEFAULT_PREFS.lotrLock).toBe(false);
  });
  it('is false for an old config without the key', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fatup-')), 'config.json');
    writeFileSync(file, JSON.stringify({ prefs: { lang: 'vi', theme: 'dark' } }));
    expect(new ConfigStore(file, crypter).snapshot.prefs.lotrLock).toBe(false);
  });
});
