import { VAULT_HEADER, VAULT_PROTOCOL_VERSION } from '@fatup/shared';
import type {
  TagColor,
  FrameCheck,
  PreviewResponse,
  CreateLinkRequest,
  CreateUploadRequest,
  CreateUploadResponse,
  DownloadResponse,
  EmptyTrashResponse,
  UsageResponse,
  FileItem,
  ListFilesResponse,
  ShareExpiryDays,
  ShareInfo,
  VaultStatus,
  VaultSetupRequest,
  VaultUnlockRequest,
  VaultUnlockResponse,
  VaultRecoverRequest,
  VaultRecoverResponse,
  VaultPinRequest,
  VaultMoveUrls,
  VaultMoveInComplete,
  VaultMoveOutComplete,
  ImportSyncResponse,
  ThumbUploadResponse,
} from '@fatup/shared';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 0,
    /** The parsed JSON body of the failed response, or null. The Vault's 403/423 answers carry `remaining` and `lockedUntil` here. */
    public readonly body: unknown = null,
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
    // Wrapped, not `= fetch`: browsers throw "Illegal invocation" when fetch is called as a method of another object.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
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
      throw new ApiError(body?.error?.code ?? (res.status === 401 ? 'unauthorized' : 'http'), body?.error?.message ?? res.statusText, res.status, body);
    }
    return body as T;
  }

  verify(): Promise<{ ok: true }> {
    return this.request('/me');
  }

  usage(): Promise<UsageResponse> {
    return this.request('/usage');
  }

  /** Asks the server to move images other apps dropped into the bucket folder into Fatup (a batch per call). */
  importSync(): Promise<ImportSyncResponse> {
    return this.request('/import/sync', { method: 'POST' });
  }

  /** The URL to PUT a thumbnail to, for an image that has none. */
  thumbUpload(id: string): Promise<ThumbUploadResponse> {
    return this.request(`/files/${encodeURIComponent(id)}/thumb`, { method: 'POST' });
  }

  thumbComplete(id: string): Promise<FileItem> {
    return this.request(`/files/${encodeURIComponent(id)}/thumb/complete`, { method: 'POST' });
  }

  /** Fetches every page; retention keeps the total small. */
  async listAll(opts: { trash?: boolean; vault?: boolean; kind?: 'all' | 'link' } = {}, maxPages = 20): Promise<FileItem[]> {
    const items: FileItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({ limit: '200' });
      if (opts.trash) qs.set('trash', '1');
      if (opts.vault) qs.set('vault', '1');
      if (opts.kind && opts.kind !== 'all') qs.set('kind', opts.kind);
      if (cursor) qs.set('cursor', cursor);
      const headers = opts.vault ? { [VAULT_HEADER]: VAULT_PROTOCOL_VERSION } : undefined;
      const res: ListFilesResponse = await this.request(`/files?${qs}`, { headers });
      items.push(...res.items);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    return items;
  }

  /** Files and links together, newest first. The server keeps links out of the plain list, and the trash already holds every kind. */
  async listEverything(opts: { trash?: boolean; vault?: boolean } = {}): Promise<FileItem[]> {
    if (opts.trash) return this.listAll(opts);
    const [files, links] = await Promise.all([this.listAll(opts), this.listAll({ ...opts, kind: 'link' })]);
    return [...files, ...links].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  }

  addLink(req: CreateLinkRequest): Promise<FileItem> {
    return this.request('/links', { method: 'POST', body: JSON.stringify(req) });
  }

  /** Asks the server to read a link's page: its title is filled in, and the address of its picture comes back (the picture itself is the client's to fetch and keep). */
  previewLink(id: string): Promise<PreviewResponse> {
    return this.request(`/links/${encodeURIComponent(id)}/preview`, { method: 'POST' });
  }

  linkFrame(id: string): Promise<FrameCheck> {
    return this.request(`/links/${encodeURIComponent(id)}/frame`);
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

  /** `encMeta` is the only way to rename or re-address an encrypted item; its plain `name` / `url` are refused. */
  update(id: string, patch: { name?: string; tags?: TagColor[]; url?: string; important?: boolean; encMeta?: string }): Promise<FileItem> {
    return this.request(`/files/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  /** The file's share link, or null when it is not shared. */
  async getShare(id: string): Promise<ShareInfo | null> {
    try {
      return await this.request(`/files/${encodeURIComponent(id)}/share`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_shared') return null;
      throw err;
    }
  }

  setShare(id: string, expiresInDays: ShareExpiryDays | null): Promise<ShareInfo> {
    return this.request(`/files/${encodeURIComponent(id)}/share`, { method: 'PUT', body: JSON.stringify({ expiresInDays }) });
  }

  stopShare(id: string): Promise<void> {
    return this.request(`/files/${encodeURIComponent(id)}/share`, { method: 'DELETE' });
  }

  setVault(id: string, inVault: boolean): Promise<FileItem> {
    return this.request(`/files/${encodeURIComponent(id)}/vault`, { method: 'PUT', body: JSON.stringify({ inVault }) });
  }

  vaultStatus(): Promise<VaultStatus> {
    return this.request('/vault');
  }

  async vaultSetup(req: VaultSetupRequest): Promise<void> {
    await this.request('/vault/setup', { method: 'POST', body: JSON.stringify(req) });
  }

  /** Wrong PIN answers 403, locked 423 (both with `{ remaining, lockedUntil }` in `ApiError.body`), wiped 410. */
  vaultUnlock(req: VaultUnlockRequest): Promise<VaultUnlockResponse> {
    return this.request('/vault/unlock', { method: 'POST', body: JSON.stringify(req) });
  }

  vaultRecover(req: VaultRecoverRequest): Promise<VaultRecoverResponse> {
    return this.request('/vault/recover', { method: 'POST', body: JSON.stringify(req) });
  }

  async vaultSetPin(req: VaultPinRequest): Promise<void> {
    await this.request('/vault/pin', { method: 'PUT', body: JSON.stringify(req) });
  }

  /** Step 1 of moving a plain file into the Vault: presigned addresses for the plain source and the ciphertext target. */
  moveIn(id: string): Promise<VaultMoveUrls> {
    return this.request(`/files/${encodeURIComponent(id)}/vault/in`, { method: 'POST' });
  }

  moveInComplete(id: string, req: VaultMoveInComplete): Promise<FileItem> {
    return this.request(`/files/${encodeURIComponent(id)}/vault/in/complete`, { method: 'POST', body: JSON.stringify(req) });
  }

  moveOut(id: string): Promise<VaultMoveUrls> {
    return this.request(`/files/${encodeURIComponent(id)}/vault/out`, { method: 'POST' });
  }

  moveOutComplete(id: string, req: VaultMoveOutComplete): Promise<FileItem> {
    return this.request(`/files/${encodeURIComponent(id)}/vault/out/complete`, { method: 'POST', body: JSON.stringify(req) });
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
