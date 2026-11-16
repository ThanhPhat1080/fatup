import { describe, expect, it } from 'vitest';
import { formatShareList, isShareable, shareExpiryLabelKey, SHARE_EXPIRY_DAYS, type FileItem } from '@fatup/shared';

const item = (over: Partial<Pick<FileItem, 'kind' | 'deletedAt' | 'inVault'>> = {}) => ({ kind: 'image' as const, deletedAt: null, inVault: false, ...over });

describe('isShareable', () => {
  it('is true for photos and files outside the trash and the vault', () => {
    expect(isShareable(item())).toBe(true);
    expect(isShareable(item({ kind: 'file' }))).toBe(true);
  });
  it('is false for links and text', () => {
    expect(isShareable(item({ kind: 'link' }))).toBe(false);
    expect(isShareable(item({ kind: 'text' }))).toBe(false);
  });
  it('is false in the trash and in the vault', () => {
    expect(isShareable(item({ deletedAt: 1 }))).toBe(false);
    expect(isShareable(item({ inVault: true }))).toBe(false);
  });
});

describe('formatShareList', () => {
  it('writes one "name: link" line per file', () => {
    expect(
      formatShareList([
        { name: 'a.jpg', url: 'https://x/s/1' },
        { name: 'b.pdf', url: 'https://x/s/2' },
      ]),
    ).toBe('a.jpg: https://x/s/1\nb.pdf: https://x/s/2');
  });
  it('is empty for no rows', () => {
    expect(formatShareList([])).toBe('');
  });
});

describe('expiry options', () => {
  it('offers 1, 7 and 30 days', () => {
    expect([...SHARE_EXPIRY_DAYS]).toEqual([1, 7, 30]);
  });
  it('maps an expiry to a stable key, "never" for null', () => {
    expect(shareExpiryLabelKey(null)).toBe('never');
    expect(shareExpiryLabelKey(7)).toBe('7');
  });
});
