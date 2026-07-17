# Frontend Foundational Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `frontend/` foundational layer (auth, session, tokens, RBAC, env, router guards) against the real Cybernetics backend, so features can be built on a solid base.

**Architecture:** Next.js 16 App Router + React 19. Zustand owns client/UI/auth state; SWR owns server data. JWT access token lives in memory (`token-store`); rotating refresh token lives in a readable cookie (`cbn_rt`). Axios `api-client` injects the bearer token and performs a single-flight silent refresh on `AUTH_TOKEN_EXPIRED`. A coarse `middleware.ts` gates routes by cookie presence; the backend `RolesGuard` is the authoritative authz boundary.

**Tech Stack:** Next.js 16.1, React 19.2, TypeScript 5.9, Zustand 5, SWR, Axios 1.14, Zod 4, react-hook-form 7 + @hookform/resolvers, js-cookie, sonner. Tests: Vitest + Testing Library + jsdom + axios-mock-adapter.

Design source of truth: `development/current_session/current_design.md`.

## Global Constraints

- **HARD RULE — NO BACKEND CHANGES.** Do not modify anything under `api/`. The existing backend API is the single source of truth. If any task appears to require a backend change, STOP and raise it with the user; do not proceed.
- **Backend contract (exact, verbatim):**
  - Base URL = `NEXT_PUBLIC_API_URL` with **NO `/api` prefix** (root routes). CORS `credentials:false` (no cookies sent to API; tokens travel in JSON body / Authorization header).
  - `POST /auth/login` `{email,password}` → `TokenPair` (200). `POST /auth/refresh` `{refreshToken}` → `TokenPair`. `POST /auth/logout` `{refreshToken}` → 204. `POST /auth/logout-all` → 204 (auth). `GET /auth/me` → `{id, role}` (auth). `GET /auth/sessions` → `SessionSummary[]` (auth). `PATCH /auth/password` `{currentPassword,newPassword}` → 204 (auth, revokes ALL sessions). `POST /auth/forgot-password` `{email}` → 204. `POST /auth/reset-password` `{email,code,newPassword}` → 204.
  - `TokenPair = {accessToken:string; refreshToken:string; expiresIn:number}`. Access TTL 900s; refresh TTL 604800s (7d). Refresh rotates on every use; replaying a revoked refresh token → `AUTH_TOKEN_REUSE`.
  - No success envelope (raw payloads). Error envelope: `{error:{code,message,statusCode,details,correlationId,timestamp,path}}`. `VALIDATION_FAILED` details = `{issues:[{path:string,message:string}]}` (`path` dot-joined, `"(root)"` for top-level).
  - Roles: `guest | user | admin | agent`. Password bounds: **min 12, max 200**.
- **No public registration, no OAuth, no email verification** — login-only. Remove those pages/flows.
- **Response validation is types-only** (plain TS interfaces). Zod is used ONLY for form inputs + env parsing.
- **Import alias:** `@/*` → `frontend/*` (per `tsconfig.json`).
- **TDD + frequent commits.** Each task ends green (`npm run test`, `npm run typecheck`).
- Commit message convention for this repo: end the body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (per session guidance). Run commits only within the steps shown.

---

## File Structure

**New:**
- `frontend/vitest.config.ts`, `frontend/vitest.setup.ts` — test tooling
- `frontend/middleware.ts` — coarse route guard
- `frontend/lib/config/constants.ts` — cookie name, TTLs, error codes
- `frontend/lib/config/env.ts` — Zod-validated env (client + server)
- `frontend/lib/http/token-store.ts` — in-memory access token
- `frontend/lib/auth/session.ts` — refresh cookie + `refreshSession` + `applyTokenPair`
- `frontend/lib/auth/route-policy.ts` — route lists + matchers
- `frontend/lib/auth/password-strength.ts` — no-dep strength heuristic
- `frontend/lib/auth/guards.tsx` — `useRequireAuth`, `useRequireRole`, `<AuthGuard>`
- `frontend/lib/hooks/swr-fetcher.ts` — SWR fetcher bound to api-client
- `frontend/lib/services/agent.service.ts` — real `/agent/*`
- `frontend/components/providers/swr-provider.tsx` — `<SWRConfig>`
- `frontend/app/(protected)/account/page.tsx` + account components

**Rewritten:**
- `frontend/lib/http/api-client.ts`, `frontend/lib/interfaces/auth.interface.ts`, `frontend/lib/interfaces/mastra.interface.ts`, `frontend/lib/validations/auth.schema.ts`, `frontend/lib/services/auth.service.ts`, `frontend/lib/state-management/auth.store.ts`, `frontend/lib/hooks/use-permission.ts`, `frontend/components/providers/auth-provider.tsx`, `frontend/components/login-form.tsx`, `frontend/app/layout.tsx`, `frontend/app/auth/forgot-password/page.tsx`, `frontend/app/auth/reset-password/page.tsx`

**Corrected (small):**
- `frontend/lib/interfaces/app.interface.ts` (`projectId: string`), `frontend/lib/state-management/app.store.ts`, `frontend/next.config.mjs` (remove `/verify-email` redirect), `frontend/.env.example`

**Deleted (Task 18):** the fictional domain stores/services/interfaces, `lib/sessionControl/`, `mastra.service.ts`, removed auth pages, demo components/pages (full list in Task 18).

---

## Task 1: Test tooling + dependencies

**Files:**
- Create: `frontend/vitest.config.ts`, `frontend/vitest.setup.ts`, `frontend/lib/__tests__/smoke.test.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `npm run test` (Vitest), the `@` import alias in tests, jsdom default environment.

- [ ] **Step 1: Install dependencies**

Run:
```bash
cd frontend
npm install swr
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event axios-mock-adapter
```
Expected: installs succeed; `swr` in dependencies, the rest in devDependencies.

- [ ] **Step 2: Create `frontend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': rootDir } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Ensure eager env parsing (lib/config/env.ts) succeeds under test.
    env: {
      NEXT_PUBLIC_API_URL: 'http://localhost:3000',
      NEXT_PUBLIC_APP_NAME: 'Cybernetics',
      API_URL: 'http://localhost:3000',
    },
  },
})
```

- [ ] **Step 3: Create `frontend/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => cleanup())
```

- [ ] **Step 4: Add scripts to `frontend/package.json`**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write the smoke test `frontend/lib/__tests__/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('test tooling', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Run and verify pass**

Run: `npm run test`
Expected: 1 passing test.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/vitest.setup.ts frontend/lib/__tests__/smoke.test.ts
git commit -m "chore(frontend): set up vitest + testing-library, add swr"
```

---

## Task 2: Config — constants + env

**Files:**
- Create: `frontend/lib/config/constants.ts`, `frontend/lib/config/env.ts`
- Test: `frontend/lib/config/__tests__/env.test.ts`

**Interfaces:**
- Produces:
  - `constants.ts`: `REFRESH_COOKIE = 'cbn_rt'`, `REFRESH_COOKIE_MAX_AGE_DAYS = 7`, `ACCESS_TTL_FALLBACK_S = 900`, `ERROR_CODES` (string map).
  - `env.ts`: `clientEnv: { apiUrl: string; appName: string }`, `serverEnv: () => { apiUrl: string }`, `parseClientEnv(src)`, `parseServerEnv(src)`.

- [ ] **Step 1: Create `frontend/lib/config/constants.ts`**

```ts
/** Name of the readable cookie holding the rotating refresh token. */
export const REFRESH_COOKIE = 'cbn_rt'
/** Refresh-cookie lifetime in days (matches backend JWT_REFRESH_TTL = 7d). */
export const REFRESH_COOKIE_MAX_AGE_DAYS = 7
/** Fallback access-token TTL (seconds) if the server omits expiresIn. */
export const ACCESS_TTL_FALLBACK_S = 900

/** Backend error codes the frontend branches on. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_TOKEN_REUSE: 'AUTH_TOKEN_REUSE',
  FORBIDDEN: 'FORBIDDEN',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
```

- [ ] **Step 2: Write the failing test `frontend/lib/config/__tests__/env.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { parseClientEnv, parseServerEnv } from '@/lib/config/env'

describe('parseClientEnv', () => {
  it('parses a valid client env', () => {
    const env = parseClientEnv({
      NEXT_PUBLIC_API_URL: 'http://localhost:3000',
      NEXT_PUBLIC_APP_NAME: 'App',
    })
    expect(env).toEqual({ apiUrl: 'http://localhost:3000', appName: 'App' })
  })

  it('defaults appName when absent', () => {
    const env = parseClientEnv({ NEXT_PUBLIC_API_URL: 'http://localhost:3000' })
    expect(env.appName).toBe('Cybernetics')
  })

  it('throws a clear error when NEXT_PUBLIC_API_URL is missing', () => {
    expect(() => parseClientEnv({})).toThrow(/NEXT_PUBLIC_API_URL/)
  })
})

describe('parseServerEnv', () => {
  it('parses a valid server env', () => {
    expect(parseServerEnv({ API_URL: 'http://localhost:3000' })).toEqual({
      apiUrl: 'http://localhost:3000',
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- env`
Expected: FAIL (`env` module not found / exports missing).

- [ ] **Step 4: Create `frontend/lib/config/env.ts`**

```ts
import { z } from 'zod'

const clientSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url('NEXT_PUBLIC_API_URL must be a valid URL'),
  NEXT_PUBLIC_APP_NAME: z.string().default('Cybernetics'),
})

const serverSchema = z.object({
  API_URL: z.string().url('API_URL must be a valid URL'),
})

function formatIssues(err: z.ZodError): string {
  return err.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
}

export function parseClientEnv(src: Record<string, string | undefined>) {
  const parsed = clientSchema.safeParse(src)
  if (!parsed.success) {
    throw new Error(`[env] Invalid client environment:\n${formatIssues(parsed.error)}`)
  }
  return { apiUrl: parsed.data.NEXT_PUBLIC_API_URL, appName: parsed.data.NEXT_PUBLIC_APP_NAME }
}

export function parseServerEnv(src: Record<string, string | undefined>) {
  const parsed = serverSchema.safeParse(src)
  if (!parsed.success) {
    throw new Error(`[env] Invalid server environment:\n${formatIssues(parsed.error)}`)
  }
  return { apiUrl: parsed.data.API_URL }
}

// Client env is evaluated eagerly. NEXT_PUBLIC_* must be referenced statically
// so Next.js inlines them into the client bundle.
export const clientEnv = parseClientEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
})

// Server env is lazy so it never evaluates in the client bundle.
export function serverEnv() {
  return parseServerEnv({ API_URL: process.env.API_URL })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- env`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/config/
git commit -m "feat(frontend): add validated env module + constants"
```

---

## Task 3: Response types + Zod form schemas

**Files:**
- Rewrite: `frontend/lib/interfaces/auth.interface.ts`, `frontend/lib/validations/auth.schema.ts`
- Test: `frontend/lib/validations/__tests__/auth.schema.test.ts`

**Interfaces:**
- Produces (types): `Role`, `AuthStatus`, `TokenPair`, `CurrentUser`, `SessionSummary`, `Paginated<T>`, `ErrorEnvelope`, `IAuthState`.
- Produces (schemas): `loginSchema`, `forgotPasswordSchema`, `resetPasswordSchema`, `changePasswordSchema`, and inferred `LoginFormValues`, `ForgotPasswordFormValues`, `ResetPasswordFormValues`, `ChangePasswordFormValues`, plus `emailSchema`, `passwordSchema`.

- [ ] **Step 1: Rewrite `frontend/lib/interfaces/auth.interface.ts`**

```ts
export type Role = 'guest' | 'user' | 'admin' | 'agent'
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated'

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** GET /auth/me → { id, role }. `email` is populated only if the JWT carries the claim. */
export interface CurrentUser {
  id: string
  role: Role
  email?: string
}

/** GET /auth/sessions → SessionSummary[] */
export interface SessionSummary {
  id: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
  userAgent: string | null
  ip: string | null
}

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface ErrorEnvelope {
  error: {
    code: string
    message: string
    statusCode: number
    details: unknown | null
    correlationId: string
    timestamp: string
    path: string
  }
}

export interface ILoginInput {
  email: string
  password: string
}

export interface IResetPasswordInput {
  email: string
  code: string
  newPassword: string
}

export interface IAuthState {
  user: CurrentUser | null
  status: AuthStatus
  isLoading: boolean
  error: string | null

  login: (input: ILoginInput) => Promise<void>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
  bootstrap: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  forgotPassword: (email: string) => Promise<void>
  resetPassword: (input: IResetPasswordInput) => Promise<void>
  clearError: () => void
}
```

- [ ] **Step 2: Write the failing test `frontend/lib/validations/__tests__/auth.schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  loginSchema,
  resetPasswordSchema,
  changePasswordSchema,
  passwordSchema,
} from '@/lib/validations/auth.schema'

describe('loginSchema', () => {
  it('lowercases + trims email', () => {
    const r = loginSchema.parse({ email: '  Foo@Bar.COM ', password: 'x' })
    expect(r.email).toBe('foo@bar.com')
  })
  it('requires a non-empty password without revealing policy', () => {
    const r = loginSchema.safeParse({ email: 'a@b.com', password: '' })
    expect(r.success).toBe(false)
  })
})

describe('passwordSchema', () => {
  it('rejects < 12 chars', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false)
  })
  it('accepts exactly 12 chars', () => {
    expect(passwordSchema.safeParse('a'.repeat(12)).success).toBe(true)
  })
})

describe('resetPasswordSchema', () => {
  it('requires a 6-digit code and matching passwords', () => {
    const ok = resetPasswordSchema.safeParse({
      email: 'a@b.com', code: '123456',
      newPassword: 'a'.repeat(12), confirmPassword: 'a'.repeat(12),
    })
    expect(ok.success).toBe(true)
    const badCode = resetPasswordSchema.safeParse({
      email: 'a@b.com', code: '12', newPassword: 'a'.repeat(12), confirmPassword: 'a'.repeat(12),
    })
    expect(badCode.success).toBe(false)
  })
})

describe('changePasswordSchema', () => {
  it('rejects when new == current', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'a'.repeat(12), newPassword: 'a'.repeat(12), confirmPassword: 'a'.repeat(12),
    })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -- auth.schema`
Expected: FAIL (schema exports missing).

- [ ] **Step 4: Rewrite `frontend/lib/validations/auth.schema.ts`**

```ts
import { z } from 'zod'

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address')
export const passwordSchema = z
  .string()
  .min(12, 'At least 12 characters')
  .max(200, 'At most 200 characters')

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
})

export const forgotPasswordSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    path: ['newPassword'],
    message: 'New password must be different',
  })

export type LoginFormValues = z.infer<typeof loginSchema>
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>
export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>
```

- [ ] **Step 5: Run to verify it passes + typecheck**

Run: `npm run test -- auth.schema && npm run typecheck`
Expected: tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/interfaces/auth.interface.ts frontend/lib/validations/
git commit -m "feat(frontend): real auth response types + zod form schemas"
```

---

## Task 4: Password strength heuristic

**Files:**
- Create: `frontend/lib/auth/password-strength.ts`
- Test: `frontend/lib/auth/__tests__/password-strength.test.ts`

**Interfaces:**
- Produces: `scorePassword(pw: string): { score: 0|1|2|3|4; label: 'weak'|'fair'|'good'|'strong' }`.

- [ ] **Step 1: Write the failing test `frontend/lib/auth/__tests__/password-strength.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { scorePassword } from '@/lib/auth/password-strength'

describe('scorePassword', () => {
  it('scores empty as weak/0', () => {
    expect(scorePassword('')).toEqual({ score: 0, label: 'weak' })
  })
  it('scores a long varied password as strong', () => {
    const r = scorePassword('Abcdef123!@#xyz')
    expect(r.score).toBe(4)
    expect(r.label).toBe('strong')
  })
  it('scores a long but single-class password below strong', () => {
    expect(scorePassword('a'.repeat(16)).score).toBeLessThan(4)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- password-strength`
Expected: FAIL.

- [ ] **Step 3: Create `frontend/lib/auth/password-strength.ts`**

```ts
export type StrengthLabel = 'weak' | 'fair' | 'good' | 'strong'
export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4
  label: StrengthLabel
}

const LABELS: StrengthLabel[] = ['weak', 'weak', 'fair', 'good', 'strong']

/**
 * No-dependency heuristic. Soft guidance only — never used to block a
 * length-valid password (the hard rule lives in passwordSchema).
 */
export function scorePassword(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: 'weak' }

  const classes =
    Number(/[a-z]/.test(pw)) +
    Number(/[A-Z]/.test(pw)) +
    Number(/[0-9]/.test(pw)) +
    Number(/[^A-Za-z0-9]/.test(pw))

  let raw = 0
  if (pw.length >= 12) raw += 1
  if (pw.length >= 16) raw += 1
  if (classes >= 2) raw += 1
  if (classes >= 4) raw += 1

  const score = Math.min(4, raw) as PasswordStrength['score']
  return { score, label: LABELS[score] }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- password-strength`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/auth/password-strength.ts frontend/lib/auth/__tests__/
git commit -m "feat(frontend): password strength heuristic"
```

---

## Task 5: In-memory access-token store

**Files:**
- Create: `frontend/lib/http/token-store.ts`
- Test: `frontend/lib/http/__tests__/token-store.test.ts`

**Interfaces:**
- Produces: `getAccessToken(): string | null`, `setAccessToken(t: string | null): void`.

- [ ] **Step 1: Write the failing test `frontend/lib/http/__tests__/token-store.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getAccessToken, setAccessToken } from '@/lib/http/token-store'

describe('token-store', () => {
  beforeEach(() => setAccessToken(null))

  it('starts null', () => {
    expect(getAccessToken()).toBeNull()
  })
  it('stores and clears the access token', () => {
    setAccessToken('abc')
    expect(getAccessToken()).toBe('abc')
    setAccessToken(null)
    expect(getAccessToken()).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- token-store`
Expected: FAIL.

- [ ] **Step 3: Create `frontend/lib/http/token-store.ts`**

```ts
// Access token lives ONLY in memory (never persisted). Module-level so axios
// interceptors can read it synchronously. Lost on reload; rebuilt via refresh.
let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- token-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/http/token-store.ts frontend/lib/http/__tests__/token-store.test.ts
git commit -m "feat(frontend): in-memory access-token store"
```

---

## Task 6: Session module (refresh cookie + refresh call)

**Files:**
- Create: `frontend/lib/auth/session.ts`
- Test: `frontend/lib/auth/__tests__/session.test.ts`

**Interfaces:**
- Consumes: `token-store` (`setAccessToken`), `constants` (`REFRESH_COOKIE`), `clientEnv.apiUrl`, `TokenPair`.
- Produces:
  - `getRefreshToken(): string | undefined`
  - `applyTokenPair(pair: TokenPair): void`  — sets access token (memory) + refresh cookie
  - `clearSession(): void` — clears access token + cookie
  - `refreshSession(): Promise<TokenPair>` — raw POST `/auth/refresh`, applies pair, returns it (throws if no refresh token)
  - `refreshClient` (exported for tests only) — the raw axios instance used for refresh

- [ ] **Step 1: Write the failing test `frontend/lib/auth/__tests__/session.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import Cookies from 'js-cookie'
import {
  getRefreshToken, applyTokenPair, clearSession, refreshSession, refreshClient,
} from '@/lib/auth/session'
import { getAccessToken, setAccessToken } from '@/lib/http/token-store'
import { REFRESH_COOKIE } from '@/lib/config/constants'

const mock = new MockAdapter(refreshClient)

beforeEach(() => {
  mock.reset()
  setAccessToken(null)
  Cookies.remove(REFRESH_COOKIE, { path: '/' })
})

describe('applyTokenPair / getRefreshToken / clearSession', () => {
  it('applies a token pair to memory + cookie', () => {
    applyTokenPair({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })
    expect(getAccessToken()).toBe('a')
    expect(getRefreshToken()).toBe('r')
  })
  it('clears both', () => {
    applyTokenPair({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })
    clearSession()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeUndefined()
  })
})

describe('refreshSession', () => {
  it('posts the current refresh token and applies the rotated pair', async () => {
    applyTokenPair({ accessToken: 'old-a', refreshToken: 'old-r', expiresIn: 900 })
    mock.onPost('/auth/refresh').reply((config) => {
      expect(JSON.parse(config.data)).toEqual({ refreshToken: 'old-r' })
      return [200, { accessToken: 'new-a', refreshToken: 'new-r', expiresIn: 900 }]
    })
    const pair = await refreshSession()
    expect(pair.accessToken).toBe('new-a')
    expect(getAccessToken()).toBe('new-a')
    expect(getRefreshToken()).toBe('new-r')
  })
  it('throws when there is no refresh token', async () => {
    await expect(refreshSession()).rejects.toThrow(/no refresh token/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- session`
Expected: FAIL.

- [ ] **Step 3: Create `frontend/lib/auth/session.ts`**

```ts
import axios from 'axios'
import Cookies from 'js-cookie'
import { clientEnv } from '@/lib/config/env'
import { REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE_DAYS } from '@/lib/config/constants'
import { setAccessToken } from '@/lib/http/token-store'
import type { TokenPair } from '@/lib/interfaces/auth.interface'

// Raw axios instance — deliberately NOT the intercepted api-client, so refresh
// can never recurse through the 401 interceptor.
export const refreshClient = axios.create({
  baseURL: clientEnv.apiUrl,
  headers: { 'Content-Type': 'application/json' },
})

export function getRefreshToken(): string | undefined {
  return Cookies.get(REFRESH_COOKIE)
}

function setRefreshCookie(token: string): void {
  Cookies.set(REFRESH_COOKIE, token, {
    expires: REFRESH_COOKIE_MAX_AGE_DAYS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
}

export function applyTokenPair(pair: TokenPair): void {
  setAccessToken(pair.accessToken)
  setRefreshCookie(pair.refreshToken)
}

export function clearSession(): void {
  setAccessToken(null)
  Cookies.remove(REFRESH_COOKIE, { path: '/' })
}

export async function refreshSession(): Promise<TokenPair> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) throw new Error('No refresh token')
  const res = await refreshClient.post<TokenPair>('/auth/refresh', { refreshToken })
  applyTokenPair(res.data)
  return res.data
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/auth/session.ts frontend/lib/auth/__tests__/session.test.ts
git commit -m "feat(frontend): session module — refresh cookie + rotation-aware refresh"
```

---

## Task 7: API client (ApiError + interceptors + single-flight refresh)

**Files:**
- Rewrite: `frontend/lib/http/api-client.ts`
- Test: `frontend/lib/http/__tests__/api-client.test.ts`

**Interfaces:**
- Consumes: `clientEnv.apiUrl`, `token-store.getAccessToken`, `session` (`refreshSession`, `clearSession`), `ERROR_CODES`, `ErrorEnvelope`.
- Produces:
  - `class ApiError extends Error { code; statusCode; correlationId?; details?; get fieldErrors(): Record<string,string> }`
  - `apiClient: AxiosInstance`
  - `setUnauthorizedHandler(fn: () => void)` (defaults to `window.location.href = '/auth/login'`; the auth store overrides it in Task 9)

- [ ] **Step 1: Write the failing test `frontend/lib/http/__tests__/api-client.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { apiClient, ApiError, setUnauthorizedHandler } from '@/lib/http/api-client'
import { refreshClient, applyTokenPair, clearSession } from '@/lib/auth/session'
import { getAccessToken, setAccessToken } from '@/lib/http/token-store'

const api = new MockAdapter(apiClient)
const refresh = new MockAdapter(refreshClient)

beforeEach(() => {
  api.reset(); refresh.reset(); clearSession(); setAccessToken(null)
  setUnauthorizedHandler(() => {})
})

describe('ApiError mapping', () => {
  it('maps the backend error envelope', async () => {
    api.onGet('/x').reply(400, {
      error: {
        code: 'VALIDATION_FAILED', message: 'bad', statusCode: 400,
        details: { issues: [{ path: 'email', message: 'Invalid' }] },
        correlationId: 'cid', timestamp: 't', path: '/x',
      },
    })
    await expect(apiClient.get('/x')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED', statusCode: 400, correlationId: 'cid',
    })
    try {
      await apiClient.get('/x')
    } catch (e) {
      expect((e as ApiError).fieldErrors).toEqual({ email: 'Invalid' })
    }
  })
})

describe('single-flight refresh on AUTH_TOKEN_EXPIRED', () => {
  it('refreshes once and replays the original request', async () => {
    applyTokenPair({ accessToken: 'expired', refreshToken: 'r', expiresIn: 900 })
    let calls = 0
    api.onGet('/me').reply(() => {
      calls += 1
      if (calls === 1) {
        return [401, { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'x', statusCode: 401, details: null, correlationId: 'c', timestamp: 't', path: '/me' } }]
      }
      return [200, { id: 'u1', role: 'user' }]
    })
    refresh.onPost('/auth/refresh').reply(200, { accessToken: 'fresh', refreshToken: 'r2', expiresIn: 900 })

    const res = await apiClient.get('/me')
    expect(res.data).toEqual({ id: 'u1', role: 'user' })
    expect(getAccessToken()).toBe('fresh')
  })

  it('hard-logs-out when refresh fails', async () => {
    applyTokenPair({ accessToken: 'expired', refreshToken: 'r', expiresIn: 900 })
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    api.onGet('/me').reply(401, { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'x', statusCode: 401, details: null, correlationId: 'c', timestamp: 't', path: '/me' } })
    refresh.onPost('/auth/refresh').reply(401, { error: { code: 'AUTH_TOKEN_REUSE', message: 'x', statusCode: 401, details: null, correlationId: 'c', timestamp: 't', path: '/auth/refresh' } })

    await expect(apiClient.get('/me')).rejects.toBeInstanceOf(ApiError)
    expect(onUnauthorized).toHaveBeenCalled()
    expect(getAccessToken()).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- api-client`
Expected: FAIL.

- [ ] **Step 3: Rewrite `frontend/lib/http/api-client.ts`**

```ts
import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { clientEnv } from '@/lib/config/env'
import { ERROR_CODES } from '@/lib/config/constants'
import { getAccessToken } from '@/lib/http/token-store'
import { refreshSession, clearSession } from '@/lib/auth/session'
import type { ErrorEnvelope } from '@/lib/interfaces/auth.interface'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly correlationId?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Field-level messages parsed from a VALIDATION_FAILED envelope. path → message. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    const d = this.details as { issues?: { path: string; message: string }[] } | null | undefined
    if (d && Array.isArray(d.issues)) {
      for (const issue of d.issues) {
        const key = issue.path && issue.path !== '(root)' ? issue.path : '_root'
        if (!(key in out)) out[key] = issue.message
      }
    }
    return out
  }
}

// Overridable so the auth store can wire "hard logout + redirect", and tests
// can assert it without touching window.location.
let onUnauthorized: () => void = () => {
  if (typeof window !== 'undefined') window.location.href = '/auth/login'
}
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: clientEnv.apiUrl, // NO /api prefix — backend routes are root-level
  headers: { 'Content-Type': 'application/json' },
})

// ── Request: inject bearer token ────────────────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Response: normalize errors + single-flight refresh ──────────────────────
function toApiError(error: AxiosError<ErrorEnvelope>): ApiError {
  const env = error.response?.data?.error
  if (env) return new ApiError(env.message, env.code, env.statusCode, env.correlationId, env.details)
  return new ApiError(error.message || 'Network error', 'NETWORK_ERROR', error.response?.status ?? 0)
}

let refreshPromise: Promise<unknown> | null = null

apiClient.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<ErrorEnvelope>) => {
    const apiError = toApiError(error)
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined

    const isExpired = apiError.code === ERROR_CODES.AUTH_TOKEN_EXPIRED
    if (isExpired && original && !original._retry) {
      original._retry = true
      try {
        refreshPromise = refreshPromise ?? refreshSession().finally(() => { refreshPromise = null })
        await refreshPromise
        return apiClient(original) // replay; request interceptor re-adds the fresh bearer
      } catch {
        clearSession()
        onUnauthorized()
        return Promise.reject(apiError)
      }
    }

    // Non-refreshable auth failures → hard logout.
    if (apiError.statusCode === 401 && apiError.code !== ERROR_CODES.AUTH_INVALID_CREDENTIALS) {
      clearSession()
      onUnauthorized()
    }
    return Promise.reject(apiError)
  },
)
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- api-client`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/http/api-client.ts frontend/lib/http/__tests__/api-client.test.ts
git commit -m "feat(frontend): api-client with error envelope + single-flight refresh"
```

---

## Task 8: Auth service

**Files:**
- Rewrite: `frontend/lib/services/auth.service.ts`
- Test: `frontend/lib/services/__tests__/auth.service.test.ts`

**Interfaces:**
- Consumes: `apiClient`, `CurrentUser`, `SessionSummary`, `TokenPair`, `ILoginInput`, `IResetPasswordInput`.
- Produces `authService` with: `login(input): Promise<TokenPair>`, `logout(refreshToken): Promise<void>`, `logoutAll(): Promise<void>`, `getMe(): Promise<CurrentUser>`, `getSessions(): Promise<SessionSummary[]>`, `changePassword(currentPassword, newPassword): Promise<void>`, `forgotPassword(email): Promise<void>`, `resetPassword(input): Promise<void>`.

- [ ] **Step 1: Write the failing test `frontend/lib/services/__tests__/auth.service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/lib/http/api-client'
import { authService } from '@/lib/services/auth.service'

const mock = new MockAdapter(apiClient)
beforeEach(() => mock.reset())

describe('authService', () => {
  it('login posts credentials and returns the token pair', async () => {
    mock.onPost('/auth/login').reply(200, { accessToken: 'a', refreshToken: 'r', expiresIn: 900 })
    const pair = await authService.login({ email: 'a@b.com', password: 'pw' })
    expect(pair.accessToken).toBe('a')
  })
  it('getMe returns the current user', async () => {
    mock.onGet('/auth/me').reply(200, { id: 'u1', role: 'admin' })
    expect(await authService.getMe()).toEqual({ id: 'u1', role: 'admin' })
  })
  it('getSessions returns the session list', async () => {
    mock.onGet('/auth/sessions').reply(200, [{ id: 's1', createdAt: 't', lastUsedAt: null, expiresAt: 't', userAgent: null, ip: null }])
    expect(await authService.getSessions()).toHaveLength(1)
  })
  it('changePassword PATCHes the password endpoint', async () => {
    mock.onPatch('/auth/password').reply(204)
    await expect(authService.changePassword('old', 'newnewnewnew')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- auth.service`
Expected: FAIL.

- [ ] **Step 3: Rewrite `frontend/lib/services/auth.service.ts`**

```ts
import { apiClient } from '@/lib/http/api-client'
import type {
  CurrentUser, SessionSummary, TokenPair, ILoginInput, IResetPasswordInput,
} from '@/lib/interfaces/auth.interface'

export const authService = {
  login(input: ILoginInput): Promise<TokenPair> {
    return apiClient.post<TokenPair>('/auth/login', input).then((r) => r.data)
  },
  logout(refreshToken: string): Promise<void> {
    return apiClient.post('/auth/logout', { refreshToken }).then(() => undefined)
  },
  logoutAll(): Promise<void> {
    return apiClient.post('/auth/logout-all').then(() => undefined)
  },
  getMe(): Promise<CurrentUser> {
    return apiClient.get<CurrentUser>('/auth/me').then((r) => r.data)
  },
  getSessions(): Promise<SessionSummary[]> {
    return apiClient.get<SessionSummary[]>('/auth/sessions').then((r) => r.data)
  },
  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return apiClient.patch('/auth/password', { currentPassword, newPassword }).then(() => undefined)
  },
  forgotPassword(email: string): Promise<void> {
    return apiClient.post('/auth/forgot-password', { email }).then(() => undefined)
  },
  resetPassword(input: IResetPasswordInput): Promise<void> {
    return apiClient.post('/auth/reset-password', input).then(() => undefined)
  },
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- auth.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/services/auth.service.ts frontend/lib/services/__tests__/auth.service.test.ts
git commit -m "feat(frontend): auth service on real /auth/* routes"
```

---

## Task 9: Auth store (Zustand)

**Files:**
- Rewrite: `frontend/lib/state-management/auth.store.ts`
- Test: `frontend/lib/state-management/__tests__/auth.store.test.ts`

**Interfaces:**
- Consumes: `authService`, `session` (`applyTokenPair`, `clearSession`, `getRefreshToken`, `refreshSession`), `setUnauthorizedHandler`, `IAuthState`, `ApiError`.
- Produces: `useAuthStore` and selector hooks `useUser`, `useAuthStatus`, `useIsAuthenticated`, `useAuthLoading`, `useAuthError`, `useUserRole`. Also `wireAuthUnauthorizedHandler()` (idempotent) that registers the store's hard-logout with `setUnauthorizedHandler`.

- [ ] **Step 1: Write the failing test `frontend/lib/state-management/__tests__/auth.store.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/services/auth.service', () => ({
  authService: {
    login: vi.fn(),
    getMe: vi.fn(),
    logout: vi.fn(),
  },
}))
vi.mock('@/lib/auth/session', () => ({
  applyTokenPair: vi.fn(),
  clearSession: vi.fn(),
  getRefreshToken: vi.fn(),
  refreshSession: vi.fn(),
}))

import { useAuthStore } from '@/lib/state-management/auth.store'
import { authService } from '@/lib/services/auth.service'
import { applyTokenPair, getRefreshToken, refreshSession } from '@/lib/auth/session'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, status: 'idle', isLoading: false, error: null })
})

describe('auth.store', () => {
  it('login stores the token pair and hydrates the user', async () => {
    ;(authService.login as any).mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })
    ;(authService.getMe as any).mockResolvedValue({ id: 'u1', role: 'user' })

    await useAuthStore.getState().login({ email: 'a@b.com', password: 'pw' })

    expect(applyTokenPair).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })
    expect(useAuthStore.getState().user).toEqual({ id: 'u1', role: 'user' })
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('bootstrap with no refresh token → unauthenticated', async () => {
    ;(getRefreshToken as any).mockReturnValue(undefined)
    await useAuthStore.getState().bootstrap()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('bootstrap with a refresh token refreshes then loads the user', async () => {
    ;(getRefreshToken as any).mockReturnValue('r')
    ;(refreshSession as any).mockResolvedValue({ accessToken: 'a', refreshToken: 'r2', expiresIn: 900 })
    ;(authService.getMe as any).mockResolvedValue({ id: 'u1', role: 'admin' })
    await useAuthStore.getState().bootstrap()
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().user?.role).toBe('admin')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- auth.store`
Expected: FAIL.

- [ ] **Step 3: Rewrite `frontend/lib/state-management/auth.store.ts`**

```ts
'use client'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError, setUnauthorizedHandler } from '@/lib/http/api-client'
import { authService } from '@/lib/services/auth.service'
import {
  applyTokenPair, clearSession, getRefreshToken, refreshSession,
} from '@/lib/auth/session'
import type { IAuthState, IResetPasswordInput, Role } from '@/lib/interfaces/auth.interface'

const INITIAL = {
  user: null,
  status: 'idle' as const,
  isLoading: false,
  error: null,
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export const useAuthStore = create<IAuthState>()(
  devtools(
    (set, get) => ({
      ...INITIAL,

      clearError: () => set({ error: null }, false, 'auth/clearError'),

      login: async (input) => {
        set({ isLoading: true, error: null }, false, 'auth/login/pending')
        try {
          const pair = await authService.login(input)
          applyTokenPair(pair)
          const user = await authService.getMe()
          set({ user, status: 'authenticated', isLoading: false }, false, 'auth/login/ok')
        } catch (err) {
          set({ error: messageOf(err, 'Login failed'), isLoading: false }, false, 'auth/login/err')
          throw err
        }
      },

      logout: async () => {
        const rt = getRefreshToken()
        try {
          if (rt) await authService.logout(rt)
        } catch {
          // best-effort; continue local cleanup
        } finally {
          clearSession()
          set({ ...INITIAL, status: 'unauthenticated' }, false, 'auth/logout')
        }
      },

      logoutAll: async () => {
        try {
          await authService.logoutAll()
        } finally {
          clearSession()
          set({ ...INITIAL, status: 'unauthenticated' }, false, 'auth/logoutAll')
        }
      },

      bootstrap: async () => {
        if (!getRefreshToken()) {
          set({ status: 'unauthenticated' }, false, 'auth/bootstrap/anon')
          return
        }
        set({ status: 'loading' }, false, 'auth/bootstrap/pending')
        try {
          await refreshSession()
          const user = await authService.getMe()
          set({ user, status: 'authenticated' }, false, 'auth/bootstrap/ok')
        } catch {
          clearSession()
          set({ ...INITIAL, status: 'unauthenticated' }, false, 'auth/bootstrap/fail')
        }
      },

      changePassword: async (currentPassword, newPassword) => {
        set({ isLoading: true, error: null }, false, 'auth/changePassword/pending')
        try {
          await authService.changePassword(currentPassword, newPassword)
          // Backend revokes ALL sessions → force a clean re-login.
          clearSession()
          set({ ...INITIAL, status: 'unauthenticated' }, false, 'auth/changePassword/ok')
        } catch (err) {
          set({ error: messageOf(err, 'Password change failed'), isLoading: false }, false, 'auth/changePassword/err')
          throw err
        }
      },

      forgotPassword: async (email) => {
        set({ isLoading: true, error: null }, false, 'auth/forgotPassword/pending')
        try {
          await authService.forgotPassword(email)
          set({ isLoading: false }, false, 'auth/forgotPassword/ok')
        } catch (err) {
          set({ error: messageOf(err, 'Request failed'), isLoading: false }, false, 'auth/forgotPassword/err')
          throw err
        }
      },

      resetPassword: async (input: IResetPasswordInput) => {
        set({ isLoading: true, error: null }, false, 'auth/resetPassword/pending')
        try {
          await authService.resetPassword(input)
          set({ isLoading: false }, false, 'auth/resetPassword/ok')
        } catch (err) {
          set({ error: messageOf(err, 'Password reset failed'), isLoading: false }, false, 'auth/resetPassword/err')
          throw err
        }
      },
    }),
    { name: 'AuthStore', enabled: process.env.NODE_ENV === 'development' },
  ),
)

// Register the hard-logout handler the api-client calls on unrecoverable 401s.
let wired = false
export function wireAuthUnauthorizedHandler(): void {
  if (wired) return
  wired = true
  setUnauthorizedHandler(() => {
    clearSession()
    useAuthStore.setState({ user: null, status: 'unauthenticated', isLoading: false })
    if (typeof window !== 'undefined') window.location.href = '/auth/login'
  })
}

// ── selectors ───────────────────────────────────────────────────────────────
export const useUser = () => useAuthStore((s) => s.user)
export const useAuthStatus = () => useAuthStore((s) => s.status)
export const useIsAuthenticated = () => useAuthStore((s) => s.status === 'authenticated')
export const useAuthLoading = () => useAuthStore((s) => s.isLoading)
export const useAuthError = () => useAuthStore((s) => s.error)
export const useUserRole = (): Role | undefined => useAuthStore((s) => s.user?.role)
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `npm run test -- auth.store && npm run typecheck`
Expected: tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/state-management/auth.store.ts frontend/lib/state-management/__tests__/auth.store.test.ts
git commit -m "feat(frontend): rewrite auth store (login/logout/bootstrap/change-password)"
```

---

## Task 10: Role hooks + route policy

**Files:**
- Rewrite: `frontend/lib/hooks/use-permission.ts`
- Create: `frontend/lib/auth/route-policy.ts`
- Test: `frontend/lib/auth/__tests__/route-policy.test.ts`

**Interfaces:**
- Produces (`use-permission.ts`): `useHasRole(role: Role): boolean`, `useHasAnyRole(roles: Role[]): boolean`, `useIsAdmin(): boolean`.
- Produces (`route-policy.ts`): `AUTH_ROUTES: string[]`, `ADMIN_ROUTES: string[]`, `isAuthRoute(pathname): boolean`, `isProtectedRoute(pathname): boolean`, `isAdminRoute(pathname): boolean`, `LOGIN_PATH = '/auth/login'`, `DEFAULT_AUTHED_PATH = '/dashboard'`.

- [ ] **Step 1: Write the failing test `frontend/lib/auth/__tests__/route-policy.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { isAuthRoute, isProtectedRoute, isAdminRoute } from '@/lib/auth/route-policy'

describe('route-policy', () => {
  it('recognizes auth routes', () => {
    expect(isAuthRoute('/auth/login')).toBe(true)
    expect(isAuthRoute('/auth/reset-password')).toBe(true)
    expect(isAuthRoute('/dashboard')).toBe(false)
  })
  it('treats non-public app routes as protected', () => {
    expect(isProtectedRoute('/dashboard')).toBe(true)
    expect(isProtectedRoute('/account')).toBe(true)
    expect(isProtectedRoute('/auth/login')).toBe(false)
    expect(isProtectedRoute('/')).toBe(false)
  })
  it('recognizes admin routes', () => {
    expect(isAdminRoute('/admin/users')).toBe(true)
    expect(isAdminRoute('/dashboard')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- route-policy`
Expected: FAIL.

- [ ] **Step 3: Create `frontend/lib/auth/route-policy.ts`**

```ts
export const LOGIN_PATH = '/auth/login'
export const DEFAULT_AUTHED_PATH = '/dashboard'

/** Routes reachable WITHOUT a session (the auth flow). */
export const AUTH_ROUTES = ['/auth/login', '/auth/forgot-password', '/auth/reset-password']

/** Public routes that are neither auth nor protected (e.g. the marketing landing). */
export const PUBLIC_ROUTES = ['/']

/** Admin-only route prefixes (client gate; backend RolesGuard is authoritative). */
export const ADMIN_ROUTES = ['/admin']

const startsWithAny = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))

export function isAuthRoute(pathname: string): boolean {
  return startsWithAny(pathname, AUTH_ROUTES)
}

export function isAdminRoute(pathname: string): boolean {
  return startsWithAny(pathname, ADMIN_ROUTES)
}

/** Everything that is not public and not an auth route requires a session. */
export function isProtectedRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return false
  if (isAuthRoute(pathname)) return false
  return true
}
```

- [ ] **Step 4: Rewrite `frontend/lib/hooks/use-permission.ts`**

```ts
import { useAuthStore } from '@/lib/state-management/auth.store'
import type { Role } from '@/lib/interfaces/auth.interface'

export function useHasRole(role: Role): boolean {
  return useAuthStore((s) => s.user?.role === role)
}

export function useHasAnyRole(roles: Role[]): boolean {
  return useAuthStore((s) => (s.user ? roles.includes(s.user.role) : false))
}

export function useIsAdmin(): boolean {
  return useHasRole('admin')
}
```

- [ ] **Step 5: Run to verify it passes + typecheck**

Run: `npm run test -- route-policy && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/auth/route-policy.ts frontend/lib/auth/__tests__/route-policy.test.ts frontend/lib/hooks/use-permission.ts
git commit -m "feat(frontend): role hooks + shared route policy"
```

---

## Task 11: Route-guard middleware

**Files:**
- Create: `frontend/middleware.ts`
- Test: `frontend/__tests__/middleware.test.ts`

**Interfaces:**
- Consumes: `route-policy` (`isProtectedRoute`, `isAuthRoute`, `LOGIN_PATH`, `DEFAULT_AUTHED_PATH`), `REFRESH_COOKIE`.
- Produces: `default middleware(req)`, `config.matcher`.

- [ ] **Step 1: Write the failing test `frontend/__tests__/middleware.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import middleware from '@/middleware'
import { REFRESH_COOKIE } from '@/lib/config/constants'

function req(path: string, opts?: { authed?: boolean }) {
  const r = new NextRequest(new URL(`http://localhost${path}`))
  if (opts?.authed) r.cookies.set(REFRESH_COOKIE, 'r')
  return r
}

describe('middleware', () => {
  it('redirects unauthenticated users away from protected routes', () => {
    const res = middleware(req('/dashboard'))
    expect(res.status).toBe(307)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/auth/login')
    expect(loc).toContain('callbackUrl=%2Fdashboard')
  })
  it('lets authenticated users into protected routes', () => {
    const res = middleware(req('/dashboard', { authed: true }))
    expect(res.headers.get('location')).toBeNull()
  })
  it('redirects authenticated users away from auth pages', () => {
    const res = middleware(req('/auth/login', { authed: true }))
    expect(res.headers.get('location')).toContain('/dashboard')
  })
  it('leaves the public landing alone', () => {
    const res = middleware(req('/'))
    expect(res.headers.get('location')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- middleware`
Expected: FAIL.

- [ ] **Step 3: Create `frontend/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { REFRESH_COOKIE } from '@/lib/config/constants'
import {
  isAuthRoute, isProtectedRoute, LOGIN_PATH, DEFAULT_AUTHED_PATH,
} from '@/lib/auth/route-policy'

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const hasSession = req.cookies.has(REFRESH_COOKIE)

  // Authenticated users should not sit on auth pages.
  if (hasSession && isAuthRoute(pathname)) {
    return NextResponse.redirect(new URL(DEFAULT_AUTHED_PATH, req.url))
  }

  // Unauthenticated users cannot reach protected pages.
  if (!hasSession && isProtectedRoute(pathname)) {
    const url = new URL(LOGIN_PATH, req.url)
    url.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  // Exclude Next internals, the API-core proxy, and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- middleware`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/middleware.ts frontend/__tests__/middleware.test.ts
git commit -m "feat(frontend): coarse route-guard middleware"
```

---

## Task 12: Providers + layout + SWR fetcher

**Files:**
- Rewrite: `frontend/components/providers/auth-provider.tsx`
- Create: `frontend/components/providers/swr-provider.tsx`, `frontend/lib/hooks/swr-fetcher.ts`
- Modify: `frontend/app/layout.tsx`, `frontend/lib/interfaces/app.interface.ts`, `frontend/lib/state-management/app.store.ts`, `frontend/next.config.mjs`
- Test: `frontend/components/providers/__tests__/auth-provider.test.tsx`

**Interfaces:**
- Consumes: `useAuthStore.bootstrap`, `wireAuthUnauthorizedHandler`, `apiClient`.
- Produces: `<AuthProvider>`, `<SwrProvider>`, `swrFetcher(url)`.

- [ ] **Step 1: Create `frontend/lib/hooks/swr-fetcher.ts`**

```ts
import { apiClient } from '@/lib/http/api-client'

/** Default SWR fetcher — GET through the shared api-client (bearer + refresh). */
export const swrFetcher = <T>(url: string): Promise<T> =>
  apiClient.get<T>(url).then((r) => r.data)
```

- [ ] **Step 2: Create `frontend/components/providers/swr-provider.tsx`**

```tsx
'use client'

import { SWRConfig } from 'swr'
import { swrFetcher } from '@/lib/hooks/swr-fetcher'

export function SwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher: swrFetcher, revalidateOnFocus: false, shouldRetryOnError: false }}>
      {children}
    </SWRConfig>
  )
}
```

- [ ] **Step 3: Rewrite `frontend/components/providers/auth-provider.tsx`**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore, wireAuthUnauthorizedHandler } from '@/lib/state-management/auth.store'

/** Wires the unauthorized handler and bootstraps the session once per load. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const started = useRef(false)
  const bootstrap = useAuthStore((s) => s.bootstrap)

  useEffect(() => {
    if (started.current) return
    started.current = true
    wireAuthUnauthorizedHandler()
    void bootstrap()
  }, [bootstrap])

  return <>{children}</>
}
```

- [ ] **Step 4: Write the failing test `frontend/components/providers/__tests__/auth-provider.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { AuthProvider } from '@/components/providers/auth-provider'
import { useAuthStore } from '@/lib/state-management/auth.store'

beforeEach(() => {
  useAuthStore.setState({ status: 'idle' })
})

describe('AuthProvider', () => {
  it('calls bootstrap once on mount', () => {
    const spy = vi.spyOn(useAuthStore.getState(), 'bootstrap').mockResolvedValue()
    render(<AuthProvider><div>child</div></AuthProvider>)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 5: Run to verify it fails, then passes after Steps 1-3**

Run: `npm run test -- auth-provider`
Expected: PASS (module exists after Steps 1-3).

- [ ] **Step 6: Update `frontend/app/layout.tsx`** (mount providers + Toaster)

Replace the body/provider tree with:
```tsx
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { cn } from '@/lib/utils'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/components/providers/auth-provider'
import { SwrProvider } from '@/components/providers/swr-provider'
import { Toaster } from 'sonner'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })
const fontMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn('antialiased', fontMono.variable, 'font-sans', geist.variable)}>
      <body>
        <ThemeProvider>
          <SwrProvider>
            <AuthProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </AuthProvider>
          </SwrProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 7: Correct `app.interface.ts` + `app.store.ts`**

In `frontend/lib/interfaces/app.interface.ts`, change `projectId: number | null` → `projectId: string | null`.
In `frontend/lib/state-management/app.store.ts`, `INITIAL_ACTIVE_CONTEXT.projectId` stays `null` (already correct); no other change needed beyond the type.

- [ ] **Step 8: Remove the stale redirect in `frontend/next.config.mjs`**

Replace the file with:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {}

export default nextConfig
```

- [ ] **Step 9: Run tests + typecheck**

Run: `npm run test && npm run typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add frontend/components/providers/ frontend/lib/hooks/swr-fetcher.ts frontend/app/layout.tsx frontend/lib/interfaces/app.interface.ts frontend/lib/state-management/app.store.ts frontend/next.config.mjs
git commit -m "feat(frontend): auth + swr providers, mount toaster, drop stale redirect"
```

---

## Task 13: Client guards

**Files:**
- Create: `frontend/lib/auth/guards.tsx`
- Test: `frontend/lib/auth/__tests__/guards.test.tsx`

**Interfaces:**
- Consumes: `useAuthStore`, `useUserRole`, `next/navigation` (`useRouter`, `usePathname`), `route-policy`.
- Produces: `useRequireAuth(): { ready: boolean }`, `useRequireRole(role: Role): { ready: boolean; allowed: boolean }`, `<AuthGuard>` (renders children only when authenticated), `<RoleGuard role>`.

- [ ] **Step 1: Write the failing test `frontend/lib/auth/__tests__/guards.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthGuard } from '@/lib/auth/guards'
import { useAuthStore } from '@/lib/state-management/auth.store'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/dashboard',
}))

beforeEach(() => {
  replace.mockClear()
  useAuthStore.setState({ user: null, status: 'idle', isLoading: false, error: null })
})

describe('AuthGuard', () => {
  it('renders nothing while status is loading', () => {
    useAuthStore.setState({ status: 'loading' })
    const { container } = render(<AuthGuard><div>secret</div></AuthGuard>)
    expect(container.textContent).not.toContain('secret')
  })
  it('renders children when authenticated', () => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 'u', role: 'user' } })
    render(<AuthGuard><div>secret</div></AuthGuard>)
    expect(screen.getByText('secret')).toBeInTheDocument()
  })
  it('redirects to login when unauthenticated', () => {
    useAuthStore.setState({ status: 'unauthenticated' })
    render(<AuthGuard><div>secret</div></AuthGuard>)
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('/auth/login'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- guards`
Expected: FAIL.

- [ ] **Step 3: Create `frontend/lib/auth/guards.tsx`**

```tsx
'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore, useUserRole } from '@/lib/state-management/auth.store'
import { LOGIN_PATH, DEFAULT_AUTHED_PATH } from '@/lib/auth/route-policy'
import type { Role } from '@/lib/interfaces/auth.interface'

export function useRequireAuth(): { ready: boolean } {
  const status = useAuthStore((s) => s.status)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (status === 'unauthenticated') {
      const url = `${LOGIN_PATH}?callbackUrl=${encodeURIComponent(pathname)}`
      router.replace(url)
    }
  }, [status, router, pathname])

  return { ready: status === 'authenticated' }
}

export function useRequireRole(role: Role): { ready: boolean; allowed: boolean } {
  const { ready } = useRequireAuth()
  const currentRole = useUserRole()
  const router = useRouter()
  const allowed = currentRole === role

  useEffect(() => {
    if (ready && !allowed) router.replace(DEFAULT_AUTHED_PATH)
  }, [ready, allowed, router])

  return { ready: ready && allowed, allowed }
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { ready } = useRequireAuth()
  if (!ready) return null
  return <>{children}</>
}

export function RoleGuard({ role, children }: { role: Role; children: React.ReactNode }) {
  const { ready } = useRequireRole(role)
  if (!ready) return null
  return <>{children}</>
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- guards`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/auth/guards.tsx frontend/lib/auth/__tests__/guards.test.tsx
git commit -m "feat(frontend): client auth + role guards"
```

---

## Task 14: Auth pages — login, forgot-password, reset-password

**Files:**
- Rewrite: `frontend/components/login-form.tsx`, `frontend/app/auth/forgot-password/page.tsx`, `frontend/app/auth/reset-password/page.tsx`
- Test: `frontend/components/__tests__/login-form.test.tsx`

**Interfaces:**
- Consumes: `useAuthStore` (`login`, `forgotPassword`, `resetPassword`), the Zod schemas, `react-hook-form`, `@hookform/resolvers/zod`, `ApiError`, `scorePassword`.
- Produces: rewired `<LoginForm>` (no Google button), forgot/reset pages backed by the real flow.

- [ ] **Step 1: Write the failing test `frontend/components/__tests__/login-form.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginForm } from '@/components/login-form'
import { useAuthStore } from '@/lib/state-management/auth.store'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

beforeEach(() => {
  useAuthStore.setState({ status: 'idle', isLoading: false, error: null })
})

describe('LoginForm', () => {
  it('has no Google login button', () => {
    render(<LoginForm />)
    expect(screen.queryByText(/Google/i)).not.toBeInTheDocument()
  })
  it('validates email format before calling login', async () => {
    const login = vi.spyOn(useAuthStore.getState(), 'login').mockResolvedValue()
    render(<LoginForm />)
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /login/i }))
    expect(login).not.toHaveBeenCalled()
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument()
  })
  it('calls login with valid credentials', async () => {
    const login = vi.spyOn(useAuthStore.getState(), 'login').mockResolvedValue()
    render(<LoginForm />)
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /login/i }))
    expect(login).toHaveBeenCalledWith({ email: 'a@b.com', password: 'secret' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- login-form`
Expected: FAIL (old form still has Google button / raw useState).

- [ ] **Step 3: Rewrite `frontend/components/login-form.tsx`**

```tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { loginSchema, type LoginFormValues } from '@/lib/validations/auth.schema'
import { ApiError } from '@/lib/http/api-client'

export function LoginForm({ className, ...props }: React.ComponentProps<'div'>) {
  const searchParams = useSearchParams()
  const login = useAuthStore((s) => s.login)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: LoginFormValues) => {
    try {
      await login(values)
      const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard'
      // Hard navigation so the fresh refresh cookie reaches the middleware.
      window.location.href = callbackUrl
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Invalid email or password.'
      toast.error(message)
    }
  }

  const { isSubmitting } = form.formState

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>Sign in with your email and password</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              <Field data-invalid={form.formState.errors.email ? 'true' : undefined}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" type="email" autoComplete="email"
                  placeholder="m@example.com" {...form.register('email')} />
                {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
              </Field>

              <Field data-invalid={form.formState.errors.password ? 'true' : undefined}>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <a href="/auth/forgot-password" className="ml-auto text-sm underline-offset-4 hover:underline">
                    Forgot your password?
                  </a>
                </div>
                <Input id="password" type="password" autoComplete="current-password"
                  {...form.register('password')} />
                {form.formState.errors.password && <FieldError>{form.formState.errors.password.message}</FieldError>}
              </Field>

              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Signing in…' : 'Login'}
                </Button>
                <FieldDescription className="text-center">
                  Accounts are provisioned by an administrator.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Rewrite `frontend/app/auth/forgot-password/page.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '@/lib/validations/auth.schema'

export default function ForgotPasswordPage() {
  const forgotPassword = useAuthStore((s) => s.forgotPassword)
  const [sent, setSent] = useState(false)
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    // Backend always returns 204 (no account enumeration); show the same message either way.
    try { await forgotPassword(values.email) } catch { /* swallow */ }
    setSent(true)
    toast.success('If that email exists, a reset code has been sent.')
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Reset your password</CardTitle>
            <CardDescription>We&apos;ll email you a 6-digit code</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <p className="text-sm text-muted-foreground">
                Check your inbox for a reset code, then{' '}
                <a className="underline" href="/auth/reset-password">enter it here</a>.
              </p>
            ) : (
              <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
                <FieldGroup>
                  <Field data-invalid={form.formState.errors.email ? 'true' : undefined}>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
                    {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
                  </Field>
                  <Button type="submit" disabled={form.formState.isSubmitting}>Send reset code</Button>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Rewrite `frontend/app/auth/reset-password/page.tsx`**

```tsx
'use client'

import { Suspense } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { resetPasswordSchema, type ResetPasswordFormValues } from '@/lib/validations/auth.schema'
import { scorePassword } from '@/lib/auth/password-strength'
import { ApiError } from '@/lib/http/api-client'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resetPassword = useAuthStore((s) => s.resetPassword)

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: searchParams.get('email') ?? '', code: '', newPassword: '', confirmPassword: '' },
  })

  const pw = form.watch('newPassword')
  const strength = scorePassword(pw)

  const onSubmit = async (values: ResetPasswordFormValues) => {
    try {
      await resetPassword({ email: values.email, code: values.code, newPassword: values.newPassword })
      toast.success('Password reset. Please sign in.')
      router.replace('/auth/login')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Reset failed. Check your code and try again.')
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={form.formState.errors.email ? 'true' : undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
        </Field>
        <Field data-invalid={form.formState.errors.code ? 'true' : undefined}>
          <FieldLabel htmlFor="code">6-digit code</FieldLabel>
          <Input id="code" inputMode="numeric" maxLength={6} {...form.register('code')} />
          {form.formState.errors.code && <FieldError>{form.formState.errors.code.message}</FieldError>}
        </Field>
        <Field data-invalid={form.formState.errors.newPassword ? 'true' : undefined}>
          <FieldLabel htmlFor="newPassword">New password</FieldLabel>
          <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
          {pw && <p className="text-xs text-muted-foreground">Strength: {strength.label}</p>}
          {form.formState.errors.newPassword && <FieldError>{form.formState.errors.newPassword.message}</FieldError>}
        </Field>
        <Field data-invalid={form.formState.errors.confirmPassword ? 'true' : undefined}>
          <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
          {form.formState.errors.confirmPassword && <FieldError>{form.formState.errors.confirmPassword.message}</FieldError>}
        </Field>
        <Button type="submit" disabled={form.formState.isSubmitting}>Reset password</Button>
      </FieldGroup>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Set a new password</CardTitle>
            <CardDescription>Enter the code we emailed you</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense><ResetPasswordForm /></Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run test -- login-form && npm run typecheck`
Expected: tests PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/login-form.tsx frontend/app/auth/forgot-password/page.tsx frontend/app/auth/reset-password/page.tsx frontend/components/__tests__/login-form.test.tsx
git commit -m "feat(frontend): rewire login + forgot/reset password to real flow"
```

---

## Task 15: Account page (change password + sessions)

> Per design §13 open item 2, session management is in v1. If the user later defers it, keep only the change-password card.

**Files:**
- Create: `frontend/app/(protected)/account/page.tsx`, `frontend/app/(protected)/layout.tsx`, `frontend/components/account/change-password-card.tsx`, `frontend/components/account/sessions-card.tsx`, `frontend/lib/hooks/use-sessions.ts`
- Test: `frontend/components/account/__tests__/change-password-card.test.tsx`

**Interfaces:**
- Consumes: `useAuthStore.changePassword`, `authService.getSessions`/`logoutAll`, SWR, `AuthGuard`, `scorePassword`.
- Produces: `useSessions()` (SWR hook) returning `{ sessions, isLoading, mutate }`.

- [ ] **Step 1: Create `frontend/app/(protected)/layout.tsx`** (guarded segment)

```tsx
'use client'
import { AuthGuard } from '@/lib/auth/guards'

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>
}
```

- [ ] **Step 2: Create `frontend/lib/hooks/use-sessions.ts`**

```ts
import useSWR from 'swr'
import type { SessionSummary } from '@/lib/interfaces/auth.interface'

export function useSessions() {
  const { data, isLoading, mutate } = useSWR<SessionSummary[]>('/auth/sessions')
  return { sessions: data ?? [], isLoading, mutate }
}
```

- [ ] **Step 3: Write the failing test `frontend/components/account/__tests__/change-password-card.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChangePasswordCard } from '@/components/account/change-password-card'
import { useAuthStore } from '@/lib/state-management/auth.store'

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', isLoading: false, error: null })
})

describe('ChangePasswordCard', () => {
  it('rejects a new password under 12 chars', async () => {
    const changePassword = vi.spyOn(useAuthStore.getState(), 'changePassword').mockResolvedValue()
    render(<ChangePasswordCard />)
    await userEvent.type(screen.getByLabelText(/current password/i), 'oldpassword12')
    await userEvent.type(screen.getByLabelText(/^new password/i), 'short')
    await userEvent.type(screen.getByLabelText(/confirm/i), 'short')
    await userEvent.click(screen.getByRole('button', { name: /change password/i }))
    expect(changePassword).not.toHaveBeenCalled()
    expect(await screen.findByText(/at least 12 characters/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm run test -- change-password-card`
Expected: FAIL.

- [ ] **Step 5: Create `frontend/components/account/change-password-card.tsx`**

```tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { changePasswordSchema, type ChangePasswordFormValues } from '@/lib/validations/auth.schema'
import { scorePassword } from '@/lib/auth/password-strength'
import { ApiError } from '@/lib/http/api-client'

export function ChangePasswordCard() {
  const changePassword = useAuthStore((s) => s.changePassword)
  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })
  const strength = scorePassword(form.watch('newPassword'))

  const onSubmit = async (values: ChangePasswordFormValues) => {
    try {
      await changePassword(values.currentPassword, values.newPassword)
      // changePassword revokes all sessions + clears local state; send to login.
      toast.success('Password changed — please sign in again.')
      window.location.href = '/auth/login'
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change password.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>You&apos;ll be signed out of all sessions afterwards.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Field data-invalid={form.formState.errors.currentPassword ? 'true' : undefined}>
              <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
              <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
              {form.formState.errors.currentPassword && <FieldError>{form.formState.errors.currentPassword.message}</FieldError>}
            </Field>
            <Field data-invalid={form.formState.errors.newPassword ? 'true' : undefined}>
              <FieldLabel htmlFor="newPassword">New password</FieldLabel>
              <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
              {form.watch('newPassword') && <p className="text-xs text-muted-foreground">Strength: {strength.label}</p>}
              {form.formState.errors.newPassword && <FieldError>{form.formState.errors.newPassword.message}</FieldError>}
            </Field>
            <Field data-invalid={form.formState.errors.confirmPassword ? 'true' : undefined}>
              <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
              <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
              {form.formState.errors.confirmPassword && <FieldError>{form.formState.errors.confirmPassword.message}</FieldError>}
            </Field>
            <Button type="submit" disabled={form.formState.isSubmitting}>Change password</Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 6: Create `frontend/components/account/sessions-card.tsx`**

```tsx
'use client'

import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSessions } from '@/lib/hooks/use-sessions'
import { authService } from '@/lib/services/auth.service'
import { useAuthStore } from '@/lib/state-management/auth.store'

export function SessionsCard() {
  const { sessions, isLoading, mutate } = useSessions()
  const logout = useAuthStore((s) => s.logout)

  const revokeAllOthers = async () => {
    try {
      await authService.logoutAll()
      toast.success('All sessions signed out. Please sign in again.')
      await logout()
      window.location.href = '/auth/login'
    } catch {
      toast.error('Could not revoke sessions.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices currently signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex justify-between gap-4 border-b pb-2">
                <span className="truncate">{s.userAgent ?? 'Unknown device'}</span>
                <span className="text-muted-foreground">{s.ip ?? '—'}</span>
              </li>
            ))}
            {sessions.length === 0 && <li className="text-muted-foreground">No sessions.</li>}
          </ul>
        )}
        <Button variant="destructive" onClick={revokeAllOthers}>Sign out of all sessions</Button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 7: Create `frontend/app/(protected)/account/page.tsx`**

```tsx
import { ChangePasswordCard } from '@/components/account/change-password-card'
import { SessionsCard } from '@/components/account/sessions-card'

export default function AccountPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Account</h1>
      <ChangePasswordCard />
      <SessionsCard />
    </div>
  )
}
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npm run test -- change-password-card && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add "frontend/app/(protected)" frontend/components/account/ frontend/lib/hooks/use-sessions.ts frontend/components/account/__tests__/
git commit -m "feat(frontend): account page — change password + session management"
```

---

## Task 16: Agent service + interface correction

**Files:**
- Create: `frontend/lib/services/agent.service.ts`
- Rewrite: `frontend/lib/interfaces/mastra.interface.ts`
- Test: `frontend/lib/services/__tests__/agent.service.test.ts`

**Interfaces:**
- Consumes: `apiClient`, `Paginated`.
- Produces: types `RunStatus`, `ActionType`, `ApprovalStatus`, `DeliveryChannel`, `PendingApproval`, `ChatResult`, `Conversation`; and `agentService` with `chat({conversationId?, message})`, `listConversations(page, limit)`, `listApprovals()`, `decideApproval(id, {approved, note?})`.

- [ ] **Step 1: Rewrite `frontend/lib/interfaces/mastra.interface.ts`** (replace fictional threads/messages types)

```ts
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled'
export type ActionType = 'send_email' | 'db_write' | 'external_api' | 'other'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed'
export type DeliveryChannel = 'conversation' | 'email' | 'none'

export interface PendingApproval {
  toolCallId: string
  actionType: ActionType
  title: string
  payload: Record<string, unknown>
}

export interface ChatResult {
  conversationId: string
  runId: string
  text: string
  pendingApprovals: PendingApproval[]
}

export interface Conversation {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Write the failing test `frontend/lib/services/__tests__/agent.service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/lib/http/api-client'
import { agentService } from '@/lib/services/agent.service'

const mock = new MockAdapter(apiClient)
beforeEach(() => mock.reset())

describe('agentService', () => {
  it('chat posts to /agent/chat', async () => {
    mock.onPost('/agent/chat').reply(200, { conversationId: 'c1', runId: 'r1', text: 'hi', pendingApprovals: [] })
    const res = await agentService.chat({ message: 'hello' })
    expect(res.conversationId).toBe('c1')
    expect(res.text).toBe('hi')
  })
  it('listConversations passes pagination', async () => {
    mock.onGet('/agent/conversations').reply((config) => {
      expect(config.params).toEqual({ page: 2, limit: 10 })
      return [200, { data: [], total: 0, page: 2, limit: 10 }]
    })
    const res = await agentService.listConversations(2, 10)
    expect(res.page).toBe(2)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -- agent.service`
Expected: FAIL.

- [ ] **Step 4: Create `frontend/lib/services/agent.service.ts`**

```ts
import { apiClient } from '@/lib/http/api-client'
import type { ChatResult, Conversation, PendingApproval } from '@/lib/interfaces/mastra.interface'
import type { Paginated } from '@/lib/interfaces/auth.interface'

export const agentService = {
  chat(input: { conversationId?: string; message: string }): Promise<ChatResult> {
    return apiClient.post<ChatResult>('/agent/chat', input).then((r) => r.data)
  },
  listConversations(page = 1, limit = 20): Promise<Paginated<Conversation>> {
    return apiClient
      .get<Paginated<Conversation>>('/agent/conversations', { params: { page, limit } })
      .then((r) => r.data)
  },
  listApprovals(): Promise<PendingApproval[]> {
    return apiClient.get<PendingApproval[]>('/agent/approvals').then((r) => r.data)
  },
  decideApproval(id: string, input: { approved: boolean; note?: string }): Promise<unknown> {
    return apiClient.post(`/agent/approvals/${id}`, input).then((r) => r.data)
  },
}
```

- [ ] **Step 5: Run to verify it passes + typecheck**

Run: `npm run test -- agent.service && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/services/agent.service.ts frontend/lib/interfaces/mastra.interface.ts frontend/lib/services/__tests__/agent.service.test.ts
git commit -m "feat(frontend): agent service on real /agent/* routes"
```

---

## Task 17: Dashboard shell + nav rewire

**Files:**
- Modify/Create: `frontend/app/dashboard/page.tsx`, `frontend/app/dashboard/layout.tsx`
- Test: `frontend/app/dashboard/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `AuthGuard`, `useUser`, `useAuthStore.logout`.
- Produces: a minimal protected dashboard that proves the guard end-to-end and offers logout.

- [ ] **Step 1: Replace `frontend/app/dashboard/layout.tsx`** (guard the segment)

```tsx
'use client'
import { AuthGuard } from '@/lib/auth/guards'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>
}
```

- [ ] **Step 2: Replace `frontend/app/dashboard/page.tsx`** (minimal shell)

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { useUser, useAuthStore } from '@/lib/state-management/auth.store'
import { deriveDisplayName } from '@/lib/auth/display-name'

export default function DashboardPage() {
  const user = useUser()
  const logout = useAuthStore((s) => s.logout)
  return (
    <div className="flex min-h-svh flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">
        Signed in as <strong>{user ? deriveDisplayName(user) : '…'}</strong> ({user?.role})
      </p>
      <div className="flex gap-3">
        <Button asChild variant="outline"><a href="/account">Account</a></Button>
        <Button variant="destructive" onClick={() => { void logout().then(() => (window.location.href = '/auth/login')) }}>
          Log out
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `frontend/lib/auth/display-name.ts`**

```ts
import type { CurrentUser } from '@/lib/interfaces/auth.interface'

/** Stable label for a user without a display-name field. */
export function deriveDisplayName(user: CurrentUser): string {
  if (user.email) return user.email.split('@')[0]
  return 'User'
}
```

- [ ] **Step 4: Write the test `frontend/app/dashboard/__tests__/page.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import DashboardPage from '@/app/dashboard/page'
import { useAuthStore } from '@/lib/state-management/auth.store'

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', user: { id: 'u1', role: 'admin', email: 'jane@acme.com' } })
})

describe('DashboardPage', () => {
  it('shows the derived display name and role', () => {
    render(<DashboardPage />)
    expect(screen.getByText(/jane/)).toBeInTheDocument()
    expect(screen.getByText(/admin/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- dashboard && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/dashboard/layout.tsx frontend/app/dashboard/page.tsx frontend/lib/auth/display-name.ts frontend/app/dashboard/__tests__/
git commit -m "feat(frontend): minimal guarded dashboard shell + display-name helper"
```

---

## Task 18: Pruning (destructive) — remove fiction & demo scaffolding

> Do this LATE so nothing still imports the deleted files. Gate strictly on a green build + tests.

**Files (delete):**
- Domain state/services/interfaces (keep only `auth`, `app`, `shared`, `mastra`): `frontend/lib/state-management/{call,company,contact,cost,daily-event-generation,daily-summary,email,event,income,knowledge,notification,plan,project,scheduler,task}.store.ts`; same basenames under `frontend/lib/services/*.service.ts` (keep `auth.service.ts`, `agent.service.ts`); same basenames under `frontend/lib/interfaces/*.interface.ts` (keep `auth`, `app`, `shared`, `mastra`).
- `frontend/lib/services/mastra.service.ts` (replaced by `agent.service.ts`).
- `frontend/lib/sessionControl/` (vestigial).
- Auth pages/flows: `frontend/app/auth/signup/`, `frontend/app/auth/verify-email/`, `frontend/app/auth/resend-verification/`, `frontend/app/auth/callback/`.
- Demo components: `frontend/components/{signup-form,music-player,chart-area-interactive,section-cards,data-table,team-switcher,force-modal}.tsx`.
- Demo pages/mock data: `frontend/app/data-links/`, `frontend/app/data-links-modal/`, `frontend/app/home-page/`, `frontend/app/profile/`, `frontend/app/dashboard/data.json`, `frontend/app/dashboard/calls/`.
- Demo nav/sidebar chrome (wired to the removed `route` config + deleted domain stores; the v1 dashboard shell in Task 17 does not use them, so once the fiction layer is deleted they are orphaned AND break `tsc` because they import removed modules). Confirm orphaned/broken via the Step 1 grep, then remove: `frontend/components/{app-sidebar,nav-main,nav-user,nav-projects,nav-secondary,nav-documents,site-header}.tsx` and `frontend/lib/routes/routes.tsx`. Real navigation is rebuilt on live routes when domain features land (design §13). **Keep** generic pieces that do NOT import removed code: `theme-provider`, `global-loading`, `global-modal`; keep `notification-drawer`/`notification-panel` only if they don't import a deleted store — otherwise remove them too.

- [ ] **Step 1: Grep for references to each candidate before deleting**

Run (for each basename, e.g. `music-player`):
```bash
cd frontend
grep -rn "music-player\|team-switcher\|section-cards\|chart-area-interactive\|data-table\|force-modal\|signup-form\|sessionControl\|mastra.service\|/data-links\|home-page\|profile/settings" app components lib --include=*.ts --include=*.tsx | grep -v "__tests__"
```
Expected: any hit that is NOT itself a file being deleted must be resolved first (remove the import). Note: `app-sidebar`, `nav-*` may import deleted demo components — fix or delete those imports as encountered.

- [ ] **Step 2: Delete the fiction domain layer**

```bash
cd frontend
for n in call company contact cost daily-event-generation daily-summary email event income knowledge notification plan project scheduler task; do
  rm -f "lib/state-management/$n.store.ts" "lib/services/$n.service.ts" "lib/interfaces/$n.interface.ts"
done
rm -f lib/services/mastra.service.ts
rm -rf lib/sessionControl
```

- [ ] **Step 3: Delete removed auth pages + demo pages/components**

```bash
cd frontend
rm -rf app/auth/signup app/auth/verify-email app/auth/resend-verification app/auth/callback
rm -rf app/data-links app/data-links-modal app/home-page app/profile
rm -rf app/dashboard/calls
rm -f app/dashboard/data.json
rm -f components/signup-form.tsx components/music-player.tsx components/chart-area-interactive.tsx \
      components/section-cards.tsx components/data-table.tsx components/team-switcher.tsx components/force-modal.tsx
```

- [ ] **Step 4: Delete orphaned nav/chrome, then resolve any remaining broken imports**

First remove the confirmed-orphaned demo chrome from the grep in Step 1:
```bash
cd frontend
rm -f components/app-sidebar.tsx components/nav-main.tsx components/nav-user.tsx \
      components/nav-projects.tsx components/nav-secondary.tsx components/nav-documents.tsx \
      components/site-header.tsx
rm -f lib/routes/routes.tsx
# Remove notification-drawer/panel ONLY if Step 1 grep showed them importing a deleted store:
# rm -f components/notification-drawer.tsx components/notification-panel.tsx
```
Then:

Run: `npm run typecheck`
Expected: clean. **Decision rule for any remaining error:** if the breaking file is demo chrome wired to removed code and unused by the foundation → delete it; if it is a generic/reusable file → open it and remove only the dead import/usage. Re-run until clean.

- [ ] **Step 5: Full test + build gate**

Run: `npm run test && npm run typecheck && npm run build`
Expected: tests PASS; typecheck clean; production build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A frontend
git commit -m "chore(frontend): prune fictional domain layer, demo pages/components, dead auth flows"
```

---

## Task 19: Env example + final verification

**Files:**
- Modify: `frontend/.env.example`

**Interfaces:** none (finalization).

- [ ] **Step 1: Update `frontend/.env.example`**

```dotenv
# Base URL of the backend API, reachable from the browser. No trailing slash, NO /api suffix.
NEXT_PUBLIC_API_URL=http://localhost:3000

# App display name (optional; defaults to "Cybernetics").
NEXT_PUBLIC_APP_NAME=Cybernetics

# Server-side base URL for middleware / route handlers (can equal NEXT_PUBLIC_API_URL in dev).
API_URL=http://localhost:3000
```

- [ ] **Step 2: Final full verification**

Run:
```bash
cd frontend
npm run test
npm run typecheck
npm run lint
npm run build
```
Expected: all green.

- [ ] **Step 3: Manual smoke (with backend running on :3000)**

Verify by hand (see design §4):
1. Visit `/dashboard` while logged out → redirected to `/auth/login?callbackUrl=%2Fdashboard`.
2. Log in with a seeded admin (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`) → lands on `/dashboard`, shows email + role.
3. Reload `/dashboard` → stays authenticated (bootstrap refresh works; `cbn_rt` cookie present).
4. Visit `/auth/login` while logged in → redirected to `/dashboard`.
5. `/account` → change password → forced back to `/auth/login` with a toast.
6. Log out → `cbn_rt` cleared, `/dashboard` redirects to login.

- [ ] **Step 4: Commit**

```bash
git add frontend/.env.example
git commit -m "docs(frontend): update .env.example to real backend contract"
```

---

## Self-Review Notes (traceability to design)

- §2 D1 (login-only) → Tasks 14, 18 (signup/OAuth/verify removed). D2 (user={id,role}, account page) → Tasks 3, 15, 17. D3 (memory+cookie+middleware+refresh) → Tasks 5, 6, 7, 11, 12. D4 (Zustand+SWR) → Tasks 9, 12, 15. D5 (password 12–200 + strength) → Tasks 3, 4, 14, 15. D6 (types-only) → Task 3.
- §4 lifecycle → Tasks 6, 7 (single-flight refresh), 9 (bootstrap), 12 (provider). §5 RBAC/guards → Tasks 10, 11, 13. §7 errors → Task 7 (`ApiError.fieldErrors`). §8 env → Task 2. §9 agent → Task 16. §10 pruning → Task 18. §11 folder structure → matches created paths.
- HARD RULE (no backend changes) → enforced in Global Constraints; every route used is verified-existing in the design's contract map.
