# Design — Data Control Panel (`/dashboard/data-management`)

**Status:** Approved (design phase). Next step: implementation plan.
**Scope:** Frontend only, in `frontend/`. Targets the existing `search-service` and
`file-processor` backend APIs. No backend changes.

---

## 1. Concept

The Data Control Panel is a **schema-driven manager over the search-service's dynamic
collections**. A "collection" is a named, typed dataset; a "record" is one document in it.
Every part of the UI — table columns, the search box, filter controls, sortable headers,
and the create/edit form inputs — is **derived at runtime from the active collection's
`FieldSpec[]`**. Adding or renaming a field on the backend updates the UI with no frontend
change.

The page has the two components called for in the goal:

1. **Data input component** — a create/edit form (schema-driven) plus a file-attachment
   dropzone. Admin-only.
2. **Data query / view component** — a server-paginated table (styled after
   `components/data-table.tsx`) with search, filter, sort, selection, and bulk actions.

### Backend contract (already exists — we target it)

| Surface | Method | Auth | Purpose |
|---|---|---|---|
| `/search/collections` | GET | any authenticated | list collections → switcher |
| `/search/collections/:name` | GET | any authenticated | active collection `FieldSpec[]` → drives all UI |
| `/search/collections/:name/query` | POST | any authenticated | table data (server-side) |
| `/search/collections/:name/records` | POST | **admin** | create/update (upsert on `externalId`) → **202** |
| `/search/collections/:name/records/:id` | DELETE | **admin** | delete → 204 |
| `/search/collections/:name/reload` | POST | **admin** | reindex (recovery) → 202 |
| `/files` | POST | authenticated | initiate presigned upload |
| `/files/:id/complete` | POST | authenticated | finalize upload |
| `/files/:id/download-url` | GET | authenticated | short-lived presigned GET |
| `/files/:id`, `/files` | GET | authenticated | file metadata / list |
| `/files/:id` | DELETE | authenticated | soft-delete file |

**Request/response shapes**

- **Query request** (`POST .../query`):
  `{ q?: string=''; page?: number=1; limit?: number; filters?: Record<string, string|number|boolean|(string|number)[]>; sort?: string[] /* "field:asc"|"field:desc" */; facets?: string[]; highlight?: string[] }`
- **Query response** (`SearchResults<T>`):
  `{ hits: T[]; page: number; limit: number; totalHits: number; totalPages: number; facetDistribution?: Record<string,Record<string,number>>; processingTimeMs: number }`
- **Persist request** (`POST .../records`):
  `{ records: [{ externalId?: string; document: Record<string, unknown> }] }` (1..1000)
- **Persist response**: `PersistResult[]` → `[{ id: string; externalId: string|null; indexState: 'PENDING'|'INDEXED'|... }]`
- **FieldSpec**: `{ name: string; type: 'string'|'number'|'boolean'|'date'|'string[]'|'number[]'; required?: boolean; searchable?: boolean; filterable?: boolean; sortable?: boolean; enum?: (string|number)[] }`
- **CollectionView**: `{ name: string; displayName: string; description: string|null; fields: FieldSpec[]; createdAt: string; updatedAt: string }`
- **Initiate upload**: `POST /files { filename; mimeType; size; sha256?; metadata? }` →
  `{ fileId: string; deduplicated: boolean; upload?: { url: string; fields?: Record<string,string>; expiresIn: number } }`.
  If `deduplicated`, the content already exists and the file is immediately usable (no
  upload/complete). Otherwise the client submits a **`multipart/form-data` POST to
  `upload.url`** with every `upload.fields` entry appended first and the `file` field **last**
  (MinIO POST-policy requirement), directly to storage with **no `Authorization` header**,
  then calls `POST /files/:fileId/complete { sha256? }`.
- **FileMetadata** (`GET /files/:id`): `{ id; ownerId; filename; mimeType; size; checksumSha256; status; metadata; createdAt; updatedAt }`.

### Two invariants the design must respect

- **Writes are admin-only; reads are open to any authenticated role.** Non-admins get a
  fully functional read/search/filter/sort experience with no create/edit/delete affordances.
- **Writes are eventually consistent.** `persist` returns `202` with `indexState: PENDING`;
  the record is not queryable until BullMQ indexes it. The UI surfaces this honestly rather
  than pretending the write is immediately visible.

- **Record identity for editing.** `persist` upserts on `externalId`; a record with no
  `externalId` cannot be updated in place (a second persist would create a duplicate). So the
  create flow **always assigns an `externalId`** (the user's value, else a generated
  `crypto.randomUUID()`), and **edit requires an `externalId`** — a hit lacking one opens the
  detail drawer read-only. Every hit also carries the Meili primary key `id` (the Postgres
  row UUID) plus system `createdAt`/`updatedAt` (epoch-ms numbers); `id` is used for
  `getRowId` and for the delete call.

---

## 2. Architecture — the state boundary

The goal requires that state management own the `setState` operations so UI components stay
near-stateless. We satisfy this with **three purpose-built state layers**; UI components hold
essentially no `useState`.

| Layer | Owns | Tech |
|---|---|---|
| **Zustand store** | Page orchestration: active collection, query params (`q/page/limit/filters/sort`), row selection, column visibility, dialog/panel open-state | `zustand` + `devtools`, mirroring `app.store.ts` |
| **react-hook-form + zod** | Transient form input (create/edit form, filter popovers) | `react-hook-form` + `@hookform/resolvers/zod`, mirroring `login-form.tsx` |
| **SWR** | Server cache: collection list, active definition, query results | `swr` + shared `apiClient`, mirroring `use-sessions.ts` |

**The TanStack table runs in fully controlled/manual mode** (`manualPagination`,
`manualSorting`, `manualFiltering` all `true`; `pageCount` from server `totalPages`). Its
`state` is sourced from the Zustand store, and every `onXChange` handler dispatches a store
action. The table component therefore holds no query state of its own — it is a controlled
view. This is the concrete mechanism behind "minimal setState in UI".

**Form input state is deliberately *not* hoisted into Zustand.** Putting ephemeral keystroke
state in a global store is an anti-pattern (re-render storms, lifecycle bugs). react-hook-form
*is* the state manager for that concern; the component still owns no raw `useState`. On
submit, the form calls a service and/or a store action.

---

## 3. State store contract

`lib/state-management/data-management.store.ts` — same conventions as `app.store.ts`
(slice-creator, named action strings as the 3rd arg to `set`, exported selector hooks,
`devtools` enabled in dev only).

```ts
type FilterValue = string | number | boolean | (string | number)[]
type SortSpec = { field: string; dir: 'asc' | 'desc' }

interface DataManagementState {
  // ── collection ────────────────────────────────────────────────
  collection: string | null
  setCollection(name: string): void        // also calls resetQuery + clearSelection

  // ── query (serialized into the records SWR key) ───────────────
  q: string
  page: number
  limit: number
  filters: Record<string, FilterValue>
  sort: SortSpec[]
  setSearch(q: string): void                // resets page → 1 (debounced upstream)
  setPage(p: number): void
  setLimit(n: number): void                 // resets page → 1
  setFilter(field: string, value: FilterValue | undefined): void  // undefined clears; resets page → 1
  clearFilters(): void
  toggleSort(field: string): void           // cycles asc → desc → off (single-sort v1)
  resetQuery(): void                        // q='' page=1 filters={} sort=[] (keeps limit)

  // ── bulk selection ────────────────────────────────────────────
  selection: Record<string, boolean>        // keyed by record id
  setSelection(updater: Updater<Record<string, boolean>>): void
  clearSelection(): void

  // ── view prefs ────────────────────────────────────────────────
  columnVisibility: Record<string, boolean>
  setColumnVisibility(updater: Updater<Record<string, boolean>>): void

  // ── dialogs / panels (keeps open/close out of components) ──────
  panel: 'closed' | 'create'
  detailId: string | null
  deleteTarget: string[] | null
  openCreate(): void; closeCreate(): void
  openDetail(id: string): void; closeDetail(): void
  requestDelete(ids: string[]): void; cancelDelete(): void
}
```

- **Selectors**: one hook per field/action (e.g. `useCollection`, `useSetFilter`), matching
  `app.store.ts`. A derived `useRecordQuery()` returns the stable `{ q, page, limit, filters,
  sort }` object for the SWR key, wrapped in `useShallow` (Zustand v5) to avoid re-render
  churn from new object identities.
- **Reset semantics**: `setCollection` fully resets query + selection (the old query is
  meaningless against a different schema). `setSearch`/`setFilter`/`setLimit` reset `page → 1`.
- **Optional `persist` middleware** on **view prefs only** — `columnVisibility`, `limit`, and
  last `collection`. Never persist query text, selection, or dialog state.

---

## 4. Component tree

```
app/dashboard/data-management/
  page.tsx                    server shell: SidebarProvider + AppSidebar + SiteHeader + <DataManagementView/>

components/data-management/
  data-management-view.tsx    client orchestrator: composes toolbar + table + panels; wires store ↔ SWR
  record-toolbar.tsx          collection switcher · search input · filters trigger · columns toggle · "New" (admin) · bulk-delete (admin)
  record-filters.tsx          schema-driven filter controls in a Popover (from filterable FieldSpecs)
  record-data-table.tsx       controlled TanStack table, styled per data-table.tsx; reuses ui/data-pagination.tsx
  field-cell.tsx              type-aware cell renderer (enum→Badge, boolean→check icon, date→formatted, array→tag chips)
  record-input-panel.tsx      "new data input" — Sheet/Drawer wrapping <RecordForm/> in create mode (admin-gated)
  record-detail-drawer.tsx    view/edit one record — reuses <RecordForm/> in edit mode (mirrors reference TableCellViewer)
  record-form.tsx             schema-driven RHF form with a dynamically-built zod resolver; used by create + edit
  attachments-field.tsx       file dropzone + per-file upload progress + existing-attachment download list
  record-delete-dialog.tsx    AlertDialog confirm for single + bulk delete

lib/
  schema/
    field-to-column.tsx       FieldSpec → ColumnDef (header, sortable flag, cell via field-cell)
    field-to-input.tsx        FieldSpec → RHF form control (string→Input, number→number Input, boolean→Switch, date→Calendar, enum→Select, string[]/number[]→tags/combobox)
    field-to-filter.tsx       FieldSpec → filter control (enum→multiselect IN, boolean→tri-state, number→exact; free-text via the q box, [number range deferred])
    field-to-zod.ts           FieldSpec[] → z.object schema (required, type, enum) for RHF validation
  services/
    collection.service.ts     GET /search/collections ; GET /search/collections/:name
    record.service.ts         POST .../query ; POST .../records ; DELETE .../records/:id ; POST .../reload
    file.service.ts           initiate / uploadBytes(PUT) / complete / downloadUrl / list / remove
  hooks/
    use-collections.ts        SWR list (GET-key via global fetcher)
    use-collection-definition.ts  SWR active-collection FieldSpec[] (keyed on store.collection)
    use-records.ts            SWR query results (POST via custom fetcher, keyed on useRecordQuery())
    use-record-mutations.ts   create/update/delete → service + mutate() + toast + eventual-consistency handling
    use-file-upload.ts        presigned upload orchestration (initiate → PUT → complete), progress state
  interfaces/
    search.interface.ts       FieldSpec, CollectionView, SearchQuery, SearchResults<T>, PersistResult, FileMeta, FilterValue, SortSpec
```

**From `components/data-table.tsx` we keep** the visual/structural language: sticky bordered
rounded table container, selection checkboxes (header + row), the "Columns" visibility
dropdown, rows-per-page `Select`, the pager, and the detail drawer for a row. **We drop the
dnd-kit row reordering** — records have no order field and data is server-paginated, so
reordering is meaningless (YAGNI). Icons follow the reference's `@hugeicons` usage; the
existing `ui/data-pagination.tsx` (which uses `@tabler`) is reused as-is without churn.

Each file stays focused and under the 500-line guideline; the `field-to-*` mappers are the
heart of the schema-driven behavior and are unit-tested in isolation.

---

## 5. Key data flows

### Query (read)
`store query → useRecordQuery() → SWR key ['records', collection, query] → record.service.query() → SearchResults`.
The table renders `hits`; `ui/data-pagination.tsx` uses `totalHits`/`totalPages`/`page`/`limit`.
States: **loading** → skeleton rows; **empty** → `ui/empty.tsx`; **error** → alert with a
retry that calls `mutate()`. The custom SWR fetcher is required here because query is a `POST`
(the global GET fetcher does not apply).

### Create
`RHF submit → build typed document → (if attachments: presigned uploads, collect file IDs into the attachments field) → record.service.persist(collection, [{ externalId?, document }]) → 202`.
Then: toast **"N record(s) queued for indexing"**, `mutate()` the records key after a short
delay (async indexing), close the panel, reset the form. `ApiError.fieldErrors` (already
parsed from a `VALIDATION_FAILED` envelope by `api-client`) is mapped back onto RHF field
errors via `setError`.

### Edit
`detail drawer → same RecordForm (edit mode) → persist with the record's externalId` (backend
upserts on `externalId`). Same 202/eventual-consistency handling.

### Delete
`confirm dialog → record.service.remove() → optimistic removal from the SWR cache + mutate()`.
Single or bulk (from selection). Admin-only.

### Attachments (presigned)
Per file: `initiate (POST /files, metadata { collection, externalId })` → if `deduplicated`,
done; else **multipart POST** the file to `upload.url` with `upload.fields` (direct to MinIO,
no bearer) → `complete (POST /files/:fileId/complete)`. Collected file IDs are written into
the record's conventional `attachments: string[]` document field. Existing attachments render
by fetching `GET /files/:id` (filename) with a download link via `GET /files/:id/download-url`.
`use-file-upload.ts` owns progress/cancel state.

---

## 6. RBAC & edge cases

- **RBAC**: `useUserRole() === 'admin'` gates the New / Edit / Delete / Reindex affordances.
  Reads (query, search, filter, sort, pagination) work for every authenticated role because
  the query endpoint is open. A non-admin never sees a control that would 403.
- **Eventual consistency** is surfaced, not hidden: post-write "queued for indexing" hint +
  delayed revalidate, plus an admin **Reindex** action (`POST .../reload`) for recovery when
  the index drifts.
- **Collection switch** resets query + selection and refetches the definition; the table shows
  a loading state while the new schema resolves.
- **Unknown/deleted collection** or a search-engine outage (`SEARCH_UNAVAILABLE`) → error
  alert with retry; the toolbar still allows switching to another collection.

---

## 7. Testing (Vitest + testing-library, colocated `__tests__`)

- **Store**: query-reset on collection change, `page → 1` on search/filter/limit, sort
  cycling (asc→desc→off), selection set/clear, dialog open/close transitions.
- **Mappers** (`field-to-*`): each `FieldSpec` type → correct column / input / filter / zod
  rule, including `required` and `enum`.
- **Services**: correct URLs/bodies against a mocked `apiClient`; `query` posts the serialized
  request; `persist` batches records.
- **Components**: table renders hits/empty/loading/error; toolbar filter dispatches store
  actions; form validation blocks invalid submit and calls the service on valid; RBAC gating
  hides admin controls for non-admins; `use-file-upload` orchestration with a mocked presigned
  flow.

---

## 8. Resolved decisions (confirmed with user)

1. **Data source**: real backend, **server-side** pagination/filter/sort.
2. **Schema strategy**: **schema-driven** — UI derived from `FieldSpec[]`.
3. **Collection binding**: **switcher**, defaulting to one collection.
4. **Endpoint**: live search-service endpoints, targeted directly.
5. **File upload**: **attach file(s) to one record**, via the presigned flow.
6. **Attachments binding**: file IDs stored in a conventional `attachments: string[]`
   document field, rendered as a dropzone when the collection declares it (graceful no-op
   otherwise); files carry `metadata:{ collection, externalId }` as a backref.
7. **Presigned upload** assumes the MinIO bucket has **CORS** configured for the browser
   origin (direct PUT) — *infra dependency, noted*.
8. **Filter depth (v1)**: structured filters are **exact-match** (the backend filter operator
   is equality/IN, not substring): enum→multiselect (IN), boolean→tri-state, number→exact.
   Free-text "contains" is served by the global `q` search box over searchable fields.
   **Number-range deferred** to a later enhancement.
9. **`date` fields**: Calendar/date-picker input, stored as **ISO-8601 string**.
10. **URL-sync** of query state: **deferred to v1.1**; the store stays the source of truth.
11. **Default collection**: first from `GET /search/collections` unless a configured default
    is set.

---

## 9. Non-goals (v1)

- No collection CRUD from this page (create/edit/delete collections) — records only.
- No dnd row reordering, no inline cell editing grid (edit is via the drawer form).
- No number-range filters, no URL state sync, no saved views (candidates for v1.1+).
