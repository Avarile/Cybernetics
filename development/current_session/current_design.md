# Design — Centralized Exception Handling Module (v1)

**Status:** Approved (design), pre-implementation
**Location:** `api/src/infrastructure/exceptions/`
**Date:** 2026-07-17

---

## 1. Goal & principles

Centralize the *definition*, *construction*, and *handling* of every exception in the
API. All modules throw through one injectable service; one global filter normalizes
every error — ours, NestJS's, Mastra's, and raw driver errors — into a single,
machine-readable response envelope, logs it, and reports server-side faults to Sentry.

**v1 is deliberately simple, clean, reliable:**

- One error-code registry as the single source of truth (status + kind + message).
- One injectable `ExceptionService` as the throw API.
- One global filter as the only normalizer/logger/reporter.
- **Types only** — no new database table (Sentry + Pino already persist for triage).

### Non-goals (v1)

- No persistent `error_log` table (Sentry is the store of record).
- No i18n of messages (English defaults; envelope is code-driven so clients can localize).
- No implementing the Mastra approval-expiry gap (tracked separately; see §14).
- No retry/circuit-breaker logic (BullMQ retry stays where it is).

---

## 2. Scope — exception categories in the codebase (survey result)

### A. Domain errors — already NestJS `HttpException` (mostly correct today)

| Category | HTTP | Notes |
|---|---|---|
| resource-not-found | 404 | ubiquitous |
| duplicate / conflict | 409 | always pre-checked; **no** DB unique-violation catch anywhere |
| invalid-state / lifecycle | 409 | file status machine (`not PENDING/AVAILABLE`) |
| input-validation | 400 | **two inconsistent shapes**: zod pipe `issues:[{path,message}]` vs search `issues:string[]` |
| auth: invalid-credentials | 401 | deliberately uniform messages |
| auth: token invalid/expired/reuse | 401 | reuse triggers token-family revocation |
| auth: reset-code invalid | 401 | enumeration-safe collapse |
| authorization / ownership | inconsistent | file-processor returns **404** (masking); mastra uses **403** |

### B. Infra / external-service errors — mostly RAW → leak as generic 500

DB connection/pool · DB unique-violation (`23505`) · Redis + corrupt-JSON `SyntaxError` ·
BullMQ enqueue/scheduler · MinIO connect/access/not-found · SMTP/IMAP send/verify/fetch/timeout ·
MIME parse · crypto misconfig + AES-GCM decrypt failure. Only **Meilisearch** is wrapped
(`SearchEngineError` → 503). `NoActiveEmailConfigError` exists but is never HTTP-mapped.

### C. AI / Agent (Mastra) errors — mostly RAW → 500

agent-run failure · LLM/gateway rate-limit/timeout/provider (unclassified) · tool
execution/validation · workflow non-success (failed/tripwire/paused) · scheduling ·
approval-resume failure · approval-expiry (modeled but unimplemented). HITL
approval-required is a **control signal**, not an error.

### D. Best-effort / swallowed (logged, never surfaced)

email delivery, audit writes, re-index, attachment upload, object purge, scheduler
registration. **These stay swallowed** — v1 does not change best-effort semantics.

### Facts shaping the design

1. `SentryGlobalFilter` is the sole `APP_FILTER` today (reports, then default response).
2. No machine-readable error codes exist — clients discriminate on human strings only.
3. `MastraError` (`@mastra/core@1.50.1`) is structured: `id`, `domain`, `category`
   (`USER|SYSTEM|THIRD_PARTY|UNKNOWN`), `details`, `cause`, `toJSON()` — a ready taxonomy.
4. Biggest win: catching raw infra/LLM/crypto errors so they stop leaking as 500s.

---

## 3. Architecture overview

```
                       throw this.errors.create(ErrorCode.X)
  feature/infra code ─────────────────────────────────────────► AppException
        │                                                            │
        │ raw Error / MastraError / ZodError / driver error          │
        ▼                                                            ▼
  ┌──────────────────────────  GlobalExceptionFilter  ─────────────────────────┐
  │  errors.from(exception)  →  AppException (normalized)                        │
  │  ├─ log by kind (Pino, correlationId)                                        │
  │  ├─ Sentry.captureException() for DEPENDENCY / INTERNAL (tags: code, corrId) │
  │  └─ res.status(status).json(envelope)                                        │
  └─────────────────────────────────────────────────────────────────────────────┘
```

- `ExceptionService.from()` is the single mapping brain; the filter reuses it.
- `AppException` is a plain class — usable via the service *or* `new` (non-DI contexts).

---

## 4. Schema 1 — Error-code taxonomy (single source of truth)

### 4.1 Kinds (drive logging + Sentry, mirror Mastra's category)

```ts
export enum ErrorKind {
  CLIENT     = 'CLIENT',      // 4xx, caller's fault      — log debug, no Sentry
  DEPENDENCY = 'DEPENDENCY',  // 502/503/504, ext. down   — log error, Sentry
  INTERNAL   = 'INTERNAL',    // 500, our bug             — log error, Sentry (raw msg hidden)
}
```

### 4.2 Registry

```ts
interface ErrorSpec { status: HttpStatus; kind: ErrorKind; message: string; }
export const ERROR_REGISTRY: Record<ErrorCode, ErrorSpec> = { … };
```

Code format: `DOMAIN_REASON`, SCREAMING_SNAKE (same shape as `MastraError.id`, so mapped
Mastra errors read as native). **v1 seed** (add codes by adding registry lines):

| Code | Status | Kind |
|---|---|---|
| `VALIDATION_FAILED` | 400 | CLIENT |
| `NOT_FOUND` | 404 | CLIENT |
| `CONFLICT` | 409 | CLIENT |
| `UNAUTHORIZED` | 401 | CLIENT |
| `FORBIDDEN` | 403 | CLIENT |
| `RATE_LIMITED` | 429 | CLIENT |
| `DEPENDENCY_UNAVAILABLE` | 503 | DEPENDENCY |
| `INTERNAL_ERROR` | 500 | INTERNAL |
| `AUTH_INVALID_CREDENTIALS` | 401 | CLIENT |
| `AUTH_TOKEN_INVALID` | 401 | CLIENT |
| `AUTH_TOKEN_EXPIRED` | 401 | CLIENT |
| `AUTH_TOKEN_REUSE` | 401 | CLIENT |
| `AUTH_RESET_CODE_INVALID` | 401 | CLIENT |
| `AUTH_SERVICE_CREDENTIAL_INVALID` | 401 | CLIENT |
| `USER_NOT_FOUND` | 404 | CLIENT |
| `USER_EMAIL_TAKEN` | 409 | CLIENT |
| `FILE_NOT_FOUND` | 404 | CLIENT |
| `FILE_INVALID_STATE` | 409 | CLIENT |
| `FILE_TOO_LARGE` | 400 | CLIENT |
| `FILE_MIME_NOT_ALLOWED` | 400 | CLIENT |
| `FILE_UPLOAD_MISSING` | 400 | CLIENT |
| `SEARCH_COLLECTION_NOT_FOUND` | 404 | CLIENT |
| `SEARCH_COLLECTION_EXISTS` | 409 | CLIENT |
| `SEARCH_QUERY_INVALID` | 400 | CLIENT |
| `SEARCH_RECORD_NOT_FOUND` | 404 | CLIENT |
| `SEARCH_UNAVAILABLE` | 503 | DEPENDENCY |
| `CONFIG_NOT_FOUND` | 404 | CLIENT |
| `MAIL_CONFIG_MISSING` | 503 | DEPENDENCY |
| `CRYPTO_DECRYPT_FAILED` | 500 | INTERNAL |
| `CRYPTO_MISCONFIGURED` | 500 | INTERNAL |
| `MAILBOX_MESSAGE_NOT_FOUND` | 404 | CLIENT |
| `MAILBOX_ATTACHMENT_NOT_FOUND` | 404 | CLIENT |
| `MAILBOX_ACCOUNT_UNRESOLVED` | 400 | CLIENT |
| `MAILBOX_SYNC_FAILED` | 502 | DEPENDENCY |
| `AGENT_CONVERSATION_NOT_FOUND` | 404 | CLIENT |
| `AGENT_APPROVAL_NOT_FOUND` | 404 | CLIENT |
| `AGENT_APPROVAL_CONFLICT` | 409 | CLIENT |
| `AGENT_APPROVAL_FORBIDDEN` | 403 | CLIENT |
| `AGENT_REQUEST_INVALID` | 400 | CLIENT |
| `AGENT_RUN_FAILED` | 500 | INTERNAL |
| `TOOL_EXECUTION_FAILED` | 500 | INTERNAL |
| `LLM_RATE_LIMITED` | 429 | CLIENT |
| `LLM_TIMEOUT` | 504 | DEPENDENCY |
| `LLM_PROVIDER_ERROR` | 502 | DEPENDENCY |
| `DB_UNAVAILABLE` | 503 | DEPENDENCY |
| `CACHE_UNAVAILABLE` | 503 | DEPENDENCY |
| `QUEUE_UNAVAILABLE` | 503 | DEPENDENCY |
| `STORAGE_UNAVAILABLE` | 503 | DEPENDENCY |
| `STORAGE_OBJECT_NOT_FOUND` | 404 | CLIENT |
| `EMAIL_SEND_FAILED` | 502 | DEPENDENCY |

**Invariant (unit-tested):** every `ErrorCode` enum member has exactly one `ERROR_REGISTRY` entry.

---

## 5. Schema 2 — Client-facing error envelope

Every error response — regardless of source — comes out in exactly this shape:

```jsonc
{
  "error": {
    "code": "USER_NOT_FOUND",          // stable, machine-readable — clients branch on this
    "message": "User not found",       // safe, human-readable (never a raw stack/driver msg)
    "statusCode": 404,
    "details": null,                    // optional; validation → { issues: [{ path, message }] }
    "correlationId": "req_01J9X…",      // ties response to Pino log line + Sentry event
    "timestamp": "2026-07-17T12:34:56.789Z",
    "path": "/api/users/123"
  }
}
```

- **Validation `details`** standardizes on `{ issues: [{ path, message }] }` (kills the two-shape split).
- **INTERNAL (500) never leaks** raw message/stack — client gets the generic `INTERNAL_ERROR`
  message; the true cause goes only to Pino + Sentry, keyed by `correlationId`.
- `correlationId` = the `pino-http` request id (`req.id`). Also set as a Sentry tag.

```ts
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    statusCode: number;
    details?: unknown;
    correlationId: string;
    timestamp: string;      // ISO-8601
    path: string;
  };
}
```

---

## 6. `AppException`

```ts
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly kind: ErrorKind;
  readonly details?: unknown;
  constructor(code: ErrorCode, opts?: { message?: string; details?: unknown; cause?: unknown }) {
    const spec = ERROR_REGISTRY[code];
    super({ code, message: opts?.message ?? spec.message, details: opts?.details },
          spec.status, { cause: opts?.cause });
    this.code = code; this.kind = spec.kind; this.details = opts?.details;
  }
}
```

Extends `HttpException` so it degrades gracefully even without the filter and behaves for any
`instanceof HttpException` checks. Being a plain class, it also works in non-DI contexts
(e.g. the Zod pipe constructed via `new`).

---

## 7. `ExceptionService` (injectable throw API)

`@Global`, **dependency-free** (no injected deps → no DI cycles even though everything depends on it).

```ts
@Injectable()
export class ExceptionService {
  /** Workhorse. `throw this.errors.create(ErrorCode.USER_NOT_FOUND, { details })`. */
  create(code: ErrorCode, opts?: { message?: string; details?: unknown; cause?: unknown }): AppException;

  /** Convenience for validation — shapes `details.issues = [{ path, message }]`. */
  validation(issues: Array<{ path: string; message: string }>, opts?: { message?: string }): AppException;

  /** Normalize ANY thrown value into an AppException. The filter's single mapping brain. */
  from(err: unknown): AppException;
}
```

Methods **return** the exception (caller writes `throw`) to preserve TypeScript control-flow
narrowing. Non-DI callers use `new AppException(...)` directly.

### 7.1 `from()` resolution order

1. `instanceof AppException` → pass through.
2. `instanceof HttpException` (Nest built-ins incl. `ThrottlerException`→429, and the zod
   pipe's 400) → map status→code; special-case a `{ message:'Validation failed', issues }`
   body → `VALIDATION_FAILED` + details.
3. `instanceof ZodError` → `VALIDATION_FAILED` + `issues`.
4. `instanceof MastraError` → `mastra-error.mapper` (§8).
5. Known infra errors → `infra-error.mapper` (§9).
6. Fallback → `INTERNAL_ERROR` (500), raw message hidden, original kept as `cause`.

---

## 8. Mastra error mapping (`mappers/mastra-error.mapper.ts`)

`kind` is driven by `MastraError.category`; `code` is refined by `domain` so the chosen code's
registry kind matches the category (keeps the registry invariant intact). `id`, `details`,
and `cause` are preserved (`id` surfaced in `details.mastraId`).

| category | domain | → code |
|---|---|---|
| `USER` | `TOOL` / `MCP` | `AGENT_REQUEST_INVALID` (400) |
| `USER` | any other | `AGENT_REQUEST_INVALID` (400) |
| `THIRD_PARTY` | `LLM` / `MODEL_ROUTER` | `LLM_PROVIDER_ERROR` (502) |
| `THIRD_PARTY` | `STORAGE` / `MASTRA_MEMORY` / `MASTRA_VECTOR` | `DEPENDENCY_UNAVAILABLE` (503) |
| `THIRD_PARTY` | any other | `LLM_PROVIDER_ERROR` (502) |
| `SYSTEM` / `UNKNOWN` | `TOOL` / `MCP` | `TOOL_EXECUTION_FAILED` (500) |
| `SYSTEM` / `UNKNOWN` | any other | `AGENT_RUN_FAILED` (500) |

**Rate-limit / timeout sub-classification is best-effort in v1:** if the underlying provider
error cheaply reveals a 429 or timeout (status/name/code sniff), map to `LLM_RATE_LIMITED` /
`LLM_TIMEOUT`; otherwise `LLM_PROVIDER_ERROR`. Refinement deferred to v2.

---

## 9. Infra error mapping (`mappers/infra-error.mapper.ts`)

Central boundary normalization — **avoids sprinkling try/catch into every adapter**:

| Source error | Detection | → code |
|---|---|---|
| Postgres unique violation | `err.code === '23505'` | `CONFLICT` |
| Other pg driver / connection | `err.code` in pg class 08/57/53 or driver name | `DB_UNAVAILABLE` |
| `SearchEngineError` | `instanceof` | `SEARCH_UNAVAILABLE` |
| `NoActiveEmailConfigError` | `instanceof` | `MAIL_CONFIG_MISSING` |
| Crypto (`Malformed encryption envelope` / GCM auth-tag) | message / name | `CRYPTO_DECRYPT_FAILED` |
| Redis / ioredis connection | error name/class | `CACHE_UNAVAILABLE` |
| MinIO / S3 (`NoSuchKey`) | code | `STORAGE_OBJECT_NOT_FOUND` |
| MinIO / S3 connection / access | code/name | `STORAGE_UNAVAILABLE` |
| Nodemailer send/verify | name/code | `EMAIL_SEND_FAILED` |

Anything unmatched falls through to `INTERNAL_ERROR`. The mapper is intentionally small and
pragmatic in v1; adapters that already translate (e.g. `search-record.service`) throw
`AppException` directly, with the mapper as the safety net.

---

## 10. `GlobalExceptionFilter` + wiring

```ts
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly errors: ExceptionService, private readonly logger: PinoLogger) {}
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const appErr = this.errors.from(exception);
    const correlationId = req.id ?? '—';

    if (appErr.kind === ErrorKind.CLIENT) this.logger.debug({ code: appErr.code, correlationId });
    else this.logger.error({ err: exception, code: appErr.code, correlationId });

    if (appErr.kind !== ErrorKind.CLIENT) {
      Sentry.captureException(appErr.cause ?? exception, { tags: { code: appErr.code, correlationId } });
    }
    res.status(appErr.getStatus()).json(buildEnvelope(appErr, correlationId, req.url));
  }
}
```

```ts
@Global()
@Module({
  providers: [ExceptionService, { provide: APP_FILTER, useClass: GlobalExceptionFilter }],
  exports: [ExceptionService],
})
export class ExceptionsModule {}
```

- Import `ExceptionsModule` in `AppModule` (after `LoggerModule`; `@Global` so location only
  affects filter binding, not injectability).
- **Remove** `SentryGlobalFilter` from `ObservabilityModule` (keep `SentryModule.forRoot()` +
  `instrument.ts`). Our filter now owns Sentry capture, avoiding double reporting and adding
  `code`/`correlationId` tags.

### Folder layout (`api/src/infrastructure/exceptions/`, files <500 lines)

```
exceptions.module.ts
app-exception.ts
error-codes.ts                 ErrorCode enum + ErrorKind enum
error-registry.ts   (+spec)    ERROR_REGISTRY: code → {status,kind,message}
error-envelope.ts              envelope type + builder
exception.service.ts (+spec)   create / validation / from
global-exception.filter.ts (+spec)
mappers/mastra-error.mapper.ts (+spec)
mappers/infra-error.mapper.ts  (+spec)
index.ts                       barrel
```

---

## 11. Conventions settled during design

1. **Ownership → 403 by default** (`FORBIDDEN`); keep deliberate 404-masking only where hiding
   existence is the intent (file-processor) via explicit `FILE_NOT_FOUND` — masking becomes a
   documented choice, not an accident.
2. **Validation shape** is `{ issues: [{ path, message }] }` everywhere (Zod pipe +
   `search-record.service`).
3. **Best-effort/swallowed** side effects (§2.D) keep their current semantics — v1 does not
   convert them to thrown exceptions.
4. **HITL approval-required** stays a control signal, not an error.

---

## 12. Migration plan (full — every call site)

1. **Build** the module (registry, `AppException`, `ExceptionService`, filter, mappers) + unit tests.
2. **Wire**: import `ExceptionsModule` in `AppModule`; remove `SentryGlobalFilter`.
3. **Feature modules** (auth, users, file-processor, search-service, system, mailbox, mastra):
   replace every `throw new XxxException(...)` with `throw this.errors.create(ErrorCode.…)`,
   injecting `ExceptionService`; add any missing domain codes to the registry.
4. **Infra**: rely on `infra-error.mapper` at the boundary; convert the one existing explicit
   translation (`search-record.service` `SearchEngineError`→503) to `AppException`.
5. **Standardize validation** output (Zod pipe + `search-record.service`).
6. **Apply convention fixes** (§11.1 403-vs-404).

---

## 13. Testing

Co-located `.spec.ts` (repo convention):

- **Registry completeness** — every `ErrorCode` has exactly one spec; statuses are valid.
- **`ExceptionService`** — `create`/`validation` produce correct status/kind/body; `from()`
  mapping table (AppException / HttpException / ZodError / MastraError per category×domain /
  pg-`23505` / `SearchEngineError` / crypto / unknown).
- **`GlobalExceptionFilter`** — for each kind: correct HTTP status, exact envelope shape,
  Sentry capture called only for DEPENDENCY/INTERNAL, raw message hidden for INTERNAL.
- **Regression** — existing module specs still pass after migration (statuses unchanged where
  behavior is intentionally preserved).

---

## 14. Deferred to v2

- Mastra approval-expiry implementation (the modeled-but-unused `'expired'` status).
- Finer LLM error sub-classification (rate-limit/timeout precision across providers).
- Optional persistent `error_log` table if in-app querying is later needed.
- i18n of `message` (envelope already code-driven).
