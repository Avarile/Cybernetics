# Email Infrastructure Module + Forgot-Password — Design (v1)

**Status:** Approved design, ready for implementation planning
**Date:** 2026-07-16
**Scope:** First version. Simple, clean, reliable, production-grade. YAGNI applied.

Two deliverables, in order:

1. **`infrastructure/email`** — a reusable email module owning the mail
   **transport** layer plus a clean app-wide API: `MailerService` (outbound
   SMTP) and `InboxService` (full inbound IMAP: list / fetch+parse / flags).
2. **Forgot-password** — an emailed 6-digit OTP reset flow added to the `auth`
   feature, built on `MailerService`.

---

## 1. Purpose & Boundary

Today the app can *send* mail only via `SmtpConfigService.sendActive()`, which
is bolted onto the admin config-CRUD service and reaches into loose functions in
`system/connection/smtp-tester.ts`. IMAP has only a hand-rolled connectivity
check — no message fetching. There is no forgot-password path at all: the only
password mutation is `PATCH /auth/password`, which requires an authenticated
session **and** the current password.

This design extracts a real transport layer and adds the missing reset flow.

### Responsibility split

| Concern | Home | Rationale |
|---|---|---|
| SMTP/IMAP **config** persistence, admin CRUD, encryption-at-rest, activate/test endpoints | `features/system` (unchanged surface) | Admin-owned runtime config; already built |
| Mail **transport** (how to send SMTP / speak IMAP) + active-config resolution + `send` / inbox API | **`infrastructure/email` (new)** | Reusable low-level capability, consumed by many features |
| **Forgot-password** feature (endpoints, code lifecycle, emails) | `features/auth` | Feature logic, consumes the mailer |

### Dependency direction (strict)

`infrastructure/email` depends **only** on other infrastructure:
`infrastructure/database` (the `smtp_configs` / `imap_configs` tables already
live in `infrastructure/database/schema/system.schema.ts` — infra-level) and
`infrastructure/crypto` (`EncryptionService`). It **does not** import the
`system` feature module. Feature modules (`system`, `auth`, `mastra`) depend on
`infrastructure/email` — always **feature → infra**, never the reverse. This is
the same discipline `CryptoModule` follows today.

---

## 2. Architecture

```
                         ┌───────────────────────────────────────────┐
  HTTP (public, throttled)│  AuthController                            │
        │                 │  + POST /auth/forgot-password              │
        ▼                 │  + POST /auth/reset-password               │
  throttle → (Public)     └───────────────┬───────────────────────────┘
                                          ▼
                          ┌───────────────────────────────────────────┐
                          │  PasswordResetService (features/auth)      │
                          │  request() · reset() · single-active · HMAC │
                          └───┬───────────────┬───────────────┬────────┘
                              ▼               ▼               ▼
                    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                    │ PwdReset     │  │ Session/User │  │ ResetMailer  │
                    │ Repository   │  │ Repository   │  │ (templates)  │
                    └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                           ▼                 ▼                 ▼
                       PostgreSQL        PostgreSQL   ┌──────────────────────────┐
                                                      │ infrastructure/email     │
                                                      │  MailerService.send()    │
   features/mastra (send-email tool) ────────────────►│  InboxService.list/fetch │
   features/system (*.test() verify) ────────────────►│  transport/ (smtp,imap)  │
                                                      │  EmailConfigRepository   │
                                                      └───────┬──────────┬───────┘
                                                              ▼          ▼
                                                       smtp/imap_configs  crypto
                                                       (active row)    (decrypt)
```

**Module wiring**

- `EmailModule` imports `CryptoModule`; injects `DRIZZLE` (global
  `DatabaseModule`). Provides + exports `MailerService`, `InboxService`. Imported
  explicitly by every consumer so module-subset e2e stays self-sufficient (same
  reasoning `SystemModule` uses for `CacheModule`).
- `AuthModule` imports `EmailModule` (for `ResetMailer` → `MailerService`).
- `SystemModule` imports `EmailModule` (its `test()` methods delegate transport).
- `MastraModule` imports `EmailModule` (repoint the `sendEmail` tool dependency).
- `AppModule` registration order is unchanged (Mastra's catch-all controller
  stays last); `EmailModule` is infrastructure and carries no controllers.

---

## 3. `infrastructure/email` — structure

```
infrastructure/email/
  email.module.ts               # provides + exports MailerService, InboxService
  email-config.repository.ts     # read-only: active smtp/imap row -> decrypted conn
  email.types.ts                 # SmtpConn, ImapConn, EmailMessage, MailboxSummary, ParsedMessage, errors
  mailer.service.ts              # MailerService: send(), verifyActive()
  inbox.service.ts               # InboxService: list(), fetch(), markSeen(), markUnseen(), verifyActive()
  transport/
    smtp.transport.ts            # pure fns: sendMail(conn,msg), verifySmtp(conn)   (nodemailer)
    imap.transport.ts            # pure fns: verifyImap / listMessages / fetchMessage / setSeen (imapflow+mailparser)
  mailer.service.spec.ts
  inbox.service.spec.ts
  email-config.repository.spec.ts
  transport/*.spec.ts
```

Transport files are **pure, stateless functions** taking an explicit connection
object — directly unit-testable and independently mockable (exactly how
`smtp-tester.ts` is used today, just relocated and extended). The two services
add the "resolve the *active* config, then call transport" layer.

### Shared types (`email.types.ts`)

```ts
interface SmtpConn { host; port; secure; username: string | null;
  password: string | null; fromAddress; fromName: string | null; }
interface ImapConn { host; port; secure; username: string | null;
  password: string | null; }

interface EmailMessage { to: string; subject: string; text: string;
  html?: string; cc?: string; }

interface MailboxSummary { uid: number; from: string; subject: string;
  date: Date; seen: boolean; }
interface ParsedMessage extends MailboxSummary { to: string; text: string;
  html: string | null;
  attachments: { filename: string | null; contentType: string; size: number }[]; }

class NoActiveEmailConfigError extends Error {}   // thrown when no active SMTP/IMAP config
```

`NoActiveEmailConfigError` is a **domain** error (not an `HttpException`) — infra
must not know about HTTP. Callers decide how to react (the reset flow logs and
swallows it; see §12).

---

## 4. SMTP sending — `MailerService`

`transport/smtp.transport.ts` (relocated from `system/connection/smtp-tester.ts`,
unchanged logic):

```ts
sendMail(conn: SmtpConn, msg: EmailMessage): Promise<void>   // builds nodemailer transport, sends text (+html)
verifySmtp(conn: SmtpConn): Promise<void>                    // transport.verify(); throws on failure
```

`MailerService`:

```ts
send(msg: EmailMessage): Promise<void>   // resolve active SMTP -> sendMail; throws NoActiveEmailConfigError if none
verifyActive(): Promise<void>            // resolve active SMTP -> verifySmtp
```

This is the **single outbound-mail seam** for the whole app. Connection timeouts
stay as transport constants (10 s, matching current behaviour) — no env needed.

---

## 5. IMAP receiving — `InboxService` (full client)

### Library decision (verified)

Backed by **`imapflow`** (promise-based IMAP client) + **`mailparser`** (MIME
parsing) — both by the nodemailer author, same ecosystem.

> **CJS/ESM check (done, not assumed).** The `system-management` design
> deliberately hand-rolled its IMAP tester to "avoid the imapflow ESM/Jest
> problem seen with Mastra." That caution was precautionary. Verified against the
> registry: `imapflow@1.4.7` (`main: lib/imap-flow.js`, no `type: "module"`, no
> ESM `exports`) and `mailparser@3.9.14` (`main: index.js`) are **CommonJS**.
> They load cleanly under the `@swc/jest` transform, and unit specs mock
> `imapflow` entirely so its transitive deps never load in tests. The earlier
> concern applied to a connectivity-only check where a dependency wasn't worth
> it; now that we need real FETCH + MIME parsing, hand-rolling is the wrong
> trade. **Pin note:** add `imapflow`/`mailparser` with a caret but treat a
> future ESM-only major the way the meilisearch CJS pin is treated — do not
> upgrade across a module-system break without an ESM migration.

`transport/imap.transport.ts` — pure functions, each opening a short-lived
`ImapFlow` client (`connect()` → act → `logout()` in `try/finally`,
`logger: false`):

```ts
verifyImap(conn: ImapConn): Promise<void>
listMessages(conn: ImapConn, opts?: { mailbox?; limit?; unseenOnly? }): Promise<MailboxSummary[]>
fetchMessage(conn: ImapConn, uid: number, mailbox?): Promise<ParsedMessage | null>   // mailparser on the raw source
setSeen(conn: ImapConn, uid: number, value: boolean, mailbox?): Promise<void>
```

`InboxService` (resolves the active IMAP config, then delegates):

```ts
verifyActive(): Promise<void>
list(opts?): Promise<MailboxSummary[]>          // default mailbox INBOX, limit 50
fetch(uid, mailbox?): Promise<ParsedMessage | null>
markSeen(uid, mailbox?): Promise<void>
markUnseen(uid, mailbox?): Promise<void>
```

**Connection-per-operation** for v1 (simple, no shared state); a pooled /
long-lived connection is a documented future optimization (§15). **No HTTP
controller and no background poller in v1** — `InboxService` is pure
infrastructure exposed for a future inbound-processing feature. Nothing in the
current goal reads mail; building the endpoint/poller now would be speculative.

---

## 6. Active-config resolution — `EmailConfigRepository`

Read-only repository owned by the email module. Injects `DRIZZLE` +
`EncryptionService`; reads the single active row straight from the shared schema
tables and returns a decrypted connection object:

```ts
activeSmtp(): Promise<SmtpConn | null>   // smtpConfigs where isActive && !isDeleted; crypto.decrypt(secretEnc)
activeImap(): Promise<ImapConn | null>   // imapConfigs where isActive && !isDeleted; crypto.decrypt(secretEnc)
```

This is a **read** counterpart to `system`'s `SmtpConfigRepository` /
`ImapConfigRepository` (which own writes/CRUD). Two repositories touching the
same tables for different concerns is deliberate and keeps the dependency
direction clean — the email module never imports the `system` feature module.
The single-active partial-unique index (defined in the system schema) guarantees
at most one active row, so `LIMIT 1` is unambiguous.

---

## 7. Targeted refactor of `system` (code we're touching)

Minimal, mechanical, and justified by the extraction:

- **Move** transport logic out of `system/connection/` into
  `infrastructure/email/transport/`, then **delete**
  `system/connection/smtp-tester.ts` and `imap-tester.ts`.
- `SmtpConfigService.test(id)` and `ImapConfigService.test(id)` decrypt the
  **by-id** row (as they do now) and call `verifySmtp(conn)` / `verifyImap(conn)`
  from the transport module (new import path; same call shape). Their behaviour,
  audit rows, and `stampTest` are unchanged.
- **Remove** `SmtpConfigService.sendActive()` (superseded by
  `MailerService.send`). Repoint the mastra `sendEmail` tool dependency from
  `smtpConfigService.sendActive` → `mailerService.send`; `MastraModule` imports
  `EmailModule`.
- `SystemModule` imports `EmailModule`.

The `imap-tester.ts` connectivity check is replaced by `verifyImap` (imapflow),
so the system IMAP test now exercises the same client used for real fetches —
strictly better coverage of the config.

---

## 8. Forgot-password — endpoints

Two routes added to the existing `AuthController`, both `@Public()` and
throttled (the app already applies `@Throttle` to public auth routes):

| Method | Route | Body | Success | Throttle |
|---|---|---|---|---|
| POST | `/auth/forgot-password` | `{ email }` | **204 (always)** | 3 / 15 min per IP |
| POST | `/auth/reset-password` | `{ email, code, newPassword }` | **204** | 10 / 15 min per IP |

- **`forgot-password`** is **enumeration-safe**: it returns `204` whether or not
  the account exists, and whether or not mail delivery succeeds. It creates a
  code, invalidates any prior code, and sends the email best-effort.
- **`reset-password`** verifies the code and, on success, sets the new password,
  burns the code, revokes all sessions, and sends a confirmation email. Any
  business failure (unknown email, wrong/expired/consumed code, attempts
  exhausted) returns a **uniform** `401 "Invalid or expired reset code"` — never
  revealing which factor failed (mirrors the existing "uniform 401" login
  philosophy; `UnauthorizedException`, as `login`/`changePassword` use).
  Malformed input (non-6-digit `code`, short `newPassword`) is a separate `400`
  from `ZodValidationPipe` — the pipe rejects before any lookup, so it leaks
  nothing about the account.

No auto-login: the response carries no tokens, so the user logs in fresh.

---

## 9. Forgot-password — data model

New table in a new schema file
`infrastructure/database/schema/password-reset.schema.ts` (re-exported from the
schema barrel `index.ts`). Append-style lifecycle with an explicit consumed
marker, so it does **not** use `baseColumns` (same reasoning as `sessions`).

### `password_reset_codes`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK defaultRandom | |
| createdAt | timestamptz notNull defaultNow | |
| userId | uuid → users.id (on delete cascade) notNull | |
| codeHash | varchar(64) notNull | **HMAC-SHA256(code, pepper)** hex — see §10 |
| expiresAt | timestamptz notNull | now + 15 min |
| attemptCount | integer notNull default 0 | wrong-code guesses |
| consumedAt | timestamptz | single-use / burn marker (null = live) |

**Indexes:** `index(userId)`; `index(expiresAt)` (for cleanup). No unique index
on `codeHash` — lookup is always scoped by `userId` (see §10).

Types exported via `$inferSelect` / `$inferInsert`. Migration generated with
`pnpm db:generate`.

---

## 10. Token lifecycle & low-entropy hardening

- **Generation:** `crypto.randomInt(0, 1_000_000)` zero-padded to 6 digits.
  Cryptographic RNG, uniform over `000000`–`999999`.
- **Storage — HMAC with a server pepper, not plain sha256.** A 6-digit code has
  only 10⁶ preimages; a plain sha256 would be trivially brute-forced if the DB
  leaked. Stored value is `HMAC-SHA256(code, PASSWORD_RESET_PEPPER)` (hex, 64
  chars). Without the app-side pepper a DB dump alone cannot recover codes. This
  is a deliberate divergence from the `sessions` table's plain sha256, which is
  safe there only because refresh tokens are 256-bit random. A small
  `ResetCodeHasher` (in `auth`, wrapping `node:crypto.createHmac`) owns this.
- **Single active code:** on each `forgot-password`, mark all of the user's
  live (`consumedAt IS NULL`) rows consumed **before** inserting the new one, so
  only the most recent code is ever valid.
- **Verify path (`reset-password`):**
  1. Look up the user by email (lowercased). If missing → run equalizing dummy
     work (an HMAC + a throwaway `argon2.verify`) and return the uniform `401`.
  2. Load the user's live code row. Reject (uniform `401`) if none / expired /
     already consumed.
  3. Compare `HMAC(submitted) === codeHash` (`crypto.timingSafeEqual`).
     - Mismatch → `attemptCount++`; if it reaches **5**, mark consumed (burn);
       return the uniform `401`.
     - Match → set new `passwordHash` (argon2id), mark the code consumed,
       `sessions.revokeAllForUser(userId)`, send confirmation email, `204`.
- **TTL 15 min, max 5 attempts** — matching the agreed OTP profile.

---

## 11. Forgot-password — components (`features/auth`)

- **`PasswordResetService`** — orchestration. Deps: `UserRepository`,
  `PasswordResetRepository`, `SessionRepository`, `PasswordService`,
  `ResetCodeHasher`, `ResetMailer`.
  - `request(email, ctx)` → find user, invalidate prior codes, insert new code,
    `ResetMailer.sendCode(...)` best-effort. Always resolves (never throws to the
    controller).
  - `reset(email, code, newPassword)` → the §10 verify path.
- **`PasswordResetRepository`** — `insert`, `findLiveByUser(userId)`,
  `consumeAllForUser(userId)`, `incrementAttempts(id)`, `consume(id)`,
  `deleteExpired()` (cleanup helper).
- **`ResetCodeHasher`** — `generate(): string`, `hash(code): string` (HMAC),
  `verify(code, hash): boolean` (`timingSafeEqual`). Reads pepper from config.
- **`ResetMailer`** — owns the two message templates and delegates to
  `MailerService.send`. Keeps email copy out of the security logic and gives a
  trivially mockable seam.
  - `sendCode(email, code)` — "Your reset code is NNNNNN (expires in 15
    minutes). If you didn't request this, ignore this email."
  - `sendChangedConfirmation(email)` — "Your password was changed. If this
    wasn't you, contact support immediately."
  - Text + a minimal HTML variant.
- **DTOs (zod)** in `auth/dto/`, one per file (existing pattern):
  - `forgot-password.dto.ts` — `{ email: z.string().email() }`.
  - `reset-password.dto.ts` — `{ email: email, code: /^\d{6}$/,
    newPassword: z.string().min(12).max(200) }` (reuses the `changePassword`
    strength rule).
- **Controller** — two methods on `AuthController`, `@Public()` + `@Throttle`,
  `@HttpCode(204)`, `ZodValidationPipe`, request context (`ip`, `userAgent`) via
  the existing `reqContext(req)` helper.
- **Module** — `AuthModule` imports `EmailModule`; registers the new providers.

---

## 12. Security & error handling

- **Enumeration-safe throughout.** `forgot-password` always `204`.
  `reset-password` returns the same `401` for every business failure factor
  (validation `400`s are pre-lookup and account-agnostic). Timing is equalized
  on the unknown-email path with dummy HMAC + argon2 work.
- **Email is best-effort.** `MailerService.send` failures (including
  `NoActiveEmailConfigError`) are caught in `PasswordResetService.request`,
  logged at `error`, and **never** change the `204`. Ops must configure an active
  SMTP profile for delivery; absence is a logged operational warning, not a user-
  visible error (and not an enumeration signal).
- **Throttling.** `@Throttle` per-IP on both routes (values above). Per-account
  abuse is additionally bounded by the single-active-code rule (a new request
  simply supersedes the old code).
- **Session invalidation.** Successful reset calls
  `sessions.revokeAllForUser(userId)` — identical to `changePassword`, forcing
  re-login everywhere (theft-response consistent with the existing family-revoke
  logic).
- **Structured logging** (pino): `forgot_requested` (userId or `unknown`),
  `reset_succeeded`, `reset_failed{reason}`, `reset_lockout`. **Never** log
  plaintext codes, HMACs, or passwords.
- **No plaintext at rest.** Only the HMAC of the code is stored; the plaintext
  exists only in the outbound email and the request/verify call frames.

---

## 13. Config & env additions

Extend the existing `auth` config namespace (`auth.config.ts` +
`env.validation.ts`) with a `passwordReset` block rather than a new namespace —
it is auth-owned policy:

```ts
passwordReset: {
  pepper: env.PASSWORD_RESET_PEPPER,   // HMAC key
  codeTtlSeconds: 900,                 // 15 min
  maxAttempts: 5,
  codeLength: 6,
}
```

- `PASSWORD_RESET_PEPPER`: dev/test default provided so the app boots without
  setup; `superRefine` requires a non-default value of adequate length when
  `NODE_ENV === 'production'` — same pattern as `SYSTEM_ENCRYPTION_KEY`.
- The email module itself needs **no** new env (its config is DB-backed; timeouts
  are transport constants).

---

## 14. Testing

Repo conventions: colocated `*.spec.ts` units (`@swc/jest`); e2e boots a
**module subset**, never `AppModule` (Mastra ESM breaks Jest — established
constraint).

**Unit**

- `smtp.transport.spec.ts` / `imap.transport.spec.ts` — mock `nodemailer` /
  `imapflow`; assert transport built from `conn`, send/verify/list/fetch/flag
  call the client correctly, `mailparser` output mapped to `ParsedMessage`.
- `email-config.repository.spec.ts` — active row resolved, `secretEnc`
  decrypted, `null` when no active row.
- `mailer.service.spec.ts` / `inbox.service.spec.ts` — resolve-active then
  delegate; `NoActiveEmailConfigError` when no config.
- `reset-code-hasher.spec.ts` — 6-digit format/range; HMAC stable; `verify`
  timing-safe true/false.
- `password-reset.service.spec.ts` — request creates + invalidates prior +
  emails; **best-effort mail**: a throwing `ResetMailer.sendCode` still resolves
  `request` (no throw out); unknown email → no throw, no code, dummy work runs;
  verify success (password updated, code consumed, `revokeAllForUser` called,
  confirmation sent); expired / consumed / wrong-code (attempt++) / 5th-attempt
  burn.
- `reset-mailer.spec.ts` — both templates call `MailerService.send` with the
  expected subject/body (swallow behaviour is owned by the service, above).
- Update `smtp-config.service.spec.ts` / `imap-config.service.spec.ts` for the
  new transport import (delegation unchanged).

**e2e** (`password-reset.e2e-spec.ts`) — boot the **auth + email module subset**
(not `AppModule`), overriding `MailerService` with a capturing fake that records
sent messages (so the test reads the generated code; no live SMTP, no seeded
config row, no `SystemModule` needed):

- forgot → reset happy path (read the code from the fake mailer) → new password
  logs in, old sessions rejected, confirmation message captured.
- `forgot-password` for unknown email → `204`, fake mailer recorded nothing.
- wrong code ×5 → lockout; 6th attempt still uniform `401`.
- expired code → uniform `401`.
- per-IP throttle returns `429` past the limit.

---

## 15. Deferred (YAGNI — not in v1)

- **IMAP endpoint / background poller** — `InboxService` is infra only; a
  consuming feature (with its own controller or BullMQ poller) is future work.
- **Pooled / long-lived IMAP connection** — v1 is connection-per-operation.
- **HTML email templating engine** — inline text + minimal HTML strings for now.
- **Password-history / reuse check** on reset — only the min-length rule in v1.
- **Expired-code sweep job** — `deleteExpired()` exists; wiring a scheduled sweep
  is deferred (expired rows are already inert).
- **Multi-active mail profiles / per-tenant routing** — single active config,
  single-tenant, consistent with the system module.

---

## 16. File Manifest

```
src/infrastructure/email/
  email.module.ts
  email-config.repository.ts        email-config.repository.spec.ts
  email.types.ts
  mailer.service.ts                 mailer.service.spec.ts
  inbox.service.ts                  inbox.service.spec.ts
  transport/
    smtp.transport.ts               smtp.transport.spec.ts
    imap.transport.ts               imap.transport.spec.ts

src/infrastructure/database/schema/
  password-reset.schema.ts          (+ export from index.ts)

src/config/
  configurations/auth.config.ts     (+ passwordReset block)
  env.validation.ts                 (+ PASSWORD_RESET_PEPPER, prod superRefine)

src/features/auth/
  auth.controller.ts                (+ forgot-password, reset-password routes)
  auth.module.ts                    (import EmailModule; register providers)
  password-reset.service.ts         password-reset.service.spec.ts
  password-reset.repository.ts
  reset-code-hasher.ts              reset-code-hasher.spec.ts
  reset-mailer.ts                   reset-mailer.spec.ts
  dto/
    forgot-password.dto.ts          reset-password.dto.ts

src/features/system/
  smtp-config.service.ts            (test() -> email transport; drop sendActive)
  imap-config.service.ts            (test() -> email transport)
  system.module.ts                  (import EmailModule)
  connection/                       (DELETED: smtp-tester.ts, imap-tester.ts)

src/features/mastra/
  (sendEmail tool dependency -> MailerService; module imports EmailModule)

test/
  password-reset.e2e-spec.ts        (auth + email subset; MailerService faked)

package.json                        (+ imapflow, mailparser, @types/mailparser)
.env.example                        (+ PASSWORD_RESET_PEPPER)
```
