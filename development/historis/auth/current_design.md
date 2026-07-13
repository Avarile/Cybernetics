# Design — Authentication, Authorization & Basic Security (v1)

> Status: **approved for planning** · Date: 2026-07-13 · Scope: first version, deliberately simple but production-grade.

## 1. Goal & Guiding Principles

Add an authentication + authorization system and a basic security baseline to the
Cybernetics NestJS application.

- **Authentication** via [Passport](https://docs.nestjs.com/recipes/passport)
  (`passport-local` for email/password, `passport-jwt` for bearer tokens).
- **Authorization** via the simple RBAC pattern from the
  [NestJS Authorization docs](https://docs.nestjs.com/security/authorization)
  (`@Roles()` decorator + `RolesGuard` + `Reflector`).
- **Sessions** persisted with JWT access tokens + database-backed refresh tokens.
- **Basic security**: [Helmet](https://docs.nestjs.com/security/helmet),
  [CORS](https://docs.nestjs.com/security/cors), and
  [rate limiting](https://docs.nestjs.com/security/rate-limiting).

Principles:

1. **Slot into the existing seam, don't invent a new one.** The codebase already
   has `Principal { id: string | null }`, `SYSTEM_PRINCIPAL`, and a `CurrentUser`
   decorator whose own docstring says it is a *placeholder for a real AuthGuard*
   and that "controller and service signatures don't change" when auth lands.
   This design fulfils that promise.
2. **Boring and reliable over clever.** Standard Passport strategies, the RBAC
   pattern straight from the NestJS docs, argon2id hashing, opaque rotating
   refresh tokens. No bespoke crypto.
3. **Secure by default, fail fast.** Global auth guard (opt out with `@Public()`),
   production env guards mirroring the existing MinIO/Meilisearch `superRefine`
   checks, uniform `401`s that don't leak account existence.
4. **Keep files < 500 lines, one clear purpose each** (per `CLAUDE.md`).

### Decisions locked with the user

| Decision | Choice |
|---|---|
| Session model | Access JWT (short) + **opaque refresh token persisted in Postgres**, rotating & revocable, per-device |
| Token transport | **Bearer** (`Authorization` header) only — no cookies, no CSRF surface |
| `agent` role | **Machine principal**: admin issues a service credential (API key); agent exchanges it for a short-lived `agent` JWT. `guest` = anonymous (no token) |
| Account provisioning | **No public signup.** A seeded initial admin creates accounts via admin-only endpoints |

### Defaults chosen by the designer (not forks the user picked)

| Area | Default | Rationale / future |
|---|---|---|
| Password hashing | **argon2id** (`argon2`) | OWASP first choice; bcrypt is an acceptable swap |
| JWT algorithm | **HS256** with a strong shared secret | Single service in v1; move to RS256/asymmetric when multiple services must verify independently |
| Rate-limit storage | **In-memory** (`@nestjs/throttler` default) | Correct for a single instance; switch to Redis storage for multi-instance (Redis is already a dependency) |
| Access TTL / Refresh TTL / Agent TTL | 15m / 7d / 15m | Tunable via env |

## 2. New Dependencies

Runtime: `@nestjs/passport`, `passport`, `passport-local`, `passport-jwt`,
`@nestjs/jwt`, `@nestjs/throttler`, `helmet`, `argon2`.

Dev: `@types/passport-local`, `@types/passport-jwt`.

## 3. Data Model (Drizzle / PostgreSQL)

New schema file: `src/infrastructure/database/schema/identity.schema.ts`,
re-exported from `schema/index.ts`. Follows the existing `baseColumns` +
`pgEnum` + `pgTable` conventions.

### 3.1 Role enum

```ts
// Single shared role vocabulary for JWT claims and RolesGuard checks.
// 'guest'  — anonymous request, never stored (no token present)
// 'user'   — standard human account (email + password)
// 'admin'  — elevated human account (email + password)
// 'agent'  — machine/service caller, authenticated via a service credential
export const userRole = pgEnum('user_role', ['guest', 'user', 'admin', 'agent']);
```

`guest` is never persisted as a row — it models the absence of a token.
`agent` is carried by JWTs minted from a service credential, not by `users` rows.
Human `users` rows are `user` or `admin` in practice; the enum keeps all four as
one source of truth for guards.

### 3.2 `users`

```ts
export const users = pgTable(
  'users',
  {
    ...baseColumns,                                   // id, createdAt, updatedAt, isDeleted, deletedAt
    email: varchar('email', { length: 255 }).notNull(),      // stored lowercased
    passwordHash: text('password_hash').notNull(),           // argon2id
    role: userRole('role').notNull().default('user'),
    displayName: varchar('display_name', { length: 255 }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_unique_idx').on(t.email),
    index('users_role_idx').on(t.role),
  ],
);
```

- **Soft delete** via `baseColumns` (`isDeleted` / `deletedAt`); repository reads
  filter out deleted rows. Deactivation without deletion = soft-delete for v1.
- Email uniqueness is enforced at the DB level and email is lowercased at the
  service boundary before insert/lookup, so casing never splits an identity.

### 3.3 `sessions` (refresh tokens)

Refresh tokens are **opaque random strings** (256-bit, base64url), never JWTs.
Only their SHA-256 hash is stored. This makes them trivially revocable and
immune to being decoded.

```ts
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),  // sha256 hex of the opaque refresh token
    familyId: uuid('family_id').notNull(),                       // rotation lineage; shared across a chain
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),  // null = active
    userAgent: varchar('user_agent', { length: 512 }),
    ip: varchar('ip', { length: 45 }),                           // audit / per-device list
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_family_idx').on(t.familyId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);
```

- No `baseColumns` here on purpose: `revokedAt` is the real "deleted" marker, so
  the soft-delete columns would be redundant/confusing.
- `familyId` powers **refresh-token rotation with reuse detection** (§6.2).

### 3.4 `service_credentials` (agent API keys)

```ts
export const serviceCredentials = pgTable(
  'service_credentials',
  {
    ...baseColumns,
    name: varchar('name', { length: 255 }).notNull(),        // human label, e.g. "mastra-pipeline"
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(), // shown for identification, e.g. "svc_ab12cd"
    keyHash: varchar('key_hash', { length: 64 }).notNull(),  // sha256 hex of the full API key
    role: userRole('role').notNull().default('agent'),
    createdBy: uuid('created_by').references(() => users.id), // which admin minted it
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('service_credentials_key_hash_idx').on(t.keyHash),
    index('service_credentials_prefix_idx').on(t.keyPrefix),
  ],
);
```

The plaintext API key (`svc_<prefix>_<secret>`) is returned **exactly once** on
creation; only the hash is persisted.

## 4. Principal & Decorator Changes

`src/common/principal.ts` is extended (backward compatible for existing
file/search callers, which only read `.id`):

```ts
export type UserRole = 'guest' | 'user' | 'admin' | 'agent';

export interface Principal {
  id: string | null;   // user id, service-credential id, or null for guest/system
  role: UserRole;
}

export const SYSTEM_PRINCIPAL: Principal = { id: null, role: 'agent' }; // internal/pipeline caller
export const GUEST_PRINCIPAL:  Principal = { id: null, role: 'guest' }; // anonymous request
```

`src/common/decorators/current-user.decorator.ts` is **rewired** to return
`request.user` (populated by `JwtAuthGuard`), falling back to `GUEST_PRINCIPAL`
on `@Public()` routes with no token. The `x-user-id` placeholder is removed.
Controller/service signatures are unchanged.

## 5. Building Blocks

```
src/common/
  principal.ts                         (extended: + role, GUEST_PRINCIPAL)
  decorators/
    current-user.decorator.ts          (rewired → request.user)
    public.decorator.ts                (@Public — SetMetadata IS_PUBLIC_KEY)
    roles.decorator.ts                 (@Roles(...UserRole) — SetMetadata ROLES_KEY)
  guards/
    jwt-auth.guard.ts                  (extends AuthGuard('jwt'); honors @Public, sets guest principal)
    roles.guard.ts                     (Reflector getAllAndOverride; checks request.user.role)
    local-auth.guard.ts                (extends AuthGuard('local'); login only)

src/features/auth/
  auth.module.ts
  auth.controller.ts                   (/auth/*)
  auth.service.ts                      (validateUser, login, refresh, logout, me)
  token.service.ts                     (JWT sign/verify, refresh mint/rotate/hash)
  password.service.ts                  (argon2id hash/verify)
  service-credential.service.ts        (issue/verify/revoke API keys, service-token exchange)
  session.repository.ts                (sessions table access)
  service-credential.repository.ts
  strategies/
    local.strategy.ts                  (usernameField: 'email')
    jwt.strategy.ts                    (Bearer → validate(payload) → Principal)
  dto/                                 (login, refresh, service-token, change-password — Zod)
  auth.constants.ts                    (injection tokens, metadata keys)
  auth.types.ts                        (JwtPayload, token pair, etc.)

src/features/users/
  users.module.ts
  users.controller.ts                  (admin CRUD)
  users.service.ts
  user.repository.ts
  dto/                                 (create-user, update-user — Zod)

src/infrastructure/database/
  schema/identity.schema.ts            (users, sessions, service_credentials, user_role)
  seeders/                             (+ initial-admin seeder)
```

- **Strategies**: `LocalStrategy` authenticates `POST /auth/login`; `JwtStrategy`
  validates every bearer token. Agents reuse `JwtStrategy` — their JWT simply
  carries `role: 'agent'` — so request-time validation is uniform for everyone.
- **DTO validation** uses the existing `ZodValidationPipe` pattern.

## 6. Core Flows

### 6.1 Login (`POST /auth/login`, `@Public`)
1. `LocalAuthGuard` → `LocalStrategy.validate(email, password)`.
2. `AuthService`: lookup user by lowercased email (not deleted); `argon2.verify`.
   Failure → uniform `401` (no email-enumeration).
3. Mint access JWT (`sub`, `role`, `email`, `type:'access'`, 15m) + opaque
   refresh token; persist `sessions` row (`tokenHash`, new `familyId`,
   `expiresAt`, UA/IP); stamp `users.lastLoginAt`.
4. Return `{ accessToken, refreshToken, expiresIn }`.

### 6.2 Refresh with rotation + reuse detection (`POST /auth/refresh`, `@Public`)
1. Hash the presented refresh token; find the `sessions` row by `tokenHash`.
2. **Not found / expired** → `401`.
3. **Found but already `revokedAt`** → token replay. Revoke the *entire family*
   (`familyId`) and return `401`. (Defends against stolen-refresh-token replay.)
4. **Valid & active** → revoke this row, insert a new `sessions` row with the
   **same `familyId`**, issue a fresh access+refresh pair. Return the pair.

### 6.3 Protected request
`ThrottlerGuard` → `JwtAuthGuard` (verify signature/expiry, attach `Principal`,
or `401`) → `RolesGuard` (if `@Roles` present, require `request.user.role` ∈ set,
else `403`).

### 6.4 Agent service-token (`POST /auth/service-token`, `@Public`, throttled)
1. Client presents the API key (`svc_<prefix>_<secret>`).
2. Hash it; look up `service_credentials` by `keyHash`; reject if
   missing/expired/revoked (`401`).
3. Mint an access-only agent JWT (`sub: credentialId`, `role: 'agent'`,
   `kind: 'service'`, 15m); stamp `lastUsedAt`. No refresh token — machines
   re-exchange when the token expires.

### 6.5 Logout
- `POST /auth/logout` — revoke the caller's current session (refresh token in
  body, or all sessions if not supplied). `204`.
- `POST /auth/logout-all` — revoke every active session for the user. `204`.

### 6.6 Guest
A request with no token to a `@Public()` route gets `GUEST_PRINCIPAL`
(`role: 'guest'`). It passes `RolesGuard` only where no `@Roles` is set (or where
`'guest'` is explicitly allowed). Any non-public route without a valid token is
`401`.

## 7. Endpoints

| Method & path | Auth | Notes |
|---|---|---|
| `POST /auth/login` | Public | Email + password → token pair |
| `POST /auth/refresh` | Public | Rotate refresh, new pair |
| `POST /auth/logout` | Authenticated | Revoke current session |
| `POST /auth/logout-all` | Authenticated | Revoke all sessions |
| `GET /auth/me` | Authenticated | Current principal profile |
| `GET /auth/sessions` | Authenticated | List own active sessions (per-device) |
| `PATCH /auth/password` | Authenticated | Change own password (verifies current) |
| `POST /auth/service-token` | Public + API key | Agent JWT exchange (throttled) |
| `POST /users` | admin | Create `user`/`admin` account |
| `GET /users` | admin | List (pagination, excludes soft-deleted) |
| `GET /users/:id` | admin | Fetch one |
| `PATCH /users/:id` | admin | Update role / reset password / (soft) disable |
| `DELETE /users/:id` | admin | Soft delete |
| `POST /service-credentials` | admin | Create; returns plaintext key **once** |
| `GET /service-credentials` | admin | List (never returns the secret) |
| `DELETE /service-credentials/:id` | admin | Revoke |

## 8. Basic Security System

- **Helmet** — `app.use(helmet())` in `main.ts` (sensible default headers).
- **CORS** — `app.enableCors({ origin: <allow-list from CORS_ORIGINS>, credentials: false })`.
  Bearer transport means no cookies and therefore no CSRF handling required.
- **Rate limiting** — `ThrottlerModule.forRoot` global default (e.g. 100 req/60s
  per IP) registered as a global `ThrottlerGuard`; **tighter `@Throttle` on
  `/auth/login`, `/auth/refresh`, `/auth/service-token`** (e.g. ~5–10/min) to blunt
  brute force. In-memory store for v1; Redis store noted for multi-instance.
- **Password hygiene** — argon2id; Zod policy (min length, e.g. 12 for
  admin-provisioned accounts); current-password required on change.
- **Error hygiene** — uniform `401 Unauthorized` for bad credentials, unknown
  email, disabled account, and bad/expired tokens (no enumeration).
- **Guard order** (global, in this registration order):
  `ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard`.

## 9. Configuration & Environment

Added to the central Zod `envSchema` (`src/config/env.validation.ts`) and a new
namespaced `auth.config.ts`:

| Var | Default | Purpose |
|---|---|---|
| `JWT_ACCESS_SECRET` | `''` | HS256 signing secret (required in prod, see below) |
| `JWT_ACCESS_TTL` | `900` | Access token seconds (15m) |
| `JWT_REFRESH_TTL` | `604800` | Refresh token seconds (7d) |
| `AGENT_TOKEN_TTL` | `900` | Agent JWT seconds (15m) |
| `JWT_ISSUER` | `cybernetics` | `iss` claim |
| `THROTTLE_TTL` | `60` | Global rate-limit window (s) |
| `THROTTLE_LIMIT` | `100` | Global requests per window |
| `CORS_ORIGINS` | `''` | Comma-separated allow-list |
| `SEED_ADMIN_EMAIL` | `admin@cybernetics.local` | Initial admin (seeder) |
| `SEED_ADMIN_PASSWORD` | `''` | Initial admin password (required in prod) |

**Production `superRefine` guards** (mirroring the existing MinIO/Meilisearch
checks): when `NODE_ENV=production`, require a non-empty `JWT_ACCESS_SECRET`
(and reject an obvious placeholder), and require a non-empty, non-default
`SEED_ADMIN_PASSWORD`.

## 10. Seeding

Extend the existing seeder (`src/infrastructure/database/seeders/`) with an
`initial-admin` seeder: idempotently create one `admin` user from
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` if no admin exists. This is the only
bootstrap path since public signup is disabled.

## 11. Testing Strategy

- **Unit**: `password.service` (hash/verify), `token.service` (sign/verify,
  refresh mint + rotation + reuse detection), `auth.service` (login/refresh/
  logout paths, uniform failures), `roles.guard` (allow/deny per role),
  `jwt-auth.guard` (`@Public` bypass, guest fallback, 401), repositories.
- **E2E**: boot a **module subset** — `AuthModule`, `UsersModule`,
  `DatabaseModule`, `ConfigModule` — **not** `AppModule`, per the known
  Mastra-ESM/Jest constraint. Cover: seeded-admin login → create user → user
  login → access protected route → refresh → reuse-detection revocation →
  logout → 401; admin-only route rejects `user`; service-token exchange →
  agent-only route.

## 12. Out of Scope for v1 (YAGNI)

Email verification · password reset via email · OAuth / social login · MFA/TOTP ·
account lockout counters · public self-registration · cookie transport ·
asymmetric (RS256) JWTs · Redis-backed throttler. Each is a clean future
extension on top of this structure.
