import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../src/main/api';

type Call = { method: string; path: string; search: URLSearchParams; headers: Headers; body: unknown };

/** An ApiClient over a fake `fetch`: records every request and answers with `respond`. */
function make(respond: (call: Call) => { status?: number; body?: unknown } = () => ({ body: {} })) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const call: Call = {
      method: init.method ?? 'GET',
      path: u.pathname,
      search: u.searchParams,
      headers: new Headers(init.headers as Record<string, string>),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body ?? {}), { status });
  });
  return { calls, client: new ApiClient('https://api.test', 'tok', fetchMock as unknown as typeof fetch) };
}

const page = (...ids: string[]) => ({ items: ids.map((id, i) => ({ id, createdAt: 100 - i })), nextCursor: null });

describe('ApiClient vault endpoints', () => {
  it('reads the vault status with GET /vault', async () => {
    const status = { state: 'ready', kdf: { salt: 'c2FsdA==', iterations: 600000 }, failedAttempts: 0, lockedUntil: null, remaining: 10 };
    const { calls, client } = make(() => ({ body: status }));
    expect(await client.vaultStatus()).toEqual(status);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/vault' });
  });

  it('sets the vault up with POST /vault/setup and the request body', async () => {
    const req = { kdfSalt: 's', kdfIterations: 1000, authKey: 'a', serverSecret: 'S', wrappedMkPin: 'w', rkAuth: 'r', wrappedMkRecovery: 'wr' };
    const { calls, client } = make();
    await client.vaultSetup(req);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/vault/setup', body: req });
  });

  it('unlocks with POST /vault/unlock and returns the secret and the wrapped key', async () => {
    const { calls, client } = make(() => ({ body: { serverSecret: 'S', wrappedMkPin: 'W' } }));
    expect(await client.vaultUnlock({ authKey: 'AK' })).toEqual({ serverSecret: 'S', wrappedMkPin: 'W' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/vault/unlock', body: { authKey: 'AK' } });
  });

  it('recovers with POST /vault/recover', async () => {
    const { calls, client } = make(() => ({ body: { wrappedMkRecovery: 'WR' } }));
    expect(await client.vaultRecover({ rkAuth: 'RA' })).toEqual({ wrappedMkRecovery: 'WR' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/vault/recover', body: { rkAuth: 'RA' } });
  });

  it('changes the PIN with PUT /vault/pin', async () => {
    const req = { proof: { authKey: 'old' }, kdfSalt: 's', kdfIterations: 1000, authKey: 'new', serverSecret: 'S2', wrappedMkPin: 'w2' };
    const { calls, client } = make(() => ({ status: 204 }));
    await client.vaultSetPin(req);
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/vault/pin', body: req });
  });

  it('moves a file in and out of the vault with the four /files/:id/vault routes', async () => {
    const { calls, client } = make(() => ({ body: { uploadUrl: 'u', thumbUploadUrl: null, downloadUrl: 'd', thumbUrl: null } }));
    const inBody = { encMeta: 'm', encKey: 'k', size: 99, hasThumb: false };
    const outBody = { name: 'a.txt', mime: 'text/plain', size: 5, hasThumb: false };
    await client.moveIn('F1');
    await client.moveInComplete('F1', inBody);
    await client.moveOut('F1');
    await client.moveOutComplete('F1', outBody);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /files/F1/vault/in',
      'POST /files/F1/vault/in/complete',
      'POST /files/F1/vault/out',
      'POST /files/F1/vault/out/complete',
    ]);
    expect(calls[1].body).toEqual(inBody);
    expect(calls[3].body).toEqual(outBody);
  });

  it('passes the vault part of an upload request through to POST /uploads', async () => {
    const { calls, client } = make(() => ({ body: { id: 'N', uploadUrl: 'u', thumbUploadUrl: null } }));
    await client.createUpload({ name: '', mime: 'application/octet-stream', size: 40, hasThumb: false, vault: { encMeta: 'M', encKey: 'K' } });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/uploads' });
    expect(calls[0].body).toMatchObject({ vault: { encMeta: 'M', encKey: 'K' } });
  });
});

describe('ApiClient vault listing', () => {
  it('sends X-FatUp-Vault: 2 with listAll({ vault: true }), and asks for the vault', async () => {
    const { calls, client } = make(() => ({ body: page('a') }));
    await client.listAll({ vault: true });
    expect(calls[0].path).toBe('/files');
    expect(calls[0].search.get('vault')).toBe('1');
    expect(calls[0].headers.get('x-fatup-vault')).toBe('2');
  });

  it('sends the header on every page', async () => {
    const { calls, client } = make((c) =>
      c.search.get('cursor') ? { body: page('b') } : { body: { items: [{ id: 'a', createdAt: 2 }], nextCursor: 'c1' } },
    );
    expect((await client.listAll({ vault: true })).map((i) => i.id)).toEqual(['a', 'b']);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.headers.get('x-fatup-vault') === '2')).toBe(true);
  });

  it('asks for the vault trash with vault=1 and trash=1', async () => {
    const { calls, client } = make(() => ({ body: page('t') }));
    await client.listAll({ vault: true, trash: true });
    expect(calls[0].search.get('vault')).toBe('1');
    expect(calls[0].search.get('trash')).toBe('1');
    expect(calls[0].headers.get('x-fatup-vault')).toBe('2');
  });

  it('does not send the header for a plain list or the plain trash', async () => {
    const { calls, client } = make(() => ({ body: page() }));
    await client.listAll();
    await client.listAll({ trash: true });
    await client.listAll({ kind: 'link' });
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.headers.get('x-fatup-vault') === null)).toBe(true);
  });

  it('sends the header on both requests of listEverything({ vault: true })', async () => {
    const { calls, client } = make((c) => ({ body: c.search.get('kind') === 'link' ? page('L') : page('F') }));
    const items = await client.listEverything({ vault: true });
    expect(items.map((i) => i.id).sort()).toEqual(['F', 'L']);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.search.get('vault') === '1' && c.headers.get('x-fatup-vault') === '2')).toBe(true);
  });

  it('sends one request with the header for listEverything({ vault: true, trash: true })', async () => {
    const { calls, client } = make(() => ({ body: page('t') }));
    await client.listEverything({ vault: true, trash: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].search.get('trash')).toBe('1');
    expect(calls[0].headers.get('x-fatup-vault')).toBe('2');
  });

  it('does not send the header for listEverything() without the vault', async () => {
    const { calls, client } = make(() => ({ body: page() }));
    await client.listEverything();
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.headers.get('x-fatup-vault') === null)).toBe(true);
  });
});

describe('ApiError for the vault answers', () => {
  it('keeps the parsed body of a 403 (wrong PIN) so the caller can read remaining and lockedUntil', async () => {
    const { client } = make(() => ({ status: 403, body: { remaining: 7, lockedUntil: null } }));
    const err = await client.vaultUnlock({ authKey: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403 });
    expect((err as ApiError & { body: unknown }).body).toEqual({ remaining: 7, lockedUntil: null });
  });

  it('keeps the parsed body of a 423 (locked)', async () => {
    const { client } = make(() => ({ status: 423, body: { remaining: 5, lockedUntil: 1_700_000_060_000 } }));
    const err = await client.vaultUnlock({ authKey: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 423 });
    expect((err as ApiError & { body: unknown }).body).toEqual({ remaining: 5, lockedUntil: 1_700_000_060_000 });
  });

  it('still reads code and message from the error-shaped body of a 410 and a 409', async () => {
    const wiped = make(() => ({ status: 410, body: { error: { code: 'vault_wiped', message: 'gone' } } }));
    await expect(wiped.client.vaultUnlock({ authKey: 'x' })).rejects.toMatchObject({ code: 'vault_wiped', status: 410, message: 'gone' });

    const exists = make(() => ({ status: 409, body: { error: { code: 'vault_exists', message: 'already' } } }));
    const err = await exists.client.vaultSetup({} as never).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'vault_exists', status: 409 });
    expect((err as ApiError & { body: unknown }).body).toEqual({ error: { code: 'vault_exists', message: 'already' } });
  });
});
