# Durable Inbound Email Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist inbound IMAP email durably (Postgres + MinIO), keep MeiliSearch in sync, and expose an admin inbox API — via a new `features/mailbox` feature that composes existing seams.

**Architecture:** A BullMQ-scheduled + manually-triggerable sync pulls new messages from the active IMAP account (via additive `InboxService` methods), persists each message + attachments (bytes → MinIO through `FileService`, rows → Postgres in one transaction), then upserts a search document through the existing `SearchRecordService` outbox. Postgres is the source of truth; Meili is a rebuildable read model; the inbox read API serves entirely from Postgres. `infrastructure/email` stays a thin transport seam (additive changes only).

**Tech Stack:** NestJS 10, Drizzle ORM (node-postgres), BullMQ (`@nestjs/bullmq`), `imapflow` + `mailparser`, MinIO (via `FileService`), MeiliSearch (via `SearchRecordService`), Zod DTOs, Jest (`@swc/jest`).

## Global Constraints

- Keep files under 500 lines; one clear responsibility per file.
- Follow existing feature layout (`features/file-processor`, `features/search-service`): repository extends `BaseRepository`, service(s), BullMQ processor (`WorkerHost`) + scheduler, Zod DTOs, `@Roles('admin')` controllers.
- **No `Co-Authored-By` trailer** on commits (project rule; `attribution.commit` is not set).
- Datastores use the ports from `.env` (Postgres :30898 / Redis :30490), **not** docker defaults :5432/:6379.
- E2E specs must boot **module subsets**, never `AppModule` (Mastra ESM dep breaks Jest).
- MeiliSearch client is pinned to CJS 0.45.x — do not upgrade.
- Soft-delete convention: `isDeleted=true` + `deletedAt=now()`; never hard-delete email rows (archive retention).
- Secrets are already decrypted by `EmailConfigRepository`; never log message bodies or credentials.
- Build + test gate: `cd api && npm run build && npm test` must pass before a task is done.

---

### Task 1: Schema — `mailbox.schema.ts` (3 tables) + migration

**Files:**
- Create: `api/src/infrastructure/database/schema/mailbox.schema.ts`
- Modify: `api/src/infrastructure/database/schema/index.ts` (add barrel export)
- Test: `api/src/infrastructure/database/schema/mailbox.schema.spec.ts`

**Interfaces:**
- Produces: tables `emailMessages`, `emailAttachments`, `emailSyncState`; row types `EmailMessageRow`, `NewEmailMessageRow`, `EmailAttachmentRow`, `NewEmailAttachmentRow`, `EmailSyncStateRow`, `NewEmailSyncStateRow`.

- [ ] **Step 1: Write the failing test**

```typescript
// api/src/infrastructure/database/schema/mailbox.schema.spec.ts
import {
  emailAttachments,
  emailMessages,
  emailSyncState,
} from './mailbox.schema';

describe('mailbox.schema', () => {
  it('defines the three inbound-email tables', () => {
    expect(emailMessages).toBeDefined();
    expect(emailAttachments).toBeDefined();
    expect(emailSyncState).toBeDefined();
  });

  it('email_messages carries the IMAP identity + local-state columns', () => {
    const cols = emailMessages as unknown as Record<string, unknown>;
    for (const c of [
      'accountId', 'mailbox', 'uid', 'uidValidity', 'messageId', 'threadId',
      'fromAddress', 'subject', 'receivedAt', 'snippet', 'bodyText', 'seen',
      'hasAttachments', 'rawFileId',
    ]) {
      expect(cols[c]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/infrastructure/database/schema/mailbox.schema.spec.ts`
Expected: FAIL — cannot find module `./mailbox.schema`.

- [ ] **Step 3: Create the schema**

```typescript
// api/src/infrastructure/database/schema/mailbox.schema.ts
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';

/** One address as parsed from a message header. */
export interface EmailAddress {
  address: string;
  name: string | null;
}

/**
 * A durably persisted inbound message. Postgres is the source of truth; Meili is
 * a rebuildable read model. Never hard-deleted (soft-delete = archive retention).
 * Stable identity is (accountId, mailbox, uidValidity, uid).
 */
export const emailMessages = pgTable(
  'email_messages',
  {
    ...baseColumns,
    accountId: uuid('account_id').notNull(),
    mailbox: varchar('mailbox', { length: 255 }).notNull().default('INBOX'),
    uid: integer('uid').notNull(),
    uidValidity: bigint('uid_validity', { mode: 'number' }).notNull(),
    messageId: varchar('message_id', { length: 998 }),
    inReplyTo: varchar('in_reply_to', { length: 998 }),
    references: text('references'),
    threadId: varchar('thread_id', { length: 998 }),
    fromAddress: varchar('from_address', { length: 320 }).notNull().default(''),
    fromName: varchar('from_name', { length: 255 }),
    toAddresses: jsonb('to_addresses').$type<EmailAddress[]>().notNull().default([]),
    ccAddresses: jsonb('cc_addresses').$type<EmailAddress[]>().notNull().default([]),
    subject: text('subject').notNull().default(''),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    snippet: varchar('snippet', { length: 280 }).notNull().default(''),
    bodyText: text('body_text').notNull().default(''),
    bodyHtml: text('body_html'),
    sizeBytes: integer('size_bytes'),
    seen: boolean('seen').notNull().default(false),
    flagged: boolean('flagged').notNull().default(false),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    rawFileId: uuid('raw_file_id'),
  },
  (t) => [
    uniqueIndex('email_messages_identity_idx')
      .on(t.accountId, t.mailbox, t.uidValidity, t.uid)
      .where(sql`${t.isDeleted} = false`),
    index('email_messages_list_idx').on(t.accountId, t.mailbox, t.receivedAt),
    index('email_messages_message_id_idx').on(t.messageId),
    index('email_messages_thread_idx').on(t.threadId),
    index('email_messages_seen_idx').on(t.accountId, t.seen),
  ],
);

/** Join from a message to its MinIO-backed attachment bytes (the `files` table). */
export const emailAttachments = pgTable(
  'email_attachments',
  {
    ...baseColumns,
    emailId: uuid('email_id').notNull(),
    fileId: uuid('file_id').notNull(),
    filename: varchar('filename', { length: 512 }),
    contentType: varchar('content_type', { length: 255 }).notNull(),
    size: integer('size').notNull(),
    contentId: varchar('content_id', { length: 255 }),
    inline: boolean('inline').notNull().default(false),
  },
  (t) => [index('email_attachments_email_idx').on(t.emailId)],
);

/** Per-(account, mailbox) incremental-sync cursor. */
export const emailSyncState = pgTable(
  'email_sync_state',
  {
    ...baseColumns,
    accountId: uuid('account_id').notNull(),
    mailbox: varchar('mailbox', { length: 255 }).notNull().default('INBOX'),
    uidValidity: bigint('uid_validity', { mode: 'number' }),
    lastSeenUid: integer('last_seen_uid').notNull().default(0),
    lastSyncStartedAt: timestamp('last_sync_started_at', { withTimezone: true }),
    lastSyncFinishedAt: timestamp('last_sync_finished_at', { withTimezone: true }),
    lastStatus: varchar('last_status', { length: 50 }),
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('email_sync_state_account_mailbox_idx')
      .on(t.accountId, t.mailbox)
      .where(sql`${t.isDeleted} = false`),
  ],
);

export type EmailMessageRow = typeof emailMessages.$inferSelect;
export type NewEmailMessageRow = typeof emailMessages.$inferInsert;
export type EmailAttachmentRow = typeof emailAttachments.$inferSelect;
export type NewEmailAttachmentRow = typeof emailAttachments.$inferInsert;
export type EmailSyncStateRow = typeof emailSyncState.$inferSelect;
export type NewEmailSyncStateRow = typeof emailSyncState.$inferInsert;
```

- [ ] **Step 4: Add the barrel export**

In `api/src/infrastructure/database/schema/index.ts`, add after the `system.schema` line:

```typescript
export * from './mailbox.schema';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && npx jest src/infrastructure/database/schema/mailbox.schema.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Generate the migration**

Run: `cd api && pnpm db:generate`
Expected: a new SQL migration file appears under the drizzle migrations dir creating `email_messages`, `email_attachments`, `email_sync_state` and their indexes. (A non-standard `vestauth` banner in the output is a known dev-tooling quirk — ignore it.)

- [ ] **Step 7: Commit**

```bash
cd /home/avarile/Documents/codeRepo/ai/Cybernetics
git add api/src/infrastructure/database/schema/mailbox.schema.ts \
        api/src/infrastructure/database/schema/mailbox.schema.spec.ts \
        api/src/infrastructure/database/schema/index.ts \
        api/drizzle
git commit -m "feat(mailbox): add inbound-email persistence schema + migration"
```

---

### Task 2: Constants + namespaced config

**Files:**
- Create: `api/src/features/mailbox/mailbox.constants.ts`
- Create: `api/src/config/configurations/mailbox.config.ts`
- Modify: `api/src/config/config.module.ts` (register `mailboxConfig` in `load`)
- Test: `api/src/config/configurations/mailbox.config.spec.ts`

**Interfaces:**
- Produces: `MAILBOX_SYNC_QUEUE`, `SYNC_MAILBOX_JOB`, `INBOUND_EMAIL_COLLECTION` constants; `mailboxConfig` (`registerAs('mailbox')`) and `MailboxConfig` type with fields `pollIntervalMs: number`, `batchCap: number`, `storeRaw: boolean`, `pushFlags: boolean`, `defaultAccountId: string | null`, `mailbox: string`.

- [ ] **Step 1: Write the failing test**

```typescript
// api/src/config/configurations/mailbox.config.spec.ts
import { mailboxConfig } from './mailbox.config';

describe('mailboxConfig', () => {
  const OLD = process.env;
  afterEach(() => { process.env = OLD; });

  it('applies sane defaults when env is unset', () => {
    process.env = { ...OLD };
    delete process.env.MAILBOX_POLL_INTERVAL_MS;
    delete process.env.MAILBOX_BATCH_CAP;
    delete process.env.MAILBOX_STORE_RAW;
    delete process.env.MAILBOX_PUSH_FLAGS;
    const cfg = mailboxConfig();
    expect(cfg.pollIntervalMs).toBe(300_000);
    expect(cfg.batchCap).toBe(200);
    expect(cfg.storeRaw).toBe(true);
    expect(cfg.pushFlags).toBe(false);
    expect(cfg.mailbox).toBe('INBOX');
  });

  it('reads overrides from env', () => {
    process.env = { ...OLD, MAILBOX_BATCH_CAP: '50', MAILBOX_STORE_RAW: 'false' };
    const cfg = mailboxConfig();
    expect(cfg.batchCap).toBe(50);
    expect(cfg.storeRaw).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/config/configurations/mailbox.config.spec.ts`
Expected: FAIL — cannot find module `./mailbox.config`.

- [ ] **Step 3: Create the constants**

```typescript
// api/src/features/mailbox/mailbox.constants.ts
/** BullMQ queue that runs inbound-mail sync off the request path. */
export const MAILBOX_SYNC_QUEUE = 'mailbox-sync';

/** Job: pull new messages for one (accountId, mailbox) into the store. */
export const SYNC_MAILBOX_JOB = 'sync-mailbox';

/** The system-owned MeiliSearch collection inbound mail is indexed into. */
export const INBOUND_EMAIL_COLLECTION = 'inbound_email';

/** Shared BullMQ options for sync jobs: bounded retries, self-cleaning. */
export const SYNC_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 100,
} as const;
```

- [ ] **Step 4: Create the config**

```typescript
// api/src/config/configurations/mailbox.config.ts
import { registerAs } from '@nestjs/config';

/**
 * Namespaced mailbox-ingestion config. Read directly from process.env with safe
 * defaults (these are operational tunables, not required boot secrets), so the
 * global env schema stays unchanged. Consumed by the mailbox feature.
 */
export const mailboxConfig = registerAs('mailbox', () => ({
  pollIntervalMs: intEnv('MAILBOX_POLL_INTERVAL_MS', 300_000),
  batchCap: intEnv('MAILBOX_BATCH_CAP', 200),
  storeRaw: boolEnv('MAILBOX_STORE_RAW', true),
  pushFlags: boolEnv('MAILBOX_PUSH_FLAGS', false),
  defaultAccountId: process.env.MAILBOX_DEFAULT_ACCOUNT_ID ?? null,
  mailbox: process.env.MAILBOX_DEFAULT_MAILBOX ?? 'INBOX',
}));

export type MailboxConfig = ReturnType<typeof mailboxConfig>;

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}
```

- [ ] **Step 5: Register the config**

In `api/src/config/config.module.ts`: add the import next to the others and append `mailboxConfig` to the `load: [...]` array.

```typescript
import { mailboxConfig } from './configurations/mailbox.config';
// ...in load: [ ...existing, mailboxConfig ],
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd api && npx jest src/config/configurations/mailbox.config.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add api/src/features/mailbox/mailbox.constants.ts \
        api/src/config/configurations/mailbox.config.ts \
        api/src/config/configurations/mailbox.config.spec.ts \
        api/src/config/config.module.ts
git commit -m "feat(mailbox): add queue/collection constants and namespaced config"
```

---

### Task 3: Types + pure utilities (threadId, snippet, address flattening, search doc)

**Files:**
- Create: `api/src/features/mailbox/mailbox.types.ts`
- Create: `api/src/features/mailbox/mailbox.util.ts`
- Test: `api/src/features/mailbox/mailbox.util.spec.ts`

**Interfaces:**
- Produces:
  - `mailbox.types.ts`: `MessageSummary`, `MessageDetail`, `AttachmentView` interfaces (public API shapes).
  - `mailbox.util.ts`:
    - `computeThreadId(references: string | null, inReplyTo: string | null, messageId: string | null, fallback: string): string`
    - `makeSnippet(text: string, max?: number): string`
    - `normalizeReferences(refs: string | string[] | undefined): string | null`
    - `toSearchDocument(row: EmailMessageRow): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

```typescript
// api/src/features/mailbox/mailbox.util.spec.ts
import type { EmailMessageRow } from '../../infrastructure/database/schema/mailbox.schema';
import {
  computeThreadId,
  makeSnippet,
  normalizeReferences,
  toSearchDocument,
} from './mailbox.util';

describe('mailbox.util', () => {
  it('computeThreadId prefers the References root', () => {
    expect(computeThreadId('<root@x> <mid@x>', '<mid@x>', '<self@x>', 'fb'))
      .toBe('<root@x>');
  });
  it('computeThreadId falls back to In-Reply-To, then Message-ID, then fallback', () => {
    expect(computeThreadId(null, '<parent@x>', '<self@x>', 'fb')).toBe('<parent@x>');
    expect(computeThreadId(null, null, '<self@x>', 'fb')).toBe('<self@x>');
    expect(computeThreadId(null, null, null, 'fb')).toBe('fb');
  });
  it('makeSnippet collapses whitespace and caps length', () => {
    expect(makeSnippet('  a\n\n b   c ')).toBe('a b c');
    expect(makeSnippet('x'.repeat(400)).length).toBe(280);
  });
  it('normalizeReferences joins arrays and trims', () => {
    expect(normalizeReferences(['<a@x>', '<b@x>'])).toBe('<a@x> <b@x>');
    expect(normalizeReferences('<a@x>')).toBe('<a@x>');
    expect(normalizeReferences(undefined)).toBeNull();
  });
  it('toSearchDocument projects the searchable fields with epoch timestamps', () => {
    const row = {
      id: 'id-1', accountId: 'acc-1', mailbox: 'INBOX',
      subject: 'Hi', bodyText: 'body', fromAddress: 'a@x.com', fromName: 'A',
      threadId: '<root@x>', seen: false, flagged: false,
      receivedAt: new Date('2020-01-02T00:00:00Z'),
      sentAt: new Date('2020-01-01T00:00:00Z'),
    } as unknown as EmailMessageRow;
    expect(toSearchDocument(row)).toEqual({
      subject: 'Hi', bodyText: 'body', fromAddress: 'a@x.com', fromName: 'A',
      mailbox: 'INBOX', threadId: '<root@x>', accountId: 'acc-1',
      seen: false, flagged: false,
      receivedAt: new Date('2020-01-02T00:00:00Z').getTime(),
      sentAt: new Date('2020-01-01T00:00:00Z').getTime(),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/features/mailbox/mailbox.util.spec.ts`
Expected: FAIL — cannot find module `./mailbox.util`.

- [ ] **Step 3: Create the types**

```typescript
// api/src/features/mailbox/mailbox.types.ts
import type { EmailAddress } from '../../infrastructure/database/schema/mailbox.schema';

/** One row in the inbox list view. */
export interface MessageSummary {
  id: string;
  mailbox: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  receivedAt: Date;
  seen: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  threadId: string | null;
}

/** An attachment as returned to the API (bytes fetched via a separate download call). */
export interface AttachmentView {
  id: string;
  filename: string | null;
  contentType: string;
  size: number;
  inline: boolean;
}

/** The full message read view. */
export interface MessageDetail extends MessageSummary {
  to: EmailAddress[];
  cc: EmailAddress[];
  sentAt: Date | null;
  bodyText: string;
  bodyHtml: string | null;
  attachments: AttachmentView[];
}
```

- [ ] **Step 4: Create the utilities**

```typescript
// api/src/features/mailbox/mailbox.util.ts
import type { EmailMessageRow } from '../../infrastructure/database/schema/mailbox.schema';
import { INBOUND_EMAIL_COLLECTION } from './mailbox.constants';

/** First `<...>` token in a whitespace-separated Message-ID list, else the raw trimmed value. */
function firstToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/<[^>]+>/);
  return match ? match[0] : trimmed.split(/\s+/)[0];
}

/**
 * Thread key: root of the References chain, else the In-Reply-To target, else the
 * message's own Message-ID, else a caller-supplied fallback (never empty).
 */
export function computeThreadId(
  references: string | null,
  inReplyTo: string | null,
  messageId: string | null,
  fallback: string,
): string {
  if (references) {
    const root = firstToken(references);
    if (root) return root;
  }
  if (inReplyTo) {
    const t = firstToken(inReplyTo);
    if (t) return t;
  }
  if (messageId) {
    const t = firstToken(messageId);
    if (t) return t;
  }
  return fallback;
}

/** Single-line preview: collapse all whitespace runs to one space, trim, cap length. */
export function makeSnippet(text: string, max = 280): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** mailparser gives References as string | string[]; normalize to a space-joined string. */
export function normalizeReferences(
  refs: string | string[] | undefined,
): string | null {
  if (!refs) return null;
  const joined = Array.isArray(refs) ? refs.join(' ') : refs;
  const trimmed = joined.trim();
  return trimmed.length ? trimmed : null;
}

/** Project a message row into the Meili document for the inbound_email collection. */
export function toSearchDocument(row: EmailMessageRow): Record<string, unknown> {
  return {
    subject: row.subject,
    bodyText: row.bodyText,
    fromAddress: row.fromAddress,
    fromName: row.fromName ?? null,
    mailbox: row.mailbox,
    threadId: row.threadId,
    accountId: row.accountId,
    seen: row.seen,
    flagged: row.flagged,
    receivedAt: row.receivedAt.getTime(),
    sentAt: row.sentAt ? row.sentAt.getTime() : null,
  };
}

/** Re-exported so consumers don't reach into constants for the collection name. */
export const SEARCH_COLLECTION = INBOUND_EMAIL_COLLECTION;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && npx jest src/features/mailbox/mailbox.util.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/features/mailbox/mailbox.types.ts \
        api/src/features/mailbox/mailbox.util.ts \
        api/src/features/mailbox/mailbox.util.spec.ts
git commit -m "feat(mailbox): add public types and pure ingestion utilities"
```

---

### Task 4: Additive IMAP ingestion methods on `infrastructure/email`

**Files:**
- Modify: `api/src/infrastructure/email/email.types.ts` (add `MailboxState`, `IngestAttachment`, `IngestMessage`)
- Modify: `api/src/infrastructure/email/transport/imap.transport.ts` (add `mailboxState`, `listUidsSince`, `fetchForIngest`)
- Modify: `api/src/infrastructure/email/inbox.service.ts` (add wrapper methods)
- Test: `api/src/infrastructure/email/transport/imap.transport.spec.ts` (extend)

**Interfaces:**
- Consumes: existing `withClient`, `ImapConn`, `addressText`.
- Produces:
  - `email.types.ts`: `MailboxState { uidValidity: number; uidNext: number }`, `IngestAttachment { filename: string | null; contentType: string; size: number; contentId: string | null; inline: boolean; content: Buffer }`, `IngestMessage { uid: number; raw: Buffer; messageId: string | null; inReplyTo: string | null; references: string | string[] | undefined; from: { address: string; name: string | null }; to: { address: string; name: string | null }[]; cc: { address: string; name: string | null }[]; subject: string; sentAt: Date | null; text: string; html: string | null; seen: boolean; sizeBytes: number; attachments: IngestAttachment[] }`
  - `imap.transport.ts`: `mailboxState(conn, mailbox?)`, `listUidsSince(conn, sinceUid, opts?)`, `fetchForIngest(conn, uid, mailbox?)`
  - `inbox.service.ts`: `InboxService.mailboxState(mailbox?)`, `InboxService.listUidsSince(sinceUid, opts?)`, `InboxService.fetchForIngest(uid, mailbox?)`

- [ ] **Step 1: Write the failing tests (extend the existing spec)**

Append these to `api/src/infrastructure/email/transport/imap.transport.spec.ts`. Add `mailboxState`, `listUidsSince`, `fetchForIngest` to the import from `./imap.transport`, and add `status: jest.fn()` to the `makeClient` overrides default object.

```typescript
  it('mailboxState returns server uidValidity + uidNext', async () => {
    currentClient.status = jest.fn(async () => ({ uidValidity: 42, uidNext: 99 }));
    const res = await mailboxState(conn, 'INBOX');
    expect(currentClient.status).toHaveBeenCalledWith('INBOX', {
      uidValidity: true,
      uidNext: true,
    });
    expect(res).toEqual({ uidValidity: 42, uidNext: 99 });
  });

  it('listUidsSince returns only UIDs strictly greater than the cursor, sorted, capped', async () => {
    currentClient.search = jest.fn(async () => [3, 5, 4, 2]); // 2 is <= cursor (IMAP N:* quirk)
    const res = await listUidsSince(conn, 2, { limit: 2 });
    expect(res).toEqual([3, 4]);
  });

  it('fetchForIngest returns raw source + parsed fields + attachment buffers', async () => {
    const raw = Buffer.from('raw-mime');
    const content = Buffer.from('PDFBYTES');
    currentClient.fetchOne.mockResolvedValue({
      uid: 7, source: raw, size: 1234, flags: new Set(['\\Seen']),
    });
    simpleParserMock.mockResolvedValue({
      messageId: '<m@x>', inReplyTo: '<p@x>', references: ['<r@x>', '<p@x>'],
      from: { value: [{ address: 'a@x.com', name: 'A' }] },
      to: [{ text: 'b@x.com', value: [{ address: 'b@x.com', name: 'B' }] }],
      cc: undefined, subject: 'Hi', date: new Date('2020-01-01'),
      text: 'plain', html: '<p>rich</p>',
      attachments: [{
        filename: 'f.pdf', contentType: 'application/pdf', size: 8,
        content, cid: 'cid-1', contentDisposition: 'attachment',
      }],
    });
    const res = await fetchForIngest(conn, 7);
    expect(res?.raw).toBe(raw);
    expect(res?.seen).toBe(true);
    expect(res?.from).toEqual({ address: 'a@x.com', name: 'A' });
    expect(res?.to).toEqual([{ address: 'b@x.com', name: 'B' }]);
    expect(res?.attachments[0]).toEqual({
      filename: 'f.pdf', contentType: 'application/pdf', size: 8,
      contentId: 'cid-1', inline: false, content,
    });
  });

  it('fetchForIngest returns null when the message is missing', async () => {
    currentClient.fetchOne.mockResolvedValue(false);
    expect(await fetchForIngest(conn, 999)).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/infrastructure/email/transport/imap.transport.spec.ts`
Expected: FAIL — `mailboxState`/`listUidsSince`/`fetchForIngest` are not exported.

- [ ] **Step 3: Add the types**

Append to `api/src/infrastructure/email/email.types.ts`:

```typescript
/** Mailbox status probe result used to drive incremental sync. */
export interface MailboxState {
  uidValidity: number;
  uidNext: number;
}

/** A parsed attachment including its raw bytes (for persistence). */
export interface IngestAttachment {
  filename: string | null;
  contentType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
  content: Buffer;
}

/** A fetched message with everything the persistence layer needs. */
export interface IngestMessage {
  uid: number;
  raw: Buffer;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | string[] | undefined;
  from: { address: string; name: string | null };
  to: { address: string; name: string | null }[];
  cc: { address: string; name: string | null }[];
  subject: string;
  sentAt: Date | null;
  text: string;
  html: string | null;
  seen: boolean;
  sizeBytes: number;
  attachments: IngestAttachment[];
}
```

- [ ] **Step 4: Add the transport functions**

Append to `api/src/infrastructure/email/transport/imap.transport.ts` (add `IngestAttachment`, `IngestMessage`, `MailboxState` to the type import from `../email.types`, and import `AddressObject` is already present):

```typescript
/** Probe a mailbox for its current UIDVALIDITY + UIDNEXT (no lock needed). */
export async function mailboxState(
  conn: ImapConn,
  mailbox = 'INBOX',
): Promise<MailboxState> {
  return withClient(conn, async (client) => {
    const status = await client.status(mailbox, {
      uidValidity: true,
      uidNext: true,
    });
    return {
      uidValidity: Number(status.uidValidity ?? 0),
      uidNext: Number(status.uidNext ?? 0),
    };
  });
}

/**
 * UIDs strictly greater than `sinceUid`, ascending, capped at `limit` (default
 * 200). The `${since+1}:*` range can echo the highest existing UID even when
 * none are newer (an IMAP quirk), so we filter `> sinceUid` defensively.
 */
export async function listUidsSince(
  conn: ImapConn,
  sinceUid: number,
  opts?: { mailbox?: string; limit?: number },
): Promise<number[]> {
  const mailbox = opts?.mailbox ?? 'INBOX';
  const limit = opts?.limit ?? 200;
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const found = await client.search(
        { uid: `${sinceUid + 1}:*` },
        { uid: true },
      );
      const uids = (found ?? [])
        .filter((u) => u > sinceUid)
        .sort((a, b) => a - b);
      return uids.slice(0, limit);
    } finally {
      lock.release();
    }
  });
}

function toAddr(a: { address?: string; name?: string }): {
  address: string;
  name: string | null;
} {
  return { address: a.address ?? '', name: a.name ? a.name : null };
}

function addrList(
  addr: AddressObject | AddressObject[] | undefined,
): { address: string; name: string | null }[] {
  if (!addr) return [];
  const objs = Array.isArray(addr) ? addr : [addr];
  return objs.flatMap((o) => (o.value ?? []).map(toAddr));
}

/** Fetch one message's raw source + parsed fields + attachment buffers by UID. */
export async function fetchForIngest(
  conn: ImapConn,
  uid: number,
  mailbox = 'INBOX',
): Promise<IngestMessage | null> {
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(
        uid,
        { uid: true, source: true, flags: true, size: true },
        { uid: true },
      );
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      const from = parsed.from?.value?.[0];
      const attachments: IngestAttachment[] = parsed.attachments.map((a) => ({
        filename: a.filename ?? null,
        contentType: a.contentType,
        size: a.size,
        contentId: a.cid ?? null,
        inline: a.contentDisposition === 'inline' || Boolean(a.related),
        content: a.content,
      }));
      return {
        uid,
        raw: msg.source,
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: parsed.references,
        from: from ? toAddr(from) : { address: '', name: null },
        to: addrList(parsed.to),
        cc: addrList(parsed.cc),
        subject: parsed.subject ?? '',
        sentAt: parsed.date ?? null,
        text: parsed.text ?? '',
        html: typeof parsed.html === 'string' ? parsed.html : null,
        seen: msg.flags?.has('\\Seen') ?? false,
        sizeBytes: Number(msg.size ?? msg.source.length),
        attachments,
      };
    } finally {
      lock.release();
    }
  });
}
```

- [ ] **Step 5: Add the `InboxService` wrappers**

In `api/src/infrastructure/email/inbox.service.ts`, add to the transport import and add methods:

```typescript
// add to the import from './transport/imap.transport':
//   fetchForIngest, listUidsSince, mailboxState
// add to the type import from './email.types':
//   type IngestMessage, type MailboxState

  async mailboxState(mailbox?: string): Promise<MailboxState> {
    return mailboxState(await this.conn(), mailbox);
  }

  async listUidsSince(
    sinceUid: number,
    opts?: { mailbox?: string; limit?: number },
  ): Promise<number[]> {
    return listUidsSince(await this.conn(), sinceUid, opts);
  }

  async fetchForIngest(uid: number, mailbox?: string): Promise<IngestMessage | null> {
    return fetchForIngest(await this.conn(), uid, mailbox);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd api && npx jest src/infrastructure/email/transport/imap.transport.spec.ts`
Expected: PASS (all existing + 4 new tests).

- [ ] **Step 7: Commit**

```bash
git add api/src/infrastructure/email/email.types.ts \
        api/src/infrastructure/email/transport/imap.transport.ts \
        api/src/infrastructure/email/transport/imap.transport.spec.ts \
        api/src/infrastructure/email/inbox.service.ts
git commit -m "feat(email): add additive IMAP ingestion reads (state, uid-cursor, full fetch)"
```

---

### Task 5: `FileService` trusted-upload option (MIME allowlist bypass for internal ingestion)

**Files:**
- Modify: `api/src/features/file-processor/file.service.ts` (`DirectPutMeta.allowAnyMime`, `assertPolicy`)
- Test: `api/src/features/file-processor/file.service.spec.ts` (extend or create)

**Interfaces:**
- Consumes: existing `FileService.putFromStream`.
- Produces: `DirectPutMeta` gains optional `allowAnyMime?: boolean`; when true, `putFromStream` skips the MIME-allowlist check but STILL enforces `maxFileSize`.

**Why:** Inbound attachments are arbitrary MIME types; the default `assertPolicy` rejects anything off the storage allowlist. Internal, already-trusted ingestion needs a bypass. Size limits remain enforced (oversized attachments are skipped by the ingest caller in Task 7).

- [ ] **Step 1: Write the failing test**

If `file.service.spec.ts` exists, add these cases; otherwise create it with a minimal harness. Minimal harness:

```typescript
// api/src/features/file-processor/file.service.spec.ts  (add-only if it exists)
import { FileService } from './file.service';

function makeService(overrides: Partial<Record<string, any>> = {}) {
  const storage = {
    bucketName: () => 'bucket',
    putObject: jest.fn(async () => undefined),
    statObject: jest.fn(async () => ({ size: 8 })),
    ...overrides.storage,
  } as any;
  const repo = {
    create: jest.fn(async (v: any) => ({ id: 'file-1', ...v })),
    findAvailableByChecksum: jest.fn(async () => null),
  } as any;
  const queue = { add: jest.fn(async () => undefined) } as any;
  const config = {
    getOrThrow: () => ({
      maxFileSize: 10,
      allowedMimeTypes: ['application/pdf'],
      presignExpirySeconds: 60,
      pendingTtlSeconds: 3600,
    }),
  } as any;
  return { svc: new FileService(storage, repo, queue, config), storage, repo };
}

const owner = { id: null, role: 'agent' } as any;

describe('FileService.putFromStream allowAnyMime', () => {
  it('rejects a disallowed MIME by default', async () => {
    const { svc } = makeService();
    await expect(
      svc.putFromStream(Buffer.from('x'), { filename: 'a.bin', mimeType: 'application/zip', size: 4 }, owner),
    ).rejects.toThrow(/not allowed/);
  });

  it('accepts a disallowed MIME when allowAnyMime is set', async () => {
    const { svc, repo } = makeService();
    const res = await svc.putFromStream(
      Buffer.from('x'),
      { filename: 'a.bin', mimeType: 'application/zip', size: 4, allowAnyMime: true },
      owner,
    );
    expect(res.id).toBe('file-1');
    expect(repo.create).toHaveBeenCalled();
  });

  it('still enforces maxFileSize even with allowAnyMime', async () => {
    const { svc } = makeService();
    await expect(
      svc.putFromStream(Buffer.from('x'), { filename: 'a.bin', mimeType: 'application/zip', size: 9999, allowAnyMime: true }, owner),
    ).rejects.toThrow(/exceeds the maximum/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/features/file-processor/file.service.spec.ts -t allowAnyMime`
Expected: FAIL — `allowAnyMime` has no effect (disallowed MIME still throws in the second case).

- [ ] **Step 3: Implement the bypass**

In `api/src/features/file-processor/file.service.ts`:
- Add `allowAnyMime?: boolean;` to the `DirectPutMeta` interface.
- Change the `putFromStream` policy call from `this.assertPolicy(meta.mimeType, meta.size);` to `this.assertPolicy(meta.mimeType, meta.size, meta.allowAnyMime);`.
- Update `assertPolicy`:

```typescript
  private assertPolicy(
    mimeType: string,
    size?: number,
    allowAnyMime = false,
  ): void {
    if (!allowAnyMime && !isMimeAllowed(mimeType, this.allowedMimeTypes)) {
      throw new BadRequestException(`MIME type "${mimeType}" is not allowed`);
    }
    if (size !== undefined && size > this.maxFileSize) {
      throw new BadRequestException(
        `File size ${size} exceeds the maximum of ${this.maxFileSize} bytes`,
      );
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/features/file-processor/file.service.spec.ts -t allowAnyMime`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/features/file-processor/file.service.ts \
        api/src/features/file-processor/file.service.spec.ts
git commit -m "feat(file-processor): allow trusted internal uploads to bypass MIME allowlist"
```

---

### Task 6: `MailboxRepository`

**Files:**
- Create: `api/src/features/mailbox/mailbox.repository.ts`
- Test: `api/src/features/mailbox/mailbox.repository.spec.ts`

**Interfaces:**
- Consumes: `DRIZZLE`/`DrizzleDB`, `BaseRepository`, `emailMessages`, `emailAttachments`, `emailSyncState` and their row types.
- Produces:
  - `findByUid(accountId, mailbox, uidValidity, uid): Promise<EmailMessageRow | null>`
  - `insertMessageWithAttachments(message: NewEmailMessageRow, attachments: Omit<NewEmailAttachmentRow, 'emailId'>[]): Promise<EmailMessageRow>` (single transaction)
  - `listMessages(accountId, mailbox, page, limit, unseenOnly): Promise<{ rows: EmailMessageRow[]; total: number }>`
  - `findByIdWithAttachments(id): Promise<{ message: EmailMessageRow; attachments: EmailAttachmentRow[] } | null>`
  - `findAttachment(emailId, attachmentId): Promise<EmailAttachmentRow | null>`
  - `setSeen(id, seen): Promise<EmailMessageRow | null>`
  - `getSyncState(accountId, mailbox): Promise<EmailSyncStateRow | null>`
  - `upsertSyncState(accountId, mailbox, patch: Partial<NewEmailSyncStateRow>): Promise<EmailSyncStateRow>`

- [ ] **Step 1: Write the failing test**

Mirror `email-config.repository.spec.ts`'s chainable-db-mock style. This test covers the query-shape-sensitive methods (`findByUid`, `listMessages`) and the transaction wiring.

```typescript
// api/src/features/mailbox/mailbox.repository.spec.ts
import { MailboxRepository } from './mailbox.repository';

function selectChain(result: any[]) {
  const chain: any = {
    from: jest.fn(() => chain),
    where: jest.fn(() => chain),
    orderBy: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    offset: jest.fn(async () => result),
  };
  // allow `await select().from().where().limit()` (no offset) too:
  chain.limit = jest.fn(() => Object.assign(Promise.resolve(result), chain));
  return chain;
}

describe('MailboxRepository', () => {
  it('findByUid filters and returns the row or null', async () => {
    const row = { id: 'm1' };
    const db: any = { select: jest.fn(() => selectChain([row])) };
    const repo = new MailboxRepository(db);
    expect(await repo.findByUid('acc', 'INBOX', 1, 7)).toEqual(row);
  });

  it('insertMessageWithAttachments runs inside one transaction', async () => {
    const inserted = { id: 'm1' };
    const tx: any = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({ returning: jest.fn(async () => [inserted]) })),
      })),
    };
    const db: any = { transaction: jest.fn(async (fn: any) => fn(tx)) };
    const repo = new MailboxRepository(db);
    const res = await repo.insertMessageWithAttachments(
      { accountId: 'acc', mailbox: 'INBOX', uid: 7, uidValidity: 1, receivedAt: new Date() } as any,
      [{ fileId: 'f1', contentType: 'application/pdf', size: 8 } as any],
    );
    expect(db.transaction).toHaveBeenCalled();
    expect(tx.insert).toHaveBeenCalledTimes(2); // message + attachment
    expect(res).toEqual(inserted);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/features/mailbox/mailbox.repository.spec.ts`
Expected: FAIL — cannot find module `./mailbox.repository`.

- [ ] **Step 3: Implement the repository**

```typescript
// api/src/features/mailbox/mailbox.repository.ts
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  emailAttachments,
  emailMessages,
  emailSyncState,
  type EmailAttachmentRow,
  type EmailMessageRow,
  type EmailSyncStateRow,
  type NewEmailAttachmentRow,
  type NewEmailMessageRow,
  type NewEmailSyncStateRow,
} from '../../infrastructure/database/schema/mailbox.schema';

@Injectable()
export class MailboxRepository extends BaseRepository<typeof emailMessages> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, emailMessages);
  }

  async findByUid(
    accountId: string,
    mailbox: string,
    uidValidity: number,
    uid: number,
  ): Promise<EmailMessageRow | null> {
    const rows = await this.db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.accountId, accountId),
          eq(emailMessages.mailbox, mailbox),
          eq(emailMessages.uidValidity, uidValidity),
          eq(emailMessages.uid, uid),
          eq(emailMessages.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Insert the message and its attachment rows atomically. */
  async insertMessageWithAttachments(
    message: NewEmailMessageRow,
    attachments: Omit<NewEmailAttachmentRow, 'emailId'>[],
  ): Promise<EmailMessageRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(emailMessages).values(message).returning();
      if (attachments.length) {
        await tx
          .insert(emailAttachments)
          .values(attachments.map((a) => ({ ...a, emailId: row.id })));
      }
      return row;
    });
  }

  async listMessages(
    accountId: string,
    mailbox: string,
    page: number,
    limit: number,
    unseenOnly: boolean,
  ): Promise<{ rows: EmailMessageRow[]; total: number }> {
    const conditions = [
      eq(emailMessages.accountId, accountId),
      eq(emailMessages.mailbox, mailbox),
      eq(emailMessages.isDeleted, false),
    ];
    if (unseenOnly) conditions.push(eq(emailMessages.seen, false));
    const where = and(...conditions);

    const rows = await this.db
      .select()
      .from(emailMessages)
      .where(where)
      .orderBy(desc(emailMessages.receivedAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(emailMessages)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async findByIdWithAttachments(
    id: string,
  ): Promise<{ message: EmailMessageRow; attachments: EmailAttachmentRow[] } | null> {
    const message = await this.findById(id);
    if (!message || message.isDeleted) return null;
    const attachments = await this.db
      .select()
      .from(emailAttachments)
      .where(eq(emailAttachments.emailId, id));
    return { message, attachments };
  }

  async findAttachment(
    emailId: string,
    attachmentId: string,
  ): Promise<EmailAttachmentRow | null> {
    const rows = await this.db
      .select()
      .from(emailAttachments)
      .where(
        and(
          eq(emailAttachments.id, attachmentId),
          eq(emailAttachments.emailId, emailId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async setSeen(id: string, seen: boolean): Promise<EmailMessageRow | null> {
    const rows = await this.db
      .update(emailMessages)
      .set({ seen })
      .where(eq(emailMessages.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async getSyncState(
    accountId: string,
    mailbox: string,
  ): Promise<EmailSyncStateRow | null> {
    const rows = await this.db
      .select()
      .from(emailSyncState)
      .where(
        and(
          eq(emailSyncState.accountId, accountId),
          eq(emailSyncState.mailbox, mailbox),
          eq(emailSyncState.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertSyncState(
    accountId: string,
    mailbox: string,
    patch: Partial<NewEmailSyncStateRow>,
  ): Promise<EmailSyncStateRow> {
    const existing = await this.getSyncState(accountId, mailbox);
    if (existing) {
      const [row] = await this.db
        .update(emailSyncState)
        .set(patch)
        .where(eq(emailSyncState.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(emailSyncState)
      .values({ accountId, mailbox, ...patch })
      .returning();
    return row;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/features/mailbox/mailbox.repository.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/features/mailbox/mailbox.repository.ts \
        api/src/features/mailbox/mailbox.repository.spec.ts
git commit -m "feat(mailbox): add repository (idempotent upsert, paged reads, sync cursor)"
```

---

### Task 7: `MailboxIngestService` (sync orchestration)

**Files:**
- Create: `api/src/features/mailbox/mailbox-ingest.service.ts`
- Test: `api/src/features/mailbox/mailbox-ingest.service.spec.ts`

**Interfaces:**
- Consumes: `InboxService` (`mailboxState`, `listUidsSince`, `fetchForIngest`), `MailboxRepository`, `FileService.putFromStream`, `SearchRecordService.persist`, `SYSTEM_PRINCIPAL`, `MailboxConfig`, `mailbox.util`.
- Produces: `MailboxIngestService.sync(accountId: string, mailbox: string): Promise<{ processed: number; batchWasFull: boolean }>`.

**Behavior:** resolve cursor → probe mailbox → reset on UIDVALIDITY change → list new UIDs (capped at `batchCap`) → per UID (ascending): skip if already stored; else fetch, store raw (if `storeRaw`) + attachments (skip oversized) to MinIO, insert message+attachments in one tx, upsert the search doc, advance `lastSeenUid`. Marks sync_state `running`→`ok`; on throw, records `error` (cursor already advanced to the last success) and rethrows so BullMQ retries.

- [ ] **Step 1: Write the failing test**

```typescript
// api/src/features/mailbox/mailbox-ingest.service.spec.ts
import { MailboxIngestService } from './mailbox-ingest.service';

function deps(over: any = {}) {
  const inbox = {
    mailboxState: jest.fn(async () => ({ uidValidity: 10, uidNext: 5 })),
    listUidsSince: jest.fn(async () => [3, 4]),
    fetchForIngest: jest.fn(async (uid: number) => ({
      uid, raw: Buffer.from(`raw${uid}`), messageId: `<m${uid}>`, inReplyTo: null,
      references: undefined, from: { address: 'a@x.com', name: 'A' }, to: [], cc: [],
      subject: `s${uid}`, sentAt: new Date('2020-01-01'), text: 'body', html: null,
      seen: false, sizeBytes: 10, attachments: [],
    })),
    ...over.inbox,
  };
  const repo = {
    getSyncState: jest.fn(async () => null),
    upsertSyncState: jest.fn(async () => ({})),
    findByUid: jest.fn(async () => null),
    insertMessageWithAttachments: jest.fn(async (m: any) => ({ id: `id-${m.uid}`, ...m })),
    ...over.repo,
  };
  const files = { putFromStream: jest.fn(async () => ({ id: 'file-x' })) };
  const search = { persist: jest.fn(async () => []) };
  const config = { getOrThrow: () => ({ batchCap: 200, storeRaw: true, pushFlags: false }) };
  const svc = new MailboxIngestService(inbox as any, repo as any, files as any, search as any, config as any);
  return { svc, inbox, repo, files, search };
}

describe('MailboxIngestService.sync', () => {
  it('persists each new UID and advances the cursor', async () => {
    const { svc, repo, search } = deps();
    const res = await svc.sync('acc', 'INBOX');
    expect(res).toEqual({ processed: 2, batchWasFull: false });
    expect(repo.insertMessageWithAttachments).toHaveBeenCalledTimes(2);
    expect(search.persist).toHaveBeenCalledTimes(2);
    // final sync-state upsert marks ok with lastSeenUid = 4
    expect(repo.upsertSyncState).toHaveBeenLastCalledWith('acc', 'INBOX',
      expect.objectContaining({ lastStatus: 'ok', lastSeenUid: 4 }));
  });

  it('skips UIDs already persisted (idempotent)', async () => {
    const { svc, repo } = deps({ repo: { findByUid: jest.fn(async () => ({ id: 'exists' })) } });
    await svc.sync('acc', 'INBOX');
    expect(repo.insertMessageWithAttachments).not.toHaveBeenCalled();
  });

  it('resets the cursor when server UIDVALIDITY changed', async () => {
    const { svc, inbox } = deps({
      repo: { getSyncState: jest.fn(async () => ({ id: 's', uidValidity: 9, lastSeenUid: 100 })) },
    });
    await svc.sync('acc', 'INBOX');
    // listUidsSince called with 0 because stored uidValidity (9) != server (10)
    expect(inbox.listUidsSince).toHaveBeenCalledWith(0, expect.objectContaining({ mailbox: 'INBOX' }));
  });

  it('marks error and rethrows on failure', async () => {
    const { svc, repo } = deps({
      repo: { insertMessageWithAttachments: jest.fn(async () => { throw new Error('db down'); }) },
    });
    await expect(svc.sync('acc', 'INBOX')).rejects.toThrow('db down');
    expect(repo.upsertSyncState).toHaveBeenLastCalledWith('acc', 'INBOX',
      expect.objectContaining({ lastStatus: 'error' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/features/mailbox/mailbox-ingest.service.spec.ts`
Expected: FAIL — cannot find module `./mailbox-ingest.service`.

- [ ] **Step 3: Implement the service**

```typescript
// api/src/features/mailbox/mailbox-ingest.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailboxConfig } from '../../config/configurations/mailbox.config';
import { InboxService } from '../../infrastructure/email/inbox.service';
import { FileService } from '../file-processor/file.service';
import { SYSTEM_PRINCIPAL } from '../../common/principal';
import { SearchRecordService } from '../search-service/search-record.service';
import { INBOUND_EMAIL_COLLECTION } from './mailbox.constants';
import { MailboxRepository } from './mailbox.repository';
import type { NewEmailAttachmentRow } from '../../infrastructure/database/schema/mailbox.schema';
import type { IngestMessage } from '../../infrastructure/email/email.types';
import { computeThreadId, makeSnippet, normalizeReferences, toSearchDocument } from './mailbox.util';

@Injectable()
export class MailboxIngestService {
  private readonly logger = new Logger(MailboxIngestService.name);
  private readonly cfg: MailboxConfig;

  constructor(
    private readonly inbox: InboxService,
    private readonly repo: MailboxRepository,
    private readonly files: FileService,
    private readonly search: SearchRecordService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<MailboxConfig>('mailbox');
  }

  async sync(
    accountId: string,
    mailbox: string,
  ): Promise<{ processed: number; batchWasFull: boolean }> {
    await this.repo.upsertSyncState(accountId, mailbox, {
      lastStatus: 'running',
      lastSyncStartedAt: new Date(),
      lastError: null,
    });

    let lastSeenUid = 0;
    try {
      const state = await this.repo.getSyncState(accountId, mailbox);
      const server = await this.inbox.mailboxState(mailbox);
      const uidValidityChanged =
        state?.uidValidity != null && state.uidValidity !== server.uidValidity;
      lastSeenUid = uidValidityChanged ? 0 : (state?.lastSeenUid ?? 0);

      const uids = await this.inbox.listUidsSince(lastSeenUid, {
        mailbox,
        limit: this.cfg.batchCap,
      });

      let processed = 0;
      for (const uid of uids) {
        const already = await this.repo.findByUid(
          accountId,
          mailbox,
          server.uidValidity,
          uid,
        );
        if (!already) {
          const msg = await this.inbox.fetchForIngest(uid, mailbox);
          if (msg) {
            await this.persist(accountId, mailbox, server.uidValidity, msg);
            processed++;
          }
        }
        lastSeenUid = uid;
      }

      await this.repo.upsertSyncState(accountId, mailbox, {
        uidValidity: server.uidValidity,
        lastSeenUid,
        lastStatus: 'ok',
        lastSyncFinishedAt: new Date(),
        lastError: null,
      });
      return { processed, batchWasFull: uids.length >= this.cfg.batchCap };
    } catch (error) {
      await this.repo.upsertSyncState(accountId, mailbox, {
        lastSeenUid,
        lastStatus: 'error',
        lastSyncFinishedAt: new Date(),
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async persist(
    accountId: string,
    mailbox: string,
    uidValidity: number,
    msg: IngestMessage,
  ): Promise<void> {
    let rawFileId: string | null = null;
    if (this.cfg.storeRaw) {
      const raw = await this.files.putFromStream(
        msg.raw,
        {
          filename: `${msg.uid}.eml`,
          mimeType: 'message/rfc822',
          size: msg.raw.length,
          allowAnyMime: true,
          metadata: { kind: 'inbound-email-raw' },
        },
        SYSTEM_PRINCIPAL,
      );
      rawFileId = raw.id;
    }

    const attachmentRows: Omit<NewEmailAttachmentRow, 'emailId'>[] = [];
    for (const att of msg.attachments) {
      try {
        const file = await this.files.putFromStream(
          att.content,
          {
            filename: att.filename ?? 'attachment',
            mimeType: att.contentType,
            size: att.size,
            allowAnyMime: true,
            metadata: { kind: 'inbound-email-attachment' },
          },
          SYSTEM_PRINCIPAL,
        );
        attachmentRows.push({
          fileId: file.id,
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
          contentId: att.contentId,
          inline: att.inline,
        });
      } catch (error) {
        this.logger.warn(
          `Skipped attachment "${att.filename ?? 'attachment'}" (uid ${msg.uid}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const references = normalizeReferences(msg.references);
    const row = await this.repo.insertMessageWithAttachments(
      {
        accountId,
        mailbox,
        uid: msg.uid,
        uidValidity,
        messageId: msg.messageId,
        inReplyTo: msg.inReplyTo,
        references,
        threadId: computeThreadId(
          references,
          msg.inReplyTo,
          msg.messageId,
          `${accountId}:${mailbox}:${uidValidity}:${msg.uid}`,
        ),
        fromAddress: msg.from.address,
        fromName: msg.from.name,
        toAddresses: msg.to.map((a) => ({ address: a.address, name: a.name })),
        ccAddresses: msg.cc.map((a) => ({ address: a.address, name: a.name })),
        subject: msg.subject,
        sentAt: msg.sentAt,
        receivedAt: msg.sentAt ?? new Date(),
        snippet: makeSnippet(msg.text),
        bodyText: msg.text,
        bodyHtml: msg.html,
        sizeBytes: msg.sizeBytes,
        seen: msg.seen,
        hasAttachments: attachmentRows.length > 0,
        rawFileId,
      },
      attachmentRows,
    );

    await this.search.persist(INBOUND_EMAIL_COLLECTION, [
      { externalId: row.id, document: toSearchDocument(row) },
    ]);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/features/mailbox/mailbox-ingest.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/features/mailbox/mailbox-ingest.service.ts \
        api/src/features/mailbox/mailbox-ingest.service.spec.ts
git commit -m "feat(mailbox): add ingestion orchestration (cursor, idempotent persist, indexing)"
```

---

### Task 8: BullMQ processor + scheduler

**Files:**
- Create: `api/src/features/mailbox/processors/mailbox-sync.processor.ts`
- Create: `api/src/features/mailbox/schedulers/mailbox-sync.scheduler.ts`
- Test: `api/src/features/mailbox/processors/mailbox-sync.processor.spec.ts`

**Interfaces:**
- Consumes: `MailboxIngestService.sync`, `MAILBOX_SYNC_QUEUE`, `SYNC_MAILBOX_JOB`, `SYNC_JOB_OPTS`, `MailboxConfig`.
- Produces:
  - `MailboxSyncProcessor` (`WorkerHost`) consuming `SYNC_MAILBOX_JOB` with data `{ accountId: string; mailbox: string }`; re-enqueues a continuation job when `batchWasFull`.
  - `MailboxSyncScheduler` (`OnApplicationBootstrap`) that registers the repeatable poll (fixed `jobId` so it coalesces) and exposes `enqueueSync(accountId, mailbox)` for the manual-refresh endpoint.

- [ ] **Step 1: Write the failing test**

```typescript
// api/src/features/mailbox/processors/mailbox-sync.processor.spec.ts
import { MailboxSyncProcessor } from './mailbox-sync.processor';

describe('MailboxSyncProcessor', () => {
  it('delegates to ingest.sync with the job payload', async () => {
    const ingest = { sync: jest.fn(async () => ({ processed: 2, batchWasFull: false })) };
    const queue = { add: jest.fn(async () => undefined) };
    const proc = new MailboxSyncProcessor(ingest as any, queue as any);
    await proc.process({ name: 'sync-mailbox', data: { accountId: 'acc', mailbox: 'INBOX' } } as any);
    expect(ingest.sync).toHaveBeenCalledWith('acc', 'INBOX');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('re-enqueues a continuation when the batch was full', async () => {
    const ingest = { sync: jest.fn(async () => ({ processed: 200, batchWasFull: true })) };
    const queue = { add: jest.fn(async () => undefined) };
    const proc = new MailboxSyncProcessor(ingest as any, queue as any);
    await proc.process({ name: 'sync-mailbox', data: { accountId: 'acc', mailbox: 'INBOX' } } as any);
    expect(queue.add).toHaveBeenCalledWith(
      'sync-mailbox',
      { accountId: 'acc', mailbox: 'INBOX' },
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/features/mailbox/processors/mailbox-sync.processor.spec.ts`
Expected: FAIL — cannot find module `./mailbox-sync.processor`.

- [ ] **Step 3: Implement the processor**

```typescript
// api/src/features/mailbox/processors/mailbox-sync.processor.ts
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { MailboxIngestService } from '../mailbox-ingest.service';
import {
  MAILBOX_SYNC_QUEUE,
  SYNC_JOB_OPTS,
  SYNC_MAILBOX_JOB,
} from '../mailbox.constants';

interface SyncJobData {
  accountId: string;
  mailbox: string;
}

/** Consumes `sync-mailbox`: ingest one batch, then continue if the batch was full. */
@Processor(MAILBOX_SYNC_QUEUE)
export class MailboxSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MailboxSyncProcessor.name);

  constructor(
    private readonly ingest: MailboxIngestService,
    @InjectQueue(MAILBOX_SYNC_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== SYNC_MAILBOX_JOB) {
      this.logger.warn(`Unknown job "${job.name}"`);
      return;
    }
    const { accountId, mailbox } = job.data as SyncJobData;
    const { processed, batchWasFull } = await this.ingest.sync(accountId, mailbox);
    this.logger.log(
      `Synced ${processed} message(s) for ${accountId}/${mailbox}${batchWasFull ? ' (continuing)' : ''}`,
    );
    if (batchWasFull) {
      await this.queue.add(SYNC_MAILBOX_JOB, { accountId, mailbox }, SYNC_JOB_OPTS);
    }
  }
}
```

- [ ] **Step 4: Implement the scheduler**

```typescript
// api/src/features/mailbox/schedulers/mailbox-sync.scheduler.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { MailboxConfig } from '../../../config/configurations/mailbox.config';
import {
  MAILBOX_SYNC_QUEUE,
  SYNC_JOB_OPTS,
  SYNC_MAILBOX_JOB,
} from '../mailbox.constants';

/**
 * Registers the repeatable inbound-sync poll on startup (best-effort so boot
 * never hard-requires Redis; mirrors AgentScheduleScheduler). A fixed jobId means
 * overlapping polls coalesce. Also exposes `enqueueSync` for the manual endpoint.
 */
@Injectable()
export class MailboxSyncScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailboxSyncScheduler.name);
  private readonly cfg: MailboxConfig;

  constructor(
    @InjectQueue(MAILBOX_SYNC_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<MailboxConfig>('mailbox');
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.defaultAccountId) {
      this.logger.log('Mailbox poll disabled (MAILBOX_DEFAULT_ACCOUNT_ID unset)');
      return;
    }
    try {
      await this.queue.add(
        SYNC_MAILBOX_JOB,
        { accountId: this.cfg.defaultAccountId, mailbox: this.cfg.mailbox },
        {
          repeat: { every: this.cfg.pollIntervalMs },
          jobId: `mailbox-poll:${this.cfg.defaultAccountId}:${this.cfg.mailbox}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log('Registered mailbox sync poll');
    } catch (err) {
      this.logger.warn(
        `Mailbox poll registration skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async enqueueSync(accountId: string, mailbox: string): Promise<void> {
    await this.queue.add(SYNC_MAILBOX_JOB, { accountId, mailbox }, SYNC_JOB_OPTS);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && npx jest src/features/mailbox/processors/mailbox-sync.processor.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/features/mailbox/processors/mailbox-sync.processor.ts \
        api/src/features/mailbox/schedulers/mailbox-sync.scheduler.ts \
        api/src/features/mailbox/processors/mailbox-sync.processor.spec.ts
git commit -m "feat(mailbox): add sync processor + repeatable-poll scheduler"
```

---

### Task 9: `MailboxService` (read side + mark-seen + collection bootstrap)

**Files:**
- Create: `api/src/features/mailbox/mailbox.service.ts`
- Test: `api/src/features/mailbox/mailbox.service.spec.ts`

**Interfaces:**
- Consumes: `MailboxRepository`, `FileService.getDownloadUrl`, `SearchRecordService.persist`, `CollectionService` (`get`/`create`), `MailboxSyncScheduler.enqueueSync`, `SYSTEM_PRINCIPAL`, `MailboxConfig`, `mailbox.util.toSearchDocument`, `mailbox.types`.
- Produces:
  - `onApplicationBootstrap()` — ensures the `inbound_email` collection exists (get-or-create; best-effort).
  - `list(accountId, mailbox, page, limit, unseenOnly): Promise<{ items: MessageSummary[]; total: number; page: number; limit: number }>`
  - `get(id): Promise<MessageDetail>` (404 if missing)
  - `downloadAttachment(id, attachmentId): Promise<PresignedTarget>` (404 if missing)
  - `markSeen(id, seen: boolean): Promise<void>` (updates row + re-persists search doc)
  - `triggerSync(accountId, mailbox): Promise<void>`
  - `resolveAccountId(explicit?: string): string` — explicit arg, else config default, else throws `BadRequestException`.

- [ ] **Step 1: Write the failing test**

```typescript
// api/src/features/mailbox/mailbox.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { MailboxService } from './mailbox.service';

function make(over: any = {}) {
  const repo = {
    listMessages: jest.fn(async () => ({ rows: [], total: 0 })),
    findByIdWithAttachments: jest.fn(async () => null),
    findAttachment: jest.fn(async () => null),
    setSeen: jest.fn(async () => null),
    ...over.repo,
  };
  const files = { getDownloadUrl: jest.fn(async () => ({ url: 'https://x' })) };
  const search = { persist: jest.fn(async () => []) };
  const collections = { get: jest.fn(async () => ({})), create: jest.fn(async () => ({})) };
  const scheduler = { enqueueSync: jest.fn(async () => undefined) };
  const config = { getOrThrow: () => ({ defaultAccountId: 'acc-default', mailbox: 'INBOX' }) };
  const svc = new MailboxService(repo as any, files as any, search as any, collections as any, scheduler as any, config as any);
  return { svc, repo, files, search, collections, scheduler };
}

describe('MailboxService', () => {
  it('get throws NotFound when the message is absent', async () => {
    const { svc } = make();
    await expect(svc.get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('markSeen updates the row and re-persists the search doc', async () => {
    const row = {
      id: 'm1', accountId: 'acc', mailbox: 'INBOX', subject: 's', bodyText: 'b',
      fromAddress: 'a@x.com', fromName: null, threadId: '<t>', seen: true, flagged: false,
      receivedAt: new Date('2020-01-01'), sentAt: null,
    };
    const { svc, repo, search } = make({ repo: { setSeen: jest.fn(async () => row) } });
    await svc.markSeen('m1', true);
    expect(repo.setSeen).toHaveBeenCalledWith('m1', true);
    expect(search.persist).toHaveBeenCalledWith('inbound_email',
      [expect.objectContaining({ externalId: 'm1' })]);
  });

  it('resolveAccountId prefers the explicit arg then the config default', () => {
    const { svc } = make();
    expect(svc.resolveAccountId('explicit')).toBe('explicit');
    expect(svc.resolveAccountId()).toBe('acc-default');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/features/mailbox/mailbox.service.spec.ts`
Expected: FAIL — cannot find module `./mailbox.service`.

- [ ] **Step 3: Implement the service**

```typescript
// api/src/features/mailbox/mailbox.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailboxConfig } from '../../config/configurations/mailbox.config';
import type { PresignedTarget } from '../../infrastructure/file-manage/object-storage.interface';
import { SYSTEM_PRINCIPAL } from '../../common/principal';
import { FileService } from '../file-processor/file.service';
import { CollectionService } from '../search-service/collection.service';
import { SearchRecordService } from '../search-service/search-record.service';
import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import type { EmailMessageRow } from '../../infrastructure/database/schema/mailbox.schema';
import { INBOUND_EMAIL_COLLECTION } from './mailbox.constants';
import { MailboxRepository } from './mailbox.repository';
import { MailboxSyncScheduler } from './schedulers/mailbox-sync.scheduler';
import type { MessageDetail, MessageSummary } from './mailbox.types';
import { toSearchDocument } from './mailbox.util';

const INBOUND_EMAIL_FIELDS: FieldSpec[] = [
  { name: 'subject', type: 'string', searchable: true },
  { name: 'bodyText', type: 'string', searchable: true },
  { name: 'fromAddress', type: 'string', searchable: true, filterable: true },
  { name: 'fromName', type: 'string', searchable: true },
  { name: 'mailbox', type: 'string', filterable: true },
  { name: 'threadId', type: 'string', filterable: true },
  { name: 'accountId', type: 'string', filterable: true },
  { name: 'seen', type: 'boolean', filterable: true },
  { name: 'flagged', type: 'boolean', filterable: true },
  { name: 'receivedAt', type: 'number', filterable: true, sortable: true },
  { name: 'sentAt', type: 'number', sortable: true },
];

@Injectable()
export class MailboxService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailboxService.name);
  private readonly cfg: MailboxConfig;

  constructor(
    private readonly repo: MailboxRepository,
    private readonly files: FileService,
    private readonly search: SearchRecordService,
    private readonly collections: CollectionService,
    private readonly scheduler: MailboxSyncScheduler,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<MailboxConfig>('mailbox');
  }

  /** Ensure the system-owned inbound_email collection exists (best-effort). */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.collections.get(INBOUND_EMAIL_COLLECTION);
    } catch {
      try {
        await this.collections.create({
          name: INBOUND_EMAIL_COLLECTION,
          displayName: 'Inbound Email',
          description: 'Durably persisted inbound messages',
          fields: INBOUND_EMAIL_FIELDS,
        });
        this.logger.log(`Created "${INBOUND_EMAIL_COLLECTION}" collection`);
      } catch (err) {
        this.logger.warn(
          `Could not ensure inbound_email collection: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  resolveAccountId(explicit?: string): string {
    const id = explicit ?? this.cfg.defaultAccountId;
    if (!id) {
      throw new BadRequestException(
        'No mailbox account specified and MAILBOX_DEFAULT_ACCOUNT_ID is unset',
      );
    }
    return id;
  }

  async list(
    accountId: string,
    mailbox: string,
    page: number,
    limit: number,
    unseenOnly: boolean,
  ): Promise<{ items: MessageSummary[]; total: number; page: number; limit: number }> {
    const { rows, total } = await this.repo.listMessages(
      accountId,
      mailbox,
      page,
      limit,
      unseenOnly,
    );
    return { items: rows.map(toSummary), total, page, limit };
  }

  async get(id: string): Promise<MessageDetail> {
    const found = await this.repo.findByIdWithAttachments(id);
    if (!found) throw new NotFoundException('Message not found');
    return {
      ...toSummary(found.message),
      to: found.message.toAddresses,
      cc: found.message.ccAddresses,
      sentAt: found.message.sentAt,
      bodyText: found.message.bodyText,
      bodyHtml: found.message.bodyHtml,
      attachments: found.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        inline: a.inline,
      })),
    };
  }

  async downloadAttachment(
    id: string,
    attachmentId: string,
  ): Promise<PresignedTarget> {
    const att = await this.repo.findAttachment(id, attachmentId);
    if (!att) throw new NotFoundException('Attachment not found');
    return this.files.getDownloadUrl(att.fileId, SYSTEM_PRINCIPAL);
  }

  async markSeen(id: string, seen: boolean): Promise<void> {
    const row = await this.repo.setSeen(id, seen);
    if (!row) throw new NotFoundException('Message not found');
    await this.search.persist(INBOUND_EMAIL_COLLECTION, [
      { externalId: row.id, document: toSearchDocument(row) },
    ]);
  }

  async triggerSync(accountId: string, mailbox: string): Promise<void> {
    await this.scheduler.enqueueSync(accountId, mailbox);
  }
}

function toSummary(row: EmailMessageRow): MessageSummary {
  return {
    id: row.id,
    mailbox: row.mailbox,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.receivedAt,
    seen: row.seen,
    flagged: row.flagged,
    hasAttachments: row.hasAttachments,
    threadId: row.threadId,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/features/mailbox/mailbox.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/features/mailbox/mailbox.service.ts \
        api/src/features/mailbox/mailbox.service.spec.ts
git commit -m "feat(mailbox): add read-side service, mark-seen sync, collection bootstrap"
```

---

### Task 10: DTOs + `MailboxController`

**Files:**
- Create: `api/src/features/mailbox/dto/list-messages.dto.ts`
- Create: `api/src/features/mailbox/dto/mark-seen.dto.ts`
- Create: `api/src/features/mailbox/dto/sync.dto.ts`
- Create: `api/src/features/mailbox/mailbox.controller.ts`
- Test: `api/src/features/mailbox/dto/list-messages.dto.spec.ts`

**Interfaces:**
- Consumes: `MailboxService`, `ZodValidationPipe`, `Roles`, `CurrentUser`.
- Produces: `@Roles('admin') @Controller('mailbox')` with routes: `GET /mailbox/messages`, `GET /mailbox/messages/:id`, `GET /mailbox/messages/:id/attachments/:attId/download`, `PATCH /mailbox/messages/:id/seen`, `POST /mailbox/sync`.

- [ ] **Step 1: Write the failing test (DTO coercion)**

```typescript
// api/src/features/mailbox/dto/list-messages.dto.spec.ts
import { listMessagesSchema } from './list-messages.dto';

describe('listMessagesSchema', () => {
  it('applies defaults and coerces query strings', () => {
    expect(listMessagesSchema.parse({})).toEqual({
      mailbox: 'INBOX', page: 1, limit: 50, unseenOnly: false,
    });
    expect(listMessagesSchema.parse({ page: '2', limit: '10', unseenOnly: 'true' }))
      .toEqual({ mailbox: 'INBOX', page: 2, limit: 10, unseenOnly: true, accountId: undefined });
  });

  it('caps limit at 100', () => {
    expect(() => listMessagesSchema.parse({ limit: '500' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/features/mailbox/dto/list-messages.dto.spec.ts`
Expected: FAIL — cannot find module `./list-messages.dto`.

- [ ] **Step 3: Implement the DTOs**

```typescript
// api/src/features/mailbox/dto/list-messages.dto.ts
import { z } from 'zod';

export const listMessagesSchema = z.object({
  accountId: z.string().uuid().optional(),
  mailbox: z.string().min(1).max(255).default('INBOX'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  unseenOnly: z.coerce.boolean().default(false),
});
export type ListMessagesDto = z.infer<typeof listMessagesSchema>;
```

```typescript
// api/src/features/mailbox/dto/mark-seen.dto.ts
import { z } from 'zod';

export const markSeenSchema = z.object({ seen: z.boolean() });
export type MarkSeenDto = z.infer<typeof markSeenSchema>;
```

```typescript
// api/src/features/mailbox/dto/sync.dto.ts
import { z } from 'zod';

export const syncSchema = z.object({
  accountId: z.string().uuid().optional(),
  mailbox: z.string().min(1).max(255).default('INBOX'),
});
export type SyncDto = z.infer<typeof syncSchema>;
```

- [ ] **Step 4: Implement the controller**

```typescript
// api/src/features/mailbox/mailbox.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { listMessagesSchema, type ListMessagesDto } from './dto/list-messages.dto';
import { markSeenSchema, type MarkSeenDto } from './dto/mark-seen.dto';
import { syncSchema, type SyncDto } from './dto/sync.dto';
import { MailboxService } from './mailbox.service';

@Roles('admin')
@Controller('mailbox')
export class MailboxController {
  constructor(private readonly mailbox: MailboxService) {}

  @Get('messages')
  list(@Query(new ZodValidationPipe(listMessagesSchema)) q: ListMessagesDto) {
    const accountId = this.mailbox.resolveAccountId(q.accountId);
    return this.mailbox.list(accountId, q.mailbox, q.page, q.limit, q.unseenOnly);
  }

  @Get('messages/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailbox.get(id);
  }

  @Get('messages/:id/attachments/:attId/download')
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attId', ParseUUIDPipe) attId: string,
  ) {
    return this.mailbox.downloadAttachment(id, attId);
  }

  @Patch('messages/:id/seen')
  @HttpCode(204)
  async markSeen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(markSeenSchema)) body: MarkSeenDto,
  ): Promise<void> {
    await this.mailbox.markSeen(id, body.seen);
  }

  @Post('sync')
  @HttpCode(202)
  async sync(@Body(new ZodValidationPipe(syncSchema)) body: SyncDto): Promise<{ queued: true }> {
    const accountId = this.mailbox.resolveAccountId(body.accountId);
    await this.mailbox.triggerSync(accountId, body.mailbox);
    return { queued: true };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && npx jest src/features/mailbox/dto/list-messages.dto.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/features/mailbox/dto \
        api/src/features/mailbox/mailbox.controller.ts
git commit -m "feat(mailbox): add zod DTOs and admin inbox controller"
```

---

### Task 11: Module wiring + `AppModule` registration + full build/test gate

**Files:**
- Create: `api/src/features/mailbox/mailbox.module.ts`
- Modify: `api/src/app.module.ts` (import + register `MailboxModule` before `MastraModule`)

**Interfaces:**
- Consumes: `EmailModule`, `FileProcessorModule`, `SearchServiceModule`, `QueueModule` (global), `MAILBOX_SYNC_QUEUE`.
- Produces: `MailboxModule` (exports `MailboxIngestService` for potential agent reuse later).

- [ ] **Step 1: Implement the module**

```typescript
// api/src/features/mailbox/mailbox.module.ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailModule } from '../../infrastructure/email/email.module';
import { FileProcessorModule } from '../file-processor/file-processor.module';
import { SearchServiceModule } from '../search-service/search-service.module';
import { MailboxController } from './mailbox.controller';
import { MailboxIngestService } from './mailbox-ingest.service';
import { MailboxRepository } from './mailbox.repository';
import { MailboxService } from './mailbox.service';
import { MAILBOX_SYNC_QUEUE } from './mailbox.constants';
import { MailboxSyncProcessor } from './processors/mailbox-sync.processor';
import { MailboxSyncScheduler } from './schedulers/mailbox-sync.scheduler';

/**
 * Mailbox feature: durable inbound-email persistence. Composes EmailModule
 * (IMAP reads), FileProcessorModule (attachment/raw bytes → MinIO), and
 * SearchServiceModule (Meili indexing). Registers the `mailbox-sync` queue.
 */
@Module({
  imports: [
    EmailModule,
    FileProcessorModule,
    SearchServiceModule,
    BullModule.registerQueue({ name: MAILBOX_SYNC_QUEUE }),
  ],
  controllers: [MailboxController],
  providers: [
    MailboxRepository,
    MailboxIngestService,
    MailboxService,
    MailboxSyncProcessor,
    MailboxSyncScheduler,
  ],
  exports: [MailboxIngestService],
})
export class MailboxModule {}
```

- [ ] **Step 2: Register in `AppModule`**

In `api/src/app.module.ts`: add `import { MailboxModule } from './features/mailbox/mailbox.module';` with the other feature imports, and add `MailboxModule,` to the `imports` array **immediately before `MastraModule`** (MastraModule must stay last — its catch-all controller).

- [ ] **Step 3: Full build + unit-test gate**

Run: `cd api && npm run build`
Expected: succeeds with no TypeScript errors.

Run: `cd api && npm test`
Expected: the whole suite passes, including every new mailbox spec.

- [ ] **Step 4: Commit**

```bash
git add api/src/features/mailbox/mailbox.module.ts api/src/app.module.ts
git commit -m "feat(mailbox): wire module and register in AppModule"
```

---

### Task 12: Integration test — real persistence path (module-subset e2e)

**Files:**
- Create: `api/test/mailbox-ingest.e2e-spec.ts` (or the repo's e2e location; match the existing e2e convention)

**Interfaces:**
- Consumes: `MailboxIngestService` from a booted module subset; a fake `InboxService` provider; real `DatabaseModule`, `FileManageModule`/MinIO, `SearchEngineModule`/Meili, `QueueModule`.

**Goal:** prove the end-to-end persistence path against real Postgres + MinIO + Meili with a *faked* IMAP source (no live mailbox needed) — closing the "IMAP smoke test / InboxService has no real consumer" follow-up for the persistence path.

- [ ] **Step 1: Write the e2e test**

```typescript
// api/test/mailbox-ingest.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { ConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { FileManageModule } from '../src/infrastructure/file-manage/file-manage.module';
import { SearchEngineModule } from '../src/infrastructure/search-engine/search-engine.module';
import { QueueModule } from '../src/infrastructure/queue/queue.module';
import { MailboxModule } from '../src/features/mailbox/mailbox.module';
import { InboxService } from '../src/infrastructure/email/inbox.service';
import { MailboxIngestService } from '../src/features/mailbox/mailbox-ingest.service';
import { MailboxRepository } from '../src/features/mailbox/mailbox.repository';

// A fake IMAP source: one message with one small attachment.
const fakeInbox = {
  mailboxState: async () => ({ uidValidity: 1, uidNext: 2 }),
  listUidsSince: async (since: number) => (since < 1 ? [1] : []),
  fetchForIngest: async (uid: number) => ({
    uid, raw: Buffer.from('From: a@x.com\r\nSubject: Hello\r\n\r\nbody'),
    messageId: '<m1@x>', inReplyTo: null, references: undefined,
    from: { address: 'a@x.com', name: 'A' }, to: [{ address: 'me@x.com', name: null }],
    cc: [], subject: 'Hello', sentAt: new Date('2020-01-01'),
    text: 'body', html: null, seen: false, sizeBytes: 40,
    attachments: [{
      filename: 'note.txt', contentType: 'text/plain', size: 3,
      contentId: null, inline: false, content: Buffer.from('abc'),
    }],
  }),
};

describe('Mailbox ingestion (e2e)', () => {
  let ingest: MailboxIngestService;
  let repo: MailboxRepository;
  const accountId = '00000000-0000-0000-0000-0000000000aa';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule, DatabaseModule, FileManageModule,
        SearchEngineModule, QueueModule, MailboxModule,
      ],
    })
      .overrideProvider(InboxService)
      .useValue(fakeInbox)
      .compile();
    await moduleRef.init();
    ingest = moduleRef.get(MailboxIngestService);
    repo = moduleRef.get(MailboxRepository);
  });

  it('persists a fetched message + attachment and is idempotent on re-run', async () => {
    const first = await ingest.sync(accountId, 'INBOX');
    expect(first.processed).toBe(1);

    const state = await repo.getSyncState(accountId, 'INBOX');
    expect(state?.lastSeenUid).toBe(1);
    expect(state?.lastStatus).toBe('ok');

    const stored = await repo.findByUid(accountId, 'INBOX', 1, 1);
    expect(stored?.subject).toBe('Hello');
    expect(stored?.hasAttachments).toBe(true);

    const withAtt = await repo.findByIdWithAttachments(stored!.id);
    expect(withAtt?.attachments).toHaveLength(1);
    expect(withAtt?.attachments[0].filename).toBe('note.txt');

    // Re-run: nothing new (idempotent on the UID key).
    const second = await ingest.sync(accountId, 'INBOX');
    expect(second.processed).toBe(0);
  });
});
```

- [ ] **Step 2: Run the e2e (requires Postgres/Redis/MinIO/Meili from `.env` up)**

Run: `cd api && npx jest --config test/jest-e2e.json mailbox-ingest.e2e-spec.ts`
(Use the repo's actual e2e jest config path if different.)
Expected: PASS — message + attachment persisted, cursor advanced, second run processes 0.

> If the e2e infra isn't running locally, document that in the task notes and run it in CI/an environment where the datastores are up. Do not weaken the assertions to make it pass.

- [ ] **Step 3: Commit**

```bash
git add api/test/mailbox-ingest.e2e-spec.ts
git commit -m "test(mailbox): e2e persistence path with faked IMAP source"
```

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- §2 module shape / reused seams → Tasks 7, 9, 11 (compose InboxService/FileService/SearchRecordService).
- §3 file layout → Tasks 1–11 (matches proposed layout).
- §4.1 `email_messages` → Task 1. §4.2 `email_attachments` → Task 1. §4.3 `email_sync_state` → Task 1.
- §5 additive InboxService methods → Task 4.
- §6 ingestion flow (scheduler→job→processor→ingest; idempotency; raw+attachments→MinIO; tx; async index; UIDVALIDITY reset; batch cap+continuation; retry) → Tasks 7 (ingest), 8 (processor/scheduler).
- §7 read side (list/get/download/mark-seen/sync; search reuse; collection field spec + bootstrap) → Tasks 9, 10.
- §8 policies (local read-state; append-only; store raw via `storeRaw`) → Tasks 7, 9 (config-driven).
- §9 error handling (attempts/backoff, idempotent, batch cap, UIDVALIDITY reset), config block, testing (unit/processor/repo/e2e) → Tasks 2, 6, 7, 8, 12.
- Discovered integration gaps not in the spec → Task 5 (MIME allowlist bypass), Task 9 bootstrap (collection ensure). Both surfaced explicitly.
- §9 `MailboxReconciliationScheduler` is explicitly v1.1 (deferred) — intentionally NOT a task.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step states the exact command + expected result.

**3. Type consistency:** `IngestMessage`/`IngestAttachment` (Task 4) are consumed verbatim by `MailboxIngestService.persist` (Task 7). `putFromStream` + `DirectPutMeta.allowAnyMime` (Task 5) match the ingest call sites (Task 7). `toSearchDocument` (Task 3) is used identically in ingest (Task 7) and mark-seen (Task 9). Repository method names (Task 6) match all callers (Tasks 7, 9). Constants (`MAILBOX_SYNC_QUEUE`, `SYNC_MAILBOX_JOB`, `INBOUND_EMAIL_COLLECTION`, `SYNC_JOB_OPTS`) are defined once (Task 2) and referenced consistently (Tasks 7–11). `MessageSummary`/`MessageDetail`/`AttachmentView` (Task 3) are produced only by `MailboxService` (Task 9).
