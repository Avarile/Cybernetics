# Search Management Module — Design (v1)

**Status:** Approved design · **Date:** 2026-07-14 · **Branch:** `feat/search-integration`
**Location:** `src/features/search-service`

## 1. Purpose & scope

Turn `search-service` into a **generic data processor**: a service where admins persist
arbitrary structured records and everyone queries them.

- Records are written to **Postgres first** — Postgres is the **source of truth**.
- Records are then asynchronously indexed into **MeiliSearch**.
- **Queries hit MeiliSearch only.** Meili is a rebuildable read model.
- **Admins** persist/delete records, manage collections, and trigger reloads.
  **Users and agents** can query everything; they cannot persist.
- All index mutations (index / delete / reload) run **off the request path via BullMQ**.

This is v1: simple, clean, reliable. Flexibility knobs that add moving parts without a
current need are explicitly deferred (see §11).

## 2. Key decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Record storage model | **Generic JSONB document store** — one `search_records` table, one repo serving both persistence and reindex |
| 2 | Collection management | **Dynamic** — collections created/edited at runtime via admin API, backed by a `collections` table |
| 3 | Schema representation | **Field-spec** — a typed field list per collection that drives validation **and** Meili attribute config (one source of truth, no drift) |
| 4 | Read scoping | **Global** — any authenticated principal queries all live records in a collection; authorization is role-based only |
| 5 | Consistency | **Eventual** — a record becomes queryable once its async index job completes |
| 6 | Outbox | **Lightweight** — `indexState` column on the record row is the outbox; no separate table |

## 3. Component layering

```
                    ┌──────────────── HTTP (NestJS) ────────────────┐
 CollectionController        RecordController        SearchQueryController
 (admin: CRUD collections)   (admin: persist/delete) (any auth: query; admin: reload)
        │                          │                        │
        ▼                          ▼                        ▼
 ┌───────────────────┐    ┌──────────────────────────────────────────┐
 │ CollectionService │    │ SearchRecordService                       │
 │ - validate spec   │    │ - validate doc vs field-spec              │
 │ - Meili lifecycle │    │ - persist / soft-delete (PG = truth)      │
 │ - refresh registry│    │ - enqueue index jobs / reload             │
 └───────┬───────────┘    │ - query (Meili only)                      │
         │                └───────┬──────────────────────┬────────────┘
         ▼                        ▼                      ▼
 CollectionRepository    SearchRecordRepository    IndexRegistry (cache)
         │                        │                 (compiled field-spec →
         ▼                        ▼                  IndexDefinition + validator)
     ┌────────── Postgres (Drizzle) ──────────┐         ▲
     │ collections        search_records      │─────────┘ loads/refreshes from
     └────────────────────────────────────────┘           CollectionRepository

 SearchIndexingProcessor (BullMQ)  ← index-record / delete-record / reindex-collection
      reads current rows from SearchRecordRepository, applies via SearchEngine, stamps state
 SearchReconciliationScheduler     ← periodic sweep re-enqueues PENDING/FAILED/stale records
 SearchEngine (existing infra)     ← index-agnostic Meili wrapper (unchanged)
```

Responsibilities are isolated so each unit can be understood and tested alone:

- **Controllers** — HTTP + authz only; delegate to services.
- **CollectionService** — collection CRUD, drives Meili index lifecycle
  (`ensureIndex` + settings, delete), validates the field-spec, refreshes the registry.
- **SearchRecordService** — validate documents, persist/soft-delete records, enqueue index
  jobs, run reloads, and query (delegates to `SearchEngine`).
- **Repositories** — Drizzle data access only (`extends BaseRepository`).
- **IndexRegistry** — in-memory cache of compiled collections (field-spec → `IndexDefinition`
  + validator). Loaded at boot, refreshed on every collection mutation.
- **DocumentValidator** (pure) — validates a `document` against a field-spec.
- **fieldSpecToIndexDefinition** (pure) — derives Meili `searchable/filterable/sortable`
  from field flags.
- **SearchIndexingProcessor** — BullMQ worker applying mutations to Meili.
- **SearchReconciliationScheduler** — drift-repair sweep.

## 4. Schema

### 4.1 `collections` (config — source of truth for what is queryable)

| column | type | notes |
|---|---|---|
| `...baseColumns` | | uuid `id` PK, `createdAt`, `updatedAt`, `isDeleted`, `deletedAt` |
| `name` | `varchar(100)` | **immutable logical id**; used in URLs and as the Meili index name (`${indexPrefix}${name}`). Pattern `^[a-z][a-z0-9_]*$` |
| `displayName` | `varchar(255)` | human label |
| `description` | `varchar(500)` | nullable |
| `fields` | `jsonb` `$type<FieldSpec[]>` | the field-spec (§4.2) |

Indexes: `UNIQUE(name) WHERE isDeleted = false`.

### 4.2 `FieldSpec` (drives validation **and** Meili attributes)

```ts
type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]';

interface FieldSpec {
  name: string;          // ^[a-zA-Z][a-zA-Z0-9_]*$; not a reserved name (below)
  type: FieldType;
  required?: boolean;    // default false
  searchable?: boolean;  // → searchableAttributes  (string / string[] only)
  filterable?: boolean;  // → filterableAttributes
  sortable?: boolean;    // → sortableAttributes     (scalar types only)
  enum?: (string | number)[];   // optional allowed values
}
```

Reserved field names (system fields on the Meili doc; rejected in a field-spec):
`id`, `externalId`, `collection`, `createdAt`, `updatedAt`.

A valid field-spec must have ≥1 `searchable` field. `searchable` is only allowed on
`string`/`string[]`; `sortable` only on scalar types (`string`/`number`/`boolean`/`date`).

### 4.3 `search_records` (data — Postgres is the source of truth)

| column | type | notes |
|---|---|---|
| `...baseColumns` | | uuid `id` PK → **the Meili document primary key** |
| `collection` | `varchar(100)` | the collection's immutable `name` |
| `externalId` | `varchar(255)` | caller's business key, **nullable**; enables idempotent upsert |
| `document` | `jsonb` `$type<Record<string, unknown>>` | the validated payload |
| `checksum` | `varchar(64)` | sha256 of canonical(`{ externalId, document }`); skip re-index if unchanged |
| `indexState` | `enum('PENDING','INDEXED','FAILED')` | lightweight outbox marker; default `PENDING` |
| `indexError` | `varchar(1000)` | last failure reason, nullable |
| `indexedAt` | `timestamptz` | last successful Meili sync, nullable |

Indexes:
- `UNIQUE(collection, externalId) WHERE externalId IS NOT NULL AND isDeleted = false` — upsert key
- `INDEX(collection, isDeleted)` — query/reload scans
- `INDEX(collection, indexState)` — reconciliation sweep

**Meili document** (built at index time): `{ id, externalId?, ...document, createdAt, updatedAt }`.
System fields `createdAt`/`updatedAt` are filterable + sortable so a default `createdAt:desc`
sort works.

### 4.4 Schema rationale

1. **Records reference the collection by immutable `name`, not a hard FK.** Name is the
   identity end-to-end (URL, Meili index, record link). Collection **delete** purges that
   collection's records + deletes the Meili index, so orphans cannot occur.
2. **Meili primary key = internal `id` (uuid)**, never `externalId` — safe charset, always
   present. `externalId` is only the upsert/business key.
3. **`indexState` is the outbox** — PENDING/FAILED rows are exactly what reconciliation repairs.

## 5. API surface & authorization

Global `JwtAuthGuard` + `RolesGuard` already run. `@Roles('admin')` is applied per
method/controller. All routes nest under `/search/collections/:name/...` so there is no
`collections`-vs-`:collection` route collision.

| Method & path | Controller | Who | Purpose |
|---|---|---|---|
| `POST /search/collections` | Collection | **admin** | create collection → `ensureIndex` + settings, refresh registry |
| `GET /search/collections` | Collection | any auth | list collections |
| `GET /search/collections/:name` | Collection | any auth | get one collection's config |
| `PATCH /search/collections/:name` | Collection | **admin** | update field-spec/settings → update Meili settings + enqueue reload |
| `DELETE /search/collections/:name` | Collection | **admin** | soft-delete + purge records + delete Meili index |
| `POST /search/collections/:name/records` | Record | **admin** | persist one or many (upsert on `externalId`) → PG + enqueue index |
| `DELETE /search/collections/:name/records/:id` | Record | **admin** | soft-delete record → enqueue Meili delete (`:id` = record id or `externalId`) |
| `POST /search/collections/:name/reload` | Query | **admin** | full reload: clear Meili + reindex from PG via BullMQ |
| `POST /search/collections/:name/query` | Query | any auth | query — **Meili only** |

Roles: `guest | user | admin | agent`. `user` and `agent` may query + read collection
config; only `admin` mutates.

### DTOs (Zod + `ZodValidationPipe`)
- `createCollectionSchema` / `updateCollectionSchema` — validate the field-spec itself
  (name pattern, field types, reserved-name rejection, ≥1 searchable, flag/type compatibility).
- `persistRecordsSchema` — `{ records: [{ externalId?, document }] }`, bulk-capable.
- Query reuses the existing `searchQuerySchema`.

## 6. Write & sync flow (eventual consistency)

**Persist** (`POST .../records`):
1. Resolve collection from `IndexRegistry` (404 if unknown).
2. Validate each `document` against the field-spec (`DocumentValidator`) → 400 with field errors.
3. Compute `checksum`; **upsert** by `(collection, externalId)` when `externalId` present,
   else insert. If checksum unchanged and row already `INDEXED`, skip (idempotent no-op).
4. Set `indexState = PENDING`; **commit to Postgres.**
5. Enqueue `index-record` job carrying the **record `id`** (not the payload).
6. Respond `202` with `{ id, indexState: 'PENDING' }`.

**Processor `index-record`** (`attempts: 3`, exponential backoff): load the current row by id
→ if soft-deleted, `deleteDocuments([id])`; else build the Meili doc, `addOrReplace` +
`waitForTask` → stamp `INDEXED` + `indexedAt`, clear `indexError`. On throw → stamp `FAILED`
+ `indexError`; BullMQ retries. Reading the row fresh means rapid updates coalesce to the
latest state.

**Delete record:** soft-delete row (`indexState = PENDING`), enqueue `delete-record` → Meili
delete. Row retained soft-deleted (audit); reconciliation guarantees Meili no longer serves it.

**Reload** (`POST .../reload`, admin): enqueue `reindex-collection`. Processor streams **all
live rows** for the collection from PG in batches → `clearIndex` → `addOrReplace` per batch +
`waitForTask` → stamp all `INDEXED`. This is "remove all in the index, then reload from the
DB, all through BullMQ."

## 7. Reliability & reconciliation

- **`SearchReconciliationScheduler`** (repeatable, e.g. daily + on-demand): find records with
  `indexState IN (PENDING, FAILED)` older than a threshold and re-enqueue `index-record`.
  Repairs lost jobs / Redis flushes without a full reload.
- **Boot convergence** (`onApplicationBootstrap`, existing): load collections into the
  registry and `ensureIndex` each — best-effort; never blocks startup on Meili.
- **PATCH that changes attributes** enqueues a `reindex-collection` so Meili settings + docs
  converge safely.

## 8. Error handling & edge cases

| Case | Behaviour |
|---|---|
| Unknown / soft-deleted collection | `404` |
| Document fails field-spec | `400` with per-field errors |
| Duplicate `externalId` | upsert updates the existing row (not a conflict) |
| Field-spec uses reserved name / no searchable field / flag-type mismatch | `400` at collection create/update |
| Collection create when name exists (live) | `409` |
| Meili down at **query** | `503` (already implemented) |
| Meili down at **index** | job retries → `FAILED` → reconciliation re-enqueues |
| Collection delete with records | purge records (soft-delete) + delete Meili index |

## 9. Testing strategy

Follows repo conventions and known constraints: boot **focused module subsets** (not
`AppModule`) in e2e to avoid the Mastra ESM/Jest break; keep `meilisearch` on 0.45.x
(CJS); datastores on PG `:30898` / Redis `:30490`.

- **Unit:** `DocumentValidator` (types, required, enum, arrays, reserved names);
  `fieldSpecToIndexDefinition` mapping; query filter/sort building; checksum / upsert-skip.
- **Integration (repo):** `collections` + `search_records` CRUD, partial-unique upsert,
  soft-delete / purge.
- **Processor:** `index-record` / `delete-record` / `reindex-collection` against Meili.
- **E2E (focused module):** full authz matrix (admin vs user vs agent vs guest per endpoint);
  persist → process → query visibility; reload clears + reloads; validation 400s.

## 10. Change-set vs. existing files

**New**
- `src/infrastructure/database/schema/search.schema.ts` (both tables) + barrel export + drizzle-kit migration
- `collection.repository.ts`, `search-record.repository.ts`
- `collection.service.ts`, `document-validator.ts` (+ field-spec types)
- `collection.controller.ts`, `record.controller.ts`
- DTOs: `dto/create-collection.dto.ts`, `dto/update-collection.dto.ts`, `dto/persist-records.dto.ts`

**Changed**
- `index-registry.ts` → DB-backed cache (compiled field-spec → `IndexDefinition` + validator);
  drop the static `APP_SEARCH_INDEXES` array
- `search.service.ts` → `SearchRecordService`: persist/delete/reload/query; **remove
  `ownerScope` filtering** (global reads)
- `search.controller.ts` → `SearchQueryController` (`/query` + `/reload`)
- `processors/search-indexing.processor.ts` → id-keyed jobs + collection reload from repo
- `schedulers/search-reconciliation.scheduler.ts` → sweep by `indexState`
- `search.constants.ts` (job names), `search.types.ts` (field-spec, record/collection types),
  `search-service.module.ts` (wiring)

**Retired**
- `RegisteredIndex.source()` callback model and the static registry array (superseded by DB
  collections + the generic record repo as the reindex source)
- `ownerScope` read-filtering (reads are global in v1)

## 11. Deferred (post-v1)

- Nested / conditional document schemas (JSON Schema + Ajv) — field-spec is flat by design.
- Per-collection or per-role query access control (all authenticated principals query all
  collections in v1).
- Owner/tenant read scoping (records are global in v1).
- Collection rename (name is the immutable identity in v1).
- Synchronous "index now" writes (all indexing is async via BullMQ in v1).
