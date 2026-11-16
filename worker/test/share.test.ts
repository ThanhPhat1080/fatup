import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateUploadResponse, FileItem, ListFilesResponse, ShareInfo } from '@fatup/shared';
import { createApp } from '../src/app';
import { cleanup, purge } from '../src/cleanup';
import { fileKey } from '../src/presign';

const fakePresigner = () => ({
  put: async (key: string) => `https://r2.test/put/${key}`,
  get: async (key: string) => `https://r2.test/get/${key}`,
});

const app = createApp({ presigner: fakePresigner });
const AUTH = { Authorization: 'Bearer test-token' };
const DAY = 24 * 60 * 60 * 1000;

/** An owner call: carries the API token. */
function call(path: string, init: RequestInit = {}) {
  return app.request(path, { ...init, headers: { ...AUTH, ...(init.headers ?? {}) } }, env);
}
/** A recipient call: no token at all. */
function pub(path: string, init: RequestInit = {}) {
  return app.request(path, init, env);
}
const json = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const postJson = (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

/** Full create → write to R2 → complete flow. */
async function upload(name: string, mime: string, content = 'hello'): Promise<FileItem> {
  const res = await postJson('/uploads', { name, mime, size: new TextEncoder().encode(content).length, hasThumb: false, device: 'Pixel' });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as CreateUploadResponse;
  await env.BUCKET.put(fileKey(id), content);
  const done = await call(`/uploads/${id}/complete`, { method: 'POST' });
  expect(done.status).toBe(200);
  return (await done.json()) as FileItem;
}

async function share(id: string, days: number | null = null): Promise<ShareInfo> {
  const res = await call(`/files/${id}/share`, json({ expiresInDays: days }));
  expect([200, 201]).toContain(res.status);
  return (await res.json()) as ShareInfo;
}

async function shareRows(id: string) {
  const { results } = await env.DB.prepare('SELECT * FROM shares WHERE file_id = ?').bind(id).all();
  return results;
}

/** The only thing that may differ between a dead link's reasons is nothing: status, headers and body must be equal. */
async function snapshot(res: Response) {
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM shares').run();
  await env.DB.prepare('DELETE FROM files').run();
});

describe('owner API', () => {
  it('creates a link with a 32-character url-safe token', async () => {
    const f = await upload('a.jpg', 'image/jpeg');
    const res = await call(`/files/${f.id}/share`, json({ expiresInDays: null }));
    expect(res.status).toBe(201);
    const info = (await res.json()) as ShareInfo;
    expect(info.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(info.url).toBe(`http://localhost/s/${info.token}`);
    expect(info.expiresAt).toBeNull();
    expect(info.downloads).toBe(0);
    expect(info.lastAccessAt).toBeNull();
  });

  it('changing the expiry keeps the token and counts from now', async () => {
    const f = await upload('a.jpg', 'image/jpeg');
    const first = await share(f.id, null);
    const before = Date.now();
    const res = await call(`/files/${f.id}/share`, json({ expiresInDays: 7 }));
    expect(res.status).toBe(200);
    const next = (await res.json()) as ShareInfo;
    expect(next.token).toBe(first.token);
    expect(next.expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY);
    expect(next.expiresAt).toBeLessThanOrEqual(Date.now() + 7 * DAY);
    const cleared = await share(f.id, null);
    expect(cleared.token).toBe(first.token);
    expect(cleared.expiresAt).toBeNull();
  });

  it('GET returns the info, or 404 not_shared', async () => {
    const f = await upload('a.jpg', 'image/jpeg');
    const none = await call(`/files/${f.id}/share`);
    expect(none.status).toBe(404);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe('not_shared');
    const info = await share(f.id, 7);
    const got = await call(`/files/${f.id}/share`);
    expect(got.status).toBe(200);
    expect(((await got.json()) as ShareInfo).token).toBe(info.token);
  });

  it('DELETE stops sharing and is idempotent', async () => {
    const f = await upload('a.jpg', 'image/jpeg');
    await share(f.id);
    expect((await call(`/files/${f.id}/share`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/files/${f.id}/share`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/files/${f.id}/share`)).status).toBe(404);
  });

  it.each([[2], ['7'], [0], [-1], [undefined]])('rejects the expiry %s with bad_expiry', async (bad) => {
    const f = await upload('a.jpg', 'image/jpeg');
    const res = await call(`/files/${f.id}/share`, json({ expiresInDays: bad }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_expiry');
  });

  it('refuses links and text with not_shareable', async () => {
    const link = (await (await postJson('/links', { url: 'https://example.com/a' })).json()) as FileItem;
    const res = await call(`/files/${link.id}/share`, json({ expiresInDays: null }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_shareable');

    const text = await upload('n.txt', 'text/plain');
    await env.DB.prepare(`UPDATE files SET kind = 'text' WHERE id = ?`).bind(text.id).run();
    expect((await call(`/files/${text.id}/share`, json({ expiresInDays: null }))).status).toBe(400);
  });

  it('answers 404 for a trashed file, a vaulted file, an unfinished upload and an unknown id', async () => {
    const trashed = await upload('t.jpg', 'image/jpeg');
    await call(`/files/${trashed.id}`, { method: 'DELETE' });
    const vaulted = await upload('v.jpg', 'image/jpeg');
    await call(`/files/${vaulted.id}/vault`, json({ inVault: true }));
    const pending = (await (await postJson('/uploads', { name: 'p.jpg', mime: 'image/jpeg', size: 3, hasThumb: false })).json()) as CreateUploadResponse;
    for (const id of [trashed.id, vaulted.id, pending.id, '01ARZ3NDEKTSV4RRFFQ69G5FAV']) {
      expect((await call(`/files/${id}/share`, json({ expiresInDays: null }))).status).toBe(404);
    }
  });

  it('sharing again after the link expired gives a new token', async () => {
    const f = await upload('a.jpg', 'image/jpeg');
    const old = await share(f.id, 1);
    await env.DB.prepare('UPDATE shares SET expires_at = ? WHERE file_id = ?').bind(Date.now() - 1000, f.id).run();
    expect((await call(`/files/${f.id}/share`)).status).toBe(404);
    const fresh = await share(f.id, 1);
    expect(fresh.token).not.toBe(old.token);
  });

  it('reports `shared` on file items only while the link is valid', async () => {
    const a = await upload('a.jpg', 'image/jpeg');
    const b = await upload('b.jpg', 'image/jpeg');
    await share(a.id);
    const list = async () => ((await (await call('/files')).json()) as ListFilesResponse).items;
    let items = await list();
    expect(items.find((i) => i.id === a.id)?.shared).toBe(true);
    expect(items.find((i) => i.id === b.id)?.shared).toBe(false);
    await env.DB.prepare('UPDATE shares SET expires_at = ? WHERE file_id = ?').bind(Date.now() - 1000, a.id).run();
    items = await list();
    expect(items.find((i) => i.id === a.id)?.shared).toBe(false);
  });

  it('needs the API token', async () => {
    const f = await upload('a.jpg', 'image/jpeg');
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect((await pub(`/files/${f.id}/share`, { method })).status).toBe(401);
    }
  });
});

describe('a link dies the moment the file is hidden or removed', () => {
  const actions: [string, (id: string) => Promise<unknown>][] = [
    ['it goes to the trash', (id) => call(`/files/${id}`, { method: 'DELETE' })],
    ['it goes to the vault', (id) => call(`/files/${id}/vault`, json({ inVault: true }))],
    ['sharing is stopped', (id) => call(`/files/${id}/share`, { method: 'DELETE' })],
    ['it expires', (id) => env.DB.prepare('UPDATE shares SET expires_at = ? WHERE file_id = ?').bind(Date.now() - 1000, id).run()],
    [
      'it is deleted for good',
      async (id) => {
        await call(`/files/${id}`, { method: 'DELETE' });
        await call(`/files/${id}/permanent`, { method: 'DELETE' });
      },
    ],
    [
      'the cron purges it from the trash',
      async (id) => {
        await call(`/files/${id}`, { method: 'DELETE' });
        await env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').bind(Date.now() - 31 * DAY, id).run();
        await cleanup(env);
      },
    ],
  ];

  it.each(actions)('when %s', async (_name, act) => {
    const f = await upload('a.jpg', 'image/jpeg', 'bytes');
    const { token } = await share(f.id);
    expect((await pub(`/s/${token}`)).status).toBe(200);
    expect((await pub(`/s/${token}/file`)).status).toBe(200);

    await act(f.id);

    expect((await pub(`/s/${token}`)).status).toBe(404);
    expect((await pub(`/s/${token}/file`)).status).toBe(404);
    expect((await pub(`/s/${token}/file?inline=1`)).status).toBe(404);
    expect((await call(`/files/${f.id}/share`)).status).toBe(404);
  });

  it('does not come back when the file is restored from the trash', async () => {
    const f = await upload('a.jpg', 'image/jpeg');
    const old = await share(f.id);
    await call(`/files/${f.id}`, { method: 'DELETE' });
    expect((await call(`/files/${f.id}/restore`, { method: 'POST' })).status).toBe(200);
    expect((await pub(`/s/${old.token}`)).status).toBe(404);
    expect((await call(`/files/${f.id}/share`)).status).toBe(404);
    expect(((await (await call('/files')).json()) as ListFilesResponse).items.find((i) => i.id === f.id)?.shared).toBe(false);

    const fresh = await share(f.id);
    expect(fresh.token).not.toBe(old.token);
    expect((await pub(`/s/${old.token}`)).status).toBe(404);
    expect((await pub(`/s/${fresh.token}`)).status).toBe(200);
  });

  it('does not come back when the file leaves the vault', async () => {
    const f = await upload('a.jpg', 'image/jpeg');
    const old = await share(f.id);
    await call(`/files/${f.id}/vault`, json({ inVault: true }));
    await call(`/files/${f.id}/vault`, json({ inVault: false }));
    expect((await pub(`/s/${old.token}`)).status).toBe(404);
    expect((await call(`/files/${f.id}/share`)).status).toBe(404);
    expect((await share(f.id)).token).not.toBe(old.token);
  });

  it('is enforced by the database itself, whichever code path hides the file', async () => {
    const trashed = await upload('a.jpg', 'image/jpeg');
    const vaulted = await upload('b.jpg', 'image/jpeg');
    const addRow = (id: string, token: string) =>
      env.DB.prepare('INSERT INTO shares (token, file_id, created_at) VALUES (?, ?, ?)').bind(token, id, Date.now()).run();
    await addRow(trashed.id, 'tokenA'.padEnd(32, 'x'));
    await addRow(vaulted.id, 'tokenB'.padEnd(32, 'x'));
    expect(await shareRows(trashed.id)).toHaveLength(1);

    await env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').bind(Date.now(), trashed.id).run();
    await env.DB.prepare('UPDATE files SET in_vault = 1 WHERE id = ?').bind(vaulted.id).run();

    expect(await shareRows(trashed.id)).toHaveLength(0);
    expect(await shareRows(vaulted.id)).toHaveLength(0);
  });
});

describe('public pages and downloads', () => {
  it('serves a page without any token, with the name, size and a download link', async () => {
    const f = await upload('Báo cáo.pdf', 'application/pdf', 'hello');
    const { token } = await share(f.id);
    const res = await pub(`/s/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Báo cáo.pdf');
    expect(html).toContain('5 B');
    expect(html).toContain(`/s/${token}/file`);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });

  it('shows an inline preview for a photo', async () => {
    const f = await upload('a.jpg', 'image/jpeg');
    const { token } = await share(f.id);
    expect(await (await pub(`/s/${token}`)).text()).toContain(`<img src="/s/${token}/file?inline=1"`);
  });

  it('escapes a hostile file name in the page', async () => {
    const f = await upload('<img src=x onerror=alert(1)>.pdf', 'application/pdf');
    const { token } = await share(f.id);
    const html = await (await pub(`/s/${token}`)).text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.pdf');
  });

  it('streams the file as an attachment with the original (Vietnamese) name and counts the download', async () => {
    const f = await upload('Hợp đồng thuê nhà.pdf', 'application/pdf', 'hello pdf');
    const { token } = await share(f.id);
    const res = await pub(`/s/${token}/file`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello pdf');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/^attachment;/);
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent('Hợp đồng thuê nhà.pdf')}`);
    const info = (await (await call(`/files/${f.id}/share`)).json()) as ShareInfo;
    expect(info.downloads).toBe(1);
    expect(info.lastAccessAt).not.toBeNull();
  });

  it('shows a photo inline without counting a download, but records the visit', async () => {
    const f = await upload('a.jpg', 'image/jpeg', 'jpegbytes');
    const { token } = await share(f.id);
    const res = await pub(`/s/${token}/file?inline=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition') ?? '').toMatch(/^inline;/);
    await res.arrayBuffer();
    const info = (await (await call(`/files/${f.id}/share`)).json()) as ShareInfo;
    expect(info.downloads).toBe(0);
    expect(info.lastAccessAt).not.toBeNull();
  });

  it('viewing the page records the visit but is not a download', async () => {
    const f = await upload('a.pdf', 'application/pdf');
    const { token } = await share(f.id);
    await (await pub(`/s/${token}`)).text();
    const info = (await (await call(`/files/${f.id}/share`)).json()) as ShareInfo;
    expect(info.downloads).toBe(0);
    expect(info.lastAccessAt).not.toBeNull();
  });

  it.each([
    ['logo.svg', 'image/svg+xml'],
    ['page.html', 'text/html'],
    ['doc.pdf', 'application/pdf'],
  ])('never serves %s inline on the app origin', async (name, mime) => {
    const f = await upload(name, mime, '<script>alert(1)</script>');
    const { token } = await share(f.id);
    expect((await pub(`/s/${token}/file?inline=1`)).status).toBe(404);
    const download = await pub(`/s/${token}/file`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition') ?? '').toMatch(/^attachment;/);
    await download.arrayBuffer();
  });

  it('sends the hardening headers on the page and on the file', async () => {
    const f = await upload('a.pdf', 'application/pdf');
    const { token } = await share(f.id);
    for (const path of [`/s/${token}`, `/s/${token}/file`]) {
      const res = await pub(path);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      await res.arrayBuffer();
    }
    const file = await pub(`/s/${token}/file`);
    expect(file.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    await file.arrayBuffer();
    expect((await pub(`/s/${token}`)).headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('gives the same answer for every reason a link is dead', async () => {
    const trashed = await upload('t.pdf', 'application/pdf');
    const t = await share(trashed.id);
    await call(`/files/${trashed.id}`, { method: 'DELETE' });

    const expired = await upload('e.pdf', 'application/pdf');
    const e = await share(expired.id, 1);
    await env.DB.prepare('UPDATE shares SET expires_at = ? WHERE file_id = ?').bind(Date.now() - 1000, expired.id).run();

    const stopped = await upload('s.pdf', 'application/pdf');
    const s = await share(stopped.id);
    await call(`/files/${stopped.id}/share`, { method: 'DELETE' });

    for (const path of ['', '/file']) {
      const shots = await Promise.all([t.token, e.token, s.token, 'nope'.padEnd(32, 'x')].map(async (tok) => snapshot(await pub(`/s/${tok}${path}`))));
      for (const shot of shots) expect(shot).toEqual(shots[0]);
      expect(shots[0].status).toBe(404);
    }
    const dead = await pub(`/s/${t.token}`);
    expect(await dead.text()).toContain('Link không còn hiệu lực');
  });

  it('answers 404 when the file is missing from R2 although the row says ready', async () => {
    const f = await upload('a.pdf', 'application/pdf');
    const { token } = await share(f.id);
    await env.BUCKET.delete(fileKey(f.id));
    expect((await pub(`/s/${token}/file`)).status).toBe(404);
  });

  it('keeps every other route behind the token', async () => {
    expect((await pub('/files')).status).toBe(401);
    expect((await pub('/usage')).status).toBe(401);
  });
});

describe('clean-up', () => {
  it('the cron removes expired shares and keeps live ones', async () => {
    const a = await upload('a.pdf', 'application/pdf');
    const b = await upload('b.pdf', 'application/pdf');
    await share(a.id, 1);
    await share(b.id, 30);
    await env.DB.prepare('UPDATE shares SET expires_at = ? WHERE file_id = ?').bind(Date.now() - 1000, a.id).run();
    await cleanup(env);
    expect(await shareRows(a.id)).toHaveLength(0);
    expect(await shareRows(b.id)).toHaveLength(1);
  });

  it('purge removes the share rows of the files it deletes', async () => {
    const f = await upload('a.pdf', 'application/pdf');
    await share(f.id);
    await purge(env, [f.id]);
    expect(await shareRows(f.id)).toHaveLength(0);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM files WHERE id = ?').bind(f.id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
