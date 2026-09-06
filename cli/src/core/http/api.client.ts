import { ApiError, parseErrorEnvelope } from '../errors';
import type { SessionService } from '../session/session.service';

export interface ApiClientOptions {
  baseUrl: string;
  profile: string;
  session: SessionService;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 1_000;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.headers.get('content-length') === '0') return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A proxy or gateway can answer with HTML; hand it back so the envelope
    // parser can fall through to UNKNOWN.
    return text;
  }
}

function retryAfterMs(res: Response): number {
  const header = res.headers.get('retry-after');
  const seconds = header === null ? NaN : Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

/**
 * The only module that knows about the base URL, bearer tokens or retries.
 *
 * The 401 branch mirrors `client/lib/api/client.ts`: exactly one refresh and
 * exactly one retry. A second 401 means the fresh token is being rejected too,
 * and retrying again would loop.
 */
export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.sleep = opts.sleepImpl ?? defaultSleep;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { baseUrl, profile, session } = this.opts;
    let token = await session.getAccessToken(profile, baseUrl);
    let attempts = 0;
    let refreshed = false;

    for (;;) {
      const res = await this.send(path, init, token);

      if (res.status === 401) {
        const err = parseErrorEnvelope(401, await readBody(res));
        if (err.isSessionGone()) {
          session.clear(profile);
          throw err;
        }
        if (!err.isAuthExpiry() || refreshed) throw err;
        refreshed = true;
        token = await session.refresh(profile, baseUrl, token);
        continue;
      }

      if (res.status === 429 && attempts < this.maxRetries) {
        attempts += 1;
        await this.sleep(retryAfterMs(res));
        continue;
      }

      if (!res.ok) throw parseErrorEnvelope(res.status, await readBody(res));
      return (await readBody(res)) as T;
    }
  }

  get<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, { ...init, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    return this.withBody<T>('POST', path, body, init);
  }

  patch<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    return this.withBody<T>('PATCH', path, body, init);
  }

  del<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, { ...init, method: 'DELETE' });
  }

  private withBody<T>(
    method: string,
    path: string,
    body: unknown,
    init: RequestInit,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    return this.request<T>(path, {
      ...init,
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private send(path: string, init: RequestInit, token: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    return this.fetchImpl(`${this.opts.baseUrl}${path}`, { ...init, headers });
  }
}

export { ApiError };
