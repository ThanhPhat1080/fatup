import { extname } from 'node:path';

/** Makes a name safe for any OS file system. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  const base = cleaned || 'file';
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(base) ? `_${base}` : base;
}

/** Returns `name`, or `name (1).ext`, `name (2).ext`… — the first one `exists` rejects. */
export function uniqueFileName(name: string, exists: (candidate: string) => boolean): string {
  const safe = safeFileName(name);
  if (!exists(safe)) return safe;
  const ext = extname(safe);
  const stem = ext && ext !== safe ? safe.slice(0, -ext.length) : safe;
  const realExt = ext && ext !== safe ? ext : '';
  for (let i = 1; ; i++) {
    const candidate = `${stem} (${i})${realExt}`;
    if (!exists(candidate)) return candidate;
  }
}
