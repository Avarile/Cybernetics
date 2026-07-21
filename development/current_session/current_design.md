# Design v2 — Single-Record Read, Schema Management, Creation Redesign & Query Enrichment

**Status:** Design phase (v2). Supersedes the v1 design in this session (v1 is built and preserved in git history + auto-memory `data-management-panel-v1`).
**Scope:** Frontend, in `frontend/`, over the existing `search-service` + `file-processor` APIs — **plus one required and one optional backend change in `api/`** (both in `search-service`, both small):
- **Required:** `GET /search/collections/:name/records/:id` (single-record read from Postgres).
- **Optional:** range operators in the query filter builder, to enable date-range filtering.

---

## 0. What v1 already ships (baseline)

A schema-driven records manager at `/dashboard/data-management`: collection switcher, server-paginated TanStack table (manual pagination/sort/filter), exact-match filter popover, debounced full-text search, single-column sort, admin-gated create/edit/delete, file attachments (presigned), and a detail drawer. Three state layers keep UI components near-stateless: **Zustand** (query/selection/panels), **RHF+zod** (record form, schema built from `FieldSpec[]`), **SWR** (server cache). Everything renders from the active collection's `FieldSpec[]` via `field-to-{column,input,filter,zod,cell}`.

**The two v1 limitations this iteration removes:**
1. Detail/edit only sees rows already in `results.hits` (`hits.find(id)`) — you can't open, edit, or link to a record that isn't on the current page, and a just-created record (async-indexed) isn't visible until it lands in Meili. The create flow papers over this with a `setTimeout(1200ms)` guess.
2. No collection/schema management UI (records only).

---

## 1. This iteration — locked decisions

| # | Decision |
|---|---|
| 1 | **Scope:** records CRUD **+ collection/schema management**. |
| 2 | **Add `GET /records/:id` from Postgres** (reversal of the earlier Meili-only stance). It is the correctness backbone for detail/edit/deep-link and the just-created record. |
| 3 | **Search/list stays Meili-only** — no PG list endpoint. Browsing/searching still goes through `POST /query`. |
| 4 | **IA:** single page + collection dropdown; schema management via **modals/sheets**. Per-record deep links via **`?record=<id>`** on the same page (resolved through the new PG read), not routed record pages. |
| 5 | **Query enrichment:** facets+counts, recency sort, date-range filter (optional backend touch), URL-sync, highlighting, multi-sort — all confirmed. |
| 6 | **State boundary unchanged:** Zustand / RHF+zod / SWR. Optimistic pending rows live in the SWR cache, never Zustand. |

---

## 2. Backend contract

### 2.1 Existing endpoints reused (no change)

| Surface | Method | Auth | Use |
|---|---|---|---|
| `/search/collections` · `/:name` | GET | any authed | switcher · active `FieldSpec[]` |
| `/search/collections` | POST | **admin** | **create collection (schema)** — *already exists, FE will now call it* |
| `/search/collections/:name` | PATCH | **admin** | **edit collection (displayName/description/fields)** — *already exists* |
| `/search/collections/:name` | DELETE | **admin** | **delete collection** — *already exists* |
| `/search/collections/:name/query` | POST | any authed | table data (search/facets/sort) |
| `/search/collections/:name/records` | POST | **admin** | create/update (upsert on `externalId`) → 202 |
| `/search/collections/:name/records/:id` | DELETE | **admin** | delete (by id **or** externalId) → 204 |
| `/search/collections/:name/reload` | POST | **admin** | reindex → 202 |
| `/files*` | — | authed | presigned attachments (unchanged from v1) |

The collection CRUD endpoints already exist and are validated (`createCollectionSchema`, `updateCollectionSchema`, `validateFieldSpec`). Schema management is therefore **frontend-only** work against a proven API.

### 2.2 REQUIRED new endpoint — single-record read

```
GET /search/collections/:name/records/:id          (any authenticated — reads are global)
→ 200 { id, externalId, document, indexState, indexError, createdAt, updatedAt }
→ 404 SEARCH_RECORD_NOT_FOUND  (missing, soft-deleted, or collection mismatch)
```

**Placement:** on `SearchQueryController` (`@Controller('search/collections/:name')`) as `@Get('records/:id')`. That controller is the *open-read* surface (its `POST query` is open; its `POST reload` is admin via a method-level guard). `RecordController` is class-level `@Roles('admin')`, so the read must not live there.

**Service method** (`SearchRecordService.get`) mirrors `remove()`'s dual-key resolution exactly:

```ts
async get(collection: string, key: string): Promise<RecordView> {
  await this.requireCollection(collection);
  let row = UUID_RE.test(key) ? await this.records.findLiveById(key) : null;
  if (!row) row = await this.records.findLiveByExternalId(collection, key);
  if (!row || row.collection !== collection) {
    throw this.errors.create(ErrorCode.SEARCH_RECORD_NOT_FOUND);
  }
  return toRecordView(row); // { id, externalId, document, indexState, indexError, createdAt, updatedAt }
}
```

`findLiveById` / `findLiveByExternalId` already exist on `SearchRecordRepository`; `SearchRecordRow` already carries `document`, `indexState`, `indexError`, `createdAt`, `updatedAt`. So this is a thin controller method + a service method + a mapper — no schema/migration, no queue, no new dependency.

**Why it matters (design consequences):**
- **Always fresh** — reads Postgres (source of truth), so it returns a record the instant `persist` commits, *before* BullMQ indexes it into Meili.
- **Authoritative index status** — the response carries live `indexState` (`PENDING`/`INDEXED`/`FAILED`) + `indexError`, which Meili hits cannot express (a Meili hit is, by definition, already indexed).
- **Shape difference to respect:** the PG read returns `document` as a **nested object** with system fields (`id`, `externalId`, timestamps) as siblings. Search hits instead **flatten** `document` fields to the top level. The frontend models both (`RecordHit` flat; `RecordDetail` nested) and the detail/edit path consumes `RecordDetail.document` directly — cleaner than v1's `documentOf()` strip.

### 2.3 OPTIONAL backend touch — date-range filter operators

`buildFilter`/`toFilterClause` currently emit only `field = value` and `field IN […]`. True date-range filtering (`createdAt >= X AND createdAt <= Y`) needs range operators. This is a small, contained extension to the filter builder (accept `{ gte?, lte? }` range values and emit `>=`/`<=` clauses) — **still Meili-only reads, no new endpoint**. If deferred, the **recency *sort* ships free** (both `createdAt`/`updatedAt` are always sortable) and date-*range filtering* waits. Marked optional; recommended as a follow-up within this iteration if time allows.

---

## 3. Information architecture (single page + dropdown)

```
Data Management
[collection ▾ · Manage…]  [🔍 search]  [Filters ▸]  [Columns ▾] [Reindex] [+ New record]
────────────────────────────────────────────────────────────────────────────────────
12 records · sort: price ↓                                        (facets live in Filters)
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ☐  name        price   tag       ⋯                                                   │
│ ☐  Widget A    9.99    new       ⋯   → row/⋯ opens detail (?record=…) ────────────┐  │
│ ☐  Widget B    12.00   sale      ⋯                                                │  │
└──────────────────────────────────────────────────────────────────────────────────┘  │
‹ 1 2 3 ›                                                        20 / page ▾            │
                                                                                        ▼
  Manage… ──► Collection Manager dialog (list · new · edit · delete · reindex)   Detail/Edit drawer
                     └─► Collection Editor sheet (identity + FieldSpec editor)    (PG-backed, live status)
```

- **Collection dropdown** keeps switching; its footer gains a **"Manage…"** item (admin-only) → **Collection Manager** dialog.
- **Detail/Edit** is a drawer, but now **PG-backed and deep-linkable** via `?record=<id>`; `?collection=<name>` and the query params are URL-synced too.

---

## 4. Single-record read on the frontend (headline change)

### 4.1 Types + service + hook

```ts
// interfaces/search.interface.ts (additions)
export interface RecordDetail {
  id: string
  externalId: string | null
  document: RecordDocument
  indexState: IndexState            // 'PENDING' | 'INDEXED' | 'FAILED'
  indexError?: string | null
  createdAt: string
  updatedAt: string
}
```

```ts
// services/record.service.ts (addition)
get(collection: string, id: string): Promise<RecordDetail> {
  return apiClient
    .get<RecordDetail>(`${base(collection)}/records/${encodeURIComponent(id)}`)
    .then((r) => r.data)
}
```

```ts
// hooks/use-record.ts (new) — single record, polls while PENDING
export function useRecord(collection: string | null, id: string | null) {
  const key = collection && id ? (['record', collection, id] as const) : null
  const { data, isLoading, error, mutate } = useSWR<RecordDetail>(
    key,
    () => recordService.get(collection!, id!),
    { refreshInterval: (d) => (d?.indexState === 'PENDING' ? 1500 : 0) },
  )
  return { record: data, isLoading, error, mutate }
}
```

`refreshInterval` as a function polls **only** while the record is `PENDING`, then stops on `INDEXED`/`FAILED` — a live, self-terminating status without a manual timer.

### 4.2 Detail/Edit drawer redesign

`record-detail-drawer.tsx` changes from *"find the row in the current page"* to *"fetch the record by id from Postgres"*:

- Drops the `results` prop and `results.hits.find(id)`. Consumes `useRecord(collection, detailId)`.
- **Works for any record** — off the current page, filtered out, or just created and not yet in Meili.
- **Live status header:** a `RecordStatusBadge` reads `record.indexState` (`◐ Indexing · ● Indexed · ⚠ Failed` + `indexError` tooltip); it updates as polling converges.
- **Loading/error states:** skeleton while fetching; an error empty-state with retry (`mutate`) for a bad id / 404.
- **Edit** (admin + `externalId` present): `RecordForm` in edit mode, seeded from `record.document` (nested — no `documentOf` strip). On save → `persist` by `externalId` → `mutate(['record',…])` + bounded list revalidation. Records with `externalId === null` render read-only (a second persist would duplicate them), with an explanatory badge.

### 4.3 Deep-linking on the single page (`?record=`)

A small URL-sync hook (`use-query-url-sync.ts`, also used by query state in §7) maps `store.detailId ↔ ?record` and `store.collection ↔ ?collection`:

- On mount: if `?collection` / `?record` are present, hydrate the store (`setCollection`, `openDetail`) → the drawer opens and `useRecord` fetches from PG.
- On change: pushing/replacing the param keeps a **shareable record URL** without routed record pages — satisfying "deep-link to a record" while honoring the single-page IA (decision #4).
- A future routed `/[collection]/[id]` page is a **non-goal** now; the PG read makes it trivial later if wanted.

---

## 5. Creation & editing redesign (the async-indexing gap, solved honestly)

**Status model — three sources, one truth:**
- **Detail drawer** = authoritative (PG read, live `indexState`, polls while PENDING).
- **Table** = whatever Meili returns = INDEXED records. A `PENDING` record simply isn't in the list yet — so the list is *not* where we assert "your record exists."
- **Optimistic pending row (optional):** immediately after create we may prepend a synthetic row (submitted `document` + returned `id`, badged PENDING) so the table doesn't look empty; it reconciles away on the next list revalidation. This is cosmetic, not load-bearing.

**Create flow (replaces the 1200ms guess):**
1. `RHF submit → (attachments upload → ids) → recordService.persist(collection, [{ externalId, document }]) → 202 [{ id, indexState:'PENDING' }]`.
2. Toast **"Record queued for indexing"** with a **View** action → `store.openDetail(id)`.
3. The drawer's `useRecord` reads the record from **Postgres immediately** (fresh, even pre-index), shows the PENDING badge, and **polls to INDEXED/FAILED**. The user sees their record and its real status right away — no guessing.
4. The list revalidates on a **bounded schedule** (a couple of delayed `mutate`s) so the row appears in the table once indexed; the optional optimistic row covers the interim.

**Edit flow:** unchanged contract (re-persist by `externalId`) but now reachable for **any** record via the PG-backed drawer; on success, revalidate the `['record',…]` key (drawer) and the list.

**`ApiError.fieldErrors`** still map onto RHF fields via `setError` (validation envelope from `api-client`), unchanged from v1.

---

## 6. Schema / collection management (new surface, existing endpoints)

### 6.1 Service + mutation hook

```ts
// services/collection.service.ts (additions)
create(input: CreateCollectionInput): Promise<CollectionView>            // POST /search/collections
update(name: string, patch: UpdateCollectionInput): Promise<CollectionView> // PATCH /search/collections/:name
remove(name: string): Promise<void>                                       // DELETE /search/collections/:name
```

```ts
// hooks/use-collection-mutations.ts (new)
// create/update/remove → service + revalidate SWR '/search/collections'
//   (+ the ':name' definition key on update) + toast. Admin-only call sites.
```

### 6.2 Collection Manager dialog

Admin-only, opened from the dropdown's **"Manage…"** footer. Lists collections (`displayName · name · field count · updatedAt`) with **New / Edit / Delete / Reindex** actions. **Delete** routes through a confirm `AlertDialog` explaining it drops the Meili index and soft-deletes the collection's records.

### 6.3 Collection Editor sheet (create & edit)

- **Identity:** `name` (lower_snake_case; **immutable on edit** — PATCH accepts only `displayName`/`description`/`fields`), `displayName`, `description`.
- **FieldSpec editor** (`field-spec-editor.tsx`): repeatable rows — `name`, `type` select, flag checkboxes (`required`/`searchable`/`filterable`/`sortable`), optional `enum` chips; add/remove/reorder.
- **Client validation mirrors `validateFieldSpec` + `createCollectionSchema`** (`lib/schema/validate-field-spec.ts`), so errors surface before submit:
  - `name` matches `^[a-zA-Z][a-zA-Z0-9_]*$`; not reserved (`id, externalId, collection, createdAt, updatedAt`); no duplicates.
  - `searchable` only on `string`/`string[]`; `sortable` only on scalars (`string/number/boolean/date`) — **invalid flags are disabled at source** (greyed), not just error-after.
  - **≥1 searchable field** and **≥1 field** overall.
  - Collection `name` `^[a-z][a-z0-9_]*$` (≤100), `displayName` 1–255, `description` ≤500.
- **Edit caveats surfaced in-UI before save:** changing `fields` triggers a **background reindex** (the service enqueues `REINDEX_COLLECTION_JOB`) and does **not** retro-validate existing records (`validateDocument` runs only on new persists) — a banner warns of both.

### 6.4 Reindex

The existing `recordService.reload` + `useRecordMutations.reindex` (v1) are surfaced as a **Reindex** action in the Manager and the toolbar (admin).

---

## 7. Query enrichment

| Feature | Backend need | Design |
|---|---|---|
| **Faceted filters + counts** | none (facetDistribution already returned) | `useRecords` requests `facets` for **filterable enum/boolean (low-cardinality)** fields. `record-filters.tsx` renders each enum option with its live count (`sale (42)`) from `facetDistribution`, driving the existing `IN […]` filter. Free discovery UI. |
| **Recency sort** | none (createdAt/updatedAt always sortable) | Sort presets "Newest/Oldest" + sortable `createdAt`/`updatedAt` header affordances on every collection. |
| **Date-range filter** | **optional** (range operators, §2.3) | A range control on `createdAt`/`updatedAt`. Ships only if the filter builder gains `>=`/`<=`; otherwise deferred, with recency sort covering the common need. |
| **URL-synced query** | none | `use-query-url-sync.ts` mirrors `collection + q + filters + sort + page (+ record)` ↔ `?searchParams`. Shareable/bookmarkable queries on the single page; store stays source of truth (URL is a projection). |
| **Highlighting** | none (`highlight` already supported) | `useRecords` sends `highlight` for searchable fields; `field-cell.tsx` renders Meili's `_formatted` `<mark>` spans for text cells. |
| **Multi-column sort** | none (`sort[]` already supported) | `store.toggleSort(field, additive?)` keeps an **ordered array** (shift-click header = add/cycle within the array; plain click = replace). Serializer already maps `sort[]` → `["field:dir", …]`. |

---

## 8. State management deltas

**Boundary unchanged.** Additions only:

- **Zustand store** — add collection-manager UI state: `collectionPanel: 'closed' | 'list' | { mode: 'create' } | { mode: 'edit'; name: string }` with open/close actions. Extend `toggleSort` to support `additive` (multi-sort ordered array). `detailId` already exists (now drives a PG fetch, not an in-memory find). **No record data in the store** — the store stays UI/query-only.
- **SWR hooks** — **new:** `use-record.ts` (single record, PENDING-polling), `use-collection-mutations.ts`. **Changed:** `use-records.ts` (request `facets` + `highlight`), `use-record-mutations.ts` (create → open PG detail + bounded revalidate, drop the fixed-delay-as-correctness).
- **RHF+zod** — the record form gains an edit path seeded from `RecordDetail.document`; a **new** `fieldSpec` zod schema backs the Collection Editor form.
- **URL** — `use-query-url-sync.ts` projects store ↔ searchParams (query + `collection` + `record`). Optimistic/pending record data stays in the **SWR cache**, never Zustand.

---

## 9. Component inventory

**Backend (`api/src/features/search-service/`)**
- **New:** `SearchRecordService.get()` + `toRecordView()` mapper; `@Get('records/:id')` on `SearchQueryController`; a `RecordView` type. Tests: service resolve-by-id/externalId + 404, controller 200/404.
- **Optional:** range-operator support in `buildFilter`/`toFilterClause` + `searchQuerySchema` filter value union.

**Frontend — new**
`lib/services` → `collection.service.ts` (+create/update/remove)
`lib/hooks` → `use-record.ts`, `use-collection-mutations.ts`, `use-query-url-sync.ts`
`lib/schema` → `validate-field-spec.ts`, `field-spec-to-zod.ts`
`components/data-management` → `collection-manager-dialog.tsx`, `collection-editor-sheet.tsx`, `field-spec-editor.tsx`, `record-status-badge.tsx`, `facet-list.tsx` (or fold into `record-filters`)

**Frontend — changed**
`record-detail-drawer.tsx` (PG fetch via `useRecord`, live status, off-page edit) · `data-management-view.tsx` (stop passing `results` to the drawer; mount URL-sync) · `use-records.ts` (facets + highlight) · `use-record-mutations.ts` (create→PG detail + bounded revalidate) · `record-toolbar.tsx` (Manage… + Reindex) · `record-data-table.tsx` (optional optimistic pending row + multi-sort headers) · `record-filters.tsx` (facet counts, date range) · `field-cell.tsx` (highlight) · `data-management.store.ts` (collectionPanel, additive sort) · `interfaces/search.interface.ts` (`RecordDetail`).

Each file stays focused and under the ~500-line guideline.

---

## 10. RBAC & edge cases

- **RBAC:** `useIsAdmin()` gates New record, edit, delete, reindex, and **all** collection management (Manage…, editor, delete). The new **single-record GET is open to any authenticated role** (consistent with query); non-admins get a full read/detail experience with no write affordances.
- **Just-created record:** visible immediately via PG detail with a PENDING badge; the table catches up on revalidation. If indexing **fails**, the drawer shows `FAILED` + `indexError`, and an admin **Reindex** is offered.
- **Deep link to a deleted/unknown record** (`?record=<id>`): the PG read 404s → drawer shows a "record not found" empty state; the rest of the page is unaffected.
- **Collection edit → reindex:** banner warns the list may briefly reflect the old index while the reindex runs; existing records are not retro-validated against the new schema.
- **Collection delete:** confirmed; the switcher falls back to the first remaining collection.
- **Search-engine outage (`SEARCH_UNAVAILABLE`):** the table shows the retry empty-state (v1), but **detail/edit still work** (PG read is independent of Meili) — a resilience win from the new endpoint.

---

## 11. Testing

- **Backend:** `SearchRecordService.get` resolves by UUID and by externalId, rejects collection mismatch / soft-deleted (404); controller returns 200 shape and 404; (optional) filter builder emits `>=`/`<=` for range values.
- **Store:** `collectionPanel` transitions; multi-sort `toggleSort(additive)` ordering (add/cycle/replace); existing v1 store tests stay green.
- **Hooks:** `useRecord` polls while PENDING and stops on INDEXED/FAILED (mocked SWR); `useCollectionMutations` calls the right endpoints + revalidates.
- **Schema mirror:** `validate-field-spec` matches backend rules (reserved/dup names, searchable/sortable type constraints, ≥1 searchable).
- **Components:** detail drawer fetches by id and renders status/edit/read-only branches; collection editor blocks invalid field specs and posts a valid one; facet list renders counts and dispatches `IN` filters; RBAC hides admin controls for non-admins; deep-link hydration opens the drawer from `?record`.

---

## 12. Resolved decisions

1. **Single-record read:** **added** as `GET /records/:id` from Postgres (reversal of the initial Meili-only choice) — the correctness backbone for detail/edit/deep-link and the just-created record.
2. **Search/list:** stays **Meili-only**; no PG list endpoint.
3. **Deep links:** per-record via **`?record=<id>`** on the single page, not routed record pages.
4. **Scope:** records CRUD **+ collection/schema management** (admin), via modals/sheets off the dropdown.
5. **Creation gap:** solved by **PG detail + polling**, not a fixed delay; optimistic list row is cosmetic/optional.
6. **Query enrichment:** facets+counts, recency sort, URL-sync, highlight, multi-sort — **in**; **date-range filter** gated on the optional filter-builder extension.
7. **State boundary:** unchanged (Zustand / RHF+zod / SWR); optimistic data lives in SWR.

## 13. Non-goals / deferred

- No routed record/collection pages (single-page IA); no PG list/browse endpoint.
- No bulk import/export (CSV/JSON), no saved views, no inline-grid editing (edit is the drawer form). The batch `persist` API keeps bulk import a cheap later add.
- Date-range **filtering** deferred unless the optional filter-builder extension lands this iteration (recency **sort** ships regardless).
- No cross-collection/global search; no per-tenant record scoping (reads are global, as today).
