import type { TagColor, CreateUploadRequest, CreateUploadResponse, DownloadResponse, EmptyTrashResponse, UsageResponse, FileItem, ListFilesResponse } from '@fatup/shared';

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

  usage(): Promise<UsageResponse> {
    return this.request('/usage');
  }

  /** Fetches every page; retention keeps the total small. */
  async listAll(opts: { trash?: boolean; vault?: boolean } = {}, maxPages = 20): Promise<FileItem[]> {
    const items: FileItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({ limit: '200' });
      if (opts.trash) qs.set('trash', '1');
      if (opts.vault) qs.set('vault', '1');
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

  createUpload(req: CreateUploadRequest): Promise<CreateUploadResponse> {
    return this.request('/uploads', { method: 'POST', body: JSON.stringify(req) });
  }

  complete(id: string): Promise<FileItem> {
    return this.request(`/uploads/${encodeURIComponent(id)}/complete`, { method: 'POST' });
  }

  update(id: string, patch: { name?: string; tags?: TagColor[] }): Promise<FileItem> {
    return this.request(`/files/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  setVault(id: string, inVault: boolean): Promise<FileItem> {
    return this.request(`/files/${encodeURIComponent(id)}/vault`, { method: 'PUT', body: JSON.stringify({ inVault }) });
  }

  /** Moves a file to the trash. */
  remove(id: string): Promise<void> {
    return this.request(`/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  restore(id: string): Promise<FileItem> {
    return this.request(`/files/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  }

  /** Permanently deletes a file that is already in the trash. */
  removeForever(id: string): Promise<void> {
    return this.request(`/files/${encodeURIComponent(id)}/permanent`, { method: 'DELETE' });
  }

  async emptyTrash(): Promise<number> {
    const res: EmptyTrashResponse = await this.request('/trash', { method: 'DELETE' });
    return res.deleted;
  }
}
