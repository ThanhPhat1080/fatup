/** Types and constants shared by the Worker API and the desktop client. */

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
export const RETENTION_DAYS = 30;
export const TRASH_RETENTION_DAYS = 30;
export const PENDING_TTL_HOURS = 24;
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

export type FileKind = 'image' | 'file' | 'text' | 'link';
export type KindFilter = 'all' | 'image' | 'file' | 'link';

export function kindFromMime(mime: string): FileKind {
  return mime.toLowerCase().startsWith('image/') ? 'image' : 'file';
}

/** Finder-style colour tags, in display order. */
export const TAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const MAX_TAGS = 3;

/** Where a link points, judged by its domain. `internet` is everything else. */
export const SITE_CATEGORIES = ['facebook', 'youtube', 'instagram', 'threads', 'shopee', 'tiktok', 'internet'] as const;
export type SiteCategory = (typeof SITE_CATEGORIES)[number];

export const MAX_URL_LENGTH = 2048;
export const LINK_MIME = 'text/uri-list';

const SITE_DOMAINS: Record<Exclude<SiteCategory, 'internet'>, string[]> = {
  facebook: ['facebook.com', 'fb.com', 'fb.me', 'fb.watch'],
  youtube: ['youtube.com', 'youtu.be'],
  instagram: ['instagram.com'],
  threads: ['threads.net', 'threads.com'],
  shopee: ['shopee.vn', 'shopee.com', 'shp.ee'],
  tiktok: ['tiktok.com'],
};

/** Trims and validates a user-supplied link: http(s) only, no fragment, lowercase host, at most MAX_URL_LENGTH characters. */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  const href = url.href;
  return href.length <= MAX_URL_LENGTH ? href : null;
}

export function siteOf(url: string): SiteCategory {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'internet';
  }
  for (const site of Object.keys(SITE_DOMAINS) as (keyof typeof SITE_DOMAINS)[]) {
    if (SITE_DOMAINS[site].some((d) => host === d || host.endsWith(`.${d}`))) return site;
  }
  return 'internet';
}

/** Finds the first http(s) link in shared text such as "Look at this https://a.com/x." */
export function extractUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text ?? '');
  if (!match) return null;
  return normalizeUrl(match[0].replace(/[.,;:!?)\]}>]+$/, ''));
}

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
  /** The bookmarked address; null unless kind is 'link'. */
  url: string | null;
  /** Domain category of a link; null for everything else. */
  site: SiteCategory | null;
  /** True once a preview (title and image) has been attempted for a link. */
  previewed: boolean;
};

export type CreateLinkRequest = {
  url: string;
  title?: string;
  device?: string;
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
