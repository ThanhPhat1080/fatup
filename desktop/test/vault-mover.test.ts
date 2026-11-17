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
  /** Since spec 4.7d every move in writes to its own object: vault/<id>.<attempt>[.thumb]. */
  vaultPut: (id: string, attempt: string) => `${R2}/put/vault/${id}.${attempt}`,
  vaultThumbPut: (id: string, attempt: string) => `${R2}/put/vault/${id}.${attempt}.thumb`,
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
  const state = { putCount: 0 };
  const failComplete = new Map<string, number>();
  /** How many times the next moveInComplete of an id answers 409 (any 409: item_changed, size_mismatch... the mover must not retry it). */
  const conflictComplete = new Map<string, number>();
  /** Every attempt the fake Worker handed out per id, in order. A fresh one on every vault/in, written nowhere (spec 4.7d). */
  const attempts = new Map<string, string[]>();
  const attempt = (id: string, n = 0) => attempts.get(id)![n];
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
      state.putCount++;
      // No ETag header on purpose: since spec 4.7d the mover does not need one.
      return new Response(null, { status: 200 });
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
        const s = shape.get(id) ?? { thumb: false, link: false };
        // The Worker gives every vault/in a fresh attempt (random, never the same twice, no state kept); the fake numbers them.
        const attempt = `attempt-${id}-${(attempts.get(id)?.length ?? 0) + 1}-AAAAAAAAAAAA`;
        attempts.set(id, [...(attempts.get(id) ?? []), attempt]);
        return {
          uploadUrl: addr.vaultPut(id, attempt),
          thumbUploadUrl: s.thumb ? addr.vaultThumbPut(id, attempt) : null,
          downloadUrl: s.link ? null : addr.plain(id),
          thumbUrl: s.thumb ? addr.plainThumb(id) : null,
          attempt,
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
    server, session, mover, client, fetchImpl, objects, puts, gets, events, calls, failGet, failPut, state, failComplete, conflictComplete, attempts, attempt,
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

    expect(w.puts.map((p) => p.url)).toEqual([addr.vaultPut('A', w.attempt('A'))]);
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
    const thumbPut = w.puts.find((p) => p.url === addr.vaultThumbPut('P', w.attempt('P')))!;
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
    expect(w.puts.map((p) => p.url)).toEqual([addr.vaultThumbPut('L', w.attempt('L'))]);
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
      `PUT ${addr.vaultPut('A', w.attempt('A'))}`,
      'complete:A',
      'moveIn:B',
      `GET ${addr.plain('B')}`,
      `PUT ${addr.vaultPut('B', w.attempt('B'))}`,
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
    expect(w.puts.map((p) => p.url)).toEqual([addr.vaultPut('B', w.attempt('B'))]);
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

  it('can be run again for a file interrupted between the upload and the completion: the new run uses a NEW attempt and its own object', async () => {
    const w = await world();
    const item = w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF);
    w.failComplete.set('A', 1);

    const first = await w.mover.moveIn([item]);
    expect(first).toEqual({ done: [], failed: ['A'] });
    expect(w.puts).toHaveLength(1); // the upload had happened

    const second = await w.mover.moveIn([item]);
    expect(second).toEqual({ done: ['A'], failed: [] });
    expect(w.attempts.get('A')).toHaveLength(2);
    expect(w.attempt('A', 1)).not.toBe(w.attempt('A', 0));
    // Not overwritten: each run wrote the object of its own attempt.
    expect(w.puts.map((p) => p.url)).toEqual([addr.vaultPut('A', w.attempt('A', 0)), addr.vaultPut('A', w.attempt('A', 1))]);
    expect(w.completeIn.get('A')).toHaveLength(2);
    const [firstReq, last] = w.completeIn.get('A')!;
    expect(firstReq.attempt).toBe(w.attempt('A', 0));
    expect(last.attempt).toBe(w.attempt('A', 1));

    // What is stored under the last attempt is what the last completion's key opens.
    const stored = w.objects.get(addr.vaultPut('A', w.attempt('A', 1)))!;
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

describe('moveIn: the attempt of vault/in goes back with the completion (spec 4.7d)', () => {
  // vault/in names the object this run writes (`vault/<id>.<attempt>`); complete says which attempt it wrote. No ETag, no claim.
  it('sends the attempt vault/in handed out with moveInComplete, for a file', async () => {
    const w = await world();
    expect(await w.mover.moveIn([w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF)])).toEqual({ done: ['A'], failed: [] });
    expect(w.attempts.get('A')).toHaveLength(1);
    expect(w.completeIn.get('A')![0].attempt).toBe(w.attempt('A'));
  });

  it('PUTs the ciphertext to the address of that attempt, and the thumbnail to the thumbnail address of that attempt', async () => {
    const w = await world();
    const item = w.legacy('P', { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' }, enc('jpeg of a photo'), THUMB);
    expect(await w.mover.moveIn([item])).toEqual({ done: ['P'], failed: [] });
    expect(w.puts.map((p) => p.url).sort()).toEqual([addr.vaultPut('P', w.attempt('P')), addr.vaultThumbPut('P', w.attempt('P'))].sort());
    expect(w.completeIn.get('P')![0].attempt).toBe(w.attempt('P'));
  });

  it('sends the attempt for a link too (a link goes through vault/in), and no file PUT', async () => {
    const w = await world();
    const link = w.legacy('L', { kind: 'link', mime: LINK_MIME, name: 'Trang', url: LINK_URL, size: 0 }, null);
    expect(await w.mover.moveIn([link])).toEqual({ done: ['L'], failed: [] });
    expect(w.completeIn.get('L')![0].attempt).toBe(w.attempt('L'));
    expect(w.puts).toEqual([]);
    expect(w.gets).toEqual([]);
  });

  it('sends the attempt for a link with a preview picture: only the thumbnail is PUT, at the attempt\'s thumbnail address', async () => {
    const w = await world();
    const link = w.legacy('L', { kind: 'link', mime: LINK_MIME, name: 'Trang', url: LINK_URL, size: 0 }, null, THUMB);
    expect(await w.mover.moveIn([link])).toEqual({ done: ['L'], failed: [] });
    expect(w.puts.map((p) => p.url)).toEqual([addr.vaultThumbPut('L', w.attempt('L'))]);
    expect(w.completeIn.get('L')![0].attempt).toBe(w.attempt('L'));
  });

  it('sends each item its own attempt', async () => {
    const w = await world();
    await w.mover.moveIn([w.legacy('A'), w.legacy('B')]);
    expect(w.completeIn.get('A')![0].attempt).toBe(w.attempt('A'));
    expect(w.completeIn.get('B')![0].attempt).toBe(w.attempt('B'));
    expect(w.completeIn.get('A')![0].attempt).not.toBe(w.completeIn.get('B')![0].attempt);
  });

  it('sends no etag and no claim, and needs no ETag header on the answer of the PUT', async () => {
    const w = await world();
    const pictured = w.legacy('P', { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' }, enc('jpeg of a photo'), THUMB);
    const link = w.legacy('L', { kind: 'link', mime: LINK_MIME, name: 'Trang', url: LINK_URL, size: 0 }, null);
    // The fake R2 answers every PUT without an ETag header.
    expect(await w.mover.moveIn([pictured, link, w.legacy('A')])).toEqual({ done: ['P', 'L', 'A'], failed: [] });
    for (const id of ['P', 'L', 'A']) {
      const [req] = w.completeIn.get(id)!;
      expect(req).not.toHaveProperty('etag');
      expect(req).not.toHaveProperty('claim');
      expect(Object.keys(req).sort()).toEqual(['attempt', 'encKey', 'encMeta', 'hasThumb', 'size']);
    }
  });

  it('migrateLegacy sends the attempt too', async () => {
    const w = await world();
    w.listed.live = [w.legacy('A', { name: 'a.txt' })];
    expect(await w.mover.migrateLegacy()).toEqual({ done: ['A'], failed: [] });
    expect(w.completeIn.get('A')![0].attempt).toBe(w.attempt('A'));
  });

  it('moveOutIds sends the attempt when it has to encrypt a legacy item first', async () => {
    const w = await world();
    const plain = w.legacy('A', { name: 'a.txt' });
    w.listed.live = [plain];
    // After the move in, the list shows the item encrypted, so it can go out.
    w.client.listEverything.mockImplementation(async () => {
      if (!w.completeIn.has('A')) return [{ ...plain }];
      return [await w.sealed('A', { name: 'a.txt', mime: 'text/plain', kind: 'file' }, enc('x'))];
    });
    await w.mover.moveOutIds(['A'], () => undefined);
    expect(w.completeIn.get('A')![0].attempt).toBe(w.attempt('A'));
  });

  describe('any failure of an item puts it in failed and is NOT retried within the run (spec 4.7d)', () => {
    it('a PUT that answers 500: failed, no complete, no second vault/in, and the next item still moves', async () => {
      const w = await world();
      const a = w.legacy('A');
      const b = w.legacy('B');
      // The address of A's first attempt is known only once vault/in answered, so the PUT fails by item.
      w.client.moveIn.mockImplementationOnce(async (id: string) => {
        const urls = await w.client.moveIn.getMockImplementation()!(id);
        w.failPut.add(urls.uploadUrl);
        return urls;
      });
      const res = await w.mover.moveIn([a, b]);
      expect(res).toEqual({ done: ['B'], failed: ['A'] });
      expect(w.completeIn.has('A')).toBe(false);
      expect(w.client.moveIn.mock.calls.filter(([id]) => id === 'A')).toHaveLength(1);
      expect(w.completeIn.get('B')![0].attempt).toBe(w.attempt('B'));
    });

    it('a complete that answers 409 item_changed: failed, no second vault/in, no second PUT, no second complete', async () => {
      const w = await world();
      w.conflictComplete.set('A', 1);
      const res = await w.mover.moveIn([w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF), w.legacy('B')]);
      expect(res).toEqual({ done: ['B'], failed: ['A'] });
      expect(w.client.moveIn.mock.calls.filter(([id]) => id === 'A')).toHaveLength(1);
      expect(w.puts.filter((p) => p.url.includes('/vault/A.'))).toHaveLength(1);
      expect(w.completeIn.get('A')).toHaveLength(1);
      expect(w.attempts.get('A')).toHaveLength(1);
    });

    it('a complete that answers 409 two times in a row is still one attempt, not a retry loop', async () => {
      const w = await world();
      w.conflictComplete.set('A', 2);
      expect(await w.mover.moveIn([w.legacy('A')])).toEqual({ done: [], failed: ['A'] });
      expect(w.completeIn.get('A')).toHaveLength(1);
      expect(w.client.moveIn).toHaveBeenCalledTimes(1);
    });

    it('a complete that fails some other way (network): failed, not retried', async () => {
      const w = await world();
      w.failComplete.set('A', 1);
      expect(await w.mover.moveIn([w.legacy('A')])).toEqual({ done: [], failed: ['A'] });
      expect(w.completeIn.get('A')).toHaveLength(1);
      expect(w.client.moveIn).toHaveBeenCalledTimes(1);
    });

    it('a vault/in that answers 409 (whatever the code): failed, no download, no upload, no retry', async () => {
      const w = await world();
      w.client.moveIn.mockRejectedValueOnce(new ApiError('already_encrypted', 'The item is already encrypted', 409));
      expect(await w.mover.moveIn([w.legacy('A')])).toEqual({ done: [], failed: ['A'] });
      expect(w.client.moveIn).toHaveBeenCalledTimes(1);
      expect(w.fetchImpl).not.toHaveBeenCalled();
    });

    it('counts a failed item once in the progress, and goes on to the next', async () => {
      const w = await world();
      w.conflictComplete.set('A', 1);
      const onProgress = vi.fn();
      await w.mover.moveIn([w.legacy('A'), w.legacy('B')], onProgress);
      expect(onProgress.mock.calls.map(([p]) => [p.done, p.total, p.current])).toEqual([
        [1, 2, 'A'],
        [2, 2, 'B'],
      ]);
    });

    it('migrateLegacy reports the failed item as failed and migrates the others, with no retry', async () => {
      const w = await world();
      w.conflictComplete.set('A', 1);
      w.listed.live = [w.legacy('A'), w.legacy('B')];
      expect(await w.mover.migrateLegacy()).toEqual({ done: ['B'], failed: ['A'] });
      expect(w.client.moveIn.mock.calls.filter(([id]) => id === 'A')).toHaveLength(1);
    });

    it('moveOutIds reports a legacy item whose move in failed as failed and does not try to move it out', async () => {
      const w = await world();
      w.conflictComplete.set('A', 1);
      w.listed.live = [w.legacy('A', { name: 'a.txt' })];
      expect(await w.mover.moveOutIds(['A'], () => undefined)).toEqual({ done: [], failed: ['A'] });
      expect(w.client.moveOut).not.toHaveBeenCalled();
      expect(w.client.moveIn).toHaveBeenCalledTimes(1);
    });
  });

  describe('a later run retries a failed item with a NEW attempt', () => {
    it('after a 409 from complete, the next migrateLegacy asks vault/in again, gets another attempt, writes its object and completes with it', async () => {
      const w = await world();
      w.conflictComplete.set('A', 1);
      const item = w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF);
      w.listed.live = [item];
      expect(await w.mover.migrateLegacy()).toEqual({ done: [], failed: ['A'] });

      expect(await w.mover.migrateLegacy()).toEqual({ done: ['A'], failed: [] });
      expect(w.attempts.get('A')).toHaveLength(2);
      expect(w.attempt('A', 1)).not.toBe(w.attempt('A', 0));
      const [first, second] = w.completeIn.get('A')!;
      expect(first.attempt).toBe(w.attempt('A', 0));
      expect(second.attempt).toBe(w.attempt('A', 1));
      expect(second.encKey).not.toBe(first.encKey); // a whole new run: a new file key
      const stored = w.objects.get(addr.vaultPut('A', w.attempt('A', 1)))!;
      expect(same(await decryptBytes(stored, await keyOf(w, second.encKey)), PDF)).toBe(true);
    });

    it('after a PUT that answered 500, the next run writes a different object', async () => {
      const w = await world();
      const item = w.legacy('A', { name: 'a.pdf', mime: 'application/pdf' }, PDF);
      w.client.moveIn.mockImplementationOnce(async (id: string) => {
        const urls = await w.client.moveIn.getMockImplementation()!(id);
        w.failPut.add(urls.uploadUrl);
        return urls;
      });
      expect(await w.mover.moveIn([item])).toEqual({ done: [], failed: ['A'] });
      expect(await w.mover.moveIn([item])).toEqual({ done: ['A'], failed: [] });
      expect(w.puts.map((p) => p.url)).toEqual([addr.vaultPut('A', w.attempt('A', 0)), addr.vaultPut('A', w.attempt('A', 1))]);
      expect(w.completeIn.get('A')).toHaveLength(1);
      expect(w.completeIn.get('A')![0].attempt).toBe(w.attempt('A', 1));
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
  // encrypted in D1, so the client asks the Worker's idempotent move-in branch (same encMeta/encKey, no attempt) to sweep the plain copies.
  const pdfMeta: VaultMeta = { name: 'a.pdf', mime: 'application/pdf', kind: 'file' };
  const cleanups = (w: World, id: string) => w.calls.filter((c) => c.name === 'moveInComplete' && c.args[0] === id);

  it('after a failed moveOutComplete, calls moveInComplete with the row\'s own encMeta, encKey and size, and no attempt', async () => {
    const w = await world();
    const item = await w.sealed('A', pdfMeta, PDF);
    w.failCompleteOut.set('A', 1);
    expect(await w.mover.moveOut([item])).toEqual({ done: [], failed: ['A'] });

    expect(w.puts.map((p) => p.url)).toEqual([addr.plainPut('A')]); // the plain copy was written
    expect(w.completeIn.get('A')).toEqual([{ encMeta: item.encMeta, encKey: item.encKey, size: item.size, hasThumb: false }]);
    expect(w.completeIn.get('A')![0]).not.toHaveProperty('attempt'); // an already encrypted row: the cleanup call carries no attempt (spec 4.7d)
    expect(w.completeIn.get('A')![0]).not.toHaveProperty('etag');
    expect(w.completeIn.get('A')![0]).not.toHaveProperty('claim');
    expect(w.attempts.get('A')).toBeUndefined(); // and the move out never asked vault/in for one
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
