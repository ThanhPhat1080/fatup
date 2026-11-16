import { Hono } from 'hono';
import type { Context } from 'hono';
import { SHARE_TOKEN_BYTES } from '@fatup/shared';
import type { Env } from './env';
import { contentDisposition, fileKey } from './presign';
import { pickLang, renderDeadPage, renderSharePage } from './share-page';

/**
 * The only public routes besides /health. A link is checked against the database on EVERY request
 * (never cached, never a presigned URL), so it stops working the instant its file is hidden or removed.
 * Every reason a link can be dead gets the identical 404, so nothing about the file leaks.
 */

/** 24 bytes in base64url, without padding, is exactly this many characters. */
const TOKEN_LENGTH = Math.ceil((SHARE_TOKEN_BYTES * 4) / 3);
const TOKEN_RE = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`);

/** Only these may be shown inline on the app's origin; SVG, HTML and everything else is download-only. */
const INLINE_IMAGES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

type Shared = { id: string; name: string; mime: string; size: number };

/** The one query that decides whether a link works. */
async function lookup(db: D1Database, token: string): Promise<Shared | null> {
  if (!TOKEN_RE.test(token)) return null;
  return db
    .prepare(
      `SELECT f.id, f.name, f.mime, f.size
       FROM shares s JOIN files f ON f.id = s.file_id
       WHERE s.token = ? AND f.status = 'ready' AND f.deleted_at IS NULL AND f.in_vault = 0
         AND f.kind IN ('image', 'file') AND (s.expires_at IS NULL OR s.expires_at > ?)`,
    )
    .bind(token, Date.now())
    .first<Shared>();
}

const baseHeaders = (): Record<string, string> => ({
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});
const PAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const FILE_CSP = "sandbox; default-src 'none'";

function html(body: string, status: 200 | 404): Response {
  return new Response(body, { status, headers: { ...baseHeaders(), 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP } });
}

const dead = (c: Context) => html(renderDeadPage(pickLang(c.req.header('accept-language'))), 404);

/** A mime type from an upload is client-supplied, so anything odd is served as opaque bytes. */
const safeMime = (mime: string) => (/^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : 'application/octet-stream');

export function createShareRoutes() {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/:token', async (c) => {
    const token = c.req.param('token');
    const file = await lookup(c.env.DB, token);
    if (!file) return dead(c);
    await c.env.DB.prepare('UPDATE shares SET last_access_at = ? WHERE token = ?').bind(Date.now(), token).run();
    return html(renderSharePage({ name: file.name, size: file.size, token, image: INLINE_IMAGES.has(file.mime) }, pickLang(c.req.header('accept-language'))), 200);
  });

  app.get('/:token/file', async (c) => {
    const token = c.req.param('token');
    const inline = c.req.query('inline') === '1';
    const file = await lookup(c.env.DB, token);
    if (!file || (inline && !INLINE_IMAGES.has(file.mime))) return dead(c);

    const object = await c.env.BUCKET.get(fileKey(file.id));
    if (!object) return dead(c);

    // A photo shown on the page is a visit; only the download button counts as a download.
    await c.env.DB.prepare(`UPDATE shares SET last_access_at = ?, downloads = downloads + ? WHERE token = ?`)
      .bind(Date.now(), inline ? 0 : 1, token)
      .run();

    const disposition = inline ? contentDisposition(file.name).replace(/^attachment/, 'inline') : contentDisposition(file.name);
    return new Response(object.body, {
      status: 200,
      headers: {
        ...baseHeaders(),
        'Content-Type': safeMime(file.mime),
        'Content-Length': String(object.size),
        'Content-Disposition': disposition,
        'Content-Security-Policy': FILE_CSP,
      },
    });
  });

  return app;
}
