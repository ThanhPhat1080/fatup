import { MAX_FILE_SIZE, type CreateUploadRequest, type CreateUploadResponse } from '@fatup/shared';
import type { UploadJob } from '../../desktop/src/shared-ipc';
import { ApiError } from '../../desktop/src/main/api';
import { mimeFromName } from '../../desktop/src/main/mime';

/** PUTs a file or blob to a presigned URL with progress and cancel. XMLHttpRequest, because fetch cannot report upload progress. */
export function putBlob(url: string, body: Blob, mime: string, opts: { signal?: AbortSignal; onProgress?: (sent: number) => void } = {}): Promise<void> {
  const { signal, onProgress } = opts;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError('upload_failed', `HTTP ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      // The browser hides why; a blocked request usually means the bucket has no CORS rule for this origin.
      reject(new ApiError('upload_blocked', 'Upload request failed (check the R2 bucket CORS rule)'));
    };
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal) {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    }
    xhr.send(body);
  });
}

/** A 400px-long-edge JPEG preview of an image, or null when the browser cannot decode it (HEIC on most desktops, etc.). */
export async function makeThumbnail(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8));
  } catch {
    return null;
  }
}

/** "Chrome · Android", "Safari · iPhone" and so on, for the "from" column. */
export function deviceName(ua = navigator.userAgent): string {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux|X11/i.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Web';
  return os ? `${browser} · ${os}` : browser;
}

export type WebUploadDeps = {
  client(): {
    createUpload(req: CreateUploadRequest): Promise<CreateUploadResponse>;
    complete(id: string): Promise<unknown>;
    setVault(id: string, inVault: boolean): Promise<unknown>;
  };
  device: string | null;
  onChange(jobs: UploadJob[]): void;
  concurrency?: number;
  put?: typeof putBlob;
  thumbnail?: (file: File) => Promise<Blob | null>;
  mimeOf?: (file: File) => string;
};

type Internal = UploadJob & { file: File; abort: AbortController; vault: boolean };

const mimeFromFile = (file: File) => file.type || mimeFromName(file.name);

/** The browser counterpart of the desktop `UploadManager`: same queue, same job shape, so the shared upload panel just works. */
export class WebUploadManager {
  private jobs: Internal[] = [];
  private running = 0;
  private nextId = 1;
  private lastEmit = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: WebUploadDeps) {}

  snapshot(): UploadJob[] {
    return this.jobs.map(({ file: _f, abort: _a, vault: _v, ...job }) => ({ ...job }));
  }

  /** `vault: true` files are moved into the Vault as soon as they finish uploading. */
  add(files: File[], vault = false): void {
    for (const file of files) {
      this.jobs.push({ id: String(this.nextId++), file, name: file.name, size: file.size, sent: 0, state: 'queued', abort: new AbortController(), vault });
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
    const put = this.deps.put ?? putBlob;
    try {
      if (job.file.size > MAX_FILE_SIZE) throw new ApiError('too_large', 'Too large');
      const mime = (this.deps.mimeOf ?? mimeFromFile)(job.file);
      const thumb = mime.startsWith('image/') ? await (this.deps.thumbnail ?? makeThumbnail)(job.file) : null;
      const api = this.deps.client();
      const ticket = await api.createUpload({ name: job.name, mime, size: job.file.size, hasThumb: thumb !== null, device: this.deps.device ?? undefined });
      if (job.abort.signal.aborted) return;

      await put(ticket.uploadUrl, job.file, mime, {
        signal: job.abort.signal,
        onProgress: (sent) => {
          job.sent = sent;
          this.emit(false);
        },
      });
      if (thumb && ticket.thumbUploadUrl) {
        // A missing preview is not worth failing the upload for.
        await put(ticket.thumbUploadUrl, thumb, 'image/jpeg').catch(() => undefined);
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
