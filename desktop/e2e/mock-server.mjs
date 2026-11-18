// A tiny stand-in for the Worker API, used by the smoke test, the unit test of this file and for screenshots.
// The vault routes follow worker/src/vault.ts and worker/src/app.ts: the same shapes, status codes and PIN counter.
// The mock stores what the client sends (ciphertext, base64 secrets) and never decrypts anything.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export const TOKEN = 'e2e-token';

// The same numbers as shared/src/vault.ts (VAULT_WIPE_AT, VAULT_LOCK_RULES); repeated here because this file runs without a build.
const WIPE_AT = 10;
const LOCK_RULES = [
  { from: 5, ms: 60_000 },
  { from: 6, ms: 15 * 60_000 },
];
const VAULT_HEADER = 'x-fatup-vault'; // Node lower-cases incoming header names
const VAULT_VERSION = '2';
/** What `vault/in` hands out as `attempt` and what `vault/in/complete` accepts: base64url, at least 16 characters, no dot or slash (spec 4.7d). */
const ATTEMPT = /^[A-Za-z0-9_-]{16,}$/;
/** The R2 key of an encrypted item's object: `vault/<id>.<attempt>` once an attempt encrypted it, the fixed `vault/<id>` for a direct upload. */
const vaultKey = (v) => (v.encObject ? `vault/${v.id}.${v.encObject}` : `vault/${v.id}`);

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

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const newId = () => randomBytes(13).toString('hex').toUpperCase(); // 26 characters, like a ULID
const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= 8192;
const isInt = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Strict standard base64 with padding, at least 16 bytes long; the bytes, or null. Same rule as the Worker's decodeB64. */
function b64(v) {
  if (typeof v !== 'string' || v.length > 4096 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v)) return null;
  const bytes = Buffer.from(v, 'base64');
  return bytes.length >= 16 ? bytes : null;
}

const fail = (status, code, message) => ({ status, body: { error: { code, message } } });
const badRequest = (message) => fail(400, 'bad_request', message);
const notReady = () => fail(409, 'vault_not_ready', 'The Vault has not been set up');
const wipedBody = () => fail(410, 'vault_wiped', 'The Vault keys were wiped; use the recovery key');

/** The lock length after the counter reaches `n` (unscaled ms); 0 when no rule applies. */
function lockMs(n) {
  let ms = 0;
  for (const rule of LOCK_RULES) if (n >= rule.from && n < WIPE_AT) ms = rule.ms;
  return ms;
}

function readAll(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Parses a JSON object body, or undefined when it is not one. */
function jsonObject(raw) {
  try {
    const body = JSON.parse(raw.toString('utf8') || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

/** Where a plain file's thumbnail comes from: a seeded picture (SVG) or an uploaded thumbnail object. */
function plainThumbSrc(f, base) {
  if (f.uploaded) return f.hasThumb ? `${base}/obj/files/${f.id}.thumb` : null;
  return f.img >= 0 ? `${base}/thumb/${f.img}.svg` : null;
}

/** The item as the Worker's toItem returns it, for a plain (not encrypted) file. */
function plainJson(f, base, shares) {
  const { img, uploaded, hasThumb, ...item } = f;
  return { ...item, encrypted: false, encMeta: null, encKey: null, shared: shares.has(f.id), thumbUrl: plainThumbSrc(f, base) };
}

/** An encrypted Vault item as the Worker returns it: no readable name or type, only encMeta and encKey. */
function vaultJson(v, base) {
  return {
    id: v.id,
    name: '',
    mime: 'application/octet-stream',
    size: v.size,
    kind: 'file',
    thumbUrl: v.hasThumb ? `${base}/obj/${vaultKey(v)}.thumb` : null,
    device: v.device,
    createdAt: v.createdAt,
    deletedAt: v.deletedAt,
    inVault: true,
    tags: [],
    url: null,
    site: null,
    previewed: false,
    iconUrl: null,
    important: v.important ?? false,
    shared: false,
    encrypted: true,
    encMeta: v.encMeta,
    encKey: v.encKey,
  };
}

/**
 * @param {number} realNow  the clock the seed dates are built from
 * @param {{ vaultLockScale?: number, slowVaultComplete?: number, slowVaultOut?: number, failVaultOut?: number }} options  vaultLockScale
 *   multiplies the Vault lock lengths (the test shortens them; default: E2E_VAULT_LOCK_SCALE or 1). slowVaultComplete holds each
 *   `vault/in/complete` for that many ms, so a move stays "pending" (faded cloud) for a while; default 0. slowVaultOut and failVaultOut
 *   are read per request (see the move-out switches and takeOutFailure in the body below).
 */
export function startMockServer(realNow = Date.now(), options = {}) {
  const lockScale = options.vaultLockScale ?? Number(process.env.E2E_VAULT_LOCK_SCALE ?? 1);
  const slowVaultComplete = options.slowVaultComplete ?? 0;
  // Move-out switches, read from the options object when a request arrives so an area can set them while it runs. slowVaultOut holds each
  // vault/out and vault/out/complete for that many ms (a move-out stays optimistic meanwhile). failVaultOut makes the next one of those two
  // requests answer 500, after the hold (a one-shot: the counter goes down when it arrives).
  const takeOutFailure = () => {
    if (!(options.failVaultOut > 0)) return false;
    options.failVaultOut -= 1;
    return true;
  };
  const outHold = () => (options.slowVaultOut > 0 ? new Promise((resolve) => setTimeout(resolve, options.slowVaultOut)) : null);
  const hour = 3_600_000;
  // The seed dates are "a few hours ago" and "yesterday evening", which only land in the right calendar days when it is already
  // morning. Before 08:00 local time, pretend it is 08:00 so the file list always has a Today and a Yesterday group.
  const startOfToday = new Date(realNow).setHours(0, 0, 0, 0);
  const now = Math.max(realNow, startOfToday + 8 * hour);
  // The time stamped on anything the mock creates while it runs (an upload, an imported image): it starts at the seed clock above and then
  // moves with the real clock, so a new item is always the newest one. With the plain real time, a run before 08:00 (UTC on CI) would put it
  // between two seeded files. Timers and locks keep using the real time (`Date.now()`).
  const clockNow = () => now + (Date.now() - realNow);
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

  // Images another app dropped into the bucket folder: `POST /import/sync` moves them into the list, like the Worker does.
  const pendingImports = [['Screenshot d30.png', 'image/png', 520_000]];

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

  // Public share links by file id: the same rule as the Worker (a file that goes to the trash loses its link).
  const shares = new Map();

  // The Vault (one per account, as in D1). `vault` is null before setup; `authHash` is null once wiped. Secrets stay as the client sent them.
  let vault = null;
  // Encrypted items: ready and in the Vault's trash. Uploads still in progress are in `uploads`.
  const vaultItems = [];
  const uploads = new Map();
  // Stored objects by R2-style key ('vault/<id>', 'files/<id>', '.thumb' suffix for thumbnails). Served back as the client PUT them.
  const blobs = new Map();

  // A valid 1x1 PNG, served as the preview picture of every link except the last (Shopee), which has none.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  const isLocked = (now) => vault !== null && vault.lockedUntil !== null && vault.lockedUntil > now;
  const remaining = () => (vault.authHash === null ? 0 : Math.max(0, WIPE_AT - vault.failed));
  const lockedBody = () => ({ remaining: remaining(), lockedUntil: vault.lockedUntil });
  const vaultStatus = (now) => {
    if (!vault) return { state: 'none', failedAttempts: 0, lockedUntil: null, remaining: WIPE_AT };
    return {
      state: vault.authHash === null ? 'wiped' : 'ready',
      kdf: vault.kdf,
      failedAttempts: vault.failed,
      lockedUntil: isLocked(now) ? vault.lockedUntil : null,
      remaining: remaining(),
    };
  };

  /**
   * Checks an authKey (unlock, or PIN change by the old PIN) like the Worker's checkPin: a wiped Vault answers 410, a locked one
   * 423 without counting, a wrong key counts one attempt and may lock (423) or wipe (410). Returns null when the key is right.
   */
  function checkPin(authKey, now) {
    if (vault.authHash === null) return wipedBody();
    if (isLocked(now)) return { status: 423, body: lockedBody() };
    if (sha(authKey) === vault.authHash) return null;
    vault.failed += 1;
    if (vault.failed >= WIPE_AT) {
      vault.authHash = null;
      vault.serverSecret = null;
      vault.wrappedMkPin = null;
      vault.lockedUntil = null;
      return wipedBody();
    }
    const ms = lockMs(vault.failed) * lockScale;
    vault.lockedUntil = ms > 0 ? now + ms : null;
    return { status: isLocked(now) ? 423 : 403, body: lockedBody() };
  }

  /** The Vault, the encrypted files and their uploads. Returns { status, body } or null when the request is not one of these. */
  async function vaultApi(req, url, raw, base) {
    const { pathname } = url;
    const method = req.method;
    const now = Date.now();
    const ready = () => vault !== null && vault.authHash !== null;
    const vaultItem = (id) => vaultItems.find((v) => v.id === id);
    let m;

    if (pathname === '/vault' && method === 'GET') return { status: 200, body: vaultStatus(now) };

    if (pathname === '/vault/setup' && method === 'POST') {
      const b = jsonObject(raw);
      if (!b) return badRequest('Body must be JSON');
      const authKey = b64(b.authKey);
      const rkAuth = b64(b.rkAuth);
      if (!b64(b.kdfSalt) || !(Number.isInteger(b.kdfIterations) && b.kdfIterations > 0) || !authKey || !b64(b.serverSecret) || !b64(b.wrappedMkPin) || !rkAuth || !b64(b.wrappedMkRecovery)) {
        return badRequest('kdfSalt, kdfIterations, authKey, serverSecret, wrappedMkPin, rkAuth and wrappedMkRecovery must be valid');
      }
      if (vault) return fail(409, 'vault_exists', 'The Vault is already set up');
      vault = {
        kdf: { salt: b.kdfSalt, iterations: b.kdfIterations },
        authHash: sha(authKey),
        serverSecret: b.serverSecret,
        wrappedMkPin: b.wrappedMkPin,
        rkAuthHash: sha(rkAuth),
        wrappedMkRecovery: b.wrappedMkRecovery,
        failed: 0,
        lockedUntil: null,
      };
      return { status: 201, body: { ok: true } };
    }

    if (pathname === '/vault/unlock' && method === 'POST') {
      const b = jsonObject(raw);
      if (!b) return badRequest('Body must be JSON');
      const authKey = b64(b.authKey);
      if (!authKey) return badRequest('authKey must be base64');
      if (!vault) return notReady();
      const stop = checkPin(authKey, now);
      if (stop) return stop;
      vault.failed = 0;
      vault.lockedUntil = null;
      return { status: 200, body: { serverSecret: vault.serverSecret, wrappedMkPin: vault.wrappedMkPin } };
    }

    if (pathname === '/vault/recover' && method === 'POST') {
      const b = jsonObject(raw);
      if (!b) return badRequest('Body must be JSON');
      const rkAuth = b64(b.rkAuth);
      if (!rkAuth) return badRequest('rkAuth must be base64');
      if (!vault) return notReady();
      if (sha(rkAuth) !== vault.rkAuthHash) return fail(403, 'forbidden', 'Wrong recovery key');
      return { status: 200, body: { wrappedMkRecovery: vault.wrappedMkRecovery } };
    }

    if (pathname === '/vault/pin' && method === 'PUT') {
      const b = jsonObject(raw);
      if (!b) return badRequest('Body must be JSON');
      const p = b.proof && typeof b.proof === 'object' && !Array.isArray(b.proof) ? b.proof : null;
      let proof = null;
      if (p && (p.authKey === undefined) !== (p.rkAuth === undefined)) {
        const kind = p.authKey !== undefined ? 'authKey' : 'rkAuth';
        const bytes = b64(p[kind]);
        if (bytes) proof = { kind, bytes };
      }
      const newAuth = b64(b.authKey);
      if (!proof) return badRequest('proof must hold exactly one of authKey or rkAuth, as base64');
      if (!b64(b.kdfSalt) || !(Number.isInteger(b.kdfIterations) && b.kdfIterations > 0) || !newAuth || !b64(b.serverSecret) || !b64(b.wrappedMkPin)) {
        return badRequest('kdfSalt, kdfIterations, authKey, serverSecret and wrappedMkPin must be valid');
      }
      if (!vault) return notReady();
      if (proof.kind === 'authKey') {
        const stop = checkPin(proof.bytes, now);
        if (stop) return stop;
      } else if (sha(proof.bytes) !== vault.rkAuthHash) {
        // The recovery key is 128 bits: it neither counts nor respects the lock.
        return fail(403, 'forbidden', 'Wrong recovery key');
      }
      Object.assign(vault, {
        kdf: { salt: b.kdfSalt, iterations: b.kdfIterations },
        authHash: sha(newAuth),
        serverSecret: b.serverSecret,
        wrappedMkPin: b.wrappedMkPin,
        failed: 0,
        lockedUntil: null,
      });
      return { status: 200, body: { ok: true } };
    }

    // The encrypted list. An app that predates the Vault (no version header) is refused once a Vault exists.
    if (pathname === '/files' && method === 'GET' && url.searchParams.get('vault') === '1') {
      if (req.headers[VAULT_HEADER] !== VAULT_VERSION && vault !== null) return fail(426, 'app_outdated', 'Update the app to use the Vault');
      const trash = url.searchParams.get('trash') === '1';
      // Like the Worker, `kind` filters: the client asks for `all` and for `link` separately. The mock keeps only files in the Vault, so `link` is empty.
      const kind = url.searchParams.get('kind') ?? 'all';
      // Plain files that vault/in put in the Vault but no device has finished encrypting yet (in_vault = 1, encrypted = 0) come with their plain metadata.
      const pending = trash || kind === 'link' ? [] : files.filter((f) => f.inVault).map((f) => ({ createdAt: f.createdAt, json: plainJson(f, base, shares) }));
      const items = [
        ...vaultItems.filter((v) => kind !== 'link' && (trash ? v.deletedAt !== null : v.deletedAt === null)).map((v) => ({ createdAt: v.createdAt, json: vaultJson(v, base) })),
        ...pending,
      ]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((x) => x.json);
      return { status: 200, body: { items, nextCursor: null } };
    }

    if (pathname === '/uploads' && method === 'POST') {
      const b = jsonObject(raw);
      if (!b) return badRequest('Body must be JSON');
      const { name, mime, size, hasThumb, device } = b;
      if (typeof name !== 'string' || typeof mime !== 'string' || typeof size !== 'number') return badRequest('name, mime and size are required');
      if (!isInt(size)) return badRequest('Invalid size');
      const vaultBody = b.vault ?? null;
      if (vaultBody !== null && !(isStr(vaultBody.encMeta) && isStr(vaultBody.encKey))) {
        return badRequest('vault.encMeta and vault.encKey must be non-empty strings');
      }
      if (vaultBody && !ready()) return fail(409, 'vault_not_ready', 'The Vault is not ready');
      const id = newId();
      const isVault = vaultBody !== null;
      const withThumb = hasThumb === true && (isVault || mime.startsWith('image/'));
      uploads.set(id, {
        id,
        vault: isVault,
        name,
        mime,
        size,
        hasThumb: withThumb,
        device: typeof device === 'string' ? device.slice(0, 64) : null,
        createdAt: clockNow(),
        encMeta: isVault ? vaultBody.encMeta : null,
        encKey: isVault ? vaultBody.encKey : null,
      });
      const key = isVault ? `vault/${id}` : `files/${id}`;
      return {
        status: 201,
        body: { id, uploadUrl: `${base}/put/${key}`, thumbUploadUrl: withThumb ? `${base}/put/${key}.thumb` : null },
      };
    }

    if ((m = /^\/uploads\/(\w+)\/complete$/.exec(pathname)) && method === 'POST') {
      const up = uploads.get(m[1]);
      if (!up) return fail(404, 'not_found', 'Upload not found');
      const key = up.vault ? `vault/${up.id}` : `files/${up.id}`;
      const obj = blobs.get(key);
      if (!obj) return fail(409, 'not_uploaded', 'File has not been uploaded yet');
      if (obj.bytes.length !== up.size) {
        blobs.delete(key);
        blobs.delete(`${key}.thumb`);
        uploads.delete(up.id);
        return fail(409, 'size_mismatch', 'Uploaded size does not match');
      }
      uploads.delete(up.id);
      const hasThumb = up.hasThumb && blobs.has(`${key}.thumb`);
      if (up.vault) {
        const v = { id: up.id, size: up.size, hasThumb, device: up.device, createdAt: clockNow(), deletedAt: null, encMeta: up.encMeta, encKey: up.encKey };
        vaultItems.push(v);
        return { status: 200, body: vaultJson(v, base) };
      }
      const f = {
        id: up.id,
        name: up.name,
        mime: up.mime,
        size: up.size,
        kind: up.mime.startsWith('image/') ? 'image' : 'file',
        device: up.device,
        createdAt: clockNow(),
        deletedAt: null,
        inVault: false,
        tags: [],
        url: null,
        site: null,
        previewed: false,
        important: false,
        uploaded: true,
        hasThumb,
        img: -1,
      };
      files.push(f);
      return { status: 200, body: plainJson(f, base, shares) };
    }

    // Vault items: delete keeps them in the Vault's trash; restore, permanent delete, PATCH (encMeta only) and download.
    if ((m = /^\/files\/(\w+)$/.exec(pathname)) && method === 'DELETE') {
      const v = vaultItem(m[1]);
      if (!v) return null;
      if (v.deletedAt === null) v.deletedAt = now;
      return { status: 204 };
    }
    if ((m = /^\/files\/(\w+)$/.exec(pathname)) && method === 'PATCH') {
      const v = vaultItem(m[1]);
      if (!v) return null;
      const b = jsonObject(raw);
      if (!b) return badRequest('Body must be JSON');
      if (b.name !== undefined || b.url !== undefined) return fail(409, 'encrypted', 'Send encMeta instead of a plain name or url');
      if (b.encMeta !== undefined) {
        if (!isStr(b.encMeta)) return badRequest('encMeta must be a non-empty string of at most 8192 characters');
        v.encMeta = b.encMeta;
      }
      if (typeof b.important === 'boolean') v.important = b.important;
      return { status: 200, body: vaultJson(v, base) };
    }
    if ((m = /^\/files\/(\w+)\/restore$/.exec(pathname)) && method === 'POST') {
      const v = vaultItem(m[1]);
      if (!v) return null;
      v.deletedAt = null;
      return { status: 200, body: vaultJson(v, base) };
    }
    if ((m = /^\/files\/(\w+)\/permanent$/.exec(pathname)) && method === 'DELETE') {
      const v = vaultItem(m[1]);
      if (!v) return null;
      if (v.deletedAt === null) return fail(409, 'not_in_trash', 'Move the file to the trash first');
      vaultItems.splice(vaultItems.indexOf(v), 1);
      blobs.delete(vaultKey(v));
      blobs.delete(`${vaultKey(v)}.thumb`);
      return { status: 204 };
    }
    if ((m = /^\/files\/(\w+)\/download$/.exec(pathname)) && method === 'GET') {
      const v = vaultItem(m[1]);
      if (!v) return null;
      if (v.deletedAt !== null) return fail(404, 'not_found', 'File not found');
      return { status: 200, body: { url: `${base}/obj/${vaultKey(v)}` } };
    }

    // Moves. A plain file goes into the Vault with `in`, an encrypted one comes out with `out`; the client does the crypto.
    if ((m = /^\/files\/(\w+)\/vault\/in$/.exec(pathname)) && method === 'POST') {
      if (!ready()) return notReady();
      const f = files.find((x) => x.id === m[1]);
      if (!f) return vaultItem(m[1]) ? fail(409, 'already_encrypted', 'The item is already encrypted') : fail(404, 'not_found', 'File not found');
      // Like the Worker (spec 4.7d): no claim and no state for the attempt, so any number of devices may ask. Every call gets a new attempt and
      // its own object name. The item is in the Vault from now on (it leaves the main list, its share link dies), still plain until a complete.
      const attempt = randomBytes(16).toString('base64url');
      f.inVault = true;
      shares.delete(f.id);
      const thumb = plainThumbSrc(f, base);
      return {
        status: 200,
        body: {
          attempt,
          uploadUrl: `${base}/put/vault/${f.id}.${attempt}`,
          thumbUploadUrl: thumb ? `${base}/put/vault/${f.id}.${attempt}.thumb` : null,
          downloadUrl: `${base}/raw/${f.id}`,
          thumbUrl: thumb,
        },
      };
    }
    if ((m = /^\/files\/(\w+)\/vault\/in\/complete$/.exec(pathname)) && method === 'POST') {
      if (!ready()) return notReady();
      const b = jsonObject(raw);
      if (!b) return badRequest('Body must be JSON');
      if (!isStr(b.encMeta) || !isStr(b.encKey) || !isInt(b.size)) return badRequest('encMeta, encKey and a non-negative integer size are required');
      const id = m[1];
      // One-shot failure for the next complete to arrive: read from the options object when the request arrives (before the slow wait),
      // so an area can set it while it runs; a complete already held by slowVaultComplete is not the one that fails.
      if (options.failVaultComplete > 0) {
        options.failVaultComplete -= 1;
        return fail(500, 'e2e_failure', 'E2E: simulated failure of vault/in/complete');
      }
      if (slowVaultComplete > 0) await new Promise((resolve) => setTimeout(resolve, slowVaultComplete));
      const existing = vaultItem(id);
      if (existing) {
        // Already encrypted. A body without attempt is the move-out cleanup: sweep the plain copies. A device that lost the race (another attempt
        // won) is answered 200 and its own objects are deleted; the winner's key and metadata stay. A retry of the winning attempt changes nothing.
        if (b.attempt === undefined) {
          blobs.delete(`files/${id}`);
          blobs.delete(`files/${id}.thumb`);
        } else if (typeof b.attempt === 'string' && ATTEMPT.test(b.attempt) && b.attempt !== existing.encObject) {
          blobs.delete(`vault/${id}.${b.attempt}`);
          blobs.delete(`vault/${id}.${b.attempt}.thumb`);
        }
        return { status: 200, body: vaultJson(existing, base) };
      }
      const f = files.find((x) => x.id === id);
      if (!f) return fail(404, 'not_found', 'File not found');
      if (typeof b.attempt !== 'string' || !ATTEMPT.test(b.attempt)) return badRequest('attempt (the value vault/in returned) is required');
      const stem = `vault/${id}.${b.attempt}`;
      const obj = blobs.get(stem);
      if (!obj) return fail(409, 'not_uploaded', 'The encrypted file has not been uploaded yet');
      if (obj.bytes.length !== b.size) {
        blobs.delete(stem);
        blobs.delete(`${stem}.thumb`);
        return fail(409, 'size_mismatch', 'Uploaded size does not match');
      }
      const hasThumb = b.hasThumb === true && blobs.has(`${stem}.thumb`);
      files.splice(files.indexOf(f), 1);
      shares.delete(id);
      blobs.delete(`files/${id}`);
      blobs.delete(`files/${id}.thumb`);
      const v = { id, size: b.size, hasThumb, device: f.device, createdAt: f.createdAt, deletedAt: null, encMeta: b.encMeta, encKey: b.encKey, encObject: b.attempt, important: f.important ?? false };
      vaultItems.push(v);
      return { status: 200, body: vaultJson(v, base) };
    }
    if ((m = /^\/files\/(\w+)\/vault\/out$/.exec(pathname)) && method === 'POST') {
      if (!ready()) return notReady();
      const failed = takeOutFailure();
      await outHold();
      if (failed) return fail(500, 'e2e_failure', 'E2E: simulated failure of vault/out');
      const v = vaultItem(m[1]);
      if (!v || v.deletedAt !== null) return fail(404, 'not_found', 'File not found');
      return {
        status: 200,
        body: {
          uploadUrl: `${base}/put/files/${v.id}`,
          thumbUploadUrl: v.hasThumb ? `${base}/put/files/${v.id}.thumb` : null,
          downloadUrl: `${base}/obj/${vaultKey(v)}`,
          thumbUrl: v.hasThumb ? `${base}/obj/${vaultKey(v)}.thumb` : null,
        },
      };
    }
    if ((m = /^\/files\/(\w+)\/vault\/out\/complete$/.exec(pathname)) && method === 'POST') {
      if (!ready()) return notReady();
      const failed = takeOutFailure();
      await outHold();
      if (failed) return fail(500, 'e2e_failure', 'E2E: simulated failure of vault/out/complete');
      const b = jsonObject(raw);
      if (!b) return badRequest('Body must be JSON');
      if (b.url !== undefined && b.url !== null) return badRequest('the mock moves files, not links');
      if (typeof b.name !== 'string' || typeof b.mime !== 'string' || !isInt(b.size)) return badRequest('name, mime and a non-negative integer size are required');
      const v = vaultItem(m[1]);
      if (!v || v.deletedAt !== null) return fail(404, 'not_found', 'File not found');
      const key = `files/${v.id}`;
      const obj = blobs.get(key);
      if (!obj) return fail(409, 'not_uploaded', 'The file has not been uploaded yet');
      if (obj.bytes.length !== b.size) {
        blobs.delete(key);
        return fail(409, 'size_mismatch', 'Uploaded size does not match');
      }
      const kind = b.mime.startsWith('image/') ? 'image' : 'file';
      const f = {
        id: v.id,
        name: b.name,
        mime: b.mime,
        size: b.size,
        kind,
        device: v.device,
        createdAt: v.createdAt,
        deletedAt: null,
        inVault: false,
        tags: [],
        url: null,
        site: null,
        previewed: false,
        important: v.important,
        uploaded: true,
        hasThumb: b.hasThumb === true && kind === 'image' && blobs.has(`${key}.thumb`),
        img: -1,
      };
      vaultItems.splice(vaultItems.indexOf(v), 1);
      blobs.delete(vaultKey(v));
      blobs.delete(`${vaultKey(v)}.thumb`);
      files.push(f);
      return { status: 200, body: plainJson(f, base, shares) };
    }

    return null;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const raw = await readAll(req);
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (status, body, type = 'application/json') => {
      if (body === undefined) return res.writeHead(status).end();
      res.writeHead(status, { 'Content-Type': type });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    let m;
    if ((m = /^\/thumb\/(\d+)\.svg$/.exec(url.pathname))) return send(200, svg(Number(m[1])), 'image/svg+xml');
    if (/^\/pic\/\w+\.png$/.test(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(png);
    }
    // Presigned object storage, like R2's URLs: no token. PUT stores the bytes as sent; GET serves them back.
    if ((m = /^\/put\/(.+)$/.exec(url.pathname)) && req.method === 'PUT') {
      // No ETag header: since spec 4.7d a move in names its object by attempt and needs nothing from the answer.
      blobs.set(m[1], { bytes: raw, type: req.headers['content-type'] ?? 'application/octet-stream' });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('');
    }
    if ((m = /^\/obj\/(.+)$/.exec(url.pathname))) {
      const blob = blobs.get(m[1]);
      if (!blob) return send(404, 'gone', 'text/plain');
      res.writeHead(200, { 'Content-Type': blob.type });
      return res.end(blob.bytes);
    }
    if ((m = /^\/raw\/(\w+)$/.exec(url.pathname))) {
      const f = files.find((x) => x.id === m[1]);
      if (!f) return send(404, 'gone', 'text/plain');
      if (f.uploaded) {
        const blob = blobs.get(`files/${f.id}`);
        if (!blob) return send(404, 'gone', 'text/plain');
        res.writeHead(200, { 'Content-Type': blob.type });
        return res.end(blob.bytes);
      }
      if (f.img >= 0) return send(200, svg(f.img), 'image/svg+xml');
      // Served as a download, like R2's presigned URLs; the app reads PDFs itself to show them.
      if (f.mime === 'application/pdf') return send(200, tinyPdf(f.name), 'application/pdf');
      return send(200, `fake contents of ${f.name}`, 'text/plain');
    }

    // Where a thumbnail made later is PUT (the real one is a presigned R2 URL).
    if (req.method === 'PUT' && /^\/thumb-put\/\w+$/.test(url.pathname)) {
      req.resume();
      return req.on('end', () => send(200, '', 'text/plain'));
    }

    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: { code: 'unauthorized', message: 'bad token' } });
    if (url.pathname === '/me') return send(200, { ok: true });
    if (url.pathname === '/import/sync' && req.method === 'POST') {
      const moved = pendingImports.splice(0).map(([name, mime, size]) => ({
        id: `d30${files.length}`.padStart(26, '0'),
        name,
        mime,
        size,
        kind: 'image',
        device: 'd30',
        createdAt: clockNow(),
        deletedAt: null,
        inVault: false,
        tags: [],
        url: null,
        site: null,
        previewed: false,
        hasThumb: false,
        img: imageIndex++,
      }));
      files.unshift(...moved);
      return send(200, { imported: moved.length, more: false });
    }
    if ((m = /^\/files\/(\w+)\/thumb(\/complete)?$/.exec(url.pathname)) && req.method === 'POST') {
      const f = files.find((x) => x.id === m[1]);
      if (!f) return send(404, { error: { code: 'not_found', message: 'nope' } });
      if (!m[2]) return send(200, { thumbUploadUrl: `${base}/thumb-put/${f.id}` });
      f.hasThumb = true;
      const { img, ...item } = f;
      return send(200, { ...item, shared: shares.has(f.id), thumbUrl: `${base}/thumb/${img}.svg` });
    }

    const vaultReply = await vaultApi(req, url, raw, base);
    if (vaultReply) return send(vaultReply.status, vaultReply.body);

    if (url.pathname === '/files' && req.method === 'GET') {
      // Links are only returned when asked for.
      if (url.searchParams.get('kind') === 'link') return send(200, { items: links.map((l) => ({ ...l, thumbUrl: null })), nextCursor: null });
      return send(200, { items: files.filter((f) => !f.inVault).map((f) => plainJson(f, base, shares)), nextCursor: null });
    }
    if ((m = /^\/links\/(\w+)\/preview$/.exec(url.pathname)) && req.method === 'POST') {
      const link = links.find((x) => x.id === m[1]);
      if (!link) return send(404, { error: { code: 'not_found', message: 'nope' } });
      return send(200, { ...link, thumbUrl: null, previewed: true, previewImage: link.url.includes('shopee') ? null : `${base}/pic/${link.id}.png` });
    }
    if ((m = /^\/files\/(\w+)\/share$/.exec(url.pathname))) {
      const id = m[1];
      const info = () => ({ ...shares.get(id), url: `${base}/s/${shares.get(id).token}` });
      if (req.method === 'GET') return shares.has(id) ? send(200, info()) : send(404, { error: { code: 'not_shared', message: 'not shared' } });
      if (req.method === 'DELETE') {
        shares.delete(id);
        return send(200, { ok: true });
      }
      if (req.method === 'PUT') {
        if (!files.some((x) => x.id === id && !x.inVault)) return send(404, { error: { code: 'not_found', message: 'nope' } });
        const days = jsonObject(raw)?.expiresInDays;
        const expiresAt = days === null || days === undefined ? null : Date.now() + days * day;
        const had = shares.get(id);
        if (had) {
          had.expiresAt = expiresAt;
          return send(200, info());
        }
        shares.set(id, { token: `MockToken${id}`.slice(0, 32).padEnd(32, 'x'), expiresAt, downloads: 0, lastAccessAt: null, createdAt: Date.now() });
        return send(201, info());
      }
    }
    if ((m = /^\/files\/(\w+)\/download$/.exec(url.pathname))) return send(200, { url: `${base}/raw/${m[1]}` });
    if ((m = /^\/files\/(\w+)$/.exec(url.pathname)) && req.method === 'PATCH') {
      // Only what the app's tests change: the important marker.
      const id = m[1];
      const patch = jsonObject(raw) ?? {};
      const f = files.find((x) => x.id === id) ?? links.find((x) => x.id === id);
      if (!f) return send(404, { error: { code: 'not_found', message: 'nope' } });
      if (typeof patch.important === 'boolean') f.important = patch.important;
      return send(200, plainJson(f, base, shares));
    }
    if ((m = /^\/files\/(\w+)$/.exec(url.pathname)) && req.method === 'DELETE') {
      const i = files.findIndex((x) => x.id === m[1]);
      if (i < 0) return send(404, { error: { code: 'not_found', message: 'nope' } });
      files.splice(i, 1);
      shares.delete(m[1]);
      return send(204);
    }
    send(404, { error: { code: 'not_found', message: 'route' } });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, files })));
}
