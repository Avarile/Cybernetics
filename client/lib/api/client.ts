import { parseErrorEnvelope } from "./errors"

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface ApiClientConfig {
  baseUrl: string
  getAccessToken: () => string | null
  getRefreshToken: () => string | null
  onTokens: (pair: TokenPair) => void
  onAuthFailure: () => void
  fetchImpl?: typeof fetch
}

export interface ApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>
  get<T>(path: string, init?: RequestInit): Promise<T>
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  del<T>(path: string, init?: RequestInit): Promise<T>
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.headers.get("content-length") === "0") return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // A proxy or gateway can answer with HTML. Hand it back as-is so the
    // envelope parser can fall through to its UNKNOWN branch.
    return text
  }
}

/**
 * The only module that knows about the base URL, bearer tokens, or refresh.
 *
 * `credentials: "omit"` everywhere is deliberate: the API sets
 * `credentials: false` in its CORS config (Bearer transport, no cookies, no
 * CSRF surface), so sending credentials would be rejected, not merely useless.
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  const doFetch = config.fetchImpl ?? globalThis.fetch

  // The single-flight latch. While a refresh is in progress, every other 401
  // awaits THIS promise instead of starting its own.
  //
  // This is correctness, not an optimisation. `auth.service.ts` rotates refresh
  // tokens with a compare-and-set (`claimForRotation`) and treats a second
  // concurrent use of the same token as theft — it revokes the whole family.
  // Two parallel refreshes would therefore log the user out.
  let inFlightRefresh: Promise<boolean> | null = null

  async function performRefresh(): Promise<boolean> {
    const refreshToken = config.getRefreshToken()
    if (!refreshToken) {
      config.onAuthFailure()
      return false
    }
    const res = await doFetch(`${config.baseUrl}/auth/refresh`, {
      method: "POST",
      credentials: "omit",
      headers: new Headers({ "content-type": "application/json" }),
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) {
      config.onAuthFailure()
      return false
    }
    const pair = (await readBody(res)) as TokenPair | null
    if (!pair?.accessToken) {
      config.onAuthFailure()
      return false
    }
    config.onTokens(pair)
    return true
  }

  function refreshOnce(): Promise<boolean> {
    if (!inFlightRefresh) {
      inFlightRefresh = performRefresh().finally(() => {
        inFlightRefresh = null
      })
    }
    return inFlightRefresh
  }

  async function send(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    const token = config.getAccessToken()
    if (token) headers.set("authorization", `Bearer ${token}`)
    return doFetch(`${config.baseUrl}${path}`, { ...init, headers, credentials: "omit" })
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res = await send(path, init)

    if (res.status === 401) {
      const err = parseErrorEnvelope(401, await readBody(res))
      // Only an expiry is worth refreshing. INVALID and REUSE mean the session
      // is already gone.
      if (!err.isAuthExpiry()) throw err

      const refreshed = await refreshOnce()
      if (!refreshed) throw err

      // Exactly one retry. A second 401 means the fresh token is being
      // rejected too, and retrying again would loop.
      res = await send(path, init)
      if (!res.ok) throw parseErrorEnvelope(res.status, await readBody(res))
      return (await readBody(res)) as T
    }

    if (!res.ok) throw parseErrorEnvelope(res.status, await readBody(res))
    return (await readBody(res)) as T
  }

  function withBody(method: string) {
    return <T,>(path: string, body?: unknown, init: RequestInit = {}) =>
      request<T>(path, {
        ...init,
        method,
        headers: new Headers({
          "content-type": "application/json",
          ...Object.fromEntries(new Headers(init.headers)),
        }),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
  }

  return {
    request,
    get: <T,>(path: string, init: RequestInit = {}) =>
      request<T>(path, { ...init, method: "GET" }),
    post: withBody("POST"),
    patch: withBody("PATCH"),
    put: withBody("PUT"),
    del: <T,>(path: string, init: RequestInit = {}) =>
      request<T>(path, { ...init, method: "DELETE" }),
  }
}
