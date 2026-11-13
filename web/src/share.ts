import { extractUrl, normalizeUrl } from '@fatup/shared';

/** `url` is empty when something was shared but held no link, so the app can say so after unlocking. */
export type SharedLink = { url: string; title?: string };

const KEY = 'fatup.sharedLink';

/**
 * Reads what Android's share sheet sent to the PWA (`?title=&text=&url=`). Chrome usually puts the address inside `text`,
 * so `url` is only preferred when present. Returns null when no http(s) link can be found.
 */
export function takeSharedLink(search: string): SharedLink | null {
  const params = new URLSearchParams(search);
  const fromUrl = params.get('url');
  const url = (fromUrl ? normalizeUrl(fromUrl) : null) ?? extractUrl(params.get('text') ?? '');
  if (!url) return null;
  const title = (params.get('title') ?? '').trim();
  // Some apps repeat the address as the title, which says nothing.
  return title && !/^https?:\/\//i.test(title) ? { url, title } : { url };
}

/** The link has to survive the PIN screen (the token is only decrypted after it), so it waits in sessionStorage. */
export function stashSharedLink(link: SharedLink): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(link));
  } catch {
    // storage blocked: the share is lost, but nothing else breaks
  }
}

/** Returns the waiting link and forgets it, so it is saved exactly once. */
export function popSharedLink(): SharedLink | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as Partial<SharedLink>;
    return typeof parsed.url === 'string' ? { url: parsed.url, title: typeof parsed.title === 'string' ? parsed.title : undefined } : null;
  } catch {
    return null;
  }
}
