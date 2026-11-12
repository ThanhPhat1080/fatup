import type { DownloadResponse, FileItem, ListFilesResponse } from '@fatup/shared';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 0,
  ) {
    super(message);
  }
}

export function normalizeServerUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const parsed = new URL(url); // throws on garbage
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ApiError('network', (err as Error).message);
    }
    if (res.status === 204) return undefined as T;
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!res.ok) {
      throw new ApiError(body?.error?.code ?? (res.status === 401 ? 'unauthorized' : 'http'), body?.error?.message ?? res.statusText, res.status);
    }
    return body as T;
  }

  verify(): Promise<{ ok: true }> {
    return this.request('/me');
  }

  /** Fetches every page; retention keeps the total small. */
  async listAll(maxPages = 20): Promise<FileItem[]> {
    const items: FileItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({ limit: '200' });
      if (cursor) qs.set('cursor', cursor);
      const res: ListFilesResponse = await this.request(`/files?${qs}`);
      items.push(...res.items);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    return items;
  }

  async downloadUrl(id: string): Promise<string> {
    const res: DownloadResponse = await this.request(`/files/${encodeURIComponent(id)}/download`);
    return res.url;
  }

  remove(id: string): Promise<void> {
    return this.request(`/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
