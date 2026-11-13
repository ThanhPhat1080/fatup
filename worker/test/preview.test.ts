import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FileItem } from '@fatup/shared';
import { createApp } from '../src/app';
import { fetchPreview } from '../src/preview';
import { thumbKey } from '../src/presign';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const html = (head: string, status = 200) => new Response(`<html><head>${head}</head><body>x</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const jpeg = (bytes = 'jpegbytes', type = 'image/jpeg') => new Response(bytes, { headers: { 'content-type': type } });

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
  const preview = async (id: string, force = false) => call(`/links/${id}/preview${force ? '?force=1' : ''}`, { method: 'POST' });
  return { calls, call, add, preview, fakeFetch };
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM files').run();
});

describe('POST /links/:id/preview', () => {
  it('fills in the title and stores the og:image as the thumbnail', async () => {
    const t = setup({
      'https://site.test/a': () => html(`<meta property="og:title" content="Hello &amp; welcome"><meta content="/pic.jpg" property="og:image"><title>ignored</title>`),
      'https://site.test/pic.jpg': () => jpeg(),
    });
    const link = await t.add('https://site.test/a');
    const res = await t.preview(link.id);
    expect(res.status).toBe(200);
    const item = (await res.json()) as FileItem;
    expect(item).toMatchObject({ name: 'Hello & welcome', previewed: true });
    expect(item.thumbUrl).toBe(`https://r2.test/get/thumbs/${link.id}.jpg`);
    expect(await (await env.BUCKET.get(thumbKey(link.id)))?.text()).toBe('jpegbytes');
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
      'https://img.test/y.jpg': () => jpeg('yy'),
      'https://img.test/t.jpg': () => jpeg('tt'),
    });
    const a = (await (await t.preview((await t.add('https://youtu.be/abc')).id)).json()) as FileItem;
    expect(a).toMatchObject({ name: 'A video' });
    expect(a.thumbUrl).not.toBeNull();
    const b = (await (await t.preview((await t.add('https://www.tiktok.com/@a/video/1')).id)).json()) as FileItem;
    expect(b.name).toBe('A tiktok');
  });

  it('still succeeds when the page fails, is not HTML, or its image is unusable', async () => {
    const t = setup({
      'https://down.test/': () => {
        throw new Error('boom');
      },
      'https://json.test/': () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      'https://img.test/': () => html('<meta property="og:image" content="https://img.test/page.html">'),
      'https://img.test/page.html': () => jpeg('x', 'text/html'),
    });
    for (const u of ['https://down.test/', 'https://json.test/', 'https://img.test/']) {
      const link = await t.add(u);
      const res = await t.preview(link.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ name: new URL(u).hostname, previewed: true, thumbUrl: null });
    }
  });

  it('only fetches once unless forced, and again after the URL is edited', async () => {
    const t = setup({ 'https://site.test/a': () => html('<title>T1</title>'), 'https://site.test/b': () => html('<title>T2</title>') });
    const link = await t.add('https://site.test/a');
    await t.preview(link.id);
    await t.preview(link.id);
    expect(t.calls).toEqual(['https://site.test/a']);
    await t.preview(link.id, true);
    expect(t.calls).toHaveLength(2);
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
    expect(await fetchPreview(url, t.fakeFetch)).toEqual({ title: null, image: null });
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
    expect(await fetchPreview('https://slow.test/', hang, 30)).toEqual({ title: null, image: null });
  });

  it('ignores images over 1.5 MB', async () => {
    const t = setup({
      'https://site.test/': () => html('<meta property="og:image" content="https://site.test/big.jpg">'),
      'https://site.test/big.jpg': () => jpeg('x'.repeat(1_600_000)),
    });
    expect((await fetchPreview('https://site.test/', t.fakeFetch)).image).toBeNull();
  });
});
