# Design — Frontend Foundational Layer (v1)

**Goal:** Rebuild the templated `frontend/` foundation — authentication, session, tokens,
user/role, global env, and router guards — so it is correct against the *real* Cybernetics backend
and forms a simple, clean, reliable base for building features on top.

**Guiding principle:** the **existing backend API is the single source of truth.** The frontend
targets only endpoints that exist today; **no backend changes are assumed or required.**

**Status:** Approved design (this document). Next step: implementation plan.

---

## 1. The core finding

The template's foundation was written against a **different backend contract** than the one that
exists. Almost every core assumption is wrong and must be rebuilt:

| Layer | Template assumed | Real backend (source of truth) |
|---|---|---|
| Auth | Opaque `session:uuid`, httpOnly cookie, `withCredentials` | **JWT access (15 min) + rotating refresh (7 days)**, both in JSON body. No cookies; CORS `credentials:false` |
| Route prefix | Global `/api` | **None** (root routes); only `/api/agent-core` for the Mastra vendor adapter |
| Response | `{status, payload}` success envelope | **No success envelope** — raw payloads. Error envelope only |
| Current user | `/current-user/get` + `/current-user/rbac` | Only `GET /auth/me` → **`{id, role}`** |
| RBAC | `roles[] + permissions[]` (CASL), 5-tier hierarchy | **4 roles: `guest`/`user`/`admin`/`agent`**, role-membership only |
| Register / OAuth / verify | `/auth/register/local`, Google OAuth, email verify | **None** — users admin-created (`POST /users`). Frontend: **login-only, no public signup** |
| Password reset | `{token, newPassword}`, min 8 | `{email, code(6-digit), newPassword}`, **min 12** |

The *patterns* (Zustand store, provider, axios interceptor) are sound and are kept; the *contract*
is replaced.

---

## 2. Decisions locked

| # | Decision | Choice |
|---|---|---|
| D1 | Registration | **No public registration.** Login-only; users are admin-provisioned out-of-band (`POST /users`, admin-only). No signup / OAuth / email-verification pages. |
| D2 | User info | **Current-user = `{ id, role }`** (+ `email` from the JWT claim if present). No self-profile edit, no avatar. Account page = **change-password + active-session management** (real endpoints). |
| D3 | Session/token model | **Access token in memory; refresh token in a readable cookie; Next.js middleware coarse guard; 401 → silent single-flight refresh.** |
| D4 | State management | **Zustand for client/UI/auth state; SWR for server data.** |
| D5 | Password rule | **Length only (12–200), == backend. Plus a no-dependency strength meter (soft guidance).** |
| D6 | Response validation | **Types-only** (plain TS interfaces). Zod reserved for form inputs + env parsing. Accepted tradeoff: backend drift not caught at the boundary. |

---

## 3. Architecture (layers + data flow)

```
app/ (routes)
  middleware.ts            coarse route guard — refresh-cookie presence only
  <AuthGuard>/useRequireAuth  client guard — real validation + role gate
        │ reads
lib/state-management (Zustand — CLIENT state)
  auth.store   accessToken (memory-mirrored), user, status, error
  app.store    activeContext, UI flags, toasts
        │ calls                                  ▲ selectors
lib/services (thin API fns)          lib/hooks (SWR — SERVER state)
  auth.service   (real /auth/*)        useSessions, useConversations, … (per feature)
  agent.service  (real /agent/*)
        │
lib/http/api-client.ts (axios)
  • baseURL = clientEnv.apiUrl        (NO /api prefix)
  • Authorization: Bearer <accessToken>   (from token-store)
  • 401 AUTH_TOKEN_EXPIRED → single-flight /auth/refresh → replay
  • error envelope → ApiError { code, message, correlationId, details, fieldErrors }
        │
lib/config/env.ts   Zod-validated env (client + server split)
```

**Boundary rule:** Zustand owns client state (auth/session/UI). SWR owns server state
(cached/deduped/refetched). They meet only at the token: the auth store holds the access token;
the SWR fetcher reads it through the shared api-client.

**Single source of truth for the current user:** the **auth store** owns `user` (set during
bootstrap / login). SWR is used for *other* server data (sessions list, agent conversations), not
for `user` — this avoids two competing sources.

---

## 4. Session & token lifecycle (the delicate part)

- **Access token** → in-memory only. Source of truth is a module-level holder
  `lib/http/token-store.ts` (synchronous, so interceptors can read it), mirrored into the auth
  store for reactivity. Never persisted; lost on reload → rebuilt via refresh.
- **Refresh token** → readable cookie `cbn_rt`, `SameSite=Lax`, `Secure` in production, `path=/`,
  `expires` = 7 days (matches backend `JWT_REFRESH_TTL`). Read by both middleware (server) and the
  api-client (client). **Rotation-aware:** every `/auth/refresh` returns a *new* refresh token, so
  the cookie is overwritten on every refresh — otherwise the backend's theft-detection revokes the
  whole family.
- **`/auth/refresh` transport:** the refresh token is stored in a cookie for *storage/middleware*
  purposes but is sent to the backend in the **JSON body** (`{ refreshToken }`), because the backend
  is bearer/body-only and does not read cookies.

### Bootstrap (runs once per app load, in `AuthProvider`)

```
refresh cookie present?
 ├─ no  → status = 'unauthenticated'
 └─ yes → POST /auth/refresh { refreshToken }
             ├─ ok   → store access token + rewrite cookie
             │          → GET /auth/me → user → status = 'authenticated'
             └─ fail → clear cookie → status = 'unauthenticated'
```

### 401 auto-refresh (api-client response interceptor)

```
response 401 with code AUTH_TOKEN_EXPIRED?
 └─ yes → single-flight refresh (concurrent 401s queue behind ONE refresh call)
             ├─ ok   → update access token + cookie → replay original request(s)
             └─ fail / AUTH_TOKEN_REUSE → hard logout → redirect /auth/login
other 401 codes (AUTH_TOKEN_INVALID, UNAUTHORIZED) → hard logout
```

### Password change caveat

`PATCH /auth/password` **revokes all sessions** server-side (the current refresh family included).
After a successful change the frontend force-logs-out and redirects to `/auth/login` with a
"Password changed — please sign in again" notice, so it does not look like a bug.

---

## 5. RBAC + route guards

- **Roles:** `guest | user | admin | agent` (real backend enum). The fictional permissions/CASL
  layer and 5-tier hierarchy are removed. For the human web app only `user` and `admin` matter;
  `guest` = no token, `agent` = machine caller.
- **`lib/hooks/use-permission.ts`** shrinks to role checks:
  `useHasRole(role)`, `useHasAnyRole(roles[])`, `useIsAdmin()`.
- **`middleware.ts` (coarse, cookie-presence only):**
  - unauthenticated + protected route → `/auth/login?callbackUrl=<path>`
  - authenticated + auth page → `/dashboard`
  - It **cannot** check role (role is not trusted from a client cookie).
- **Admin gating** = client-side `useRequireRole('admin')` **+ backend `RolesGuard` (authoritative).**
  Middleware is a UX convenience, never the security boundary — the backend is.
- **`lib/auth/route-policy.ts`** holds the single source of truth for public / protected / admin
  route lists, shared by `middleware.ts` and the client guard so they never drift.
- **Coarse-gate limitation (accepted):** a stale/expired refresh cookie lets a user past middleware;
  the client bootstrap refresh then fails and redirects to login.

---

## 6. Schemas & types

**Response types → plain TS** (`lib/interfaces/auth.interface.ts`, rewritten). No runtime parse (D6).

```ts
export type Role = 'guest' | 'user' | 'admin' | 'agent'

export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }

// GET /auth/me → { id, role }. email is added only if the JWT carries the claim.
export interface CurrentUser {
  id: string
  role: Role
  email?: string
}

// GET /auth/sessions → SessionSummary[] (account page: list + revoke).
export interface SessionSummary {
  id: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
  userAgent: string | null
  ip: string | null
}

export interface Paginated<T> { data: T[]; total: number; page: number; limit: number }

export interface ErrorEnvelope {
  error: {
    code: string; message: string; statusCode: number
    details: unknown | null; correlationId: string; timestamp: string; path: string
  }
}
```

`deriveDisplayName(user)` → `user.email?.split('@')[0] ?? 'User'`, so the UI has a stable label
without a display-name field.

**Zod form schemas** (`lib/validations/auth.schema.ts`) — runtime, via `zodResolver`. Note: **no
`registerSchema`** (login-only).

```ts
export const emailSchema    = z.string().trim().toLowerCase().email('Enter a valid email address')
export const passwordSchema = z.string().min(12, 'At least 12 characters').max(200, 'At most 200 characters')

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),   // never reveal policy on login
})

export const forgotPasswordSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
  newPassword: passwordSchema,
  confirmPassword: z.string(),
}).refine(d => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
  confirmPassword: z.string(),
})
  .refine(d => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })
  .refine(d => d.newPassword !== d.currentPassword, { path: ['newPassword'], message: 'New password must be different' })
```

**Password strength meter** (`lib/auth/password-strength.ts`) — no dependency. Heuristic score
0–4 from length + character-class variety → label `weak | fair | good | strong`. Soft guidance
only; never blocks a length-valid password.

---

## 7. Error handling

`api-client` maps the backend error envelope to an `ApiError`:

```ts
class ApiError extends Error {
  code: string            // e.g. AUTH_INVALID_CREDENTIALS
  statusCode: number
  correlationId?: string
  details?: unknown
  // Parsed from details.issues [{ path, message }] (confirmed backend shape).
  get fieldErrors(): Record<string, string>   // path → message, ready for setError()
}
```

- `details` for `VALIDATION_FAILED` is `{ issues: [{ path: string, message: string }] }`; `path` is
  dot-joined (`"(root)"` for top-level). `fieldErrors` maps these straight onto react-hook-form fields.
- Code-driven UX (`ERROR_CODES` constant): `AUTH_TOKEN_EXPIRED` → silent refresh;
  `AUTH_TOKEN_REUSE`/`AUTH_TOKEN_INVALID` → hard logout; `AUTH_INVALID_CREDENTIALS` → "invalid email
  or password"; `RATE_LIMITED` → back-off notice. `correlationId` is surfaced in toasts for support.

---

## 8. Environment module (`lib/config/env.ts`)

Zod-validated, split so server vars never leak into the client bundle:

- **`clientEnv`** — `NEXT_PUBLIC_API_URL` (url, required), `NEXT_PUBLIC_APP_NAME` (default
  `'Cybernetics'`). Each `process.env.NEXT_PUBLIC_*` is referenced **statically** so Next inlines it.
- **`serverEnv`** — `API_URL` (url, required; used by middleware + server components/route handlers).
  Guarded so it is never evaluated on the client.
- Parsing runs at module load and throws a clear, aggregated message listing missing/invalid vars.
- Constants (cookie name `cbn_rt`, TTLs, storage keys) centralized in `lib/config/constants.ts`.
- `.env.example` updated to the real keys.

---

## 9. Mastra / agent integration (scope for this pass)

- Correct `lib/services/mastra.service.ts` → `agent.service.ts` to the **real** backend routes:
  - `POST /agent/chat` `{ conversationId?, message }` → `{ conversationId, runId, text, pendingApprovals[] }` (**blocking**)
  - `GET /agent/conversations?page&limit`
  - `GET /agent/approvals`, `POST /agent/approvals/:id` `{ approved, note? }`
  - `POST /agent/schedules` (admin), `DELETE /agent/schedules/:id`
- Types mirror `mastra.types` unions: `RunStatus`, `ActionType`, `ApprovalStatus`, `DeliveryChannel`,
  `PendingApproval`.
- **Deferred (not this pass):** the rich streaming chat UI. When built, use the vendor streaming
  adapter at `/api/agent-core/*` with `useChat` from `@ai-sdk/react` + `DefaultChatTransport`
  (Mastra 1.0 `agent.stream()` is AI-SDK-v5/v6 compatible; the installed `ai@6` matches). The
  existing `ai-elements` / `ai-chat-modal` UI is left in place but not wired in this pass.

---

## 10. Pruning (goal item 6) — confirm before deletion

**Remove (fiction / wrong contract / unsupported by backend):**
- `lib/state-management/*.store.ts`, `lib/services/*.service.ts`, `lib/interfaces/*.interface.ts`
  **except** `auth`, `app`, `shared`, and the corrected `agent`/`mastra`.
- `lib/sessionControl/` (vestigial — cookie is the single persistence layer).
- Auth pages/flows: **`signup`**, `verify-email`, `resend-verification`, `callback` (OAuth).
- The **"Login with Google"** button in `login-form`.
- Mock-data pages: `app/dashboard/*` demo content (`data.json`, `calls/*`), `app/data-links`,
  `app/data-links-modal`, `app/home-page`, `app/profile/settings` (replaced by the account page).
- Demo components: `music-player`, `chart-area-interactive`, `section-cards`, `data-table` (demo),
  `team-switcher`, `force-modal`, `signup-form`.

**Keep / rewire:**
- `components/ui/*`, `theme-provider`, `tooltip`.
- `login-form` → rewired to the new store + `react-hook-form` + `zodResolver`, Google button removed.
- `forgot-password` + `reset-password` pages → rewired to the real reset flow (email + 6-digit code).
- **NEW account page** (`app/(protected)/account` or similar): change-password (`PATCH /auth/password`)
  + active-sessions list & revoke (`GET /auth/sessions`, `POST /auth/logout-all`).
- A minimal protected `/dashboard` shell to prove the guard end-to-end.
- Sidebar/nav scaffolding → rewired to `route-policy`.
- `lib/localControl`, `lib/routes/routes.tsx` (nav config) → reviewed and kept if still useful.

**Also fix:** `app/layout.tsx` mounts `<Toaster />` (sonner) — currently missing though the app
store dispatches to it. `IActiveContext.projectId` → `string` (backend ids are UUID strings, not numbers).

---

## 11. Folder structure (final — follows the existing pre-designed layout)

```
frontend/
  middleware.ts                         NEW — coarse route guard
  lib/
    config/
      env.ts                            NEW — typed/validated env (client + server split)
      constants.ts                      NEW — cookie name, TTLs, storage keys
    http/
      api-client.ts                     rewritten — refresh, error envelope, no /api prefix
      token-store.ts                    NEW — in-memory access-token holder
    auth/
      route-policy.ts                   NEW — public/protected/admin route lists
      password-strength.ts              NEW — no-dep strength heuristic
    interfaces/
      auth.interface.ts                 rewritten — real response types (plain TS)
      app.interface.ts, shared.interface.ts, mastra.interface.ts   kept/corrected
    validations/
      auth.schema.ts                    rewritten — Zod form schemas (login/forgot/reset/change-pw)
    services/
      auth.service.ts                   rewritten — login, refresh, logout, logoutAll, getMe,
                                        getSessions, changePassword, forgotPassword, resetPassword
      agent.service.ts                  rewritten from mastra.service — real /agent/*
    hooks/
      use-permission.ts                 role-only checks
      swr-fetcher.ts                    NEW — SWR fetcher bound to api-client (+ example hook)
    state-management/
      auth.store.ts                     rewritten (login, logout, bootstrap, refresh, changePassword)
      app.store.ts                      corrected (activeContext id: string)
  components/
    providers/
      auth-provider.tsx                 rewritten — bootstrap()
      swr-provider.tsx                  NEW — <SWRConfig> with api-client fetcher
```

---

## 12. Out of scope / deferred

- **Public registration, self-profile editing, avatar** — not supported by the backend; excluded.
- **Admin user-management screen** (create/list/edit/delete via existing `/users`) — deferred; a
  future admin feature, not part of the v1 foundation.
- Rich streaming AI chat UI (see §9).
- Domain feature data layers (projects, tasks, contacts, etc.) — rebuilt per feature on the SWR pattern.
- Email verification — backend does not support it.

## 13. Open items to confirm during implementation

1. Exact `/dashboard` shell scope (minimal placeholder vs. keep rewired sidebar).
2. Account page: v1 includes both change-password and session management (both endpoints exist) —
   confirm session-management UI is in scope for v1, or defer to change-password only.
