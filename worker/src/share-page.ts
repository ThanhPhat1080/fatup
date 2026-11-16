/** The small public page a recipient sees. Plain HTML and CSS: no script, no app, no login. */

export type Lang = 'vi' | 'en';

/** Vietnamese by default (and for `vi`), English for any other stated language. */
export function pickLang(acceptLanguage: string | null | undefined): Lang {
  const first = (acceptLanguage ?? '').trim().toLowerCase();
  return first === '' || first.startsWith('vi') ? 'vi' : 'en';
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const TEXT = {
  vi: {
    download: 'Tải về',
    note: 'Chỉ xem và tải về. Link có thể ngừng hoạt động bất cứ lúc nào.',
    sharedWith: 'Được chia sẻ qua FatUp',
    deadTitle: 'Link không còn hiệu lực',
    deadBody: 'Người gửi đã dừng chia sẻ, link đã hết hạn, hoặc file không còn nữa. Hãy xin người gửi một link mới.',
  },
  en: {
    download: 'Download',
    note: 'View and download only. This link can stop working at any time.',
    sharedWith: 'Shared with FatUp',
    deadTitle: 'This link is no longer valid',
    deadBody: 'The sender stopped sharing, the link expired, or the file is gone. Ask the sender for a new link.',
  },
} as const;

const CSS = `
:root{color-scheme:light dark;--bg:#f8fafd;--panel:#fff;--text:#1f1f1f;--text2:#444746;--text3:#747775;--border:#e1e3e1;--primary:#0b57d0;--on:#fff;--surface:#f0f4f9}
@media(prefers-color-scheme:dark){:root{--bg:#131314;--panel:#1e1f20;--text:#e3e3e3;--text2:#c4c7c5;--text3:#8e918f;--border:#444746;--primary:#a8c7fa;--on:#062e6f;--surface:#282a2c}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,Ubuntu,sans-serif}
main{width:min(400px,100%);background:var(--panel);border:1px solid var(--border);border-radius:24px;padding:20px 20px 24px;text-align:center}
.pic{display:grid;place-items:center;height:210px;margin-bottom:16px;border-radius:14px;background:var(--surface);overflow:hidden;color:var(--text3)}
.pic img{max-width:100%;max-height:100%;object-fit:contain}
h1{margin:0 0 4px;font-size:18px;font-weight:500;word-break:break-word}
.meta{color:var(--text3);margin:0 0 18px}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;height:44px;border-radius:22px;background:var(--primary);color:var(--on);text-decoration:none;font-weight:500}
.btn:hover{filter:brightness(1.06)}
.foot{margin:18px 0 0;color:var(--text3);font-size:12px}
.dead{padding:28px 8px}.dead svg{color:var(--text3)}.dead h1{margin-top:10px}.dead p{color:var(--text2);margin:6px 0 0}
`;

const FILE_ICON =
  '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>';
const DOWNLOAD_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>';
const BAN_ICON =
  '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>';

function shell(lang: Lang, title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

export type SharedFile = { name: string; size: number; token: string; image: boolean };

export function renderSharePage(file: SharedFile, lang: Lang = 'vi'): string {
  const t = TEXT[lang];
  const base = `/s/${encodeURIComponent(file.token)}/file`;
  const pic = file.image ? `<img src="${base}?inline=1" alt="">` : FILE_ICON;
  return shell(
    lang,
    `${file.name} · FatUp`,
    `<main><div class="pic">${pic}</div><h1>${escapeHtml(file.name)}</h1><p class="meta">${formatBytes(file.size)} · ${t.sharedWith}</p><a class="btn" href="${base}">${DOWNLOAD_ICON} ${t.download}</a><p class="foot">${t.note}</p></main>`,
  );
}

/** The one page every dead link gets, whatever the reason, so nothing about the file leaks. */
export function renderDeadPage(lang: Lang = 'vi'): string {
  const t = TEXT[lang];
  return shell(lang, t.deadTitle, `<main class="dead">${BAN_ICON}<h1>${t.deadTitle}</h1><p>${t.deadBody}</p></main>`);
}
