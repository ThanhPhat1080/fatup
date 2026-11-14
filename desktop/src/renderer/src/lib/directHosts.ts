/**
 * Sites the person asked to open straight away instead of in the preview (the "next time, open … links straight away" box).
 * Kept per device in localStorage; a blocked or cleared store simply means every link gets the preview again.
 */
const KEY = 'fatup.openDirectHosts';

export function hostOf(url: string | null): string {
  try {
    return new URL(url ?? '').hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function read(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((h): h is string => typeof h === 'string') : [];
  } catch {
    return [];
  }
}

export function opensDirect(url: string | null): boolean {
  const host = hostOf(url);
  return host !== '' && read().includes(host);
}

export function setOpensDirect(url: string | null, on: boolean): void {
  const host = hostOf(url);
  if (!host) return;
  const hosts = read().filter((h) => h !== host);
  if (on) hosts.push(host);
  try {
    localStorage.setItem(KEY, JSON.stringify(hosts));
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}
