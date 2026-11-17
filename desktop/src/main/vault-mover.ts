// Moves files into and out of the encrypted Vault, and encrypts what was put in the Vault before it was encrypted. No Electron imports.
// One file at a time: download (plain or ciphertext) -> encrypt/decrypt in memory -> PUT -> complete. Files are at most MAX_FILE_SIZE,
// so they fit in memory. A failure of one item (network, tampered data, closed Vault) lands in `failed` and never stops the rest.
// The Worker only ever sees ciphertext and opaque ids: the real name, type and address travel inside `encMeta`.
// Interrupted runs are safe to repeat: PUT overwrites the target object and the Worker's complete calls are idempotent.
import { LINK_MIME, decryptBytes, encryptBytes, type FileItem, type VaultMeta } from '@fatup/shared';
import type { VaultSession } from '../vault-session';
import { ApiError, type ApiClient } from './api';

export type VaultMoverDeps = {
  /** The one session of the main process. */
  session: VaultSession;
  client(): Pick<ApiClient, 'moveIn' | 'moveInComplete' | 'moveOut' | 'moveOutComplete' | 'listEverything'>;
  /** Presigned GET / PUT. Default: the global `fetch`. */
  fetchImpl?: typeof fetch;
};

/** `current` is the id of the item just handled; `done` counts the items handled so far, failed ones included. */
export type MoveProgress = { done: number; total: number; current: string };
export type MoveResult = { done: string[]; failed: string[] };
export type ProgressCallback = (p: MoveProgress) => void;

const TRANSFER_TIMEOUT_MS = 10 * 60_000;

export function createVaultMover(deps: VaultMoverDeps) {
  const { session } = deps;
  /** The conversion of legacy items that is running now, so that two unlocks in a row do not run two. */
  let migration: Promise<void> | null = null;
  const fetchImpl = deps.fetchImpl ?? ((input: string | URL | Request, init?: RequestInit) => fetch(input, init));

  /** GETs a presigned address; null when the object does not exist (404). */
  async function get(url: string): Promise<Uint8Array | null> {
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS) });
    } catch (err) {
      throw new ApiError('network', (err as Error).message);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new ApiError('download_failed', `HTTP ${res.status}`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function getRequired(url: string): Promise<Uint8Array> {
    const bytes = await get(url);
    if (!bytes) throw new ApiError('download_failed', 'HTTP 404', 404);
    return bytes;
  }

  async function put(url: string, bytes: Uint8Array, contentType: string): Promise<void> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.length) },
        body: bytes as BodyInit,
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ApiError('network', (err as Error).message);
    }
    if (!res.ok) throw new ApiError('upload_failed', `HTTP ${res.status}`, res.status);
  }

  /** Runs `step` over `items` in order, counting every item (failed ones too) in the progress. */
  async function each(items: FileItem[], step: (item: FileItem) => Promise<void>, onProgress?: ProgressCallback): Promise<MoveResult> {
    const result: MoveResult = { done: [], failed: [] };
    for (const item of items) {
      try {
        await step(item);
        result.done.push(item.id);
      } catch {
        result.failed.push(item.id);
      }
      onProgress?.({ done: result.done.length + result.failed.length, total: items.length, current: item.id });
    }
    return result;
  }

  async function moveInOne(item: FileItem): Promise<void> {
    const link = item.kind === 'link';
    if (link && !item.url) throw new ApiError('bad_item', 'A link without an address');
    const meta: VaultMeta = link
      ? { kind: 'link', url: item.url, title: item.name, name: item.name, mime: LINK_MIME }
      : { name: item.name, mime: item.mime, kind: item.kind };
    // Fails with vault_locked before any request when the Vault is closed.
    const { encMeta, encKey, dek } = await session.encryptMetaFor(meta);
    const urls = await deps.client().moveIn(item.id);

    // Everything is read and encrypted before anything is written.
    let cipher: Uint8Array | null = null;
    if (!link) {
      if (!urls.downloadUrl) throw new ApiError('bad_response', 'No download address');
      cipher = await encryptBytes(await getRequired(urls.downloadUrl), dek);
    }
    let thumbCipher: Uint8Array | null = null;
    if (urls.thumbUrl && urls.thumbUploadUrl) {
      const thumb = await get(urls.thumbUrl); // a thumbnail already gone is not worth failing for
      if (thumb) thumbCipher = await encryptBytes(thumb, dek);
    }

    if (cipher) await put(urls.uploadUrl, cipher, 'application/octet-stream');
    if (thumbCipher && urls.thumbUploadUrl) await put(urls.thumbUploadUrl, thumbCipher, 'application/octet-stream');
    await deps.client().moveInComplete(item.id, { encMeta, encKey, size: cipher ? cipher.length : 0, hasThumb: thumbCipher !== null });
  }

  async function moveOutOne(item: FileItem): Promise<void> {
    if (!item.encrypted || !item.encMeta || !item.encKey) throw new ApiError('not_encrypted', 'The item is not encrypted');
    // Fails with vault_locked before any request when the Vault is closed.
    const [shown] = await session.decryptList([item]);
    if (shown.unreadable) throw new ApiError('unreadable', 'The item cannot be decrypted');
    const urls = await deps.client().moveOut(item.id);

    if (shown.kind === 'link') {
      if (!shown.url) throw new ApiError('unreadable', 'A link without an address');
      await deps.client().moveOutComplete(item.id, { url: shown.url, title: shown.name, name: shown.name, mime: LINK_MIME, size: 0, hasThumb: false });
      return;
    }

    const dek = await session.fileKey(item);
    if (!urls.downloadUrl) throw new ApiError('bad_response', 'No download address');
    const plain = await decryptBytes(await getRequired(urls.downloadUrl), dek);
    let thumb: Uint8Array | null = null;
    if (urls.thumbUrl && urls.thumbUploadUrl) {
      const sealed = await get(urls.thumbUrl);
      if (sealed) thumb = await decryptBytes(sealed, dek);
    }

    await put(urls.uploadUrl, plain, shown.mime);
    if (thumb && urls.thumbUploadUrl) await put(urls.thumbUploadUrl, thumb, 'image/jpeg');
    await deps.client().moveOutComplete(item.id, { name: shown.name, mime: shown.mime, size: plain.length, hasThumb: thumb !== null });
  }

  const mover = {
    /** Encrypts plain items here and moves them into the Vault. */
    moveIn: (items: FileItem[], onProgress?: ProgressCallback): Promise<MoveResult> => each(items, moveInOne, onProgress),

    /** Decrypts encrypted items (the raw rows, with `encMeta` and `encKey`) here and moves them back out. */
    moveOut: (items: FileItem[], onProgress?: ProgressCallback): Promise<MoveResult> => each(items, moveOutOne, onProgress),

    /** Encrypts every item that was put in the Vault before it was encrypted (in the Vault and in its trash). Already encrypted items are skipped. */
    async migrateLegacy(onProgress?: ProgressCallback): Promise<MoveResult> {
      const client = deps.client();
      const [live, trashed] = [await client.listEverything({ vault: true }), await client.listEverything({ vault: true, trash: true })];
      const seen = new Set<string>();
      const legacy = [...live, ...trashed].filter((it) => {
        if (!it.inVault || it.encrypted || seen.has(it.id)) return false;
        seen.add(it.id);
        return true;
      });
      return each(legacy, moveInOne, onProgress);
    },

    /** Runs `migrateLegacy` in the background, once at a time, and only while the Vault is open. Errors are swallowed: the next unlock tries again. */
    startMigration(onProgress?: ProgressCallback): void {
      if (migration || !session.isOpen()) return;
      migration = mover.migrateLegacy(onProgress)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          migration = null;
        });
    },

    /**
     * Moves Vault items out by id. `known` answers the encrypted rows the caller already holds; the others are looked up in the Vault's list.
     * Items put in the Vault before it was encrypted (still plain, so with no key to read) are encrypted first, because the legacy plain
     * move is refused once the encrypted Vault exists. Ids that are not in the Vault are reported as failed.
     */
    async moveOutIds(ids: string[], known: (id: string) => FileItem | undefined, onProgress?: ProgressCallback): Promise<MoveResult> {
      const client = deps.client();
      const rows = new Map<string, FileItem>();
      for (const id of ids) {
        const row = known(id);
        if (row) rows.set(id, row);
      }
      const failed = new Set<string>();
      if (rows.size < ids.length) {
        const listed = new Map((await client.listEverything({ vault: true })).map((it) => [it.id, it]));
        const plain: FileItem[] = [];
        for (const id of ids) {
          if (rows.has(id)) continue;
          const row = listed.get(id);
          if (!row) failed.add(id);
          else if (row.encrypted) rows.set(id, row);
          else plain.push(row);
        }
        if (plain.length) {
          const moved = await each(plain, moveInOne);
          for (const id of moved.failed) failed.add(id);
          if (moved.done.length) {
            const fresh = new Map((await client.listEverything({ vault: true })).map((it) => [it.id, it]));
            for (const id of moved.done) {
              const row = fresh.get(id);
              if (row?.encrypted) rows.set(id, row);
              else failed.add(id);
            }
          }
        }
      }
      const todo = ids.map((id) => rows.get(id)).filter((r): r is FileItem => r !== undefined);
      const res = await each(todo, moveOutOne, onProgress);
      return { done: res.done, failed: [...failed, ...res.failed] };
    },
  };
  return mover;
}

export type VaultMover = ReturnType<typeof createVaultMover>;
