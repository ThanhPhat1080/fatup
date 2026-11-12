import { AwsClient } from 'aws4fetch';
import type { Env } from './env';

export const UPLOAD_URL_TTL = 15 * 60;
export const READ_URL_TTL = 60 * 60;

export type Presigner = {
  put(key: string): Promise<string>;
  get(key: string, opts?: { filename?: string; contentType?: string }): Promise<string>;
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

  async function sign(method: 'GET' | 'PUT', key: string, ttl: number, query: Record<string, string> = {}) {
    const url = new URL(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`);
    url.searchParams.set('X-Amz-Expires', String(ttl));
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const signed = await client.sign(new Request(url, { method }), { aws: { signQuery: true } });
    return signed.url;
  }

  return {
    put: (key) => sign('PUT', key, UPLOAD_URL_TTL),
    get: (key, opts = {}) => {
      const query: Record<string, string> = {};
      if (opts.filename) query['response-content-disposition'] = contentDisposition(opts.filename);
      if (opts.contentType) query['response-content-type'] = opts.contentType;
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
