# Centralized Exception Handling Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one global exception module that all code throws through and that normalizes every error (ours, NestJS, Mastra, raw driver errors) into a single machine-readable HTTP envelope, then migrate every existing throw site onto it.

**Architecture:** A single `ERROR_REGISTRY` (code → status/kind/message) is the source of truth. `AppException` is a plain `HttpException` subclass built from a code. The `@Global` injectable `ExceptionService` is the throw API (`create`/`validation`) and the single normalizer (`from`). One `GlobalExceptionFilter` (`@Catch()`) calls `from()`, logs by kind via Pino, reports DEPENDENCY/INTERNAL to Sentry, and writes the envelope. Two mappers translate `MastraError` and raw infra errors.

**Tech Stack:** NestJS (Express), TypeScript, `nestjs-pino`, `@sentry/nestjs`, `zod`, Jest. Design source: `development/current_session/current_design.md`.

## Global Constraints

- Keep every file under 500 lines (repo rule, `api/CLAUDE.md`).
- Read a file before editing it; prefer editing existing files over new ones.
- Never add a `Co-Authored-By` trailer to commits (repo rule).
- Co-locate tests as `*.spec.ts` next to the file under test (repo convention).
- Run from `api/`: build = `npm run build`, tests = `npm test` (Jest). Single spec: `npx jest <path>`.
- All new module files live in `api/src/infrastructure/exceptions/`.
- Preserve existing HTTP **statuses** during migration; preserve **messages** by passing `{ message }` overrides where a call site's message differs from the registry default.
- `ExceptionService` must stay **dependency-free** (no injected providers) so nothing forms a DI cycle.

---

## File Structure

```
api/src/infrastructure/exceptions/
  error-codes.ts                    ErrorKind enum + ErrorCode enum
  error-registry.ts                 ErrorSpec, ERROR_REGISTRY, STATUS_TO_CODE
  error-registry.spec.ts            registry completeness invariant
  app-exception.ts                  AppException class
  app-exception.spec.ts
  error-envelope.ts                 ErrorEnvelope type + buildEnvelope()
  error-envelope.spec.ts
  mappers/mastra-error.mapper.ts    isMastraError() + mapMastraError()
  mappers/mastra-error.mapper.spec.ts
  mappers/infra-error.mapper.ts     mapInfraError()
  mappers/infra-error.mapper.spec.ts
  exception.service.ts              ExceptionService (create/validation/from)
  exception.service.spec.ts
  global-exception.filter.ts        GlobalExceptionFilter
  global-exception.filter.spec.ts
  exceptions.module.ts              @Global module (ExceptionService + APP_FILTER)
  index.ts                          barrel export
```

Modified outside the module: `app.module.ts` (import module), `infrastructure/observability/sentry.module.ts` (drop `SentryGlobalFilter`), `common/pipes/zod-validation.pipe.ts`, and the 7 feature modules' service + spec files.

---

## PHASE 1 — Core module

### Task 1: Error codes, kinds, and registry

**Files:**
- Create: `api/src/infrastructure/exceptions/error-codes.ts`
- Create: `api/src/infrastructure/exceptions/error-registry.ts`
- Test: `api/src/infrastructure/exceptions/error-registry.spec.ts`

**Interfaces:**
- Produces: `enum ErrorKind { CLIENT, DEPENDENCY, INTERNAL }`; `enum ErrorCode` (string members); `interface ErrorSpec { status: HttpStatus; kind: ErrorKind; message: string }`; `const ERROR_REGISTRY: Record<ErrorCode, ErrorSpec>`; `const STATUS_TO_CODE: Partial<Record<number, ErrorCode>>`.

- [ ] **Step 1: Write the failing test**

`error-registry.spec.ts`:
```ts
import { HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorKind } from './error-codes';
import { ERROR_REGISTRY } from './error-registry';

describe('ERROR_REGISTRY', () => {
  it('has exactly one spec for every ErrorCode', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_REGISTRY[code]).toBeDefined();
    }
    expect(Object.keys(ERROR_REGISTRY).sort()).toEqual(
      Object.values(ErrorCode).sort(),
    );
  });

  it('every spec has a valid status, a known kind, and a non-empty message', () => {
    for (const spec of Object.values(ERROR_REGISTRY)) {
      expect(Object.values(HttpStatus)).toContain(spec.status);
      expect(Object.values(ErrorKind)).toContain(spec.kind);
      expect(spec.message.length).toBeGreaterThan(0);
    }
  });

  it('CLIENT specs are 4xx; DEPENDENCY/INTERNAL are 5xx', () => {
    for (const spec of Object.values(ERROR_REGISTRY)) {
      if (spec.kind === ErrorKind.CLIENT) {
        expect(spec.status).toBeGreaterThanOrEqual(400);
        expect(spec.status).toBeLessThan(500);
      } else {
        expect(spec.status).toBeGreaterThanOrEqual(500);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/infrastructure/exceptions/error-registry.spec.ts`
Expected: FAIL — cannot find module `./error-codes`.

- [ ] **Step 3: Write `error-codes.ts`**

```ts
export enum ErrorKind {
  CLIENT = 'CLIENT',
  DEPENDENCY = 'DEPENDENCY',
  INTERNAL = 'INTERNAL',
}

export enum ErrorCode {
  // common
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  RATE_LIMITED = 'RATE_LIMITED',
  DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  // auth
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_REUSE = 'AUTH_TOKEN_REUSE',
  AUTH_RESET_CODE_INVALID = 'AUTH_RESET_CODE_INVALID',
  AUTH_SERVICE_CREDENTIAL_INVALID = 'AUTH_SERVICE_CREDENTIAL_INVALID',
  // user
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_EMAIL_TAKEN = 'USER_EMAIL_TAKEN',
  // file
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_INVALID_STATE = 'FILE_INVALID_STATE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_MIME_NOT_ALLOWED = 'FILE_MIME_NOT_ALLOWED',
  FILE_UPLOAD_MISSING = 'FILE_UPLOAD_MISSING',
  // search
  SEARCH_COLLECTION_NOT_FOUND = 'SEARCH_COLLECTION_NOT_FOUND',
  SEARCH_COLLECTION_EXISTS = 'SEARCH_COLLECTION_EXISTS',
  SEARCH_QUERY_INVALID = 'SEARCH_QUERY_INVALID',
  SEARCH_RECORD_NOT_FOUND = 'SEARCH_RECORD_NOT_FOUND',
  SEARCH_UNAVAILABLE = 'SEARCH_UNAVAILABLE',
  // config / crypto
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  MAIL_CONFIG_MISSING = 'MAIL_CONFIG_MISSING',
  CRYPTO_DECRYPT_FAILED = 'CRYPTO_DECRYPT_FAILED',
  CRYPTO_MISCONFIGURED = 'CRYPTO_MISCONFIGURED',
  // mailbox
  MAILBOX_MESSAGE_NOT_FOUND = 'MAILBOX_MESSAGE_NOT_FOUND',
  MAILBOX_ATTACHMENT_NOT_FOUND = 'MAILBOX_ATTACHMENT_NOT_FOUND',
  MAILBOX_ACCOUNT_UNRESOLVED = 'MAILBOX_ACCOUNT_UNRESOLVED',
  MAILBOX_SYNC_FAILED = 'MAILBOX_SYNC_FAILED',
  // agent / llm
  AGENT_CONVERSATION_NOT_FOUND = 'AGENT_CONVERSATION_NOT_FOUND',
  AGENT_APPROVAL_NOT_FOUND = 'AGENT_APPROVAL_NOT_FOUND',
  AGENT_APPROVAL_CONFLICT = 'AGENT_APPROVAL_CONFLICT',
  AGENT_APPROVAL_FORBIDDEN = 'AGENT_APPROVAL_FORBIDDEN',
  AGENT_REQUEST_INVALID = 'AGENT_REQUEST_INVALID',
  AGENT_RUN_FAILED = 'AGENT_RUN_FAILED',
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
  LLM_RATE_LIMITED = 'LLM_RATE_LIMITED',
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  LLM_PROVIDER_ERROR = 'LLM_PROVIDER_ERROR',
  // infra
  DB_UNAVAILABLE = 'DB_UNAVAILABLE',
  CACHE_UNAVAILABLE = 'CACHE_UNAVAILABLE',
  QUEUE_UNAVAILABLE = 'QUEUE_UNAVAILABLE',
  STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE',
  STORAGE_OBJECT_NOT_FOUND = 'STORAGE_OBJECT_NOT_FOUND',
  EMAIL_SEND_FAILED = 'EMAIL_SEND_FAILED',
}
```

- [ ] **Step 4: Write `error-registry.ts`**

```ts
import { HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorKind } from './error-codes';

export interface ErrorSpec {
  status: HttpStatus;
  kind: ErrorKind;
  message: string;
}

const C = ErrorKind.CLIENT;
const D = ErrorKind.DEPENDENCY;
const I = ErrorKind.INTERNAL;
const S = HttpStatus;

export const ERROR_REGISTRY: Record<ErrorCode, ErrorSpec> = {
  [ErrorCode.VALIDATION_FAILED]: { status: S.BAD_REQUEST, kind: C, message: 'Validation failed' },
  [ErrorCode.NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'Resource not found' },
  [ErrorCode.CONFLICT]: { status: S.CONFLICT, kind: C, message: 'Resource conflict' },
  [ErrorCode.UNAUTHORIZED]: { status: S.UNAUTHORIZED, kind: C, message: 'Unauthorized' },
  [ErrorCode.FORBIDDEN]: { status: S.FORBIDDEN, kind: C, message: 'Forbidden' },
  [ErrorCode.RATE_LIMITED]: { status: S.TOO_MANY_REQUESTS, kind: C, message: 'Too many requests' },
  [ErrorCode.DEPENDENCY_UNAVAILABLE]: { status: S.SERVICE_UNAVAILABLE, kind: D, message: 'A dependency is temporarily unavailable' },
  [ErrorCode.INTERNAL_ERROR]: { status: S.INTERNAL_SERVER_ERROR, kind: I, message: 'Internal server error' },

  [ErrorCode.AUTH_INVALID_CREDENTIALS]: { status: S.UNAUTHORIZED, kind: C, message: 'Invalid credentials' },
  [ErrorCode.AUTH_TOKEN_INVALID]: { status: S.UNAUTHORIZED, kind: C, message: 'Invalid refresh token' },
  [ErrorCode.AUTH_TOKEN_EXPIRED]: { status: S.UNAUTHORIZED, kind: C, message: 'Refresh token expired' },
  [ErrorCode.AUTH_TOKEN_REUSE]: { status: S.UNAUTHORIZED, kind: C, message: 'Refresh token reuse detected' },
  [ErrorCode.AUTH_RESET_CODE_INVALID]: { status: S.UNAUTHORIZED, kind: C, message: 'Invalid or expired reset code' },
  [ErrorCode.AUTH_SERVICE_CREDENTIAL_INVALID]: { status: S.UNAUTHORIZED, kind: C, message: 'Invalid service credential' },

  [ErrorCode.USER_NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'User not found' },
  [ErrorCode.USER_EMAIL_TAKEN]: { status: S.CONFLICT, kind: C, message: 'Email already registered' },

  [ErrorCode.FILE_NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'File not found' },
  [ErrorCode.FILE_INVALID_STATE]: { status: S.CONFLICT, kind: C, message: 'File is not in a valid state for this operation' },
  [ErrorCode.FILE_TOO_LARGE]: { status: S.BAD_REQUEST, kind: C, message: 'File exceeds the maximum allowed size' },
  [ErrorCode.FILE_MIME_NOT_ALLOWED]: { status: S.BAD_REQUEST, kind: C, message: 'File type is not allowed' },
  [ErrorCode.FILE_UPLOAD_MISSING]: { status: S.BAD_REQUEST, kind: C, message: 'Upload not found in storage; upload the file before completing' },

  [ErrorCode.SEARCH_COLLECTION_NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'Collection not found' },
  [ErrorCode.SEARCH_COLLECTION_EXISTS]: { status: S.CONFLICT, kind: C, message: 'Collection already exists' },
  [ErrorCode.SEARCH_QUERY_INVALID]: { status: S.BAD_REQUEST, kind: C, message: 'Invalid search query' },
  [ErrorCode.SEARCH_RECORD_NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'Record not found' },
  [ErrorCode.SEARCH_UNAVAILABLE]: { status: S.SERVICE_UNAVAILABLE, kind: D, message: 'Search is temporarily unavailable' },

  [ErrorCode.CONFIG_NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'Configuration not found' },
  [ErrorCode.MAIL_CONFIG_MISSING]: { status: S.SERVICE_UNAVAILABLE, kind: D, message: 'No active email configuration is set' },
  [ErrorCode.CRYPTO_DECRYPT_FAILED]: { status: S.INTERNAL_SERVER_ERROR, kind: I, message: 'Internal server error' },
  [ErrorCode.CRYPTO_MISCONFIGURED]: { status: S.INTERNAL_SERVER_ERROR, kind: I, message: 'Internal server error' },

  [ErrorCode.MAILBOX_MESSAGE_NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'Message not found' },
  [ErrorCode.MAILBOX_ATTACHMENT_NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'Attachment not found' },
  [ErrorCode.MAILBOX_ACCOUNT_UNRESOLVED]: { status: S.BAD_REQUEST, kind: C, message: 'No mailbox account specified and no default is configured' },
  [ErrorCode.MAILBOX_SYNC_FAILED]: { status: S.BAD_GATEWAY, kind: D, message: 'Mailbox sync failed' },

  [ErrorCode.AGENT_CONVERSATION_NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'Conversation not found' },
  [ErrorCode.AGENT_APPROVAL_NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'Approval not found' },
  [ErrorCode.AGENT_APPROVAL_CONFLICT]: { status: S.CONFLICT, kind: C, message: 'Approval already decided' },
  [ErrorCode.AGENT_APPROVAL_FORBIDDEN]: { status: S.FORBIDDEN, kind: C, message: 'Not your approval' },
  [ErrorCode.AGENT_REQUEST_INVALID]: { status: S.BAD_REQUEST, kind: C, message: 'Invalid agent request' },
  [ErrorCode.AGENT_RUN_FAILED]: { status: S.INTERNAL_SERVER_ERROR, kind: I, message: 'The agent run failed' },
  [ErrorCode.TOOL_EXECUTION_FAILED]: { status: S.INTERNAL_SERVER_ERROR, kind: I, message: 'A tool failed to execute' },
  [ErrorCode.LLM_RATE_LIMITED]: { status: S.TOO_MANY_REQUESTS, kind: C, message: 'The model is rate limited; try again shortly' },
  [ErrorCode.LLM_TIMEOUT]: { status: S.GATEWAY_TIMEOUT, kind: D, message: 'The model request timed out' },
  [ErrorCode.LLM_PROVIDER_ERROR]: { status: S.BAD_GATEWAY, kind: D, message: 'The model provider returned an error' },

  [ErrorCode.DB_UNAVAILABLE]: { status: S.SERVICE_UNAVAILABLE, kind: D, message: 'A dependency is temporarily unavailable' },
  [ErrorCode.CACHE_UNAVAILABLE]: { status: S.SERVICE_UNAVAILABLE, kind: D, message: 'A dependency is temporarily unavailable' },
  [ErrorCode.QUEUE_UNAVAILABLE]: { status: S.SERVICE_UNAVAILABLE, kind: D, message: 'A dependency is temporarily unavailable' },
  [ErrorCode.STORAGE_UNAVAILABLE]: { status: S.SERVICE_UNAVAILABLE, kind: D, message: 'Object storage is temporarily unavailable' },
  [ErrorCode.STORAGE_OBJECT_NOT_FOUND]: { status: S.NOT_FOUND, kind: C, message: 'Object not found' },
  [ErrorCode.EMAIL_SEND_FAILED]: { status: S.BAD_GATEWAY, kind: D, message: 'Failed to send email' },
};

/** Maps a raw HTTP status (from framework-thrown HttpExceptions) to a generic code. */
export const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [S.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [S.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [S.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [S.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [S.CONFLICT]: ErrorCode.CONFLICT,
  [S.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [S.SERVICE_UNAVAILABLE]: ErrorCode.DEPENDENCY_UNAVAILABLE,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx jest src/infrastructure/exceptions/error-registry.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/infrastructure/exceptions/error-codes.ts api/src/infrastructure/exceptions/error-registry.ts api/src/infrastructure/exceptions/error-registry.spec.ts
git commit -m "feat(exceptions): add error-code taxonomy and registry"
```

---

### Task 2: `AppException`

**Files:**
- Create: `api/src/infrastructure/exceptions/app-exception.ts`
- Test: `api/src/infrastructure/exceptions/app-exception.spec.ts`

**Interfaces:**
- Consumes: `ErrorCode`, `ErrorKind` (Task 1), `ERROR_REGISTRY` (Task 1).
- Produces: `class AppException extends HttpException` with readonly `code: ErrorCode`, `kind: ErrorKind`, `details?: unknown`, and constructor `(code: ErrorCode, opts?: { message?: string; details?: unknown; cause?: unknown })`.

- [ ] **Step 1: Write the failing test**

`app-exception.spec.ts`:
```ts
import { HttpException } from '@nestjs/common';
import { AppException } from './app-exception';
import { ErrorCode, ErrorKind } from './error-codes';

describe('AppException', () => {
  it('derives status, kind, and default message from the registry', () => {
    const err = new AppException(ErrorCode.USER_NOT_FOUND);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(404);
    expect(err.code).toBe(ErrorCode.USER_NOT_FOUND);
    expect(err.kind).toBe(ErrorKind.CLIENT);
    expect(err.message).toBe('User not found');
  });

  it('honours a message override and stores details + cause', () => {
    const cause = new Error('root');
    const err = new AppException(ErrorCode.FILE_INVALID_STATE, {
      message: 'File is not awaiting upload (status=AVAILABLE)',
      details: { status: 'AVAILABLE' },
      cause,
    });
    expect(err.message).toBe('File is not awaiting upload (status=AVAILABLE)');
    expect(err.details).toEqual({ status: 'AVAILABLE' });
    expect(err.cause).toBe(cause);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/infrastructure/exceptions/app-exception.spec.ts`
Expected: FAIL — cannot find module `./app-exception`.

- [ ] **Step 3: Write `app-exception.ts`**

```ts
import { HttpException } from '@nestjs/common';
import { ErrorCode, ErrorKind } from './error-codes';
import { ERROR_REGISTRY } from './error-registry';

export interface AppExceptionOptions {
  message?: string;
  details?: unknown;
  cause?: unknown;
}

/**
 * The single exception type the application throws. A plain class (constructable
 * without DI), so it works in non-DI contexts (pipes, standalone functions) as
 * well as via `ExceptionService`.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly kind: ErrorKind;
  readonly details?: unknown;

  constructor(code: ErrorCode, opts: AppExceptionOptions = {}) {
    const spec = ERROR_REGISTRY[code];
    super(
      { code, message: opts.message ?? spec.message, details: opts.details },
      spec.status,
      { cause: opts.cause },
    );
    this.code = code;
    this.kind = spec.kind;
    this.details = opts.details;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/infrastructure/exceptions/app-exception.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/infrastructure/exceptions/app-exception.ts api/src/infrastructure/exceptions/app-exception.spec.ts
git commit -m "feat(exceptions): add AppException base class"
```

---

### Task 3: Error envelope + builder

**Files:**
- Create: `api/src/infrastructure/exceptions/error-envelope.ts`
- Test: `api/src/infrastructure/exceptions/error-envelope.spec.ts`

**Interfaces:**
- Consumes: `AppException` (Task 2), `ErrorKind` (Task 1), `ERROR_REGISTRY` (Task 1).
- Produces: `interface ErrorEnvelope { error: { code, message, statusCode, details, correlationId, timestamp, path } }`; `function buildEnvelope(err: AppException, correlationId: string, path: string): ErrorEnvelope`.

- [ ] **Step 1: Write the failing test**

`error-envelope.spec.ts`:
```ts
import { AppException } from './app-exception';
import { ErrorCode } from './error-codes';
import { buildEnvelope } from './error-envelope';

describe('buildEnvelope', () => {
  it('serializes a CLIENT error with its real message and details', () => {
    const err = new AppException(ErrorCode.USER_NOT_FOUND);
    const env = buildEnvelope(err, 'req-1', '/users/1');
    expect(env.error).toMatchObject({
      code: ErrorCode.USER_NOT_FOUND,
      message: 'User not found',
      statusCode: 404,
      correlationId: 'req-1',
      path: '/users/1',
    });
    expect(typeof env.error.timestamp).toBe('string');
  });

  it('hides the raw message of INTERNAL errors behind the safe registry message', () => {
    const err = new AppException(ErrorCode.AGENT_RUN_FAILED, { message: 'stacktrace: secret' });
    const env = buildEnvelope(err, 'req-2', '/chat');
    expect(env.error.statusCode).toBe(500);
    expect(env.error.message).toBe('The agent run failed');
    expect(env.error.message).not.toContain('secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/infrastructure/exceptions/error-envelope.spec.ts`
Expected: FAIL — cannot find module `./error-envelope`.

- [ ] **Step 3: Write `error-envelope.ts`**

```ts
import { AppException } from './app-exception';
import { ErrorCode, ErrorKind } from './error-codes';
import { ERROR_REGISTRY } from './error-registry';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    statusCode: number;
    details: unknown;
    correlationId: string;
    timestamp: string;
    path: string;
  };
}

/**
 * Renders an AppException into the single public error shape. INTERNAL errors
 * never expose their (possibly sensitive) constructed message — they fall back
 * to the curated registry message.
 */
export function buildEnvelope(
  err: AppException,
  correlationId: string,
  path: string,
): ErrorEnvelope {
  const spec = ERROR_REGISTRY[err.code];
  const message = err.kind === ErrorKind.INTERNAL ? spec.message : err.message;
  return {
    error: {
      code: err.code,
      message,
      statusCode: spec.status,
      details: err.details ?? null,
      correlationId,
      timestamp: new Date().toISOString(),
      path,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/infrastructure/exceptions/error-envelope.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/infrastructure/exceptions/error-envelope.ts api/src/infrastructure/exceptions/error-envelope.spec.ts
git commit -m "feat(exceptions): add error envelope + builder"
```

---

### Task 4: Mastra error mapper

**Files:**
- Create: `api/src/infrastructure/exceptions/mappers/mastra-error.mapper.ts`
- Test: `api/src/infrastructure/exceptions/mappers/mastra-error.mapper.spec.ts`

**Interfaces:**
- Consumes: `AppException` (Task 2), `ErrorCode` (Task 1).
- Produces: `function isMastraError(err: unknown): boolean`; `function mapMastraError(err: unknown): AppException`.

**Note:** detection is **structural** (duck-typed on `id`/`domain`/`category`) — no import from `@mastra/core` — so it can't break if Mastra ships multiple copies of the class or renames the export path.

- [ ] **Step 1: Write the failing test**

`mappers/mastra-error.mapper.spec.ts`:
```ts
import { ErrorCode } from '../error-codes';
import { isMastraError, mapMastraError } from './mastra-error.mapper';

function mastra(domain: string, category: string, id = 'X_FAILED') {
  return Object.assign(new Error('mastra boom'), { id, domain, category, details: { runId: 'r1' } });
}

describe('mastra-error.mapper', () => {
  it('detects Mastra-shaped errors and ignores plain errors', () => {
    expect(isMastraError(mastra('LLM', 'THIRD_PARTY'))).toBe(true);
    expect(isMastraError(new Error('plain'))).toBe(false);
    expect(isMastraError({})).toBe(false);
  });

  it.each([
    ['USER', 'TOOL', ErrorCode.AGENT_REQUEST_INVALID],
    ['USER', 'LLM', ErrorCode.AGENT_REQUEST_INVALID],
    ['THIRD_PARTY', 'LLM', ErrorCode.LLM_PROVIDER_ERROR],
    ['THIRD_PARTY', 'MODEL_ROUTER', ErrorCode.LLM_PROVIDER_ERROR],
    ['THIRD_PARTY', 'STORAGE', ErrorCode.DEPENDENCY_UNAVAILABLE],
    ['THIRD_PARTY', 'MASTRA_MEMORY', ErrorCode.DEPENDENCY_UNAVAILABLE],
    ['SYSTEM', 'TOOL', ErrorCode.TOOL_EXECUTION_FAILED],
    ['SYSTEM', 'MCP', ErrorCode.TOOL_EXECUTION_FAILED],
    ['SYSTEM', 'AGENT', ErrorCode.AGENT_RUN_FAILED],
    ['UNKNOWN', 'MASTRA_WORKFLOW', ErrorCode.AGENT_RUN_FAILED],
  ])('maps category=%s domain=%s to %s', (category, domain, expected) => {
    const err = mapMastraError(mastra(domain, category, 'BOOM_ID'));
    expect(err.code).toBe(expected);
    expect(err.details).toMatchObject({ runId: 'r1', mastraId: 'BOOM_ID' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/infrastructure/exceptions/mappers/mastra-error.mapper.spec.ts`
Expected: FAIL — cannot find module `./mastra-error.mapper`.

- [ ] **Step 3: Write `mappers/mastra-error.mapper.ts`**

```ts
import { AppException } from '../app-exception';
import { ErrorCode } from '../error-codes';

interface MastraLikeError extends Error {
  id: string;
  domain: string;
  category: string;
  details?: Record<string, unknown>;
}

export function isMastraError(err: unknown): err is MastraLikeError {
  return (
    err instanceof Error &&
    typeof (err as Partial<MastraLikeError>).id === 'string' &&
    typeof (err as Partial<MastraLikeError>).domain === 'string' &&
    typeof (err as Partial<MastraLikeError>).category === 'string'
  );
}

const STORAGE_DOMAINS = new Set(['STORAGE', 'MASTRA_MEMORY', 'MASTRA_VECTOR']);
const TOOL_DOMAINS = new Set(['TOOL', 'MCP']);

export function mapMastraError(err: unknown): AppException {
  if (!isMastraError(err)) {
    return new AppException(ErrorCode.AGENT_RUN_FAILED, { cause: err });
  }
  const { category, domain, id, details } = err;
  let code: ErrorCode;
  if (category === 'USER') {
    code = ErrorCode.AGENT_REQUEST_INVALID;
  } else if (category === 'THIRD_PARTY') {
    code = STORAGE_DOMAINS.has(domain)
      ? ErrorCode.DEPENDENCY_UNAVAILABLE
      : ErrorCode.LLM_PROVIDER_ERROR;
  } else {
    code = TOOL_DOMAINS.has(domain)
      ? ErrorCode.TOOL_EXECUTION_FAILED
      : ErrorCode.AGENT_RUN_FAILED;
  }
  return new AppException(code, { details: { ...(details ?? {}), mastraId: id }, cause: err });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/infrastructure/exceptions/mappers/mastra-error.mapper.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/infrastructure/exceptions/mappers/mastra-error.mapper.ts api/src/infrastructure/exceptions/mappers/mastra-error.mapper.spec.ts
git commit -m "feat(exceptions): add Mastra error mapper"
```

---

### Task 5: Infra error mapper

**Files:**
- Create: `api/src/infrastructure/exceptions/mappers/infra-error.mapper.ts`
- Test: `api/src/infrastructure/exceptions/mappers/infra-error.mapper.spec.ts`

**Interfaces:**
- Consumes: `AppException` (Task 2), `ErrorCode` (Task 1), `SearchEngineError` (`../../search-engine/search-engine.interface`), `NoActiveEmailConfigError` (`../../email/email.types`).
- Produces: `function mapInfraError(err: unknown): AppException | null` (null = not a recognized infra error → caller falls back to INTERNAL_ERROR).

- [ ] **Step 1: Write the failing test**

`mappers/infra-error.mapper.spec.ts`:
```ts
import { ErrorCode } from '../error-codes';
import { mapInfraError } from './infra-error.mapper';
import { SearchEngineError } from '../../search-engine/search-engine.interface';
import { NoActiveEmailConfigError } from '../../email/email.types';

describe('mapInfraError', () => {
  it('maps a Postgres unique violation to CONFLICT', () => {
    const err = Object.assign(new Error('dup'), { code: '23505' });
    expect(mapInfraError(err)?.code).toBe(ErrorCode.CONFLICT);
  });

  it('maps a Postgres connection-class error to DB_UNAVAILABLE', () => {
    const err = Object.assign(new Error('down'), { code: '08006' });
    expect(mapInfraError(err)?.code).toBe(ErrorCode.DB_UNAVAILABLE);
  });

  it('maps SearchEngineError to SEARCH_UNAVAILABLE', () => {
    expect(mapInfraError(new SearchEngineError('meili down'))?.code).toBe(ErrorCode.SEARCH_UNAVAILABLE);
  });

  it('maps NoActiveEmailConfigError to MAIL_CONFIG_MISSING', () => {
    expect(mapInfraError(new NoActiveEmailConfigError('IMAP'))?.code).toBe(ErrorCode.MAIL_CONFIG_MISSING);
  });

  it('maps crypto envelope failures to CRYPTO_DECRYPT_FAILED', () => {
    expect(mapInfraError(new Error('Malformed encryption envelope.'))?.code).toBe(ErrorCode.CRYPTO_DECRYPT_FAILED);
    expect(mapInfraError(new Error('Unsupported state or unable to authenticate data'))?.code).toBe(ErrorCode.CRYPTO_DECRYPT_FAILED);
  });

  it('maps object-not-found and network errors', () => {
    expect(mapInfraError(Object.assign(new Error(), { code: 'NoSuchKey' }))?.code).toBe(ErrorCode.STORAGE_OBJECT_NOT_FOUND);
    expect(mapInfraError(Object.assign(new Error(), { code: 'ECONNREFUSED' }))?.code).toBe(ErrorCode.DEPENDENCY_UNAVAILABLE);
  });

  it('returns null for unrecognized errors', () => {
    expect(mapInfraError(new Error('mystery'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/infrastructure/exceptions/mappers/infra-error.mapper.spec.ts`
Expected: FAIL — cannot find module `./infra-error.mapper`.

- [ ] **Step 3: Write `mappers/infra-error.mapper.ts`**

```ts
import { AppException } from '../app-exception';
import { ErrorCode } from '../error-codes';
import { SearchEngineError } from '../../search-engine/search-engine.interface';
import { NoActiveEmailConfigError } from '../../email/email.types';

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET']);
const REDIS_ERROR_NAMES = new Set(['MaxRetriesPerRequestError', 'ClusterAllFailedError']);

/**
 * Normalizes raw driver/SDK errors at the boundary. Returns null when the error
 * is not a recognized infrastructure failure (the caller then falls back to
 * INTERNAL_ERROR). Detection is deliberately conservative and heuristic; precise
 * per-dependency attribution is a v2 concern.
 */
export function mapInfraError(err: unknown): AppException | null {
  if (err instanceof SearchEngineError) {
    return new AppException(ErrorCode.SEARCH_UNAVAILABLE, { cause: err });
  }
  if (err instanceof NoActiveEmailConfigError) {
    return new AppException(ErrorCode.MAIL_CONFIG_MISSING, { cause: err });
  }

  const anyErr = err as { code?: unknown; name?: unknown };
  const code = typeof anyErr?.code === 'string' ? anyErr.code : undefined;
  const name = typeof anyErr?.name === 'string' ? anyErr.name : undefined;

  // Postgres (pg driver SQLSTATE codes)
  if (code === '23505') return new AppException(ErrorCode.CONFLICT, { cause: err });
  if (code && (code.startsWith('08') || code.startsWith('53') || code.startsWith('57'))) {
    return new AppException(ErrorCode.DB_UNAVAILABLE, { cause: err });
  }

  // Object storage (MinIO / S3)
  if (code === 'NoSuchKey' || code === 'NotFound') {
    return new AppException(ErrorCode.STORAGE_OBJECT_NOT_FOUND, { cause: err });
  }

  // Redis / ioredis
  if (name && REDIS_ERROR_NAMES.has(name)) {
    return new AppException(ErrorCode.CACHE_UNAVAILABLE, { cause: err });
  }

  // Crypto (AES-GCM)
  if (err instanceof Error &&
      (/Malformed encryption envelope/i.test(err.message) ||
       /unable to authenticate data/i.test(err.message))) {
    return new AppException(ErrorCode.CRYPTO_DECRYPT_FAILED, { cause: err });
  }

  // Generic network failure to a backing service
  if (code && NETWORK_CODES.has(code)) {
    return new AppException(ErrorCode.DEPENDENCY_UNAVAILABLE, { cause: err });
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/infrastructure/exceptions/mappers/infra-error.mapper.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/infrastructure/exceptions/mappers/infra-error.mapper.ts api/src/infrastructure/exceptions/mappers/infra-error.mapper.spec.ts
git commit -m "feat(exceptions): add infra error mapper"
```

---

### Task 6: `ExceptionService`

**Files:**
- Create: `api/src/infrastructure/exceptions/exception.service.ts`
- Test: `api/src/infrastructure/exceptions/exception.service.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: `@Injectable() class ExceptionService` with:
  - `create(code: ErrorCode, opts?: { message?: string; details?: unknown; cause?: unknown }): AppException`
  - `validation(issues: Array<{ path: string; message: string }>, opts?: { message?: string }): AppException`
  - `from(err: unknown): AppException`

- [ ] **Step 1: Write the failing test**

`exception.service.spec.ts`:
```ts
import { BadRequestException, NotFoundException, HttpException } from '@nestjs/common';
import { ZodError, z } from 'zod';
import { AppException } from './app-exception';
import { ErrorCode } from './error-codes';
import { ExceptionService } from './exception.service';

describe('ExceptionService', () => {
  const svc = new ExceptionService();

  it('create() builds an AppException from a code', () => {
    const err = svc.create(ErrorCode.USER_NOT_FOUND);
    expect(err).toBeInstanceOf(AppException);
    expect(err.getStatus()).toBe(404);
  });

  it('validation() shapes details.issues', () => {
    const err = svc.validation([{ path: 'email', message: 'required' }]);
    expect(err.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(err.details).toEqual({ issues: [{ path: 'email', message: 'required' }] });
  });

  describe('from()', () => {
    it('passes an AppException through unchanged', () => {
      const orig = svc.create(ErrorCode.USER_NOT_FOUND);
      expect(svc.from(orig)).toBe(orig);
    });

    it('maps a Nest HttpException by status', () => {
      expect(svc.from(new NotFoundException('nope')).code).toBe(ErrorCode.NOT_FOUND);
    });

    it('maps a zod-pipe validation body to VALIDATION_FAILED with issues', () => {
      const body = { message: 'Validation failed', issues: [{ path: 'a', message: 'bad' }] };
      const mapped = svc.from(new BadRequestException(body));
      expect(mapped.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(mapped.details).toEqual({ issues: [{ path: 'a', message: 'bad' }] });
    });

    it('maps a ZodError to VALIDATION_FAILED', () => {
      let zerr: ZodError;
      try { z.object({ a: z.string() }).parse({}); } catch (e) { zerr = e as ZodError; }
      const mapped = svc.from(zerr!);
      expect(mapped.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(Array.isArray((mapped.details as any).issues)).toBe(true);
    });

    it('maps a Mastra-shaped error', () => {
      const m = Object.assign(new Error('x'), { id: 'I', domain: 'LLM', category: 'THIRD_PARTY' });
      expect(svc.from(m).code).toBe(ErrorCode.LLM_PROVIDER_ERROR);
    });

    it('maps a pg unique violation to CONFLICT', () => {
      expect(svc.from(Object.assign(new Error(), { code: '23505' })).code).toBe(ErrorCode.CONFLICT);
    });

    it('falls back to INTERNAL_ERROR for unknown errors, keeping the cause', () => {
      const raw = new Error('mystery');
      const mapped = svc.from(raw);
      expect(mapped.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(mapped.cause).toBe(raw);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/infrastructure/exceptions/exception.service.spec.ts`
Expected: FAIL — cannot find module `./exception.service`.

- [ ] **Step 3: Write `exception.service.ts`**

```ts
import { HttpException, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';
import { AppException, AppExceptionOptions } from './app-exception';
import { ErrorCode } from './error-codes';
import { STATUS_TO_CODE } from './error-registry';
import { isMastraError, mapMastraError } from './mappers/mastra-error.mapper';
import { mapInfraError } from './mappers/infra-error.mapper';

export interface ValidationIssue {
  path: string;
  message: string;
}

@Injectable()
export class ExceptionService {
  /** Build an AppException from any registered code. Caller writes `throw`. */
  create(code: ErrorCode, opts?: AppExceptionOptions): AppException {
    return new AppException(code, opts);
  }

  /** Build a VALIDATION_FAILED error with the standard `{ issues }` details shape. */
  validation(issues: ValidationIssue[], opts?: { message?: string }): AppException {
    return new AppException(ErrorCode.VALIDATION_FAILED, {
      message: opts?.message,
      details: { issues },
    });
  }

  /** Normalize ANY thrown value into an AppException. The filter's mapping brain. */
  from(err: unknown): AppException {
    if (err instanceof AppException) return err;
    if (err instanceof HttpException) return this.fromHttpException(err);
    if (err instanceof ZodError) {
      return this.validation(
        err.issues.map((i) => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      );
    }
    if (isMastraError(err)) return mapMastraError(err);
    const infra = mapInfraError(err);
    if (infra) return infra;
    return new AppException(ErrorCode.INTERNAL_ERROR, { cause: err });
  }

  private fromHttpException(err: HttpException): AppException {
    const status = err.getStatus();
    const res = err.getResponse();
    const body: Record<string, unknown> =
      typeof res === 'object' && res !== null
        ? (res as Record<string, unknown>)
        : { message: res };

    // The Zod validation pipe throws BadRequest with an `issues` array.
    if (status === 400 && Array.isArray(body.issues)) {
      return new AppException(ErrorCode.VALIDATION_FAILED, {
        details: { issues: body.issues },
        cause: err,
      });
    }

    const code = STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR;
    const message = typeof body.message === 'string' ? body.message : undefined;
    return new AppException(code, { message, cause: err });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/infrastructure/exceptions/exception.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/infrastructure/exceptions/exception.service.ts api/src/infrastructure/exceptions/exception.service.spec.ts
git commit -m "feat(exceptions): add ExceptionService (create/validation/from)"
```

---

### Task 7: `GlobalExceptionFilter`

**Files:**
- Create: `api/src/infrastructure/exceptions/global-exception.filter.ts`
- Test: `api/src/infrastructure/exceptions/global-exception.filter.spec.ts`

**Interfaces:**
- Consumes: `ExceptionService` (Task 6), `buildEnvelope` (Task 3), `ErrorKind` (Task 1), `PinoLogger` (`nestjs-pino`), `Sentry` (`@sentry/nestjs`).
- Produces: `@Catch() class GlobalExceptionFilter implements ExceptionFilter` with `catch(exception, host)`.

- [ ] **Step 1: Write the failing test**

`global-exception.filter.spec.ts`:
```ts
import { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ExceptionService } from './exception.service';
import { ErrorCode } from './error-codes';
import { GlobalExceptionFilter } from './global-exception.filter';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function hostFor(url = '/x', id = 'req-1') {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id, url }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  const logger = { debug: jest.fn(), error: jest.fn() } as any;
  const filter = new GlobalExceptionFilter(new ExceptionService(), logger);
  beforeEach(() => jest.clearAllMocks());

  it('writes the envelope with the mapped status for a CLIENT error (no Sentry)', () => {
    const { host, status, json } = hostFor('/users/1');
    filter.catch(new (require('@nestjs/common').NotFoundException)('nf'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: ErrorCode.NOT_FOUND, statusCode: 404 }) }),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('reports INTERNAL errors to Sentry and hides the raw message', () => {
    const { host, status, json } = hostFor('/chat');
    filter.catch(new Error('secret stack'), host);
    expect(status).toHaveBeenCalledWith(500);
    const env = json.mock.calls[0][0];
    expect(env.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(env.error.message).not.toContain('secret');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/infrastructure/exceptions/global-exception.filter.spec.ts`
Expected: FAIL — cannot find module `./global-exception.filter`.

- [ ] **Step 3: Write `global-exception.filter.ts`**

```ts
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { ExceptionService } from './exception.service';
import { ErrorKind } from './error-codes';
import { buildEnvelope } from './error-envelope';

interface RequestLike { id?: string; url?: string }
interface ResponseLike { status(code: number): { json(body: unknown): unknown } }

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly errors: ExceptionService,
    @InjectPinoLogger(GlobalExceptionFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<RequestLike>();
    const res = http.getResponse<ResponseLike>();

    const appErr = this.errors.from(exception);
    const correlationId = req.id ?? '-';
    const envelope = buildEnvelope(appErr, correlationId, req.url ?? '');

    if (appErr.kind === ErrorKind.CLIENT) {
      this.logger.debug({ code: appErr.code, correlationId }, appErr.message);
    } else {
      this.logger.error({ err: exception, code: appErr.code, correlationId }, appErr.message);
      Sentry.captureException(appErr.cause ?? exception, {
        tags: { code: appErr.code, correlationId },
      });
    }

    res.status(envelope.error.statusCode).json(envelope);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/infrastructure/exceptions/global-exception.filter.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/infrastructure/exceptions/global-exception.filter.ts api/src/infrastructure/exceptions/global-exception.filter.spec.ts
git commit -m "feat(exceptions): add GlobalExceptionFilter"
```

---

### Task 8: Module, barrel, and app wiring

**Files:**
- Create: `api/src/infrastructure/exceptions/exceptions.module.ts`
- Create: `api/src/infrastructure/exceptions/index.ts`
- Modify: `api/src/app.module.ts`
- Modify: `api/src/infrastructure/observability/sentry.module.ts`

**Interfaces:**
- Consumes: `ExceptionService` (Task 6), `GlobalExceptionFilter` (Task 7).
- Produces: `@Global() class ExceptionsModule` (provides `ExceptionService` + `APP_FILTER`, exports `ExceptionService`); barrel `index.ts` re-exporting `ErrorCode`, `ErrorKind`, `AppException`, `ExceptionService`, `ErrorEnvelope`.

- [ ] **Step 1: Write `exceptions.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ExceptionService } from './exception.service';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * Global exception handling. Provides the injectable throw API (ExceptionService)
 * everywhere, and registers the single global filter that normalizes every error
 * into the standard envelope.
 */
@Global()
@Module({
  providers: [
    ExceptionService,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  exports: [ExceptionService],
})
export class ExceptionsModule {}
```

- [ ] **Step 2: Write `index.ts` barrel**

```ts
export { ErrorCode, ErrorKind } from './error-codes';
export { AppException } from './app-exception';
export type { AppExceptionOptions } from './app-exception';
export { ExceptionService } from './exception.service';
export type { ValidationIssue } from './exception.service';
export type { ErrorEnvelope } from './error-envelope';
export { ExceptionsModule } from './exceptions.module';
```

- [ ] **Step 3: Remove `SentryGlobalFilter` from `sentry.module.ts`**

Replace the whole file with (keeps Sentry SDK setup, drops the filter — our filter now owns capture):
```ts
import { Module } from '@nestjs/common';
import { SentryModule as SentryCoreModule } from '@sentry/nestjs/setup';

/**
 * Wires Sentry into the Nest request lifecycle.
 *
 * `SentryModule.forRoot()` is imported from `@sentry/nestjs/setup` (NOT the
 * package root) so `@nestjs/common` is loaded after OpenTelemetry patches it.
 * The actual `Sentry.init()` lives in `src/instrument.ts`.
 *
 * Error reporting to Sentry is owned by `GlobalExceptionFilter`
 * (`infrastructure/exceptions`), which captures DEPENDENCY/INTERNAL errors with
 * `code` + `correlationId` tags — so no `SentryGlobalFilter` is registered here.
 */
@Module({
  imports: [SentryCoreModule.forRoot()],
})
export class ObservabilityModule {}
```

- [ ] **Step 4: Import `ExceptionsModule` in `app.module.ts`**

Add the import line near the other infrastructure imports:
```ts
import { ExceptionsModule } from './infrastructure/exceptions';
```
Add `ExceptionsModule` to the `imports` array immediately after `LoggerModule` (so the filter can inject `PinoLogger`):
```ts
    LoggerModule,
    ExceptionsModule,
    DatabaseModule,
```

- [ ] **Step 5: Build to verify wiring compiles**

Run: `cd api && npm run build`
Expected: build succeeds (no TS errors).

- [ ] **Step 6: Run the full module test suite**

Run: `cd api && npx jest src/infrastructure/exceptions`
Expected: all exception-module specs PASS.

- [ ] **Step 7: Commit**

```bash
git add api/src/infrastructure/exceptions/exceptions.module.ts api/src/infrastructure/exceptions/index.ts api/src/app.module.ts api/src/infrastructure/observability/sentry.module.ts
git commit -m "feat(exceptions): register global module, take over Sentry capture"
```

---

## PHASE 2 — Migrate call sites

**Migration recipe (applies to every Task 9–16):**
1. Add `import { ErrorCode } from '../../infrastructure/exceptions';` (adjust depth) and inject `private readonly errors: ExceptionService` into the service constructor. Remove now-unused `@nestjs/common` exception imports.
2. Replace each `throw new XxxException(msg)` per the task's table. Where the original message differs from the registry default, pass `{ message: '<original>' }` to preserve behavior.
3. Update the co-located `.spec.ts`: pass `new ExceptionService()` as the new constructor arg, and change assertions from `.toThrow(XxxException)` to code/status checks (pattern below).
4. Run the module's specs; then commit.

**Spec assertion pattern** (replaces `rejects.toThrow(NotFoundException)`):
```ts
import { AppException, ErrorCode } from '../../infrastructure/exceptions';
await expect(service.doThing()).rejects.toMatchObject({
  code: ErrorCode.USER_NOT_FOUND,
});
// or, to assert status:
await expect(service.doThing()).rejects.toSatisfy(
  (e: AppException) => e.getStatus() === 404,
);
```
(If `toSatisfy` is unavailable, wrap in try/catch and assert on the caught `AppException`.)

---

### Task 9: Standardize the Zod validation pipe

**Files:**
- Modify: `api/src/common/pipes/zod-validation.pipe.ts`
- Test: `api/src/common/pipes/zod-validation.pipe.spec.ts` (create if absent)

The pipe is constructed via `new` (not DI), so it throws `AppException` directly.

- [ ] **Step 1: Write/adjust the failing test**

`zod-validation.pipe.spec.ts`:
```ts
import { z } from 'zod';
import { AppException, ErrorCode } from '../../infrastructure/exceptions';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ email: z.string().email() }));

  it('passes valid input through', () => {
    expect(pipe.transform({ email: 'a@b.co' })).toEqual({ email: 'a@b.co' });
  });

  it('throws an AppException(VALIDATION_FAILED) with issues on invalid input', () => {
    try {
      pipe.transform({ email: 'nope' });
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe(ErrorCode.VALIDATION_FAILED);
      expect((e as AppException).details).toHaveProperty('issues');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/common/pipes/zod-validation.pipe.spec.ts`
Expected: FAIL (still throws `BadRequestException`, not `AppException`).

- [ ] **Step 3: Rewrite the pipe's catch block**

Replace the `@nestjs/common` `BadRequestException` import and the `catch` body:
```ts
import { Injectable, type PipeTransform } from '@nestjs/common';
import { z, ZodError, type ZodType } from 'zod';
import { AppException, ErrorCode } from '../../infrastructure/exceptions';

@Injectable()
export class ZodValidationPipe<S extends ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    try {
      return this.schema.parse(value) as z.infer<S>;
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, {
          details: {
            issues: error.issues.map((issue) => ({
              path: issue.path.join('.') || '(root)',
              message: issue.message,
            })),
          },
        });
      }
      throw error;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/common/pipes/zod-validation.pipe.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/common/pipes/zod-validation.pipe.ts api/src/common/pipes/zod-validation.pipe.spec.ts
git commit -m "refactor(validation): zod pipe throws AppException(VALIDATION_FAILED)"
```

---

### Task 10: Migrate the auth module

**Files:**
- Modify: `api/src/features/auth/auth.service.ts`, `password-reset.service.ts`, `service-credential.service.ts` (+ their `.spec.ts`)

**Replacement table:**

| File:line | Old | New (code) | Message override? |
|---|---|---|---|
| auth.service.ts:36 | `UnauthorizedException('Invalid credentials')` | `AUTH_INVALID_CREDENTIALS` | no (default matches) |
| auth.service.ts:42 | `UnauthorizedException('Invalid credentials')` | `AUTH_INVALID_CREDENTIALS` | no |
| auth.service.ts:56 | `UnauthorizedException('Invalid refresh token')` | `AUTH_TOKEN_INVALID` | no |
| auth.service.ts:61 | `UnauthorizedException('Refresh token reuse detected')` | `AUTH_TOKEN_REUSE` | no |
| auth.service.ts:64 | `UnauthorizedException('Refresh token expired')` | `AUTH_TOKEN_EXPIRED` | no |
| auth.service.ts:68 | `UnauthorizedException('Invalid refresh token')` | `AUTH_TOKEN_INVALID` | no |
| auth.service.ts:94 | `UnauthorizedException('Current password is incorrect')` | `AUTH_INVALID_CREDENTIALS` | **yes**: `{ message: 'Current password is incorrect' }` |
| password-reset.service.ts (fail helper) | `UnauthorizedException('Invalid or expired reset code')` | `AUTH_RESET_CODE_INVALID` | no |
| service-credential.service.ts:61 | `UnauthorizedException('Invalid service credential')` | `AUTH_SERVICE_CREDENTIAL_INVALID` | no |

- [ ] **Step 1:** Update `auth.service.spec.ts`, `password-reset.service.spec.ts`, `service-credential.service.spec.ts` — inject `new ExceptionService()`; convert `toThrow(UnauthorizedException)` assertions to `toMatchObject({ code: ErrorCode.AUTH_... })` (use the codes above). Run them to confirm they FAIL.
   Run: `cd api && npx jest src/features/auth`
- [ ] **Step 2:** Apply the migration recipe + replacement table to the three service files. Example (auth.service.ts constructor + one throw):
```ts
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
// constructor: add `private readonly errors: ExceptionService,`
// site :61
throw this.errors.create(ErrorCode.AUTH_TOKEN_REUSE);
```
- [ ] **Step 3:** Run tests.
   Run: `cd api && npx jest src/features/auth`
   Expected: PASS.
- [ ] **Step 4:** Commit.
```bash
git add api/src/features/auth
git commit -m "refactor(auth): throw via ExceptionService"
```

---

### Task 11: Migrate the users module

**Files:** Modify `api/src/features/users/users.service.ts` + `users.service.spec.ts`.

**Replacement table:**

| File:line | Old | New | Override? |
|---|---|---|---|
| users.service.ts:43 | `ConflictException('Email already registered')` | `USER_EMAIL_TAKEN` | no |
| users.service.ts:57 | `NotFoundException('User not found')` | `USER_NOT_FOUND` | no |
| users.service.ts:74 | `NotFoundException('User not found')` | `USER_NOT_FOUND` | no |

- [ ] **Step 1:** Update `users.service.spec.ts`: constructor becomes `new UsersService(repo, passwords, new ExceptionService())`; change the duplicate-email + not-found assertions to `toMatchObject({ code: ErrorCode.USER_EMAIL_TAKEN })` / `{ code: ErrorCode.USER_NOT_FOUND }`. Run → FAIL.
   Run: `cd api && npx jest src/features/users/users.service.spec.ts`
- [ ] **Step 2:** Edit `users.service.ts`: add `import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';`, add `private readonly errors: ExceptionService,` to the constructor, remove `ConflictException`/`NotFoundException` imports, and apply the table (e.g. `throw this.errors.create(ErrorCode.USER_EMAIL_TAKEN);`).
- [ ] **Step 3:** Run tests → PASS.
   Run: `cd api && npx jest src/features/users/users.service.spec.ts`
- [ ] **Step 4:** Commit.
```bash
git add api/src/features/users
git commit -m "refactor(users): throw via ExceptionService"
```

---

### Task 12: Migrate the file-processor module

**Files:** Modify `api/src/features/file-processor/file.service.ts` + spec.

**Replacement table** (note: ownership stays 404 by design — `loadOwned` → `FILE_NOT_FOUND`):

| File:line | Old | New | Override? |
|---|---|---|---|
| file.service.ts:141 | `ConflictException('File is not awaiting upload (status=…)')` | `FILE_INVALID_STATE` | **yes** (dynamic status message) |
| file.service.ts:147 | `BadRequestException('Upload not found in storage; …')` | `FILE_UPLOAD_MISSING` | no |
| file.service.ts:159 | `BadRequestException('Uploaded file size … exceeds …')` | `FILE_TOO_LARGE` | **yes** (dynamic sizes) |
| file.service.ts:168 | `NotFoundException('File not found')` | `FILE_NOT_FOUND` | no |
| file.service.ts:213 | `ConflictException('File is not available (status=…)')` | `FILE_INVALID_STATE` | **yes** |
| file.service.ts:279 | `ConflictException('File is not available (status=…)')` | `FILE_INVALID_STATE` | **yes** |
| file.service.ts:294 | `BadRequestException('MIME type "…" is not allowed')` | `FILE_MIME_NOT_ALLOWED` | **yes** |
| file.service.ts:297 | `BadRequestException('File size … exceeds …')` | `FILE_TOO_LARGE` | **yes** |
| file.service.ts:307 | `NotFoundException('File not found')` (loadOwned, masks ownership) | `FILE_NOT_FOUND` | no |

- [ ] **Step 1:** Update `file.service.spec.ts`: inject `new ExceptionService()`; convert assertions to the codes above (`toMatchObject({ code })`). Run → FAIL.
   Run: `cd api && npx jest src/features/file-processor`
- [ ] **Step 2:** Apply the migration recipe + table. Example for a dynamic-message site:
```ts
throw this.errors.create(ErrorCode.FILE_INVALID_STATE, {
  message: `File is not awaiting upload (status=${row.status})`,
});
```
- [ ] **Step 3:** Run tests → PASS.
   Run: `cd api && npx jest src/features/file-processor`
- [ ] **Step 4:** Commit.
```bash
git add api/src/features/file-processor
git commit -m "refactor(file-processor): throw via ExceptionService (ownership stays 404 explicitly)"
```

---

### Task 13: Migrate the search-service module

**Files:** Modify `api/src/features/search-service/search-record.service.ts`, `collection.service.ts` (+ specs). **Do NOT** change `search-indexing.processor.ts:143` (a BullMQ job-payload `Error` — not HTTP-facing; out of scope, keep as-is for retry semantics).

**Replacement table:**

| File:line | Old | New | Override? |
|---|---|---|---|
| search-record.service.ts:82 | `BadRequestException({ message, issues: string[] })` | `this.errors.validation(errors.map((m,) => ({ path: \`records[${i}]\`, message: m })), { message: \`Record ${i} failed validation\` })` | — (standardizes shape) |
| search-record.service.ts:144 | `NotFoundException('Record not found')` | `SEARCH_RECORD_NOT_FOUND` | no |
| search-record.service.ts:197 | catch `SearchEngineError` → `ServiceUnavailableException('Search is temporarily unavailable')` | `throw this.errors.create(ErrorCode.SEARCH_UNAVAILABLE, { cause: e });` (keep the `instanceof SearchEngineError` guard; rethrow others) | no |
| search-record.service.ts:205 | `NotFoundException('Unknown collection "…"')` | `SEARCH_COLLECTION_NOT_FOUND` | **yes** |
| search-record.service.ts:216 | `BadRequestException('Unknown filter field "…"')` | `SEARCH_QUERY_INVALID` | **yes** |
| search-record.service.ts:231 | `BadRequestException('Invalid sort "…"')` | `SEARCH_QUERY_INVALID` | **yes** |
| search-record.service.ts:246 | `BadRequestException('Unknown facet(s): …')` | `SEARCH_QUERY_INVALID` | **yes** |
| collection.service.ts:83 | `ConflictException('Collection "…" already exists')` | `SEARCH_COLLECTION_EXISTS` | **yes** |
| collection.service.ts:104/113/125/140 | `NotFoundException('Unknown collection "…"')` | `SEARCH_COLLECTION_NOT_FOUND` | **yes** |

- [ ] **Step 1:** Update both specs: inject `new ExceptionService()`; convert assertions to the codes above. For the SearchEngineError→503 path, keep the existing behavior test but assert `code === ErrorCode.SEARCH_UNAVAILABLE` and status 503. Run → FAIL.
   Run: `cd api && npx jest src/features/search-service`
- [ ] **Step 2:** Apply the migration recipe + table. For the validation site, ensure the `issues` become `{ path, message }[]`.
- [ ] **Step 3:** Run tests → PASS.
   Run: `cd api && npx jest src/features/search-service`
- [ ] **Step 4:** Commit.
```bash
git add api/src/features/search-service
git commit -m "refactor(search): throw via ExceptionService; standardize validation issues"
```

---

### Task 14: Migrate the system module

**Files:** Modify `api/src/features/system/integration-credential.service.ts`, `imap-config.service.ts`, `smtp-config.service.ts`, `system-settings.service.ts` (+ specs). **Do NOT** change `encryption.service.ts` (constructor misconfig is a boot-time fatal — correct as a plain `Error`; runtime decrypt failures are normalized by the infra mapper). **Do NOT** change `system-audit.service.ts` (audit failures stay swallowed).

**Replacement table:**

| File:line | Old | New | Override? |
|---|---|---|---|
| integration-credential.service.ts:58 | `NotFoundException('Integration credential not found')` | `CONFIG_NOT_FOUND` | **yes** |
| integration-credential.service.ts:67 | `ConflictException('A credential named "…" already exists for …')` | `CONFLICT` | **yes** |
| integration-credential.service.ts:114 | `ConflictException(same)` | `CONFLICT` | **yes** |
| integration-credential.service.ts:133 | `NotFoundException('Integration credential not found')` | `CONFIG_NOT_FOUND` | **yes** |
| imap-config.service.ts:53/108/133 | `NotFoundException('IMAP config not found')` | `CONFIG_NOT_FOUND` | **yes**: `{ message: 'IMAP config not found' }` |
| smtp-config.service.ts:57/116/141 | `NotFoundException('SMTP config not found')` | `CONFIG_NOT_FOUND` | **yes**: `{ message: 'SMTP config not found' }` |
| system-settings.service.ts:60/98 | `NotFoundException('Setting "…" not found')` | `CONFIG_NOT_FOUND` | **yes** |

- [ ] **Step 1:** Update the four specs: inject `new ExceptionService()`; convert assertions to `CONFIG_NOT_FOUND` / `CONFLICT` with the preserved messages. Run → FAIL.
   Run: `cd api && npx jest src/features/system`
- [ ] **Step 2:** Apply the migration recipe + table.
- [ ] **Step 3:** Run tests → PASS.
   Run: `cd api && npx jest src/features/system`
- [ ] **Step 4:** Commit.
```bash
git add api/src/features/system
git commit -m "refactor(system): throw via ExceptionService"
```

---

### Task 15: Migrate the mailbox module

**Files:** Modify `api/src/features/mailbox/mailbox.service.ts` + spec. **Do NOT** change the ingest/scheduler swallow-and-log paths (best-effort semantics preserved); `NoActiveEmailConfigError` reaching an HTTP request is normalized by the infra mapper.

**Replacement table:**

| File:line | Old | New | Override? |
|---|---|---|---|
| mailbox.service.ts:77 | `BadRequestException('No mailbox account specified and MAILBOX_DEFAULT_ACCOUNT_ID is unset')` | `MAILBOX_ACCOUNT_UNRESOLVED` | **yes**: `{ message: 'No mailbox account specified and MAILBOX_DEFAULT_ACCOUNT_ID is unset' }` |
| mailbox.service.ts:108 | `NotFoundException('Message not found')` | `MAILBOX_MESSAGE_NOT_FOUND` | no |
| mailbox.service.ts:131 | `NotFoundException('Attachment not found')` | `MAILBOX_ATTACHMENT_NOT_FOUND` | no |
| mailbox.service.ts:137 | `NotFoundException('Message not found')` | `MAILBOX_MESSAGE_NOT_FOUND` | no |

- [ ] **Step 1:** Update `mailbox.service.spec.ts`: inject `new ExceptionService()`; convert assertions. Run → FAIL.
   Run: `cd api && npx jest src/features/mailbox`
- [ ] **Step 2:** Apply the migration recipe + table.
- [ ] **Step 3:** Run tests → PASS.
   Run: `cd api && npx jest src/features/mailbox`
- [ ] **Step 4:** Commit.
```bash
git add api/src/features/mailbox
git commit -m "refactor(mailbox): throw via ExceptionService"
```

---

### Task 16: Migrate the mastra module

**Files:** Modify `api/src/features/mastra/services/approval.service.ts`, `conversation.service.ts` (+ specs). **Do NOT** change the raw `Error` invariants in `action-log.repository.ts:25`, `mastra-adapters.ts:183`, `agent-run.processor.ts:170` (internal invariants / BullMQ-retry, not HTTP-facing). Raw `MastraError` from `agent.generate()` reaching HTTP is normalized by the Mastra mapper.

**Replacement table:**

| File:line | Old | New | Override? |
|---|---|---|---|
| approval.service.ts:45 | `NotFoundException('Approval not found')` | `AGENT_APPROVAL_NOT_FOUND` | no |
| approval.service.ts:47 | `ConflictException('Approval already decided')` | `AGENT_APPROVAL_CONFLICT` | no |
| approval.service.ts:56 | `ForbiddenException('Not your approval')` | `AGENT_APPROVAL_FORBIDDEN` | no |
| conversation.service.ts:33 | `NotFoundException('Conversation not found')` | `AGENT_CONVERSATION_NOT_FOUND` | no |
| conversation.service.ts:39 | `ForbiddenException('Not your conversation')` | `FORBIDDEN` | **yes**: `{ message: 'Not your conversation' }` |
| conversation.service.ts:59 | `NotFoundException('Conversation not found')` | `AGENT_CONVERSATION_NOT_FOUND` | no |
| conversation.service.ts:61 | `ForbiddenException('Not your conversation')` | `FORBIDDEN` | **yes**: `{ message: 'Not your conversation' }` |

- [ ] **Step 1:** Update `approval.service.spec.ts`, `conversation.service.spec.ts`: inject `new ExceptionService()`; convert assertions. Run → FAIL.
   Run: `cd api && npx jest src/features/mastra`
- [ ] **Step 2:** Apply the migration recipe + table (import depth here is `../../../infrastructure/exceptions`).
- [ ] **Step 3:** Run tests → PASS.
   Run: `cd api && npx jest src/features/mastra`
- [ ] **Step 4:** Commit.
```bash
git add api/src/features/mastra
git commit -m "refactor(mastra): throw via ExceptionService"
```

---

## PHASE 3 — Verify end-to-end

### Task 17: Full build, test suite, and manual envelope check

**Files:** none (verification only).

- [ ] **Step 1: Full build**

Run: `cd api && npm run build`
Expected: success, zero TS errors.

- [ ] **Step 2: Full test suite**

Run: `cd api && npm test`
Expected: all suites PASS. Investigate any spec still asserting a removed Nest exception class and fix it to the code/status pattern.

- [ ] **Step 3: Lint**

Run: `cd api && npx eslint src/infrastructure/exceptions --max-warnings=0`
Expected: clean (no unused `@nestjs/common` exception imports left behind in migrated files — extend the path if lint flags others).

- [ ] **Step 4: Manual end-to-end envelope check**

Boot the app and hit one route per kind, confirming the envelope + status:
```bash
cd api && npm run start:dev   # in one shell (uses .env datastore ports)
# CLIENT 404:
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/users/00000000-0000-0000-0000-000000000000   # expect 404
curl -s http://localhost:3000/users/00000000-0000-0000-0000-000000000000 | jq .   # expect { "error": { "code": "USER_NOT_FOUND", ... } }
# VALIDATION 400 (post an invalid body to any zod-validated route) → { "error": { "code": "VALIDATION_FAILED", "details": { "issues": [...] } } }
```
Expected: every response is the standard envelope; `correlationId` present; no stack traces leak on 500s.

- [ ] **Step 5: Final commit (if any spec/lint fixes were needed)**

```bash
git add -A
git commit -m "test(exceptions): finalize migration; full build + suite green"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** design §4 (registry) → Task 1; §5 (envelope) → Task 3; §6 (AppException) → Task 2; §7 (ExceptionService/from) → Task 6; §8 (Mastra map) → Task 4; §9 (infra map) → Task 5; §10 (filter + wiring + Sentry removal) → Tasks 7–8; §11.2 (validation shape) → Tasks 9,13; §11.1 (403-vs-404) → Task 12; §12 (full migration) → Tasks 9–16; §13 (testing) → every task + Task 17. Covered.
- **Placeholder scan:** none — every code/test/command is concrete.
- **Type consistency:** `ErrorCode`/`ErrorKind`/`ERROR_REGISTRY`/`STATUS_TO_CODE`/`AppException(code, opts)`/`ExceptionService.create|validation|from`/`buildEnvelope(err, correlationId, path)`/`isMastraError`/`mapMastraError`/`mapInfraError` names are used identically across all tasks.
- **Out-of-scope (intentional, documented in-task):** BullMQ/processor job-payload `Error`s, internal invariants, boot-time crypto misconfig, and best-effort swallow-and-log paths are explicitly left unchanged.
