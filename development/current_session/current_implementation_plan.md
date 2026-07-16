# Email Infrastructure Module + Forgot-Password — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable `infrastructure/email` module (outbound SMTP via `MailerService`, full inbound IMAP via `InboxService`), then add an emailed 6-digit OTP forgot-password flow to the `auth` feature built on top of it.

**Architecture:** `infrastructure/email` owns the mail transport layer (pure `nodemailer` / `imapflow`+`mailparser` functions) plus two services that resolve the *active* SMTP/IMAP config (read directly from the shared `smtp_configs`/`imap_configs` tables, decrypted via `EncryptionService`) and delegate to transport. It depends only on `infrastructure/database` + `infrastructure/crypto` — never on the `system` feature module. `system` and `mastra` are refactored to consume it. Forgot-password lives in `features/auth`: a `password_reset_codes` table, an HMAC-peppered single-use 6-digit code, and two `@Public()` throttled endpoints, with all mail going through `MailerService`.

**Tech Stack:** NestJS 11, Drizzle ORM (node-postgres), Zod (`ZodValidationPipe`), `node:crypto` (HMAC-SHA256, `randomInt`, `timingSafeEqual`), argon2id (`PasswordService`), `nodemailer` (SMTP), `imapflow` + `mailparser` (IMAP, CommonJS). Tests: Jest + `@swc/jest` (unit, colocated `*.spec.ts`), Supertest (e2e, module-subset boot).

## Global Constraints

- Files stay under 500 lines; one responsibility each.
- Validate all input at the HTTP boundary with Zod DTOs (`ZodValidationPipe`).
- Never commit secrets/credentials/.env. **No `Co-Authored-By` trailer** on commits (`.claude/settings.json` has no `attribution.commit`).
- Dependency direction is strict: `infrastructure/email` imports only `infrastructure/*` (never `features/*`). Feature modules import `EmailModule`.
- Mail secrets are only ever held decrypted in-memory at point of use; never logged, never returned in a response.
- Forgot-password is enumeration-safe: `POST /auth/forgot-password` always returns `204`; `POST /auth/reset-password` returns a uniform `401 "Invalid or expired reset code"` for every business failure (validation `400`s from the Zod pipe are pre-lookup and account-agnostic). Never log plaintext codes, HMACs, or passwords.
- DI tokens: `DRIZZLE` (typed `DrizzleDB`) from the `@Global` `DatabaseModule`; `EncryptionService` from `CryptoModule`.
- `imapflow`/`mailparser` are CommonJS (verified: `imapflow@1.4.7` `main: lib/imap-flow.js`, `mailparser@3.9.14` `main: index.js`). Do NOT upgrade across an ESM-only major without an ESM migration (same rule as the meilisearch CJS pin). Unit specs mock `imapflow`/`mailparser` so their transitive deps never load under `@swc/jest`.
- Unit tests: `pnpm test -- <name>` (rootDir `src`, regex `.*\.spec\.ts$`). Typecheck: `pnpm typecheck`. e2e: `pnpm test:e2e` (needs Postgres + Redis on the `.env` ports and a migrated schema). Migrations: `pnpm db:generate` (reads the schema barrel `src/infrastructure/database/schema/index.ts`) then `pnpm db:migrate`.
- Follow existing patterns: `Public*` projections, `ParseUUIDPipe`, `@HttpCode(204)`, `@Public()` + `@Throttle(...)` on public routes, `registerAs` config namespaces validated by the central `envSchema`.

---

## Task Overview

**Phase 1 — `infrastructure/email` module + system/mastra refactor**

1. **Dependencies + email types + module skeleton** — add `imapflow`/`mailparser`, `email.types.ts`, empty `EmailModule`.
2. **SMTP transport** — `transport/smtp.transport.ts` (`sendMail`, `verifySmtp`) via `nodemailer`.
3. **IMAP transport** — `transport/imap.transport.ts` (`verifyImap`, `listMessages`, `fetchMessage`, `setSeen`) via `imapflow`+`mailparser`.
4. **EmailConfigRepository** — read active SMTP/IMAP row, decrypt secret.
5. **MailerService + InboxService** — resolve active config → transport; wire `EmailModule` exports.
6. **Refactor `system` + `mastra`** — delegate `test()` to transport, drop `sendActive`, repoint mastra `sendEmail`, delete `connection/` testers.

**Phase 2 — Forgot-password (`auth`)**

7. **`password_reset_codes` schema + migration.**
8. **Config/env** — `PASSWORD_RESET_PEPPER` + `auth.config` `passwordReset` block.
9. **ResetCodeHasher** — generate / HMAC-hash / timing-safe verify.
10. **PasswordResetRepository** — the reset-codes table.
11. **ResetMailer** — reset-code + confirmation templates → `MailerService`.
12. **PasswordResetService** — request + reset orchestration (the core logic).
13. **DTOs + controller routes + AuthModule wiring.**
14. **Build + typecheck + full unit verification.**
15. **e2e** — forgot→reset happy path, unknown email, lockout, expired, throttle.

---

## Task 1: Dependencies + email types + module skeleton

**Files:**
- Modify: `package.json` (add `imapflow`, `mailparser`, `@types/mailparser`)
- Create: `src/infrastructure/email/email.types.ts`
- Create: `src/infrastructure/email/email.module.ts`
- Test: `src/infrastructure/email/email.types.spec.ts`

**Interfaces:**
- Produces:
  - `interface SmtpConn { host: string; port: number; secure: boolean; username: string | null; password: string | null; fromAddress: string; fromName: string | null }`
  - `interface ImapConn { host: string; port: number; secure: boolean; username: string | null; password: string | null }`
  - `interface EmailMessage { to: string; subject: string; text: string; html?: string; cc?: string }`
  - `interface MailboxSummary { uid: number; from: string; subject: string; date: Date; seen: boolean }`
  - `interface ParsedMessage extends MailboxSummary { to: string; text: string; html: string | null; attachments: { filename: string | null; contentType: string; size: number }[] }`
  - `class NoActiveEmailConfigError extends Error` (constructed with `'SMTP' | 'IMAP'`)
  - `EmailModule` (empty for now; providers added in later tasks)

- [ ] **Step 1: Add the dependencies**

Run: `pnpm add imapflow mailparser && pnpm add -D @types/mailparser`
Expected: `imapflow`, `mailparser` in `dependencies`; `@types/mailparser` in `devDependencies`. No native build (`pnpm.onlyBuiltDependencies` unaffected). Confirm `imapflow` resolves to `1.x` and `mailparser` to `3.x` in `pnpm-lock.yaml`.

- [ ] **Step 2: Write the failing test**

Create `src/infrastructure/email/email.types.spec.ts`:

```ts
import { NoActiveEmailConfigError } from './email.types';

describe('email.types', () => {
  it('NoActiveEmailConfigError names the missing config kind', () => {
    const err = new NoActiveEmailConfigError('SMTP');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NoActiveEmailConfigError');
    expect(err.message).toContain('SMTP');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- email.types`
Expected: FAIL — `Cannot find module './email.types'`.

- [ ] **Step 4: Create the types**

Create `src/infrastructure/email/email.types.ts`:

```ts
/** Resolved SMTP connection + sender identity (secret already decrypted). */
export interface SmtpConn {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  fromAddress: string;
  fromName: string | null;
}

/** Resolved IMAP connection (secret already decrypted). */
export interface ImapConn {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
}

/** An outbound message. `html` is optional; `text` is always sent. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  cc?: string;
}

/** Envelope-level summary of a mailbox message. */
export interface MailboxSummary {
  uid: number;
  from: string;
  subject: string;
  date: Date;
  seen: boolean;
}

/** A fully fetched + MIME-parsed message. */
export interface ParsedMessage extends MailboxSummary {
  to: string;
  text: string;
  html: string | null;
  attachments: {
    filename: string | null;
    contentType: string;
    size: number;
  }[];
}

/** Thrown when no active SMTP/IMAP profile exists. A domain error, not HTTP. */
export class NoActiveEmailConfigError extends Error {
  constructor(kind: 'SMTP' | 'IMAP') {
    super(`No active ${kind} configuration is set`);
    this.name = 'NoActiveEmailConfigError';
  }
}
```

- [ ] **Step 5: Create the empty module**

Create `src/infrastructure/email/email.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';

/**
 * Email infrastructure: outbound SMTP (MailerService) and inbound IMAP
 * (InboxService). Depends only on infrastructure (DatabaseModule is @Global;
 * CryptoModule provides EncryptionService). Providers/exports are added in
 * Tasks 4–5.
 */
@Module({
  imports: [CryptoModule],
  providers: [],
  exports: [],
})
export class EmailModule {}
```

- [ ] **Step 6: Run test + typecheck to verify they pass**

Run: `pnpm test -- email.types && pnpm typecheck`
Expected: PASS (1 test) and no type errors.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/infrastructure/email
git commit -m "feat(email): add email module skeleton, types, and imapflow/mailparser deps"
```

---

## Task 2: SMTP transport

Relocate the existing send/verify logic (`system/connection/smtp-tester.ts`) into the email module and generalize `send` to take an `EmailMessage` (adds `html`). The system module keeps working until Task 6 repoints it.

**Files:**
- Create: `src/infrastructure/email/transport/smtp.transport.ts`
- Test: `src/infrastructure/email/transport/smtp.transport.spec.ts`

**Interfaces:**
- Consumes: `SmtpConn`, `EmailMessage` (Task 1).
- Produces:
  - `verifySmtp(conn: SmtpConn): Promise<void>` — throws on connectivity/auth failure.
  - `sendMail(conn: SmtpConn, msg: EmailMessage): Promise<void>` — sends `text` (+`html`).

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/email/transport/smtp.transport.spec.ts`:

```ts
const verify = jest.fn(async () => true);
const sendMailFn = jest.fn(async () => ({ messageId: 'x' }));
const close = jest.fn();
const createTransport = jest.fn(() => ({ verify, sendMail: sendMailFn, close }));

jest.mock('nodemailer', () => ({ createTransport }));

import { sendMail, verifySmtp } from './smtp.transport';
import type { SmtpConn } from '../email.types';

const conn: SmtpConn = {
  host: 'smtp.example.com',
  port: 587,
  secure: true,
  username: 'mailer',
  password: 'pass',
  fromAddress: 'no-reply@example.com',
  fromName: 'Cybernetics',
};

describe('smtp.transport', () => {
  beforeEach(() => {
    createTransport.mockClear();
    verify.mockClear();
    sendMailFn.mockClear();
    close.mockClear();
  });

  it('verifySmtp builds a transport with auth and calls verify', async () => {
    await verifySmtp(conn);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: true,
        auth: { user: 'mailer', pass: 'pass' },
      }),
    );
    expect(verify).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('verifySmtp omits auth when there is no username', async () => {
    await verifySmtp({ ...conn, username: null, password: null });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it('sendMail formats the from header and passes text + html + cc', async () => {
    await sendMail(conn, {
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body',
      html: '<p>body</p>',
      cc: 'cc@example.com',
    });
    expect(sendMailFn).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Cybernetics <no-reply@example.com>',
        to: 'user@example.com',
        cc: 'cc@example.com',
        subject: 'Hi',
        text: 'body',
        html: '<p>body</p>',
      }),
    );
    expect(close).toHaveBeenCalled();
  });

  it('sendMail uses a bare from address when fromName is null', async () => {
    await sendMail({ ...conn, fromName: null }, {
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body',
    });
    expect(sendMailFn).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'no-reply@example.com' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- smtp.transport`
Expected: FAIL — `Cannot find module './smtp.transport'`.

- [ ] **Step 3: Implement the transport**

Create `src/infrastructure/email/transport/smtp.transport.ts`:

```ts
import { createTransport } from 'nodemailer';
import type { EmailMessage, SmtpConn } from '../email.types';

function buildTransport(conn: SmtpConn) {
  return createTransport({
    host: conn.host,
    port: conn.port,
    secure: conn.secure,
    auth: conn.username
      ? { user: conn.username, pass: conn.password ?? '' }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
}

/** Connect + EHLO/AUTH check. Throws on any failure. No mail is sent. */
export async function verifySmtp(conn: SmtpConn): Promise<void> {
  const transport = buildTransport(conn);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

/** Send one message through the given connection. Throws on send failure. */
export async function sendMail(
  conn: SmtpConn,
  msg: EmailMessage,
): Promise<void> {
  const transport = buildTransport(conn);
  try {
    await transport.sendMail({
      from: conn.fromName
        ? `${conn.fromName} <${conn.fromAddress}>`
        : conn.fromAddress,
      to: msg.to,
      cc: msg.cc,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  } finally {
    transport.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- smtp.transport`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/email/transport/smtp.transport.ts src/infrastructure/email/transport/smtp.transport.spec.ts
git commit -m "feat(email): add SMTP transport (send + verify)"
```

---

## Task 3: IMAP transport

New `imapflow`-based client with `mailparser` for MIME parsing. Each function opens a short-lived connection (connect → act → logout).

> **imapflow API reference (v1.4.x):** `const { ImapFlow } = require('imapflow')`; `new ImapFlow({host,port,secure,auth:{user,pass},logger})`; `await client.connect()`; `await client.logout()`; `const lock = await client.getMailboxLock('INBOX')` / `lock.release()`; async-iterate `client.fetch(range, query)` where query is `{ envelope, flags, source, uid }` and each message has `.uid`, `.envelope` (`{subject, date, from:[{address,name}], to:[...]}`), `.flags` (a `Set`), `.source` (Buffer); `client.fetchOne(seq, query, options)`; `client.search(query, options)` → number[]; `client.messageFlagsAdd(range, flags, options)` / `client.messageFlagsRemove(...)`; UID addressing via the `{ uid: true }` options arg. `mailparser`'s `simpleParser(source)` → `{ subject, from:{value:[{address,name}]}, to:{text}, date, text, html:(string|false), attachments:[{filename, contentType, size}] }`. **During implementation, confirm these shapes against the installed typings; the unit test mocks both libraries.**

**Files:**
- Create: `src/infrastructure/email/transport/imap.transport.ts`
- Test: `src/infrastructure/email/transport/imap.transport.spec.ts`

**Interfaces:**
- Consumes: `ImapConn`, `MailboxSummary`, `ParsedMessage` (Task 1).
- Produces:
  - `verifyImap(conn: ImapConn): Promise<void>`
  - `listMessages(conn: ImapConn, opts?: { mailbox?: string; limit?: number; unseenOnly?: boolean }): Promise<MailboxSummary[]>`
  - `fetchMessage(conn: ImapConn, uid: number, mailbox?: string): Promise<ParsedMessage | null>`
  - `setSeen(conn: ImapConn, uid: number, value: boolean, mailbox?: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/email/transport/imap.transport.spec.ts`:

```ts
class FakeLock {
  release = jest.fn();
}

function makeClient(overrides: Record<string, any> = {}) {
  return {
    connect: jest.fn(async () => undefined),
    logout: jest.fn(async () => undefined),
    close: jest.fn(),
    getMailboxLock: jest.fn(async () => new FakeLock()),
    fetch: jest.fn(),
    fetchOne: jest.fn(),
    search: jest.fn(async () => [] as number[]),
    messageFlagsAdd: jest.fn(async () => true),
    messageFlagsRemove: jest.fn(async () => true),
    ...overrides,
  };
}

let currentClient: any;
const ImapFlow = jest.fn(() => currentClient);
jest.mock('imapflow', () => ({ ImapFlow }));

const simpleParser = jest.fn();
jest.mock('mailparser', () => ({ simpleParser }));

import {
  fetchMessage,
  listMessages,
  setSeen,
  verifyImap,
} from './imap.transport';
import type { ImapConn } from '../email.types';

const conn: ImapConn = {
  host: 'imap.example.com',
  port: 993,
  secure: true,
  username: 'user',
  password: 'pass',
};

/** Build an async iterator over the given messages for client.fetch. */
async function* iter(messages: any[]) {
  for (const m of messages) yield m;
}

describe('imap.transport', () => {
  beforeEach(() => {
    ImapFlow.mockClear();
    simpleParser.mockReset();
    currentClient = makeClient();
  });

  it('verifyImap connects then logs out', async () => {
    await verifyImap(conn);
    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'imap.example.com',
        port: 993,
        secure: true,
        auth: { user: 'user', pass: 'pass' },
      }),
    );
    expect(currentClient.connect).toHaveBeenCalled();
    expect(currentClient.logout).toHaveBeenCalled();
  });

  it('listMessages maps envelopes to summaries (newest first, limited)', async () => {
    const d1 = new Date('2020-01-01');
    const d2 = new Date('2020-01-02');
    currentClient.fetch.mockReturnValue(
      iter([
        {
          uid: 1,
          envelope: { subject: 'one', date: d1, from: [{ address: 'a@x.com' }] },
          flags: new Set(['\\Seen']),
        },
        {
          uid: 2,
          envelope: { subject: 'two', date: d2, from: [{ address: 'b@x.com' }] },
          flags: new Set(),
        },
      ]),
    );
    const res = await listMessages(conn, { limit: 1 });
    expect(currentClient.getMailboxLock).toHaveBeenCalledWith('INBOX');
    expect(res).toEqual([
      { uid: 2, from: 'b@x.com', subject: 'two', date: d2, seen: false },
    ]);
  });

  it('fetchMessage parses the raw source into a ParsedMessage', async () => {
    currentClient.fetchOne.mockResolvedValue({
      uid: 7,
      source: Buffer.from('raw'),
      flags: new Set(['\\Seen']),
    });
    simpleParser.mockResolvedValue({
      subject: 'Hello',
      from: { value: [{ address: 'a@x.com', name: 'A' }] },
      to: { text: 'me@x.com' },
      date: new Date('2020-05-05'),
      text: 'plain',
      html: '<p>rich</p>',
      attachments: [{ filename: 'f.pdf', contentType: 'application/pdf', size: 10 }],
    });
    const res = await fetchMessage(conn, 7);
    expect(currentClient.fetchOne).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ source: true }),
      { uid: true },
    );
    expect(res).toEqual({
      uid: 7,
      from: 'a@x.com',
      to: 'me@x.com',
      subject: 'Hello',
      date: new Date('2020-05-05'),
      seen: true,
      text: 'plain',
      html: '<p>rich</p>',
      attachments: [{ filename: 'f.pdf', contentType: 'application/pdf', size: 10 }],
    });
  });

  it('fetchMessage returns null when the message is missing', async () => {
    currentClient.fetchOne.mockResolvedValue(false);
    expect(await fetchMessage(conn, 999)).toBeNull();
  });

  it('setSeen adds the \\Seen flag by UID', async () => {
    await setSeen(conn, 3, true);
    expect(currentClient.messageFlagsAdd).toHaveBeenCalledWith(
      3,
      ['\\Seen'],
      { uid: true },
    );
  });

  it('setSeen removes the \\Seen flag when value is false', async () => {
    await setSeen(conn, 3, false);
    expect(currentClient.messageFlagsRemove).toHaveBeenCalledWith(
      3,
      ['\\Seen'],
      { uid: true },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- imap.transport`
Expected: FAIL — `Cannot find module './imap.transport'`.

- [ ] **Step 3: Implement the transport**

Create `src/infrastructure/email/transport/imap.transport.ts`:

```ts
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { ImapConn, MailboxSummary, ParsedMessage } from '../email.types';

function makeClient(conn: ImapConn): ImapFlow {
  return new ImapFlow({
    host: conn.host,
    port: conn.port,
    secure: conn.secure,
    auth: { user: conn.username ?? '', pass: conn.password ?? '' },
    logger: false,
  });
}

/** connect → run fn → always logout. */
async function withClient<T>(
  conn: ImapConn,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = makeClient(conn);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** connect + login smoke test. Throws on failure. */
export async function verifyImap(conn: ImapConn): Promise<void> {
  await withClient(conn, async () => undefined);
}

export async function listMessages(
  conn: ImapConn,
  opts?: { mailbox?: string; limit?: number; unseenOnly?: boolean },
): Promise<MailboxSummary[]> {
  const mailbox = opts?.mailbox ?? 'INBOX';
  const limit = opts?.limit ?? 50;
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const range = opts?.unseenOnly ? { seen: false } : '1:*';
      const out: MailboxSummary[] = [];
      for await (const msg of client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
      })) {
        out.push({
          uid: msg.uid,
          from: msg.envelope?.from?.[0]?.address ?? '',
          subject: msg.envelope?.subject ?? '',
          date: msg.envelope?.date ?? new Date(0),
          seen: msg.flags?.has('\\Seen') ?? false,
        });
      }
      // Newest last from the server; return newest first, capped at `limit`.
      return out.slice(-limit).reverse();
    } finally {
      lock.release();
    }
  });
}

export async function fetchMessage(
  conn: ImapConn,
  uid: number,
  mailbox = 'INBOX',
): Promise<ParsedMessage | null> {
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(
        uid,
        { uid: true, source: true, flags: true },
        { uid: true },
      );
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      return {
        uid,
        from: parsed.from?.value?.[0]?.address ?? '',
        to: typeof parsed.to?.text === 'string' ? parsed.to.text : '',
        subject: parsed.subject ?? '',
        date: parsed.date ?? new Date(0),
        seen: msg.flags?.has('\\Seen') ?? false,
        text: parsed.text ?? '',
        html: typeof parsed.html === 'string' ? parsed.html : null,
        attachments: (parsed.attachments ?? []).map((a) => ({
          filename: a.filename ?? null,
          contentType: a.contentType,
          size: a.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

export async function setSeen(
  conn: ImapConn,
  uid: number,
  value: boolean,
  mailbox = 'INBOX',
): Promise<void> {
  await withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      if (value) {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- imap.transport`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no type errors. If the installed `imapflow`/`mailparser` typings differ (e.g. `client.fetch` range union, `parsed.to` array vs object), adjust the mapping to match the real types — keep the returned `MailboxSummary`/`ParsedMessage` shape identical.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/email/transport/imap.transport.ts src/infrastructure/email/transport/imap.transport.spec.ts
git commit -m "feat(email): add IMAP transport (verify, list, fetch+parse, flags)"
```

## Task 4: EmailConfigRepository

Read-only resolution of the single active SMTP/IMAP row → decrypted `SmtpConn`/`ImapConn`. Reads the shared schema tables directly (no `system` feature dependency).

**Files:**
- Create: `src/infrastructure/email/email-config.repository.ts`
- Test: `src/infrastructure/email/email-config.repository.spec.ts`

**Interfaces:**
- Consumes: `DRIZZLE`/`DrizzleDB`, `EncryptionService`, `smtpConfigs`/`imapConfigs` tables, `SmtpConn`/`ImapConn`.
- Produces:
  - `EmailConfigRepository.activeSmtp(): Promise<SmtpConn | null>`
  - `EmailConfigRepository.activeImap(): Promise<ImapConn | null>`

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/email/email-config.repository.spec.ts`:

```ts
import { EmailConfigRepository } from './email-config.repository';

function makeDb(row: any) {
  // Chainable select().from().where().limit() -> [row?]
  const chain = {
    from: jest.fn(() => chain),
    where: jest.fn(() => chain),
    limit: jest.fn(async () => (row ? [row] : [])),
  };
  return { select: jest.fn(() => chain) } as any;
}

const crypto = { decrypt: jest.fn(() => 'decrypted-pass'), encrypt: jest.fn() } as any;

describe('EmailConfigRepository', () => {
  beforeEach(() => crypto.decrypt.mockClear());

  it('activeSmtp resolves + decrypts the active row', async () => {
    const db = makeDb({
      host: 'smtp.example.com',
      port: 587,
      secure: true,
      username: 'mailer',
      secretEnc: 'v1.enc',
      fromAddress: 'no-reply@example.com',
      fromName: 'Cyber',
    });
    const repo = new EmailConfigRepository(db, crypto);
    const conn = await repo.activeSmtp();
    expect(crypto.decrypt).toHaveBeenCalledWith('v1.enc');
    expect(conn).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: true,
      username: 'mailer',
      password: 'decrypted-pass',
      fromAddress: 'no-reply@example.com',
      fromName: 'Cyber',
    });
  });

  it('activeSmtp returns null when there is no active row', async () => {
    const repo = new EmailConfigRepository(makeDb(null), crypto);
    expect(await repo.activeSmtp()).toBeNull();
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it('activeImap returns null password when the row has no secret', async () => {
    const db = makeDb({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'user',
      secretEnc: null,
    });
    const repo = new EmailConfigRepository(db, crypto);
    const conn = await repo.activeImap();
    expect(conn).toEqual({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'user',
      password: null,
    });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- email-config.repository`
Expected: FAIL — `Cannot find module './email-config.repository'`.

- [ ] **Step 3: Implement the repository**

Create `src/infrastructure/email/email-config.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../database/drizzle.constants';
import {
  imapConfigs,
  smtpConfigs,
} from '../database/schema/system.schema';
import { EncryptionService } from '../crypto/encryption.service';
import type { ImapConn, SmtpConn } from './email.types';

/**
 * Read-only resolver for the single active SMTP/IMAP profile. The write side
 * (CRUD) lives in the `system` feature; this reads the same tables for the
 * transport layer. Kept here so the email module never imports `system`.
 */
@Injectable()
export class EmailConfigRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly crypto: EncryptionService,
  ) {}

  async activeSmtp(): Promise<SmtpConn | null> {
    const rows = await this.db
      .select()
      .from(smtpConfigs)
      .where(
        and(eq(smtpConfigs.isActive, true), eq(smtpConfigs.isDeleted, false)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username ?? null,
      password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
      fromAddress: row.fromAddress,
      fromName: row.fromName ?? null,
    };
  }

  async activeImap(): Promise<ImapConn | null> {
    const rows = await this.db
      .select()
      .from(imapConfigs)
      .where(
        and(eq(imapConfigs.isActive, true), eq(imapConfigs.isDeleted, false)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username ?? null,
      password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
    };
  }
}
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm test -- email-config.repository && pnpm typecheck`
Expected: PASS (3 tests) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/email/email-config.repository.ts src/infrastructure/email/email-config.repository.spec.ts
git commit -m "feat(email): add active SMTP/IMAP config resolver"
```

---

## Task 5: MailerService + InboxService + module wiring

The two high-level services: resolve the active config, then delegate to transport. Wire them into `EmailModule`.

**Files:**
- Create: `src/infrastructure/email/mailer.service.ts`
- Create: `src/infrastructure/email/inbox.service.ts`
- Modify: `src/infrastructure/email/email.module.ts` (register + export both)
- Test: `src/infrastructure/email/mailer.service.spec.ts`
- Test: `src/infrastructure/email/inbox.service.spec.ts`

**Interfaces:**
- Consumes: `EmailConfigRepository` (Task 4), the transport functions (Tasks 2–3), `EmailMessage`, `MailboxSummary`, `ParsedMessage`, `NoActiveEmailConfigError`.
- Produces:
  - `MailerService.send(msg: EmailMessage): Promise<void>` (throws `NoActiveEmailConfigError` if no active SMTP)
  - `MailerService.verifyActive(): Promise<void>`
  - `InboxService.list(opts?): Promise<MailboxSummary[]>`
  - `InboxService.fetch(uid, mailbox?): Promise<ParsedMessage | null>`
  - `InboxService.markSeen(uid, mailbox?): Promise<void>` / `markUnseen(...)`
  - `InboxService.verifyActive(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/infrastructure/email/mailer.service.spec.ts`:

```ts
const sendMail = jest.fn(async () => undefined);
const verifySmtp = jest.fn(async () => undefined);
jest.mock('./transport/smtp.transport', () => ({ sendMail, verifySmtp }));

import { MailerService } from './mailer.service';
import { NoActiveEmailConfigError } from './email.types';

const conn = {
  host: 'h', port: 587, secure: true, username: 'u', password: 'p',
  fromAddress: 'no-reply@x.com', fromName: null,
};

describe('MailerService', () => {
  let repo: any;
  let service: MailerService;

  beforeEach(() => {
    sendMail.mockClear();
    verifySmtp.mockClear();
    repo = { activeSmtp: jest.fn(async () => conn), activeImap: jest.fn() };
    service = new MailerService(repo);
  });

  it('send resolves the active config and delegates to transport', async () => {
    const msg = { to: 'a@x.com', subject: 'Hi', text: 'body' };
    await service.send(msg);
    expect(repo.activeSmtp).toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith(conn, msg);
  });

  it('send throws NoActiveEmailConfigError when none is active', async () => {
    repo.activeSmtp.mockResolvedValueOnce(null);
    await expect(
      service.send({ to: 'a@x.com', subject: 'Hi', text: 'body' }),
    ).rejects.toBeInstanceOf(NoActiveEmailConfigError);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('verifyActive delegates to verifySmtp', async () => {
    await service.verifyActive();
    expect(verifySmtp).toHaveBeenCalledWith(conn);
  });
});
```

Create `src/infrastructure/email/inbox.service.spec.ts`:

```ts
const verifyImap = jest.fn(async () => undefined);
const listMessages = jest.fn(async () => []);
const fetchMessage = jest.fn(async () => null);
const setSeen = jest.fn(async () => undefined);
jest.mock('./transport/imap.transport', () => ({
  verifyImap, listMessages, fetchMessage, setSeen,
}));

import { InboxService } from './inbox.service';
import { NoActiveEmailConfigError } from './email.types';

const conn = { host: 'h', port: 993, secure: true, username: 'u', password: 'p' };

describe('InboxService', () => {
  let repo: any;
  let service: InboxService;

  beforeEach(() => {
    verifyImap.mockClear();
    listMessages.mockClear();
    fetchMessage.mockClear();
    setSeen.mockClear();
    repo = { activeImap: jest.fn(async () => conn), activeSmtp: jest.fn() };
    service = new InboxService(repo);
  });

  it('list resolves the active config and delegates', async () => {
    await service.list({ limit: 10 });
    expect(listMessages).toHaveBeenCalledWith(conn, { limit: 10 });
  });

  it('throws NoActiveEmailConfigError when no active IMAP config', async () => {
    repo.activeImap.mockResolvedValueOnce(null);
    await expect(service.list()).rejects.toBeInstanceOf(NoActiveEmailConfigError);
  });

  it('markSeen delegates with value true, markUnseen with false', async () => {
    await service.markSeen(5);
    expect(setSeen).toHaveBeenCalledWith(conn, 5, true, undefined);
    await service.markUnseen(5);
    expect(setSeen).toHaveBeenCalledWith(conn, 5, false, undefined);
  });

  it('fetch delegates the uid + mailbox', async () => {
    await service.fetch(9, 'Archive');
    expect(fetchMessage).toHaveBeenCalledWith(conn, 9, 'Archive');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- mailer.service inbox.service`
Expected: FAIL — `Cannot find module './mailer.service'` / `'./inbox.service'`.

- [ ] **Step 3: Implement MailerService**

Create `src/infrastructure/email/mailer.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { EmailConfigRepository } from './email-config.repository';
import { NoActiveEmailConfigError, type EmailMessage } from './email.types';
import { sendMail, verifySmtp } from './transport/smtp.transport';

/** The single outbound-mail seam for the app. Sends via the active SMTP config. */
@Injectable()
export class MailerService {
  constructor(private readonly config: EmailConfigRepository) {}

  async send(msg: EmailMessage): Promise<void> {
    const conn = await this.config.activeSmtp();
    if (!conn) throw new NoActiveEmailConfigError('SMTP');
    await sendMail(conn, msg);
  }

  async verifyActive(): Promise<void> {
    const conn = await this.config.activeSmtp();
    if (!conn) throw new NoActiveEmailConfigError('SMTP');
    await verifySmtp(conn);
  }
}
```

- [ ] **Step 4: Implement InboxService**

Create `src/infrastructure/email/inbox.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { EmailConfigRepository } from './email-config.repository';
import {
  NoActiveEmailConfigError,
  type MailboxSummary,
  type ParsedMessage,
} from './email.types';
import {
  fetchMessage,
  listMessages,
  setSeen,
  verifyImap,
} from './transport/imap.transport';

/** Inbound IMAP operations over the active IMAP config. Infra only (no HTTP). */
@Injectable()
export class InboxService {
  constructor(private readonly config: EmailConfigRepository) {}

  private async conn() {
    const conn = await this.config.activeImap();
    if (!conn) throw new NoActiveEmailConfigError('IMAP');
    return conn;
  }

  async verifyActive(): Promise<void> {
    await verifyImap(await this.conn());
  }

  async list(opts?: {
    mailbox?: string;
    limit?: number;
    unseenOnly?: boolean;
  }): Promise<MailboxSummary[]> {
    return listMessages(await this.conn(), opts);
  }

  async fetch(uid: number, mailbox?: string): Promise<ParsedMessage | null> {
    return fetchMessage(await this.conn(), uid, mailbox);
  }

  async markSeen(uid: number, mailbox?: string): Promise<void> {
    await setSeen(await this.conn(), uid, true, mailbox);
  }

  async markUnseen(uid: number, mailbox?: string): Promise<void> {
    await setSeen(await this.conn(), uid, false, mailbox);
  }
}
```

- [ ] **Step 5: Wire the module**

Replace `src/infrastructure/email/email.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { EmailConfigRepository } from './email-config.repository';
import { InboxService } from './inbox.service';
import { MailerService } from './mailer.service';

/**
 * Email infrastructure: outbound SMTP (MailerService) and inbound IMAP
 * (InboxService). Depends only on infrastructure (DatabaseModule is @Global;
 * CryptoModule provides EncryptionService). Imported explicitly by every
 * consumer so module-subset e2e boots stay self-sufficient.
 */
@Module({
  imports: [CryptoModule],
  providers: [EmailConfigRepository, MailerService, InboxService],
  exports: [MailerService, InboxService],
})
export class EmailModule {}
```

- [ ] **Step 6: Run tests + typecheck to verify they pass**

Run: `pnpm test -- mailer.service inbox.service && pnpm typecheck`
Expected: PASS (3 + 4 tests) and no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/email
git commit -m "feat(email): add MailerService + InboxService and wire EmailModule"
```

---

## Task 6: Refactor `system` + `mastra` onto the email module

Route all transport through the email module: delete the loose testers, delegate `test()`, drop `sendActive`, repoint the mastra `sendEmail` dependency.

**Files:**
- Modify: `src/features/system/smtp-config.service.ts` (import `verifySmtp` from email transport; **remove** `sendActive`)
- Modify: `src/features/system/imap-config.service.ts` (import `verifyImap` from email transport)
- Delete: `src/features/system/connection/smtp-tester.ts`, `src/features/system/connection/imap-tester.ts`
- Modify: `src/features/system/system.module.ts` (import `EmailModule`)
- Modify: `src/features/mastra/mastra.module.ts` (inject `MailerService` instead of `SmtpConfigService` for `sendEmail`)
- Modify: `src/features/system/smtp-config.service.spec.ts` / `imap-config.service.spec.ts` (mock path → email transport)

**Interfaces:**
- Consumes: `verifySmtp`, `verifyImap` (Tasks 2–3), `MailerService` (Task 5).
- Produces: no new public surface. `SmtpConfigService.sendActive` is removed.

- [ ] **Step 1: Point the SMTP service test() at the email transport**

In `src/features/system/smtp-config.service.ts`:

Replace the import
```ts
import { sendSmtpMail, testSmtpConnection } from './connection/smtp-tester';
```
with
```ts
import { verifySmtp } from '../../infrastructure/email/transport/smtp.transport';
```

In `test(id, ctx)`, replace the `testSmtpConnection({...})` call with:
```ts
      await verifySmtp({
        host: row.host,
        port: row.port,
        secure: row.secure,
        username: row.username,
        password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
        fromAddress: row.fromAddress,
        fromName: row.fromName,
      });
```

**Delete** the entire `sendActive(...)` method from `SmtpConfigService` (it is superseded by `MailerService.send`).

- [ ] **Step 2: Point the IMAP service test() at the email transport**

In `src/features/system/imap-config.service.ts`:

Replace
```ts
import { testImapConnection } from './connection/imap-tester';
```
with
```ts
import { verifyImap } from '../../infrastructure/email/transport/imap.transport';
```

In `test(id, ctx)`, replace `testImapConnection({...})` with:
```ts
      await verifyImap({
        host: row.host,
        port: row.port,
        secure: row.secure,
        username: row.username,
        password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
      });
```

- [ ] **Step 3: Delete the old testers**

Run: `git rm src/features/system/connection/smtp-tester.ts src/features/system/connection/imap-tester.ts`
(If the `connection/` directory is now empty, that's fine — leave it or remove it.)

- [ ] **Step 4: Import EmailModule into SystemModule**

In `src/features/system/system.module.ts`, add the import and add `EmailModule` to the module `imports` array:
```ts
import { EmailModule } from '../../infrastructure/email/email.module';
```
```ts
  imports: [CryptoModule, CacheModule, EmailModule],
```

- [ ] **Step 5: Repoint the mastra sendEmail dependency**

In `src/features/mastra/mastra.module.ts`:

Replace the import
```ts
import { SmtpConfigService } from '../system/smtp-config.service';
```
with
```ts
import { MailerService } from '../../infrastructure/email/mailer.service';
import { EmailModule } from '../../infrastructure/email/email.module';
```

Add `EmailModule` to both the outer `imports:` and the `MastraCoreModule.registerAsync({ imports: [...] })` arrays. Then swap the injected token:
- in `inject: [...]`, replace `SmtpConfigService` with `MailerService`;
- in `useFactory: (config, search, smtp, actionLog, pool) => {...}`, rename the param `smtp: SmtpConfigService` → `mailer: MailerService`;
- change the wiring to:
```ts
          sendEmail: (m) => mailer.send(m),
```
(`ToolServices.sendEmail` is `{ to; subject; text; cc? }` → assignable to `EmailMessage`.)

`SystemModule` can stay in the mastra imports (still needed for `SearchRecordService`? no — that's `SearchServiceModule`). Remove `SystemModule` from mastra's imports **only if** nothing else in the factory uses it; here the only system dependency was `SmtpConfigService`, so remove `SystemModule` from both `imports` arrays and delete its import if unused.

- [ ] **Step 6: Fix the affected system specs**

In `src/features/system/smtp-config.service.spec.ts`, change the mock target:
```ts
jest.mock('../../infrastructure/email/transport/smtp.transport', () => ({
  verifySmtp: jest.fn(async () => undefined),
}));
import { verifySmtp } from '../../infrastructure/email/transport/smtp.transport';
```
and update the test body to reference `verifySmtp` (the connection object now also carries `fromAddress`/`fromName`; assert on `host`/`password` as before). Delete any test that exercised the removed `sendActive`.

In `src/features/system/imap-config.service.spec.ts`, likewise mock `../../infrastructure/email/transport/imap.transport`'s `verifyImap`.

- [ ] **Step 7: Verify build, typecheck, and the touched specs**

Run: `pnpm test -- smtp-config.service imap-config.service && pnpm typecheck && pnpm build`
Expected: PASS; no type errors; Nest build succeeds (no dangling `smtp-tester`/`sendActive` references).

- [ ] **Step 8: Commit**

```bash
git add src/features/system src/features/mastra
git commit -m "refactor(system,mastra): route mail transport through infrastructure/email"
```

## Task 7: `password_reset_codes` schema + migration

**Files:**
- Create: `src/infrastructure/database/schema/password-reset.schema.ts`
- Modify: `src/infrastructure/database/schema/index.ts` (barrel export)
- Test: `src/infrastructure/database/schema/password-reset.schema.spec.ts`
- Generated: `src/infrastructure/database/migrations/*` (via `pnpm db:generate`)

**Interfaces:**
- Produces: `passwordResetCodes` table → `PasswordResetCodeRow`, `NewPasswordResetCodeRow`.

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/database/schema/password-reset.schema.spec.ts`:

```ts
import { passwordResetCodes } from './password-reset.schema';

describe('password-reset schema', () => {
  it('defines the password_reset_codes table with the expected columns', () => {
    expect(passwordResetCodes).toBeDefined();
    const cols = Object.keys((passwordResetCodes as any));
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'createdAt',
        'userId',
        'codeHash',
        'expiresAt',
        'attemptCount',
        'consumedAt',
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- password-reset.schema`
Expected: FAIL — `Cannot find module './password-reset.schema'`.

- [ ] **Step 3: Create the schema**

Create `src/infrastructure/database/schema/password-reset.schema.ts`:

```ts
import { index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity.schema';

/**
 * Single-use password-reset codes. The 6-digit code is stored ONLY as an
 * HMAC-SHA256 (keyed with a server pepper) hex digest — never in plaintext.
 * `consumedAt` is the burn/single-use marker (null = live). Append-style
 * lifecycle, so `baseColumns` is not used (same reasoning as `sessions`).
 */
export const passwordResetCodes = pgTable(
  'password_reset_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    index('password_reset_codes_user_idx').on(t.userId),
    index('password_reset_codes_expires_idx').on(t.expiresAt),
  ],
);

export type PasswordResetCodeRow = typeof passwordResetCodes.$inferSelect;
export type NewPasswordResetCodeRow = typeof passwordResetCodes.$inferInsert;
```

Add to `src/infrastructure/database/schema/index.ts`:
```ts
export * from './password-reset.schema';
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm test -- password-reset.schema && pnpm typecheck`
Expected: PASS (1 test) and no type errors.

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:generate`
Expected: a new migration under `src/infrastructure/database/migrations/` creating `password_reset_codes` with the FK to `users(id) ON DELETE CASCADE` and the two indexes. Review it.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/database/schema src/infrastructure/database/migrations
git commit -m "feat(auth): add password_reset_codes schema and migration"
```

---

## Task 8: Config/env for the reset flow

**Files:**
- Modify: `src/config/env.validation.ts` (add `PASSWORD_RESET_PEPPER` + prod guard)
- Modify: `src/config/configurations/auth.config.ts` (add `passwordReset` block)
- Modify: `api/.env.example` (document the new var)
- Test: `src/config/configurations/auth.config.spec.ts`

**Interfaces:**
- Produces: `AuthConfig.passwordReset = { pepper: string; codeTtlSeconds: number; maxAttempts: number; codeLength: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/config/configurations/auth.config.spec.ts`:

```ts
import { authConfig } from './auth.config';

describe('authConfig.passwordReset', () => {
  it('exposes the reset policy with sane defaults', () => {
    const cfg = authConfig();
    expect(cfg.passwordReset).toEqual(
      expect.objectContaining({
        codeTtlSeconds: 900,
        maxAttempts: 5,
        codeLength: 6,
      }),
    );
    expect(typeof cfg.passwordReset.pepper).toBe('string');
    expect(cfg.passwordReset.pepper.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- auth.config`
Expected: FAIL — `passwordReset` is undefined.

- [ ] **Step 3: Add the env var + prod guard**

In `src/config/env.validation.ts`, inside the `z.object({...})` (after the Security block), add:
```ts
    // Password reset (forgot-password OTP)
    PASSWORD_RESET_PEPPER: z
      .string()
      .min(1)
      .default('dev-insecure-reset-pepper-change-me'),
```

Inside `.superRefine((env, ctx) => { ... })`, add:
```ts
    if (
      env.NODE_ENV === 'production' &&
      (env.PASSWORD_RESET_PEPPER === 'dev-insecure-reset-pepper-change-me' ||
        env.PASSWORD_RESET_PEPPER.length < 16)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PASSWORD_RESET_PEPPER'],
        message:
          'PASSWORD_RESET_PEPPER must be a strong non-default value (>= 16 chars) when NODE_ENV=production.',
      });
    }
```

- [ ] **Step 4: Add the passwordReset block to auth config**

In `src/config/configurations/auth.config.ts`, add to the returned object:
```ts
    passwordReset: {
      pepper: env.PASSWORD_RESET_PEPPER,
      codeTtlSeconds: 900, // 15 minutes
      maxAttempts: 5,
      codeLength: 6,
    },
```

- [ ] **Step 5: Document the env var**

In `api/.env.example`, under an `# Auth` section (add if missing), append:
```
# Password reset OTP pepper (HMAC key). MUST be a strong non-default value in production.
PASSWORD_RESET_PEPPER=dev-insecure-reset-pepper-change-me
```

- [ ] **Step 6: Run test + typecheck to verify they pass**

Run: `pnpm test -- auth.config && pnpm typecheck`
Expected: PASS (1 test) and no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/config api/.env.example
git commit -m "feat(auth): add PASSWORD_RESET_PEPPER env and passwordReset config"
```

---

## Task 9: ResetCodeHasher

Generates the 6-digit code and HMAC-hashes/verifies it (timing-safe).

**Files:**
- Create: `src/features/auth/reset-code-hasher.ts`
- Test: `src/features/auth/reset-code-hasher.spec.ts`

**Interfaces:**
- Consumes: `AuthConfig.passwordReset` (Task 8).
- Produces:
  - `ResetCodeHasher.generate(): string` (zero-padded 6-digit)
  - `ResetCodeHasher.hash(code: string): string` (HMAC-SHA256 hex)
  - `ResetCodeHasher.verify(code: string, hash: string): boolean` (timing-safe)

- [ ] **Step 1: Write the failing test**

Create `src/features/auth/reset-code-hasher.spec.ts`:

```ts
import { ResetCodeHasher } from './reset-code-hasher';

function makeHasher(pepper = 'test-pepper', codeLength = 6) {
  const config = {
    getOrThrow: () => ({ passwordReset: { pepper, codeLength } }),
  } as any;
  return new ResetCodeHasher(config);
}

describe('ResetCodeHasher', () => {
  it('generate returns a zero-padded 6-digit string', () => {
    const h = makeHasher();
    for (let i = 0; i < 50; i++) {
      const code = h.generate();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('hash is deterministic, hex, and not the plaintext', () => {
    const h = makeHasher();
    const a = h.hash('123456');
    const b = h.hash('123456');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('123456');
  });

  it('hash depends on the pepper', () => {
    expect(makeHasher('p1').hash('123456')).not.toBe(
      makeHasher('p2').hash('123456'),
    );
  });

  it('verify is true for the right code, false otherwise', () => {
    const h = makeHasher();
    const hash = h.hash('654321');
    expect(h.verify('654321', hash)).toBe(true);
    expect(h.verify('000000', hash)).toBe(false);
  });

  it('verify returns false (no throw) on a malformed stored hash', () => {
    const h = makeHasher();
    expect(h.verify('654321', 'not-hex')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- reset-code-hasher`
Expected: FAIL — `Cannot find module './reset-code-hasher'`.

- [ ] **Step 3: Implement the hasher**

Create `src/features/auth/reset-code-hasher.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from '../../config/configurations/auth.config';

/**
 * Generates + verifies the 6-digit reset code. The code is stored only as an
 * HMAC-SHA256 keyed with a server pepper, so a DB leak alone cannot brute the
 * low-entropy (10^6) code space. Verification is constant-time.
 */
@Injectable()
export class ResetCodeHasher {
  private readonly pepper: string;
  private readonly length: number;

  constructor(config: ConfigService) {
    const cfg = config.getOrThrow<AuthConfig>('auth');
    this.pepper = cfg.passwordReset.pepper;
    this.length = cfg.passwordReset.codeLength;
  }

  generate(): string {
    const max = 10 ** this.length;
    return String(randomInt(0, max)).padStart(this.length, '0');
  }

  hash(code: string): string {
    return createHmac('sha256', this.pepper).update(code).digest('hex');
  }

  verify(code: string, hash: string): boolean {
    const expected = Buffer.from(this.hash(code), 'hex');
    let actual: Buffer;
    try {
      actual = Buffer.from(hash, 'hex');
    } catch {
      return false;
    }
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm test -- reset-code-hasher && pnpm typecheck`
Expected: PASS (5 tests) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/reset-code-hasher.ts src/features/auth/reset-code-hasher.spec.ts
git commit -m "feat(auth): add HMAC-peppered ResetCodeHasher"
```

---

## Task 10: PasswordResetRepository

CRUD for `password_reset_codes`. (Unit-tested with a mocked chainable `db`, matching `EmailConfigRepository`; real-DB behaviour is covered by the e2e in Task 15.)

**Files:**
- Create: `src/features/auth/password-reset.repository.ts`
- Test: `src/features/auth/password-reset.repository.spec.ts`

**Interfaces:**
- Consumes: `DRIZZLE`/`DrizzleDB`, `passwordResetCodes` table + row types.
- Produces:
  - `insert(row: NewPasswordResetCodeRow): Promise<PasswordResetCodeRow>`
  - `findLiveByUser(userId: string): Promise<PasswordResetCodeRow | null>`
  - `consumeAllForUser(userId: string): Promise<void>`
  - `incrementAttempts(id: string): Promise<number>` (returns the new count)
  - `consume(id: string): Promise<void>`
  - `deleteExpired(now?: Date): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/features/auth/password-reset.repository.spec.ts`:

```ts
import { PasswordResetRepository } from './password-reset.repository';

/** Minimal chainable Drizzle mock. Each terminal returns the queued result. */
function makeDb() {
  const state: any = { lastInsertValues: null };
  const db: any = {
    insert: jest.fn(() => ({
      values: jest.fn((v: any) => {
        state.lastInsertValues = v;
        return { returning: jest.fn(async () => [{ id: 'r1', ...v }]) };
      }),
    })),
    select: jest.fn(() => {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => state.selectResult ?? [],
      };
      return chain;
    }),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({
          returning: jest.fn(async () => state.updateResult ?? [{ attemptCount: 3 }]),
        })),
      })),
    })),
    delete: jest.fn(() => ({ where: jest.fn(async () => undefined) })),
  };
  return { db, state };
}

describe('PasswordResetRepository', () => {
  it('insert stores the row and returns it', async () => {
    const { db } = makeDb();
    const repo = new PasswordResetRepository(db);
    const row = await repo.insert({
      userId: 'u1',
      codeHash: 'h',
      expiresAt: new Date('2030-01-01'),
    } as any);
    expect(db.insert).toHaveBeenCalled();
    expect(row).toEqual(expect.objectContaining({ id: 'r1', userId: 'u1' }));
  });

  it('findLiveByUser returns null when none live', async () => {
    const { db, state } = makeDb();
    state.selectResult = [];
    const repo = new PasswordResetRepository(db);
    expect(await repo.findLiveByUser('u1')).toBeNull();
  });

  it('findLiveByUser returns the live row', async () => {
    const { db, state } = makeDb();
    state.selectResult = [{ id: 'r1', userId: 'u1', consumedAt: null }];
    const repo = new PasswordResetRepository(db);
    expect(await repo.findLiveByUser('u1')).toEqual(
      expect.objectContaining({ id: 'r1' }),
    );
  });

  it('incrementAttempts returns the new count', async () => {
    const { db, state } = makeDb();
    state.updateResult = [{ attemptCount: 4 }];
    const repo = new PasswordResetRepository(db);
    expect(await repo.incrementAttempts('r1')).toBe(4);
  });

  it('consumeAllForUser and consume issue updates; deleteExpired issues a delete', async () => {
    const { db } = makeDb();
    const repo = new PasswordResetRepository(db);
    await repo.consumeAllForUser('u1');
    await repo.consume('r1');
    await repo.deleteExpired(new Date('2020-01-01'));
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- password-reset.repository`
Expected: FAIL — `Cannot find module './password-reset.repository'`.

- [ ] **Step 3: Implement the repository**

Create `src/features/auth/password-reset.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  passwordResetCodes,
  type NewPasswordResetCodeRow,
  type PasswordResetCodeRow,
} from '../../infrastructure/database/schema/password-reset.schema';

/** Access to the `password_reset_codes` table. */
@Injectable()
export class PasswordResetRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async insert(row: NewPasswordResetCodeRow): Promise<PasswordResetCodeRow> {
    const rows = await this.db
      .insert(passwordResetCodes)
      .values(row)
      .returning();
    return rows[0];
  }

  /** The user's most recent live (un-consumed) code, if any. */
  async findLiveByUser(userId: string): Promise<PasswordResetCodeRow | null> {
    const rows = await this.db
      .select()
      .from(passwordResetCodes)
      .where(
        and(
          eq(passwordResetCodes.userId, userId),
          isNull(passwordResetCodes.consumedAt),
        ),
      )
      .orderBy(desc(passwordResetCodes.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Burn every live code for a user (called before issuing a new one). */
  async consumeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(passwordResetCodes)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(passwordResetCodes.userId, userId),
          isNull(passwordResetCodes.consumedAt),
        ),
      );
  }

  /** Atomically bump the attempt counter; returns the new value. */
  async incrementAttempts(id: string): Promise<number> {
    const rows = await this.db
      .update(passwordResetCodes)
      .set({ attemptCount: sql`${passwordResetCodes.attemptCount} + 1` })
      .where(eq(passwordResetCodes.id, id))
      .returning();
    return rows[0]?.attemptCount ?? 0;
  }

  async consume(id: string): Promise<void> {
    await this.db
      .update(passwordResetCodes)
      .set({ consumedAt: new Date() })
      .where(eq(passwordResetCodes.id, id));
  }

  async deleteExpired(now = new Date()): Promise<void> {
    await this.db
      .delete(passwordResetCodes)
      .where(lt(passwordResetCodes.expiresAt, now));
  }
}
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm test -- password-reset.repository && pnpm typecheck`
Expected: PASS (5 tests) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/password-reset.repository.ts src/features/auth/password-reset.repository.spec.ts
git commit -m "feat(auth): add PasswordResetRepository"
```

---

## Task 11: ResetMailer

Owns the two email templates and delegates to `MailerService`. Keeps copy out of the security logic.

**Files:**
- Create: `src/features/auth/reset-mailer.ts`
- Test: `src/features/auth/reset-mailer.spec.ts`

**Interfaces:**
- Consumes: `MailerService.send` (Task 5).
- Produces:
  - `ResetMailer.sendCode(email: string, code: string): Promise<void>`
  - `ResetMailer.sendChangedConfirmation(email: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/features/auth/reset-mailer.spec.ts`:

```ts
import { ResetMailer } from './reset-mailer';

describe('ResetMailer', () => {
  let mailer: any;
  let reset: ResetMailer;

  beforeEach(() => {
    mailer = { send: jest.fn(async () => undefined) };
    reset = new ResetMailer(mailer);
  });

  it('sendCode emails the code to the user', async () => {
    await reset.sendCode('user@example.com', '482913');
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('reset code'),
        text: expect.stringContaining('482913'),
      }),
    );
    const arg = mailer.send.mock.calls[0][0];
    expect(arg.html).toContain('482913');
  });

  it('sendChangedConfirmation emails a confirmation (no code)', async () => {
    await reset.sendChangedConfirmation('user@example.com');
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('changed'),
        text: expect.stringContaining('changed'),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- reset-mailer`
Expected: FAIL — `Cannot find module './reset-mailer'`.

- [ ] **Step 3: Implement the mailer**

Create `src/features/auth/reset-mailer.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { MailerService } from '../../infrastructure/email/mailer.service';

/** Password-reset email templates. Delegates delivery to MailerService. */
@Injectable()
export class ResetMailer {
  constructor(private readonly mailer: MailerService) {}

  async sendCode(email: string, code: string): Promise<void> {
    const subject = 'Your password reset code';
    const text =
      `Your password reset code is ${code}. It expires in 15 minutes.\n\n` +
      `If you didn't request this, you can safely ignore this email.`;
    const html =
      `<p>Your password reset code is <strong>${code}</strong>.</p>` +
      `<p>It expires in 15 minutes.</p>` +
      `<p>If you didn't request this, you can safely ignore this email.</p>`;
    await this.mailer.send({ to: email, subject, text, html });
  }

  async sendChangedConfirmation(email: string): Promise<void> {
    const subject = 'Your password was changed';
    const text =
      `Your password was just changed.\n\n` +
      `If this wasn't you, contact support immediately.`;
    const html =
      `<p>Your password was just changed.</p>` +
      `<p>If this wasn't you, contact support immediately.</p>`;
    await this.mailer.send({ to: email, subject, text, html });
  }
}
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm test -- reset-mailer && pnpm typecheck`
Expected: PASS (2 tests) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/reset-mailer.ts src/features/auth/reset-mailer.spec.ts
git commit -m "feat(auth): add ResetMailer templates"
```

## Task 12: PasswordResetService

The core orchestration: `request` (issue a code, best-effort email) and `reset` (verify + set password + revoke sessions + confirm). Uniform failure, enumeration-safe.

**Files:**
- Create: `src/features/auth/password-reset.service.ts`
- Test: `src/features/auth/password-reset.service.spec.ts`

**Interfaces:**
- Consumes: `UserRepository` (`findByEmail`, `update`), `PasswordResetRepository` (Task 10), `SessionRepository` (`revokeAllForUser`), `PasswordService` (`hash`), `ResetCodeHasher` (Task 9), `ResetMailer` (Task 11), `AuthConfig.passwordReset`.
- Produces:
  - `PasswordResetService.request(email: string): Promise<void>` (always resolves)
  - `PasswordResetService.reset(email: string, code: string, newPassword: string): Promise<void>` (throws `UnauthorizedException` on any business failure)

- [ ] **Step 1: Write the failing test**

Create `src/features/auth/password-reset.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';

function makeConfig() {
  return {
    getOrThrow: () => ({
      passwordReset: {
        pepper: 'p',
        codeTtlSeconds: 900,
        maxAttempts: 5,
        codeLength: 6,
      },
    }),
  } as any;
}

const user = { id: 'u1', email: 'user@example.com', passwordHash: 'old' };

describe('PasswordResetService', () => {
  let users: any;
  let codes: any;
  let sessions: any;
  let passwords: any;
  let hasher: any;
  let mailer: any;
  let service: PasswordResetService;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(async () => user),
      update: jest.fn(async () => user),
    };
    codes = {
      consumeAllForUser: jest.fn(async () => undefined),
      insert: jest.fn(async () => ({ id: 'c1' })),
      findLiveByUser: jest.fn(async () => ({
        id: 'c1',
        codeHash: 'HASH',
        expiresAt: new Date(Date.now() + 60_000),
        attemptCount: 0,
      })),
      incrementAttempts: jest.fn(async () => 1),
      consume: jest.fn(async () => undefined),
    };
    sessions = { revokeAllForUser: jest.fn(async () => undefined) };
    passwords = { hash: jest.fn(async () => 'new-hash') };
    hasher = {
      generate: jest.fn(() => '482913'),
      hash: jest.fn(() => 'HASH'),
      verify: jest.fn(() => true),
    };
    mailer = {
      sendCode: jest.fn(async () => undefined),
      sendChangedConfirmation: jest.fn(async () => undefined),
    };
    service = new PasswordResetService(
      users, codes, sessions, passwords, hasher, mailer, makeConfig(),
    );
  });

  // --- request ---

  it('request issues + emails a code for a known user', async () => {
    await service.request('User@Example.com');
    expect(users.findByEmail).toHaveBeenCalledWith('user@example.com');
    expect(codes.consumeAllForUser).toHaveBeenCalledWith('u1');
    expect(codes.insert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', codeHash: 'HASH' }),
    );
    expect(mailer.sendCode).toHaveBeenCalledWith('user@example.com', '482913');
  });

  it('request is a no-op for an unknown email (no throw, no code, no mail)', async () => {
    users.findByEmail.mockResolvedValueOnce(null);
    await expect(service.request('nobody@example.com')).resolves.toBeUndefined();
    expect(codes.insert).not.toHaveBeenCalled();
    expect(mailer.sendCode).not.toHaveBeenCalled();
  });

  it('request still resolves when sending mail throws (best-effort)', async () => {
    mailer.sendCode.mockRejectedValueOnce(new Error('smtp down'));
    await expect(service.request('user@example.com')).resolves.toBeUndefined();
    expect(codes.insert).toHaveBeenCalled();
  });

  // --- reset ---

  it('reset succeeds: sets password, burns code, revokes sessions, confirms', async () => {
    await service.reset('user@example.com', '482913', 'a-strong-password');
    expect(hasher.verify).toHaveBeenCalledWith('482913', 'HASH');
    expect(passwords.hash).toHaveBeenCalledWith('a-strong-password');
    expect(users.update).toHaveBeenCalledWith('u1', { passwordHash: 'new-hash' });
    expect(codes.consume).toHaveBeenCalledWith('c1');
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(mailer.sendChangedConfirmation).toHaveBeenCalledWith('user@example.com');
  });

  it('reset throws 401 for an unknown email and does equalizing HMAC work', async () => {
    users.findByEmail.mockResolvedValueOnce(null);
    await expect(
      service.reset('nobody@example.com', '482913', 'a-strong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(hasher.verify).toHaveBeenCalled(); // decoy comparison ran
    expect(users.update).not.toHaveBeenCalled();
  });

  it('reset throws 401 when there is no live code', async () => {
    codes.findLiveByUser.mockResolvedValueOnce(null);
    await expect(
      service.reset('user@example.com', '482913', 'a-strong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('reset throws 401 when the code is expired', async () => {
    codes.findLiveByUser.mockResolvedValueOnce({
      id: 'c1', codeHash: 'HASH', expiresAt: new Date(Date.now() - 1000), attemptCount: 0,
    });
    await expect(
      service.reset('user@example.com', '482913', 'a-strong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwords.hash).not.toHaveBeenCalled();
  });

  it('reset on a wrong code increments attempts and throws', async () => {
    hasher.verify.mockReturnValueOnce(false);
    await expect(
      service.reset('user@example.com', '000000', 'a-strong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(codes.incrementAttempts).toHaveBeenCalledWith('c1');
    expect(codes.consume).not.toHaveBeenCalled();
  });

  it('reset burns the code on the final (5th) wrong attempt', async () => {
    hasher.verify.mockReturnValueOnce(false);
    codes.incrementAttempts.mockResolvedValueOnce(5);
    await expect(
      service.reset('user@example.com', '000000', 'a-strong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(codes.consume).toHaveBeenCalledWith('c1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- password-reset.service`
Expected: FAIL — `Cannot find module './password-reset.service'`.

- [ ] **Step 3: Implement the service**

Create `src/features/auth/password-reset.service.ts`:

```ts
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthConfig } from '../../config/configurations/auth.config';
import { UserRepository } from '../users/user.repository';
import { PasswordResetRepository } from './password-reset.repository';
import { PasswordService } from './password.service';
import { ResetCodeHasher } from './reset-code-hasher';
import { ResetMailer } from './reset-mailer';
import { SessionRepository } from './session.repository';

/** A syntactically valid but unmatchable hash, for timing equalization. */
const DECOY_CODE_HASH = '0'.repeat(64);

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly ttlMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly users: UserRepository,
    private readonly codes: PasswordResetRepository,
    private readonly sessions: SessionRepository,
    private readonly passwords: PasswordService,
    private readonly hasher: ResetCodeHasher,
    private readonly mailer: ResetMailer,
    config: ConfigService,
  ) {
    const cfg = config.getOrThrow<AuthConfig>('auth');
    this.ttlMs = cfg.passwordReset.codeTtlSeconds * 1000;
    this.maxAttempts = cfg.passwordReset.maxAttempts;
  }

  /**
   * Issue a reset code and email it. Always resolves and never reveals whether
   * the account exists (enumeration-safe); mail delivery is best-effort.
   */
  async request(email: string): Promise<void> {
    const user = await this.users.findByEmail(email.toLowerCase());
    if (!user) {
      this.logger.log('forgot_requested email=unknown');
      return;
    }
    await this.codes.consumeAllForUser(user.id);
    const code = this.hasher.generate();
    await this.codes.insert({
      userId: user.id,
      codeHash: this.hasher.hash(code),
      expiresAt: new Date(Date.now() + this.ttlMs),
    });
    this.logger.log(`forgot_requested userId=${user.id}`);
    try {
      await this.mailer.sendCode(user.email, code);
    } catch (err) {
      this.logger.error(
        `reset code email failed userId=${user.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Verify the code and reset the password. Throws a uniform 401 on any
   * failure (unknown email, missing/expired/consumed code, wrong code,
   * attempts exhausted) — never revealing which factor failed.
   */
  async reset(email: string, code: string, newPassword: string): Promise<void> {
    const fail = () =>
      new UnauthorizedException('Invalid or expired reset code');

    const user = await this.users.findByEmail(email.toLowerCase());
    if (!user) {
      this.hasher.verify(code, DECOY_CODE_HASH); // equalize HMAC timing
      this.logger.warn('reset_failed reason=unknown_email');
      throw fail();
    }

    const row = await this.codes.findLiveByUser(user.id);
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      this.hasher.verify(code, DECOY_CODE_HASH);
      this.logger.warn(`reset_failed userId=${user.id} reason=no_live_code`);
      throw fail();
    }

    if (!this.hasher.verify(code, row.codeHash)) {
      const attempts = await this.codes.incrementAttempts(row.id);
      if (attempts >= this.maxAttempts) {
        await this.codes.consume(row.id);
        this.logger.warn(`reset_lockout userId=${user.id}`);
      } else {
        this.logger.warn(`reset_failed userId=${user.id} reason=wrong_code`);
      }
      throw fail();
    }

    await this.users.update(user.id, {
      passwordHash: await this.passwords.hash(newPassword),
    });
    await this.codes.consume(row.id);
    await this.sessions.revokeAllForUser(user.id);
    this.logger.log(`reset_succeeded userId=${user.id}`);
    try {
      await this.mailer.sendChangedConfirmation(user.email);
    } catch (err) {
      this.logger.error(
        `reset confirmation email failed userId=${user.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm test -- password-reset.service && pnpm typecheck`
Expected: PASS (9 tests) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/password-reset.service.ts src/features/auth/password-reset.service.spec.ts
git commit -m "feat(auth): add PasswordResetService (request + reset)"
```

---

## Task 13: DTOs + controller routes + AuthModule wiring

**Files:**
- Create: `src/features/auth/dto/forgot-password.dto.ts`
- Create: `src/features/auth/dto/reset-password.dto.ts`
- Modify: `src/features/auth/auth.controller.ts` (two `@Public()` routes)
- Modify: `src/features/auth/auth.module.ts` (import `EmailModule`; register providers)

**Interfaces:**
- Consumes: `PasswordResetService` (Task 12).
- Produces: `POST /auth/forgot-password`, `POST /auth/reset-password`.

- [ ] **Step 1: Create the DTOs**

Create `src/features/auth/dto/forgot-password.dto.ts`:
```ts
import { z } from 'zod';

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
```

Create `src/features/auth/dto/reset-password.dto.ts`:
```ts
import { z } from 'zod';

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
  newPassword: z.string().min(12).max(200),
});

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
```

- [ ] **Step 2: Add the controller routes**

In `src/features/auth/auth.controller.ts`:

Add imports:
```ts
import {
  forgotPasswordSchema,
  type ForgotPasswordDto,
} from './dto/forgot-password.dto';
import {
  resetPasswordSchema,
  type ResetPasswordDto,
} from './dto/reset-password.dto';
import { PasswordResetService } from './password-reset.service';
```

Inject the service — extend the constructor:
```ts
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: ServiceCredentialService,
    private readonly passwordReset: PasswordResetService,
  ) {}
```

Add the two routes (place them near `login`/`refresh`, before `service-token`):
```ts
  @Public()
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  @Post('forgot-password')
  @HttpCode(204)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordDto,
  ): Promise<void> {
    await this.passwordReset.request(body.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordDto,
  ): Promise<void> {
    await this.passwordReset.reset(body.email, body.code, body.newPassword);
  }
```

- [ ] **Step 3: Wire AuthModule**

In `src/features/auth/auth.module.ts`:

Add imports:
```ts
import { EmailModule } from '../../infrastructure/email/email.module';
import { PasswordResetRepository } from './password-reset.repository';
import { PasswordResetService } from './password-reset.service';
import { ResetCodeHasher } from './reset-code-hasher';
import { ResetMailer } from './reset-mailer';
```

Add `EmailModule` to `imports`:
```ts
  imports: [UsersModule, PassportModule, JwtModule.register({}), EmailModule],
```

Add the four providers to the `providers` array:
```ts
    PasswordResetService,
    PasswordResetRepository,
    ResetCodeHasher,
    ResetMailer,
```

(`UsersModule` already exports `UserRepository` + `PasswordService`; `SessionRepository` is already an auth provider; `ConfigService` is global.)

- [ ] **Step 4: Verify build + typecheck**

Run: `pnpm typecheck && pnpm build`
Expected: no type errors; Nest build succeeds. (`PasswordResetService`'s deps all resolve: `UserRepository`/`PasswordService` from `UsersModule`, `SessionRepository` local, `MailerService` via `ResetMailer` from `EmailModule`.)

- [ ] **Step 5: Commit**

```bash
git add src/features/auth
git commit -m "feat(auth): expose POST /auth/forgot-password and /auth/reset-password"
```

---

## Task 14: Build + typecheck + full unit verification

A whole-suite gate before the e2e — catches cross-module breakage from the Task 6 refactor.

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: all specs PASS, including the refactored `smtp-config.service` / `imap-config.service` and every new email + auth spec. Investigate and fix any failure before proceeding.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: no type errors; Nest build succeeds with no references to the deleted `smtp-tester`/`imap-tester` or the removed `sendActive`.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean (auto-fixes applied). Resolve any remaining errors.

- [ ] **Step 4: Commit (only if lint/format changed files)**

```bash
git add -A
git commit -m "chore: lint + format after email module + forgot-password"
```

## Task 15: e2e — forgot → reset flow

Boots the **auth + email module subset** (never `AppModule` — Mastra's ESM dep breaks Jest), overriding `MailerService` with a capturing fake so the test can read the generated code. Requires Postgres (migration from Task 7 applied via `pnpm db:migrate`) + Redis on the `.env` ports.

> **Throttle note:** `POST /auth/forgot-password` carries a per-route `@Throttle({limit:3, ttl:900_000})` that the high global test limit does NOT override. The functional describe therefore makes **at most 3** forgot-password calls; the 429 assertion lives in a separate describe with its own app boot (in-memory throttler storage resets per app instance).

**Files:**
- Create: `test/password-reset.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthModule`, `UsersModule`, `MailerService` (overridden), `UsersService.create`.

- [ ] **Step 1: Write the e2e spec**

Create `test/password-reset.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ConfigModule } from '../src/config/config.module';
import type { AuthConfig } from '../src/config/configurations/auth.config';
import { AuthModule } from '../src/features/auth/auth.module';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { MailerService } from '../src/infrastructure/email/mailer.service';

/** In-memory MailerService replacement that records every message. */
class FakeMailer {
  sent: { to: string; subject: string; text: string; html?: string }[] = [];
  async send(msg: any) {
    this.sent.push(msg);
  }
  async verifyActive() {
    /* no-op */
  }
  lastCodeFor(to: string): string | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = this.sent[i];
      if (m.to === to) {
        const match = m.text.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
    return null;
  }
}

function buildModule(mailer: FakeMailer) {
  return Test.createTestingModule({
    imports: [
      ConfigModule,
      DatabaseModule,
      ThrottlerModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (c: ConfigService) => {
          const a = c.getOrThrow<AuthConfig>('auth');
          return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }];
        },
      }),
      AuthModule,
      UsersModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  })
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();
}

describe('Password reset (e2e)', () => {
  let app: INestApplication;
  let mailer: FakeMailer;
  const stamp = String(Date.now());
  const userAEmail = `reset_a_${stamp}@e2e.local`;
  const userBEmail = `reset_b_${stamp}@e2e.local`;
  const oldPass = 'old-e2e-password-123';
  const newPass = 'new-e2e-password-456';
  let userARefresh: string;

  beforeAll(async () => {
    mailer = new FakeMailer();
    const moduleRef = await buildModule(mailer);
    app = moduleRef.createNestApplication();
    await app.init();

    const users = app.get(UsersService);
    await users.create({ email: userAEmail, password: oldPass, role: 'user' });
    await users.create({ email: userBEmail, password: oldPass, role: 'user' });

    // Log userA in first to obtain a refresh token that reset must revoke.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userAEmail, password: oldPass })
      .expect(200);
    userARefresh = login.body.refreshToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();

  // forgot-password call #1
  it('completes the happy path: forgot → reset → login with new password', async () => {
    await request(server())
      .post('/auth/forgot-password')
      .send({ email: userAEmail })
      .expect(204);

    const code = mailer.lastCodeFor(userAEmail);
    expect(code).toMatch(/^\d{6}$/);

    await request(server())
      .post('/auth/reset-password')
      .send({ email: userAEmail, code, newPassword: newPass })
      .expect(204);

    // New password works.
    await request(server())
      .post('/auth/login')
      .send({ email: userAEmail, password: newPass })
      .expect(200);

    // Old password no longer works.
    await request(server())
      .post('/auth/login')
      .send({ email: userAEmail, password: oldPass })
      .expect(401);

    // The pre-reset refresh token was revoked (all sessions killed).
    await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: userARefresh })
      .expect(401);

    // A confirmation email was sent.
    expect(
      mailer.sent.some(
        (m) => m.to === userAEmail && /changed/i.test(m.subject),
      ),
    ).toBe(true);
  });

  // forgot-password call #2
  it('returns 204 for an unknown email and sends no mail', async () => {
    const before = mailer.sent.length;
    await request(server())
      .post('/auth/forgot-password')
      .send({ email: `ghost_${stamp}@e2e.local` })
      .expect(204);
    expect(mailer.sent.length).toBe(before);
  });

  // forgot-password call #3
  it('locks out after 5 wrong codes and burns the code', async () => {
    await request(server())
      .post('/auth/forgot-password')
      .send({ email: userBEmail })
      .expect(204);
    const realCode = mailer.lastCodeFor(userBEmail);
    expect(realCode).toMatch(/^\d{6}$/);

    // A deliberately wrong 6-digit code (differs from the real one).
    const wrong = realCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await request(server())
        .post('/auth/reset-password')
        .send({ email: userBEmail, code: wrong, newPassword: newPass })
        .expect(401);
    }

    // The correct code is now burned → still 401.
    await request(server())
      .post('/auth/reset-password')
      .send({ email: userBEmail, code: realCode, newPassword: newPass })
      .expect(401);

    // userB's original password is unchanged.
    await request(server())
      .post('/auth/login')
      .send({ email: userBEmail, password: oldPass })
      .expect(200);
  });

  it('rejects malformed input with 400 (validation, pre-lookup)', async () => {
    await request(server())
      .post('/auth/reset-password')
      .send({ email: userAEmail, code: '12', newPassword: 'short' })
      .expect(400);
  });
});

describe('Password reset throttling (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await buildModule(new FakeMailer());
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('throttles forgot-password after 3 requests (429 on the 4th)', async () => {
    const email = `throttle_${Date.now()}@e2e.local`;
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email })
        .expect(204);
    }
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(429);
  });
});
```

- [ ] **Step 2: Apply the migration (if not already applied)**

Run: `pnpm db:migrate`
Expected: `password_reset_codes` created in the target database.

- [ ] **Step 3: Run the e2e**

Run: `pnpm test:e2e -- password-reset.e2e`
Expected: all tests PASS (Postgres + Redis must be up on the `.env` ports).

- [ ] **Step 4: Commit**

```bash
git add test/password-reset.e2e-spec.ts
git commit -m "test(auth): e2e for forgot-password/reset flow, lockout, throttle"
```

---

## Coverage & Notes

**Spec → task mapping**

- Email module structure, types, `NoActiveEmailConfigError` — Tasks 1, 2, 3, 5.
- SMTP send seam (`MailerService`) — Tasks 2, 5.
- Full IMAP receive (`InboxService`: verify/list/fetch+parse/flags) — Tasks 3, 5.
- Active-config resolution, dependency direction (infra-only) — Task 4.
- System/mastra refactor (drop `sendActive`, delete testers, delegate `test()`) — Task 6.
- `password_reset_codes` table + HMAC-pepper storage — Tasks 7, 9.
- Config/env (`PASSWORD_RESET_PEPPER`, `passwordReset` block) — Task 8.
- Single-active code, verify/lockout lifecycle, revoke-all, confirmation, enumeration-safe uniform `401` — Tasks 10, 11, 12.
- Public throttled endpoints, DTO validation `400` — Task 13.
- Full-suite gate + e2e (happy path, unknown email, lockout, validation `400`, throttle `429`) — Tasks 14, 15.

**Known limitations / deferred (per the design's §15):**

- **IMAP real-API validation:** unit tests mock `imapflow`/`mailparser`, so the transport's correctness against a live server is not exercised by CI (no inbound consumer yet). Validate `InboxService` manually against a real/greenmail IMAP mailbox before relying on it. Confirm the `imapflow`/`mailparser` typings match the mappings in Task 3 during implementation.
- **Expired-code path** is covered by the Task 12 unit test (injected past `expiresAt`), not e2e (no time-travel in the HTTP flow).
- No IMAP HTTP endpoint / poller, no pooled IMAP connection, no expired-code sweep job, no password-history check — all deferred.
- **Timing equalization** on `reset` uses a matched HMAC (`DECOY_CODE_HASH`) on the failure paths; residual DB-query-count differences between "unknown email" and "wrong code" are accepted for v1.




