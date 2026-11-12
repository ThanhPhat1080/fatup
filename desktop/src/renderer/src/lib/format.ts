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
