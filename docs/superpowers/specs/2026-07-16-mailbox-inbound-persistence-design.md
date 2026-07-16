# Durable Inbound Email Persistence — Design

- **Date:** 2026-07-16
- **Branch:** `feat/email-persistant`
- **Status:** Approved design (pre-implementation)
- **Scope:** v1 — simple but production-grade. Human inbox UI + searchable archive.

## 1. Problem & Goals

Today `infrastructure/email` is a **stateless read-through gateway** to IMAP: `InboxService`
lists/fetches/flags messages live on every call and persists nothing. Attachment *bytes* are
never stored (only `filename`/`contentType`/`size` metadata), read-state lives only on the
server, and there is no local record if a message is later deleted server-side.

We want inbound mail to be **durably persisted** so that:

1. **Human inbox UI** — people browse/read/paginate received mail in the app without hitting
   IMAP, with local read/threading state and downloadable attachments.
2. **Searchable archive** — every message is indexed into MeiliSearch (via the existing
   search-service) for full-text retrieval, and retained even if removed from the server.

Explicit **non-goals** for v1: feeding the Mastra agent as an event source, a conversation-thread
UI (we store threading keys but render flat), bidirectional flag mirroring, and mirroring
server-side deletions.

## 2. Chosen Approach (Option A)

A new **`features/mailbox`** feature that *composes existing seams*, keeping
`infrastructure/email` a thin transport seam.

- `infrastructure/email` stays "IMAP/SMTP transport, no HTTP, no DB writes except config read."
  It gains a few **additive** `InboxService` methods for ingestion (raw source + attachment
  buffers + a UID-cursor fetch). No rewrite.
- `features/mailbox` owns all **stateful** work: persistence, the ingestion job, and HTTP
  controllers — exactly mirroring how `file-processor` and `search-service` are features over
  the `minio`/`meili` infra primitives.

### Reused seams (no new machinery)

| Need | Reused component | How |
| --- | --- | --- |
| Attachment + raw `.eml` bytes | `FileService.putFromStream(body, meta, owner)` | Direct in-process upload → MinIO + `AVAILABLE` `files` row, sha256-deduped. `ownerId` nullable (system-owned). |
| Full-text search | `SearchRecordService.persist(collection, [{externalId, document}])` | Idempotent upsert into `search_records`; enqueues Meili indexing; repaired by the existing reconciliation scheduler. Zero new outbox code. |
| Scheduling / async | `infrastructure/queue` (BullMQ) | Scheduler (producer) + processor (consumer), same retry/backoff opts as file/search. |

### Rejected alternatives

- **B — persist inside `infrastructure/email`:** breaks its infra-only charter; mixes stateless
  transport with stateful ingestion.
- **C — bespoke Meili outbox on the email table:** duplicates the search-service
  outbox + reconciliation that already exists.

## 3. Module & Dependency Shape

```
features/mailbox  (NEW — HTTP + persistence + ingestion)
  ├─ imports EmailModule         → InboxService (IMAP reads; + additive methods)
  ├─ imports FileProcessorModule → FileService.putFromStream (bytes → MinIO)
  ├─ imports SearchServiceModule → SearchRecordService.persist (Meili indexing)
  └─ uses infrastructure/queue   → MailboxSyncScheduler + MailboxSyncProcessor

infrastructure/email  (additive only — charter preserved)
  └─ InboxService gains: mailboxState(), listUidsSince(), fetchForIngest()
```

Proposed file layout (mirrors `file-processor` / `search-service`):

```
features/mailbox/
  mailbox.module.ts
  mailbox.controller.ts
  mailbox.service.ts            # read side + mark-seen + trigger sync
  mailbox-ingest.service.ts     # ingestion orchestration (called by the processor)
  mailbox.repository.ts         # Drizzle reads/writes over the 3 tables
  mailbox.constants.ts          # queue name, job names, collection name
  mailbox.types.ts
  mailbox.util.ts               # threadId, snippet, address-flattening
  dto/                          # query/list/mark-seen DTOs
  processors/mailbox-sync.processor.ts
  schedulers/mailbox-sync.scheduler.ts
  (schedulers/mailbox-reconciliation.scheduler.ts  # v1.1)
infrastructure/database/schema/mailbox.schema.ts   # 3 new tables
```

## 4. Schema — `mailbox.schema.ts` (3 tables)

Postgres is the **source of truth**; Meili is a rebuildable read model. Uses shared
`baseColumns` (uuid id, createdAt, updatedAt, isDeleted, deletedAt). Soft-delete = archive
retention; rows are never hard-deleted.

### 4.1 `email_messages`

| Column | Type | Notes |
| --- | --- | --- |
| `...baseColumns` | | soft-delete = retention |
| `accountId` | `uuid NOT NULL` | → `imap_configs.id`; future-proofs multi-account (single-active today) |
| `mailbox` | `varchar(255) NOT NULL default 'INBOX'` | |
| `uid` | `integer NOT NULL` | IMAP UID |
| `uidValidity` | `bigint NOT NULL` | IMAP UIDVALIDITY; `(account, mailbox, uidValidity, uid)` is the stable identity |
| `messageId` | `varchar(998)` | RFC5322 Message-ID (nullable — some mail omits it) |
| `inReplyTo` | `varchar(998)` | |
| `references` | `text` | space-joined References header |
| `threadId` | `varchar(998)` | computed: References-root → own messageId → synthetic |
| `fromAddress` | `varchar(320)` | max email length |
| `fromName` | `varchar(255)` | |
| `toAddresses` | `jsonb` | `{address,name}[]` |
| `ccAddresses` | `jsonb` | `{address,name}[]` |
| `subject` | `text` | |
| `sentAt` | `timestamptz` | Date header |
| `receivedAt` | `timestamptz NOT NULL` | internalDate / ingestion time — list ordering |
| `snippet` | `varchar(280)` | list preview |
| `bodyText` | `text` | |
| `bodyHtml` | `text` | nullable |
| `sizeBytes` | `integer` | |
| `seen` | `boolean NOT NULL default false` | local read state (authoritative in v1) |
| `flagged` | `boolean NOT NULL default false` | |
| `hasAttachments` | `boolean NOT NULL default false` | |
| `rawFileId` | `uuid` | → `files.id`; raw `.eml` in MinIO (nullable if raw storage disabled) |

Indexes:
- **unique** `(accountId, mailbox, uidValidity, uid) WHERE is_deleted = false` — idempotency key.
- `(accountId, mailbox, receivedAt)` — paged list, newest-first.
- `(messageId)` — dedup/threading lookups.
- `(threadId)` — future threaded view.
- `(accountId, seen)` — unseen filter.

### 4.2 `email_attachments`

| Column | Type | Notes |
| --- | --- | --- |
| `...baseColumns` | | |
| `emailId` | `uuid NOT NULL` | → `email_messages.id` |
| `fileId` | `uuid NOT NULL` | → `files.id` (bytes in MinIO) |
| `filename` | `varchar(512)` | nullable |
| `contentType` | `varchar(255) NOT NULL` | |
| `size` | `integer NOT NULL` | |
| `contentId` | `varchar(255)` | Content-ID for inline `cid:` images (nullable) |
| `inline` | `boolean NOT NULL default false` | |

Index: `(emailId)`.

### 4.3 `email_sync_state` — per `(accountId, mailbox)` ingestion cursor

| Column | Type | Notes |
| --- | --- | --- |
| `...baseColumns` | | |
| `accountId` | `uuid NOT NULL` | |
| `mailbox` | `varchar(255) NOT NULL default 'INBOX'` | |
| `uidValidity` | `bigint` | last known; server change → cursor reset |
| `lastSeenUid` | `integer NOT NULL default 0` | highest UID ingested |
| `lastSyncStartedAt` | `timestamptz` | |
| `lastSyncFinishedAt` | `timestamptz` | |
| `lastStatus` | `varchar(50)` | `running` \| `ok` \| `error` |
| `lastError` | `text` | |

Unique: `(accountId, mailbox)`.

The unique UID key makes the whole pipeline **idempotent** — re-runs and retries cannot
double-insert.

## 5. Additive changes to `infrastructure/email`

`InboxService` (and the underlying `imap.transport.ts`) gain three ingestion-oriented methods.
They remain "IMAP operations, no HTTP" — charter preserved.

- `mailboxState(mailbox?)` → `{ uidValidity: number, uidNext: number }` (mailbox status probe).
- `listUidsSince(sinceUid, opts?: { mailbox?; limit? })` → `number[]` of UIDs `> sinceUid`
  (bounded batch).
- `fetchForIngest(uid, mailbox?)` → the full ingest payload:
  `{ raw: Buffer, messageId, inReplyTo, references, from, to, cc, subject, sentAt, text, html,
     flags, attachments: { filename, contentType, size, contentId, inline, content: Buffer }[] }`
  (parsed via `mailparser`, **including** attachment content buffers, which the current
  `fetchMessage` deliberately drops).

## 6. Ingestion Flow — chain of nodes

```
MailboxSyncScheduler (BullMQ repeatable, every N min)  ─┐
POST /mailbox/sync  (manual "refresh now")             ─┴─► enqueue SYNC_MAILBOX {accountId, mailbox}
                                                              (fixed jobId → concurrent syncs coalesce)
                                                                        │
                                                                        ▼
MailboxSyncProcessor.process():
  1. resolve active IMAP conn        → none? mark sync_state 'error', exit
  2. load/create email_sync_state, mark 'running'
  3. InboxService.mailboxState()     → server {uidValidity, uidNext}
  4. uidValidity changed?            → reset lastSeenUid=0 (server renumbered), store new value
  5. InboxService.listUidsSince(lastSeenUid, cap=200)  ← bounded batch; more → requeue continuation
  6. for each new uid  (idempotent on the unique key):
       a. InboxService.fetchForIngest(uid) → { raw, headers, text, html, flags, attachments[] }
       b. FileService.putFromStream(raw)                → rawFileId          (dedup by sha256)
       c. each attachment → FileService.putFromStream   → files row + email_attachments row
       d. INSERT email_messages (+ attachment rows) in ONE Postgres tx, AFTER MinIO puts succeed
       e. SearchRecordService.persist('inbound_email', [{ externalId: id, document: {...} }])
  7. advance lastSeenUid = max(uid); mark sync_state 'ok'
  (any throw → sync_state 'error' + lastError; BullMQ retries with exponential backoff)
```

**Reliability properties**

- MinIO puts are content-addressed → retries re-put the same key, never duplicate bytes.
- A single Postgres tx per message → a message row never exists without its attachment rows.
- Meili indexing is async via the existing outbox → a Meili outage delays search, never blocks
  ingestion.
- Idempotent UID key + bounded batch + continuation → a huge first sync cannot wedge the queue,
  and any retry is safe.
- UIDVALIDITY reset is handled explicitly (cursor reset + re-scan).

## 7. Read Side (inbox UI) — served from Postgres, no IMAP hit

`MailboxController` (JWT + role guard):

- `GET /mailbox/messages?mailbox&page&limit&unseenOnly` — paged, newest-first by `receivedAt`.
- `GET /mailbox/messages/:id` — full body.
- `GET /mailbox/messages/:id/attachments/:attId/download` — presigned GET via
  `FileService.getDownloadUrl`.
- `PATCH /mailbox/messages/:id/seen` — update local `seen`, then re-`persist` the search doc.
- `POST /mailbox/sync` — enqueue a manual sync.
- **Search** reuses the existing search-service endpoint against the `inbound_email` collection —
  no new search API.

The `inbound_email` collection is a **system-owned** collection (not admin-created). The mailbox
module ensures it exists idempotently on module init via the collection service (an
"ensure-collection" call that no-ops if already present), so ingestion never races a missing
collection. Its field spec:
- searchable: `subject`, `bodyText`, `fromAddress`, `fromName`
- filterable: `mailbox`, `seen`, `flagged`, `threadId`, `accountId`
- sortable: `receivedAt`, `sentAt`

## 8. Policy Decisions (v1)

- **Read-state direction:** local is authoritative; marking read updates Postgres only. Pushing
  `\Seen` back to IMAP is **deferred** behind a `pushFlags` flag (default off).
- **Retention:** append-only archive — ingest and keep. Server-side deletions are **not** mirrored
  in v1 (no purge).
- **Raw `.eml` storage:** **stored** (cheap insurance for reparse/fidelity). Can be disabled to
  attachments-only via the `storeRaw` flag.

## 9. Error Handling, Config, Testing

**Error handling**
- BullMQ `attempts: 3` + exponential backoff (same opts as file/search processors).
- Idempotent by UID; bounded batch + continuation.
- Explicit UIDVALIDITY-reset handling.
- Optional `MailboxReconciliationScheduler` (mirrors file/search reconcilers) re-drives syncs
  stuck in `running` and re-scans periodically — **v1.1** (not required for v1).

**Config** — a `mailbox` config block via `ConfigService`, mirroring `search`/`storage`:
- `pollIntervalMs` (repeatable job interval), `batchCap` (UIDs per run, default 200),
  `storeRaw` (default true), `pushFlags` (default false).

**Testing**
- Unit: cursor/UIDVALIDITY logic, idempotent upsert, `threadId` computation, snippet generation,
  address flattening.
- Processor: mocked `InboxService` / `FileService` / `SearchRecordService`; assert idempotency,
  batch cap/continuation, error → `sync_state` transitions.
- Repository: against the test Postgres (ports from `.env`, not the docker defaults).
- E2E: boot the mailbox module subset (not `AppModule`) per the ESM-safe e2e convention.

## 10. Open Questions / Deferred

- `\Seen` push-back to IMAP (behind `pushFlags`).
- Mirroring server-side deletions (append-only in v1).
- Threaded conversation UI (threading keys stored now; flat render in v1).
- Multi-account ingestion (schema carries `accountId`; single-active resolver today).
- Mastra agent consumption of inbound mail as an event source.
