import { describe, expect, it } from 'vitest';
import { embedOf, EMBED_ORIGINS } from '@fatup/shared';

describe('embedOf', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0', 'video'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=42', 'video'],
    ['https://youtu.be/dQw4w9WgXcQ?t=90', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=90', 'video'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0', 'vertical'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0', 'video'],
    ['https://www.tiktok.com/@cook/video/7301234567890123456?lang=vi', 'https://www.tiktok.com/player/v1/7301234567890123456?autoplay=1', 'vertical'],
    ['https://www.instagram.com/p/C1a2B3c4D5e/', 'https://www.instagram.com/p/C1a2B3c4D5e/embed/', 'post'],
    ['https://instagram.com/reel/C1a2B3c4D5e?igsh=x', 'https://www.instagram.com/reel/C1a2B3c4D5e/embed/', 'post'],
    ['https://www.threads.net/@zuck/post/C8abc_D-1', 'https://www.threads.com/@zuck/post/C8abc_D-1/embed', 'post'],
    ['https://x.com/jack/status/20', 'https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true&theme=dark', 'post'],
    ['https://mobile.twitter.com/jack/status/20?s=46', 'https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true&theme=dark', 'post'],
  ])('%s', (url, src, shape) => {
    expect(embedOf(url)).toEqual({ src, shape });
  });

  it.each([
    'https://www.youtube.com/',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/watch?v=short',
    'https://vt.tiktok.com/ZSabc/',
    'https://www.tiktok.com/@cook',
    'https://www.instagram.com/someone/',
    'https://x.com/jack',
    'https://www.facebook.com/somepage',
    'https://www.facebook.com/somepage/videos/123456/',
    'https://www.facebook.com/somepage/posts/pfbid0abc',
    'https://shopee.vn/a-i.1.2',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'garbage',
  ])('%s has no embed', (url) => {
    expect(embedOf(url)).toBeNull();
  });

  it('only ever points at an allowed origin', () => {
    const urls = ['https://youtu.be/dQw4w9WgXcQ', 'https://www.tiktok.com/@a/video/1', 'https://instagram.com/p/x', 'https://threads.com/@a/post/b', 'https://x.com/a/status/1'];
    for (const u of urls) {
      const e = embedOf(u);
      expect(e).not.toBeNull();
      expect(EMBED_ORIGINS).toContain(new URL(e!.src).origin);
    }
  });
});

describe('Content-Security-Policy frame-src', () => {
  // Both allow blob: (PDFs read into memory); the web app also frames any https page the server has checked.
  it.each([
    ['../web/index.html', ['blob:', 'https:']],
    ['src/renderer/index.html', ['blob:']],
  ])('%s allows exactly the embed origins', async (file, extra) => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const html = readFileSync(join(import.meta.dirname, '..', file), 'utf8');
    const frameSrc = /frame-src ([^;]+);/.exec(html)?.[1].trim().split(/\s+/);
    expect(frameSrc?.sort()).toEqual([...EMBED_ORIGINS, ...extra].sort());
  });
});
