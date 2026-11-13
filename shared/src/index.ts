/** Types and constants shared by the Worker API and the desktop client. */

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
export const RETENTION_DAYS = 30;
export const TRASH_RETENTION_DAYS = 30;
export const PENDING_TTL_HOURS = 24;
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

export type FileKind = 'image' | 'file' | 'text';
export type KindFilter = 'all' | 'image' | 'file';

export function kindFromMime(mime: string): FileKind {
  return mime.toLowerCase().startsWith('image/') ? 'image' : 'file';
}

/** Finder-style colour tags, in display order. */
export const TAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const MAX_TAGS = 3;

export function isTagColor(value: unknown): value is TagColor {
  return typeof value === 'string' && (TAG_COLORS as readonly string[]).includes(value);
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
  /** Epoch milliseconds at which it was moved to the trash, or null when it is not in the trash. */
  deletedAt: number | null;
  /** True when the file lives in the Vault (hidden from the main list). */
  inVault: boolean;
  /** Up to MAX_TAGS distinct colour tags, in the order they were added. */
  tags: TagColor[];
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

/** R2's free tier includes 10 GB of storage. */
export const DEFAULT_QUOTA_BYTES = 10_000_000_000;

export type UsageResponse = {
  /** Bytes held by uploaded files, including those still in the trash. */
  usedBytes: number;
  limitBytes: number;
};

export type EmptyTrashResponse = { deleted: number };

export type DownloadResponse = { url: string };

export type ApiError = { error: { code: string; message: string } };
