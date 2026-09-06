import { ApiError } from '../errors';
import type { SessionService } from '../session/session.service';
import { ApiClient } from './api.client';

const BASE = 'http://api.test';

function envelope(code: string, statusCode: number) {
  return {
    error: {
      code,
      message: `${code} happened`,
      statusCode,
      details: null,
      correlationId: 'cid',
      timestamp: '2026-09-06T00:00:00.000Z',
      path: '/contacts',
    },
  };
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('ApiClient', () => {
  let fetchImpl: jest.Mock;
  let session: { getAccessToken: jest.Mock; refresh: jest.Mock; clear: jest.Mock };
  let sleeps: number[];

  const make = () =>
    new ApiClient({
      baseUrl: BASE,
      profile: 'dev',
      session: session as unknown as SessionService,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

  beforeEach(() => {
    fetchImpl = jest.fn();
    sleeps = [];
    session = {
      getAccessToken: jest.fn().mockResolvedValue('tok-1'),
      refresh: jest.fn().mockResolvedValue('tok-2'),
      clear: jest.fn(),
    };
  });

  it('sends the bearer token and returns the parsed body', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, { id: 'c1' }));
    await expect(make().get('/contacts/c1')).resolves.toEqual({ id: 'c1' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api.test/contacts/c1');
    expect(new Headers((init as RequestInit).headers).get('authorization')).toBe(
      'Bearer tok-1',
    );
  });

  it('returns null for a 204', async () => {
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(make().del('/contacts/c1')).resolves.toBeNull();
  });

  it('serialises a JSON body on post', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, { ok: true }));
    await make().post('/contacts', { firstName: 'Dana' });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      firstName: 'Dana',
    });
  });

  it('refreshes once and retries once on AUTH_TOKEN_EXPIRED', async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(401, envelope('AUTH_TOKEN_EXPIRED', 401)))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'c1' }));

    await expect(make().get('/contacts/c1')).resolves.toEqual({ id: 'c1' });

    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(session.refresh).toHaveBeenCalledWith('dev', BASE, 'tok-1');
    expect(
      new Headers((fetchImpl.mock.calls[1][1] as RequestInit).headers).get(
        'authorization',
      ),
    ).toBe('Bearer tok-2');
  });

  it('does not retry more than once on a repeated 401', async () => {
    fetchImpl.mockImplementation(() =>
      Promise.resolve(jsonResponse(401, envelope('AUTH_TOKEN_EXPIRED', 401))),
    );
    await expect(make().get('/contacts')).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(session.refresh).toHaveBeenCalledTimes(1);
  });

  it('clears the session and does not refresh on AUTH_TOKEN_REUSE', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(401, envelope('AUTH_TOKEN_REUSE', 401)));
    await expect(make().get('/contacts')).rejects.toMatchObject({
      code: 'AUTH_TOKEN_REUSE',
    });
    expect(session.refresh).not.toHaveBeenCalled();
    expect(session.clear).toHaveBeenCalledWith('dev');
  });

  it('clears the session and does not refresh on AUTH_TOKEN_INVALID', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(401, envelope('AUTH_TOKEN_INVALID', 401)));
    await expect(make().get('/contacts')).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(session.refresh).not.toHaveBeenCalled();
    expect(session.clear).toHaveBeenCalledWith('dev');
  });

  it('honours Retry-After on a 429 and then succeeds', async () => {
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse(429, envelope('RATE_LIMITED', 429), { 'retry-after': '2' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { id: 'c1' }));

    await expect(make().get('/contacts/c1')).resolves.toEqual({ id: 'c1' });
    expect(sleeps).toEqual([2000]);
  });

  it('gives up after maxRetries 429s', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(429, envelope('RATE_LIMITED', 429), { 'retry-after': '1' }),
    );
    await expect(make().get('/contacts')).rejects.toMatchObject({ status: 429 });
    // initial attempt + 3 retries
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('defaults the 429 wait when Retry-After is absent', async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(429, envelope('RATE_LIMITED', 429)))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    await make().get('/contacts');
    expect(sleeps).toEqual([1000]);
  });

  it('wraps a non-JSON error body as UNKNOWN', async () => {
    fetchImpl.mockResolvedValue(
      new Response('<html>502</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    await expect(make().get('/contacts')).rejects.toMatchObject({
      code: 'UNKNOWN',
      status: 502,
    });
  });
});
