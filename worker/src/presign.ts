import { AwsClient } from 'aws4fetch';
import type { Env } from './env';

export const UPLOAD_URL_TTL = 15 * 60;
export const READ_URL_TTL = 60 * 60;

export type Presigner = {
  put(key: string): Promise<string>;
  /** `stable`: signed from the start of the hour and valid two hours, so repeated calls in the same hour return the very same URL (the browser can cache what it points to). */
  get(key: string, opts?: { filename?: string; contentType?: string; stable?: boolean }): Promise<string>;
};

/** Signs S3-compatible URLs so clients can talk to R2 directly. */
export function createPresigner(env: Env): Presigner {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}`;

  async function sign(method: 'GET' | 'PUT', key: string, ttl: number, query: Record<string, string> = {}, datetime?: string) {
    const url = new URL(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`);
    url.searchParams.set('X-Amz-Expires', String(ttl));
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const signed = await client.sign(new Request(url, { method }), { aws: { signQuery: true, datetime } });
    return signed.url;
  }

  return {
    put: (key) => sign('PUT', key, UPLOAD_URL_TTL),
    get: (key, opts = {}) => {
      const query: Record<string, string> = {};
      if (opts.filename) query['response-content-disposition'] = contentDisposition(opts.filename);
      if (opts.contentType) query['response-content-type'] = opts.contentType;
      if (opts.stable) {
        const hourStart = new Date(Math.floor(Date.now() / (READ_URL_TTL * 1000)) * READ_URL_TTL * 1000);
        return sign('GET', key, READ_URL_TTL * 2, query, hourStart.toISOString().replace(/[:-]|\.\d{3}/g, ''));
      }
      return sign('GET', key, READ_URL_TTL, query);
    },
  };
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const fileKey = (id: string) => `files/${id}`;
export const thumbKey = (id: string) => `thumbs/${id}.jpg`;

/**
 * Encrypted Vault objects live under `vault/`. An item encrypted by a move in (vault/in) is stored at `vault/<id>.<attempt>[.thumb]`, one
 * object per attempt so two devices never write the same name; an item uploaded straight into the Vault has no attempt and keeps the fixed `vault/<id>[.thumb]`.
 */
export const vaultFileKey = (id: string, attempt?: string | null) => (attempt ? `vault/${id}.${attempt}` : `vault/${id}`);
export const vaultThumbKey = (id: string, attempt?: string | null) => `${vaultFileKey(id, attempt)}.thumb`;

/** The R2 keys `[file, thumbnail]` of a row: the plain pair, or the Vault pair of its `enc_object` once encrypted. */
export function objectKeys(row: { id: string; encrypted: number; enc_object?: string | null }): [string, string] {
  return row.encrypted === 1 ? [vaultFileKey(row.id, row.enc_object), vaultThumbKey(row.id, row.enc_object)] : [fileKey(row.id), thumbKey(row.id)];
}
