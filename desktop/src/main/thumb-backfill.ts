import type { Item } from '../shared-ipc';
import type { ApiClient } from './api';

export type ThumbBackfillDeps = {
  client(): Pick<ApiClient, 'downloadUrl' | 'thumbUpload' | 'thumbComplete'>;
  fetchBytes(url: string): Promise<Uint8Array>;
  /** A 400 px JPEG, or null when the image cannot be decoded here (for example HEIC). */
  thumbnail(bytes: Uint8Array): Buffer | null;
  putThumb(url: string, bytes: Buffer): Promise<void>;
};

/**
 * Makes the thumbnail of images that were added without one (the ones imported from the bucket folder, mostly): downloads the original,
 * shrinks it, uploads the result. One image at a time, in the background, and each image at most once per session whether it worked or not.
 * No Electron import, so it can be tested.
 */
export function createThumbBackfill(deps: ThumbBackfillDeps) {
  const attempted = new Set<string>();
  const queue: string[] = [];
  let working: Promise<void> | null = null;

  async function makeOne(id: string): Promise<void> {
    try {
      const api = deps.client();
      const bytes = await deps.fetchBytes(await api.downloadUrl(id));
      const thumb = deps.thumbnail(bytes);
      if (!thumb) return;
      await deps.putThumb((await api.thumbUpload(id)).thumbUploadUrl, thumb);
      await api.thumbComplete(id);
    } catch {
      // A thumbnail is a nicety: the list shows the original until a later session tries again.
    }
  }

  async function drain(): Promise<void> {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) await makeOne(id);
    working = null;
  }

  return {
    /** Queues the images of `items` that need a thumbnail. `hasThumb` must be exactly false: an older server does not say, so nothing is assumed. */
    run(items: Item[]): void {
      for (const it of items) {
        if (it.kind !== 'image' || it.hasThumb !== false || it.inVault || it.encrypted || it.deletedAt !== null || attempted.has(it.id)) continue;
        attempted.add(it.id);
        queue.push(it.id);
      }
      if (queue.length > 0 && !working) working = drain();
    },
    /** Resolves when the queue is empty (for tests). */
    async idle(): Promise<void> {
      while (working) await working;
    },
  };
}
