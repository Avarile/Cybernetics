# Data Control Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade, schema-driven data control panel at `/dashboard/data-management` that lists records from a search-service collection (server-side pagination/filter/sort) and lets admins create/edit/delete records with file attachments.

**Architecture:** Three state layers keep UI components near-stateless — a Zustand store owns page orchestration (collection, query params, selection, dialogs), react-hook-form owns transient form input, and SWR owns server cache. A TanStack table runs in fully controlled/manual mode driven by the store. Every column, filter, sort, and form input is derived at runtime from the active collection's `FieldSpec[]`.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, Zustand v5 (+devtools), SWR v2, react-hook-form v7 + `@hookform/resolvers/zod` + Zod v4, `@tanstack/react-table` v8, axios (shared `apiClient`), sonner, shadcn/ui (`components/ui/*`), Hugeicons, Vitest + Testing Library.

## Global Constraints

- **Design source of truth:** `development/current_session/current_design.md`. Do not diverge from its resolved decisions.
- **No new npm dependencies.** Everything needed is already installed.
- **Path alias:** `@/` → `frontend/` root. All imports use it.
- **Zustand pattern:** mirror `lib/state-management/app.store.ts` — `create()(devtools(creator, { name, enabled: process.env.NODE_ENV === 'development' }))`, named action strings as the 3rd arg to `set`, exported selector hooks.
- **Forms:** react-hook-form + `zodResolver`, using shadcn `Field/FieldLabel/FieldError` (mirror `components/login-form.tsx`). Zod uses positional message strings (e.g. `z.string().min(1, 'msg')`).
- **Server-side only:** the table never sorts/filters/paginates in memory. `manualPagination`, `manualSorting`, `manualFiltering` are all `true`.
- **RBAC:** writes (create/edit/delete/reindex) are admin-only via `useIsAdmin()` from `lib/hooks/use-permission.ts`. Reads work for any authenticated role.
- **Record identity:** a hit is `{ id: <uuid>, externalId?, ...document, createdAt: <epoch ms>, updatedAt: <epoch ms> }`. Use `id` for `getRowId`/delete. `persist` upserts on `externalId`, so **create auto-assigns an `externalId`** (`crypto.randomUUID()` unless the record carries one) and **edit requires an `externalId`**.
- **Eventual consistency:** `persist` returns `202`/`PENDING`; a written record is not immediately queryable. After a write, toast + revalidate the records key after a short delay.
- **Filters are exact-match** (backend operator is `=`/`IN`): enum→multiselect (IN), boolean→tri-state, number→exact. Free-text "contains" is the global `q` box. Number-range deferred.
- **Files:** keep each file focused and under ~500 lines.
- **Tests:** run with `npx vitest run <path>`. Tests colocate in a sibling `__tests__/` dir. jsdom + Testing Library are pre-configured (`vitest.config.ts`, `vitest.setup.ts`).
- **Commit** after each task with a `feat(data-mgmt): …` conventional message.

---

## File Structure

```
frontend/
  app/dashboard/data-management/page.tsx            (Task 15)
  components/data-management/
    data-management-view.tsx                         (Task 15)
    record-toolbar.tsx                               (Task 12)
    record-filters.tsx                               (Task 12)
    record-data-table.tsx                            (Task 11)
    field-cell.tsx                                   (Task 6)
    field-to-input.tsx                               (Task 7)
    field-to-filter.tsx                              (Task 8)
    record-form.tsx                                  (Task 13)
    attachments-field.tsx                            (Task 13)
    record-input-panel.tsx                           (Task 14)
    record-detail-drawer.tsx                         (Task 14)
    record-delete-dialog.tsx                         (Task 14)
  lib/
    interfaces/search.interface.ts                   (Task 1)
    schema/serialize-query.ts                        (Task 1)
    schema/field-to-zod.ts                           (Task 5)
    schema/field-to-column.tsx                       (Task 6)
    services/collection.service.ts                   (Task 2)
    services/record.service.ts                       (Task 2)
    services/file.service.ts                         (Task 3)
    state-management/data-management.store.ts        (Task 4)
    hooks/use-collections.ts                          (Task 9)
    hooks/use-collection-definition.ts               (Task 9)
    hooks/use-records.ts                             (Task 9)
    hooks/use-record-mutations.ts                    (Task 10)
    hooks/use-file-upload.ts                         (Task 10)
```

---

## Task 1: Domain types + query serialization

**Files:**
- Create: `frontend/lib/interfaces/search.interface.ts`
- Create: `frontend/lib/schema/serialize-query.ts`
- Test: `frontend/lib/schema/__tests__/serialize-query.test.ts`

**Interfaces:**
- Produces: all shared types (`FieldSpec`, `FieldType`, `CollectionView`, `FilterValue`, `SortSpec`, `SearchQuery`, `SearchRequestBody`, `RecordDocument`, `RecordHit`, `SearchResults<T>`, `PersistRecordInput`, `PersistResult`, `IndexState`, `InitiateUploadInput`, `PresignedTarget`, `InitiateUploadResult`, `FileMetadata`) and `toSearchRequestBody(query: SearchQuery): SearchRequestBody`.

- [ ] **Step 1: Create the interfaces file**

```ts
// frontend/lib/interfaces/search.interface.ts

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]'

/** One field in a collection definition (mirror of the backend FieldSpec). */
export interface FieldSpec {
  name: string
  type: FieldType
  required?: boolean
  searchable?: boolean
  filterable?: boolean
  sortable?: boolean
  enum?: (string | number)[]
}

/** GET /search/collections and GET /search/collections/:name */
export interface CollectionView {
  name: string
  displayName: string
  description: string | null
  fields: FieldSpec[]
  createdAt: string
  updatedAt: string
}

export type FilterValue = string | number | boolean | (string | number)[]
export type SortDir = 'asc' | 'desc'
export interface SortSpec { field: string; dir: SortDir }

/** Normalized query state held in the store. */
export interface SearchQuery {
  q: string
  page: number
  limit: number
  filters: Record<string, FilterValue>
  sort: SortSpec[]
}

/** Wire body POSTed to /search/collections/:name/query. */
export interface SearchRequestBody {
  q?: string
  page?: number
  limit?: number
  filters?: Record<string, FilterValue>
  sort?: string[]
}

export type RecordDocument = Record<string, unknown>

/** A single search hit: system fields + the persisted document fields. */
export type RecordHit = {
  id: string
  externalId?: string
  createdAt?: number
  updatedAt?: number
} & RecordDocument

export interface SearchResults<T = RecordHit> {
  hits: T[]
  page: number
  limit: number
  totalHits: number
  totalPages: number
  facetDistribution?: Record<string, Record<string, number>>
  processingTimeMs: number
}

export interface PersistRecordInput {
  externalId?: string
  document: RecordDocument
}

export type IndexState = 'PENDING' | 'INDEXED' | 'FAILED'
export interface PersistResult {
  id: string
  externalId: string | null
  indexState: IndexState
}

// ── Files (presigned upload) ────────────────────────────────────────
export interface InitiateUploadInput {
  filename: string
  mimeType: string
  size: number
  sha256?: string
  metadata?: Record<string, unknown>
}
export interface PresignedTarget {
  url: string
  fields?: Record<string, string>
  expiresIn: number
}
export interface InitiateUploadResult {
  fileId: string
  deduplicated: boolean
  upload?: PresignedTarget
}
export interface FileMetadata {
  id: string
  ownerId: string | null
  filename: string
  mimeType: string
  size: number
  checksumSha256: string | null
  status: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Write the failing test**

```ts
// frontend/lib/schema/__tests__/serialize-query.test.ts
import { describe, it, expect } from 'vitest'
import { toSearchRequestBody } from '@/lib/schema/serialize-query'
import type { SearchQuery } from '@/lib/interfaces/search.interface'

const base: SearchQuery = { q: '', page: 1, limit: 20, filters: {}, sort: [] }

describe('toSearchRequestBody', () => {
  it('omits empty q, filters, and sort', () => {
    expect(toSearchRequestBody(base)).toEqual({ page: 1, limit: 20 })
  })
  it('trims q and maps sort specs to "field:dir"', () => {
    const out = toSearchRequestBody({ ...base, q: '  laptop ', sort: [{ field: 'price', dir: 'desc' }] })
    expect(out.q).toBe('laptop')
    expect(out.sort).toEqual(['price:desc'])
  })
  it('drops empty-array and empty-string filter values', () => {
    const out = toSearchRequestBody({ ...base, filters: { tags: [], status: '', active: true, cat: ['a'] } })
    expect(out.filters).toEqual({ active: true, cat: ['a'] })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run lib/schema/__tests__/serialize-query.test.ts`
Expected: FAIL — cannot resolve `@/lib/schema/serialize-query`.

- [ ] **Step 4: Create the serializer**

```ts
// frontend/lib/schema/serialize-query.ts
import type { SearchQuery, SearchRequestBody } from '@/lib/interfaces/search.interface'

/** Normalize UI query state into the API request body. */
export function toSearchRequestBody(query: SearchQuery): SearchRequestBody {
  const body: SearchRequestBody = { page: query.page, limit: query.limit }
  if (query.q.trim()) body.q = query.q.trim()

  const filters: Record<string, SearchQuery['filters'][string]> = {}
  for (const [field, value] of Object.entries(query.filters)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'string' && value === '') continue
    filters[field] = value
  }
  if (Object.keys(filters).length) body.filters = filters

  if (query.sort.length) body.sort = query.sort.map((s) => `${s.field}:${s.dir}`)
  return body
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/schema/__tests__/serialize-query.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/interfaces/search.interface.ts frontend/lib/schema/serialize-query.ts frontend/lib/schema/__tests__/serialize-query.test.ts
git commit -m "feat(data-mgmt): search domain types + query serializer"
```

---

## Task 2: Collection + record services

**Files:**
- Create: `frontend/lib/services/collection.service.ts`
- Create: `frontend/lib/services/record.service.ts`
- Test: `frontend/lib/services/__tests__/record.service.test.ts`

**Interfaces:**
- Consumes: `apiClient` (`lib/http/api-client.ts`); types + `toSearchRequestBody` from Task 1.
- Produces: `collectionService.list(): Promise<CollectionView[]>`, `collectionService.get(name): Promise<CollectionView>`; `recordService.query(collection, query): Promise<SearchResults>`, `recordService.persist(collection, records): Promise<PersistResult[]>`, `recordService.remove(collection, id): Promise<void>`, `recordService.reload(collection): Promise<void>`.

- [ ] **Step 1: Create the services**

```ts
// frontend/lib/services/collection.service.ts
import { apiClient } from '@/lib/http/api-client'
import type { CollectionView } from '@/lib/interfaces/search.interface'

export const collectionService = {
  list(): Promise<CollectionView[]> {
    return apiClient.get<CollectionView[]>('/search/collections').then((r) => r.data)
  },
  get(name: string): Promise<CollectionView> {
    return apiClient
      .get<CollectionView>(`/search/collections/${encodeURIComponent(name)}`)
      .then((r) => r.data)
  },
}
```

```ts
// frontend/lib/services/record.service.ts
import { apiClient } from '@/lib/http/api-client'
import { toSearchRequestBody } from '@/lib/schema/serialize-query'
import type {
  PersistRecordInput,
  PersistResult,
  SearchQuery,
  SearchResults,
} from '@/lib/interfaces/search.interface'

const base = (name: string) => `/search/collections/${encodeURIComponent(name)}`

export const recordService = {
  query(collection: string, query: SearchQuery): Promise<SearchResults> {
    return apiClient
      .post<SearchResults>(`${base(collection)}/query`, toSearchRequestBody(query))
      .then((r) => r.data)
  },
  persist(collection: string, records: PersistRecordInput[]): Promise<PersistResult[]> {
    return apiClient
      .post<PersistResult[]>(`${base(collection)}/records`, { records })
      .then((r) => r.data)
  },
  remove(collection: string, id: string): Promise<void> {
    return apiClient
      .delete(`${base(collection)}/records/${encodeURIComponent(id)}`)
      .then(() => undefined)
  },
  reload(collection: string): Promise<void> {
    return apiClient.post(`${base(collection)}/reload`).then(() => undefined)
  },
}
```

- [ ] **Step 2: Write the failing test**

```ts
// frontend/lib/services/__tests__/record.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/http/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

import { apiClient } from '@/lib/http/api-client'
import { recordService } from '@/lib/services/record.service'
import { collectionService } from '@/lib/services/collection.service'

beforeEach(() => vi.clearAllMocks())

describe('recordService', () => {
  it('query posts the serialized body to /query', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { hits: [], page: 1, limit: 20, totalHits: 0, totalPages: 0, processingTimeMs: 1 } })
    await recordService.query('products', { q: 'x', page: 2, limit: 20, filters: {}, sort: [] })
    expect(apiClient.post).toHaveBeenCalledWith('/search/collections/products/query', { q: 'x', page: 2, limit: 20 })
  })
  it('persist wraps records under { records }', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: [] })
    await recordService.persist('products', [{ externalId: 'e1', document: { a: 1 } }])
    expect(apiClient.post).toHaveBeenCalledWith('/search/collections/products/records', { records: [{ externalId: 'e1', document: { a: 1 } }] })
  })
  it('remove deletes by id', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: undefined })
    await recordService.remove('products', 'abc')
    expect(apiClient.delete).toHaveBeenCalledWith('/search/collections/products/records/abc')
  })
})

describe('collectionService', () => {
  it('get fetches a single collection by name', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { name: 'products', fields: [] } })
    await collectionService.get('products')
    expect(apiClient.get).toHaveBeenCalledWith('/search/collections/products')
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/services/__tests__/record.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/services/collection.service.ts frontend/lib/services/record.service.ts frontend/lib/services/__tests__/record.service.test.ts
git commit -m "feat(data-mgmt): collection + record services"
```

---

## Task 3: File service (presigned upload)

**Files:**
- Create: `frontend/lib/services/file.service.ts`
- Test: `frontend/lib/services/__tests__/file.service.test.ts`

**Interfaces:**
- Consumes: `apiClient`; `InitiateUploadInput`, `InitiateUploadResult`, `PresignedTarget`, `FileMetadata` from Task 1.
- Produces: `fileService.initiate(input): Promise<InitiateUploadResult>`, `fileService.uploadToPolicy(target, file): Promise<void>`, `fileService.complete(fileId, sha256?): Promise<FileMetadata>`, `fileService.get(id): Promise<FileMetadata>`, `fileService.downloadUrl(id, ttl?): Promise<string>`.

- [ ] **Step 1: Create the file service**

```ts
// frontend/lib/services/file.service.ts
import { apiClient } from '@/lib/http/api-client'
import type {
  FileMetadata,
  InitiateUploadInput,
  InitiateUploadResult,
  PresignedTarget,
} from '@/lib/interfaces/search.interface'

export const fileService = {
  initiate(input: InitiateUploadInput): Promise<InitiateUploadResult> {
    return apiClient.post<InitiateUploadResult>('/files', input).then((r) => r.data)
  },

  /** Upload bytes straight to storage via the presigned POST policy (no bearer). */
  async uploadToPolicy(target: PresignedTarget, file: File): Promise<void> {
    const form = new FormData()
    for (const [k, v] of Object.entries(target.fields ?? {})) form.append(k, v)
    form.append('file', file) // MUST be appended last for a MinIO POST policy
    const res = await fetch(target.url, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`Upload failed (${res.status})`)
  },

  complete(fileId: string, sha256?: string): Promise<FileMetadata> {
    return apiClient
      .post<FileMetadata>(`/files/${fileId}/complete`, sha256 ? { sha256 } : {})
      .then((r) => r.data)
  },

  get(id: string): Promise<FileMetadata> {
    return apiClient.get<FileMetadata>(`/files/${id}`).then((r) => r.data)
  },

  async downloadUrl(id: string, ttl?: number): Promise<string> {
    const { data } = await apiClient.get<PresignedTarget>(`/files/${id}/download-url`, {
      params: ttl ? { ttl } : undefined,
    })
    return data.url
  },
}
```

- [ ] **Step 2: Write the failing test**

```ts
// frontend/lib/services/__tests__/file.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/http/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))

import { apiClient } from '@/lib/http/api-client'
import { fileService } from '@/lib/services/file.service'

beforeEach(() => vi.clearAllMocks())

describe('fileService', () => {
  it('initiate posts declared metadata to /files', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { fileId: 'f1', deduplicated: false } })
    const r = await fileService.initiate({ filename: 'a.pdf', mimeType: 'application/pdf', size: 10 })
    expect(apiClient.post).toHaveBeenCalledWith('/files', { filename: 'a.pdf', mimeType: 'application/pdf', size: 10 })
    expect(r.fileId).toBe('f1')
  })

  it('uploadToPolicy posts multipart form with fields then file', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    await fileService.uploadToPolicy({ url: 'http://minio/bucket', fields: { key: 'k', policy: 'p' }, expiresIn: 60 }, file)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://minio/bucket')
    const form = init.body as FormData
    expect(form.get('key')).toBe('k')
    expect(form.get('file')).toBe(file)
    vi.unstubAllGlobals()
  })

  it('downloadUrl returns the presigned url', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { url: 'http://minio/get', expiresIn: 60 } })
    expect(await fileService.downloadUrl('f1')).toBe('http://minio/get')
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/services/__tests__/file.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/services/file.service.ts frontend/lib/services/__tests__/file.service.test.ts
git commit -m "feat(data-mgmt): presigned file upload service"
```

---

## Task 4: Data-management Zustand store

**Files:**
- Create: `frontend/lib/state-management/data-management.store.ts`
- Test: `frontend/lib/state-management/__tests__/data-management.store.test.ts`

**Interfaces:**
- Consumes: `FilterValue`, `SearchQuery`, `SortSpec` from Task 1; `Updater` from `@tanstack/react-table`.
- Produces: `useDataManagementStore` (full state + actions per §3 of the design), and selector hooks `useCollection()`, `useSetCollection()`, `useRecordQuery(): SearchQuery`.

- [ ] **Step 1: Create the store**

```ts
// frontend/lib/state-management/data-management.store.ts
'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type { Updater } from '@tanstack/react-table'
import type { FilterValue, SearchQuery, SortSpec } from '@/lib/interfaces/search.interface'

const DEFAULT_LIMIT = 20

type RowSelection = Record<string, boolean>
type ColumnVisibility = Record<string, boolean>

interface DataManagementState {
  collection: string | null
  setCollection: (name: string) => void

  q: string
  page: number
  limit: number
  filters: Record<string, FilterValue>
  sort: SortSpec[]
  setSearch: (q: string) => void
  setPage: (page: number) => void
  setLimit: (limit: number) => void
  setFilter: (field: string, value: FilterValue | undefined) => void
  clearFilters: () => void
  toggleSort: (field: string) => void
  resetQuery: () => void

  selection: RowSelection
  setSelection: (updater: Updater<RowSelection>) => void
  clearSelection: () => void

  columnVisibility: ColumnVisibility
  setColumnVisibility: (updater: Updater<ColumnVisibility>) => void

  panel: 'closed' | 'create'
  detailId: string | null
  deleteTarget: string[] | null
  openCreate: () => void
  closeCreate: () => void
  openDetail: (id: string) => void
  closeDetail: () => void
  requestDelete: (ids: string[]) => void
  cancelDelete: () => void
}

const QUERY_DEFAULTS = {
  q: '',
  page: 1,
  filters: {} as Record<string, FilterValue>,
  sort: [] as SortSpec[],
}

function applyUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater
}

const creator: StateCreator<
  DataManagementState,
  [['zustand/devtools', never]],
  [],
  DataManagementState
> = (set) => ({
  collection: null,
  setCollection: (name) =>
    set(
      { collection: name, ...QUERY_DEFAULTS, limit: DEFAULT_LIMIT, selection: {} },
      false,
      'dm/setCollection',
    ),

  ...QUERY_DEFAULTS,
  limit: DEFAULT_LIMIT,
  setSearch: (q) => set({ q, page: 1 }, false, 'dm/setSearch'),
  setPage: (page) => set({ page }, false, 'dm/setPage'),
  setLimit: (limit) => set({ limit, page: 1 }, false, 'dm/setLimit'),
  setFilter: (field, value) =>
    set(
      (s) => {
        const filters = { ...s.filters }
        if (value === undefined) delete filters[field]
        else filters[field] = value
        return { filters, page: 1 }
      },
      false,
      'dm/setFilter',
    ),
  clearFilters: () => set({ filters: {}, page: 1 }, false, 'dm/clearFilters'),
  toggleSort: (field) =>
    set(
      (s) => {
        const current = s.sort[0]
        if (!current || current.field !== field) return { sort: [{ field, dir: 'asc' }] }
        if (current.dir === 'asc') return { sort: [{ field, dir: 'desc' }] }
        return { sort: [] }
      },
      false,
      'dm/toggleSort',
    ),
  resetQuery: () => set({ ...QUERY_DEFAULTS }, false, 'dm/resetQuery'),

  selection: {},
  setSelection: (updater) =>
    set((s) => ({ selection: applyUpdater(updater, s.selection) }), false, 'dm/setSelection'),
  clearSelection: () => set({ selection: {} }, false, 'dm/clearSelection'),

  columnVisibility: {},
  setColumnVisibility: (updater) =>
    set((s) => ({ columnVisibility: applyUpdater(updater, s.columnVisibility) }), false, 'dm/setColumnVisibility'),

  panel: 'closed',
  detailId: null,
  deleteTarget: null,
  openCreate: () => set({ panel: 'create' }, false, 'dm/openCreate'),
  closeCreate: () => set({ panel: 'closed' }, false, 'dm/closeCreate'),
  openDetail: (id) => set({ detailId: id }, false, 'dm/openDetail'),
  closeDetail: () => set({ detailId: null }, false, 'dm/closeDetail'),
  requestDelete: (ids) => set({ deleteTarget: ids }, false, 'dm/requestDelete'),
  cancelDelete: () => set({ deleteTarget: null }, false, 'dm/cancelDelete'),
})

export const useDataManagementStore = create<DataManagementState>()(
  devtools(creator, { name: 'DataManagementStore', enabled: process.env.NODE_ENV === 'development' }),
)

// ── selectors ──────────────────────────────────────────────────────
export const useCollection = () => useDataManagementStore((s) => s.collection)
export const useSetCollection = () => useDataManagementStore((s) => s.setCollection)
export const useRecordQuery = (): SearchQuery =>
  useDataManagementStore(
    useShallow((s) => ({ q: s.q, page: s.page, limit: s.limit, filters: s.filters, sort: s.sort })),
  )
```

- [ ] **Step 2: Write the failing test**

```ts
// frontend/lib/state-management/__tests__/data-management.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'

const get = () => useDataManagementStore.getState()

beforeEach(() => {
  useDataManagementStore.setState({
    collection: 'products', q: '', page: 1, limit: 20, filters: {}, sort: [],
    selection: {}, columnVisibility: {}, panel: 'closed', detailId: null, deleteTarget: null,
  })
})

describe('data-management store', () => {
  it('setSearch resets page to 1', () => {
    get().setPage(5)
    get().setSearch('laptop')
    expect(get().q).toBe('laptop')
    expect(get().page).toBe(1)
  })

  it('toggleSort cycles asc → desc → off', () => {
    get().toggleSort('price')
    expect(get().sort).toEqual([{ field: 'price', dir: 'asc' }])
    get().toggleSort('price')
    expect(get().sort).toEqual([{ field: 'price', dir: 'desc' }])
    get().toggleSort('price')
    expect(get().sort).toEqual([])
  })

  it('toggleSort on a new field replaces the previous sort', () => {
    get().toggleSort('price')
    get().toggleSort('name')
    expect(get().sort).toEqual([{ field: 'name', dir: 'asc' }])
  })

  it('setFilter adds then clears, resetting page each time', () => {
    get().setPage(3)
    get().setFilter('status', ['active'])
    expect(get().filters).toEqual({ status: ['active'] })
    expect(get().page).toBe(1)
    get().setFilter('status', undefined)
    expect(get().filters).toEqual({})
  })

  it('setCollection resets query and selection', () => {
    get().setSearch('x'); get().setFilter('a', 1); get().setSelection({ r1: true })
    get().setCollection('orders')
    expect(get().collection).toBe('orders')
    expect(get().q).toBe('')
    expect(get().filters).toEqual({})
    expect(get().selection).toEqual({})
  })

  it('setSelection supports functional updaters', () => {
    get().setSelection({ r1: true })
    get().setSelection((prev) => ({ ...prev, r2: true }))
    expect(get().selection).toEqual({ r1: true, r2: true })
  })

  it('dialog actions toggle panel / detail / delete state', () => {
    get().openCreate(); expect(get().panel).toBe('create')
    get().closeCreate(); expect(get().panel).toBe('closed')
    get().openDetail('r1'); expect(get().detailId).toBe('r1')
    get().requestDelete(['r1', 'r2']); expect(get().deleteTarget).toEqual(['r1', 'r2'])
    get().cancelDelete(); expect(get().deleteTarget).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/state-management/__tests__/data-management.store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/state-management/data-management.store.ts frontend/lib/state-management/__tests__/data-management.store.test.ts
git commit -m "feat(data-mgmt): page orchestration store"
```

---

## Task 5: Dynamic zod schema builder

**Files:**
- Create: `frontend/lib/schema/field-to-zod.ts`
- Test: `frontend/lib/schema/__tests__/field-to-zod.test.ts`

**Interfaces:**
- Consumes: `FieldSpec` from Task 1; `z` from `zod`.
- Produces: `buildRecordSchema(fields: FieldSpec[]): z.ZodType<Record<string, unknown>>`.

Notes: numbers use `z.coerce.number()` so string inputs coerce; dates are validated as non-empty strings (ISO). Optional (non-required) fields are `.optional()`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/lib/schema/__tests__/field-to-zod.test.ts
import { describe, it, expect } from 'vitest'
import { buildRecordSchema } from '@/lib/schema/field-to-zod'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

describe('buildRecordSchema', () => {
  it('requires a required string and rejects empty', () => {
    const schema = buildRecordSchema([{ name: 'title', type: 'string', required: true }])
    expect(schema.safeParse({ title: 'hi' }).success).toBe(true)
    expect(schema.safeParse({ title: '' }).success).toBe(false)
  })
  it('coerces number inputs', () => {
    const schema = buildRecordSchema([{ name: 'price', type: 'number', required: true }])
    const parsed = schema.safeParse({ price: '42' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.price).toBe(42)
  })
  it('constrains enum values', () => {
    const schema = buildRecordSchema([{ name: 'status', type: 'string', enum: ['active', 'archived'] }])
    expect(schema.safeParse({ status: 'active' }).success).toBe(true)
    expect(schema.safeParse({ status: 'nope' }).success).toBe(false)
  })
  it('treats non-required fields as optional', () => {
    const schema = buildRecordSchema([{ name: 'note', type: 'string' }])
    expect(schema.safeParse({}).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run lib/schema/__tests__/field-to-zod.test.ts`
Expected: FAIL — cannot resolve `@/lib/schema/field-to-zod`.

- [ ] **Step 3: Implement the builder**

```ts
// frontend/lib/schema/field-to-zod.ts
import { z } from 'zod'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

/** Build a zod object schema for a collection's create/edit form. */
export function buildRecordSchema(fields: FieldSpec[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) shape[f.name] = applyRequired(f, fieldToZod(f))
  return z.object(shape)
}

function fieldToZod(f: FieldSpec): z.ZodTypeAny {
  if (f.enum && f.enum.length) {
    const values = f.enum.map(String) as [string, ...string[]]
    return f.type === 'string[]' || f.type === 'number[]'
      ? z.array(z.enum(values))
      : z.enum(values)
  }
  switch (f.type) {
    case 'number': return z.coerce.number()
    case 'boolean': return z.boolean()
    case 'date': return z.string().min(1, `${f.name} is required`)
    case 'string[]': return z.array(z.string())
    case 'number[]': return z.array(z.coerce.number())
    default: return z.string()
  }
}

function applyRequired(f: FieldSpec, schema: z.ZodTypeAny): z.ZodTypeAny {
  if (!f.required) return schema.optional()
  if (schema instanceof z.ZodString) return schema.min(1, `${f.name} is required`)
  return schema
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/schema/__tests__/field-to-zod.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/schema/field-to-zod.ts frontend/lib/schema/__tests__/field-to-zod.test.ts
git commit -m "feat(data-mgmt): dynamic zod schema from field specs"
```

---

## Task 6: Column builder + type-aware cell

**Files:**
- Create: `frontend/components/data-management/field-cell.tsx`
- Create: `frontend/lib/schema/field-to-column.tsx`
- Test: `frontend/components/data-management/__tests__/field-cell.test.tsx`
- Test: `frontend/lib/schema/__tests__/field-to-column.test.tsx`

**Interfaces:**
- Consumes: `FieldSpec`, `RecordHit` from Task 1; `ColumnDef` from `@tanstack/react-table`; `Badge` from `@/components/ui/badge`.
- Produces: `FieldCell({ field, value }: { field: FieldSpec; value: unknown })`; `RecordColumnMeta` (`{ field: FieldSpec }`); `buildColumns(fields: FieldSpec[]): ColumnDef<RecordHit>[]` (data columns only — the table prepends select and appends actions).

- [ ] **Step 1: Create the cell renderer**

```tsx
// frontend/components/data-management/field-cell.tsx
import { Badge } from '@/components/ui/badge'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

function Dash() {
  return <span className="text-muted-foreground">—</span>
}

export function FieldCell({ field, value }: { field: FieldSpec; value: unknown }) {
  if (value === null || value === undefined || value === '') return <Dash />

  if (field.type === 'boolean') {
    return <Badge variant="outline">{value ? 'Yes' : 'No'}</Badge>
  }
  if (field.type === 'date') {
    const d = new Date(value as string)
    return <span>{Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString()}</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <Dash />
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <Badge key={i} variant="outline" className="text-muted-foreground">
            {String(v)}
          </Badge>
        ))}
      </div>
    )
  }
  if (field.enum) {
    return <Badge variant="outline" className="text-muted-foreground">{String(value)}</Badge>
  }
  return <span className="block max-w-[28ch] truncate">{String(value)}</span>
}
```

- [ ] **Step 2: Create the column builder**

```tsx
// frontend/lib/schema/field-to-column.tsx
import type { ColumnDef } from '@tanstack/react-table'
import { FieldCell } from '@/components/data-management/field-cell'
import type { FieldSpec, RecordHit } from '@/lib/interfaces/search.interface'

export interface RecordColumnMeta {
  field: FieldSpec
}

/** Data columns derived from the collection field specs (no select/actions). */
export function buildColumns(fields: FieldSpec[]): ColumnDef<RecordHit>[] {
  return fields.map((field) => ({
    id: field.name,
    accessorKey: field.name,
    header: field.name,
    enableSorting: !!field.sortable,
    enableHiding: true,
    meta: { field } satisfies RecordColumnMeta,
    cell: ({ getValue }) => <FieldCell field={field} value={getValue()} />,
  }))
}
```

- [ ] **Step 3: Write the failing tests**

```tsx
// frontend/lib/schema/__tests__/field-to-column.test.tsx
import { describe, it, expect } from 'vitest'
import { buildColumns, type RecordColumnMeta } from '@/lib/schema/field-to-column'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

const fields: FieldSpec[] = [
  { name: 'title', type: 'string' },
  { name: 'price', type: 'number', sortable: true },
]

describe('buildColumns', () => {
  it('creates one column per field with ids and sort flags', () => {
    const cols = buildColumns(fields)
    expect(cols.map((c) => c.id)).toEqual(['title', 'price'])
    expect(cols[0].enableSorting).toBe(false)
    expect(cols[1].enableSorting).toBe(true)
  })
  it('carries the field spec in column meta', () => {
    const cols = buildColumns(fields)
    expect((cols[1].meta as RecordColumnMeta).field.name).toBe('price')
  })
})
```

```tsx
// frontend/components/data-management/__tests__/field-cell.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FieldCell } from '@/components/data-management/field-cell'

describe('FieldCell', () => {
  it('renders a dash for empty values', () => {
    render(<FieldCell field={{ name: 'x', type: 'string' }} value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
  it('renders a badge per array item', () => {
    render(<FieldCell field={{ name: 'tags', type: 'string[]' }} value={['a', 'b']} />)
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })
  it('renders Yes/No for booleans', () => {
    render(<FieldCell field={{ name: 'active', type: 'boolean' }} value={true} />)
    expect(screen.getByText('Yes')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run lib/schema/__tests__/field-to-column.test.tsx components/data-management/__tests__/field-cell.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/data-management/field-cell.tsx frontend/lib/schema/field-to-column.tsx frontend/components/data-management/__tests__/field-cell.test.tsx frontend/lib/schema/__tests__/field-to-column.test.tsx
git commit -m "feat(data-mgmt): schema-driven columns + type-aware cells"
```

---

## Task 7: Schema-driven form input

**Files:**
- Create: `frontend/components/data-management/field-to-input.tsx`
- Test: `frontend/components/data-management/__tests__/field-to-input.test.tsx`

**Interfaces:**
- Consumes: `FieldSpec` from Task 1; `Control`, `Controller` from `react-hook-form`; shadcn `Field/FieldLabel/FieldError`, `Input`, `Switch`, `Select*`, `Badge`, `Button`.
- Produces: `RecordFieldInput({ field, control }: { field: FieldSpec; control: Control<Record<string, unknown>> })`.

Notes: one `Controller` per field. `string`→Input, `number`→numeric Input (coerces to number/undefined), `boolean`→Switch, `date`→native date Input, single `enum`→Select, `string[]`/`number[]`→inline `TagsInput`. The `attachments` field is handled separately (Task 13), not here.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/data-management/__tests__/field-to-input.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { RecordFieldInput } from '@/components/data-management/field-to-input'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

function Harness({ field }: { field: FieldSpec }) {
  const { control } = useForm<Record<string, unknown>>({ defaultValues: {} })
  return <RecordFieldInput field={field} control={control} />
}

describe('RecordFieldInput', () => {
  it('renders a labeled text input for a string field', () => {
    render(<Harness field={{ name: 'title', type: 'string' }} />)
    expect(screen.getByLabelText('title')).toBeInTheDocument()
  })
  it('renders a select for an enum field', () => {
    render(<Harness field={{ name: 'status', type: 'string', enum: ['active', 'archived'] }} />)
    expect(screen.getByLabelText('status')).toBeInTheDocument()
  })
  it('renders a number input for a number field', () => {
    render(<Harness field={{ name: 'price', type: 'number' }} />)
    expect(screen.getByLabelText('price')).toHaveAttribute('type', 'number')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/data-management/__tests__/field-to-input.test.tsx`
Expected: FAIL — cannot resolve `@/components/data-management/field-to-input`.

- [ ] **Step 3: Implement the input component**

```tsx
// frontend/components/data-management/field-to-input.tsx
'use client'

import * as React from 'react'
import { Controller, type Control, type ControllerRenderProps } from 'react-hook-form'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

type F = ControllerRenderProps<Record<string, unknown>, string>

export function RecordFieldInput({
  field,
  control,
}: {
  field: FieldSpec
  control: Control<Record<string, unknown>>
}) {
  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: f, fieldState }) => (
        <Field data-invalid={fieldState.error ? 'true' : undefined}>
          <FieldLabel htmlFor={field.name}>
            {field.name}
            {field.required ? ' *' : ''}
          </FieldLabel>
          {renderWidget(field, f)}
          {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
        </Field>
      )}
    />
  )
}

function renderWidget(field: FieldSpec, f: F) {
  if (field.enum && field.type !== 'string[]' && field.type !== 'number[]') {
    return (
      <Select value={f.value ? String(f.value) : ''} onValueChange={f.onChange}>
        <SelectTrigger id={field.name} className="w-full">
          <SelectValue placeholder={`Select ${field.name}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {field.enum.map((opt) => (
              <SelectItem key={String(opt)} value={String(opt)}>{String(opt)}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    )
  }
  switch (field.type) {
    case 'boolean':
      return <Switch id={field.name} checked={!!f.value} onCheckedChange={f.onChange} />
    case 'number':
      return (
        <Input
          id={field.name}
          type="number"
          value={f.value === undefined || f.value === null ? '' : String(f.value)}
          onChange={(e) => f.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )
    case 'date':
      return (
        <Input
          id={field.name}
          type="date"
          value={typeof f.value === 'string' ? f.value : ''}
          onChange={(e) => f.onChange(e.target.value)}
        />
      )
    case 'string[]':
    case 'number[]':
      return <TagsInput id={field.name} value={f.value} numeric={field.type === 'number[]'} onChange={f.onChange} />
    default:
      return (
        <Input
          id={field.name}
          value={typeof f.value === 'string' ? f.value : ''}
          onChange={(e) => f.onChange(e.target.value)}
        />
      )
  }
}

function TagsInput({
  id,
  value,
  numeric,
  onChange,
}: {
  id: string
  value: unknown
  numeric?: boolean
  onChange: (v: unknown[]) => void
}) {
  const items = Array.isArray(value) ? value : []
  const [draft, setDraft] = React.useState('')

  const add = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    onChange([...items, numeric ? Number(trimmed) : trimmed])
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add() }
          }}
          placeholder="Type and press Enter"
        />
        <Button type="button" variant="outline" onClick={add}>Add</Button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {items.map((it, i) => (
            <Badge key={i} variant="secondary" className="gap-1">
              {String(it)}
              <button
                type="button"
                aria-label={`Remove ${String(it)}`}
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/data-management/__tests__/field-to-input.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/data-management/field-to-input.tsx frontend/components/data-management/__tests__/field-to-input.test.tsx
git commit -m "feat(data-mgmt): schema-driven form inputs"
```

---

## Task 8: Schema-driven filter control

**Files:**
- Create: `frontend/components/data-management/field-to-filter.tsx`
- Test: `frontend/components/data-management/__tests__/field-to-filter.test.tsx`

**Interfaces:**
- Consumes: `FieldSpec`, `FilterValue` from Task 1; shadcn `Checkbox`, `Label`, `Input`, `Select*`.
- Produces: `FilterControl({ field, value, onChange }: { field: FieldSpec; value: FilterValue | undefined; onChange: (v: FilterValue | undefined) => void })`.

Notes: `enum`→checkbox multiselect (emits array = IN, or `undefined` when empty); `boolean`→tri-state Select (Any/Yes/No); `number`→exact number input; other `string`→exact text input.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/data-management/__tests__/field-to-filter.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterControl } from '@/components/data-management/field-to-filter'

describe('FilterControl', () => {
  it('enum: toggling a checkbox emits an array (IN)', () => {
    const onChange = vi.fn()
    render(<FilterControl field={{ name: 'status', type: 'string', enum: ['active', 'archived'] }} value={undefined} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('active'))
    expect(onChange).toHaveBeenCalledWith(['active'])
  })
  it('enum: unchecking the last value emits undefined', () => {
    const onChange = vi.fn()
    render(<FilterControl field={{ name: 'status', type: 'string', enum: ['active'] }} value={['active']} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('active'))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })
  it('number: emits a number or undefined', () => {
    const onChange = vi.fn()
    render(<FilterControl field={{ name: 'price', type: 'number' }} value={undefined} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('price'), { target: { value: '10' } })
    expect(onChange).toHaveBeenCalledWith(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/data-management/__tests__/field-to-filter.test.tsx`
Expected: FAIL — cannot resolve `@/components/data-management/field-to-filter`.

- [ ] **Step 3: Implement the filter control**

```tsx
// frontend/components/data-management/field-to-filter.tsx
'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { FieldSpec, FilterValue } from '@/lib/interfaces/search.interface'

export function FilterControl({
  field,
  value,
  onChange,
}: {
  field: FieldSpec
  value: FilterValue | undefined
  onChange: (v: FilterValue | undefined) => void
}) {
  if (field.enum && field.enum.length) {
    const selected = Array.isArray(value) ? value.map(String) : []
    const toggle = (opt: string, checked: boolean) => {
      const next = checked ? [...selected, opt] : selected.filter((v) => v !== opt)
      onChange(next.length ? next : undefined)
    }
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{field.name}</span>
        {field.enum.map((opt) => {
          const key = String(opt)
          return (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={`f-${field.name}-${key}`}
                checked={selected.includes(key)}
                onCheckedChange={(c) => toggle(key, !!c)}
              />
              <Label htmlFor={`f-${field.name}-${key}`}>{key}</Label>
            </div>
          )
        })}
      </div>
    )
  }

  if (field.type === 'boolean') {
    const v = value === undefined ? 'any' : value ? 'true' : 'false'
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={`f-${field.name}`}>{field.name}</Label>
        <Select
          value={v}
          onValueChange={(next) => onChange(next === 'any' ? undefined : next === 'true')}
        >
          <SelectTrigger id={`f-${field.name}`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )
  }

  const isNumber = field.type === 'number'
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`f-${field.name}`}>{field.name}</Label>
      <Input
        id={field.name}
        type={isNumber ? 'number' : 'text'}
        value={value === undefined ? '' : String(value)}
        placeholder="Exact match"
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') return onChange(undefined)
          onChange(isNumber ? Number(raw) : raw)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/data-management/__tests__/field-to-filter.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/data-management/field-to-filter.tsx frontend/components/data-management/__tests__/field-to-filter.test.tsx
git commit -m "feat(data-mgmt): schema-driven exact-match filters"
```

---

## Task 9: Read hooks (collections, definition, records)

**Files:**
- Create: `frontend/lib/hooks/use-collections.ts`
- Create: `frontend/lib/hooks/use-collection-definition.ts`
- Create: `frontend/lib/hooks/use-records.ts`
- Test: `frontend/lib/hooks/__tests__/use-records.test.tsx`

**Interfaces:**
- Consumes: `useSWR`; global SWR fetcher (already wired in `components/providers/swr-provider.tsx`); `recordService.query`; store selectors `useCollection`, `useRecordQuery`; types from Task 1.
- Produces: `useCollections(): { collections: CollectionView[]; isLoading; error }`; `useCollectionDefinition(name: string | null): { definition: CollectionView | null; fields: FieldSpec[]; isLoading; error }`; `useRecords(): { results?: SearchResults; isLoading; isValidating; error; mutate }`.

- [ ] **Step 1: Create the collection hooks**

```ts
// frontend/lib/hooks/use-collections.ts
import useSWR from 'swr'
import type { CollectionView } from '@/lib/interfaces/search.interface'

export function useCollections() {
  const { data, isLoading, error } = useSWR<CollectionView[]>('/search/collections')
  return { collections: data ?? [], isLoading, error }
}
```

```ts
// frontend/lib/hooks/use-collection-definition.ts
import useSWR from 'swr'
import type { CollectionView, FieldSpec } from '@/lib/interfaces/search.interface'

export function useCollectionDefinition(name: string | null) {
  const { data, isLoading, error } = useSWR<CollectionView>(
    name ? `/search/collections/${encodeURIComponent(name)}` : null,
  )
  return {
    definition: data ?? null,
    fields: (data?.fields ?? []) as FieldSpec[],
    isLoading,
    error,
  }
}
```

- [ ] **Step 2: Create the records hook**

```ts
// frontend/lib/hooks/use-records.ts
import useSWR from 'swr'
import { recordService } from '@/lib/services/record.service'
import { useCollection, useRecordQuery } from '@/lib/state-management/data-management.store'
import type { SearchResults } from '@/lib/interfaces/search.interface'

/**
 * Records for the active collection + query. POST-based, so it uses an explicit
 * fetcher (the global GET fetcher does not apply). `keepPreviousData` avoids a
 * flash to empty while paginating/filtering.
 */
export function useRecords() {
  const collection = useCollection()
  const query = useRecordQuery()
  const key = collection ? (['records', collection, query] as const) : null

  const { data, isLoading, isValidating, error, mutate } = useSWR<SearchResults>(
    key,
    () => recordService.query(collection as string, query),
    { keepPreviousData: true },
  )
  return { results: data, isLoading, isValidating, error, mutate }
}
```

- [ ] **Step 3: Write the failing test**

```tsx
// frontend/lib/hooks/__tests__/use-records.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import React from 'react'

vi.mock('@/lib/services/record.service', () => ({
  recordService: { query: vi.fn() },
}))

import { recordService } from '@/lib/services/record.service'
import { useRecords } from '@/lib/hooks/use-records'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

beforeEach(() => {
  vi.clearAllMocks()
  useDataManagementStore.setState({ collection: 'products', q: '', page: 1, limit: 20, filters: {}, sort: [] })
})

describe('useRecords', () => {
  it('fetches records for the active collection + query', async () => {
    vi.mocked(recordService.query).mockResolvedValue({ hits: [{ id: 'r1' }], page: 1, limit: 20, totalHits: 1, totalPages: 1, processingTimeMs: 1 })
    const { result } = renderHook(() => useRecords(), { wrapper })
    await waitFor(() => expect(result.current.results?.totalHits).toBe(1))
    expect(recordService.query).toHaveBeenCalledWith('products', expect.objectContaining({ page: 1, limit: 20 }))
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/hooks/__tests__/use-records.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/hooks/use-collections.ts frontend/lib/hooks/use-collection-definition.ts frontend/lib/hooks/use-records.ts frontend/lib/hooks/__tests__/use-records.test.tsx
git commit -m "feat(data-mgmt): SWR read hooks for collections + records"
```

---

## Task 10: Mutation + upload hooks

**Files:**
- Create: `frontend/lib/hooks/use-record-mutations.ts`
- Create: `frontend/lib/hooks/use-file-upload.ts`
- Test: `frontend/lib/hooks/__tests__/use-file-upload.test.tsx`

**Interfaces:**
- Consumes: `recordService`, `fileService`; `useCollection`; `useRecords` (for `mutate`); `toast`; types from Task 1.
- Produces:
  - `useRecordMutations(): { create(input): Promise<PersistResult>; update(input): Promise<PersistResult>; remove(ids: string[]): Promise<void>; reindex(): Promise<void> }` (`update` is `create` — persist upserts on `externalId`).
  - `useFileUpload(): { items: UploadItem[]; uploadAll(files: File[], metadata?): Promise<string[]>; reset(): void }`, where `UploadItem = { file: File; status: 'pending'|'uploading'|'done'|'error'; fileId?: string; error?: string }`.

- [ ] **Step 1: Create the mutations hook**

```ts
// frontend/lib/hooks/use-record-mutations.ts
'use client'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { recordService } from '@/lib/services/record.service'
import { useCollection } from '@/lib/state-management/data-management.store'
import { useRecords } from '@/lib/hooks/use-records'
import type { PersistRecordInput, SearchResults } from '@/lib/interfaces/search.interface'

const REVALIDATE_DELAY_MS = 1200 // async-indexing settle window

export function useRecordMutations() {
  const collection = useCollection()
  const { mutate } = useRecords()

  const revalidateSoon = useCallback(() => {
    setTimeout(() => void mutate(), REVALIDATE_DELAY_MS)
  }, [mutate])

  const create = useCallback(
    async (input: PersistRecordInput) => {
      if (!collection) throw new Error('No collection selected')
      const [res] = await recordService.persist(collection, [input])
      toast.success('Record queued for indexing', {
        description: `Status: ${res?.indexState ?? 'PENDING'} — it will appear shortly.`,
      })
      revalidateSoon()
      return res
    },
    [collection, revalidateSoon],
  )

  const remove = useCallback(
    async (ids: string[]) => {
      if (!collection) throw new Error('No collection selected')
      await Promise.all(ids.map((id) => recordService.remove(collection, id)))
      toast.success(`${ids.length} record(s) deleted`)
      await mutate(
        (prev?: SearchResults) =>
          prev
            ? {
                ...prev,
                hits: prev.hits.filter((h) => !ids.includes(h.id)),
                totalHits: Math.max(0, prev.totalHits - ids.length),
              }
            : prev,
        { revalidate: false },
      )
      revalidateSoon()
    },
    [collection, mutate, revalidateSoon],
  )

  const reindex = useCallback(async () => {
    if (!collection) return
    await recordService.reload(collection)
    toast.info('Reindex started')
    revalidateSoon()
  }, [collection, revalidateSoon])

  return { create, update: create, remove, reindex }
}
```

- [ ] **Step 2: Create the upload hook**

```ts
// frontend/lib/hooks/use-file-upload.ts
'use client'
import { useCallback, useState } from 'react'
import { fileService } from '@/lib/services/file.service'

export interface UploadItem {
  file: File
  status: 'pending' | 'uploading' | 'done' | 'error'
  fileId?: string
  error?: string
}

export function useFileUpload() {
  const [items, setItems] = useState<UploadItem[]>([])

  const patch = (file: File, p: Partial<UploadItem>) =>
    setItems((prev) => prev.map((it) => (it.file === file ? { ...it, ...p } : it)))

  const uploadAll = useCallback(
    async (files: File[], metadata?: Record<string, unknown>): Promise<string[]> => {
      setItems((prev) => [...prev, ...files.map((file) => ({ file, status: 'pending' as const }))])
      const ids: string[] = []
      for (const file of files) {
        try {
          patch(file, { status: 'uploading' })
          const init = await fileService.initiate({
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            metadata,
          })
          if (!init.deduplicated && init.upload) {
            await fileService.uploadToPolicy(init.upload, file)
            await fileService.complete(init.fileId)
          }
          patch(file, { status: 'done', fileId: init.fileId })
          ids.push(init.fileId)
        } catch (err) {
          patch(file, { status: 'error', error: err instanceof Error ? err.message : 'Upload failed' })
          throw err
        }
      }
      return ids
    },
    [],
  )

  const reset = useCallback(() => setItems([]), [])
  return { items, uploadAll, reset }
}
```

- [ ] **Step 3: Write the failing test**

```tsx
// frontend/lib/hooks/__tests__/use-file-upload.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/lib/services/file.service', () => ({
  fileService: { initiate: vi.fn(), uploadToPolicy: vi.fn(), complete: vi.fn() },
}))

import { fileService } from '@/lib/services/file.service'
import { useFileUpload } from '@/lib/hooks/use-file-upload'

beforeEach(() => vi.clearAllMocks())

describe('useFileUpload', () => {
  it('runs initiate → upload → complete and returns file ids', async () => {
    vi.mocked(fileService.initiate).mockResolvedValue({ fileId: 'f1', deduplicated: false, upload: { url: 'u', expiresIn: 60 } })
    vi.mocked(fileService.uploadToPolicy).mockResolvedValue()
    vi.mocked(fileService.complete).mockResolvedValue({} as never)
    const { result } = renderHook(() => useFileUpload())
    let ids: string[] = []
    await act(async () => {
      ids = await result.current.uploadAll([new File(['x'], 'a.pdf', { type: 'application/pdf' })])
    })
    expect(ids).toEqual(['f1'])
    expect(fileService.complete).toHaveBeenCalledWith('f1')
  })

  it('skips upload+complete when deduplicated', async () => {
    vi.mocked(fileService.initiate).mockResolvedValue({ fileId: 'dup', deduplicated: true })
    const { result } = renderHook(() => useFileUpload())
    let ids: string[] = []
    await act(async () => {
      ids = await result.current.uploadAll([new File(['x'], 'a.pdf')])
    })
    expect(ids).toEqual(['dup'])
    expect(fileService.uploadToPolicy).not.toHaveBeenCalled()
    expect(fileService.complete).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/hooks/__tests__/use-file-upload.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/hooks/use-record-mutations.ts frontend/lib/hooks/use-file-upload.ts frontend/lib/hooks/__tests__/use-file-upload.test.tsx
git commit -m "feat(data-mgmt): record mutation + file upload hooks"
```

---

## Task 11: Controlled data table

**Files:**
- Create: `frontend/components/data-management/record-data-table.tsx`
- Test: `frontend/components/data-management/__tests__/record-data-table.test.tsx`

**Interfaces:**
- Consumes: `buildColumns` (Task 6), `RecordColumnMeta`, store (selection/columnVisibility/sort/page/limit + actions), `useIsAdmin`, `DataPagination` (`@/components/ui/data-pagination`), shadcn `Table*`, `Checkbox`, `Button`, `DropdownMenu*`, `Select*`, `Skeleton`, `Empty*`, Hugeicons.
- Produces: `RecordDataTable({ fields, results, isLoading, error, onRetry }: { fields: FieldSpec[]; results?: SearchResults; isLoading: boolean; error?: unknown; onRetry: () => void })`.

Behavior: prepends a select column and appends an actions column (admin-only Edit/Delete → `openDetail`/`requestDelete`). Sortable headers are buttons calling `toggleSort` with an asc/desc indicator from store `sort`. Column-visibility dropdown uses the table instance. Footer: rows-per-page Select (`setLimit`) + `DataPagination` (`setPage`). Loading→skeleton rows; empty→`Empty`; error→retry.

- [ ] **Step 1: Implement the table**

```tsx
// frontend/components/data-management/record-data-table.tsx
'use client'

import * as React from 'react'
import {
  flexRender, getCoreRowModel, useReactTable, type ColumnDef,
} from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowUp01Icon, ArrowDown01Icon, ArrowUpDownIcon, LeftToRightListBulletIcon,
  MoreVerticalCircle01Icon, RefreshIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { DataPagination } from '@/components/ui/data-pagination'
import { useIsAdmin } from '@/lib/hooks/use-permission'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import { buildColumns, type RecordColumnMeta } from '@/lib/schema/field-to-column'
import type { FieldSpec, RecordHit, SearchResults } from '@/lib/interfaces/search.interface'

const PAGE_SIZES = [10, 20, 30, 50]

export function RecordDataTable({
  fields,
  results,
  isLoading,
  error,
  onRetry,
}: {
  fields: FieldSpec[]
  results?: SearchResults
  isLoading: boolean
  error?: unknown
  onRetry: () => void
}) {
  const isAdmin = useIsAdmin()
  const s = useDataManagementStore()

  const columns = React.useMemo<ColumnDef<RecordHit>[]>(() => {
    const dataCols = buildColumns(fields)
    const select: ColumnDef<RecordHit> = {
      id: 'select',
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
        />
      ),
    }
    const actions: ColumnDef<RecordHit> = {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
              <HugeiconsIcon icon={MoreVerticalCircle01Icon} strokeWidth={2} />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem onClick={() => s.openDetail(row.original.id)}>
              {isAdmin ? 'Edit' : 'View'}
            </DropdownMenuItem>
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => s.requestDelete([row.original.id])}>
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }
    return [select, ...dataCols, actions]
  }, [fields, isAdmin, s])

  const table = useReactTable({
    data: results?.hits ?? [],
    columns,
    state: { rowSelection: s.selection, columnVisibility: s.columnVisibility },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: s.setSelection,
    onColumnVisibilityChange: s.setColumnVisibility,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: results?.totalPages ?? 0,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {Object.keys(s.selection).length > 0
            ? `${Object.keys(s.selection).length} selected`
            : results
              ? `${results.totalHits} record(s)`
              : ''}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <HugeiconsIcon icon={LeftToRightListBulletIcon} strokeWidth={2} />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {table.getAllColumns().filter((c) => c.getCanHide()).map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                className="capitalize"
                checked={c.getIsVisible()}
                onCheckedChange={(v) => c.toggleVisibility(!!v)}
              >
                {c.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta as RecordColumnMeta | undefined
                  const sortable = meta?.field.sortable
                  const active = s.sort[0]?.field === meta?.field.name ? s.sort[0] : undefined
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : sortable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2 h-8"
                          onClick={() => s.toggleSort(meta!.field.name)}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <HugeiconsIcon
                            icon={active ? (active.dir === 'asc' ? ArrowUp01Icon : ArrowDown01Icon) : ArrowUpDownIcon}
                            strokeWidth={2}
                            className="size-3.5"
                          />
                        </Button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-40">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>Could not load records</EmptyTitle>
                      <EmptyDescription>The search service may be unavailable.</EmptyDescription>
                    </EmptyHeader>
                    <Button variant="outline" onClick={onRetry}>
                      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} /> Retry
                    </Button>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : isLoading && !results ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_c, j) => (
                    <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-40">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No records</EmptyTitle>
                      <EmptyDescription>Try adjusting your search or filters.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="hidden items-center gap-2 lg:flex">
          <Label htmlFor="rows-per-page" className="text-sm font-medium">Rows per page</Label>
          <Select value={String(s.limit)} onValueChange={(v) => s.setLimit(Number(v))}>
            <SelectTrigger size="sm" className="w-20" id="rows-per-page"><SelectValue /></SelectTrigger>
            <SelectContent side="top">
              <SelectGroup>
                {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <DataPagination
          page={s.page}
          pageSize={s.limit}
          total={results?.totalHits ?? 0}
          onPageChange={s.setPage}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/components/data-management/__tests__/record-data-table.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/hooks/use-permission', () => ({ useIsAdmin: () => true }))

import { RecordDataTable } from '@/components/data-management/record-data-table'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec, SearchResults } from '@/lib/interfaces/search.interface'

const fields: FieldSpec[] = [{ name: 'title', type: 'string' }, { name: 'price', type: 'number', sortable: true }]

beforeEach(() => {
  useDataManagementStore.setState({ collection: 'products', q: '', page: 1, limit: 20, filters: {}, sort: [], selection: {}, columnVisibility: {} })
})

describe('RecordDataTable', () => {
  it('renders rows from results', () => {
    const results: SearchResults = { hits: [{ id: 'r1', title: 'Laptop', price: 999 }], page: 1, limit: 20, totalHits: 1, totalPages: 1, processingTimeMs: 1 }
    render(<RecordDataTable fields={fields} results={results} isLoading={false} onRetry={() => {}} />)
    expect(screen.getByText('Laptop')).toBeInTheDocument()
    expect(screen.getByText('1 record(s)')).toBeInTheDocument()
  })

  it('shows an empty state when there are no hits', () => {
    const results: SearchResults = { hits: [], page: 1, limit: 20, totalHits: 0, totalPages: 0, processingTimeMs: 1 }
    render(<RecordDataTable fields={fields} results={results} isLoading={false} onRetry={() => {}} />)
    expect(screen.getByText('No records')).toBeInTheDocument()
  })

  it('shows an error state with retry', () => {
    render(<RecordDataTable fields={fields} results={undefined} isLoading={false} error={new Error('x')} onRetry={() => {}} />)
    expect(screen.getByText('Could not load records')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/data-management/__tests__/record-data-table.test.tsx`
Expected: PASS (3 tests). If a Hugeicons icon name is unresolved, replace it with any existing exported icon from `@hugeicons/core-free-icons` (verify with `grep -o "[A-Za-z0-9]*Icon" node_modules/@hugeicons/core-free-icons/dist/esm/index.d.ts | sort -u`).

- [ ] **Step 4: Commit**

```bash
git add frontend/components/data-management/record-data-table.tsx frontend/components/data-management/__tests__/record-data-table.test.tsx
git commit -m "feat(data-mgmt): controlled server-side data table"
```

---

## Task 12: Toolbar + filters

**Files:**
- Create: `frontend/components/data-management/record-filters.tsx`
- Create: `frontend/components/data-management/record-toolbar.tsx`
- Test: `frontend/components/data-management/__tests__/record-toolbar.test.tsx`

**Interfaces:**
- Consumes: `FilterControl` (Task 8); store; `useCollections`; `useIsAdmin`; shadcn `Select*`, `Input`, `Popover*`, `Button`, `Badge`; Hugeicons.
- Produces: `RecordFilters({ fields })`; `RecordToolbar({ fields }: { fields: FieldSpec[] })`.

Behavior: collection `Select` (→ `setCollection`); debounced search `Input` (→ `setSearch`); a Filters `Popover` containing `RecordFilters` with an active-filter count badge + "Clear all"; admin-only "New record" (→ `openCreate`) and "Delete selected" (→ `requestDelete(Object.keys(selection))`, shown when selection non-empty).

- [ ] **Step 1: Create the filters panel**

```tsx
// frontend/components/data-management/record-filters.tsx
'use client'

import { Button } from '@/components/ui/button'
import { FilterControl } from '@/components/data-management/field-to-filter'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

export function RecordFilters({ fields }: { fields: FieldSpec[] }) {
  const filters = useDataManagementStore((s) => s.filters)
  const setFilter = useDataManagementStore((s) => s.setFilter)
  const clearFilters = useDataManagementStore((s) => s.clearFilters)
  const filterable = fields.filter((f) => f.filterable)

  if (filterable.length === 0) {
    return <p className="text-sm text-muted-foreground">No filterable fields in this collection.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {filterable.map((field) => (
        <FilterControl
          key={field.name}
          field={field}
          value={filters[field.name]}
          onChange={(v) => setFilter(field.name, v)}
        />
      ))}
      <Button variant="ghost" size="sm" className="self-end" onClick={clearFilters}>
        Clear all
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Create the toolbar**

```tsx
// frontend/components/data-management/record-toolbar.tsx
'use client'

import * as React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, FilterIcon, Delete02Icon, SearchIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RecordFilters } from '@/components/data-management/record-filters'
import { useCollections } from '@/lib/hooks/use-collections'
import { useIsAdmin } from '@/lib/hooks/use-permission'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

export function RecordToolbar({ fields }: { fields: FieldSpec[] }) {
  const isAdmin = useIsAdmin()
  const { collections } = useCollections()
  const s = useDataManagementStore()
  const activeFilters = Object.keys(s.filters).length
  const selectedIds = Object.keys(s.selection)

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 lg:px-6">
      <Select value={s.collection ?? ''} onValueChange={s.setCollection}>
        <SelectTrigger className="w-56" size="sm">
          <SelectValue placeholder="Select a collection" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {collections.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.displayName}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <SearchBox value={s.q} onChange={s.setSearch} />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <HugeiconsIcon icon={FilterIcon} strokeWidth={2} />
            Filters
            {activeFilters > 0 && <Badge variant="secondary">{activeFilters}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <RecordFilters fields={fields} />
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex items-center gap-2">
        {isAdmin && selectedIds.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => s.requestDelete(selectedIds)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Delete ({selectedIds.length})
          </Button>
        )}
        {isAdmin && (
          <Button size="sm" onClick={s.openCreate} disabled={!s.collection}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            New record
          </Button>
        )}
      </div>
    </div>
  )
}

/** Local draft + debounce so keystrokes don't refetch on every character. */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => setDraft(value), [value])
  React.useEffect(() => {
    const id = setTimeout(() => {
      if (draft !== value) onChange(draft)
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  return (
    <div className="relative">
      <HugeiconsIcon
        icon={SearchIcon}
        strokeWidth={2}
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        className="h-8 w-56 pl-8"
        placeholder="Search…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    </div>
  )
}
```

- [ ] **Step 3: Write the failing test**

```tsx
// frontend/components/data-management/__tests__/record-toolbar.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/lib/hooks/use-permission', () => ({ useIsAdmin: () => true }))
vi.mock('@/lib/hooks/use-collections', () => ({
  useCollections: () => ({ collections: [{ name: 'products', displayName: 'Products', fields: [] }], isLoading: false }),
}))

import { RecordToolbar } from '@/components/data-management/record-toolbar'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

const fields: FieldSpec[] = [{ name: 'status', type: 'string', enum: ['active'], filterable: true }]

beforeEach(() => {
  useDataManagementStore.setState({ collection: 'products', q: '', page: 1, limit: 20, filters: {}, sort: [], selection: {}, panel: 'closed' })
})

describe('RecordToolbar', () => {
  it('admin sees the New record button and opens the create panel', () => {
    render(<RecordToolbar fields={fields} />)
    fireEvent.click(screen.getByRole('button', { name: /new record/i }))
    expect(useDataManagementStore.getState().panel).toBe('create')
  })

  it('shows a bulk-delete button when rows are selected', () => {
    useDataManagementStore.setState({ selection: { r1: true, r2: true } })
    render(<RecordToolbar fields={fields} />)
    expect(screen.getByRole('button', { name: /delete \(2\)/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/data-management/__tests__/record-toolbar.test.tsx`
Expected: PASS (2 tests). (If an icon name is unresolved, substitute an existing one per the Task 11 note.)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/data-management/record-filters.tsx frontend/components/data-management/record-toolbar.tsx frontend/components/data-management/__tests__/record-toolbar.test.tsx
git commit -m "feat(data-mgmt): toolbar (collection switch, search, filters, actions)"
```

---

## Task 13: Record form + attachments field

**Files:**
- Create: `frontend/components/data-management/attachments-field.tsx`
- Create: `frontend/components/data-management/record-form.tsx`
- Test: `frontend/components/data-management/__tests__/record-form.test.tsx`

**Interfaces:**
- Consumes: `buildRecordSchema` (Task 5), `RecordFieldInput` (Task 7), `useRecordMutations` (Task 10), `useFileUpload` (Task 10), `fileService` (Task 3), `ApiError` (`@/lib/http/api-client`); shadcn `Button`, `Field*`, `Badge`, `Spinner`.
- Produces:
  - `AttachmentsField({ control, name, collection, externalId })` — Controller-bound to a `string[]` document field of file IDs; drop/select files → upload → append IDs; lists existing IDs with a download link + remove.
  - `RecordForm({ fields, collection, mode, record, onDone }: { fields: FieldSpec[]; collection: string; mode: 'create' | 'edit'; record?: RecordHit; onDone: () => void })`.

Behavior: `RecordForm` builds a zod resolver from `fields`; a stable `recordExternalId` (`record.externalId` in edit, else a once-generated `crypto.randomUUID()`); renders `RecordFieldInput` per field except an `attachments` (`string[]`) field, which renders `AttachmentsField`. Submit → `create({ externalId: recordExternalId, document })`; `ApiError.fieldErrors` map onto fields via `setError`; then `onDone()`.

- [ ] **Step 1: Create the attachments field**

```tsx
// frontend/components/data-management/attachments-field.tsx
'use client'

import * as React from 'react'
import { Controller, type Control } from 'react-hook-form'
import { HugeiconsIcon } from '@hugeicons/react'
import { CloudUploadIcon, File01Icon, Cancel01Icon, Download01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { useFileUpload } from '@/lib/hooks/use-file-upload'
import { fileService } from '@/lib/services/file.service'

export function AttachmentsField({
  control,
  name,
  collection,
  externalId,
}: {
  control: Control<Record<string, unknown>>
  name: string
  collection: string
  externalId: string
}) {
  const { items, uploadAll } = useFileUpload()

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: f }) => {
        const ids: string[] = Array.isArray(f.value) ? (f.value as string[]) : []

        const onFiles = async (files: FileList | null) => {
          if (!files || files.length === 0) return
          const newIds = await uploadAll(Array.from(files), { collection, externalId })
          f.onChange([...ids, ...newIds])
        }

        return (
          <Field>
            <FieldLabel htmlFor={`att-${name}`}>{name}</FieldLabel>
            <label
              htmlFor={`att-${name}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground hover:bg-muted/40"
            >
              <HugeiconsIcon icon={CloudUploadIcon} strokeWidth={2} className="size-6" />
              Drop files here or click to upload
              <input
                id={`att-${name}`}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
              />
            </label>

            {items.some((it) => it.status === 'uploading') && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Uploading…
              </div>
            )}

            {ids.length > 0 && (
              <ul className="flex flex-col gap-1">
                {ids.map((id) => (
                  <AttachmentRow
                    key={id}
                    id={id}
                    onRemove={() => f.onChange(ids.filter((x) => x !== id))}
                  />
                ))}
              </ul>
            )}
          </Field>
        )
      }}
    />
  )
}

function AttachmentRow({ id, onRemove }: { id: string; onRemove: () => void }) {
  const [filename, setFilename] = React.useState<string>(id)
  React.useEffect(() => {
    let alive = true
    fileService.get(id).then((m) => { if (alive) setFilename(m.filename) }).catch(() => {})
    return () => { alive = false }
  }, [id])

  const download = async () => {
    const url = await fileService.downloadUrl(id)
    window.open(url, '_blank', 'noopener')
  }

  return (
    <li className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
      <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-4 text-muted-foreground" />
      <span className="flex-1 truncate">{filename}</span>
      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={download}>
        <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-4" />
        <span className="sr-only">Download</span>
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onRemove}>
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        <span className="sr-only">Remove</span>
      </Button>
    </li>
  )
}
```

- [ ] **Step 2: Create the record form**

```tsx
// frontend/components/data-management/record-form.tsx
'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { RecordFieldInput } from '@/components/data-management/field-to-input'
import { AttachmentsField } from '@/components/data-management/attachments-field'
import { buildRecordSchema } from '@/lib/schema/field-to-zod'
import { useRecordMutations } from '@/lib/hooks/use-record-mutations'
import { ApiError } from '@/lib/http/api-client'
import type { FieldSpec, RecordDocument, RecordHit } from '@/lib/interfaces/search.interface'

const SYSTEM_KEYS = new Set(['id', 'externalId', 'createdAt', 'updatedAt'])
const ATTACHMENTS_FIELD = 'attachments'

function documentOf(record?: RecordHit): RecordDocument {
  if (!record) return {}
  const out: RecordDocument = {}
  for (const [k, v] of Object.entries(record)) if (!SYSTEM_KEYS.has(k)) out[k] = v
  return out
}

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `rec_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

export function RecordForm({
  fields,
  collection,
  mode,
  record,
  onDone,
}: {
  fields: FieldSpec[]
  collection: string
  mode: 'create' | 'edit'
  record?: RecordHit
  onDone: () => void
}) {
  const { create } = useRecordMutations()
  const [externalId] = React.useState<string>(() => record?.externalId ?? genId())
  const schema = React.useMemo(() => buildRecordSchema(fields), [fields])

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: documentOf(record),
  })

  const attachmentsField = fields.find((f) => f.name === ATTACHMENTS_FIELD && f.type === 'string[]')

  const onSubmit = async (values: Record<string, unknown>) => {
    try {
      await create({ externalId, document: values })
      onDone()
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors = err.fieldErrors
        let mapped = false
        for (const [path, message] of Object.entries(fieldErrors)) {
          if (path !== '_root') { form.setError(path, { message }); mapped = true }
        }
        if (!mapped) toast.error(err.message)
      } else {
        toast.error('Failed to save record')
      }
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <FieldGroup>
        {fields.map((field) =>
          field === attachmentsField ? (
            <AttachmentsField
              key={field.name}
              control={form.control}
              name={field.name}
              collection={collection}
              externalId={externalId}
            />
          ) : (
            <RecordFieldInput key={field.name} field={field} control={form.control} />
          ),
        )}
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Saving…' : mode === 'create' ? 'Create record' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Write the failing test**

```tsx
// frontend/components/data-management/__tests__/record-form.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const create = vi.fn()
vi.mock('@/lib/hooks/use-record-mutations', () => ({ useRecordMutations: () => ({ create, update: create, remove: vi.fn(), reindex: vi.fn() }) }))

import { RecordForm } from '@/components/data-management/record-form'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

const fields: FieldSpec[] = [{ name: 'title', type: 'string', required: true }]

beforeEach(() => vi.clearAllMocks())

describe('RecordForm', () => {
  it('blocks submit and shows a validation error when required is empty', async () => {
    render(<RecordForm fields={fields} collection="products" mode="create" onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /create record/i }))
    await waitFor(() => expect(screen.getByText(/title is required/i)).toBeInTheDocument())
    expect(create).not.toHaveBeenCalled()
  })

  it('persists a valid record with a generated externalId', async () => {
    create.mockResolvedValue({ id: 'x', externalId: 'e', indexState: 'PENDING' })
    const onDone = vi.fn()
    render(<RecordForm fields={fields} collection="products" mode="create" onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: /create record/i }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    const arg = create.mock.calls[0][0]
    expect(arg.document).toEqual({ title: 'Laptop' })
    expect(typeof arg.externalId).toBe('string')
    expect(arg.externalId.length).toBeGreaterThan(0)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/data-management/__tests__/record-form.test.tsx`
Expected: PASS (2 tests). (If `Spinner` import path differs, confirm with `grep -n "export" frontend/components/ui/spinner.tsx`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/data-management/attachments-field.tsx frontend/components/data-management/record-form.tsx frontend/components/data-management/__tests__/record-form.test.tsx
git commit -m "feat(data-mgmt): schema-driven record form + attachments"
```

---

## Task 14: Panels (create sheet, detail drawer, delete dialog)

**Files:**
- Create: `frontend/components/data-management/record-input-panel.tsx`
- Create: `frontend/components/data-management/record-detail-drawer.tsx`
- Create: `frontend/components/data-management/record-delete-dialog.tsx`
- Test: `frontend/components/data-management/__tests__/record-delete-dialog.test.tsx`

**Interfaces:**
- Consumes: store (`panel`/`detailId`/`deleteTarget` + actions), `RecordForm` (Task 13), `FieldCell` (Task 6), `useRecordMutations` (Task 10), `useIsAdmin`; shadcn `Sheet*`, `Drawer*`, `AlertDialog*`.
- Produces: `RecordInputPanel({ fields, collection })`; `RecordDetailDrawer({ fields, collection, results }: { …; results?: SearchResults })`; `RecordDeleteDialog()`.

- [ ] **Step 1: Create the input panel**

```tsx
// frontend/components/data-management/record-input-panel.tsx
'use client'

import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { RecordForm } from '@/components/data-management/record-form'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

export function RecordInputPanel({ fields, collection }: { fields: FieldSpec[]; collection: string }) {
  const open = useDataManagementStore((s) => s.panel === 'create')
  const closeCreate = useDataManagementStore((s) => s.closeCreate)

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) closeCreate() }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New record</SheetTitle>
          <SheetDescription>Add a record to “{collection}”.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {open && (
            <RecordForm fields={fields} collection={collection} mode="create" onDone={closeCreate} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Create the detail drawer**

```tsx
// frontend/components/data-management/record-detail-drawer.tsx
'use client'

import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer'
import { RecordForm } from '@/components/data-management/record-form'
import { FieldCell } from '@/components/data-management/field-cell'
import { useIsAdmin } from '@/lib/hooks/use-permission'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec, RecordHit, SearchResults } from '@/lib/interfaces/search.interface'

export function RecordDetailDrawer({
  fields,
  collection,
  results,
}: {
  fields: FieldSpec[]
  collection: string
  results?: SearchResults
}) {
  const isAdmin = useIsAdmin()
  const detailId = useDataManagementStore((s) => s.detailId)
  const closeDetail = useDataManagementStore((s) => s.closeDetail)

  const record: RecordHit | undefined = results?.hits.find((h) => h.id === detailId)
  const editable = isAdmin && !!record?.externalId

  return (
    <Drawer open={detailId !== null} onOpenChange={(o) => { if (!o) closeDetail() }} direction="right">
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{editable ? 'Edit record' : 'Record details'}</DrawerTitle>
          <DrawerDescription>
            {record?.externalId ? `External ID: ${record.externalId}` : 'This record has no external ID and is read-only.'}
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-6">
          {record && editable ? (
            <RecordForm fields={fields} collection={collection} mode="edit" record={record} onDone={closeDetail} />
          ) : record ? (
            <dl className="flex flex-col gap-3">
              {fields.map((f) => (
                <div key={f.name} className="flex flex-col gap-1">
                  <dt className="text-sm font-medium text-muted-foreground">{f.name}</dt>
                  <dd><FieldCell field={f} value={record[f.name]} /></dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
```

- [ ] **Step 3: Create the delete dialog**

```tsx
// frontend/components/data-management/record-delete-dialog.tsx
'use client'

import * as React from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import { useRecordMutations } from '@/lib/hooks/use-record-mutations'

export function RecordDeleteDialog() {
  const deleteTarget = useDataManagementStore((s) => s.deleteTarget)
  const cancelDelete = useDataManagementStore((s) => s.cancelDelete)
  const clearSelection = useDataManagementStore((s) => s.clearSelection)
  const { remove } = useRecordMutations()
  const [busy, setBusy] = React.useState(false)

  const count = deleteTarget?.length ?? 0

  const confirm = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await remove(deleteTarget)
      clearSelection()
      cancelDelete()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) cancelDelete() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {count} record(s)?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the selected record(s). This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => { e.preventDefault(); void confirm() }}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [ ] **Step 4: Write the failing test**

```tsx
// frontend/components/data-management/__tests__/record-delete-dialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const remove = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/hooks/use-record-mutations', () => ({ useRecordMutations: () => ({ remove, create: vi.fn(), update: vi.fn(), reindex: vi.fn() }) }))

import { RecordDeleteDialog } from '@/components/data-management/record-delete-dialog'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'

beforeEach(() => {
  vi.clearAllMocks()
  useDataManagementStore.setState({ deleteTarget: ['r1', 'r2'], selection: { r1: true, r2: true } })
})

describe('RecordDeleteDialog', () => {
  it('confirms deletion of the targeted ids and clears state', async () => {
    render(<RecordDeleteDialog />)
    expect(screen.getByText(/delete 2 record/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(['r1', 'r2']))
    await waitFor(() => expect(useDataManagementStore.getState().deleteTarget).toBeNull())
    expect(useDataManagementStore.getState().selection).toEqual({})
  })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/data-management/__tests__/record-delete-dialog.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/data-management/record-input-panel.tsx frontend/components/data-management/record-detail-drawer.tsx frontend/components/data-management/record-delete-dialog.tsx frontend/components/data-management/__tests__/record-delete-dialog.test.tsx
git commit -m "feat(data-mgmt): create/detail/delete panels"
```

---

## Task 15: Orchestrator, page, and nav wiring

**Files:**
- Create: `frontend/components/data-management/data-management-view.tsx`
- Create: `frontend/app/dashboard/data-management/page.tsx`
- Modify: `frontend/components/app-sidebar.tsx` (add a nav item)
- Test: `frontend/components/data-management/__tests__/data-management-view.test.tsx`

**Interfaces:**
- Consumes: `useCollections`, `useCollectionDefinition`, `useRecords`, store, and all Task 11–14 components.
- Produces: `DataManagementView()`; the route `page.tsx`; a sidebar link to `/dashboard/data-management`.

- [ ] **Step 1: Create the orchestrator**

```tsx
// frontend/components/data-management/data-management-view.tsx
'use client'

import * as React from 'react'
import { RecordToolbar } from '@/components/data-management/record-toolbar'
import { RecordDataTable } from '@/components/data-management/record-data-table'
import { RecordInputPanel } from '@/components/data-management/record-input-panel'
import { RecordDetailDrawer } from '@/components/data-management/record-detail-drawer'
import { RecordDeleteDialog } from '@/components/data-management/record-delete-dialog'
import { useCollections } from '@/lib/hooks/use-collections'
import { useCollectionDefinition } from '@/lib/hooks/use-collection-definition'
import { useRecords } from '@/lib/hooks/use-records'
import { useCollection, useSetCollection } from '@/lib/state-management/data-management.store'

export function DataManagementView() {
  const { collections } = useCollections()
  const collection = useCollection()
  const setCollection = useSetCollection()
  const { fields, isLoading: defLoading } = useCollectionDefinition(collection)
  const { results, isLoading, error, mutate } = useRecords()

  // Default to the first collection once the list resolves.
  React.useEffect(() => {
    if (!collection && collections.length > 0) setCollection(collections[0].name)
  }, [collection, collections, setCollection])

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Data Management</h1>
        <p className="text-sm text-muted-foreground">
          Create, search, and manage records across your collections.
        </p>
      </div>

      <RecordToolbar fields={fields} />

      <RecordDataTable
        fields={fields}
        results={results}
        isLoading={isLoading || defLoading}
        error={error}
        onRetry={() => void mutate()}
      />

      {collection && (
        <>
          <RecordInputPanel fields={fields} collection={collection} />
          <RecordDetailDrawer fields={fields} collection={collection} results={results} />
          <RecordDeleteDialog />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the page shell**

```tsx
// frontend/app/dashboard/data-management/page.tsx
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { DataManagementView } from '@/components/data-management/data-management-view'

export default function Page() {
  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <DataManagementView />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

- [ ] **Step 3: Add the sidebar nav item**

In `frontend/components/app-sidebar.tsx`, add an entry to the `navMain` array (after the `Dashboard` item). Reuse the already-imported `Database01Icon`:

```tsx
    {
      title: "Data Management",
      url: "/dashboard/data-management",
      icon: (
        <HugeiconsIcon icon={Database01Icon} strokeWidth={2} />
      ),
    },
```

- [ ] **Step 4: Write the failing test**

```tsx
// frontend/components/data-management/__tests__/data-management-view.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const setCollection = vi.fn()
vi.mock('@/lib/hooks/use-permission', () => ({ useIsAdmin: () => true }))
vi.mock('@/lib/hooks/use-collections', () => ({
  useCollections: () => ({ collections: [{ name: 'products', displayName: 'Products', fields: [] }], isLoading: false }),
}))
vi.mock('@/lib/hooks/use-collection-definition', () => ({
  useCollectionDefinition: () => ({ definition: null, fields: [{ name: 'title', type: 'string' }], isLoading: false }),
}))
vi.mock('@/lib/hooks/use-records', () => ({
  useRecords: () => ({ results: { hits: [], page: 1, limit: 20, totalHits: 0, totalPages: 0, processingTimeMs: 1 }, isLoading: false, error: undefined, mutate: vi.fn() }),
}))
vi.mock('@/lib/state-management/data-management.store', async (orig) => {
  const actual = await orig<typeof import('@/lib/state-management/data-management.store')>()
  return { ...actual, useCollection: () => null, useSetCollection: () => setCollection }
})

import { DataManagementView } from '@/components/data-management/data-management-view'

beforeEach(() => vi.clearAllMocks())

describe('DataManagementView', () => {
  it('renders the heading and defaults to the first collection', async () => {
    render(<DataManagementView />)
    expect(screen.getByRole('heading', { name: /data management/i })).toBeInTheDocument()
    await waitFor(() => expect(setCollection).toHaveBeenCalledWith('products'))
  })
})
```

- [ ] **Step 5: Run the full test suite + typecheck + build**

Run: `cd frontend && npx vitest run && npm run typecheck && npm run build`
Expected: all Vitest suites PASS, `tsc --noEmit` clean, `next build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/data-management/data-management-view.tsx frontend/app/dashboard/data-management/page.tsx frontend/components/app-sidebar.tsx frontend/components/data-management/__tests__/data-management-view.test.tsx
git commit -m "feat(data-mgmt): data management page + orchestrator + nav"
```

---

## Task 16: End-to-end verification against the live backend

**Files:** none (manual verification). Prereq: backend running, at least one collection exists (create one via `POST /search/collections` if needed — see `development/current_session/current_design.md` §1), and you are logged in as an admin.

- [ ] **Step 1: Start the frontend**

Run: `cd frontend && npm run dev` and open `http://localhost:3000/dashboard/data-management`.

- [ ] **Step 2: Verify read path** — the collection switcher lists collections; selecting one loads columns derived from its fields; search, a filter, a sortable header, rows-per-page, and pagination each trigger a fresh `POST …/query` (confirm in the Network tab) and update the table.

- [ ] **Step 3: Verify write path (admin)** — "New record" opens the sheet; submit a valid record → toast "queued for indexing" → the record appears after the short revalidate. Attach a file if the collection declares an `attachments` (`string[]`) field and confirm the presigned POST to storage succeeds (this requires bucket CORS for the browser origin — see design §8/decision 7).

- [ ] **Step 4: Verify edit + delete** — open a record with an `externalId` → edit a field → save → change reflects after revalidate. Select rows → bulk delete → confirm dialog → rows disappear.

- [ ] **Step 5: Verify RBAC** — with a non-admin session, the New/Edit/Delete controls are absent and the read path still works.

- [ ] **Step 6: Note any gaps** — record follow-ups (e.g. bucket CORS, missing `attachments` field on a collection) in `development/current_session/` rather than forcing them into this plan.

---

## Self-Review

**Spec coverage:** every design section maps to a task — types/§1→T1; services/§1→T2,T3; store/§3→T4; schema-driven mappers/§4→T5–T8; SWR hooks/§2,§5→T9,T10; controlled table + reference styling/§4→T11; toolbar/filters/§4→T12; form + attachments/§5→T13; panels + eventual-consistency + RBAC/§5,§6→T13,T14; orchestrator + page + nav/§4→T15; verification/§7→T16.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every test step shows real assertions and a run command with expected output.

**Type consistency:** `RecordHit.id` (string) is used for `getRowId`/delete throughout; `useRecordMutations` exposes `create/update/remove/reindex` consistently; `FieldSpec`/`SearchQuery`/`SearchResults`/`FilterValue` are defined once in Task 1 and imported everywhere; store action names match between the store (T4) and its consumers (T11–T15).

**Known deviations from the design (intentional, minor):** the column-visibility toggle lives in the table component (Task 11) rather than the toolbar, because it needs the TanStack table instance; `date` inputs use a native `<input type="date">` (an accessible date picker) which can later be swapped for the `Calendar` component. Both are noted here so a reviewer isn't surprised.
