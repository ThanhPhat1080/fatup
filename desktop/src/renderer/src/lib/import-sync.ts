import { IMPORT_SYNC_MIN_GAP_MS } from '@fatup/shared';

/** Whether a refresh should also ask the server to import the bucket folder: never synced yet (`last` 0), or `minGap` ms have passed. */
export function shouldSyncImport(now: number, last: number, minGap = IMPORT_SYNC_MIN_GAP_MS): boolean {
  return last === 0 || now - last >= minGap;
}
