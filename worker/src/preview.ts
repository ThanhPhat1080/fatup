import { isPublicUrl, siteOf, type FrameCheck } from '@fatup/shared';

export { isPublicUrl };

/** A link's title and the address of its picture. The picture itself is never fetched here; see PreviewResponse. */
export type Preview = { title: string | null; imageUrl: string | null; iconUrl?: string | null };

const EMPTY: Preview = { title: null, imageUrl: null };
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 512 * 1024;
const UA = 'Mozilla/5.0 (compatible; FatUp-LinkPreview/1.0)';
/** Facebook only puts its og: tags in pages served to its own link-preview crawler; everyone else gets a login wall. */
const FACEBOOK_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const userAgentFor = (url: string) => (siteOf(url) === 'facebook' ? FACEBOOK_UA : UA);

/** GET with manual redirects so every hop is checked against isPublicUrl. Null when refused, failed or too many hops; else the response and the address it came from. */
async function get(url: string, fetchImpl: typeof fetch, signal: AbortSignal, accept: string): Promise<{ res: Response; url: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicUrl(current)) return null;
    const res = await fetchImpl(current, { redirect: 'manual', signal, headers: { 'User-Agent': userAgentFor(current), Accept: accept } });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location) return null;
      try {
        current = new URL(location, current).href;
      } catch {
        return null;
      }
      continue;
    }
    return res.ok ? { res, url: current } : null;
  }
  return null;
}

/** Reads at most `limit` bytes; returns null when the body is longer and `strict` is set. */
async function readLimited(res: Response, limit: number, strict: boolean): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer()).slice(0, limit);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      if (strict) return null;
      chunks.push(value.slice(0, value.length - (total - limit)));
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

const clean = (text: string | null | undefined) => {
  const t = decodeEntities(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 255);
  return t || null;
};

/** Reads og:/twitter: meta tags and <title> out of an HTML head. */
/** The page's own icon: apple-touch-icon (large, square), else rel="icon", else "shortcut icon". Href as written; null when none. */
function iconHref(html: string): string | null {
  const found = new Map<string, string>();
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of tag[0].matchAll(/([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) attrs.set(a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '');
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    const href = decodeEntities(attrs.get('href') ?? '').trim();
    if (!href) continue;
    for (const kind of ['apple-touch-icon', 'icon']) if (rel.includes(kind) && !found.has(kind)) found.set(kind, href);
  }
  return found.get('apple-touch-icon') ?? found.get('icon') ?? null;
}

export function parseHtml(html: string): { title: string | null; image: string | null; icon?: string | null } {
  const meta = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of tag[0].matchAll(/([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) attrs.set(a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '');
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    const content = attrs.get('content');
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return {
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? titleTag),
    // Attribute values are HTML, so "&amp;" stands for "&": an address with its entities left in (as Instagram's signed ones have) is refused by the CDN.
    image: decodeEntities(meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image') ?? meta.get('twitter:image:src') ?? '').trim() || null,
    icon: iconHref(html),
  };
}

/** YouTube and TikTok publish an oEmbed endpoint that returns a title and thumbnail without a login. */
async function oembed(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<{ title: string | null; image: string | null } | null> {
  const site = siteOf(url);
  const endpoint =
    site === 'youtube' ? `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json` : site === 'tiktok' ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}` : null;
  if (!endpoint) return null;
  const res = (await get(endpoint, fetchImpl, signal, 'application/json'))?.res;
  if (!res) return null;
  const data = (await res.json().catch(() => null)) as { title?: unknown; thumbnail_url?: unknown } | null;
  if (!data) return null;
  return { title: typeof data.title === 'string' ? clean(data.title) : null, image: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null };
}

/** Best-effort title and picture address for a link. Never throws: a page that is slow, blocked or odd simply yields nothing. */
export async function fetchPreview(url: string, fetchImpl: typeof fetch = (i, init) => fetch(i, init), timeoutMs = 6000): Promise<Preview> {
  if (!isPublicUrl(url)) return EMPTY;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    let base = url;
    let found = await oembed(url, fetchImpl, signal).catch(() => null);
    if (!found) {
      const got = await get(url, fetchImpl, signal, 'text/html,application/xhtml+xml');
      const res = got?.res;
      const type = (res?.headers.get('content-type') ?? '').toLowerCase();
      if (!res || !(type.includes('html') || type.includes('xml'))) {
        await res?.body?.cancel().catch(() => undefined);
        return EMPTY;
      }
      base = got?.url ?? url;
      const bytes = await readLimited(res, MAX_HTML_BYTES, false);
      found = parseHtml(new TextDecoder().decode(bytes ?? new Uint8Array()));
    }
    const iconUrl = absolutePublic((found as { icon?: string | null }).icon ?? null, base);
    return { title: found.title, imageUrl: absolutePublic(found.image, base), ...(iconUrl ? { iconUrl } : {}) };
  } catch {
    return EMPTY;
  }
}

/** Resolves a picture address against its page; null unless it ends up a public http(s) address. */
function absolutePublic(image: string | null, base: string): string | null {
  if (!image) return null;
  try {
    const href = new URL(image, base).href;
    return isPublicUrl(href) ? href : null;
  } catch {
    return null;
  }
}


/** True unless X-Frame-Options or a CSP frame-ancestors directive keeps the page out of other sites' frames. */
export function allowsFraming(headers: Headers): boolean {
  const xfo = headers.get('x-frame-options');
  if (xfo && /deny|sameorigin/i.test(xfo)) return false;
  const csp = headers.get('content-security-policy');
  if (!csp) return true;
  for (const directive of csp.split(/[;,]/)) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name?.toLowerCase() === 'frame-ancestors') return sources.some((s) => s === '*' || s.toLowerCase() === 'https:');
  }
  return true;
}

/** Asks the page itself (headers only) whether the web app can frame it. An https app can't frame plain http, so that counts as no. */
export async function checkFrame(url: string, fetchImpl: typeof fetch = (i, init) => fetch(i, init), timeoutMs = 6000): Promise<FrameCheck> {
  if (!isPublicUrl(url)) return { framable: false, url };
  try {
    const got = await get(url, fetchImpl, AbortSignal.timeout(timeoutMs), 'text/html,application/xhtml+xml');
    if (!got) return { framable: false, url };
    await got.res.body?.cancel().catch(() => undefined);
    return { framable: got.url.startsWith('https:') && allowsFraming(got.res.headers), url: got.url };
  } catch {
    return { framable: false, url };
  }
}
