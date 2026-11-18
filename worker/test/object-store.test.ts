import { describe, expect, it } from 'vitest';
import { createObjectStore, ObjectChangedError, ObjectMissingError } from '../src/object-store';
import type { Env } from '../src/env';

const env = {
  R2_ACCESS_KEY_ID: 'test',
  R2_SECRET_ACCESS_KEY: 'test',
  R2_ACCOUNT_ID: 'acct',
  R2_BUCKET_NAME: 'bkt',
} as Env;

type Seen = { url: string; method: string; headers: Headers };

/** A fetch that records every request it is given and answers with the next canned response. */
function fakeFetch(...answers: Response[]) {
  const seen: Seen[] = [];
  const impl: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    seen.push({ url: req.url, method: req.method, headers: req.headers });
    const next = answers.shift();
    if (!next) throw new Error('unexpected request');
    return next;
  };
  return { impl, seen };
}

const xml = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });

const listing = (contents: string, tail = '<IsTruncated>false</IsTruncated>') =>
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>${contents}${tail}</ListBucketResult>`;

const entry = (key: string, size: number, etag: string, modified: string) =>
  `<Contents><Key>${key}</Key><LastModified>${modified}</LastModified><ETag>&quot;${etag}&quot;</ETag><Size>${size}</Size></Contents>`;

describe('ObjectStore.list', () => {
  it('asks S3 for the prefix and parses keys, sizes, etags and times', async () => {
    const { impl, seen } = fakeFetch(
      xml(listing(entry('d30/a.png', 12, 'abc123', '2026-11-18T10:00:00.000Z') + entry('d30/sub/b.jpg', 3, 'def456', '2026-11-18T11:00:00.000Z'))),
    );

    const page = await createObjectStore(env, impl).list('d30/');

    expect(seen[0].method).toBe('GET');
    const url = new URL(seen[0].url);
    expect(url.origin + url.pathname).toBe('https://acct.r2.cloudflarestorage.com/bkt');
    expect(url.searchParams.get('list-type')).toBe('2');
    expect(url.searchParams.get('prefix')).toBe('d30/');
    expect(url.searchParams.get('max-keys')).toBe('1000');
    expect(url.searchParams.has('continuation-token')).toBe(false);
    expect(seen[0].headers.get('Authorization')).toMatch(/^AWS4-HMAC-SHA256/);
    expect(page).toEqual({
      objects: [
        { key: 'd30/a.png', size: 12, etag: 'abc123', uploaded: Date.parse('2026-11-18T10:00:00.000Z') },
        { key: 'd30/sub/b.jpg', size: 3, etag: 'def456', uploaded: Date.parse('2026-11-18T11:00:00.000Z') },
      ],
      next: null,
    });
  });

  it('follows a continuation token and reports the next one', async () => {
    const { impl, seen } = fakeFetch(xml(listing(entry('d30/a.png', 1, 'e1', '2026-11-18T10:00:00.000Z'), '<IsTruncated>true</IsTruncated><NextContinuationToken>tok/1+2</NextContinuationToken>')));

    const page = await createObjectStore(env, impl).list('d30/', 'prev-token');

    expect(new URL(seen[0].url).searchParams.get('continuation-token')).toBe('prev-token');
    expect(page.next).toBe('tok/1+2');
  });

  it('decodes XML entities in keys (Review Focus 2)', async () => {
    const { impl } = fakeFetch(xml(listing(entry('d30/Ảnh chụp &amp; thử &lt;1&gt; #1.png', 5, 'x', '2026-11-18T10:00:00.000Z'))));

    const page = await createObjectStore(env, impl).list('d30/');

    expect(page.objects[0].key).toBe('d30/Ảnh chụp & thử <1> #1.png');
  });

  it('throws when S3 answers with an error', async () => {
    const { impl } = fakeFetch(xml('<Error><Code>AccessDenied</Code></Error>', 403));
    await expect(createObjectStore(env, impl).list('d30/')).rejects.toThrow(/403/);
  });
});

describe('ObjectStore.copy', () => {
  it('PUTs the destination with an encoded x-amz-copy-source', async () => {
    const { impl, seen } = fakeFetch(xml('<CopyObjectResult><ETag>&quot;x&quot;</ETag></CopyObjectResult>'));

    await createObjectStore(env, impl).copy('d30/a b & ảnh.png', 'files/01ABC');

    expect(seen[0].method).toBe('PUT');
    expect(new URL(seen[0].url).pathname).toBe('/bkt/files/01ABC');
    expect(seen[0].headers.get('x-amz-copy-source')).toBe(`/bkt/${['d30', 'a b & ảnh.png'].map(encodeURIComponent).join('/')}`);
    expect(seen[0].headers.get('Authorization')).toMatch(/^AWS4-HMAC-SHA256/);
  });

  it('reports a source that is gone, as a 404 or as an Error body inside a 200', async () => {
    const gone404 = fakeFetch(xml('<Error><Code>NoSuchKey</Code></Error>', 404));
    await expect(createObjectStore(env, gone404.impl).copy('d30/a.png', 'files/X')).rejects.toBeInstanceOf(ObjectMissingError);

    const gone200 = fakeFetch(xml('<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>', 200));
    await expect(createObjectStore(env, gone200.impl).copy('d30/a.png', 'files/X')).rejects.toBeInstanceOf(ObjectMissingError);
  });

  it('sends the etag it listed as a condition, and reports a source that changed since (412)', async () => {
    const { impl, seen } = fakeFetch(xml('<CopyObjectResult/>'), xml('<Error><Code>PreconditionFailed</Code></Error>', 412));
    const store = createObjectStore(env, impl);

    await store.copy('d30/a.png', 'files/X', 'abc123');
    expect(seen[0].headers.get('x-amz-copy-source-if-match')).toBe('"abc123"');

    await expect(store.copy('d30/a.png', 'files/X', 'abc123')).rejects.toBeInstanceOf(ObjectChangedError);
  });

  it('sends no condition when no etag is given', async () => {
    const { impl, seen } = fakeFetch(xml('<CopyObjectResult/>'));
    await createObjectStore(env, impl).copy('d30/a.png', 'files/X');
    expect(seen[0].headers.has('x-amz-copy-source-if-match')).toBe(false);
  });

  it('throws on any other failure', async () => {
    const { impl } = fakeFetch(xml('<Error><Code>InternalError</Code></Error>', 500));
    await expect(createObjectStore(env, impl).copy('d30/a.png', 'files/X')).rejects.not.toBeInstanceOf(ObjectMissingError);
  });
});

describe('ObjectStore.head and delete', () => {
  it('head returns size and etag, or null when the object is gone', async () => {
    const found = fakeFetch(new Response(null, { status: 200, headers: { 'Content-Length': '42', ETag: '"abc"' } }));
    expect(await createObjectStore(env, found.impl).head('files/X')).toEqual({ size: 42, etag: 'abc' });
    expect(found.seen[0].method).toBe('HEAD');

    const missing = fakeFetch(new Response(null, { status: 404 }));
    expect(await createObjectStore(env, missing.impl).head('files/X')).toBeNull();
  });

  it('delete accepts 204 and 404, and refuses other failures', async () => {
    const ok = fakeFetch(new Response(null, { status: 204 }), new Response(null, { status: 404 }));
    const store = createObjectStore(env, ok.impl);
    await store.delete('d30/a.png');
    await store.delete('d30/a.png');
    expect(ok.seen.map((s) => s.method)).toEqual(['DELETE', 'DELETE']);
    expect(new URL(ok.seen[0].url).pathname).toBe('/bkt/d30/a.png');

    const bad = fakeFetch(new Response(null, { status: 500 }));
    await expect(createObjectStore(env, bad.impl).delete('d30/a.png')).rejects.toThrow(/500/);
  });
});
