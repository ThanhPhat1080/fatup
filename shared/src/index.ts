/** Types and constants shared by the Worker API and the desktop client. */

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
export const RETENTION_DAYS = 30;
export const PENDING_TTL_HOURS = 24;
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

export type FileKind = 'image' | 'file' | 'text';
export type KindFilter = 'all' | 'image' | 'file';

export function kindFromMime(mime: string): FileKind {
  return mime.toLowerCase().startsWith('image/') ? 'image' : 'file';
}

export type FileItem = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: FileKind;
  /** Presigned URL to a small JPEG preview, valid for about an hour. */
  thumbUrl: string | null;
  device: string | null;
  /** Epoch milliseconds at which the upload completed. */
  createdAt: number;
};

export type CreateUploadRequest = {
  name: string;
  mime: string;
  size: number;
  hasThumb: boolean;
  device?: string;
};

export type CreateUploadResponse = {
  id: string;
  uploadUrl: string;
  thumbUploadUrl: string | null;
};

export type ListFilesResponse = {
  items: FileItem[];
  nextCursor: string | null;
};

export type DownloadResponse = { url: string };

export type ApiError = { error: { code: string; message: string } };
