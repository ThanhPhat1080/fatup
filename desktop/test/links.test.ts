import { describe, expect, it } from 'vitest';
import { extractUrl, normalizeUrl, siteOf } from '@fatup/shared';

describe('siteOf', () => {
  it.each([
    ['https://m.facebook.com/x', 'facebook'],
    ['https://fb.watch/abc', 'facebook'],
    ['https://youtu.be/abc', 'youtube'],
    ['https://www.youtube.com/watch?v=1', 'youtube'],
    ['https://www.instagram.com/p/1', 'instagram'],
    ['https://threads.net/@a', 'threads'],
    ['https://x.com/jack/status/20', 'x'],
    ['https://mobile.twitter.com/jack', 'x'],
    ['https://t.co/abc123', 'x'],
    ['https://notx.com/a', 'internet'],
    ['https://x.com.evil.io/a', 'internet'],
    ['https://vt.tiktok.com/x', 'tiktok'],
    ['https://shp.ee/x', 'internet'],
    ['https://shopee.vn/a-i.1.2', 'internet'],
    ['https://example.com', 'internet'],
    ['https://notfacebook.com', 'internet'],
    ['https://facebook.com.evil.io', 'internet'],
    ['garbage', 'internet'],
  ])('%s is %s', (url, site) => {
    expect(siteOf(url)).toBe(site);
  });
});

describe('normalizeUrl', () => {
  it('lowercases the host and drops the fragment', () => {
    expect(normalizeUrl('HTTPS://Example.COM/a#x')).toBe('https://example.com/a');
  });
  it('trims whitespace', () => {
    expect(normalizeUrl('  https://a.com/p?q=1 \n')).toBe('https://a.com/p?q=1');
  });
  it('rejects other schemes, garbage and very long URLs', () => {
    expect(normalizeUrl('ftp://x.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl(`https://a.com/${'x'.repeat(3000)}`)).toBeNull();
  });
});

describe('extractUrl', () => {
  it('finds a link inside shared text and strips trailing punctuation', () => {
    expect(extractUrl('Xem cái này https://a.com/p?q=1. ok')).toBe('https://a.com/p?q=1');
    expect(extractUrl('(https://a.com/x)')).toBe('https://a.com/x');
  });
  it('takes the first of several links', () => {
    expect(extractUrl('a https://x.com b https://y.com')).toBe('https://x.com/');
  });
  it('returns null when there is no link', () => {
    expect(extractUrl('no link here')).toBeNull();
    expect(extractUrl('')).toBeNull();
  });
});
