import { describe, expect, it } from 'vitest';
import { fileVisual, formatSize, groupByDay, matchesQuery, singleGroup, sortItems, splitExt } from '../src/renderer/src/lib/format';
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

describe('sortItems', () => {
  const f = (id: string, name: string, size: number, createdAt: number) => ({ id, name, size, createdAt });
  const items = [f('a', 'img10.jpg', 300, 1), f('b', 'Img2.jpg', 100, 3), f('c', 'báo cáo.pdf', 200, 2)];
  const names = (key: 'name' | 'size' | 'createdAt', dir: 'asc' | 'desc') => sortItems(items, { key, dir }).map((i) => i.id);

  it('sorts names naturally and ignoring case', () => {
    expect(names('name', 'asc')).toEqual(['c', 'b', 'a']); // báo, Img2, img10
    expect(names('name', 'desc')).toEqual(['a', 'b', 'c']);
  });
  it('sorts by size and upload time in both directions', () => {
    expect(names('size', 'asc')).toEqual(['b', 'c', 'a']);
    expect(names('size', 'desc')).toEqual(['a', 'c', 'b']);
    expect(names('createdAt', 'desc')).toEqual(['b', 'c', 'a']);
  });
  it('does not mutate the input and breaks ties by name', () => {
    const tied = [f('x', 'b', 5, 1), f('y', 'a', 5, 1)];
    expect(sortItems(tied, { key: 'size', dir: 'asc' }).map((i) => i.id)).toEqual(['y', 'x']);
    expect(tied.map((i) => i.id)).toEqual(['x', 'y']);
  });
});

describe('singleGroup', () => {
  it('returns one unlabeled bucket, or none when empty', () => {
    expect(singleGroup([1, 2])).toEqual([{ key: 'all', label: '', items: [1, 2] }]);
    expect(singleGroup([])).toEqual([]);
  });
});

describe('storage meter helpers', () => {
  it('turns orange at 70% and red at 90%', async () => {
    const { usageLevel } = await import('../src/renderer/src/lib/format');
    expect(usageLevel(0, 10)).toBe('ok');
    expect(usageLevel(6.99, 10)).toBe('ok');
    expect(usageLevel(7, 10)).toBe('warn');
    expect(usageLevel(8.99, 10)).toBe('warn');
    expect(usageLevel(9, 10)).toBe('crit');
    expect(usageLevel(12, 10)).toBe('crit');
    expect(usageLevel(1, 0)).toBe('ok');
  });
  it('formats decimal gigabytes with two decimals', async () => {
    const { formatGb } = await import('../src/renderer/src/lib/format');
    expect(formatGb(1_234_000_000, 'en')).toBe('1.23');
    expect(formatGb(0, 'en')).toBe('0.00');
    expect(formatGb(10_000_000_000, 'en')).toBe('10.00');
    expect(formatGb(1_234_000_000, 'vi')).toBe('1,23');
  });
});

describe('splitExt', () => {
  it('separates the last extension so a rename can keep it', () => {
    expect(splitExt('photo.jpg')).toEqual({ stem: 'photo', ext: '.jpg' });
    expect(splitExt('my.report.final.pdf')).toEqual({ stem: 'my.report.final', ext: '.pdf' });
    expect(splitExt('archive.tar.gz')).toEqual({ stem: 'archive.tar', ext: '.gz' });
  });

  it('treats names without a real extension as all stem', () => {
    expect(splitExt('README')).toEqual({ stem: 'README', ext: '' });
    expect(splitExt('.gitignore')).toEqual({ stem: '.gitignore', ext: '' });
    expect(splitExt('trailing.')).toEqual({ stem: 'trailing.', ext: '' });
  });
});
