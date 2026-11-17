// The main-process half of the encrypted Vault, with no Electron imports so it can be unit-tested.
// `index.ts` calls these functions from its `ipcMain.handle(...)` lines and from `protocol.handle(...)`.
// The logic itself is in `../vault-handlers.ts` (no Node imports, the PWA runs it too); this file adds what only the desktop has:
// downloads written to a folder on disk, and pictures served to the renderer under `fatup-vault://` from memory.
// The renderer gets names, types and decrypted bytes, never a key (MK, DEK, S), `encMeta` or `encKey`.
// Nothing decrypted is written to disk except by `download`, which is the user's explicit request.
import { join } from 'node:path';
import { VAULT_SCHEME, createVaultCore, schemeViews, type VaultCoreDeps, type VaultProtocolResponse } from '../vault-handlers';
import { uniqueFileName } from './filename';

export { VAULT_SCHEME };
export type { VaultProtocolResponse };

export type VaultHandlerDeps = Omit<VaultCoreDeps, 'saveDownload' | 'views' | 'isDownloaded' | 'markDownloaded'> & {
  /** Where `download` saves. */
  downloadsDir: string;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** For `uniqueFileName`: is this path already taken? */
  fileExists(path: string): boolean;
  isDownloaded(id: string): boolean;
  markDownloaded(id: string): void;
};

export function createVaultHandlers(deps: VaultHandlerDeps) {
  const core = createVaultCore({
    ...deps,
    views: schemeViews,
    saveDownload: async (name, bytes) => {
      const unique = uniqueFileName(name, (n) => deps.fileExists(join(deps.downloadsDir, n)));
      const target = join(deps.downloadsDir, unique);
      await deps.writeFile(target, bytes);
      return target;
    },
  });

  return {
    ...core,

    /** Serves `fatup-vault://thumb/<id>` and `fatup-vault://file/<id>` from memory. Writes nothing; 404 unless the app is unlocked and the Vault open. */
    async vaultProtocol(rawUrl: string): Promise<VaultProtocolResponse> {
      const notFound: VaultProtocolResponse = { status: 404 };
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return notFound;
      }
      if (url.protocol !== `${VAULT_SCHEME}:`) return notFound;
      const kind = url.hostname;
      if (kind !== 'file' && kind !== 'thumb') return notFound;
      const id = /^\/([\w-]{1,64})$/.exec(url.pathname)?.[1];
      if (!id) return notFound;
      return core.serve(id, kind);
    },
  };
}

export type VaultHandlers = ReturnType<typeof createVaultHandlers>;
