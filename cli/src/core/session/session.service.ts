import { ApiError, parseErrorEnvelope } from '../errors';
import { RefreshLock } from './refresh.lock';
import { TokenStore } from './token.store';
import { isExpired, pairFromLogin, type LoginResponse } from './tokens';

export interface SessionDeps {
  store: TokenStore;
  lock: RefreshLock;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function notLoggedIn(): ApiError {
  return new ApiError(401, 'UNAUTHORIZED', 'Not logged in.');
}

/**
 * Validates a 200 response body from /auth/login or /auth/refresh before it
 * is trusted to build a TokenPair.
 *
 * A proxy or gateway answering 200 with HTML (or any other non-conforming
 * body) is a normal failure mode, not a defensive hypothetical — `readBody`
 * deliberately returns the raw text when it isn't JSON. Without this check
 * an unchecked cast lets `undefined` fields flow into `pairFromLogin`,
 * producing an `expiresAt` of NaN. Every comparison against NaN in
 * `isExpired` is false, so the garbage pair reads as permanently live: it
 * would be adopted forever, sending `Bearer undefined` on every request,
 * until the user notices and re-logs in on their own.
 */
function parseTokenResponse(body: unknown, path: string): LoginResponse {
  const b = body as Partial<LoginResponse> | null;
  const valid =
    typeof b === 'object' &&
    b !== null &&
    typeof b.accessToken === 'string' &&
    b.accessToken !== '' &&
    typeof b.refreshToken === 'string' &&
    b.refreshToken !== '' &&
    typeof b.expiresIn === 'number' &&
    Number.isFinite(b.expiresIn) &&
    b.expiresIn > 0;

  if (!valid) {
    throw new ApiError(
      502,
      // Deliberately not in the AUTH_ namespace: exitCodeFor() treats any
      // AUTH_-prefixed code as ExitCode.AuthRequired regardless of status,
      // and a malformed upstream response is not an auth failure — it must
      // fall through to the status switch and exit ExitCode.Failure (1).
      'MALFORMED_RESPONSE',
      `${path} returned a response the CLI could not understand. ` +
        'This usually means a proxy or gateway in front of the API answered ' +
        'instead of the API itself. Try again; if it keeps happening, contact your administrator.',
    );
  }
  return b as LoginResponse;
}

/**
 * Owns the token lifecycle: what is on disk, when it is renewed, and who is
 * allowed to renew it.
 */
export class SessionService {
  private readonly store: TokenStore;
  private readonly lock: RefreshLock;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(deps: SessionDeps) {
    this.store = deps.store;
    this.lock = deps.lock;
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    this.now = deps.now ?? Date.now;
  }

  async getAccessToken(profile: string, baseUrl: string): Promise<string> {
    const current = this.store.read(profile);
    if (!current) throw notLoggedIn();
    if (!isExpired(current, this.now())) return current.accessToken;
    return this.refresh(profile, baseUrl);
  }

  /**
   * Renews the access token under the cross-process lock.
   *
   * `rejectedToken` is the access token a request just had refused. It exists
   * so the adopt-check below can tell "someone else already rotated" from "the
   * server rejected a token the clock still considers live" — the second needs
   * a refresh, the first must not have one.
   */
  async refresh(
    profile: string,
    baseUrl: string,
    rejectedToken?: string,
  ): Promise<string> {
    return this.lock.withLock(async () => {
      // Re-read INSIDE the lock. Without this every waiter would replay the
      // refresh token it queued with, and the API treats a second use of a
      // spent token as theft — revoking the entire family.
      const current = this.store.read(profile);
      if (!current) throw notLoggedIn();

      if (current.accessToken !== rejectedToken && !isExpired(current, this.now())) {
        return current.accessToken;
      }

      const res = await this.fetchImpl(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });

      if (!res.ok) {
        // The refresh token is spent, revoked or stolen. Nothing local can
        // recover it, and keeping it invites a REUSE report on the next run.
        this.store.clear(profile);
        throw parseErrorEnvelope(res.status, await readBody(res));
      }

      const body = await readBody(res);
      let parsed: LoginResponse;
      try {
        parsed = parseTokenResponse(body, '/auth/refresh');
      } catch (err) {
        // A 200 we can't trust leaves us no usable token either way —
        // treat it the same as the !res.ok branch above.
        this.store.clear(profile);
        throw err;
      }

      const pair = pairFromLogin(parsed, this.now());
      this.store.write(profile, pair);
      return pair.accessToken;
    });
  }

  async login(
    profile: string,
    baseUrl: string,
    email: string,
    password: string,
  ): Promise<void> {
    const res = await this.fetchImpl(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw parseErrorEnvelope(res.status, await readBody(res));
    const parsed = parseTokenResponse(await readBody(res), '/auth/login');
    this.store.write(profile, pairFromLogin(parsed, this.now()));
  }

  async logout(profile: string, baseUrl: string): Promise<void> {
    const current = this.store.read(profile);
    if (current) {
      try {
        await this.fetchImpl(`${baseUrl}/auth/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
      } catch {
        // Best effort. Failing to reach the server must not leave tokens on
        // disk that the user has been told are gone.
      }
    }
    this.store.clear(profile);
  }

  clear(profile: string): void {
    this.store.clear(profile);
  }
}
