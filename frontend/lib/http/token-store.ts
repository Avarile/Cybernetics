// Access token lives ONLY in memory (never persisted). Module-level so axios
// interceptors can read it synchronously. Lost on reload; rebuilt via refresh.
let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}
