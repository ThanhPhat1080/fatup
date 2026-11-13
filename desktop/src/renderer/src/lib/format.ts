import type { Dict, Locale } from './i18n';

export type DateGroup<T> = { key: string; label: string; items: T[] };

function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ms: number, now: number, t: Pick<Dict, 'today' | 'yesterday'>, locale: Locale): string {
  const diffDays = Math.round((dayStart(now) - dayStart(ms)) / 86_400_000);
  if (diffDays === 0) return t.today;
  if (diffDays === 1) return t.yesterday;
  const d = new Date(ms);
  if (locale === 'vi') {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Groups items (already sorted newest first) into consecutive calendar-day buckets. */
export function groupByDay<T extends { createdAt: number }>(
  items: T[],
  now: number,
  t: Pick<Dict, 'today' | 'yesterday'>,
  locale: Locale,
): DateGroup<T>[] {
  const groups: DateGroup<T>[] = [];
  for (const item of items) {
    const key = String(dayStart(item.createdAt));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.createdAt, now, t, locale), items: [item] });
  }
  return groups;
}

export type SortKey = 'name' | 'createdAt' | 'size';
export type SortState = { key: SortKey; dir: 'asc' | 'desc' };
export const DEFAULT_SORT: SortState = { key: 'createdAt', dir: 'desc' };

/** Returns a sorted copy. Name uses natural, accent-insensitive order ("img2" before "img10"); ties fall back to name then id. */
export function sortItems<T extends { id: string; name: string; size: number; createdAt: number }>(items: T[], sort: SortState): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  return [...items].sort((a, b) => {
    const primary = sort.key === 'name' ? byName(a, b) : a[sort.key] - b[sort.key];
    return sign * primary || byName(a, b) || (a.id < b.id ? -1 : 1);
  });
}

/** One unlabeled bucket, for sort orders where day headings make no sense. */
export function singleGroup<T>(items: T[]): DateGroup<T>[] {
  return items.length ? [{ key: 'all', label: '', items }] : [];
}

export type UsageLevel = 'ok' | 'warn' | 'crit';

/** Green below 70% used, orange from 70%, red from 90%. */
export function usageLevel(used: number, limit: number): UsageLevel {
  const ratio = limit > 0 ? used / limit : 0;
  return ratio >= 0.9 ? 'crit' : ratio >= 0.7 ? 'warn' : 'ok';
}

/** Decimal gigabytes with two decimals, e.g. "1.23" (locale-aware separator). */
export function formatGb(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(bytes / 1e9);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Case- and accent-insensitive matching, so "anh" finds "Ảnh". */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function matchesQuery(name: string, query: string): boolean {
  const q = normalizeForSearch(query.trim());
  return q === '' || normalizeForSearch(name).includes(q);
}

export type FileVisual = 'image' | 'pdf' | 'doc' | 'sheet' | 'slide' | 'archive' | 'video' | 'audio' | 'text' | 'other';

export function fileVisual(name: string, mime: string): FileVisual {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (['doc', 'docx', 'odt', 'rtf', 'pages'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'ods', 'csv', 'numbers'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'slide';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'apk'].includes(ext)) return 'archive';
  if (mime.startsWith('text/') || ['txt', 'md', 'json', 'log'].includes(ext)) return 'text';
  return 'other';
}

/** Splits "photo.final.jpg" into `{ stem: "photo.final", ext: ".jpg" }`. A leading dot (".gitignore") or trailing dot is not an extension. */
export function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/** An empty filter matches everything; otherwise a file matches when it carries at least one of the chosen colours. */
export function matchesTags(tags: readonly string[], filter: readonly string[]): boolean {
  return filter.length === 0 || tags.some((c) => filter.includes(c));
}
