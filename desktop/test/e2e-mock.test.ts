import { describe, expect, it } from 'vitest';
import { groupByDay } from '../src/renderer/src/lib/format';
import { dictionaries } from '../src/renderer/src/lib/i18n';
// @ts-ignore -- plain JavaScript test helper, no declarations
import { startMockServer } from '../e2e/mock-server.mjs';

describe('the end-to-end mock server', () => {
  // The smoke test expects "Today" and "Yesterday" groups in the file list. They must exist whatever time of day CI happens to run
  // (a run just after midnight UTC once found no file dated today).
  it.each(Array.from({ length: 24 }, (_, h) => h))('has files dated today and yesterday at %i:05', async (hour) => {
    const realNow = new Date(2026, 10, 14, hour, 5).getTime();
    const { server, files } = await startMockServer(realNow);
    try {
      const sorted = [...files].sort((a: { createdAt: number }, b: { createdAt: number }) => b.createdAt - a.createdAt);
      const labels = groupByDay(sorted, realNow, dictionaries.vi, 'vi').map((g) => g.label);
      expect(labels).toContain('Hôm nay');
      expect(labels).toContain('Hôm qua');
    } finally {
      server.close();
    }
  });
});
