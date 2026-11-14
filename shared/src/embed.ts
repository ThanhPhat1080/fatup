/**
 * Turns a bookmarked link into the platform's own embeddable player or post, so it can be shown inside the app instead of a new tab.
 * Only the official embed endpoints are used; anything else (Facebook, whose embeds mostly refuse to load, plain websites, short links we
 * can't resolve) returns null and the app shows the page itself or its preview card instead.
 */

/** How the embed is laid out: a 16:9 player, a 9:16 player, or a post card that is narrow and tall. */
export type EmbedShape = 'video' | 'vertical' | 'post';
export type Embed = { src: string; shape: EmbedShape };

/** Every origin an embed may load from. The Content-Security-Policy `frame-src` lists exactly these. */
export const EMBED_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://www.tiktok.com',
  'https://www.instagram.com',
  'https://www.threads.com',
  'https://platform.twitter.com',
] as const;

const YT_ID = /^[\w-]{11}$/;

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** YouTube's `t` is "90", "90s" or "1m30s". */
function seconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

function youtube(url: URL): Embed | null {
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  let shape: EmbedShape = 'video';
  if (hostIs(url.hostname, 'youtu.be')) id = parts[0] ?? null;
  else if (parts[0] === 'watch') id = url.searchParams.get('v');
  else if (['shorts', 'live', 'embed'].includes(parts[0] ?? '')) {
    id = parts[1] ?? null;
    if (parts[0] === 'shorts') shape = 'vertical';
  }
  if (!id || !YT_ID.test(id)) return null;
  const start = seconds(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return { src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? `&start=${start}` : ''}`, shape };
}

function tiktok(url: URL): Embed | null {
  const m = /^\/@[^/]+\/video\/(\d+)/.exec(url.pathname);
  return m ? { src: `https://www.tiktok.com/player/v1/${m[1]}?autoplay=1`, shape: 'vertical' } : null;
}

function instagram(url: URL): Embed | null {
  const m = /^\/(p|reels?|tv)\/([\w-]+)/.exec(url.pathname);
  if (!m) return null;
  const kind = m[1] === 'reels' ? 'reel' : m[1];
  return { src: `https://www.instagram.com/${kind}/${m[2]}/embed/`, shape: 'post' };
}

function threads(url: URL): Embed | null {
  const m = /^\/(@[\w.]+)\/post\/([\w-]+)/.exec(url.pathname);
  return m ? { src: `https://www.threads.com/${m[1]}/post/${m[2]}/embed`, shape: 'post' } : null;
}

function x(url: URL): Embed | null {
  const m = /^\/[^/]+\/status(?:es)?\/(\d+)/.exec(url.pathname);
  return m ? { src: `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}&dnt=true&theme=dark`, shape: 'post' } : null;
}

export function embedOf(raw: string): Embed | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (hostIs(host, 'youtube.com') || hostIs(host, 'youtu.be')) return youtube(url);
  if (hostIs(host, 'tiktok.com')) return tiktok(url);
  if (hostIs(host, 'instagram.com')) return instagram(url);
  if (hostIs(host, 'threads.net') || hostIs(host, 'threads.com')) return threads(url);
  if (hostIs(host, 'x.com') || hostIs(host, 'twitter.com')) return x(url);
  return null;
}
