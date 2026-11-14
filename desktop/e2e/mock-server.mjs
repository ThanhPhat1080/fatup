// A tiny stand-in for the Worker API, used by the smoke test and for screenshots.
import { createServer } from 'node:http';

export const TOKEN = 'e2e-token';

const COLORS = [
  ['#4285f4', '#34a853'],
  ['#fbbc04', '#ea4335'],
  ['#a142f4', '#24c1e0'],
  ['#ff7043', '#ffca28'],
  ['#26a69a', '#d4e157'],
  ['#5c6bc0', '#ec407a'],
];

function svg(i) {
  const [a, b] = COLORS[i % COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="800" height="600" fill="url(#g)"/>
<circle cx="${560 - i * 30}" cy="200" r="90" fill="#fff" opacity=".85"/>
<path d="M0 600 L${220 + i * 20} 300 L420 470 L560 360 L800 600Z" fill="#000" opacity=".25"/></svg>`;
}

/** A one-page PDF with the file's name written on it. */
function tinyPdf(title) {
  const text = title.replace(/[()\\]/g, '').replace(/[^\x20-\x7e]/g, '?');
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}

export function startMockServer(realNow = Date.now()) {
  const hour = 3_600_000;
  // The seed dates are "a few hours ago" and "yesterday evening", which only land in the right calendar days when it is already
  // morning. Before 08:00 local time, pretend it is 08:00 so the file list always has a Today and a Yesterday group.
  const startOfToday = new Date(realNow).setHours(0, 0, 0, 0);
  const now = Math.max(realNow, startOfToday + 8 * hour);
  const day = 24 * hour;
  const seed = [
    ['IMG_20261112_0832.jpg', 'image/jpeg', 2_480_000, 0.3 * hour],
    ['Báo cáo tháng 11.pdf', 'application/pdf', 1_210_000, 1.2 * hour],
    ['PXL_20261112_071503.heic', 'image/heic', 3_900_000, 2 * hour],
    ['Screenshot_2026-11-12.png', 'image/png', 640_000, 2.5 * hour],
    ['Hợp đồng thuê nhà.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 88_000, day + 3 * hour],
    ['IMG_20261111_1920.jpg', 'image/jpeg', 2_900_000, day + 5 * hour],
    ['chi-tieu-2026.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 45_000, day + 6 * hour],
    ['Đà Lạt trip.jpg', 'image/jpeg', 4_100_000, 5 * day],
    ['boarding-pass.pdf', 'application/pdf', 310_000, 5 * day + hour],
    ['IMG_20261105_1012.jpg', 'image/jpeg', 2_200_000, 7 * day],
  ];
  let imageIndex = 0;
  const files = seed.map(([name, mime, size, ago], i) => ({
    id: String(i).padStart(26, '0'),
    name,
    mime,
    size,
    kind: mime.startsWith('image/') ? 'image' : 'file',
    device: i % 3 === 2 ? 'Galaxy Tab S9' : 'Pixel 8',
    createdAt: Math.round(now - ago),
    deletedAt: null,
    inVault: false,
    tags: [],
    url: null,
    site: null,
    previewed: false,
    img: mime.startsWith('image/') ? imageIndex++ : -1,
  }));

  // A few saved links, returned only for `GET /files?kind=link`. Titles are in a mixed order so sorting by platform visibly moves them.
  const linkSeed = [
    ['Cách nấu phở ngon', 'https://www.youtube.com/watch?v=abc', 'youtube'],
    ['Bài viết hay trên Facebook', 'https://fb.me/xyz', 'facebook'],
    ['Thread về AI', 'https://x.com/someone/status/1', 'x'],
    ['Blog của Kent', 'https://example.com/post', 'internet'],
    ['Video TikTok vui', 'https://www.tiktok.com/@a/video/1', 'tiktok'],
    ['Tổng hợp deal Shopee', 'https://shopee.vn/a-i.1.2', 'internet'],
  ];
  const links = linkSeed.map(([name, url, site], i) => ({
    id: `l${i}`.padStart(26, '0'),
    name,
    mime: 'text/uri-list',
    size: 0,
    kind: 'link',
    device: 'Pixel 8',
    createdAt: Math.round(now - (i + 1) * hour),
    deletedAt: null,
    inVault: false,
    tags: [],
    url,
    site,
    previewed: true,
  }));

  // A valid 1x1 PNG, served as the preview picture of every link except the last (Shopee), which has none.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const base = `http://127.0.0.1:${server.address().port}`;

    let m;
    if ((m = /^\/thumb\/(\d+)\.svg$/.exec(url.pathname))) return send(200, svg(Number(m[1])), 'image/svg+xml');
    if (/^\/pic\/\w+\.png$/.test(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(png);
    }
    if ((m = /^\/raw\/(\w+)$/.exec(url.pathname))) {
      const f = files.find((x) => x.id === m[1]);
      if (!f) return send(404, 'gone', 'text/plain');
      if (f.img >= 0) return send(200, svg(f.img), 'image/svg+xml');
      // Served as a download, like R2's presigned URLs; the app reads PDFs itself to show them.
      if (f.mime === 'application/pdf') return send(200, tinyPdf(f.name), 'application/pdf');
      return send(200, `fake contents of ${f.name}`, 'text/plain');
    }

    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: { code: 'unauthorized', message: 'bad token' } });
    if (url.pathname === '/me') return send(200, { ok: true });
    if (url.pathname === '/files' && req.method === 'GET') {
      // Links are only returned when asked for.
      if (url.searchParams.get('kind') === 'link') return send(200, { items: links.map((l) => ({ ...l, thumbUrl: null })), nextCursor: null });
      return send(200, {
        items: files.map(({ img, ...f }) => ({ ...f, thumbUrl: img >= 0 ? `${base}/thumb/${img}.svg` : null })),
        nextCursor: null,
      });
    }
    if ((m = /^\/links\/(\w+)\/preview$/.exec(url.pathname)) && req.method === 'POST') {
      const link = links.find((x) => x.id === m[1]);
      if (!link) return send(404, { error: { code: 'not_found', message: 'nope' } });
      return send(200, { ...link, thumbUrl: null, previewed: true, previewImage: link.url.includes('shopee') ? null : `${base}/pic/${link.id}.png` });
    }
    if ((m = /^\/files\/(\w+)\/download$/.exec(url.pathname))) return send(200, { url: `${base}/raw/${m[1]}` });
    if ((m = /^\/files\/(\w+)$/.exec(url.pathname)) && req.method === 'PATCH') {
      // Only what the app's tests change: the important marker.
      const id = m[1];
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const patch = JSON.parse(raw || '{}');
        const f = files.find((x) => x.id === id) ?? links.find((x) => x.id === id);
        if (!f) return send(404, { error: { code: 'not_found', message: 'nope' } });
        if (typeof patch.important === 'boolean') f.important = patch.important;
        const { img, ...item } = f;
        send(200, { ...item, thumbUrl: img >= 0 ? `${base}/thumb/${img}.svg` : null });
      });
      return;
    }
    if ((m = /^\/files\/(\w+)$/.exec(url.pathname)) && req.method === 'DELETE') {
      const i = files.findIndex((x) => x.id === m[1]);
      if (i < 0) return send(404, { error: { code: 'not_found', message: 'nope' } });
      files.splice(i, 1);
      res.writeHead(204).end();
      return;
    }
    send(404, { error: { code: 'not_found', message: 'route' } });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, files })));
}
