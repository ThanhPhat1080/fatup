import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FileItem, ThumbUploadResponse } from '@fatup/shared';
import { createApp } from '../src/app';
import { thumbKey } from '../src/presign';

const app = createApp({
  presigner: () => ({
    put: async (key: string) => `https://r2.test/put/${key}`,
    get: async (key: string) => `https://r2.test/get/${key}`,
  }),
});
const AUTH = { Authorization: 'Bearer test-token' };
const post = (path: string) => app.request(path, { method: 'POST', headers: AUTH }, env);

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

async function insert(over: { kind?: string; mime?: string; deletedAt?: number | null; inVault?: number; status?: string; hasThumb?: number; encrypted?: number } = {}) {
  await env.DB.prepare(
    `INSERT INTO files (id, name, mime, size, kind, has_thumb, status, created_at, deleted_at, in_vault, encrypted) VALUES (?, 'p.png', ?, 3, ?, ?, ?, 1, ?, ?, ?)`,
  )
    .bind(ID, over.mime ?? 'image/png', over.kind ?? 'image', over.hasThumb ?? 0, over.status ?? 'ready', over.deletedAt ?? null, over.inVault ?? 0, over.encrypted ?? 0)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM files').run();
  await env.BUCKET.delete(thumbKey(ID));
});

describe('POST /files/:id/thumb', () => {
  it('gives a URL to upload the thumbnail to', async () => {
    await insert();
    const res = await post(`/files/${ID}/thumb`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ThumbUploadResponse).thumbUploadUrl).toBe(`https://r2.test/put/thumbs/${ID}.jpg`);
  });

  it('needs the API token', async () => {
    await insert();
    expect((await app.request(`/files/${ID}/thumb`, { method: 'POST' }, env)).status).toBe(401);
  });

  it('refuses what is not a ready image outside the trash and the Vault', async () => {
    for (const over of [{ kind: 'file', mime: 'application/pdf' }, { deletedAt: 5 }, { inVault: 1 }, { encrypted: 1 }, { status: 'pending' }]) {
      await env.DB.prepare('DELETE FROM files').run();
      await insert(over);
      expect((await post(`/files/${ID}/thumb`)).status).toBe(404);
    }
    await env.DB.prepare('DELETE FROM files').run();
    expect((await post(`/files/${ID}/thumb`)).status).toBe(404);
  });
});

describe('POST /files/:id/thumb/complete', () => {
  it('says not_uploaded until the thumbnail object exists, then marks the file as having one', async () => {
    await insert();
    const early = await post(`/files/${ID}/thumb/complete`);
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe('not_uploaded');

    await env.BUCKET.put(thumbKey(ID), 'jpeg');
    const done = await post(`/files/${ID}/thumb/complete`);

    expect(done.status).toBe(200);
    expect((await done.json()) as FileItem).toMatchObject({ id: ID, hasThumb: true, thumbUrl: `https://r2.test/get/thumbs/${ID}.jpg` });
    expect(await env.DB.prepare('SELECT has_thumb FROM files WHERE id = ?').bind(ID).first()).toEqual({ has_thumb: 1 });
  });

  it('refuses the same things the upload URL does', async () => {
    await insert({ inVault: 1 });
    await env.BUCKET.put(thumbKey(ID), 'jpeg');
    expect((await post(`/files/${ID}/thumb/complete`)).status).toBe(404);
  });
});
