/** "Check for updates" support: version check via GitHub Releases, in-app install where the platform allows it. */

const REPO = 'ThanhPhat1080/fatup';

export type ReleaseInfo = { version: string; url: string };

/** Returns true when `latest` is a newer x.y.z than `current`. Pre-release suffixes are ignored. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Latest published (non-draft) release. */
export async function fetchLatestRelease(fetchImpl: typeof fetch = fetch): Promise<ReleaseInfo> {
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error('no_release');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { tag_name?: string; html_url?: string };
  if (!body.tag_name) throw new Error('no_release');
  return { version: body.tag_name.replace(/^v/, ''), url: body.html_url ?? `https://github.com/${REPO}/releases` };
}
