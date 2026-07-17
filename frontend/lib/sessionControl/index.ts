const SESSION_KEY = 'session_token'

/**
 * Saves the session token to sessionStorage.
 * sessionStorage is cleared automatically when the tab/window closes.
 */
export function saveSession(token: string): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(SESSION_KEY, token)
}

/**
 * Retrieves the session token from sessionStorage.
 * Returns null if not found or running server-side.
 */
export function getSession(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(SESSION_KEY)
}

/**
 * Removes the session token from sessionStorage.
 */
export function clearSession(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(SESSION_KEY)
}
