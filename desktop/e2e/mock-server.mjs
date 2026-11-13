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

export function startMockServer() {
  const now = Date.now();
  const hour = 3_600_000;
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

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const base = `http://127.0.0.1:${server.address().port}`;

    let m;
    if ((m = /^\/thumb\/(\d+)\.svg$/.exec(url.pathname))) return send(200, svg(Number(m[1])), 'image/svg+xml');
    if ((m = /^\/raw\/(\w+)$/.exec(url.pathname))) {
      const f = files.find((x) => x.id === m[1]);
      if (!f) return send(404, 'gone', 'text/plain');
      return f.img >= 0 ? send(200, svg(f.img), 'image/svg+xml') : send(200, `fake contents of ${f.name}`, 'text/plain');
    }

    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: { code: 'unauthorized', message: 'bad token' } });
    if (url.pathname === '/me') return send(200, { ok: true });
    if (url.pathname === '/files' && req.method === 'GET') {
      // Links are only returned when asked for; this mock holds none.
      if (url.searchParams.get('kind') === 'link') return send(200, { items: [], nextCursor: null });
      return send(200, {
        items: files.map(({ img, ...f }) => ({ ...f, thumbUrl: img >= 0 ? `${base}/thumb/${img}.svg` : null })),
        nextCursor: null,
      });
    }
    if ((m = /^\/files\/(\w+)\/download$/.exec(url.pathname))) return send(200, { url: `${base}/raw/${m[1]}` });
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
