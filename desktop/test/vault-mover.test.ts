// Task 9: moving files into and out of the encrypted Vault, and encrypting the legacy Vault files, in main (no Electron).
//
// This file is the contract for a new module, `desktop/src/main/vault-mover.ts`, with no Electron imports:
//
//   export type VaultMoverDeps = {
//     session: VaultSession;                                     // the one session of the main process
//     client(): Pick<ApiClient, 'moveIn' | 'moveInComplete' | 'moveOut' | 'moveOutComplete' | 'listEverything'>;
//     fetchImpl?: typeof fetch;                                  // presigned GET / PUT; default global fetch
//   };
//   export type MoveProgress = { done: number; total: number; current: string };   // current = id of the item
//   export type MoveResult = { done: string[]; failed: string[] };                  // ids
//   createVaultMover(deps) returns:
//     moveIn(items: FileItem[], onProgress?: (p: MoveProgress) => void): Promise<MoveResult>
//     moveOut(items: FileItem[], onProgress?): Promise<MoveResult>
//     migrateLegacy(onProgress?): Promise<MoveResult>
//
// `moveIn` takes plain (legacy) items. `moveOut` takes the RAW encrypted rows as the server lists them (`encMeta` + `encKey`
// present): the mover reads the real name/type/url from them with `session.decryptList` and the file key with `session.fileKey`.
// Items are handled one at a time, in order. A failure of one item (network, tampered data, locked Vault) puts its id in
// `failed` and never stops the rest; nothing here throws for a single item. `onProgress` is called once per item.
// `migrateLegacy` lists the Vault and the Vault trash, and moves in every item with `inVault && !encrypted`.
//
// Ruling that this file relies on (Tasks 5-8): a link has no file object. `moveIn` for a link gets `downloadUrl: null`, completes
// with `size: 0`, and still moves its thumbnail (encrypted) when the server gave a thumbnail address. `moveOut` for a link
// completes with `{ url, title, name, mime: LINK_MIME, size: 0, hasThumb: false }` and moves no file and no thumbnail.
import { describe, expect, it, vi } from 'vitest';
import {
  LINK_MIME,
  decryptBytes,
  decryptMeta,
  derivePinKeys,
  encryptBytes,
  kekFrom,
  unwrapFileKey,
  unwrapMasterKey,
  vaultCiphertextSize,
  type FileItem,
  type VaultMeta,
  type VaultMoveInComplete,
  type VaultMoveOutComplete,
  type VaultMoveUrls,
  type VaultSetupRequest,
  type VaultStatus,
} from '@fatup/shared';
import { ApiError } from '../src/main/api';
import { createVaultMover } from '../src/main/vault-mover';
import { VaultSession } from '../src/vault-session';

const ITERATIONS = 1000;
const PIN = '135792';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Just enough of the Worker for a real VaultSession to set up. */
function miniServer() {
  const state: { req: VaultSetupRequest | null } = { req: null };
  const status = (): VaultStatus =>
    state.req
      ? { state: 'ready', kdf: { salt: state.req.kdfSalt, iterations: state.req.kdfIterations }, failedAttempts: 0, lockedUntil: null, remaining: 10 }
      : { state: 'none', failedAttempts: 0, lockedUntil: null, remaining: 10 };
  const client = {
    vaultStatus: async () => status(),
    vaultSetup: async (req: VaultSetupRequest) => {
      state.req = JSON.parse(JSON.stringify(req)) as VaultSetupRequest;
    },
    vaultUnlock: async () => ({ serverSecret: state.req!.serverSecret, wrappedMkPin: state.req!.wrappedMkPin }),
    vaultRecover: async () => {
      throw new Error('not used');
    },
    vaultSetPin: async () => {
      throw new Error('not used');
    },
  };
  return { state, client };
}

/** Bytes of a request body, whatever the implementation passed to `fetch` (Uint8Array, Buffer, ArrayBuffer or Blob). */
async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof Blob !== 'undefined' && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new Error(`unsupported request body: ${Object.prototype.toString.call(body)}`);
}

type Put = { url: string; body: Uint8Array; contentLength: string | null };
type Call = { name: string; args: unknown[] };

const R2 = 'https://r2.test';
/** Where the fake Worker's presigned addresses point. `get/` is a source, `put/` a target. */
const addr = {
  plain: (id: string) => `${R2}/get/files/${id}`,
  plainThumb: (id: string) => `${R2}/get/thumbs/${id}`,
  vaultGet: (id: string) => `${R2}/get/vault/${id}`,
  vaultThumbGet: (id: string) => `${R2}/get/vault/${id}.thumb`,
  vaultPut: (id: string) => `${R2}/put/vault/${id}`,
  vaultThumbPut: (id: string) => `${R2}/put/vault/${id}.thumb`,
  plainPut: (id: string) => `${R2}/put/files/${id}`,
  plainThumbPut: (id: string) => `${R2}/put/thumbs/${id}`,
};

/** A real open session over a fake Worker (move routes) and a fake R2 (presigned GET/PUT), recording everything that leaves the process. */
async function world() {
  const server = miniServer();
  const session = new VaultSession({ client: () => server.client as never, appPinMatches: () => false, iterations: ITERATIONS });
  const setup = await session.setup(PIN);
  if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);

  const objects = new Map<string, Uint8Array>();
  const puts: Put[] = [];
  const gets: string[] = [];
  /** Everything in order: `moveIn:<id>`, `GET <url>`, `PUT <url>`, `complete:<id>`. */
  const events: string[] = [];
  const calls: Call[] = [];
  /** Per item: does it have a thumbnail, is it a link. */
  const shape = new Map<string, { thumb: boolean; link: boolean }>();
  const failGet = new Set<string>();
  /** PUT addresses that answer 500 (the object is not stored). */
  const failPut = new Set<string>();
  /** The ETag header R2 returns per stored address; `etagMode = 'none'` makes PUT answers carry no ETag header at all. */
  const etags = new Map<string, string>();
  const state = { etagMode: 'header' as 'header' | 'none', putCount: 0 };
  const failComplete = new Map<string, number>();
  /** How many times the next moveInComplete of an id answers 409 item_changed. */
  const conflictComplete = new Map<string, number>();
  /** Ids another device holds the claim of: `moveIn` answers 409 item_busy for them (spec 4.7c). */
  const busy = new Set<string>();
  /** Every claim the fake Worker handed out per id, in order. */
  const claims = new Map<string, string[]>();
  /** How many times the next moveOutComplete of an id fails with a network error. */
  const failCompleteOut = new Map<string, number>();
  const completeIn = new Map<string, VaultMoveInComplete[]>();
  const completeOut = new Map<string, VaultMoveOutComplete[]>();

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'PUT') {
      events.push(`PUT ${url}`);
      const body = await bodyBytes(init?.body);
      puts.push({ url, body, contentLength: new Headers(init?.headers).get('content-length') });
      if (failPut.has(url)) return new Response('boom', { status: 500 });
      objects.set(url, body);
      // R2 answers a PUT with the object's ETag (quoted); the Vault move-in has to send it back to the Worker.
      const etag = `"etag-${++state.putCount}-${body.length}"`;
      etags.set(url, etag);
      return new Response(null, { status: 200, headers: state.etagMode === 'header' ? { ETag: etag } : {} });
    }
    events.push(`GET ${url}`);
    gets.push(url);
    if (failGet.has(url)) return new Response('boom', { status: 500 });
    const found = objects.get(url);
    return found ? new Response(found as unknown as BodyInit) : new Response('missing', { status: 404 });
  });

  const record = <T>(name: string, args: unknown[], make: () => T): T => {
    calls.push({ name, args: JSON.parse(JSON.stringify(args)) as unknown[] });
    return make();
  };
  const row = (id: string): FileItem => ({
    id,
    name: '',
    mime: 'application/octet-stream',
    size: 0,
    kind: 'file',
    thumbUrl: null,
    device: 'pc',
    createdAt: 1_700_000_000_000,
    deletedAt: null,
    inVault: true,
    tags: [],
    url: null,
    site: null,
    previewed: false,
  });
  const listed = { live: [] as FileItem[], trash: [] as FileItem[] };
  const client = {
    moveIn: vi.fn(async (id: string): Promise<VaultMoveUrls> => {
      events.push(`moveIn:${id}`);
      return record('moveIn', [id], () => {
        if (busy.has(id)) throw new ApiError('item_busy', 'Another device is moving this item', 409, { error: { code: 'item_busy', message: 'busy' } });
        const s = shape.get(id) ?? { thumb: false, link: false };
        // The Worker gives every successful vault/in a fresh claim (a random token); the fake numbers them.
        const claim = `claim-${id}-${(claims.get(id)?.length ?? 0) + 1}-AAAAAAAAAAAA`;
        claims.set(id, [...(claims.get(id) ?? []), claim]);
        return {
          uploadUrl: addr.vaultPut(id),
          thumbUploadUrl: s.thumb ? addr.vaultThumbPut(id) : null,
          downloadUrl: s.link ? null : addr.plain(id),
          thumbUrl: s.thumb ? addr.plainThumb(id) : null,
          claim,
        };
      });
    }),
    moveInComplete: vi.fn(async (id: string, req: VaultMoveInComplete) => {
      events.push(`complete:${id}`);
      record('moveInComplete', [id, req], () => undefined);
      completeIn.set(id, [...(completeIn.get(id) ?? []), req]);
      const left = failComplete.get(id) ?? 0;
      if (left > 0) {
        failComplete.set(id, left - 1);
        throw new ApiError('network', 'connection reset');
      }
      const conflicts = conflictComplete.get(id) ?? 0;
      if (conflicts > 0) {
        conflictComplete.set(id, conflicts - 1);
        throw new ApiError('item_changed', 'The item changed', 409, { error: 'item_changed' });
      }
      return row(id);
    }),
    moveOut: vi.fn(async (id: string): Promise<VaultMoveUrls> => {
      events.push(`moveOut:${id}`);
      return record('moveOut', [id], () => {
        const s = shape.get(id) ?? { thumb: false, link: false };
        return {
          uploadUrl: addr.plainPut(id),
          thumbUploadUrl: s.thumb && !s.link ? addr.plainThumbPut(id) : null,
          downloadUrl: s.link ? null : addr.vaultGet(id),
          thumbUrl: s.thumb && !s.link ? addr.vaultThumbGet(id) : null,
        };
      });
    }),
    moveOutComplete: vi.fn(async (id: string, req: VaultMoveOutComplete) => {
      events.push(`complete:${id}`);
      record('moveOutComplete', [id, req], () => undefined);
      completeOut.set(id, [...(completeOut.get(id) ?? []), req]);
      const left = failCompleteOut.get(id) ?? 0;
      if (left > 0) {
        failCompleteOut.set(id, left - 1);
        throw new ApiError('network', 'connection reset');
      }
      return row(id);
    }),
    listEverything: vi.fn(async (opts: { trash?: boolean; vault?: boolean } = {}) => (opts.trash ? listed.trash : listed.live).map((r) => ({ ...r }))),
  };
  const mover = createVaultMover({ session, client: () => client, fetchImpl: fetchImpl as unknown as typeof fetch });

  /** The master key, derived from what the server stores, to open `encMeta` and `encKey` the way only the owner can. */
  async function masterKey() {
    const req = server.state.req!;
    const { wrapBase } = await derivePinKeys(PIN, req.kdfSalt, req.kdfIterations);
    return unwrapMasterKey(req.wrappedMkPin, await kekFrom(wrapBase, req.serverSecret));
  }

  /** A legacy (not encrypted) Vault item with its plain object (and thumbnail) in the fake R2. */
  function legacy(id: string, over: Partial<FileItem> = {}, plain: Uint8Array | null = enc(`plain bytes of ${id}`), thumb: Uint8Array | null = null): FileItem {
    const link = over.kind === 'link';
    shape.set(id, { thumb: thumb !== null, link });
    if (plain && !link) objects.set(addr.plain(id), plain);
    if (thumb) objects.set(addr.plainThumb(id), thumb);
    return { ...row(id), name: `${id}.txt`, mime: 'text/plain', size: plain?.length ?? 0, encrypted: false, ...over };
  }

  /** An encrypted Vault item as the server lists it: ciphertext objects in the fake R2, `encMeta`/`encKey` on the row. */
  async function sealed(id: string, meta: VaultMeta, plain: Uint8Array, opts: { thumb?: Uint8Array; tamper?: boolean } = {}): Promise<FileItem> {
    const { encMeta, encKey, dek } = await session.encryptMetaFor(meta);
    const cipher = await encryptBytes(plain, dek);
    if (opts.tamper) cipher[cipher.length - 1] ^= 1;
    shape.set(id, { thumb: opts.thumb !== undefined, link: meta.kind === 'link' });
    if (meta.kind !== 'link') objects.set(addr.vaultGet(id), cipher);
    if (opts.thumb) objects.set(addr.vaultThumbGet(id), await encryptBytes(opts.thumb, dek));
    // `thumbUrl` is the (presigned) address of the encrypted thumbnail, as the server lists it.
    return { ...row(id), size: cipher.length, thumbUrl: opts.thumb ? addr.vaultThumbGet(id) : null, encrypted: true, encMeta, encKey };
  }

  return {
    server, session, mover, client, fetchImpl, objects, puts, gets, events, calls, failGet, failPut, etags, state, failComplete, conflictComplete, busy, claims,
    failCompleteOut, completeIn, completeOut, listed, masterKey, legacy, sealed,
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** The file key an item carrying `encKey` has, as the owner of the Vault derives it. */
async function keyOf(w: World, encKey: string) {
  return unwrapFileKey(encKey, await w.masterKey());
}

const PDF = enc('%PDF contents of the lease agreement');
const THUMB = enc('jpeg bytes of a thumbnail');
const LINK_URL = 'https://example.com/trang?q=tiếng+Việt';

describe('moveIn: a plain Vault file becomes an encrypted one', () => {
  it('downloads the plain file, uploads its ciphertext and completes with metadata only the Vault key opens', async () => {
    const w = await world();
    const item = w.legacy('A', { name: 'Hợp đồng thuê nhà.pdf', mime: 'application/pdf', kind: 'file' }, PDF);
    const res = await w.mover.moveIn([item]);
    expect(res).toEqual({ done: ['A'], failed: [] });

    expect(w.puts.map((p) => p.url)).toEqual([addr.vaultPut('A')]);
    const [req] = w.completeIn.get('A')!;
    expect(req.hasThumb).toBe(false);

    const meta = await decryptMeta(req.encMeta, await w.masterKey());
    expect(meta).toMatchObject({ name: 'Hợp đồng thuê nhà.pdf', mime: 'application/pdf', kind: 'file' });

    const cipher = w.puts[0].body;
    expect(dec(cipher.subarray(0, 4))).toBe('FUV1');
    expect(same(await decryptBytes(cipher, await keyOf(w, req.encKey)), PDF)).toBe(true);
  });

  it('reports the ciphertext size (vaultCiphertextSize) and sends Content-Length equal to it', async () => {
    const w = await world();
    const item = w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF);
    await w.mover.moveIn([item]);
    const [req] = w.completeIn.get('A')!;
    expect(req.size).toBe(vaultCiphertextSize(PDF.length));
    expect(req.size).toBe(w.puts[0].body.length);
    expect(w.puts[0].contentLength).toBe(String(w.puts[0].body.length));
  });

  it('moves an image together with its thumbnail, encrypted under the same file key', async () => {
    const w = await world();
    const item = w.legacy('P', { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' }, enc('jpeg of a photo'), THUMB);
    expect(await w.mover.moveIn([item])).toEqual({ done: ['P'], failed: [] });

    const [req] = w.completeIn.get('P')!;
    expect(req.hasThumb).toBe(true);
    const thumbPut = w.puts.find((p) => p.url === addr.vaultThumbPut('P'))!;
    expect(thumbPut).toBeTruthy();
    expect(thumbPut.contentLength).toBe(String(thumbPut.body.length));
    expect(thumbPut.body.length).toBe(vaultCiphertextSize(THUMB.length));
    const dek = await keyOf(w, req.encKey);
    expect(same(await decryptBytes(thumbPut.body, dek), THUMB)).toBe(true);
    expect(await decryptMeta(req.encMeta, await w.masterKey())).toMatchObject({ name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' });
  });

  it('sends no plain name, link or title to the API, in any body or address', async () => {
    const w = await world();
    const file = w.legacy('A', { name: 'Hợp đồng thuê nhà.pdf', mime: 'application/pdf' }, PDF);
    const link = w.legacy('L', { kind: 'link', mime: LINK_MIME, name: 'Trang chủ bí mật', url: LINK_URL, size: 0 }, null);
    await w.mover.moveIn([file, link]);
    const wire = JSON.stringify(w.calls) + w.events.join('\n');
    for (const secret of ['Hợp đồng', 'thuê nhà', 'Trang chủ', 'bí mật', 'example.com', 'tiếng', 'application/pdf']) {
      expect(wire).not.toContain(secret);
    }
    // And the bytes that do leave are ciphertext, not the contents.
    for (const p of w.puts) expect(dec(p.body)).not.toContain('lease agreement');
  });

  it('moves a link without downloading or uploading any file: size 0, metadata carries the address and title', async () => {
    const w = await world();
    const link = w.legacy('L', { kind: 'link', mime: LINK_MIME, name: 'Trang chủ', url: LINK_URL, size: 0 }, null);
    expect(await w.mover.moveIn([link])).toEqual({ done: ['L'], failed: [] });
    expect(w.fetchImpl).not.toHaveBeenCalled();
    const [req] = w.completeIn.get('L')!;
    expect(req).toMatchObject({ size: 0, hasThumb: false });
    expect(await decryptMeta(req.encMeta, await w.masterKey())).toMatchObject({
      kind: 'link',
      url: LINK_URL,
      title: 'Trang chủ',
      name: 'Trang chủ',
      mime: LINK_MIME,
    });
  });

  it('still moves the encrypted thumbnail of a link that has a picture', async () => {
    const w = await world();
    const link = w.legacy('L', { kind: 'link', mime: LINK_MIME, name: 'Trang chủ', url: LINK_URL, size: 0 }, null, THUMB);
    expect(await w.mover.moveIn([link])).toEqual({ done: ['L'], failed: [] });
    expect(w.gets).toEqual([addr.plainThumb('L')]);
    expect(w.puts.map((p) => p.url)).toEqual([addr.vaultThumbPut('L')]);
    const [req] = w.completeIn.get('L')!;
    expect(req).toMatchObject({ size: 0, hasThumb: true });
    expect(same(await decryptBytes(w.puts[0].body, await keyOf(w, req.encKey)), THUMB)).toBe(true);
  });

  it('handles an empty file', async () => {
    const w = await world();
    const item = w.legacy('E', { name: 'empty.txt', size: 0 }, new Uint8Array(0));
    expect(await w.mover.moveIn([item])).toEqual({ done: ['E'], failed: [] });
    const [req] = w.completeIn.get('E')!;
    expect(req.size).toBe(vaultCiphertextSize(0));
    expect((await decryptBytes(w.puts[0].body, await keyOf(w, req.encKey))).length).toBe(0);
  });

  it('works one file at a time, in order, and completes only after its upload', async () => {
    const w = await world();
    const a = w.legacy('A', { name: 'a.txt' });
    const b = w.legacy('B', { name: 'b.txt' });
    await w.mover.moveIn([a, b]);
    expect(w.events).toEqual([
      'moveIn:A',
      `GET ${addr.plain('A')}`,
      `PUT ${addr.vaultPut('A')}`,
      'complete:A',
      'moveIn:B',
      `GET ${addr.plain('B')}`,
      `PUT ${addr.vaultPut('B')}`,
      'complete:B',
    ]);
  });

  it('gives each file its own key', async () => {
    const w = await world();
    await w.mover.moveIn([w.legacy('A'), w.legacy('B')]);
    expect(w.completeIn.get('A')![0].encKey).not.toBe(w.completeIn.get('B')![0].encKey);
  });

  it('puts a file whose download fails in failed and still moves the next one', async () => {
    const w = await world();
    const a = w.legacy('A');
    const b = w.legacy('B');
    w.failGet.add(addr.plain('A'));
    const res = await w.mover.moveIn([a, b]);
    expect(res).toEqual({ done: ['B'], failed: ['A'] });
    expect(w.completeIn.has('A')).toBe(false);
    expect(w.puts.map((p) => p.url)).toEqual([addr.vaultPut('B')]);
  });

  it('puts a file whose server call fails in failed and still moves the next one', async () => {
    const w = await world();
    w.client.moveIn.mockRejectedValueOnce(new ApiError('network', 'down'));
    const res = await w.mover.moveIn([w.legacy('A'), w.legacy('B')]);
    expect(res).toEqual({ done: ['B'], failed: ['A'] });
  });

  it('fails every item with no network call while the Vault is closed', async () => {
    const w = await world();
    const items = [w.legacy('A'), w.legacy('B')];
    w.session.close();
    const res = await w.mover.moveIn(items);
    expect(res).toEqual({ done: [], failed: ['A', 'B'] });
    expect(w.client.moveIn).not.toHaveBeenCalled();
    expect(w.client.moveInComplete).not.toHaveBeenCalled();
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it('can be run again for a file interrupted between the upload and the completion', async () => {
    const w = await world();
    const item = w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF);
    w.failComplete.set('A', 1);

    const first = await w.mover.moveIn([item]);
    expect(first).toEqual({ done: [], failed: ['A'] });
    expect(w.puts).toHaveLength(1); // the upload had happened

    const second = await w.mover.moveIn([item]);
    expect(second).toEqual({ done: ['A'], failed: [] });
    expect(w.puts.map((p) => p.url)).toEqual([addr.vaultPut('A'), addr.vaultPut('A')]); // overwritten
    expect(w.completeIn.get('A')).toHaveLength(2);

    // What is stored is what the last completion's key opens.
    const [, last] = w.completeIn.get('A')!;
    const stored = w.objects.get(addr.vaultPut('A'))!;
    expect(same(await decryptBytes(stored, await keyOf(w, last.encKey)), PDF)).toBe(true);
    expect(last.size).toBe(stored.length);
  });

  it('reports progress once per item, with the total and the item', async () => {
    const w = await world();
    const items = [w.legacy('A'), w.legacy('B'), w.legacy('C')];
    w.failGet.add(addr.plain('B'));
    const onProgress = vi.fn();
    await w.mover.moveIn(items, onProgress);
    const seen = onProgress.mock.calls.map(([p]) => p as { done: number; total: number; current: string });
    expect(seen).toHaveLength(3);
    expect(seen.map((p) => p.total)).toEqual([3, 3, 3]);
    expect(seen.map((p) => p.current)).toEqual(['A', 'B', 'C']);
    expect(seen.map((p) => p.done)).toEqual([...seen.map((p) => p.done)].sort((x, y) => x - y));
    for (const p of seen) expect(p.done).toBeLessThanOrEqual(3);
  });

  it('works without a progress callback and with no items', async () => {
    const w = await world();
    expect(await w.mover.moveIn([])).toEqual({ done: [], failed: [] });
    expect(w.client.moveIn).not.toHaveBeenCalled();
  });
});

describe('moveIn: the ETag of the stored ciphertext goes back to the Worker (review C1)', () => {
  // Two devices moving the same file in at once would otherwise leave the row with one device's key over the other's ciphertext.
  // The Worker compares the etag with what is stored at vault/<id>; the client must send the one R2 answered for ITS PUT.
  it('sends the ETag header of the PUT of vault/<id> as `etag`, verbatim', async () => {
    const w = await world();
    const item = w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF);
    expect(await w.mover.moveIn([item])).toEqual({ done: ['A'], failed: [] });
    const [req] = w.completeIn.get('A')!;
    expect(w.etags.get(addr.vaultPut('A'))).toMatch(/^"etag-/); // the fake did answer a quoted ETag
    expect(req.etag).toBe(w.etags.get(addr.vaultPut('A')));
  });

  it('keeps the quotes and any weak prefix of the header exactly as R2 wrote it', async () => {
    const w = await world();
    const item = w.legacy('A', { name: 'a.pdf' });
    w.fetchImpl.mockImplementationOnce(async () => new Response(enc('x'))); // the download
    w.fetchImpl.mockImplementationOnce(async () => new Response(null, { status: 200, headers: { ETag: 'W/"abc123"' } })); // the PUT
    expect(await w.mover.moveIn([item])).toEqual({ done: ['A'], failed: [] });
    expect(w.completeIn.get('A')![0].etag).toBe('W/"abc123"');
  });

  it('sends the etag of the file, not the one of its thumbnail', async () => {
    const w = await world();
    const item = w.legacy('P', { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' }, enc('jpeg of a photo'), THUMB);
    expect(await w.mover.moveIn([item])).toEqual({ done: ['P'], failed: [] });
    const fileEtag = w.etags.get(addr.vaultPut('P'));
    const thumbEtag = w.etags.get(addr.vaultThumbPut('P'));
    expect(fileEtag).toBeTruthy();
    expect(thumbEtag).toBeTruthy();
    expect(fileEtag).not.toBe(thumbEtag);
    expect(w.completeIn.get('P')![0].etag).toBe(fileEtag);
  });

  it('fails the item without calling complete when the PUT answer has no ETag header', async () => {
    const w = await world();
    w.state.etagMode = 'none';
    const res = await w.mover.moveIn([w.legacy('A'), w.legacy('B')]);
    expect(res).toEqual({ done: [], failed: ['A', 'B'] });
    expect(w.puts).toHaveLength(2); // both were uploaded...
    expect(w.client.moveInComplete).not.toHaveBeenCalled(); // ...but nothing is claimed without the proof
  });

  it('sends no etag for a link, which has no file to PUT (its thumbnail PUT does not count)', async () => {
    const w = await world();
    const bare = w.legacy('L1', { kind: 'link', mime: LINK_MIME, name: 'Trang chủ', url: LINK_URL, size: 0 }, null);
    const pictured = w.legacy('L2', { kind: 'link', mime: LINK_MIME, name: 'Trang hai', url: LINK_URL, size: 0 }, null, THUMB);
    expect(await w.mover.moveIn([bare, pictured])).toEqual({ done: ['L1', 'L2'], failed: [] });
    expect(w.completeIn.get('L1')![0].etag).toBeUndefined();
    expect(w.completeIn.get('L2')![0].etag).toBeUndefined();
  });

  it('a link still moves in when the storage answers its thumbnail PUT without an ETag', async () => {
    const w = await world();
    w.state.etagMode = 'none';
    const pictured = w.legacy('L', { kind: 'link', mime: LINK_MIME, name: 'Trang', url: LINK_URL, size: 0 }, null, THUMB);
    expect(await w.mover.moveIn([pictured])).toEqual({ done: ['L'], failed: [] });
  });

  it('migrateLegacy sends the etag too', async () => {
    const w = await world();
    w.listed.live = [w.legacy('A', { name: 'a.txt' })];
    expect(await w.mover.migrateLegacy()).toEqual({ done: ['A'], failed: [] });
    expect(w.completeIn.get('A')![0].etag).toBe(w.etags.get(addr.vaultPut('A')));
  });

  describe('409 item_changed from complete', () => {
    it('retries the item once from scratch: a new file key, a new PUT, and a complete with the NEW etag', async () => {
      const w = await world();
      const item = w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF);
      w.conflictComplete.set('A', 1);
      expect(await w.mover.moveIn([item])).toEqual({ done: ['A'], failed: [] });

      expect(w.client.moveIn).toHaveBeenCalledTimes(2);
      expect(w.puts.map((p) => p.url)).toEqual([addr.vaultPut('A'), addr.vaultPut('A')]);
      const [first, second] = w.completeIn.get('A')!;
      expect(second.encKey).not.toBe(first.encKey);
      expect(first.etag).toBeTruthy();
      expect(second.etag).not.toBe(first.etag);
      expect(second.etag).toBe(w.etags.get(addr.vaultPut('A'))); // the etag of the LAST PUT

      // What is stored is what the last completion's key opens.
      const stored = w.objects.get(addr.vaultPut('A'))!;
      expect(same(await decryptBytes(stored, await keyOf(w, second.encKey)), PDF)).toBe(true);
      expect(second.size).toBe(stored.length);
    });

    it('puts the item in failed after a second 409, with no third attempt, and goes on to the next item', async () => {
      const w = await world();
      w.conflictComplete.set('A', 2);
      const res = await w.mover.moveIn([w.legacy('A'), w.legacy('B')]);
      expect(res).toEqual({ done: ['B'], failed: ['A'] });
      expect(w.completeIn.get('A')).toHaveLength(2);
      expect(w.client.moveIn.mock.calls.filter(([id]) => id === 'A')).toHaveLength(2);
    });

    it('does not retry other failures of complete (the run can be repeated later)', async () => {
      const w = await world();
      w.failComplete.set('A', 1);
      expect(await w.mover.moveIn([w.legacy('A')])).toEqual({ done: [], failed: ['A'] });
      expect(w.completeIn.get('A')).toHaveLength(1);
      expect(w.client.moveIn).toHaveBeenCalledTimes(1);
    });

    it('counts the retried item once in the progress', async () => {
      const w = await world();
      w.conflictComplete.set('A', 1);
      const onProgress = vi.fn();
      await w.mover.moveIn([w.legacy('A'), w.legacy('B')], onProgress);
      expect(onProgress.mock.calls.map(([p]) => [p.done, p.total, p.current])).toEqual([
        [1, 2, 'A'],
        [2, 2, 'B'],
      ]);
    });
  });
});

describe('moveIn: the claim of vault/in goes back with the completion (spec 4.7c, review N1)', () => {
  // vault/in gives one device at a time the right to write vault/<id>; complete only counts with that claim.
  it('sends the claim vault/in handed out with moveInComplete, for a file', async () => {
    const w = await world();
    expect(await w.mover.moveIn([w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF)])).toEqual({ done: ['A'], failed: [] });
    expect(w.claims.get('A')).toHaveLength(1);
    expect(w.completeIn.get('A')![0].claim).toBe(w.claims.get('A')![0]);
  });

  it('sends the claim for a link too (a link goes through vault/in), and still sends no etag', async () => {
    const w = await world();
    const link = w.legacy('L', { kind: 'link', mime: LINK_MIME, name: 'Trang', url: LINK_URL, size: 0 }, null);
    expect(await w.mover.moveIn([link])).toEqual({ done: ['L'], failed: [] });
    expect(w.completeIn.get('L')![0].claim).toBe(w.claims.get('L')![0]);
    expect(w.completeIn.get('L')![0].etag).toBeUndefined();
  });

  it('sends each item its own claim', async () => {
    const w = await world();
    await w.mover.moveIn([w.legacy('A'), w.legacy('B')]);
    expect(w.completeIn.get('A')![0].claim).toBe(w.claims.get('A')![0]);
    expect(w.completeIn.get('B')![0].claim).toBe(w.claims.get('B')![0]);
    expect(w.completeIn.get('A')![0].claim).not.toBe(w.completeIn.get('B')![0].claim);
  });

  it('migrateLegacy sends the claim too', async () => {
    const w = await world();
    w.listed.live = [w.legacy('A', { name: 'a.txt' })];
    expect(await w.mover.migrateLegacy()).toEqual({ done: ['A'], failed: [] });
    expect(w.completeIn.get('A')![0].claim).toBe(w.claims.get('A')![0]);
  });

  it('moveOutIds sends the claim when it has to encrypt a legacy item first', async () => {
    const w = await world();
    const plain = w.legacy('A', { name: 'a.txt' });
    w.listed.live = [plain];
    // After the move in, the list shows the item encrypted, so it can go out.
    w.client.listEverything.mockImplementation(async () => {
      if (!w.completeIn.has('A')) return [{ ...plain }];
      return [await w.sealed('A', { name: 'a.txt', mime: 'text/plain', kind: 'file' }, enc('x'))];
    });
    await w.mover.moveOutIds(['A'], () => undefined);
    expect(w.completeIn.get('A')![0].claim).toBe(w.claims.get('A')![0]);
  });

  describe('409 item_busy from vault/in: another device is moving the item', () => {
    it('puts the item in failed, without any download or upload, and without a retry', async () => {
      const w = await world();
      w.busy.add('A');
      expect(await w.mover.moveIn([w.legacy('A')])).toEqual({ done: [], failed: ['A'] });
      expect(w.client.moveIn).toHaveBeenCalledTimes(1);
      expect(w.fetchImpl).not.toHaveBeenCalled();
      expect(w.client.moveInComplete).not.toHaveBeenCalled();
    });

    it('still moves the next item', async () => {
      const w = await world();
      w.busy.add('A');
      const res = await w.mover.moveIn([w.legacy('A'), w.legacy('B')]);
      expect(res).toEqual({ done: ['B'], failed: ['A'] });
      expect(w.completeIn.get('B')![0].claim).toBe(w.claims.get('B')![0]);
      expect(w.puts.map((p) => p.url)).toEqual([addr.vaultPut('B')]);
    });

    it('does the same for a link', async () => {
      const w = await world();
      w.busy.add('L');
      const link = w.legacy('L', { kind: 'link', mime: LINK_MIME, name: 'Trang', url: LINK_URL, size: 0 }, null);
      expect(await w.mover.moveIn([link])).toEqual({ done: [], failed: ['L'] });
      expect(w.client.moveIn).toHaveBeenCalledTimes(1);
      expect(w.client.moveInComplete).not.toHaveBeenCalled();
    });

    it('migrateLegacy reports the busy item as failed and migrates the others', async () => {
      const w = await world();
      w.busy.add('A');
      w.listed.live = [w.legacy('A'), w.legacy('B')];
      expect(await w.mover.migrateLegacy()).toEqual({ done: ['B'], failed: ['A'] });
      expect(w.client.moveIn.mock.calls.filter(([id]) => id === 'A')).toHaveLength(1);
      expect(w.fetchImpl.mock.calls.some(([u]) => String(u).includes('/files/A'))).toBe(false);
    });

    it('moveOutIds reports a busy legacy item as failed and does not try to move it out', async () => {
      const w = await world();
      w.busy.add('A');
      const plain = w.legacy('A', { name: 'a.txt' });
      w.listed.live = [plain];
      expect(await w.mover.moveOutIds(['A'], () => undefined)).toEqual({ done: [], failed: ['A'] });
      expect(w.client.moveOut).not.toHaveBeenCalled();
      expect(w.client.moveIn).toHaveBeenCalledTimes(1);
    });
  });

  describe('409 item_changed from complete: the retry asks vault/in again', () => {
    it('completes the retry with the NEW claim, not the first one', async () => {
      const w = await world();
      w.conflictComplete.set('A', 1);
      expect(await w.mover.moveIn([w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF)])).toEqual({ done: ['A'], failed: [] });
      expect(w.client.moveIn).toHaveBeenCalledTimes(2);
      const [first, second] = w.completeIn.get('A')!;
      const [claim1, claim2] = w.claims.get('A')!;
      expect(claim1).not.toBe(claim2);
      expect(first.claim).toBe(claim1);
      expect(second.claim).toBe(claim2);
    });

    it('puts the item in failed when the retry meets item_busy, and tries nothing more', async () => {
      const w = await world();
      w.conflictComplete.set('A', 1);
      let calls = 0;
      const original = w.client.moveIn.getMockImplementation()!;
      w.client.moveIn.mockImplementation(async (id: string) => {
        if (++calls === 2) throw new ApiError('item_busy', 'busy', 409, { error: { code: 'item_busy', message: 'busy' } });
        return original(id);
      });
      expect(await w.mover.moveIn([w.legacy('A'), w.legacy('B')])).toEqual({ done: ['B'], failed: ['A'] });
      expect(w.client.moveIn.mock.calls.filter(([id]) => id === 'A')).toHaveLength(2);
      expect(w.completeIn.get('A')).toHaveLength(1);
    });
  });
});

describe('moveOut: an encrypted Vault file becomes a plain one', () => {
  it('downloads the ciphertext, uploads the plain bytes and completes with the real name, type and size', async () => {
    const w = await world();
    const item = await w.sealed('A', { name: 'Hợp đồng thuê nhà.pdf', mime: 'application/pdf', kind: 'file' }, PDF);
    expect(await w.mover.moveOut([item])).toEqual({ done: ['A'], failed: [] });

    expect(w.puts.map((p) => p.url)).toEqual([addr.plainPut('A')]);
    expect(same(w.puts[0].body, PDF)).toBe(true);
    expect(w.puts[0].contentLength).toBe(String(PDF.length));
    expect(w.completeOut.get('A')).toEqual([{ name: 'Hợp đồng thuê nhà.pdf', mime: 'application/pdf', size: PDF.length, hasThumb: false }]);
  });

  it('moves the decrypted thumbnail of an image back as a plain thumbnail', async () => {
    const w = await world();
    const item = await w.sealed('P', { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' }, enc('jpeg of a photo'), { thumb: THUMB });
    expect(await w.mover.moveOut([item])).toEqual({ done: ['P'], failed: [] });
    const thumbPut = w.puts.find((p) => p.url === addr.plainThumbPut('P'))!;
    expect(thumbPut).toBeTruthy();
    expect(same(thumbPut.body, THUMB)).toBe(true);
    expect(w.completeOut.get('P')![0]).toMatchObject({ name: 'photo.jpg', mime: 'image/jpeg', hasThumb: true });
  });

  it('moves a link out without any file or thumbnail: its address and title are sent back, size 0, no picture', async () => {
    const w = await world();
    const item = await w.sealed('L', { name: 'Trang chủ', title: 'Trang chủ', mime: LINK_MIME, kind: 'link', url: LINK_URL }, new Uint8Array(0));
    expect(await w.mover.moveOut([item])).toEqual({ done: ['L'], failed: [] });
    expect(w.fetchImpl).not.toHaveBeenCalled();
    expect(w.completeOut.get('L')).toEqual([{ url: LINK_URL, title: 'Trang chủ', name: 'Trang chủ', mime: LINK_MIME, size: 0, hasThumb: false }]);
  });

  it('fails a file whose ciphertext was modified, and uploads nothing', async () => {
    const w = await world();
    const bad = await w.sealed('A', { name: 'a.pdf', mime: 'application/pdf', kind: 'file' }, PDF, { tamper: true });
    const good = await w.sealed('B', { name: 'b.pdf', mime: 'application/pdf', kind: 'file' }, PDF);
    const res = await w.mover.moveOut([bad, good]);
    expect(res).toEqual({ done: ['B'], failed: ['A'] });
    expect(w.puts.map((p) => p.url)).toEqual([addr.plainPut('B')]);
    expect(w.completeOut.has('A')).toBe(false);
  });

  it('fails a file whose download fails and still moves the next one', async () => {
    const w = await world();
    const a = await w.sealed('A', { name: 'a.pdf', mime: 'application/pdf', kind: 'file' }, PDF);
    const b = await w.sealed('B', { name: 'b.pdf', mime: 'application/pdf', kind: 'file' }, PDF);
    w.failGet.add(addr.vaultGet('A'));
    expect(await w.mover.moveOut([a, b])).toEqual({ done: ['B'], failed: ['A'] });
  });

  it('fails every item with no network call while the Vault is closed', async () => {
    const w = await world();
    const items = [await w.sealed('A', { name: 'a.pdf', mime: 'application/pdf', kind: 'file' }, PDF)];
    w.session.close();
    expect(await w.mover.moveOut(items)).toEqual({ done: [], failed: ['A'] });
    expect(w.client.moveOut).not.toHaveBeenCalled();
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it('fails an item that is not encrypted, and does not touch the network for it', async () => {
    const w = await world();
    const plain = w.legacy('A');
    expect(await w.mover.moveOut([plain])).toEqual({ done: [], failed: ['A'] });
    expect(w.puts).toHaveLength(0);
  });

  it('reports progress once per item', async () => {
    const w = await world();
    const a = await w.sealed('A', { name: 'a.pdf', mime: 'application/pdf', kind: 'file' }, PDF);
    const b = await w.sealed('B', { name: 'b.pdf', mime: 'application/pdf', kind: 'file' }, PDF, { tamper: true });
    const onProgress = vi.fn();
    await w.mover.moveOut([a, b], onProgress);
    const seen = onProgress.mock.calls.map(([p]) => p as { done: number; total: number; current: string });
    expect(seen.map((p) => [p.total, p.current])).toEqual([
      [2, 'A'],
      [2, 'B'],
    ]);
  });
});

describe('moveOut: a move interrupted after the plain upload cleans up (review C3)', () => {
  // The plain object in files/<id> is readable with the API token. When a move out fails after it was written, the item is still
  // encrypted in D1, so the client asks the Worker's idempotent move-in branch (same encMeta/encKey, no etag) to sweep the plain copies.
  const pdfMeta: VaultMeta = { name: 'a.pdf', mime: 'application/pdf', kind: 'file' };
  const cleanups = (w: World, id: string) => w.calls.filter((c) => c.name === 'moveInComplete' && c.args[0] === id);

  it('after a failed moveOutComplete, calls moveInComplete with the row\'s own encMeta, encKey and size, and no etag', async () => {
    const w = await world();
    const item = await w.sealed('A', pdfMeta, PDF);
    w.failCompleteOut.set('A', 1);
    expect(await w.mover.moveOut([item])).toEqual({ done: [], failed: ['A'] });

    expect(w.puts.map((p) => p.url)).toEqual([addr.plainPut('A')]); // the plain copy was written
    expect(w.completeIn.get('A')).toEqual([{ encMeta: item.encMeta, encKey: item.encKey, size: item.size, hasThumb: false }]);
    expect(w.completeIn.get('A')![0]).not.toHaveProperty('etag');
    expect(w.completeIn.get('A')![0]).not.toHaveProperty('claim'); // an already encrypted row: no claim to send (spec 4.7c)
    expect(w.claims.get('A')).toBeUndefined(); // and the move out never asked vault/in for one
    // The cleanup comes after the failed completion.
    expect(w.calls.filter((c) => c.args[0] === 'A').map((c) => c.name)).toEqual(['moveOut', 'moveOutComplete', 'moveInComplete']);
  });

  it('sets hasThumb to whether the item has an encrypted thumbnail', async () => {
    const w = await world();
    const item = await w.sealed('P', { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' }, enc('jpeg of a photo'), { thumb: THUMB });
    w.failCompleteOut.set('P', 1);
    expect(await w.mover.moveOut([item])).toEqual({ done: [], failed: ['P'] });
    expect(w.completeIn.get('P')).toEqual([{ encMeta: item.encMeta, encKey: item.encKey, size: item.size, hasThumb: true }]);
  });

  it('cleans up when the thumbnail PUT fails after the file PUT, and never completes the move out', async () => {
    const w = await world();
    const item = await w.sealed('P', { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' }, enc('jpeg of a photo'), { thumb: THUMB });
    w.failPut.add(addr.plainThumbPut('P'));
    expect(await w.mover.moveOut([item])).toEqual({ done: [], failed: ['P'] });
    expect(w.client.moveOutComplete).not.toHaveBeenCalled();
    expect(w.completeIn.get('P')).toEqual([{ encMeta: item.encMeta, encKey: item.encKey, size: item.size, hasThumb: true }]);
  });

  it('swallows a failing cleanup call: the item is in failed, nothing is thrown, the next item still moves out', async () => {
    const w = await world();
    const a = await w.sealed('A', pdfMeta, PDF);
    const b = await w.sealed('B', { ...pdfMeta, name: 'b.pdf' }, PDF);
    w.failCompleteOut.set('A', 1);
    w.failComplete.set('A', 1); // the cleanup call (moveInComplete) fails as well
    await expect(w.mover.moveOut([a, b])).resolves.toEqual({ done: ['B'], failed: ['A'] });
    expect(cleanups(w, 'A')).toHaveLength(1); // tried once, not retried
  });

  it('does not clean up when the item moved out fine', async () => {
    const w = await world();
    const item = await w.sealed('A', pdfMeta, PDF);
    expect(await w.mover.moveOut([item])).toEqual({ done: ['A'], failed: [] });
    expect(w.client.moveInComplete).not.toHaveBeenCalled();
  });

  describe('no cleanup while nothing plain was written', () => {
    it('for a file whose ciphertext was modified', async () => {
      const w = await world();
      const bad = await w.sealed('A', pdfMeta, PDF, { tamper: true });
      expect(await w.mover.moveOut([bad])).toEqual({ done: [], failed: ['A'] });
      expect(w.client.moveInComplete).not.toHaveBeenCalled();
    });

    it('for a file whose download fails', async () => {
      const w = await world();
      const item = await w.sealed('A', pdfMeta, PDF);
      w.failGet.add(addr.vaultGet('A'));
      expect(await w.mover.moveOut([item])).toEqual({ done: [], failed: ['A'] });
      expect(w.client.moveInComplete).not.toHaveBeenCalled();
    });

    it('for a thumbnail that cannot be decrypted', async () => {
      const w = await world();
      const item = await w.sealed('P', { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' }, enc('jpeg'), { thumb: THUMB });
      const stored = w.objects.get(addr.vaultThumbGet('P'))!;
      stored[stored.length - 1] ^= 1;
      expect(await w.mover.moveOut([item])).toEqual({ done: [], failed: ['P'] });
      expect(w.puts).toHaveLength(0);
      expect(w.client.moveInComplete).not.toHaveBeenCalled();
    });

    it('when the Vault is closed', async () => {
      const w = await world();
      const item = await w.sealed('A', pdfMeta, PDF);
      w.session.close();
      expect(await w.mover.moveOut([item])).toEqual({ done: [], failed: ['A'] });
      expect(w.client.moveInComplete).not.toHaveBeenCalled();
    });

    it('when the server refuses the move out itself', async () => {
      const w = await world();
      const item = await w.sealed('A', pdfMeta, PDF);
      w.client.moveOut.mockRejectedValueOnce(new ApiError('vault_busy', 'busy', 409));
      expect(await w.mover.moveOut([item])).toEqual({ done: [], failed: ['A'] });
      expect(w.client.moveInComplete).not.toHaveBeenCalled();
    });

    it('when the PUT of the plain file itself is refused', async () => {
      // Nothing was stored (the fake does not keep an object it answered 500 for), so there is nothing to sweep.
      const w = await world();
      const item = await w.sealed('A', pdfMeta, PDF);
      w.failPut.add(addr.plainPut('A'));
      expect(await w.mover.moveOut([item])).toEqual({ done: [], failed: ['A'] });
      expect(w.client.moveInComplete).not.toHaveBeenCalled();
    });

    it('for a link, which has no plain file at all', async () => {
      const w = await world();
      const item = await w.sealed('L', { name: 'Trang', title: 'Trang', mime: LINK_MIME, kind: 'link', url: LINK_URL }, new Uint8Array(0));
      w.failCompleteOut.set('L', 1);
      expect(await w.mover.moveOut([item])).toEqual({ done: [], failed: ['L'] });
      expect(w.client.moveInComplete).not.toHaveBeenCalled();
    });
  });

  it('also cleans up through moveOutIds (the call the UI makes)', async () => {
    const w = await world();
    const item = await w.sealed('A', pdfMeta, PDF);
    w.failCompleteOut.set('A', 1);
    expect(await w.mover.moveOutIds(['A'], (id) => (id === 'A' ? item : undefined))).toEqual({ done: [], failed: ['A'] });
    expect(w.completeIn.get('A')).toEqual([{ encMeta: item.encMeta, encKey: item.encKey, size: item.size, hasThumb: false }]);
  });
});

describe('migrateLegacy: encrypting what was put in the Vault before it was encrypted', () => {
  it('moves in every plain item of the Vault and of the Vault trash, and skips the encrypted ones', async () => {
    const w = await world();
    const live = w.legacy('LIVE', { name: 'live.txt' });
    const trashed = w.legacy('TRASH', { name: 'trash.txt', deletedAt: 1_700_000_100_000 });
    const old = w.legacy('OLD', { name: 'old.txt' });
    delete old.encrypted; // a row from before the column existed counts as plain
    const done = await w.sealed('DONE', { name: 'done.txt', mime: 'text/plain', kind: 'file' }, enc('x'));
    const doneTrash = await w.sealed('DONE2', { name: 'done2.txt', mime: 'text/plain', kind: 'file' }, enc('x'));
    doneTrash.deletedAt = 1_700_000_100_000;
    w.listed.live = [live, done, old];
    w.listed.trash = [trashed, doneTrash];

    const res = await w.mover.migrateLegacy();
    expect(res.failed).toEqual([]);
    expect([...res.done].sort()).toEqual(['LIVE', 'OLD', 'TRASH']);
    expect(w.client.moveIn.mock.calls.map(([id]) => id).sort()).toEqual(['LIVE', 'OLD', 'TRASH']);

    const asked = w.client.listEverything.mock.calls.map(([o]) => o ?? {});
    expect(asked.some((o) => o.vault === true && !o.trash)).toBe(true);
    expect(asked.some((o) => o.vault === true && o.trash === true)).toBe(true);
  });

  it('does not touch anything that is not in the Vault', async () => {
    const w = await world();
    const outside = w.legacy('OUT', { name: 'out.txt', inVault: false });
    w.listed.live = [outside];
    expect(await w.mover.migrateLegacy()).toEqual({ done: [], failed: [] });
    expect(w.client.moveIn).not.toHaveBeenCalled();
  });

  it('does nothing when every item is already encrypted', async () => {
    const w = await world();
    w.listed.live = [await w.sealed('DONE', { name: 'done.txt', mime: 'text/plain', kind: 'file' }, enc('x'))];
    expect(await w.mover.migrateLegacy()).toEqual({ done: [], failed: [] });
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it('carries on after a file fails and reports it, so a later run picks it up again', async () => {
    const w = await world();
    const a = w.legacy('A');
    const b = w.legacy('B');
    w.failGet.add(addr.plain('A'));
    w.listed.live = [a, b];
    expect(await w.mover.migrateLegacy()).toEqual({ done: ['B'], failed: ['A'] });
  });

  it('reports progress over every legacy item, trash included', async () => {
    const w = await world();
    w.listed.live = [w.legacy('A'), w.legacy('B')];
    w.listed.trash = [w.legacy('C', { deletedAt: 1_700_000_100_000 })];
    const onProgress = vi.fn();
    await w.mover.migrateLegacy(onProgress);
    const seen = onProgress.mock.calls.map(([p]) => p as { done: number; total: number; current: string });
    expect(seen).toHaveLength(3);
    expect(seen.every((p) => p.total === 3)).toBe(true);
    expect(seen.map((p) => p.current).sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('startMigration: the background run always ends with a final progress event', () => {
  // startMigration runs in the background and returns at once, so each test waits for the event it looks for.
  // Every case here uses only fake Worker calls and an in-memory R2, so the wait is for promises, not for real time.

  it('emits { done: 0, total: 0 } as its only event when there is nothing to migrate', async () => {
    const w = await world();
    w.listed.live = [];
    w.listed.trash = [];
    const onProgress = vi.fn();
    w.mover.startMigration(onProgress);
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledTimes(1));
    expect(onProgress).toHaveBeenLastCalledWith({ done: 0, total: 0 });
    expect(w.client.moveIn).not.toHaveBeenCalled();
  });

  it('ends with the event { done: total, total } after the per-item events', async () => {
    const w = await world();
    w.listed.live = [w.legacy('A'), w.legacy('B')];
    w.listed.trash = [w.legacy('C', { deletedAt: 1_700_000_100_000 })];
    const onProgress = vi.fn();
    w.mover.startMigration(onProgress);
    await vi.waitFor(() => expect(onProgress.mock.lastCall?.[0]).toEqual({ done: 3, total: 3 }));
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('still ends with { done: total, total } when one of the items fails', async () => {
    const w = await world();
    w.listed.live = [w.legacy('A'), w.legacy('B')];
    w.failGet.add(addr.plain('A'));
    const onProgress = vi.fn();
    w.mover.startMigration(onProgress);
    await vi.waitFor(() => expect(onProgress.mock.lastCall?.[0]).toEqual({ done: 2, total: 2 }));
  });

  it('still ends with { done: 0, total: 0 } when the Vault is closed, so nobody waits for an event that never comes', async () => {
    const w = await world();
    w.listed.live = [w.legacy('A')];
    w.session.close();
    const onProgress = vi.fn();
    w.mover.startMigration(onProgress);
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledTimes(1));
    expect(onProgress).toHaveBeenLastCalledWith({ done: 0, total: 0 });
    expect(w.fetchImpl).not.toHaveBeenCalled();
  });

  it('still ends with { done: 0, total: 0 } when listing the Vault fails', async () => {
    const w = await world();
    w.client.listEverything.mockRejectedValueOnce(new ApiError('network', 'down'));
    const onProgress = vi.fn();
    w.mover.startMigration(onProgress);
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledTimes(1));
    expect(onProgress).toHaveBeenLastCalledWith({ done: 0, total: 0 });
  });
});
