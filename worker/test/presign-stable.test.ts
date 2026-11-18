import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createPresigner } from '../src/presign';

const AUTH = { Authorization: 'Bearer test-token' };

describe('a stable read URL', () => {
  it('is signed from the start of the hour and lives two hours, so it stays the same while a list is refreshed again and again', async () => {
    const presigner = createPresigner({ ...env, R2_BUCKET_NAME: 'bkt' } as typeof env);

    const a = new URL(await presigner.get('files/X', { contentType: 'image/png', stable: true }));
    const b = new URL(await presigner.get('files/X', { contentType: 'image/png', stable: true }));

    expect(a.searchParams.get('X-Amz-Date')).toMatch(/^\d{8}T\d\d0000Z$/);
    expect(a.searchParams.get('X-Amz-Expires')).toBe('7200');
    // Two calls a moment apart sign identically (unless the hour turned between them: then only the date differs).
    if (a.searchParams.get('X-Amz-Date') === b.searchParams.get('X-Amz-Date')) expect(b.toString()).toBe(a.toString());
  });

  it('is only for the original of an image that has no thumbnail; thumbnails keep their one-hour URLs', async () => {
    const asked: { key: string; stable?: boolean }[] = [];
    const app = createApp({
      presigner: () => ({
        put: async (key: string) => `https://r2.test/put/${key}`,
        get: async (key: string, opts?: { stable?: boolean }) => {
          asked.push({ key, stable: opts?.stable });
          return `https://r2.test/get/${key}`;
        },
      }),
    });
    await env.DB.prepare('DELETE FROM files').run();
    await env.DB.prepare(`INSERT INTO files (id, name, mime, size, kind, has_thumb, status, created_at) VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'a.png', 'image/png', 1, 'image', 0, 'ready', 2)`).run();
    await env.DB.prepare(`INSERT INTO files (id, name, mime, size, kind, has_thumb, status, created_at) VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAW', 'b.png', 'image/png', 1, 'image', 1, 'ready', 1)`).run();

    await app.request('/files', { headers: AUTH }, env);

    expect(asked).toContainEqual({ key: 'files/01ARZ3NDEKTSV4RRFFQ69G5FAV', stable: true });
    expect(asked).toContainEqual({ key: 'thumbs/01ARZ3NDEKTSV4RRFFQ69G5FAW.jpg', stable: undefined });
  });
});
