import { describe, expect, it } from 'vitest';
import { fileVisual, formatSize, groupByDay, matchesQuery } from '../src/renderer/src/lib/format';
import { dictionaries, errorText, resolveLocale } from '../src/renderer/src/lib/i18n';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('groupByDay', () => {
  const now = at(2026, 11, 12, 9);
  const items = [
    { id: 'a', createdAt: at(2026, 11, 12, 8) },
    { id: 'b', createdAt: at(2026, 11, 12, 1) },
    { id: 'c', createdAt: at(2026, 11, 11, 23) },
    { id: 'd', createdAt: at(2026, 11, 3) },
  ];

  it('labels today, yesterday and older dates per locale', () => {
    const vi = groupByDay(items, now, dictionaries.vi, 'vi');
    expect(vi.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Hôm nay', ['a', 'b']],
      ['Hôm qua', ['c']],
      ['03/11/2026', ['d']],
    ]);
    const en = groupByDay(items, now, dictionaries.en, 'en');
    expect(en.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Nov 3, 2026']);
  });
});

describe('formatting', () => {
  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(25 * 1024 * 1024)).toBe('25 MB');
  });

  it('searches ignoring case and Vietnamese accents', () => {
    expect(matchesQuery('Ảnh Đà Lạt.jpg', 'anh da lat')).toBe(true);
    expect(matchesQuery('report.pdf', 'REP')).toBe(true);
    expect(matchesQuery('report.pdf', 'xls')).toBe(false);
    expect(matchesQuery('anything', '  ')).toBe(true);
  });

  it('picks file visuals', () => {
    expect(fileVisual('a.heic', 'image/heic')).toBe('image');
    expect(fileVisual('a.pdf', 'application/octet-stream')).toBe('pdf');
    expect(fileVisual('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('sheet');
    expect(fileVisual('a.bin', 'application/octet-stream')).toBe('other');
  });
});

describe('i18n', () => {
  it('has the same keys in every language', () => {
    expect(Object.keys(dictionaries.vi).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it('resolves the locale from prefs and the OS', () => {
    expect(resolveLocale('auto', 'vi-VN')).toBe('vi');
    expect(resolveLocale('auto', 'fr-FR')).toBe('en');
    expect(resolveLocale('vi', 'en-US')).toBe('vi');
  });

  it('maps error codes with a generic fallback', () => {
    expect(errorText(dictionaries.en, 'network')).toMatch(/reach the server/);
    expect(errorText(dictionaries.vi, 'weird')).toBe(dictionaries.vi.err_generic);
  });
});
