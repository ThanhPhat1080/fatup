import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FileItem, PreviewResponse } from '@fatup/shared';
import { createApp } from '../src/app';
import { fetchPreview } from '../src/preview';
import { thumbKey } from '../src/presign';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const html = (head: string, status = 200) => new Response(`<html><head>${head}</head><body>x</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

function setup(routes: Record<string, Handler>) {
  const calls: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const h = routes[url];
    if (!h) return new Response('nope', { status: 404 });
    return h(url, init);
  }) as typeof fetch;
  const app = createApp({
    presigner: () => ({ put: async (k: string) => `https://r2.test/put/${k}`, get: async (k: string) => `https://r2.test/get/${k}` }),
    fetch: fakeFetch,
  });
  const call = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', ...(init.headers ?? {}) } }, env);
  const add = async (url: string, title?: string) => (await (await call('/links', { method: 'POST', body: JSON.stringify({ url, title }) })).json()) as FileItem;
  const preview = async (id: string) => call(`/links/${id}/preview`, { method: 'POST' });
  return { calls, call, add, preview, fakeFetch };
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM files').run();
});

describe('POST /links/:id/preview', () => {
  it('fills in the title and hands back the og:image address without fetching or storing the picture', async () => {
    const t = setup({
      'https://site.test/a': () => html(`<meta property="og:title" content="Hello &amp; welcome"><meta content="/pic.jpg" property="og:image"><title>ignored</title>`),
    });
    const link = await t.add('https://site.test/a');
    const res = await t.preview(link.id);
    expect(res.status).toBe(200);
    const item = (await res.json()) as PreviewResponse;
    expect(item).toMatchObject({ name: 'Hello & welcome', previewed: true, previewImage: 'https://site.test/pic.jpg', thumbUrl: null });
    expect(t.calls).toEqual(['https://site.test/a']); // the picture is the client's job
    expect(await env.BUCKET.get(thumbKey(link.id))).toBeNull();
  });

  it('decodes HTML entities in the picture address (Instagram signs its URLs, so a stray "&amp;" gets a 403 "Bad URL hash")', async () => {
    const t = setup({
      'https://site.test/a': () => html(`<meta property="og:image" content="https://cdn.test/p.jpg?stp=c259&amp;_nc_cat=111&#38;ccb=7-5&#x26;oh=00_AfA">`),
    });
    const link = await t.add('https://site.test/a');
    const item = (await (await t.preview(link.id)).json()) as PreviewResponse;
    expect(item.previewImage).toBe('https://cdn.test/p.jpg?stp=c259&_nc_cat=111&ccb=7-5&oh=00_AfA');
  });

  it('falls back to <title> and twitter tags', async () => {
    const t = setup({ 'https://site.test/a': () => html('<title> Plain\n title </title>') });
    const item = (await (await t.preview((await t.add('https://site.test/a')).id)).json()) as FileItem;
    expect(item.name).toBe('Plain title');
  });

  it('keeps a title the user or share sheet chose', async () => {
    const t = setup({ 'https://site.test/a': () => html('<meta property="og:title" content="Page title">') });
    const link = await t.add('https://site.test/a', 'Mine');
    const item = (await (await t.preview(link.id)).json()) as FileItem;
    expect(item).toMatchObject({ name: 'Mine', previewed: true });
  });

  it('uses oEmbed for YouTube and TikTok', async () => {
    const yt = 'https://www.youtube.com/oembed?url=' + encodeURIComponent('https://youtu.be/abc') + '&format=json';
    const tt = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent('https://www.tiktok.com/@a/video/1');
    const t = setup({
      [yt]: () => Response.json({ title: 'A video', thumbnail_url: 'https://img.test/y.jpg' }),
      [tt]: () => Response.json({ title: 'A tiktok', thumbnail_url: 'https://img.test/t.jpg' }),
    });
    const a = (await (await t.preview((await t.add('https://youtu.be/abc')).id)).json()) as PreviewResponse;
    expect(a).toMatchObject({ name: 'A video', previewImage: 'https://img.test/y.jpg' });
    const b = (await (await t.preview((await t.add('https://www.tiktok.com/@a/video/1')).id)).json()) as PreviewResponse;
    expect(b).toMatchObject({ name: 'A tiktok', previewImage: 'https://img.test/t.jpg' });
  });

  it('still succeeds when the page fails, is not HTML, or names an image it must not fetch', async () => {
    const t = setup({
      'https://down.test/': () => {
        throw new Error('boom');
      },
      'https://json.test/': () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      'https://img.test/': () => html('<meta property="og:image" content="http://127.0.0.1/secret.png">'),
      'https://data.test/': () => html('<meta property="og:image" content="data:image/png;base64,AAAA">'),
    });
    for (const u of ['https://down.test/', 'https://json.test/', 'https://img.test/', 'https://data.test/']) {
      const link = await t.add(u);
      const res = await t.preview(link.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ name: new URL(u).hostname, previewed: true, thumbUrl: null, previewImage: null });
    }
  });

  it('reads the page every time it is asked (the client decides when it needs a picture), and again after the URL is edited', async () => {
    const t = setup({ 'https://site.test/a': () => html('<title>T1</title>'), 'https://site.test/b': () => html('<title>T2</title>') });
    const link = await t.add('https://site.test/a');
    await t.preview(link.id);
    await t.preview(link.id);
    expect(t.calls).toEqual(['https://site.test/a', 'https://site.test/a']);
    await t.call(`/files/${link.id}`, { method: 'PATCH', body: JSON.stringify({ url: 'https://site.test/b' }) });
    const item = (await (await t.preview(link.id)).json()) as FileItem;
    expect(item.name).toBe('T2');
  });

  it('404s for files and unknown ids', async () => {
    const t = setup({});
    expect((await t.preview('01ARZ3NDEKTSV4RRFFQ69G5FAV')).status).toBe(404);
  });
});

describe('fetchPreview', () => {
  it.each(['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://[::1]/', 'http://printer.local/', 'ftp://a.com/'])('refuses %s without calling fetch', async (url) => {
    const t = setup({});
    expect(await fetchPreview(url, t.fakeFetch)).toEqual({ title: null, imageUrl: null });
    expect(t.calls).toEqual([]);
  });

  it('follows at most 3 redirects and re-checks each hop', async () => {
    const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
    const t = setup({
      'https://a.test/1': redirect('https://a.test/2'),
      'https://a.test/2': redirect('https://a.test/3'),
      'https://a.test/3': redirect('https://a.test/4'),
      'https://a.test/4': () => html('<title>done</title>'),
      'https://b.test/1': redirect('http://127.0.0.1/secret'),
    });
    expect((await fetchPreview('https://a.test/1', t.fakeFetch)).title).toBe('done');
    const t2 = setup({
      'https://a.test/1': redirect('https://a.test/2'),
      'https://a.test/2': redirect('https://a.test/3'),
      'https://a.test/3': redirect('https://a.test/4'),
      'https://a.test/4': redirect('https://a.test/5'),
      'https://a.test/5': () => html('<title>too far</title>'),
    });
    expect((await fetchPreview('https://a.test/1', t2.fakeFetch)).title).toBeNull();
    expect((await fetchPreview('https://b.test/1', t.fakeFetch)).title).toBeNull();
    expect(t.calls).not.toContain('http://127.0.0.1/secret');
  });

  it('gives up when the server hangs', async () => {
    const hang: typeof fetch = (_in, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    expect(await fetchPreview('https://slow.test/', hang, 30)).toEqual({ title: null, imageUrl: null });
  });
});

describe('GET /links/:id/frame', () => {
  const page = (headers: Record<string, string> = {}) => () => new Response('<html></html>', { headers: { 'content-type': 'text/html', ...headers } });

  it.each([
    [{}, true],
    [{ 'x-frame-options': 'DENY' }, false],
    [{ 'x-frame-options': 'sameorigin' }, false],
    [{ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }, false],
    [{ 'content-security-policy': "frame-ancestors 'none'" }, false],
    [{ 'content-security-policy': 'frame-ancestors *' }, true],
    [{ 'content-security-policy': "script-src 'self'" }, true],
  ])('%o → framable %s', async (headers, framable) => {
    const t = setup({ 'https://site.test/a': page(headers) });
    const link = await t.add('https://site.test/a');
    const res = await t.call(`/links/${link.id}/frame`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ framable, url: 'https://site.test/a' });
  });

  it('follows redirects and frames the final address', async () => {
    const t = setup({
      'https://short.test/x': () => new Response(null, { status: 301, headers: { location: 'https://site.test/long' } }),
      'https://site.test/long': page(),
    });
    const link = await t.add('https://short.test/x');
    expect(await (await t.call(`/links/${link.id}/frame`)).json()).toEqual({ framable: true, url: 'https://site.test/long' });
  });

  it('says no for plain http and for pages that fail', async () => {
    const t = setup({ 'http://site.test/a': page() });
    const plain = await t.add('http://site.test/a');
    expect(((await (await t.call(`/links/${plain.id}/frame`)).json()) as { framable: boolean }).framable).toBe(false);
    const gone = await t.add('https://site.test/missing');
    expect(((await (await t.call(`/links/${gone.id}/frame`)).json()) as { framable: boolean }).framable).toBe(false);
  });

  it('is 404 for an unknown link', async () => {
    const t = setup({});
    expect((await t.call('/links/nope/frame')).status).toBe(404);
  });
});

describe('site icons', () => {
  it('prefers apple-touch-icon, resolves it against the page and keeps it on the link', async () => {
    const t = setup({
      'https://site.test/a': () => html(`<title>A</title><link rel="icon" href="/fav.png"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">`),
    });
    const link = await t.add('https://site.test/a');
    const res = (await (await t.preview(link.id)).json()) as PreviewResponse;
    expect(res.iconUrl).toBe('https://site.test/touch.png');
    const listed = (await (await t.call('/files?kind=link')).json()) as { items: FileItem[] };
    expect(listed.items[0].iconUrl).toBe('https://site.test/touch.png');
  });

  it('uses rel="shortcut icon" and leaves iconUrl null when the page has none', async () => {
    const t = setup({
      'https://site.test/a': () => html(`<link rel="shortcut icon" href="https://cdn.site.test/i.ico">`),
      'https://site.test/b': () => html(`<title>B</title>`),
    });
    expect(await fetchPreview('https://site.test/a', t.fakeFetch)).toMatchObject({ iconUrl: 'https://cdn.site.test/i.ico' });
    const b = await t.add('https://site.test/b');
    expect(((await (await t.preview(b.id)).json()) as PreviewResponse).iconUrl).toBeNull();
  });

  it('asks Facebook as its own link-preview crawler, so the og: tags come back', async () => {
    let agent = '';
    const t = setup({
      'https://www.facebook.com/page/posts/1': (_u, init) => {
        agent = new Headers(init?.headers).get('user-agent') ?? '';
        return html(`<meta property="og:title" content="A post">`);
      },
    });
    expect((await fetchPreview('https://www.facebook.com/page/posts/1', t.fakeFetch)).title).toBe('A post');
    expect(agent).toMatch(/^facebookexternalhit\//);
  });
});
