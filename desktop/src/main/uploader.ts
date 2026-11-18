import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { MAX_FILE_SIZE, encryptBytes, encryptStream, vaultCiphertextSize, type CreateUploadRequest, type CreateUploadResponse, type FileKind } from '@fatup/shared';
import type { UploadJob } from '../shared-ipc';
import type { VaultSession } from '../vault-session';

/** The file-key type, as the shared crypto functions declare it. */
type FileKey = Parameters<typeof encryptStream>[0];
import { ApiError } from './api';
import { mimeFromName } from './mime';

/**
 * PUTs a file to a presigned URL, streaming from disk and reporting bytes sent.
 * With `dek` the bytes are encrypted on the way (FUV1, streamed): `size` stays the plain size, the body and Content-Length are
 * `vaultCiphertextSize(size)`, and progress counts plain bytes read.
 */
export async function putFile(
  url: string,
  path: string,
  size: number,
  mime: string,
  opts: { signal?: AbortSignal; onProgress?: (sent: number) => void; fetchImpl?: typeof fetch; dek?: FileKey } = {},
): Promise<void> {
  const { signal, onProgress, fetchImpl = fetch, dek } = opts;
  let sent = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sent += chunk.byteLength;
      onProgress?.(sent);
      controller.enqueue(chunk);
    },
  });
  let body: Uint8Array | ReadableStream<Uint8Array>;
  if (size === 0) body = dek ? await encryptBytes(new Uint8Array(), dek) : new Uint8Array();
  else {
    const plain = (Readable.toWeb(createReadStream(path)) as WebReadableStream<Uint8Array>).pipeThrough(counter);
    body = dek ? plain.pipeThrough(encryptStream(dek)) : plain;
  }
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'PUT',
      headers: { 'Content-Type': mime, 'Content-Length': String(dek ? vaultCiphertextSize(size) : size) },
      body,
      // Node's fetch needs this to send a stream.
      duplex: 'half',
      signal,
    } as RequestInit);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError('network', (err as Error).message);
  }
  if (!res.ok) throw new ApiError('upload_failed', `HTTP ${res.status}`, res.status);
}

export type UploadDeps = {
  client(): {
    createUpload(req: CreateUploadRequest): Promise<CreateUploadResponse>;
    complete(id: string): Promise<unknown>;
    /** Legacy (plain) move into the Vault. No longer used by uploads: Vault uploads are encrypted and created inside the Vault. */
    setVault?(id: string, inVault: boolean): Promise<unknown>;
  };
  device: string | null;
  /** JPEG preview bytes for an image, or null when it can't be decoded. */
  thumbnail(path: string): Buffer | null;
  onChange(jobs: UploadJob[]): void;
  /** The open Vault session, for uploads into the Vault. Without it (or with the Vault closed) a Vault upload fails with `vault_locked`. */
  vault?: Pick<VaultSession, 'isOpen' | 'encryptMetaFor'>;
  concurrency?: number;
  fetchImpl?: typeof fetch;
};

type Internal = UploadJob & { path: string; abort: AbortController; vault: boolean };

/** Drive-style upload queue: a couple of files at a time, with progress and cancel. */
export class UploadManager {
  private jobs: Internal[] = [];
  private running = 0;
  private nextId = 1;
  private lastEmit = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: UploadDeps) {}

  snapshot(): UploadJob[] {
    return this.jobs.map(({ path: _p, abort: _a, vault: _v, ...job }) => ({ ...job }));
  }

  /** `vault: true` files are encrypted on this machine and uploaded straight into the Vault. */
  add(paths: string[], vault = false): void {
    for (const path of paths) {
      this.jobs.push({
        id: String(this.nextId++),
        path,
        name: basename(path),
        size: 0,
        sent: 0,
        state: 'queued',
        abort: new AbortController(),
        vault,
      });
    }
    this.emit(true);
    this.pump();
  }

  cancel(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || (job.state !== 'queued' && job.state !== 'uploading')) return;
    job.abort.abort();
    job.state = 'canceled';
    this.emit(true);
  }

  cancelAll(): void {
    for (const job of this.jobs) this.cancel(job.id);
  }

  /** Drops finished, failed and canceled entries from the list. */
  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.state === 'queued' || j.state === 'uploading');
    this.emit(true);
  }

  private pump() {
    const limit = this.deps.concurrency ?? 2;
    while (this.running < limit) {
      const job = this.jobs.find((j) => j.state === 'queued');
      if (!job) return;
      job.state = 'uploading';
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        this.emit(true);
        this.pump();
      });
    }
  }

  private async run(job: Internal): Promise<void> {
    try {
      // Checked first: a closed Vault must not create, encrypt or upload anything.
      if (job.vault && !this.deps.vault?.isOpen()) throw new ApiError('vault_locked', 'The Vault is locked');
      const info = await stat(job.path).catch(() => null);
      if (!info) throw new ApiError('not_found', 'File not found');
      if (!info.isFile()) throw new ApiError('not_a_file', 'Not a file');
      if (info.size > MAX_FILE_SIZE) throw new ApiError('too_large', 'Too large');
      job.size = info.size;
      this.emit(true);

      const mime = mimeFromName(job.name);
      let thumb = mime.startsWith('image/') ? this.deps.thumbnail(job.path) : null;
      const api = this.deps.client();

      // Into the Vault: the real name and type travel only inside `encMeta`; the server sees an opaque object.
      let dek: FileKey | undefined;
      let ticket: CreateUploadResponse;
      if (job.vault) {
        const kind: FileKind = mime.startsWith('image/') ? 'image' : 'file';
        const sealed = await this.deps.vault!.encryptMetaFor({ name: job.name, mime, kind });
        dek = sealed.dek;
        if (thumb) thumb = Buffer.from(await encryptBytes(thumb, dek));
        ticket = await api.createUpload({
          name: '',
          mime: 'application/octet-stream',
          size: vaultCiphertextSize(info.size),
          hasThumb: thumb !== null,
          device: this.deps.device ?? undefined,
          vault: { encMeta: sealed.encMeta, encKey: sealed.encKey },
        });
      } else {
        ticket = await api.createUpload({ name: job.name, mime, size: info.size, hasThumb: thumb !== null, device: this.deps.device ?? undefined });
      }
      if (job.abort.signal.aborted) return;

      await putFile(ticket.uploadUrl, job.path, info.size, dek ? 'application/octet-stream' : mime, {
        signal: job.abort.signal,
        fetchImpl: this.deps.fetchImpl,
        dek,
        onProgress: (sent) => {
          job.sent = sent;
          this.emit(false);
        },
      });
      if (thumb && ticket.thumbUploadUrl) {
        // A missing preview is not worth failing the upload for.
        const url = ticket.thumbUploadUrl;
        await putThumb(url, thumb, dek ? 'application/octet-stream' : 'image/jpeg', this.deps.fetchImpl).catch(() => undefined);
      }
      await api.complete(ticket.id);
      job.sent = job.size;
      if (job.state === 'uploading') job.state = 'done';
    } catch (err) {
      if (job.state === 'canceled' || job.abort.signal.aborted) {
        job.state = 'canceled';
        return;
      }
      job.state = 'error';
      // `vault_locked` also comes from the session itself (VaultLockedError) when the Vault closes while the key is being made.
      job.error = err instanceof ApiError || codeOf(err) === 'vault_locked' ? codeOf(err) : 'upload_failed';
    }
  }

  /** Progress updates are throttled; state changes go out immediately. */
  private emit(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastEmit < 150) {
      this.emitTimer ??= setTimeout(() => {
        this.emitTimer = null;
        this.emit(true);
      }, 150);
      return;
    }
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.lastEmit = now;
    this.deps.onChange(this.snapshot());
  }
}

const codeOf = (err: unknown): string | undefined => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
};

async function putThumb(url: string, bytes: Buffer, contentType: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: new Uint8Array(bytes) });
  if (!res.ok) throw new ApiError('upload_failed', `HTTP ${res.status}`, res.status);
}
