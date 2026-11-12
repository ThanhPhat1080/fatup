import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { MAX_FILE_SIZE, type CreateUploadRequest, type CreateUploadResponse } from '@fatup/shared';
import type { UploadJob } from '../shared-ipc';
import { ApiError } from './api';
import { mimeFromName } from './mime';

/** PUTs a file to a presigned URL, streaming from disk and reporting bytes sent. */
export async function putFile(
  url: string,
  path: string,
  size: number,
  mime: string,
  opts: { signal?: AbortSignal; onProgress?: (sent: number) => void; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const { signal, onProgress, fetchImpl = fetch } = opts;
  let sent = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sent += chunk.byteLength;
      onProgress?.(sent);
      controller.enqueue(chunk);
    },
  });
  const body = size === 0 ? new Uint8Array() : (Readable.toWeb(createReadStream(path)) as WebReadableStream<Uint8Array>).pipeThrough(counter);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'PUT',
      headers: { 'Content-Type': mime, 'Content-Length': String(size) },
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
    setVault(id: string, inVault: boolean): Promise<unknown>;
  };
  device: string | null;
  /** JPEG preview bytes for an image, or null when it can't be decoded. */
  thumbnail(path: string): Buffer | null;
  onChange(jobs: UploadJob[]): void;
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

  /** `vault: true` files are moved into the Vault as soon as they finish uploading. */
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
      const info = await stat(job.path).catch(() => null);
      if (!info) throw new ApiError('not_found', 'File not found');
      if (!info.isFile()) throw new ApiError('not_a_file', 'Not a file');
      if (info.size > MAX_FILE_SIZE) throw new ApiError('too_large', 'Too large');
      job.size = info.size;
      this.emit(true);

      const mime = mimeFromName(job.name);
      const thumb = mime.startsWith('image/') ? this.deps.thumbnail(job.path) : null;
      const api = this.deps.client();
      const ticket = await api.createUpload({ name: job.name, mime, size: info.size, hasThumb: thumb !== null, device: this.deps.device ?? undefined });
      if (job.abort.signal.aborted) return;

      await putFile(ticket.uploadUrl, job.path, info.size, mime, {
        signal: job.abort.signal,
        fetchImpl: this.deps.fetchImpl,
        onProgress: (sent) => {
          job.sent = sent;
          this.emit(false);
        },
      });
      if (thumb && ticket.thumbUploadUrl) {
        // A missing preview is not worth failing the upload for.
        const url = ticket.thumbUploadUrl;
        await putThumb(url, thumb, this.deps.fetchImpl).catch(() => undefined);
      }
      await api.complete(ticket.id);
      if (job.vault) await api.setVault(ticket.id, true);
      job.sent = job.size;
      if (job.state === 'uploading') job.state = 'done';
    } catch (err) {
      if (job.state === 'canceled' || job.abort.signal.aborted) {
        job.state = 'canceled';
        return;
      }
      job.state = 'error';
      job.error = err instanceof ApiError ? err.code : 'upload_failed';
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

async function putThumb(url: string, bytes: Buffer, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(bytes) });
  if (!res.ok) throw new ApiError('upload_failed', `HTTP ${res.status}`, res.status);
}
