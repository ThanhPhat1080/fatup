import { AwsClient } from 'aws4fetch';
import type { Env } from './env';

/** An object as the S3 listing describes it. `uploaded` is epoch ms; `etag` has no quotes. */
export type ListedObject = { key: string; size: number; etag: string; uploaded: number };

/** The source of a copy no longer exists. */
export class ObjectMissingError extends Error {}

/** The source of a copy is no longer the version that was listed (it was overwritten). */
export class ObjectChangedError extends Error {}

/**
 * The bucket as the S3 API sees it: the same bucket the presigned upload URLs write to.
 * The `BUCKET` binding is not used for this on purpose: under `wrangler dev` it is a local simulation, a different bucket.
 */
export type ObjectStore = {
  list(prefix: string, cursor?: string): Promise<{ objects: ListedObject[]; next: string | null }>;
  head(key: string): Promise<{ size: number; etag: string } | null>;
  /**
   * Copies inside the bucket, server side: the bytes never reach the Worker. Throws ObjectMissingError when the source is gone.
   * With `etag`, copies only that version of the source and throws ObjectChangedError when it has been overwritten.
   */
  copy(from: string, to: string, etag?: string): Promise<void>;
  /** An object that is already gone counts as deleted. */
  delete(key: string): Promise<void>;
};

const LIST_PAGE = 1000;

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');
const unquote = (etag: string) => etag.replace(/&quot;|"/g, '');

function unescapeXml(text: string): string {
  return text.replace(/&(lt|gt|quot|apos|amp);/g, (_m, name: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[name]!);
}

/** The text of the first <tag> in `xml`, entities decoded, or null. */
function tagText(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? unescapeXml(m[1]) : null;
}

export function createObjectStore(env: Env, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): ObjectStore {
  const client = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
  const base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}`;

  async function send(url: string, init: RequestInit): Promise<Response> {
    return fetchImpl(await client.sign(url, init));
  }

  const failed = async (what: string, res: Response) => new Error(`${what} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

  return {
    async list(prefix, cursor) {
      const url = new URL(base);
      url.searchParams.set('list-type', '2');
      url.searchParams.set('prefix', prefix);
      url.searchParams.set('max-keys', String(LIST_PAGE));
      if (cursor) url.searchParams.set('continuation-token', cursor);
      const res = await send(url.toString(), { method: 'GET' });
      if (!res.ok) throw await failed('list', res);
      const xml = await res.text();
      const objects: ListedObject[] = [];
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = tagText(m[1], 'Key');
        const size = Number(tagText(m[1], 'Size'));
        const modified = Date.parse(tagText(m[1], 'LastModified') ?? '');
        if (key === null || !Number.isFinite(size) || !Number.isFinite(modified)) continue;
        objects.push({ key, size, etag: unquote(tagText(m[1], 'ETag') ?? ''), uploaded: modified });
      }
      return { objects, next: tagText(xml, 'IsTruncated') === 'true' ? tagText(xml, 'NextContinuationToken') : null };
    },

    async head(key) {
      const res = await send(`${base}/${encodeKey(key)}`, { method: 'HEAD' });
      if (res.status === 404) return null;
      if (!res.ok) throw await failed('head', res);
      return { size: Number(res.headers.get('Content-Length') ?? 0), etag: unquote(res.headers.get('ETag') ?? '') };
    },

    async copy(from, to, etag) {
      const headers: Record<string, string> = { 'x-amz-copy-source': `/${env.R2_BUCKET_NAME}/${encodeKey(from)}` };
      if (etag !== undefined) headers['x-amz-copy-source-if-match'] = `"${etag}"`;
      const res = await send(`${base}/${encodeKey(to)}`, { method: 'PUT', headers });
      const body = await res.text();
      if (res.status === 412) throw new ObjectChangedError(from);
      // S3 may answer 200 and still carry an <Error> in the body.
      if (res.status === 404 || /<Code>NoSuchKey<\/Code>/.test(body)) throw new ObjectMissingError(from);
      if (!res.ok || /<Error>/.test(body)) throw new Error(`copy failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    },

    async delete(key) {
      const res = await send(`${base}/${encodeKey(key)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw await failed('delete', res);
    },
  };
}
