import { beforeEach, describe, expect, it } from 'vitest';
import { popSharedLink, stashSharedLink, takeSharedLink } from './share';

describe('takeSharedLink', () => {
  it('finds the link inside shared text, which is where Android Chrome puts it', () => {
    expect(takeSharedLink('?title=Cool%20page&text=Xem%20https%3A%2F%2Fa.com%2Fp%20nh%C3%A9')).toEqual({ url: 'https://a.com/p', title: 'Cool page' });
  });

  it('prefers the url parameter', () => {
    expect(takeSharedLink('?url=https%3A%2F%2Fb.com%2F&text=ignored%20https%3A%2F%2Fc.com')).toEqual({ url: 'https://b.com/' });
  });

  it('drops a title that is only the link again', () => {
    expect(takeSharedLink('?title=https%3A%2F%2Fa.com%2F&url=https%3A%2F%2Fa.com%2F')).toEqual({ url: 'https://a.com/' });
  });

  it('returns null when nothing shareable is there', () => {
    expect(takeSharedLink('')).toBeNull();
    expect(takeSharedLink('?foo=bar')).toBeNull();
    expect(takeSharedLink('?text=no%20link%20here')).toBeNull();
    expect(takeSharedLink('?url=javascript%3Aalert(1)')).toBeNull();
  });

  it('takes the first of two links', () => {
    expect(takeSharedLink('?text=a%20https%3A%2F%2Fx.com%20b%20https%3A%2F%2Fy.com')?.url).toBe('https://x.com/');
  });
});

describe('stash', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it('hands a stashed link back exactly once', () => {
    stashSharedLink({ url: 'https://a.com/', title: 'A' });
    expect(popSharedLink()).toEqual({ url: 'https://a.com/', title: 'A' });
    expect(popSharedLink()).toBeNull();
  });

  it('copes with storage that throws', () => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => stashSharedLink({ url: 'https://a.com/' })).not.toThrow();
    expect(popSharedLink()).toBeNull();
  });
});
