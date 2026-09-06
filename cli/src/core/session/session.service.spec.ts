import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, ExitCode } from '../errors';
import { RefreshLock } from './refresh.lock';
import { SessionService } from './session.service';
import { TokenStore } from './token.store';

const BASE = 'http://api.test';
const NOW = 1_000_000;

function envelope(code: string, statusCode: number) {
  return {
    error: {
      code,
      message: `${code} happened`,
      statusCode,
      details: null,
      correlationId: 'cid',
      timestamp: '2026-09-06T00:00:00.000Z',
      path: '/auth/refresh',
    },
  };
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('SessionService', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  let store: TokenStore;
  let lock: RefreshLock;
  let fetchImpl: jest.Mock;

  const make = () =>
    new SessionService({ store, lock, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => NOW });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-sess-'));
    env = { XDG_CONFIG_HOME: dir };
    store = new TokenStore(env);
    lock = new RefreshLock(join(dir, 'cybernetics', 'refresh.lock'), { pollMs: 5 });
    fetchImpl = jest.fn();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns a live token without touching the network', async () => {
    store.write('dev', { accessToken: 'live', refreshToken: 'r', expiresAt: NOW + 600_000 });
    await expect(make().getAccessToken('dev', BASE)).resolves.toBe('live');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports auth required when no credentials exist', async () => {
    await expect(make().getAccessToken('dev', BASE)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('refreshes an expired token and persists the rotated pair', async () => {
    store.write('dev', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });
    fetchImpl.mockResolvedValue(
      jsonResponse(200, { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 }),
    );

    await expect(make().getAccessToken('dev', BASE)).resolves.toBe('new');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api.test/auth/refresh');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      refreshToken: 'r1',
    });
    expect(store.read('dev')).toEqual({
      accessToken: 'new',
      refreshToken: 'r2',
      expiresAt: NOW + 900_000,
    });
  });

  it('adopts a pair another process rotated instead of refreshing again', async () => {
    // The state a waiter finds after the holder released the lock: the stored
    // token differs from the one that was rejected, and is live.
    store.write('dev', { accessToken: 'rotated', refreshToken: 'r2', expiresAt: NOW + 600_000 });
    await expect(make().refresh('dev', BASE, 'stale')).resolves.toBe('rotated');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does refresh when the stored token is the one that was rejected', async () => {
    store.write('dev', { accessToken: 'same', refreshToken: 'r1', expiresAt: NOW + 600_000 });
    fetchImpl.mockResolvedValue(
      jsonResponse(200, { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 }),
    );
    await expect(make().refresh('dev', BASE, 'same')).resolves.toBe('new');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('clears credentials when the refresh token is rejected', async () => {
    store.write('dev', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });
    fetchImpl.mockResolvedValue(jsonResponse(401, envelope('AUTH_TOKEN_REUSE', 401)));

    await expect(make().getAccessToken('dev', BASE)).rejects.toBeInstanceOf(ApiError);
    expect(store.read('dev')).toBeNull();
  });

  it('releases the lock after a failed refresh', async () => {
    store.write('dev', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });
    fetchImpl.mockResolvedValue(jsonResponse(401, envelope('AUTH_TOKEN_INVALID', 401)));

    await expect(make().getAccessToken('dev', BASE)).rejects.toBeInstanceOf(ApiError);
    // A leaked lock would make this hang until the 10s timeout.
    await lock.acquire();
    lock.release();
  });

  it('login stores the pair returned by the API', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, { accessToken: 'a', refreshToken: 'r', expiresIn: 900 }),
    );
    await make().login('dev', BASE, 'a@b.co', 'pw');
    expect(store.read('dev')).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: NOW + 900_000,
    });
  });

  it('login surfaces bad credentials without storing anything', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(401, envelope('AUTH_INVALID_CREDENTIALS', 401)),
    );
    await expect(make().login('dev', BASE, 'a@b.co', 'wrong')).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    expect(store.read('dev')).toBeNull();
  });

  it('logout revokes server-side and clears locally', async () => {
    store.write('dev', { accessToken: 'a', refreshToken: 'r', expiresAt: NOW + 600_000 });
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
    await make().logout('dev', BASE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.read('dev')).toBeNull();
  });

  it('logout clears locally even when the revoke call fails', async () => {
    // Being offline must not leave tokens on disk that the user believes are gone.
    store.write('dev', { accessToken: 'a', refreshToken: 'r', expiresAt: NOW + 600_000 });
    fetchImpl.mockRejectedValue(new Error('network down'));
    await make().logout('dev', BASE);
    expect(store.read('dev')).toBeNull();
  });

  it('refresh throws and clears credentials when /auth/refresh answers 200 with a non-JSON body', async () => {
    // A proxy or gateway in front of the API answering with HTML is a normal
    // failure mode, not a hypothetical: readBody() returns raw text when the
    // body isn't JSON, and an unchecked cast would let it through.
    store.write('dev', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });
    fetchImpl.mockResolvedValue(
      new Response('<html>Bad Gateway</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    await expect(make().getAccessToken('dev', BASE)).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
    expect(store.read('dev')).toBeNull();
  });

  it('refresh throws and clears credentials when /auth/refresh answers 200 with JSON missing expiresIn', async () => {
    store.write('dev', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });
    fetchImpl.mockResolvedValue(jsonResponse(200, { accessToken: 'new', refreshToken: 'r2' }));

    await expect(make().getAccessToken('dev', BASE)).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
    expect(store.read('dev')).toBeNull();
  });

  it('exits ExitCode.Failure for a malformed response, not ExitCode.AuthRequired', async () => {
    // exitCodeFor() treats any AUTH_-prefixed code as ExitCode.AuthRequired
    // regardless of status. A malformed upstream response is not an auth
    // failure, so this code must live outside that namespace and fall
    // through to the status switch (502 -> Failure). This pins that down so
    // a well-meaning rename back into AUTH_ fails loudly instead of quietly
    // changing the CLI's documented exit-code contract.
    store.write('dev', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });
    fetchImpl.mockResolvedValue(jsonResponse(200, { accessToken: 'new', refreshToken: 'r2' }));

    let caught: ApiError | undefined;
    try {
      await make().getAccessToken('dev', BASE);
    } catch (err) {
      caught = err as ApiError;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.code).toBe('MALFORMED_RESPONSE');
    expect(caught?.exitCode).toBe(ExitCode.Failure);
    expect(caught?.exitCode).not.toBe(ExitCode.AuthRequired);
  });

  it('login throws and stores nothing when /auth/login answers 200 with a malformed body', async () => {
    fetchImpl.mockResolvedValue(
      new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    await expect(make().login('dev', BASE, 'a@b.co', 'pw')).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
    expect(store.read('dev')).toBeNull();
  });

  it('never persists a pair with a NaN expiresAt, even at the expiresIn=0 boundary', async () => {
    // Regression guard for the original defect: `now + undefined * 1000` (or
    // any other non-positive-finite expiresIn) produces NaN, and isExpired()
    // treats every comparison against NaN as false — a garbage pair would
    // read as permanently live and be adopted forever.
    store.write('dev', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });
    fetchImpl.mockResolvedValue(
      jsonResponse(200, { accessToken: 'new', refreshToken: 'r2', expiresIn: 0 }),
    );

    await expect(make().getAccessToken('dev', BASE)).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });

    const stored = store.read('dev');
    expect(stored).toBeNull();
    // Spelled out separately from the toBeNull() above: whatever is on disk,
    // it must never be a pair whose expiresAt is NaN.
    expect(stored === null || !Number.isNaN(stored.expiresAt)).toBe(true);
  });
});
