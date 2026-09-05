# Persistence → Postgres → async → Meilisearch — Pipeline Audit & Target Design (v2)

**Date:** 2026-09-04 · **Branch:** `dev` · **Scope:** `api/src/features/search-service`,
`api/src/infrastructure/search-engine`, and the three write-side consumers
(`mailbox`, `document-ingest`, `mastra` read-side)

---

## 0. Verdict (answer to "is it what I described?")

**Yes — the architecture you described is already implemented, end to end, and no code
writes to Meilisearch outside it.** Postgres is the source of truth, writes/updates/deletes
land in Postgres first, a BullMQ worker asynchronously applies them to Meilisearch, and all
search queries go straight to Meilisearch and never touch Postgres.

**But the pipeline is not currently reliable, because its repair loop is dead code.** The
`SearchReconciliationScheduler` — the component the original design named as the mechanism
that guarantees convergence — is registered in the DI container but **never invoked by any
production code path**. Combined with a non-transactional outbox, this means a record can
enter a permanently-unindexed state that nothing will ever repair short of a manual
`POST /search/collections/:name/reload`.

That is the headline. Twelve further gaps are catalogued in §3, ranked. §4 onwards is the
target design.

---

## 1. As-is pipeline (verified by code trace)

### 1.1 The claim vs. the code

| Your description | Implemented? | Evidence |
|---|---|---|
| Write goes to Postgres first | ✅ | `search-record.service.ts:130` (`records.create`, `indexState='PENDING'`) |
| Update goes to Postgres first | ✅ | `search-record.service.ts:117` (`records.update`, resets to `PENDING`) |
| Delete goes to Postgres first | ✅ | `search-record.service.ts:154` (`records.softDelete`, resets to `PENDING`) |
| Then async into Meilisearch | ✅ | `search-record.service.ts:142/155` enqueue → `search-indexing.processor.ts:58-95` |
| Search queries hit Meilisearch directly | ✅ | `search-record.service.ts:189` — `engine.search(...)` only; no PG read in the query path |
| Single-record fetch reads Postgres | ✅ | `search-record.service.ts` `get()` → `findLiveById` / `findLiveByExternalId` |
| All Meili writes funnel through one path | ✅ | Only `SearchRecordService` mutates records; `mailbox`, `document-ingest` both call `persist` |

### 1.2 Component map (current)

```
HTTP ─┬─ RecordController (admin)        POST   /search/collections/:name/records   → persist  (202)
      │                                  DELETE /search/collections/:name/records/:id → remove (204)
      ├─ SearchQueryController           POST   /search/collections/:name/query      → Meili only (200)
      │                                  GET    /search/collections/:name/records/:id → Postgres (200)
      │                                  POST   /search/collections/:name/reload     → admin (202)
      └─ CollectionController (admin)    collection CRUD

Internal writers ── MailboxIngestService / MailboxService.markSeen / DocumentIngestProcessor
                    └─ all call SearchRecordService.persist(collection, [{externalId, document}])

SearchRecordService ── validate(field-spec) → Postgres upsert (PENDING) → queue.add(job)
                    └─ search() → SearchEngine → Meilisearch

SearchIndexingProcessor (BullMQ 'search-indexing')
  index-record       : re-read row by id → addOrReplace|deleteDocuments → waitForTask → stamp INDEXED/FAILED
  delete-record      : deleteDocuments → waitForTask → stamp INDEXED/FAILED
  reindex-collection : clearIndex → keyset-page live rows (500) → addOrReplace per page → markCollectionIndexed
  reconcile          : findUnsynced(PENDING|FAILED, older than 5 min, limit 500) → re-enqueue
                       ⚠️ never fires — see G1

CollectionService.onApplicationBootstrap → registry.warm() → ensureIndex() per collection (best-effort)
```

### 1.3 The outbox

There is no outbox *table*. The outbox is the `search_records.index_state` enum column
(`PENDING | INDEXED | FAILED`) plus `index_error` and `indexed_at`
(`search.schema.ts`). This is a sound, low-moving-parts choice and worth keeping.

Idempotency is real and well done: `computeChecksum` is a sha256 over a **key-sorted**
canonical serialization (`search.util.ts`), so a re-`persist` of unchanged content on an
already-`INDEXED` row short-circuits with zero writes and zero jobs
(`search-record.service.ts:104-115`). `externalId` gives callers a business key with a
partial unique index (`collection, external_id WHERE external_id IS NOT NULL AND is_deleted = false`).
Both `mailbox` and `document-ingest` rely on this for at-least-once safety.

### 1.4 What is genuinely good (do not regress in v2)

- Clean single funnel: no feature bypasses `SearchRecordService` to write Meili directly.
- The processor **re-reads the row from Postgres** rather than trusting job payload, so
  rapid successive updates coalesce to the latest state and jobs are order-insensitive.
- Field-spec drives *both* write validation and Meili attribute config, so the two cannot drift.
- `SearchEngine` interface fully hides the Meili SDK — backend is swappable.
- Reads are correctly separated: aggregate/full-text → Meili; point-read → Postgres.

---

## 2. Traced data flows (current behaviour, including the failure branches)

### 2.1 Create / update

```
POST records
 └─ validate every document against field-spec        (all-or-nothing on validation only)
 └─ per record:
     ├─ externalId present → findLiveByExternalId
     │    ├─ found, checksum equal, state INDEXED → SKIP  (no write, no job)      ← idempotent
     │    └─ found, otherwise → UPDATE (document, checksum, PENDING, indexError=null)
     └─ not found → INSERT (PENDING)
 └─ for each touched id: queue.add('index-record', {id})       ⚠️ outside any transaction
 └─ 202 [{ id, externalId, indexState: 'PENDING' }]

worker 'index-record'
 └─ findById(id)   (includes soft-deleted rows — deliberate)
 └─ row.isDeleted ? deleteDocuments([id]) : addOrReplace([toMeiliDocument(row)])
 └─ waitForTask(taskUid)                     ⚠️ blocks the worker slot for the whole Meili task
 └─ ok    → markIndexState(INDEXED, indexedAt=now, indexError=null)
    throw → markIndexState(FAILED, indexError=msg) and rethrow → BullMQ retry (3 attempts, exp backoff)
```

### 2.2 Delete

```
DELETE records/:id
 └─ resolve by uuid then by externalId; 404 if neither
 └─ softDelete(id): is_deleted=true, deleted_at=now, index_state=PENDING
 └─ queue.add('delete-record', {collection, id})
 └─ 204

worker 'delete-record' → deleteDocuments([id]) → waitForTask → markIndexState(INDEXED)
```

The row is retained (audit). Meili stops serving it. There is **no purge** stage — see G10.

### 2.3 Query

```
POST query
 └─ resolve collection from IndexRegistry (in-process cache → repo fallback)
 └─ reject unknown filter / facet / sort fields against the compiled field-spec (400)
 └─ engine.search(collection, {q, filter, sort, facets, page, hitsPerPage, highlight})
 └─ SearchEngineError → 503 SEARCH_UNAVAILABLE  (no Postgres fallback — by design)
```

### 2.4 Reload (full rebuild)

`clearIndex` → keyset pagination over live rows in id order, 500 per page → `addOrReplace`
per page with `waitForTask` → `markCollectionIndexed`. This is a correct
truncate-and-rebuild, and it is the only working repair mechanism today.

---

## 3. Gap register

Severity: **C** = correctness/durability, **P** = performance/scale, **O** = operability.

| # | Sev | Gap | Evidence |
|---|-----|-----|----------|
| G1 | **C1** | Reconciliation sweep never runs — `scheduleReconciliation()` has zero production callers | `search-reconciliation.scheduler.ts` (no `OnApplicationBootstrap`); grep: only its own spec calls it |
| G2 | **C1** | Outbox is not atomic — PG commit and `queue.add` are separate, unguarded operations | `search-record.service.ts:130-142` |
| G3 | **C2** | Even if wired, default cadence is 24 h while the stale threshold is 5 min | `scheduler.ts:19` (`86_400_000`) vs `search.constants.ts` (`RECONCILE_STALE_MS = 300_000`) |
| G4 | **P1** | `findUnsynced` has no usable index and no ordering → seq scan + nondeterministic 500-row slice | `search-record.repository.ts:133`; only `(collection, index_state)` exists (leading col absent from predicate) |
| G5 | **P1** | One job per record + `waitForTask` per job + BullMQ default worker concurrency of 1 → serialized indexing | `search-indexing.processor.ts:63`; no `concurrency` set anywhere |
| G6 | **C2** | Meili `updatedAt` can never equal Postgres `updated_at`; `markIndexState` re-bumps it via `$onUpdate` after the document was built | `search.util.ts` `toMeiliDocument`; `common.ts` `$onUpdate`; `repository.ts:64` |
| G7 | **C2** | `persist` never calls `ensureIndex`; a wiped/deleted Meili index is silently auto-created with **default settings** — jobs succeed, records stamp `INDEXED`, filters/sorts then fail at query time | `search-record.service.ts` (no ensureIndex); `search-engine.service.ts` `addOrReplace` |
| G8 | **C3** | `IndexRegistry` cache is in-process; `invalidate()` is local only → other instances validate writes and queries against a stale field-spec | `index-registry.ts`; `collection.service.ts:147` |
| G9 | **C3** | Collection create calls `ensureIndex` **before** the DB insert; delete failure on the Meili side is only logged → orphan indexes, and a same-name re-create silently reuses stale docs | `collection.service.ts:92` and `:168-175` |
| G10 | **O2** | No purge/GC: soft-deleted rows keep their full JSONB forever; `softDeleteByCollection` stamps them `INDEXED` so reconciliation will not even verify their removal | `repository.ts:115` |
| G11 | **O2** | No failure visibility — no metric, no alert, no admin endpoint listing `FAILED` records; health check only pings Meili liveness, not backlog/lag | `health.controller.ts`, `meili.health.ts` |
| G12 | **O3** | `pagination.maxTotalHits` hardcoded to `1000` and unrelated to `SEARCH_MAX_PAGE_SIZE`; deep pages silently return empty and `totalHits` saturates | `search-engine.service.ts` `ensureIndex` |
| G13 | **C3** | Multi-record `persist` writes are not in a transaction — a mid-batch DB error commits a partial batch and returns 500 | `search-record.service.ts:96-140` |
| G14 | **O3** | Both dead schedulers use the legacy `queue.add(..., {repeat})` API; `MailboxReconciliationScheduler` already uses the correct idempotent `upsertJobScheduler` | compare `search-reconciliation.scheduler.ts:19` with `mailbox-reconciliation.scheduler.ts:44` |

### 3.1 Why G1 + G2 compound into the one real durability bug

`persist` commits the Postgres row, then enqueues. Between those two statements the process
can die, or Redis can be unavailable, in which case `queue.add` throws **after** the row is
already committed — the caller receives a 500 while the write is durably persisted and
permanently invisible to search.

The original design (`development/historis/search-engine-update/current_design.md` §7)
answers exactly this: *"repairs lost jobs / Redis flushes without a full reload."* That
answer was specified, implemented, unit-tested — and never wired up. So today the honest
statement of the guarantee is:

> A record is **eventually** searchable if and only if the enqueue succeeded and the job
> ultimately succeeded within 3 attempts. Otherwise it is searchable **never**, until an
> operator notices and triggers a reload.

Fixing G1 alone (one `OnApplicationBootstrap` hook) converts that into a true
at-least-once convergence guarantee. Everything else in this document is refinement.

### 3.2 Note on the consumers' error handling

`MailboxIngestService.persist`, `MailboxService.markSeen` and the mailbox reconcile sweep
all wrap `search.persist` in `try/catch → logger.warn`, explicitly deferring to a
reconciliation sweep. For mailbox this is *safe today* only by accident: mailbox has its own
working 6-hourly sweep (`MailboxReconciliationScheduler`, correctly self-registering) that
re-persists the last 7 days of messages. `DocumentIngestProcessor` has **no** such safety
net — it relies entirely on BullMQ retries of the ingest job and the (dead) search sweep.

---

## 4. Target design (v2)

### 4.1 Principles (unchanged from v1 — reaffirmed)

1. **Postgres is the source of truth.** Meilisearch is a disposable, rebuildable read model.
2. **Writes are Postgres-first, indexing is asynchronous.** No synchronous Meili write on the
   request path.
3. **Queries hit Meilisearch only.** No Postgres fallback for search; a Meili outage is a
   `503`, not a silent degradation to a different result set.
4. **Point reads hit Postgres.** `GET records/:id` stays authoritative and read-your-writes
   consistent.
5. **`index_state` is the outbox.** Keep the column; do not introduce an outbox table.
6. **Convergence must be guaranteed by a running loop, not by hope.** Every state that is not
   `INDEXED` must be provably picked up by a periodic sweep.

### 4.2 Target write path

```
persist(collection, records[])
 └─ validate all documents (400 on any failure — unchanged)
 └─ db.transaction:
 │    ├─ upsert every row via ON CONFLICT (collection, external_id) DO UPDATE   ← single round-trip
 │    └─ (rows land as PENDING; checksum-equal + INDEXED rows excluded first)
 └─ COMMIT
 └─ enqueue ONE batched job: {collection, ids[]}          ← failure here is now survivable
 │    catch → log at warn + increment metric; DO NOT fail the request
 └─ 202 [{ id, externalId, indexState }]

worker 'index-records' (concurrency N, batch of ids)
 └─ SELECT rows WHERE id = ANY(ids)
 └─ ensureIndexOnce(collection)               ← cached per-process, closes G7
 └─ partition: live → addOrReplace(docs)   |   deleted → deleteDocuments(ids)
 └─ waitForTask on each task ref
 └─ markIndexStateMany(ids, INDEXED, indexedAt=now)
 └─ on throw → markIndexStateMany(failedIds, FAILED, indexError) then rethrow (BullMQ retry)
```

Two changes carry most of the value: the enqueue becomes **non-fatal** (because the sweep
now guarantees pickup), and the job becomes **batched** (because Meili's task queue is
serial — one task for 500 documents costs roughly one task for 1).

### 4.3 Target repair loop

```
SearchReconciliationScheduler implements OnApplicationBootstrap
 └─ queue.upsertJobScheduler('search-reconcile', {every: SEARCH_RECONCILE_EVERY_MS},
                             {name: 'reconcile', opts: {removeOnComplete, removeOnFail}})
 └─ wrapped in try/catch so boot never hard-requires Redis   (mirror MailboxReconciliationScheduler)

worker 'reconcile'
 └─ rows = findUnsynced(cutoff = now - RECONCILE_STALE_MS, limit)
 │            WHERE index_state IN ('PENDING','FAILED') AND index_attempted_at < cutoff
 │            ORDER BY index_attempted_at ASC          ← deterministic, oldest-first drain
 └─ group by collection → enqueue batched 'index-records' jobs
 └─ log + emit gauge: unsynced_total, oldest_unsynced_age_seconds
```

Cadence: **`SEARCH_RECONCILE_EVERY_MS`, default 60 000 (1 min)**, not 24 h. A one-minute
sweep against an indexed, oldest-first query is cheap and turns the worst-case invisibility
window from a day into ~1 min + `RECONCILE_STALE_MS`.

### 4.4 Schema changes

```sql
-- New: separates "when the row changed" from "when we last tried to index it".
-- Closes G6 (updatedAt semantics) and enables the G4 index.
ALTER TABLE search_records
  ADD COLUMN index_attempted_at timestamptz,
  ADD COLUMN index_attempts     integer NOT NULL DEFAULT 0;

-- Closes G4: the sweep's exact predicate, and it only holds unconverged rows.
CREATE INDEX search_records_unsynced_idx
  ON search_records (index_attempted_at)
  WHERE index_state <> 'INDEXED';

-- Closes G10: lets the purge job find reclaimable rows.
CREATE INDEX search_records_purgeable_idx
  ON search_records (deleted_at)
  WHERE is_deleted = true AND index_state = 'INDEXED';
```

`index_state` enum, `index_error`, `indexed_at` all stay. `index_attempts` gives the sweep a
backoff input and makes "stuck forever" observable rather than inferred.

**On G6 specifically:** keep `toMeiliDocument`'s `updatedAt` as-is for sort/display, but stop
letting the INDEXED stamp mutate `updated_at`. `markIndexState` must write
`{index_state, index_error, indexed_at, index_attempted_at, index_attempts}` **without**
touching `updated_at` — i.e. an explicit `updatedAt: <the row's existing value>` in the
`.set()`, or a repository-level raw update that bypasses `$onUpdate`. Once that holds,
`updated_at > indexed_at` becomes a truthful drift predicate and can back an audit endpoint.

### 4.5 Index-existence guarantee (G7)

Add to `SearchEngine`: nothing. Add to the processor a small memoised guard:

```ts
// One ensureIndex per (collection, process lifetime). Cheap after the first call,
// and it is the difference between "Meili volume wiped" being self-healing versus
// silently serving an unconfigured index.
private readonly ensured = new Set<string>();
private async ensureIndexOnce(collection: string): Promise<void> {
  if (this.ensured.has(collection)) return;
  const def = await this.registry.resolve(collection);
  if (def) await this.engine.ensureIndex(def.definition);
  this.ensured.add(collection);
}
```

Additionally make `reindex-collection` call `ensureIndex` **before** `clearIndex`, so
`/reload` is a complete repair (settings + documents) rather than documents-only.

### 4.6 Collection lifecycle ordering (G9)

- **Create:** insert the DB row **first**, then `ensureIndex`. If `ensureIndex` fails, leave the
  row and let boot convergence / the next write's `ensureIndexOnce` repair it. Postgres-first
  is the stated principle; the current order violates it.
- **Update with field changes:** `ensureIndex` (settings) → DB row → invalidate → enqueue
  `reindex-collection`. Unchanged, this order is already correct.
- **Delete:** soft-delete rows and the collection row, then `deleteIndex`. On `deleteIndex`
  failure, enqueue a retryable `drop-index` job instead of only logging.
- **Re-create of a previously-used name:** `ensureIndex` then `clearIndex` when the index
  already exists, so a recycled name never inherits stale documents.

### 4.7 Registry coherence across instances (G8)

Cheapest correct option, given Redis is already a dependency: **publish invalidations**.

```
CollectionService.{create,update,remove}  →  redis PUBLISH search:registry:invalidate <name>
every instance subscribes                →  IndexRegistry.invalidate(name) + ensured.delete(name)
```

Fallback for a missed message: give registry entries a short TTL (default 60 s) so a stale
compiled field-spec self-heals within a minute even if pub/sub delivery is lost. Both
mechanisms are small; the TTL alone is acceptable if pub/sub is deemed not worth the wiring.

### 4.8 Throughput (G5)

| Change | Effect |
|---|---|
| Batch job payload `{collection, ids[]}`, cap 500 | 1 Meili task per batch instead of per record |
| `BullModule.registerQueue({name, ...})` + `@Processor(name, {concurrency: SEARCH_INDEX_CONCURRENCY})`, default 4 | overlaps `waitForTask` stalls across batches |
| `persist` upsert via one `ON CONFLICT` statement | removes the per-record SELECT-then-write round-trips |
| `markIndexStateMany(ids[], ...)` | one UPDATE per batch instead of per record |

Meili applies its own task queue serially, so the goal is not parallel indexing — it is to
stop paying a full request/queue/DB round-trip per document and to stop parking a worker
slot on a single-document task.

### 4.9 Retention / purge (G10)

New repeatable job `purge-records`, daily:

```
DELETE FROM search_records
 WHERE is_deleted = true
   AND index_state = 'INDEXED'          -- Meili has confirmed the removal
   AND deleted_at < now() - SEARCH_PURGE_AFTER   -- default 30 days
 LIMIT batch                            -- bounded, repeat until under threshold
```

Also fix `softDeleteByCollection` (`repository.ts:115`): it currently stamps `INDEXED` at
soft-delete time, asserting a Meili state it has not verified. It should stamp `PENDING` and
let the sweep confirm removal — otherwise a failed `deleteIndex` leaves documents live in
Meili with rows that claim to be converged.

Separately worth flagging as a product decision, not a bug: mailbox stores the full email
body twice — once in `email_messages.body_text` and again inside
`search_records.document` for `inbound_email`. That is deliberate (the search record is the
read model) but it doubles storage on the largest table in the system and means `markSeen`
rewrites the entire body to flip one boolean. If storage matters, index a truncated body
(e.g. first 8–16 KB) and keep the full text only in `email_messages`.

### 4.10 Operability (G11, G12)

- **Admin endpoint** `GET /search/collections/:name/sync-status` → counts by `index_state`,
  `oldest_unsynced_age_seconds`, last 20 `FAILED` rows with `index_error`. This is the missing
  "is my pipeline healthy" answer.
- **Health indicator** extended: Meili liveness **plus** `unsynced_total` and
  `oldest_unsynced_age_seconds` against a configured threshold → `down` when the sweep is not
  keeping up. A green health check while thousands of rows sit `FAILED` is the current state.
- **Metrics** (counters/gauges): `search_index_success_total`, `search_index_failure_total`,
  `search_enqueue_failure_total`, `search_unsynced_records`, `search_index_lag_seconds`.
- **`maxTotalHits`** derived from config (`SEARCH_MAX_TOTAL_HITS`, default 10 000) instead of
  the hardcoded `1000`, and validated to be ≥ `SEARCH_MAX_PAGE_SIZE`.

### 4.11 Read-your-writes affordance

Keep 202/eventual as the default — it is the right default. Add two escape hatches:

- `POST records?wait=true` — after enqueueing, poll `index_state` up to
  `SEARCH_WAIT_TIMEOUT_MS` (default 5 000) and return `200` with the settled state, or `202`
  on timeout. Useful for tests, imports, and UI flows that immediately re-query.
- Document explicitly (OpenAPI + the design doc) that `GET records/:id` is the authoritative
  read and returns `indexState`, so clients have a defined way to observe convergence.

### 4.12 New configuration

| Var | Default | Purpose |
|---|---|---|
| `SEARCH_RECONCILE_EVERY_MS` | `60000` | sweep cadence (was an un-wired 24 h) |
| `SEARCH_RECONCILE_BATCH` | `500` | rows per sweep |
| `SEARCH_INDEX_CONCURRENCY` | `4` | BullMQ worker concurrency |
| `SEARCH_INDEX_BATCH_SIZE` | `500` | ids per batched index job |
| `SEARCH_MAX_TOTAL_HITS` | `10000` | Meili `pagination.maxTotalHits` |
| `SEARCH_PURGE_AFTER_DAYS` | `30` | soft-deleted row retention |
| `SEARCH_WAIT_TIMEOUT_MS` | `5000` | `?wait=true` ceiling |
| `SEARCH_LAG_ALERT_SECONDS` | `300` | health-check threshold |

All go through `env.validation.ts` and surface on `SearchConfig`, matching the existing
pattern. Add every one to `api/env.example` — note that file currently omits the
Meilisearch block entirely (tracked separately in this session's env work).

---

## 5. Failure matrix (target behaviour)

| Failure | Current | Target |
|---|---|---|
| Meili down during indexing | 3 retries → `FAILED` → **stuck forever** (G1) | 3 retries → `FAILED` → sweep retries every 60 s until it converges |
| Redis down at `persist` | row committed, **500 to caller**, record never indexed | row committed, `202` returned, sweep indexes it once Redis returns |
| Process killed between commit and enqueue | record never indexed | sweep picks it up within ~1 min + stale threshold |
| Meili data volume wiped while app runs | writes silently land in an unconfigured auto-created index; filters break at query time | `ensureIndexOnce` recreates settings on the next write; `/reload` fully repairs |
| Meili down at query | `503 SEARCH_UNAVAILABLE` | unchanged (correct) |
| Field-spec changed on instance A | instance B validates against stale spec until restart | pub/sub invalidation, TTL as backstop |
| Collection deleted, `deleteIndex` fails | orphan index, logged only; rows falsely marked `INDEXED` | retryable `drop-index` job; rows marked `PENDING` until removal is confirmed |
| Partial batch DB failure mid-`persist` | partial commit + 500 | transactional — all or nothing |
| Backlog of `FAILED` rows | green health check, no signal | health `down` past `SEARCH_LAG_ALERT_SECONDS`; visible on `/sync-status` |

---

## 6. Change-set

**Modified**
- `search-service/schedulers/search-reconciliation.scheduler.ts` — implement
  `OnApplicationBootstrap`; switch to `upsertJobScheduler`; cadence from config.
- `search-service/search-record.service.ts` — transactional batch upsert; non-fatal enqueue;
  batched job payload; optional `?wait=true`.
- `search-service/processors/search-indexing.processor.ts` — batched `index-records` handler;
  `ensureIndexOnce`; `markIndexStateMany`; ordered/grouped `reconcile`; new `purge-records`
  and `drop-index` handlers; `concurrency` option.
- `search-service/search-record.repository.ts` — `upsertMany`, `markIndexStateMany`,
  `findUnsynced` (ordered, `index_attempted_at`), `countByState`, `purgeSoftDeleted`; stop
  bumping `updated_at` on index stamps; `softDeleteByCollection` → `PENDING`.
- `search-service/index-registry.ts` — TTL + `invalidate` via Redis subscription.
- `search-service/collection.service.ts` — DB-before-`ensureIndex` on create; retryable index
  drop; clear-on-recycled-name.
- `infrastructure/search-engine/search-engine.service.ts` — `maxTotalHits` from config.
- `infrastructure/health/meili.health.ts` + `health.controller.ts` — lag/backlog indicator.
- `config/configurations/search.config.ts`, `config/env.validation.ts`, `env.example` — new vars.
- `infrastructure/database/schema/search.schema.ts` + a new drizzle migration.

**New**
- `search-service/search-status.controller.ts` — admin `/sync-status`.
- `search-service/schedulers/search-purge.scheduler.ts` — daily purge registration.
- `search-service/search.metrics.ts` — counters/gauges.

**Also worth fixing while in here (same class of bug, outside search)**
- `file-processor/schedulers/file-reconciliation.scheduler.ts` — identical dead scheduler
  (`FILE_RECONCILE_JOB` never enqueued). Same one-line class of fix.

---

## 7. Rollout plan — implementation status

All four phases are **implemented** (2026-09-05). Migration `0010_fine_retro_girl.sql`
has been applied to the `cybernetics_cli` dev database.

**Phase 1 — durability** ✅
1. ✅ `SearchReconciliationScheduler` implements `OnApplicationBootstrap` and registers via
   `upsertJobScheduler`, wrapped so a Redis outage degrades to "no sweep this boot".
2. ✅ `SEARCH_RECONCILE_EVERY_MS` defaults to 60 s (was an un-wired 24 h).
3. ✅ `index_attempted_at` + `index_attempts` added, with the partial
   `search_records_unsynced_idx`; `findUnsynced` orders oldest-attempt-first.
4. ✅ The index handoff is non-fatal — a failed `queue.add` logs, counts, and returns 202.
5. ✅ The batch write is a single `ON CONFLICT` upsert inside a transaction.

**Phase 2 — correctness hardening** ✅
6. ✅ `ensureIndexOnce` memoised per process; `reindex-collection` reapplies settings first.
7. ✅ Index stamps assign `updated_at` to itself, suppressing Drizzle's `$onUpdate`.
8. ✅ Collection create is DB-first then Meili; delete retries via a `drop-index` job;
   create clears the index so a recycled name cannot inherit documents.
9. ✅ `softDeleteByCollection` leaves records `PENDING`; only an observed index drop
   (`markCollectionPurged`) claims convergence.

**Phase 3 — scale** ✅
10. ✅ Batched `index-records` job carrying `{collection, ids[]}`; `markIndexStateMany`;
    one upsert statement per persist call.
11. ✅ Worker concurrency from config, applied in `onModuleInit` (the `@Processor`
    decorator is evaluated before ConfigService exists).
12. ✅ `maxTotalHits` from `SEARCH_MAX_TOTAL_HITS`, validated ≥ `SEARCH_MAX_PAGE_SIZE`.

**Phase 4 — operability** ✅
13. ✅ `GET /search/sync-status` and `GET /search/collections/:name/sync-status` (admin);
    `SearchMetrics` counters; Meili health indicator now reports index lag.
14. ✅ `purge-records` job + `SearchPurgeScheduler` + retention config.
15. ✅ Registry TTL + Redis pub/sub invalidation.
16. ✅ `POST .../records?wait=true` bounded convergence poll.

**Also fixed:** `FileReconciliationScheduler` had the identical dead-scheduler bug
(`FILE_RECONCILE_JOB` was never enqueued); it now self-registers the same way.

### 7.1 Deviations from the design above

Three deliberate departures, each because the design as written would have been wrong:

1. **Metrics are process-local, not Prometheus.** §4.10 said "counters/gauges". The repo has
   no metrics exporter, and adding one is a larger dependency decision than this change
   owns. `SearchMetrics` holds in-process counters surfaced on `/sync-status`; the durable
   truth stays in `search_records` (`index_state`, `index_attempts`, `index_error`), which
   the same endpoint reports, so a restart cannot hide a backlog.

2. **The sweep also matches `index_attempted_at IS NULL`, and the migration backfills it.**
   The predicate as designed (`index_attempted_at < cutoff`) is never true for NULL, so
   every record written before the migration would have been permanently invisible to the
   repair loop — the exact bug being fixed. `persist` and `softDelete` now stamp the handoff
   time, so NULL only ever means "written by a path that never handed off", and the NULL
   branch plus `NULLS FIRST` ordering catches those first.

3. **The registry's Redis dependency is optional and its subscribe is bounded.** A plain
   `await subscriber.subscribe(...)` hangs indefinitely against an unreachable Redis,
   because ioredis queues commands offline and retries forever — that would have made boot
   hard-require Redis, contradicting §4.3. The subscriber is created with
   `enableOfflineQueue: false` and the handshake races a 2 s timeout; the client itself is
   `@Optional()` so a module subset booted without `CacheModule` degrades to TTL-only
   coherence rather than failing to construct.

### 7.2 Defects the live e2e run exposed

Three bugs survived unit tests and were only caught by running against real
Postgres + Redis + Meilisearch. Two were in this change; one was pre-existing.

1. **A per-process "ensure once" memo cannot repair a mid-life index wipe.** The design's
   `ensureIndexOnce` (§4.5) assumed an index can only be missing at process start. The e2e
   test written for exactly the wiped-volume scenario failed with *"Attribute `status` is not
   filterable"*: the collection was already in the memo, so the deleted index was silently
   re-created by `addDocuments` with default settings. Existence is now verified on every
   batch — one cheap `GET`, no async task — while applying settings, the expensive part,
   stays memoised. `ensureIndexOnce` became `ensureIndexReady`.

2. **MeiliSearch error codes live at `error.cause.code`, not `error.code`.** A `deleteIndex`
   followed by a write reported *"primary key inference failed… found 2 fields ending with
   `id`: 'externalId' and 'id'"*. The cause: `indexExists` read `.code`, which is `undefined`
   on a `MeiliSearchApiError` (its own keys are only `name`, `cause`, `response`), so a
   missing index raised an unexpected error instead of returning `false` — the index was
   never rebuilt, and the next `addDocuments` auto-created one with no primary key, failing
   every subsequent task. Both `indexExists` and the pre-existing `isAlreadyExists` now go
   through one `errorCode()` helper that reads either shape. The existing code was not
   actually broken — `createIndex` fails as a *task*, which `waitForTask` converts into a
   `SearchEngineError` that does carry `.code` — but the two shapes were indistinguishable
   at the call site, which is what made the new code wrong.

3. **A reload could claim convergence for records it never indexed.** `reindex-collection` is
   `clearIndex` followed by a repage of Postgres, and it ended with `markCollectionIndexed`,
   stamping *every* live row `INDEXED`. A record persisted while the rebuild was running is
   not in any page, and its own document can be wiped by the clear — yet it would be marked
   converged, so the reconciliation sweep (which only looks at unconverged rows) would never
   revisit it. The document simply disappears from search until the next reload. Now the
   reload stamps only the ids it actually wrote, all with the pass's single start timestamp,
   which makes concurrent writers identifiable (`indexedAt` strictly newer) and hands them
   back to the indexer. `markCollectionIndexed` is gone.

The general lesson is worth keeping: every one of these is a failure of a *mocked* assumption
about an external system, so no amount of unit testing would have surfaced them.

### 7.3 Follow-up: the keyless-index failure loop (2026-09-05)

After the change was deployed, the sweep began reporting six records as failed every
~6 minutes:

```
Meili task 1106 failed: The primary key inference failed as the engine found
2 fields ending with `id` in their names: 'externalId' and 'id'.
```

The sweep was behaving correctly — it had found genuinely broken records. Two further
defects were behind them, one of them pre-existing and never previously exercised.

1. **No document write ever stated the primary key.** `addOrReplace` called
   `addDocuments(docs)` with no options, leaving the engine to *infer* which field
   identifies a document. `toMeiliDocument` emits both `id` and `externalId`, so inference
   is ambiguous and the task fails — identically on every retry, forever.

2. **`ensureIndex` could not repair a keyless index.** It sets the key only through
   `createIndex(uid, { primaryKey })`; on an existing index that fails with
   `index_already_exists` and is swallowed, and `updateSettings` does not cover the primary
   key. Once an index existed without a key, no code path could add one.

Combined, an index auto-created by a document write (which is what happened during the
earlier pre-fix e2e runs) was permanently unusable. **This was never test-only**: every
production collection sets `externalId` — `documents` (`externalId: fileId`) and
`inbound_email` (`externalId: row.id`) — so any wiped Meili volume or deleted index would
have produced the same permanent loop.

**Fixes.** Every write now passes `RECORD_PRIMARY_KEY` (`search.constants.ts`, the single
source of truth also used by `fieldSpecToIndexDefinition`). Meili sets the key on an index
that lacks one, so this both prevents the failure and *self-heals* an already-broken index
on the next write. `ensureIndex` additionally repairs a missing or mismatched key via
`updateIndex`, best-effort, so boot convergence fixes it even with no writes flowing.

**A consequence worth stating.** Supplying the primary key means a write against a missing
index now *succeeds* and auto-creates the index with **default settings**, where it used to
fail loudly. That is the silent corruption §4.5 set out to prevent, so the guard was
strengthened: `indexExists` became `needsEnsure(def)`, which compares the index's
attribute configuration against the definition rather than checking mere existence. It
costs the same single read and detects both "missing" and "reset to defaults". The e2e
suite caught this immediately — the vanished-index test began failing with "Attribute
`status` is not filterable" once writes stopped failing.

**Retry backoff.** A record that can never succeed was re-driven every ~6 minutes forever,
logging an ERROR each time. `findUnsynced` now doubles the wait per attempt
(`staleMs × 2^attempts`, capped by `SEARCH_RECONCILE_MAX_BACKOFF_MS`, default 1 h). It
never gives up, it just stops burning retries and flooding the log.

**Also fixed while here:** `IndexRegistry` created its subscriber with
`enableOfflineQueue: false`, which rejects `subscribe()` whenever the socket has not
finished connecting — the common case at startup ("Stream isn't writeable"). Registry
invalidation would therefore almost never have been wired up, silently degrading to the
TTL. The offline queue is enabled again; the 2 s timeout still bounds boot.

**Test hygiene.** `search.e2e-spec.ts` created a collection per run and never removed it —
that is how eight orphaned collections accumulated. It now deletes its collection in
`afterAll`. The reload test also left a destructive rebuild in flight, racing every test
after it; it now waits for completion, keyed on `indexedAt` changing (hit count is useless
as a signal — the index already holds those documents before the rebuild starts).

**Cleanup.** The eight leftover `articles_*` / `bad_*` collections were removed through the
service's own delete path. Sync status afterwards: `pending 0, indexed 40, failed 0`.

### 7.4 Deferred, deliberately

- **Mailbox body duplication** (§4.9) is untouched — it is a storage/product trade-off, not
  a defect, and needs a call on expected mail volume. Open decision #3 stands.
- No per-record backoff on the sweep: oldest-attempt-first ordering is self-balancing,
  since a retried record's `index_attempted_at` moves to the back of the queue.
  `SEARCH_MAX_INDEX_ATTEMPTS` only flags a record as needing a human; it never gives up.
- **The reload/write race is narrowed, not eliminated.** A record whose document is wiped by
  the clear *and* whose own job already stamped it INDEXED is re-driven (§7.2 item 3), but a
  reload remains a destructive rebuild. Making it non-destructive (index to a new uid and
  swap) is a larger change and was not in scope.

### 7.5 Verification

- `pnpm typecheck`, `pnpm build`: clean.
- Unit: **544 tests / 89 suites pass** (was 509/88 before this change).
- E2E against live Postgres + Redis + Meilisearch, run serially:
  `search.e2e` (18), `search-engine.e2e`, `mailbox-ingest.e2e` — **21 tests, all pass**,
  repeated to confirm stability. These include the two tests that carry the guarantees:
  reconciliation repairing a lost handoff (Phase 1), and an index auto-created without a
  primary key healing itself (§7.3). Both were confirmed to fail when their fix is
  reverted, so they genuinely pin the behaviour.
- Pre-existing failures **not** caused by this change, left as they were found: several e2e
  suites (`system`, `password-reset`, `auth-mock-validation`, and previously `search`) assert
  DTO-level `400`s but never register `ZodValidationPipe`, which only `AppModule` provides —
  so those validations never ran and the assertions could not pass. `search.e2e` now
  registers the pipe and passes; the other three still omit it. Separately, `queue.e2e` fails
  while a dev app instance is running against the same Redis, because that instance's worker
  consumes the test's job before the test's own spy sees it.

## 8. Testing strategy

Follows existing repo conventions: co-located `*.spec.ts` units, focused-module e2e (never
boot `AppModule` — the Mastra ESM/Jest break), `meilisearch` pinned to 0.45.x (CJS).

**Unit**
- Scheduler registers exactly one job scheduler with the configured cadence, and swallows a
  Redis error without throwing.
- `persist` returns `202` and does **not** throw when `queue.add` rejects.
- `findUnsynced` builds the predicate on `index_attempted_at` with `ORDER BY ... ASC`.
- `markIndexState*` does not include `updated_at` in the `.set()` payload.
- `ensureIndexOnce` calls `engine.ensureIndex` once per collection across repeated invocations.
- Batched processor: mixed live/deleted ids partition into one `addOrReplace` and one
  `deleteDocuments`; a mid-batch throw stamps `FAILED` only for the affected ids.

**Integration (Postgres)**
- Transactional `persist`: injected mid-batch failure leaves **zero** rows committed.
- Partial-unique upsert on `(collection, external_id)` still holds under `ON CONFLICT`.
- Purge deletes only `is_deleted AND INDEXED AND deleted_at < cutoff`.

**Integration (Meili, extends `test/search-engine.e2e-spec.ts`)**
- Delete the index behind the app's back, then `persist` → assert the index is recreated
  **with its configured filterable attributes** and a filtered query still works. This is the
  regression test for G7, which currently fails.

**E2E (focused modules)**
- persist → sweep → query visibility with the enqueue stubbed to fail: proves the sweep is
  the safety net, i.e. the direct test for G1.
- `/reload` clears and rebuilds including settings.
- `/sync-status` reports `FAILED` rows with their `index_error`.
- Authz matrix unchanged (admin persist/delete/reload; any authenticated principal queries).

---

## 9. Explicitly out of scope

Carried forward as deferred from v1 and still deferred:

- Nested / conditional document schemas (field-spec stays flat).
- Per-collection or per-role query ACLs (reads remain global; `search-documents` tool scopes
  by `ownerUserId` in the filter, which is the only tenant scoping today).
- Collection rename (`name` remains the immutable identity).
- Synchronous "index now" writes — `?wait=true` in §4.11 is a bounded poll, not a synchronous
  write path.
- Vector / hybrid search in Meili (a `cybernetics_embedding` database already exists from a
  prior deployment; unifying it with this pipeline is its own design).

## 10. Open decisions for you

1. **Phase 1 only, or the full four phases?** Phase 1 is a few hours and removes the actual
   durability bug; phases 2–4 are the difference between "works" and "operable at scale".
2. **Registry coherence:** Redis pub/sub, TTL-only, or accept per-instance staleness for now?
   TTL-only is one small change and covers most of the risk.
3. **Mailbox body duplication** (§4.9): leave as-is, or truncate the indexed body and keep
   full text solely in `email_messages`? Depends on expected mail volume.
4. Should the identical dead-scheduler bug in `file-processor` be fixed in the same change?
