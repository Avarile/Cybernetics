# System Records Module — Design (v1)

**Status:** Approved design, ready for implementation planning
**Date:** 2026-07-14
**Scope:** First version. Simple, clean, reliable, production-grade. YAGNI applied.

---

## 1. Purpose & Boundary

A new admin-only feature module that manages **runtime, admin-editable system
configuration**: mail servers (SMTP/IMAP), outbound 3rd-party integration
credentials, generic system settings (feature flags / app-level knobs), and an
audit trail of who changed what.

### Boundary with existing env config

The app already has strongly-typed, zod-validated env config (`registerAs`
namespaces). This module does **not** replace it. The split:

| Concern | Home | Rationale |
|---|---|---|
| Bootstrap infra + wiring (DB host, Redis, JWT secret) | env / `registerAs` | Needed before the DB is reachable |
| The master encryption key (`SYSTEM_ENCRYPTION_KEY`) | env / `registerAs` | The key that protects DB secrets must not live in that DB |
| Mail server profiles, integration credentials, feature flags, app settings | **this module (DB)** | Admins change these at runtime without a redeploy |

**In scope (v1):** `smtp_configs`, `imap_configs`, `integration_credentials`,
`system_settings`, `system_audit_log`, and a reusable `EncryptionService`.

**Explicitly deferred (see §11).**

---

## 2. Architecture

Follows the existing feature-module convention (`src/features/<name>/` with
controller + service + repository + module + `dto/`, colocated `*.spec.ts`).
Secrets, redaction, audit, and caching are owned by the service layer.

```
                 ┌──────────────────────────────────────────────┐
   HTTP (admin)  │  Controllers (@Roles('admin'), one per res.)  │
        │        │  smtp · imap · integrations · settings · audit │
        ▼        └───────────────┬──────────────────────────────┘
  Global guards:                 │  (Public* DTOs — never plaintext)
  throttle → JWT → Roles         ▼
                 ┌──────────────────────────────────────────────┐
                 │  Services (business rules)                     │
                 │  encrypt/decrypt · redact · audit · cache      │
                 │  activate() tx · connection test               │
                 └───────┬───────────────┬───────────────┬───────┘
                         ▼               ▼               ▼
                 ┌────────────┐  ┌──────────────┐  ┌───────────┐
                 │ Repos      │  │ Encryption   │  │ Cache     │
                 │ (Drizzle)  │  │ Service      │  │ (manager) │
                 └─────┬──────┘  └──────────────┘  └───────────┘
                       ▼
                   PostgreSQL
```

**Module deps:** `SystemModule` imports `DatabaseModule` (the `DRIZZLE` token),
`CacheModule` (existing cache-manager), and the new `CryptoModule`. It is
registered in `AppModule`'s feature list **before `MastraModule`** (whose
catch-all controller must remain last). Admin-only access is enforced entirely
by the existing global `RolesGuard` via `@Roles('admin')` — no new guard.

---

## 3. Encryption Primitive (new, reusable)

Location: `src/infrastructure/crypto/` → `EncryptionService` + `CryptoModule`.

This is the **reversible** counterpart to the existing one-way
`TokenService.hashToken` (sha256). SMTP/IMAP passwords and integration tokens
must be *decryptable* to be used, so they are encrypted, not hashed.

- **Algorithm:** AES-256-GCM. 12-byte random IV per encryption. 16-byte auth
  tag verified on decrypt (tamper detection → throws).
- **Key:** from env `SYSTEM_ENCRYPTION_KEY` (32 bytes, base64-encoded).
- **Envelope format (single text column, self-describing):**

  ```
  v{keyVersion}.{ivBase64}.{authTagBase64}.{ciphertextBase64}
  ```

  Example: `v1.9k3f...==.4aQ...==.8Hd2...`

  The `keyVersion` prefix means key rotation later needs no schema change:
  keep a `{ version -> key }` map, encrypt with the current version, decrypt
  with the version named in the envelope. v1 ships a single key (version `1`);
  the rotation *tooling* is deferred (§11).

- **API:**

  ```ts
  interface EncryptionService {
    encrypt(plaintext: string): string;   // -> envelope
    decrypt(envelope: string): string;    // throws on tamper / unknown version
  }
  ```

- **Config / env additions:**
  - `env.validation.ts`: `SYSTEM_ENCRYPTION_KEY: z.string().default('')`, with a
    length check when set (decoded === 32 bytes).
  - `superRefine`: when `NODE_ENV === 'production'`, reject empty
    `SYSTEM_ENCRYPTION_KEY` (same pattern as the MinIO/Meili prod guards).
  - New namespace `systemConfig = registerAs('system', ...)` exposing
    `{ encryptionKey, encryptionKeyVersion }`, added to `ConfigModule.load[]`.

---

## 4. Database Schemas

New file `src/infrastructure/database/schema/system.schema.ts`, re-exported from
the schema barrel `index.ts`. All structured tables spread `baseColumns`
(`id` uuid PK, `createdAt`, `updatedAt`, `isDeleted`, `deletedAt`). Secrets are
stored **only** as the encryption envelope — there is no plaintext column
anywhere.

New enums:

```ts
export const credentialKind = pgEnum('credential_kind', [
  'api_key', 'oauth2', 'basic', 'bearer',
]);
export const settingType = pgEnum('setting_type', [
  'string', 'number', 'boolean', 'json',
]);
```

### 4.1 `smtp_configs`

| Column | Type | Notes |
|---|---|---|
| …baseColumns | | |
| name | varchar(255) notNull | Human label, e.g. "Primary Mailgun" |
| host | varchar(255) notNull | |
| port | integer notNull | 1–65535 |
| username | varchar(255) | nullable (some relays are IP-authed) |
| secretEnc | text | nullable — encrypted password envelope |
| secure | boolean notNull default true | implicit TLS on connect |
| fromAddress | varchar(255) notNull | default sender address |
| fromName | varchar(255) | nullable |
| isActive | boolean notNull default false | |
| lastTestedAt | timestamptz | nullable |
| lastTestStatus | varchar(50) | nullable — `'ok'` / `'failed'` |

**Indexes:** partial unique on `is_active WHERE is_active = true AND is_deleted =
false` → **at most one active SMTP profile**. Plain index on `is_active`.

### 4.2 `imap_configs`

Same shape as SMTP minus mail-sender fields:
`name, host, port, username?, secretEnc?, secure(default true), isActive,
lastTestedAt?, lastTestStatus?`. Same single-active partial unique index.

### 4.3 `integration_credentials`

| Column | Type | Notes |
|---|---|---|
| …baseColumns | | |
| provider | varchar(100) notNull | free text, e.g. `openai`, `stripe`, `slack` |
| name | varchar(255) notNull | label / which account |
| kind | credentialKind notNull default `'api_key'` | |
| secretEnc | text notNull | encrypted token/secret |
| meta | jsonb notNull default `'{}'` | **non-secret** metadata: baseUrl, scopes, clientId, region |
| expiresAt | timestamptz | nullable |
| isActive | boolean notNull default true | |
| lastUsedAt | timestamptz | nullable |
| lastTestedAt | timestamptz | nullable |
| lastTestStatus | varchar(50) | nullable |

**Indexes:** unique `(provider, name) WHERE is_deleted = false`; plain index on
`provider`. No single-active constraint — a provider may have several live
accounts.

### 4.4 `system_settings`

Generic key/value for simple, **non-secret** operational knobs. (Anything
sensitive belongs in the dedicated tables above.)

| Column | Type | Notes |
|---|---|---|
| …baseColumns | | |
| key | varchar(150) notNull | dotted, e.g. `app.display_name`, `features.signup_enabled` |
| valueJson | jsonb notNull | typed value stored as JSON |
| type | settingType notNull | drives typed getters + validation |
| category | varchar(100) notNull default `'general'` | grouping for the admin UI |
| description | varchar(500) | nullable |

**Indexes:** unique `key WHERE is_deleted = false`; plain index on `category`.

### 4.5 `system_audit_log`

Append-only (no updates, no soft-delete → does **not** use `baseColumns`).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK defaultRandom | |
| createdAt | timestamptz notNull defaultNow | |
| actorId | uuid → users.id | nullable (null = system/seed) |
| action | varchar(100) notNull | e.g. `smtp.create`, `smtp.activate`, `setting.update`, `integration.delete`, `smtp.test` |
| entityType | varchar(50) notNull | `smtp` / `imap` / `integration` / `setting` |
| entityId | uuid | nullable |
| metadata | jsonb notNull default `'{}'` | **redacted** — changed field *names* only, never secret values |
| ip | varchar(45) | nullable |
| userAgent | varchar(512) | nullable |

**Indexes:** `(entity_type, entity_id)`, `actor_id`, `created_at`.

Types exported per table via `$inferSelect` / `$inferInsert` (existing
convention). Migration generated with `pnpm db:generate`.

---

## 5. Repository Layer

One repository per table, each extending `BaseRepository<typeof table>` and
injecting the `DRIZZLE` token (existing pattern). Soft-delete-aware queries
(`WHERE is_deleted = false`) mirror `UserRepository`.

- `SmtpConfigRepository` — `findActiveById`, `list`, `update`, `softDelete`,
  `findActive()` (the single active profile), `deactivateAll(tx)`,
  `stampTest(id, status)`.
- `ImapConfigRepository` — same surface as SMTP.
- `IntegrationCredentialRepository` — `list({ provider? })`,
  `findByProviderAndName`, `update`, `softDelete`, `stampUsed`, `stampTest`.
- `SystemSettingsRepository` — `findByKey`, `list({ category? })`,
  `upsertByKey`, `softDelete`.
- `SystemAuditRepository` — `insert` (append), `list({ entityType?, entityId?,
  actorId?, page, limit })`. Read + append only.

`activate()` uses a Drizzle transaction: `deactivateAll` → set target
`isActive = true`. The partial unique index is the DB-level backstop.

---

## 6. Service Layer

Services own encryption, redaction, audit emission, caching, and connection
tests. Every service exposes a **Public\*** projection that strips secrets —
same discipline as `PublicUser` / `PublicCredential`.

### Redaction contract

Reads return `hasSecret: boolean` and **never** the plaintext or ciphertext.
Write DTOs accept the plaintext secret; it is encrypted immediately and the
plaintext is not retained or logged.

```ts
interface PublicSmtpConfig {
  id: string; name: string; host: string; port: number;
  username: string | null; secure: boolean;
  fromAddress: string; fromName: string | null;
  isActive: boolean; hasSecret: boolean;
  lastTestedAt: Date | null; lastTestStatus: string | null;
  createdAt: Date; updatedAt: Date;
}
```

### Services

- **`SmtpConfigService`** — `create`, `findById`, `list`, `update` (re-encrypts
  only when a new secret is supplied), `remove` (soft), `activate`, `test`.
- **`ImapConfigService`** — same surface.
- **`IntegrationCredentialService`** — `create`, `findById`, `list({provider?})`,
  `update`, `remove`, `getDecryptedSecret(id)` (**internal only**, for future
  consumers — not exposed via HTTP). v1 `validate()` = format + `expiresAt`
  check (live test deferred, §11).
- **`SystemSettingsService`** — `get(key)`, `list({category?})`, `upsert(key,…)`,
  `remove(key)`, plus **typed internal getters** for other modules:
  `getString(key, default?)`, `getNumber`, `getBoolean`, `getJson<T>`. Validates
  `valueJson` against `type` on write.
- **`SystemAuditService`** — `record({ actor, action, entityType, entityId,
  metadata, ip, userAgent })` and `list(filter)`. Called by every mutating op
  in the services above; failures to write audit are logged but do not fail the
  primary operation.

### Caching (settings)

`SystemSettingsService` reads through the existing cache-manager:
- keys `system:setting:<key>` and `system:settings:all`
- populated on read, **invalidated on any write/delete**
- typed getters are the hot path for internal consumers, so they benefit most.

### Connection testing

- **SMTP** — `nodemailer.createTransport(cfg).verify()` (connect + STARTTLS/TLS
  + AUTH). Requires the plaintext secret, decrypted in-memory for the test only.
  Result stamps `lastTestedAt` / `lastTestStatus` and emits a `smtp.test` audit
  row. **New dependency:** `nodemailer` (+ `@types/nodemailer`) — the eventual
  mail sender needs it regardless.
- **IMAP** — a small hand-rolled `node:tls` client: connect, upgrade to TLS if
  `secure`, issue `a LOGIN <user> <pass>`, read the tagged `OK`/`NO`, disconnect.
  ~60 lines, **no new dependency**, CJS-safe. This deliberately avoids the
  imapflow ESM/Jest problem seen with Mastra; it is swappable for a full IMAP
  client later.

---

## 7. Controller Layer (admin-only)

Split by resource (keeps each file well under the 500-line limit), all under the
`system/` prefix, all annotated `@Roles('admin')`. The global guard chain
already yields **401** for unauthenticated and **403** for non-admin callers.
DTOs validated with `ZodValidationPipe`; ids via `ParseUUIDPipe`; `@HttpCode(204)`
on delete — all matching existing controllers. Actor + `ip` / `userAgent` come
from `@CurrentUser()` and the request, passed into the service for audit.

| Controller | Base path | Routes |
|---|---|---|
| `SmtpConfigController` | `system/smtp` | `POST` · `GET` · `GET :id` · `PATCH :id` · `DELETE :id` · `POST :id/activate` · `POST :id/test` |
| `ImapConfigController` | `system/imap` | same as SMTP |
| `IntegrationCredentialController` | `system/integrations` | `POST` · `GET (?provider)` · `GET :id` · `PATCH :id` · `DELETE :id` |
| `SystemSettingsController` | `system/settings` | `GET (?category)` · `GET :key` · `PUT :key` (upsert) · `DELETE :key` |
| `SystemAuditController` | `system/audit` | `GET` (paginated; `?entityType`, `?entityId`, `?actorId`) — read-only |

---

## 8. DTOs (zod)

`src/features/system/dto/` — one schema + inferred type per file, following the
`createUserSchema` pattern.

- `create-smtp.dto.ts` / `update-smtp.dto.ts` — `name`, `host` (non-empty),
  `port` (1–65535), `username?`, `secret?`, `secure`, `fromAddress` (email),
  `fromName?`. Update is `.partial()`.
- `create-imap.dto.ts` / `update-imap.dto.ts` — analogous.
- `create-integration.dto.ts` / `update-integration.dto.ts` — `provider`,
  `name`, `kind` (enum), `secret`, `meta?` (object), `expiresAt?`.
- `upsert-setting.dto.ts` — `valueJson` refined against `type`, `category?`,
  `description?`.
- `list-query.dto.ts` — shared pagination (`page`, `limit`) + optional filters.

Boundary validation only; no secret ever appears in a response schema.

---

## 9. Cross-Cutting Concerns

- **Authorization:** existing global `throttle → JWT → RolesGuard`; `@Roles('admin')`.
- **Secret hygiene:** encrypt on write, redact on read, decrypt only in-memory
  at point of use; secrets excluded from logs and audit metadata.
- **Single-active:** DB partial unique index + transactional `activate()`.
- **Error handling:** `NotFoundException` (missing id/key), `ConflictException`
  (duplicate name/key/provider-name), `BadRequestException`/
  `UnprocessableEntityException` (invalid value-vs-type, failed test) — matches
  existing services' style.
- **Audit resilience:** audit write failures are logged, never block the primary
  mutation.
- **Seeding (optional):** a small default-settings seed can follow the existing
  admin-seeder pattern; not required for v1.

---

## 10. Testing

Follows repo conventions: colocated `*.spec.ts` units; e2e boots a **module
subset**, never `AppModule` (Mastra ESM breaks Jest — established constraint).

**Unit**
- `encryption.service.spec.ts` — round-trip; wrong key / tampered tag throws;
  envelope version parsing.
- One spec per service — mocked repo + encryption + audit + cache: create
  encrypts, reads redact (`hasSecret`), update re-encrypts only when secret
  supplied, `activate` deactivates siblings, settings typed getters + cache
  invalidation, audit emitted per mutation.

**e2e** (`SystemModule` subset)
- authz matrix: unauth → 401, `user` → 403, `admin` → 200.
- secret redaction: no plaintext/ciphertext in any response.
- single-active enforcement across two activations.
- connection tests mocked (no live network in CI).

---

## 11. Deferred (YAGNI — not in v1)

- **Reveal endpoint** — chosen write-only policy; no plaintext read-back.
- **Key-rotation tooling** — envelope carries `keyVersion`; the re-encrypt
  command/runbook is future work.
- **Integration-credential live test** — v1 does format + `expiresAt` validation
  only (provider-specific probing is out of scope).
- **Per-setting encryption** — settings are non-secret by design.
- **Multi-tenant / per-org scoping** — single-tenant assumption for v1.
- **OAuth2 automatic token refresh** for integrations.

---

## 12. File Manifest

```
src/infrastructure/crypto/
  crypto.module.ts
  encryption.service.ts
  encryption.service.spec.ts

src/infrastructure/database/schema/
  system.schema.ts            (+ export from index.ts)

src/config/configurations/
  system.config.ts            (registerAs('system'))
  (env.validation.ts + config.module.ts edited)

src/features/system/
  system.module.ts
  smtp-config.controller.ts      smtp-config.service.ts      smtp-config.repository.ts
  imap-config.controller.ts      imap-config.service.ts      imap-config.repository.ts
  integration-credential.controller.ts
                                 integration-credential.service.ts
                                 integration-credential.repository.ts
  system-settings.controller.ts  system-settings.service.ts  system-settings.repository.ts
  system-audit.controller.ts     system-audit.service.ts     system-audit.repository.ts
  connection/
    smtp-tester.ts               imap-tester.ts
  dto/
    create-smtp.dto.ts           update-smtp.dto.ts
    create-imap.dto.ts           update-imap.dto.ts
    create-integration.dto.ts    update-integration.dto.ts
    upsert-setting.dto.ts        list-query.dto.ts
  *.spec.ts                      (colocated unit tests)

test/
  system.e2e-spec.ts            (SystemModule subset)

package.json                     (+ nodemailer, @types/nodemailer)
AppModule                        (register SystemModule before MastraModule)
```
