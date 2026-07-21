# Data Control Panel v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped data control panel with a Postgres-backed single-record read (enabling detail/edit/deep-link for any record and honest async-index status), collection/schema management, and query enrichment (facets, highlight, multi-sort, URL-sync).

**Architecture:** One small backend endpoint (`GET /search/collections/:name/records/:id`, served from Postgres) becomes the correctness backbone: the detail drawer fetches by id (works off-page, always fresh, live `indexState`), and creation opens that PG-backed view instead of guessing with a fixed delay. Everything else is frontend, preserving v1's three-layer state boundary (Zustand / react-hook-form+zod / SWR). Schema management calls collection CRUD endpoints that already exist.

**Tech Stack:** Backend — NestJS, Drizzle, BullMQ, Jest. Frontend — Next.js 16 (App Router), React, TypeScript, Zustand v5 (+devtools), SWR v2, react-hook-form v7 + `@hookform/resolvers/zod` + Zod v4, `@tanstack/react-table` v8, axios (shared `apiClient`), sonner, shadcn/ui (`components/ui/*`), Hugeicons, Vitest + Testing Library.

## Global Constraints

- **Design source of truth:** `development/current_session/current_design.md`. Do not diverge from its resolved decisions.
- **No new npm dependencies** on either side. Everything needed is installed.
- **Backend rules (`api/CLAUDE.md`):** read a file before editing; keep files under 500 lines; validate input at boundaries; NO `Co-Authored-By` trailer on commits. Run `npm run build && npm test` in `api/` before considering a backend task done.
- **Backend read auth:** reads are global — the new single-record GET is open to any authenticated principal (like `POST query`). Writes stay admin-only.
- **PG read shape:** the single-record read returns `document` as a **nested object** with system fields as siblings: `{ id, externalId, document, indexState, indexError, createdAt, updatedAt }`. This differs from search hits, which **flatten** document fields to the top level. Never conflate `RecordDetail` (nested) with `RecordHit` (flat).
- **Frontend path alias:** `@/` → `frontend/` root. All imports use it.
- **Zustand pattern:** mirror the existing `data-management.store.ts` — `create()(devtools(creator, { name, enabled: process.env.NODE_ENV === 'development' }))`, named action strings as the 3rd arg to `set`, exported selector hooks.
- **Forms:** react-hook-form + `zodResolver`, shadcn `Field/FieldLabel/FieldError` (mirror `record-form.tsx`). Zod uses positional message strings.
- **RBAC:** writes (record create/edit/delete/reindex, ALL collection management) are admin-only via `useIsAdmin()` from `lib/hooks/use-permission.ts`. The single-record read is open.
- **Record identity:** `persist` upserts on `externalId`; create auto-assigns an `externalId` (`crypto.randomUUID()` unless supplied); edit requires an `externalId`; `id` (PG uuid) is used for `getRowId`, delete, and the single-record read (which also accepts an `externalId` as the key).
- **Frontend tests:** `cd frontend && npx vitest run <path>`; colocated `__tests__/`; jsdom + Testing Library pre-configured.
- **Backend tests:** `cd api && npx jest <path>`; specs colocate as `*.spec.ts`.
- **Commit** after each task. Frontend: `feat(data-mgmt): …`. Backend: `feat(search): …`. Conventional messages, no attribution trailer.

---

## Phases

- **Phase 1 — Single-record read + detail/creation redesign** (Tasks 1–4). Ships working detail/edit for any record and honest create status. Independently valuable.
- **Phase 2 — Schema/collection management** (Tasks 5–9). Admin create/edit/delete collections.
- **Phase 3 — Query enrichment** (Tasks 10–14). Facets, highlight, multi-sort, URL-sync + deep-link.
- **Phase 4 — Optional: date-range filter** (Task 15). Only if the filter-builder extension is wanted.

## File Structure

```
api/src/features/search-service/
  search-record.service.ts        (Task 1: +RecordView, +toRecordView, +get())
  search.controller.ts            (Task 1: +GET records/:id)
  search-record.service.spec.ts   (Task 1: +get() tests)

frontend/
  lib/interfaces/search.interface.ts    (Task 2: +RecordDetail; Task 5: +Create/UpdateCollectionInput)
  lib/services/record.service.ts        (Task 2: +get)   (Task 10: query facets/highlight)
  lib/services/collection.service.ts    (Task 5: +create/update/remove)
  lib/schema/serialize-query.ts         (Task 10: facets/highlight)
  lib/schema/validate-field-spec.ts     (Task 6, new)
  lib/schema/field-spec-to-zod.ts       (Task 6, new)
  lib/hooks/use-record.ts               (Task 2, new)
  lib/hooks/use-records.ts              (Task 10: pass fields → facets/highlight)
  lib/hooks/use-record-mutations.ts     (Task 4: create→PG detail + bounded revalidate)
  lib/hooks/use-collection-mutations.ts (Task 5, new)
  lib/hooks/use-query-url-sync.ts       (Task 14, new)
  lib/state-management/data-management.store.ts  (Task 9: collectionPanel) (Task 13: additive sort)
  components/data-management/
    record-status-badge.tsx       (Task 3, new)
    record-form.tsx               (Task 3: initialDocument/externalId props)
    record-detail-drawer.tsx      (Task 3: PG-backed via useRecord)
    data-management-view.tsx      (Task 3: drop results prop; Task 9: manager; Task 11: facets; Task 14: url-sync)
    field-spec-editor.tsx         (Task 7, new)
    collection-editor-sheet.tsx   (Task 8, new)
    collection-manager-dialog.tsx (Task 9, new)
    record-toolbar.tsx            (Task 9: Manage… + Reindex; Task 11: facetDistribution prop)
    record-filters.tsx            (Task 11: facet counts)
    field-to-filter.tsx           (Task 11: counts; Task 15: range)
    field-cell.tsx                (Task 12: highlight)
    field-to-column.tsx           (Task 12: pass _formatted)  [in lib/schema/]
    record-data-table.tsx         (Task 13: multi-sort headers)
```

---

# Phase 1 — Single-record read + detail/creation redesign

## Task 1: Backend — single-record read endpoint

**Files:**
- Modify: `api/src/features/search-service/search-record.service.ts`
- Modify: `api/src/features/search-service/search.controller.ts`
- Test: `api/src/features/search-service/search-record.service.spec.ts`

**Interfaces:**
- Produces (REST): `GET /search/collections/:name/records/:id` → `200 { id, externalId, document, indexState, indexError, createdAt, updatedAt }`, `404 SEARCH_RECORD_NOT_FOUND`.
- Produces (service): `SearchRecordService.get(collection: string, key: string): Promise<RecordView>` and exported `interface RecordView`.

- [ ] **Step 1: Write the failing tests** — append to `search-record.service.spec.ts`:

```ts
describe('SearchRecordService.get', () => {
  it('404s on an unknown collection', async () => {
    const { service } = make();
    await expect(service.get('nope', 'rec-1')).rejects.toMatchObject({
      code: ErrorCode.SEARCH_COLLECTION_NOT_FOUND,
    });
  });

  it('resolves a UUID key via findLiveById', async () => {
    const uuid = '11111111-1111-1111-1111-111111111111';
    const { service, records } = make({
      findLiveById: jest.fn(async () => ({
        id: uuid, collection: 'articles', externalId: 'ext-1',
        document: { title: 'Hi' }, indexState: 'INDEXED', indexError: null,
        createdAt: new Date('2020-01-01'), updatedAt: new Date('2020-01-02'),
      })),
    });
    const view = await service.get('articles', uuid);
    expect(records.findLiveById).toHaveBeenCalledWith(uuid);
    expect(view).toMatchObject({ id: uuid, externalId: 'ext-1', document: { title: 'Hi' }, indexState: 'INDEXED' });
  });

  it('resolves a non-UUID key via findLiveByExternalId', async () => {
    const { service, records } = make({
      findLiveByExternalId: jest.fn(async () => ({
        id: 'rec-9', collection: 'articles', externalId: 'ext-9',
        document: {}, indexState: 'PENDING', indexError: null,
        createdAt: new Date(), updatedAt: new Date(),
      })),
    });
    const view = await service.get('articles', 'ext-9');
    expect(records.findLiveByExternalId).toHaveBeenCalledWith('articles', 'ext-9');
    expect(view.indexState).toBe('PENDING');
  });

  it('404s when the row belongs to another collection', async () => {
    const { service } = make({
      findLiveByExternalId: jest.fn(async () => ({ id: 'r', collection: 'other', externalId: 'e', document: {} })),
    });
    await expect(service.get('articles', 'e')).rejects.toMatchObject({
      code: ErrorCode.SEARCH_RECORD_NOT_FOUND,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/features/search-service/search-record.service.spec.ts -t "SearchRecordService.get"`
Expected: FAIL — `service.get is not a function`.

- [ ] **Step 3: Add `RecordView`, `toRecordView`, and `get()` to `search-record.service.ts`**

Add the interface near `PersistResult`:

```ts
export interface RecordView {
  id: string;
  externalId: string | null;
  document: Record<string, unknown>;
  indexState: IndexState;
  indexError: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Add the method inside the class (e.g. after `remove`):

```ts
  /** Read one record from Postgres (source of truth). Resolves by id or externalId. */
  async get(collection: string, key: string): Promise<RecordView> {
    await this.requireCollection(collection);
    let row = UUID_RE.test(key) ? await this.records.findLiveById(key) : null;
    if (!row) row = await this.records.findLiveByExternalId(collection, key);
    if (!row || row.collection !== collection) {
      throw this.errors.create(ErrorCode.SEARCH_RECORD_NOT_FOUND);
    }
    return toRecordView(row);
  }
```

Add the mapper at the bottom of the file (next to `toFilterClause`):

```ts
/** Map a DB row to the API record view. */
function toRecordView(row: {
  id: string;
  externalId: string | null;
  document: Record<string, unknown>;
  indexState: IndexState;
  indexError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RecordView {
  return {
    id: row.id,
    externalId: row.externalId,
    document: row.document,
    indexState: row.indexState,
    indexError: row.indexError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

- [ ] **Step 4: Add the route to `search.controller.ts`**

Add `Get` to the `@nestjs/common` import, then add the method to `SearchQueryController` (open — no `@Roles`):

```ts
  @Get('records/:id')
  getRecord(@Param('name') name: string, @Param('id') id: string) {
    return this.records.get(name, id);
  }
```

- [ ] **Step 5: Run tests + build to verify pass**

Run: `cd api && npx jest src/features/search-service/search-record.service.spec.ts && npm run build`
Expected: PASS (all get() tests) and a clean build.

- [ ] **Step 6: Commit**

```bash
git add api/src/features/search-service/search-record.service.ts api/src/features/search-service/search.controller.ts api/src/features/search-service/search-record.service.spec.ts
git commit -m "feat(search): single-record read from Postgres (GET records/:id)"
```

---

## Task 2: Frontend — RecordDetail type, service.get, useRecord hook

**Files:**
- Modify: `frontend/lib/interfaces/search.interface.ts`
- Modify: `frontend/lib/services/record.service.ts`
- Create: `frontend/lib/hooks/use-record.ts`
- Test: `frontend/lib/services/__tests__/record.service.test.ts` (extend)
- Test: `frontend/lib/hooks/__tests__/use-record.test.tsx`

**Interfaces:**
- Consumes: `apiClient`, `IndexState`, `RecordDocument`.
- Produces: `RecordDetail`; `recordService.get(collection, id): Promise<RecordDetail>`; `useRecord(collection, id): { record?, isLoading, error, mutate }` (polls while `indexState==='PENDING'`).

- [ ] **Step 1: Add `RecordDetail` to `search.interface.ts`** (after `PersistResult`):

```ts
/** GET /search/collections/:name/records/:id — Postgres read (document nested). */
export interface RecordDetail {
  id: string
  externalId: string | null
  document: RecordDocument
  indexState: IndexState
  indexError?: string | null
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Add `get` to `record.service.ts`** (inside `recordService`); add `RecordDetail` to the type import at the top:

```ts
  get(collection: string, id: string): Promise<RecordDetail> {
    return apiClient
      .get<RecordDetail>(`${base(collection)}/records/${encodeURIComponent(id)}`)
      .then((r) => r.data)
  },
```

- [ ] **Step 3: Extend the service test** — append to `record.service.test.ts`:

```ts
it('get fetches a single record by id', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { id: 'abc', document: {} } })
  await recordService.get('products', 'abc')
  expect(apiClient.get).toHaveBeenCalledWith('/search/collections/products/records/abc')
})
```

- [ ] **Step 4: Write the failing hook test** — `frontend/lib/hooks/__tests__/use-record.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import React from 'react'
import { useRecord } from '@/lib/hooks/use-record'

vi.mock('@/lib/services/record.service', () => ({ recordService: { get: vi.fn() } }))
import { recordService } from '@/lib/services/record.service'

function Probe({ id }: { id: string | null }) {
  const { record, isLoading } = useRecord('products', id)
  if (isLoading) return <span>loading</span>
  return <span>{record ? record.indexState : 'none'}</span>
}
const wrap = (ui: React.ReactNode) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
)

beforeEach(() => vi.clearAllMocks())

describe('useRecord', () => {
  it('does not fetch when id is null', () => {
    render(wrap(<Probe id={null} />))
    expect(recordService.get).not.toHaveBeenCalled()
    expect(screen.getByText('none')).toBeInTheDocument()
  })
  it('fetches and returns the record', async () => {
    vi.mocked(recordService.get).mockResolvedValue({ id: 'abc', externalId: null, document: {}, indexState: 'INDEXED', createdAt: '', updatedAt: '' })
    render(wrap(<Probe id="abc" />))
    await waitFor(() => expect(screen.getByText('INDEXED')).toBeInTheDocument())
    expect(recordService.get).toHaveBeenCalledWith('products', 'abc')
  })
})
```

- [ ] **Step 5: Run to verify it fails**

Run: `cd frontend && npx vitest run lib/hooks/__tests__/use-record.test.tsx`
Expected: FAIL — cannot resolve `@/lib/hooks/use-record`.

- [ ] **Step 6: Implement `use-record.ts`**

```ts
import useSWR from 'swr'
import { recordService } from '@/lib/services/record.service'
import type { RecordDetail } from '@/lib/interfaces/search.interface'

/**
 * One record read from Postgres (source of truth). POST-independent, so it uses
 * an explicit fetcher. Polls only while the record is still indexing, then stops.
 */
export function useRecord(collection: string | null, id: string | null) {
  const key = collection && id ? (['record', collection, id] as const) : null
  const { data, isLoading, error, mutate } = useSWR<RecordDetail>(
    key,
    () => recordService.get(collection as string, id as string),
    { refreshInterval: (d?: RecordDetail) => (d?.indexState === 'PENDING' ? 1500 : 0) },
  )
  return { record: data, isLoading, error, mutate }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd frontend && npx vitest run lib/hooks/__tests__/use-record.test.tsx lib/services/__tests__/record.service.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/interfaces/search.interface.ts frontend/lib/services/record.service.ts frontend/lib/hooks/use-record.ts frontend/lib/hooks/__tests__/use-record.test.tsx frontend/lib/services/__tests__/record.service.test.ts
git commit -m "feat(data-mgmt): RecordDetail type, record read service + useRecord hook"
```

---

## Task 3: Status badge + PG-backed detail drawer + form refactor

**Files:**
- Create: `frontend/components/data-management/record-status-badge.tsx`
- Modify: `frontend/components/data-management/record-form.tsx`
- Modify: `frontend/components/data-management/record-detail-drawer.tsx`
- Modify: `frontend/components/data-management/data-management-view.tsx`
- Test: `frontend/components/data-management/__tests__/record-status-badge.test.tsx`
- Test: update `frontend/components/data-management/__tests__/record-form.test.tsx`

**Interfaces:**
- Consumes: `useRecord` (Task 2), `RecordDetail`, `useIsAdmin`.
- Produces: `RecordStatusBadge({ state, error? })`; `RecordForm` now takes `initialDocument?: RecordDocument` + `externalId?: string` instead of `record?: RecordHit`.

- [ ] **Step 1: Write the failing badge test** — `record-status-badge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecordStatusBadge } from '@/components/data-management/record-status-badge'

describe('RecordStatusBadge', () => {
  it('shows Indexing for PENDING', () => { render(<RecordStatusBadge state="PENDING" />); expect(screen.getByText('Indexing')).toBeInTheDocument() })
  it('shows Indexed for INDEXED', () => { render(<RecordStatusBadge state="INDEXED" />); expect(screen.getByText('Indexed')).toBeInTheDocument() })
  it('shows Failed for FAILED', () => { render(<RecordStatusBadge state="FAILED" />); expect(screen.getByText('Failed')).toBeInTheDocument() })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run components/data-management/__tests__/record-status-badge.test.tsx`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement `record-status-badge.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import type { IndexState } from '@/lib/interfaces/search.interface'

const MAP: Record<IndexState, { label: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: 'Indexing', variant: 'secondary' },
  INDEXED: { label: 'Indexed', variant: 'outline' },
  FAILED: { label: 'Failed', variant: 'destructive' },
}

export function RecordStatusBadge({ state, error }: { state: IndexState; error?: string | null }) {
  const { label, variant } = MAP[state]
  return <Badge variant={variant} title={error ?? undefined}>{label}</Badge>
}
```

- [ ] **Step 4: Refactor `record-form.tsx` to nested-document props**

Replace the `record?: RecordHit` prop with `initialDocument` + `externalId`. Remove `SYSTEM_KEYS` and `documentOf`; replace `defaultValuesFor` and the signature:

```tsx
function defaultValuesFor(fields: FieldSpec[], doc: RecordDocument = {}): RecordDocument {
  const out: RecordDocument = {}
  for (const f of fields) out[f.name] = f.name in doc ? doc[f.name] : emptyValueFor(f)
  return out
}
```

```tsx
export function RecordForm({
  fields, collection, mode, initialDocument, externalId: externalIdProp, onDone,
}: {
  fields: FieldSpec[]
  collection: string
  mode: 'create' | 'edit'
  initialDocument?: RecordDocument
  externalId?: string
  onDone: () => void
}) {
  const { create } = useRecordMutations()
  const [externalId] = React.useState<string>(() => externalIdProp ?? genId())
  const schema = React.useMemo(
    () => buildRecordSchema(fields) as unknown as ZodType<Record<string, unknown>, Record<string, unknown>>,
    [fields],
  )
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: defaultValuesFor(fields, initialDocument),
  })
  // …attachmentsField, onSubmit, and the returned JSX are unchanged…
}
```

Update the top import to drop `RecordHit` if now unused (keep `RecordDocument`, `FieldSpec`). Keep `emptyValueFor` and `genId` as-is.

- [ ] **Step 5: Rewrite `record-detail-drawer.tsx` to fetch by id**

```tsx
'use client'

import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { RecordForm } from '@/components/data-management/record-form'
import { FieldCell } from '@/components/data-management/field-cell'
import { RecordStatusBadge } from '@/components/data-management/record-status-badge'
import { useIsAdmin } from '@/lib/hooks/use-permission'
import { useRecord } from '@/lib/hooks/use-record'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

export function RecordDetailDrawer({ fields, collection }: { fields: FieldSpec[]; collection: string }) {
  const isAdmin = useIsAdmin()
  const detailId = useDataManagementStore((s) => s.detailId)
  const closeDetail = useDataManagementStore((s) => s.closeDetail)
  const { record, isLoading, error } = useRecord(collection, detailId)
  const editable = isAdmin && !!record?.externalId

  return (
    <Drawer open={detailId !== null} onOpenChange={(o) => { if (!o) closeDetail() }} direction="right">
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            {editable ? 'Edit record' : 'Record details'}
            {record && <RecordStatusBadge state={record.indexState} error={record.indexError} />}
          </DrawerTitle>
          <DrawerDescription>
            {record?.externalId
              ? `External ID: ${record.externalId}`
              : record ? 'This record has no external ID and is read-only.' : ''}
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-6">
          {isLoading ? (
            <div className="flex flex-col gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : error || !record ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Record not found</EmptyTitle>
                <EmptyDescription>It may have been deleted.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : editable ? (
            <RecordForm
              fields={fields}
              collection={collection}
              mode="edit"
              initialDocument={record.document}
              externalId={record.externalId ?? undefined}
              onDone={closeDetail}
            />
          ) : (
            <dl className="flex flex-col gap-3">
              {fields.map((f) => (
                <div key={f.name} className="flex flex-col gap-1">
                  <dt className="text-sm font-medium text-muted-foreground">{f.name}</dt>
                  <dd><FieldCell field={f} value={record.document[f.name]} /></dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
```

- [ ] **Step 6: Update `data-management-view.tsx`** — stop passing `results` to the drawer:

```tsx
<RecordDetailDrawer fields={fields} collection={collection} />
```

- [ ] **Step 7: Update the record-form test** — in `record-form.test.tsx`, replace any `record={…}` usage with `initialDocument`/`externalId`. Add:

```tsx
it('seeds edit values from initialDocument', () => {
  render(
    <RecordForm
      fields={[{ name: 'title', type: 'string', required: true }]}
      collection="c" mode="edit" initialDocument={{ title: 'Seeded' }} externalId="ext-1" onDone={() => {}}
    />,
  )
  expect((screen.getByLabelText(/title/) as HTMLInputElement).value).toBe('Seeded')
})
```

- [ ] **Step 8: Run the affected tests**

Run: `cd frontend && npx vitest run components/data-management/__tests__/record-status-badge.test.tsx components/data-management/__tests__/record-form.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/data-management/record-status-badge.tsx frontend/components/data-management/record-form.tsx frontend/components/data-management/record-detail-drawer.tsx frontend/components/data-management/data-management-view.tsx frontend/components/data-management/__tests__/record-status-badge.test.tsx frontend/components/data-management/__tests__/record-form.test.tsx
git commit -m "feat(data-mgmt): PG-backed detail drawer with live index status"
```

---

## Task 4: Creation flow redesign (View → PG detail + bounded revalidate)

**Files:**
- Modify: `frontend/lib/hooks/use-record-mutations.ts`
- Test: `frontend/lib/hooks/__tests__/use-record-mutations.test.tsx`

**Interfaces:**
- Consumes: `recordService.persist`, `useRecords().mutate`, store `openDetail`.
- Produces: `create` opens the new record's PG detail via a toast **View** action and revalidates the list on a bounded schedule (no fixed-delay-as-correctness). `update`, `remove`, `reindex` unchanged in contract.

- [ ] **Step 1: Rewrite `use-record-mutations.ts`**

```ts
'use client'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { recordService } from '@/lib/services/record.service'
import { useCollection, useDataManagementStore } from '@/lib/state-management/data-management.store'
import { useRecords } from '@/lib/hooks/use-records'
import type { PersistRecordInput, SearchResults } from '@/lib/interfaces/search.interface'

const REVALIDATE_DELAYS_MS = [900, 2500] // bounded catch-up while Meili indexes

export function useRecordMutations() {
  const collection = useCollection()
  const openDetail = useDataManagementStore((s) => s.openDetail)
  const { mutate } = useRecords()

  const revalidateSoon = useCallback(() => {
    for (const d of REVALIDATE_DELAYS_MS) setTimeout(() => void mutate(), d)
  }, [mutate])

  const create = useCallback(
    async (input: PersistRecordInput) => {
      if (!collection) throw new Error('No collection selected')
      const [res] = await recordService.persist(collection, [input])
      if (res) {
        toast.success('Record queued for indexing', {
          description: 'View it now to watch indexing complete.',
          action: { label: 'View', onClick: () => openDetail(res.id) },
        })
      }
      revalidateSoon()
      return res
    },
    [collection, openDetail, revalidateSoon],
  )

  const remove = useCallback(
    async (ids: string[]) => {
      if (!collection) throw new Error('No collection selected')
      await Promise.all(ids.map((id) => recordService.remove(collection, id)))
      toast.success(`${ids.length} record(s) deleted`)
      await mutate(
        (prev?: SearchResults) =>
          prev
            ? { ...prev, hits: prev.hits.filter((h) => !ids.includes(h.id)), totalHits: Math.max(0, prev.totalHits - ids.length) }
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

(`useDataManagementStore` is already exported from the store module alongside `useCollection`.)

- [ ] **Step 2: Write the test** — `use-record-mutations.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/lib/services/record.service', () => ({ recordService: { persist: vi.fn(), remove: vi.fn(), reload: vi.fn() } }))
const mutate = vi.fn()
vi.mock('@/lib/hooks/use-records', () => ({ useRecords: () => ({ mutate }) }))
const openDetail = vi.fn()
vi.mock('@/lib/state-management/data-management.store', () => ({
  useCollection: () => 'products',
  useDataManagementStore: (sel: (s: unknown) => unknown) => sel({ openDetail }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }))

import { recordService } from '@/lib/services/record.service'
import { toast } from 'sonner'
import { useRecordMutations } from '@/lib/hooks/use-record-mutations'

beforeEach(() => vi.clearAllMocks())

describe('useRecordMutations.create', () => {
  it('persists then wires a View action to the new record id', async () => {
    vi.mocked(recordService.persist).mockResolvedValue([{ id: 'new-1', externalId: 'e', indexState: 'PENDING' }])
    const { result } = renderHook(() => useRecordMutations())
    await act(async () => { await result.current.create({ externalId: 'e', document: { a: 1 } }) })
    expect(recordService.persist).toHaveBeenCalledWith('products', [{ externalId: 'e', document: { a: 1 } }])
    const opts = vi.mocked(toast.success).mock.calls[0][1] as { action: { onClick: () => void } }
    opts.action.onClick()
    expect(openDetail).toHaveBeenCalledWith('new-1')
  })
})
```

- [ ] **Step 3: Run to verify it passes**

Run: `cd frontend && npx vitest run lib/hooks/__tests__/use-record-mutations.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/hooks/use-record-mutations.ts frontend/lib/hooks/__tests__/use-record-mutations.test.tsx
git commit -m "feat(data-mgmt): creation opens PG-backed detail; bounded revalidation"
```

---

# Phase 2 — Schema / collection management

## Task 5: Collection mutations service + hook

**Files:**
- Modify: `frontend/lib/interfaces/search.interface.ts`
- Modify: `frontend/lib/services/collection.service.ts`
- Create: `frontend/lib/hooks/use-collection-mutations.ts`
- Test: `frontend/lib/services/__tests__/collection.service.test.ts` (new)
- Test: `frontend/lib/hooks/__tests__/use-collection-mutations.test.tsx`

**Interfaces:**
- Produces (types): `CreateCollectionInput`, `UpdateCollectionInput`.
- Produces (service): `collectionService.create/update/remove`.
- Produces (hook): `useCollectionMutations(): { create, update, remove }` — service + revalidate `'/search/collections'` (+ the `':name'` key on update) + toast.

- [ ] **Step 1: Add input types to `search.interface.ts`**

```ts
export interface CreateCollectionInput {
  name: string
  displayName: string
  description?: string
  fields: FieldSpec[]
}
export interface UpdateCollectionInput {
  displayName?: string
  description?: string | null
  fields?: FieldSpec[]
}
```

- [ ] **Step 2: Add mutations to `collection.service.ts`** (extend the import + object):

```ts
import type { CollectionView, CreateCollectionInput, UpdateCollectionInput } from '@/lib/interfaces/search.interface'

// inside collectionService:
  create(input: CreateCollectionInput): Promise<CollectionView> {
    return apiClient.post<CollectionView>('/search/collections', input).then((r) => r.data)
  },
  update(name: string, patch: UpdateCollectionInput): Promise<CollectionView> {
    return apiClient
      .patch<CollectionView>(`/search/collections/${encodeURIComponent(name)}`, patch)
      .then((r) => r.data)
  },
  remove(name: string): Promise<void> {
    return apiClient.delete(`/search/collections/${encodeURIComponent(name)}`).then(() => undefined)
  },
```

- [ ] **Step 3: Write the service test** — `collection.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/http/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))
import { apiClient } from '@/lib/http/api-client'
import { collectionService } from '@/lib/services/collection.service'

beforeEach(() => vi.clearAllMocks())

describe('collectionService mutations', () => {
  it('create posts to /search/collections', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} })
    await collectionService.create({ name: 'c', displayName: 'C', fields: [{ name: 'a', type: 'string', searchable: true }] })
    expect(apiClient.post).toHaveBeenCalledWith('/search/collections', expect.objectContaining({ name: 'c' }))
  })
  it('update patches by name', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: {} })
    await collectionService.update('c', { displayName: 'C2' })
    expect(apiClient.patch).toHaveBeenCalledWith('/search/collections/c', { displayName: 'C2' })
  })
  it('remove deletes by name', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: undefined })
    await collectionService.remove('c')
    expect(apiClient.delete).toHaveBeenCalledWith('/search/collections/c')
  })
})
```

- [ ] **Step 4: Implement `use-collection-mutations.ts`**

```ts
'use client'
import { useCallback } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { collectionService } from '@/lib/services/collection.service'
import type { CreateCollectionInput, UpdateCollectionInput } from '@/lib/interfaces/search.interface'

export function useCollectionMutations() {
  const { mutate } = useSWRConfig()
  const refreshList = useCallback(() => mutate('/search/collections'), [mutate])

  const create = useCallback(async (input: CreateCollectionInput) => {
    const view = await collectionService.create(input)
    await refreshList()
    toast.success(`Collection “${view.displayName}” created`)
    return view
  }, [refreshList])

  const update = useCallback(async (name: string, patch: UpdateCollectionInput) => {
    const view = await collectionService.update(name, patch)
    await Promise.all([refreshList(), mutate(`/search/collections/${encodeURIComponent(name)}`)])
    toast.success('Collection updated')
    return view
  }, [refreshList, mutate])

  const remove = useCallback(async (name: string) => {
    await collectionService.remove(name)
    await refreshList()
    toast.success('Collection deleted')
  }, [refreshList])

  return { create, update, remove }
}
```

- [ ] **Step 5: Write the hook test** — `use-collection-mutations.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
const mutate = vi.fn()
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/lib/services/collection.service', () => ({ collectionService: { create: vi.fn(), update: vi.fn(), remove: vi.fn() } }))
import { collectionService } from '@/lib/services/collection.service'
import { useCollectionMutations } from '@/lib/hooks/use-collection-mutations'

beforeEach(() => vi.clearAllMocks())

describe('useCollectionMutations', () => {
  it('create calls service and revalidates the list', async () => {
    vi.mocked(collectionService.create).mockResolvedValue({ displayName: 'C' } as never)
    const { result } = renderHook(() => useCollectionMutations())
    await act(async () => { await result.current.create({ name: 'c', displayName: 'C', fields: [] }) })
    expect(collectionService.create).toHaveBeenCalled()
    expect(mutate).toHaveBeenCalledWith('/search/collections')
  })
})
```

- [ ] **Step 6: Run tests**

Run: `cd frontend && npx vitest run lib/services/__tests__/collection.service.test.ts lib/hooks/__tests__/use-collection-mutations.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/interfaces/search.interface.ts frontend/lib/services/collection.service.ts frontend/lib/hooks/use-collection-mutations.ts frontend/lib/services/__tests__/collection.service.test.ts frontend/lib/hooks/__tests__/use-collection-mutations.test.tsx
git commit -m "feat(data-mgmt): collection mutation service + hook"
```

---

## Task 6: Client field-spec validation + editor zod schema

**Files:**
- Create: `frontend/lib/schema/validate-field-spec.ts`
- Create: `frontend/lib/schema/field-spec-to-zod.ts`
- Test: `frontend/lib/schema/__tests__/validate-field-spec.test.ts`

**Interfaces:**
- Produces: `validateFieldSpec(fields): string[]` (mirror of backend rules); `RESERVED_FIELD_NAMES`; `canBeSearchable(type)`, `canBeSortable(type)`; `collectionFormSchema` + `CollectionFormValues`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { validateFieldSpec, canBeSearchable, canBeSortable } from '@/lib/schema/validate-field-spec'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

describe('validateFieldSpec (client mirror)', () => {
  it('requires at least one searchable field', () => {
    expect(validateFieldSpec([{ name: 'a', type: 'string' }])).toContain('At least one field must be searchable')
  })
  it('rejects reserved + duplicate + bad names', () => {
    const fields: FieldSpec[] = [
      { name: 'id', type: 'string', searchable: true },
      { name: '1bad', type: 'string' },
      { name: 'dup', type: 'string' }, { name: 'dup', type: 'string' },
    ]
    const errs = validateFieldSpec(fields)
    expect(errs).toContain('"id" is a reserved field name')
    expect(errs).toContain('Invalid field name "1bad"')
    expect(errs).toContain('Duplicate field "dup"')
  })
  it('flags searchable on non-string and sortable on arrays', () => {
    const errs = validateFieldSpec([{ name: 'n', type: 'number', searchable: true, sortable: true }, { name: 't', type: 'string', searchable: true }])
    expect(errs).toContain('Field "n" cannot be searchable (type number)')
    expect(canBeSearchable('number')).toBe(false)
    expect(canBeSortable('string[]')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run lib/schema/__tests__/validate-field-spec.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `validate-field-spec.ts`** (mirrors `api/.../document-validator.ts`)

```ts
import type { FieldSpec, FieldType } from '@/lib/interfaces/search.interface'

export const RESERVED_FIELD_NAMES = ['id', 'externalId', 'collection', 'createdAt', 'updatedAt']
const FIELD_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/
const SCALARS: FieldType[] = ['string', 'number', 'boolean', 'date']

export const canBeSearchable = (t: FieldType) => t === 'string' || t === 'string[]'
export const canBeSortable = (t: FieldType) => SCALARS.includes(t)

export function validateFieldSpec(fields: FieldSpec[]): string[] {
  const errors: string[] = []
  if (fields.length === 0) return ['A collection must declare at least one field']
  const seen = new Set<string>()
  for (const f of fields) {
    if (!FIELD_NAME_RE.test(f.name)) errors.push(`Invalid field name "${f.name}"`)
    if (RESERVED_FIELD_NAMES.includes(f.name)) errors.push(`"${f.name}" is a reserved field name`)
    if (seen.has(f.name)) errors.push(`Duplicate field "${f.name}"`)
    seen.add(f.name)
    if (f.searchable && !canBeSearchable(f.type)) errors.push(`Field "${f.name}" cannot be searchable (type ${f.type})`)
    if (f.sortable && !canBeSortable(f.type)) errors.push(`Field "${f.name}" cannot be sortable (type ${f.type})`)
  }
  if (!fields.some((f) => f.searchable)) errors.push('At least one field must be searchable')
  return errors
}
```

- [ ] **Step 4: Implement `field-spec-to-zod.ts`**

```ts
import { z } from 'zod'

export const collectionFormSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use lower_snake_case').max(100),
  displayName: z.string().min(1, 'Required').max(255),
  description: z.string().max(500).optional(),
})
export type CollectionFormValues = z.infer<typeof collectionFormSchema>
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run lib/schema/__tests__/validate-field-spec.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/schema/validate-field-spec.ts frontend/lib/schema/field-spec-to-zod.ts frontend/lib/schema/__tests__/validate-field-spec.test.ts
git commit -m "feat(data-mgmt): client field-spec validation mirror + editor schema"
```

---

## Task 7: FieldSpec editor component

**Files:**
- Create: `frontend/components/data-management/field-spec-editor.tsx`
- Test: `frontend/components/data-management/__tests__/field-spec-editor.test.tsx`

**Interfaces:**
- Consumes: `FieldSpec`, `FieldType`, `canBeSearchable`, `canBeSortable`.
- Produces: `FieldSpecEditor({ value, onChange }: { value: FieldSpec[]; onChange: (next: FieldSpec[]) => void })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FieldSpecEditor } from '@/components/data-management/field-spec-editor'

describe('FieldSpecEditor', () => {
  it('adds a new empty field row', () => {
    const onChange = vi.fn()
    render(<FieldSpecEditor value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /add field/i }))
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: '', type: 'string' })])
  })
  it('disables searchable for a number field', () => {
    render(<FieldSpecEditor value={[{ name: 'price', type: 'number' }]} onChange={() => {}} />)
    expect(screen.getByLabelText(/searchable/i)).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run components/data-management/__tests__/field-spec-editor.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `field-spec-editor.tsx`**

```tsx
'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { canBeSearchable, canBeSortable } from '@/lib/schema/validate-field-spec'
import type { FieldSpec, FieldType } from '@/lib/interfaces/search.interface'

const TYPES: FieldType[] = ['string', 'number', 'boolean', 'date', 'string[]', 'number[]']
const FLAGS = ['required', 'searchable', 'filterable', 'sortable'] as const

export function FieldSpecEditor({
  value, onChange,
}: {
  value: FieldSpec[]
  onChange: (next: FieldSpec[]) => void
}) {
  const patch = (i: number, next: Partial<FieldSpec>) =>
    onChange(value.map((f, idx) => (idx === i ? sanitize({ ...f, ...next }) : f)))
  const add = () => onChange([...value, { name: '', type: 'string' }])
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i))

  return (
    <div className="flex flex-col gap-3">
      {value.map((f, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Input aria-label={`field-name-${i}`} placeholder="field_name" value={f.name} onChange={(e) => patch(i, { name: e.target.value })} />
            <Select value={f.type} onValueChange={(t) => patch(i, { type: t as FieldType })}>
              <SelectTrigger className="w-36" aria-label={`field-type-${i}`}><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} aria-label={`remove-field-${i}`}>
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </div>
          <div className="flex flex-wrap gap-4">
            {FLAGS.map((flag) => {
              const disabled =
                (flag === 'searchable' && !canBeSearchable(f.type)) ||
                (flag === 'sortable' && !canBeSortable(f.type))
              return (
                <div key={flag} className="flex items-center gap-2">
                  <Checkbox id={`f-${i}-${flag}`} checked={!!f[flag]} disabled={disabled} onCheckedChange={(c) => patch(i, { [flag]: !!c })} />
                  <Label htmlFor={`f-${i}-${flag}`} className="capitalize">{flag}</Label>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={add} className="self-start">
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} /> Add field
      </Button>
    </div>
  )
}

/** Clear flags a type can no longer support after a type change. */
function sanitize(f: FieldSpec): FieldSpec {
  const out = { ...f }
  if (out.searchable && !canBeSearchable(out.type)) out.searchable = false
  if (out.sortable && !canBeSortable(out.type)) out.sortable = false
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run components/data-management/__tests__/field-spec-editor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/data-management/field-spec-editor.tsx frontend/components/data-management/__tests__/field-spec-editor.test.tsx
git commit -m "feat(data-mgmt): schema field-spec editor"
```

---

## Task 8: Collection editor sheet (create + edit)

**Files:**
- Create: `frontend/components/data-management/collection-editor-sheet.tsx`
- Test: `frontend/components/data-management/__tests__/collection-editor-sheet.test.tsx`

**Interfaces:**
- Consumes: `useCollectionMutations`, `collectionFormSchema`, `validateFieldSpec`, `FieldSpecEditor`, `useCollectionDefinition`, `ApiError`.
- Produces: `CollectionEditorSheet({ open, mode, name?, onClose })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const create = vi.fn()
vi.mock('@/lib/hooks/use-collection-mutations', () => ({ useCollectionMutations: () => ({ create, update: vi.fn() }) }))
vi.mock('@/lib/hooks/use-collection-definition', () => ({ useCollectionDefinition: () => ({ definition: null, fields: [] }) }))
import { CollectionEditorSheet } from '@/components/data-management/collection-editor-sheet'

beforeEach(() => vi.clearAllMocks())

describe('CollectionEditorSheet (create)', () => {
  it('blocks submit when no field is searchable', async () => {
    render(<CollectionEditorSheet open mode="create" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'products' } })
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Products' } })
    fireEvent.click(screen.getByRole('button', { name: /add field/i }))
    fireEvent.change(screen.getByLabelText('field-name-0'), { target: { value: 'title' } })
    fireEvent.click(screen.getByRole('button', { name: /create collection/i }))
    await waitFor(() => expect(screen.getByText(/at least one field must be searchable/i)).toBeInTheDocument())
    expect(create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run components/data-management/__tests__/collection-editor-sheet.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `collection-editor-sheet.tsx`**

```tsx
'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FieldSpecEditor } from '@/components/data-management/field-spec-editor'
import { useCollectionMutations } from '@/lib/hooks/use-collection-mutations'
import { useCollectionDefinition } from '@/lib/hooks/use-collection-definition'
import { validateFieldSpec } from '@/lib/schema/validate-field-spec'
import { collectionFormSchema, type CollectionFormValues } from '@/lib/schema/field-spec-to-zod'
import { ApiError } from '@/lib/http/api-client'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

export function CollectionEditorSheet({
  open, mode, name, onClose,
}: {
  open: boolean
  mode: 'create' | 'edit'
  name?: string
  onClose: () => void
}) {
  const { create, update } = useCollectionMutations()
  const { definition, fields: existing } = useCollectionDefinition(mode === 'edit' ? (name ?? null) : null)
  const form = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { name: '', displayName: '', description: '' },
  })
  const [fields, setFields] = React.useState<FieldSpec[]>([])
  const [specErrors, setSpecErrors] = React.useState<string[]>([])

  React.useEffect(() => {
    if (open && mode === 'edit' && definition) {
      form.reset({ name: definition.name, displayName: definition.displayName, description: definition.description ?? '' })
      setFields(existing)
    }
    if (open && mode === 'create') { form.reset({ name: '', displayName: '', description: '' }); setFields([]) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, definition])

  const onSubmit = async (values: CollectionFormValues) => {
    const errs = validateFieldSpec(fields)
    setSpecErrors(errs)
    if (errs.length) return
    try {
      if (mode === 'create') await create({ ...values, fields })
      else await update(name as string, { displayName: values.displayName, description: values.description ?? null, fields })
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save collection')
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{mode === 'create' ? 'New collection' : `Edit “${name}”`}</SheetTitle>
          <SheetDescription>Define the collection identity and its field schema.</SheetDescription>
        </SheetHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4 px-4 pb-6">
          <Field data-invalid={form.formState.errors.name ? 'true' : undefined}>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" disabled={mode === 'edit'} {...form.register('name')} />
            {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
          </Field>
          <Field data-invalid={form.formState.errors.displayName ? 'true' : undefined}>
            <FieldLabel htmlFor="displayName">Display name</FieldLabel>
            <Input id="displayName" {...form.register('displayName')} />
            {form.formState.errors.displayName && <FieldError>{form.formState.errors.displayName.message}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <Input id="description" {...form.register('description')} />
          </Field>

          {mode === 'edit' && (
            <Alert>
              <AlertDescription>
                Changing fields triggers a background reindex and does not re-validate existing records.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Fields</span>
            <FieldSpecEditor value={fields} onChange={(f) => { setFields(f); setSpecErrors([]) }} />
            {specErrors.length > 0 && (
              <ul className="text-sm text-destructive">{specErrors.map((e) => <li key={e}>{e}</li>)}</ul>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {mode === 'create' ? 'Create collection' : 'Save changes'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run components/data-management/__tests__/collection-editor-sheet.test.tsx`
Expected: PASS. (If `Alert`/`AlertDescription` export names differ, confirm with `grep -n export frontend/components/ui/alert.tsx`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/data-management/collection-editor-sheet.tsx frontend/components/data-management/__tests__/collection-editor-sheet.test.tsx
git commit -m "feat(data-mgmt): collection editor sheet (create + edit)"
```

---

## Task 9: Collection manager dialog + store panel + toolbar wiring

**Files:**
- Modify: `frontend/lib/state-management/data-management.store.ts`
- Create: `frontend/components/data-management/collection-manager-dialog.tsx`
- Modify: `frontend/components/data-management/record-toolbar.tsx`
- Modify: `frontend/components/data-management/data-management-view.tsx`
- Test: `frontend/lib/state-management/__tests__/data-management.store.test.ts` (extend)
- Test: `frontend/components/data-management/__tests__/collection-manager-dialog.test.tsx`

**Interfaces:**
- Produces (store): `CollectionPanel` + `collectionPanel` + `openCollections()`, `openCreateCollection()`, `openEditCollection(name)`, `closeCollectionPanel()`.
- Produces (UI): `CollectionManagerDialog()`; toolbar **Manage…** + **Reindex** (admin).

- [ ] **Step 1: Extend the store** — add above the creator and into the interface/creator:

```ts
export type CollectionPanel =
  | { kind: 'closed' } | { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; name: string }
```

```ts
// interface:
  collectionPanel: CollectionPanel
  openCollections: () => void
  openCreateCollection: () => void
  openEditCollection: (name: string) => void
  closeCollectionPanel: () => void
// creator:
  collectionPanel: { kind: 'closed' },
  openCollections: () => set({ collectionPanel: { kind: 'list' } }, false, 'dm/openCollections'),
  openCreateCollection: () => set({ collectionPanel: { kind: 'create' } }, false, 'dm/openCreateCollection'),
  openEditCollection: (name) => set({ collectionPanel: { kind: 'edit', name } }, false, 'dm/openEditCollection'),
  closeCollectionPanel: () => set({ collectionPanel: { kind: 'closed' } }, false, 'dm/closeCollectionPanel'),
```

- [ ] **Step 2: Extend the store test** (add `collectionPanel: { kind: 'closed' }` to the `beforeEach` reset):

```ts
it('collection panel transitions', () => {
  get().openCollections(); expect(get().collectionPanel).toEqual({ kind: 'list' })
  get().openEditCollection('products'); expect(get().collectionPanel).toEqual({ kind: 'edit', name: 'products' })
  get().closeCollectionPanel(); expect(get().collectionPanel).toEqual({ kind: 'closed' })
})
```

- [ ] **Step 3: Implement `collection-manager-dialog.tsx`**

```tsx
'use client'

import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { CollectionEditorSheet } from '@/components/data-management/collection-editor-sheet'
import { useCollections } from '@/lib/hooks/use-collections'
import { useCollectionMutations } from '@/lib/hooks/use-collection-mutations'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'

export function CollectionManagerDialog() {
  const panel = useDataManagementStore((s) => s.collectionPanel)
  const openCreate = useDataManagementStore((s) => s.openCreateCollection)
  const openEdit = useDataManagementStore((s) => s.openEditCollection)
  const close = useDataManagementStore((s) => s.closeCollectionPanel)
  const { collections } = useCollections()
  const { remove } = useCollectionMutations()
  const editing = panel.kind === 'edit' ? panel.name : undefined

  return (
    <>
      <Dialog open={panel.kind === 'list'} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Collections</DialogTitle>
            <DialogDescription>Create, edit, or delete collections.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {collections.map((c) => (
              <div key={c.name} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{c.displayName}</div>
                  <div className="text-xs text-muted-foreground">{c.name} · {c.fields.length} fields</div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(c.name)}>Edit</Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="ghost" size="sm">Delete</Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{c.displayName}”?</AlertDialogTitle>
                        <AlertDialogDescription>This drops the search index and soft-deletes all its records.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void remove(c.name)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={openCreate} className="self-start">New collection</Button>
          </div>
        </DialogContent>
      </Dialog>

      <CollectionEditorSheet
        open={panel.kind === 'create' || panel.kind === 'edit'}
        mode={panel.kind === 'edit' ? 'edit' : 'create'}
        name={editing}
        onClose={close}
      />
    </>
  )
}
```

- [ ] **Step 4: Wire the toolbar** — in `record-toolbar.tsx`, import `useRecordMutations`, add the store opener + reindex, and render two admin buttons in the `ml-auto` group:

```tsx
// near the top of RecordToolbar:
const openCollections = useDataManagementStore((s) => s.openCollections)
const { reindex } = useRecordMutations()

// inside the ml-auto action group, before "New record":
{isAdmin && (<Button variant="outline" size="sm" onClick={openCollections}>Manage…</Button>)}
{isAdmin && s.collection && (<Button variant="outline" size="sm" onClick={() => void reindex()}>Reindex</Button>)}
```

Add the import: `import { useRecordMutations } from '@/lib/hooks/use-record-mutations'`.

- [ ] **Step 5: Mount the dialog** — in `data-management-view.tsx`, add the import and render `<CollectionManagerDialog />` at the top level (outside the `collection &&` guard):

```tsx
import { CollectionManagerDialog } from '@/components/data-management/collection-manager-dialog'
// …after <RecordDataTable/>:
<CollectionManagerDialog />
```

- [ ] **Step 6: Write the manager test** — `collection-manager-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/lib/hooks/use-collections', () => ({
  useCollections: () => ({ collections: [{ name: 'products', displayName: 'Products', fields: [{ name: 'a', type: 'string' }] }] }),
}))
vi.mock('@/lib/hooks/use-collection-mutations', () => ({ useCollectionMutations: () => ({ remove: vi.fn() }) }))
vi.mock('@/lib/hooks/use-collection-definition', () => ({ useCollectionDefinition: () => ({ definition: null, fields: [] }) }))
vi.mock('@/lib/state-management/data-management.store', () => ({
  useDataManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ collectionPanel: { kind: 'list' }, openCreateCollection: vi.fn(), openEditCollection: vi.fn(), closeCollectionPanel: vi.fn() }),
}))
import { CollectionManagerDialog } from '@/components/data-management/collection-manager-dialog'

describe('CollectionManagerDialog', () => {
  it('lists collections with a New button', () => {
    render(<CollectionManagerDialog />)
    expect(screen.getByText('Products')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new collection/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run the tests**

Run: `cd frontend && npx vitest run lib/state-management/__tests__/data-management.store.test.ts components/data-management/__tests__/collection-manager-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/state-management/data-management.store.ts frontend/components/data-management/collection-manager-dialog.tsx frontend/components/data-management/record-toolbar.tsx frontend/components/data-management/data-management-view.tsx frontend/lib/state-management/__tests__/data-management.store.test.ts frontend/components/data-management/__tests__/collection-manager-dialog.test.tsx
git commit -m "feat(data-mgmt): collection manager dialog + toolbar wiring"
```

---

# Phase 3 — Query enrichment

## Task 10: Query plumbing for facets + highlight

**Files:**
- Modify: `frontend/lib/interfaces/search.interface.ts` (extend `SearchRequestBody`)
- Modify: `frontend/lib/schema/serialize-query.ts`
- Modify: `frontend/lib/services/record.service.ts`
- Modify: `frontend/lib/hooks/use-records.ts`
- Modify: `frontend/components/data-management/data-management-view.tsx` (call `useRecords(fields)`)
- Test: `frontend/lib/schema/__tests__/serialize-query.test.ts` (extend)

**Interfaces:**
- Produces: `toSearchRequestBody(query, opts?: { facets?; highlight? })`; `recordService.query(collection, query, opts?)`; `useRecords(fields?: FieldSpec[])` derives facets (`filterable && enum`) + highlight (`searchable`).

- [ ] **Step 1: Extend `SearchRequestBody`** — add `facets?: string[]` and `highlight?: string[]`.

- [ ] **Step 2: Extend the serializer**

```ts
export function toSearchRequestBody(
  query: SearchQuery,
  opts: { facets?: string[]; highlight?: string[] } = {},
): SearchRequestBody {
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
  if (opts.facets?.length) body.facets = opts.facets
  if (opts.highlight?.length) body.highlight = opts.highlight
  return body
}
```

- [ ] **Step 3: Extend the serializer test**

```ts
it('includes facets and highlight when provided', () => {
  const out = toSearchRequestBody(base, { facets: ['status'], highlight: ['title'] })
  expect(out.facets).toEqual(['status'])
  expect(out.highlight).toEqual(['title'])
})
```

- [ ] **Step 4: Extend `recordService.query`**

```ts
  query(collection: string, query: SearchQuery, opts?: { facets?: string[]; highlight?: string[] }): Promise<SearchResults> {
    return apiClient
      .post<SearchResults>(`${base(collection)}/query`, toSearchRequestBody(query, opts))
      .then((r) => r.data)
  },
```

- [ ] **Step 5: Update `use-records.ts`** to accept `fields` and derive facets/highlight

```ts
import useSWR from 'swr'
import { recordService } from '@/lib/services/record.service'
import { useCollection, useRecordQuery } from '@/lib/state-management/data-management.store'
import type { FieldSpec, SearchResults } from '@/lib/interfaces/search.interface'

export function useRecords(fields: FieldSpec[] = []) {
  const collection = useCollection()
  const query = useRecordQuery()
  const facets = fields.filter((f) => f.filterable && f.enum?.length).map((f) => f.name)
  const highlight = fields.filter((f) => f.searchable).map((f) => f.name)
  const key = collection ? (['records', collection, query] as const) : null
  const { data, isLoading, isValidating, error, mutate } = useSWR<SearchResults>(
    key,
    () => recordService.query(collection as string, query, { facets, highlight }),
    { keepPreviousData: true },
  )
  return { results: data, isLoading, isValidating, error, mutate }
}
```

`data-management-view.tsx`: change to `const { results, isLoading, error, mutate } = useRecords(fields)`. `use-record-mutations.ts` keeps `useRecords()` (facets/highlight are not part of the SWR key — they are stable per `collection`, which is in the key — so an empty `fields` there does not fork the cache).

- [ ] **Step 6: Run tests**

Run: `cd frontend && npx vitest run lib/schema/__tests__/serialize-query.test.ts lib/hooks/__tests__/use-records.test.tsx`
Expected: PASS. If `use-records.test.tsx` asserts exact `query` args, relax it to `expect.objectContaining(...)` to allow the 3rd `opts` arg.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/interfaces/search.interface.ts frontend/lib/schema/serialize-query.ts frontend/lib/services/record.service.ts frontend/lib/hooks/use-records.ts frontend/components/data-management/data-management-view.tsx frontend/lib/schema/__tests__/serialize-query.test.ts
git commit -m "feat(data-mgmt): request facets + highlight in queries"
```

---

## Task 11: Facet counts in the filter panel

**Files:**
- Modify: `frontend/components/data-management/field-to-filter.tsx`
- Modify: `frontend/components/data-management/record-filters.tsx`
- Modify: `frontend/components/data-management/record-toolbar.tsx`
- Modify: `frontend/components/data-management/data-management-view.tsx`
- Test: `frontend/components/data-management/__tests__/field-to-filter.test.tsx` (extend)

**Interfaces:**
- Produces: `FilterControl` accepts optional `counts?: Record<string, number>`; `RecordFilters`/`RecordToolbar` thread `facetDistribution` from results.

- [ ] **Step 1: Extend `FilterControl`** — add `counts?: Record<string, number>` to props; in the enum branch, render the count beside the label:

```tsx
<Label htmlFor={`f-${field.name}-${key}`}>
  {key}{counts && key in counts ? ` (${counts[key]})` : ''}
</Label>
```

- [ ] **Step 2: Thread through `RecordFilters`** — accept `facetDistribution?: Record<string, Record<string, number>>`; pass `counts={facetDistribution?.[field.name]}` to each `FilterControl`.

- [ ] **Step 3: Thread through `RecordToolbar`** — accept `facetDistribution?` and pass it to `<RecordFilters …/>`.

- [ ] **Step 4: Pass from the view** — `<RecordToolbar fields={fields} facetDistribution={results?.facetDistribution} />`.

- [ ] **Step 5: Extend the filter test**

```tsx
it('enum: renders facet counts when provided', () => {
  render(<FilterControl field={{ name: 'status', type: 'string', enum: ['active'] }} value={undefined} counts={{ active: 7 }} onChange={() => {}} />)
  expect(screen.getByText('active (7)')).toBeInTheDocument()
})
```

- [ ] **Step 6: Run tests**

Run: `cd frontend && npx vitest run components/data-management/__tests__/field-to-filter.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/data-management/field-to-filter.tsx frontend/components/data-management/record-filters.tsx frontend/components/data-management/record-toolbar.tsx frontend/components/data-management/data-management-view.tsx frontend/components/data-management/__tests__/field-to-filter.test.tsx
git commit -m "feat(data-mgmt): faceted filters with live counts"
```

---

## Task 12: Hit highlighting in cells

**Files:**
- Modify: `frontend/components/data-management/field-cell.tsx`
- Modify: `frontend/lib/schema/field-to-column.tsx`
- Test: `frontend/components/data-management/__tests__/field-cell.test.tsx` (extend)

**Interfaces:**
- Produces: `FieldCell` accepts optional `highlighted?: string` (a Meili `_formatted` fragment with `<em>`); when set for a string field, renders it (allowlist-sanitized) instead of the raw value.

- [ ] **Step 1: Extend `FieldCell`** — add `highlighted?: string`; in the default (string) branch, prefer it:

```tsx
if (typeof highlighted === 'string' && highlighted.length) {
  return <span className="block max-w-[28ch] truncate" dangerouslySetInnerHTML={{ __html: sanitizeMarks(highlighted) }} />
}
return <span className="block max-w-[28ch] truncate">{String(value)}</span>
```

Add the sanitizer at the bottom of the file:

```tsx
/** Escape everything, then re-allow only <em>/<mark> tags (Meili's default highlight tags). */
function sanitizeMarks(html: string): string {
  const escaped = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(/&lt;(\/?)(em|mark)&gt;/g, '<$1$2>')
}
```

- [ ] **Step 2: Pass `_formatted` in the column cell** — in `field-to-column.tsx`, update the `cell` renderer:

```tsx
cell: ({ getValue, row }) => {
  const formatted = (row.original as { _formatted?: Record<string, string> })._formatted
  return <FieldCell field={field} value={getValue()} highlighted={formatted?.[field.name]} />
},
```

- [ ] **Step 3: Extend the cell test**

```tsx
it('renders highlight marks for a string field', () => {
  render(<FieldCell field={{ name: 'title', type: 'string' }} value="hello world" highlighted="<em>hello</em> world" />)
  expect(screen.getByText('hello')).toBeInTheDocument()
})
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run components/data-management/__tests__/field-cell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/data-management/field-cell.tsx frontend/lib/schema/field-to-column.tsx frontend/components/data-management/__tests__/field-cell.test.tsx
git commit -m "feat(data-mgmt): render search hit highlighting in cells"
```

---

## Task 13: Multi-column sort

**Files:**
- Modify: `frontend/lib/state-management/data-management.store.ts`
- Modify: `frontend/components/data-management/record-data-table.tsx`
- Test: `frontend/lib/state-management/__tests__/data-management.store.test.ts` (extend)

**Interfaces:**
- Produces: `toggleSort(field: string, additive?: boolean)` — non-additive replaces (asc→desc→off, single); additive cycles that field within an ordered array, preserving others.

- [ ] **Step 1: Rewrite `toggleSort`** and update its interface signature to `(field: string, additive?: boolean) => void`:

```ts
  toggleSort: (field, additive = false) =>
    set(
      (s) => {
        const idx = s.sort.findIndex((x) => x.field === field)
        const cur = idx >= 0 ? s.sort[idx] : undefined
        const cycle = !cur ? { field, dir: 'asc' as const } : cur.dir === 'asc' ? { field, dir: 'desc' as const } : null
        if (!additive) return { sort: cycle ? [cycle] : [] }
        const next = s.sort.filter((x) => x.field !== field)
        if (cycle) next.splice(idx >= 0 ? idx : next.length, 0, cycle)
        return { sort: next }
      },
      false,
      'dm/toggleSort',
    ),
```

- [ ] **Step 2: Update the table header** — in `record-data-table.tsx`, replace the active-sort lookup and the click handler:

```tsx
const active = s.sort.find((x) => x.field === meta?.field.name)
// …
onClick={(e) => s.toggleSort(meta!.field.name, e.shiftKey)}
```

- [ ] **Step 3: Extend the store test**

```ts
it('additive toggleSort keeps prior sorts', () => {
  get().toggleSort('price')
  get().toggleSort('name', true)
  expect(get().sort).toEqual([{ field: 'price', dir: 'asc' }, { field: 'name', dir: 'asc' }])
  get().toggleSort('price', true)
  expect(get().sort).toEqual([{ field: 'price', dir: 'desc' }, { field: 'name', dir: 'asc' }])
})
it('non-additive toggleSort still replaces', () => {
  get().toggleSort('price'); get().toggleSort('name')
  expect(get().sort).toEqual([{ field: 'name', dir: 'asc' }])
})
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run lib/state-management/__tests__/data-management.store.test.ts`
Expected: PASS (the existing single-sort cycle test stays green — the non-additive path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/state-management/data-management.store.ts frontend/components/data-management/record-data-table.tsx frontend/lib/state-management/__tests__/data-management.store.test.ts
git commit -m "feat(data-mgmt): multi-column sort (shift-click)"
```

---

## Task 14: URL sync (collection + query + record deep-link)

**Files:**
- Create: `frontend/lib/hooks/use-query-url-sync.ts`
- Modify: `frontend/components/data-management/data-management-view.tsx`
- Test: `frontend/lib/hooks/__tests__/use-query-url-sync.test.tsx`

**Interfaces:**
- Consumes: `next/navigation` (`useRouter`, `useSearchParams`, `usePathname`), the store.
- Produces: `useQueryUrlSync()` — hydrates `collection`, `q`, `page`, `sort`, `detailId` (`?record`) from the URL on mount, then writes back with `router.replace`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/dashboard/data-management',
  useSearchParams: () => new URLSearchParams('collection=products&record=abc&q=laptop'),
}))
const actions = { setCollection: vi.fn(), setSearch: vi.fn(), setPage: vi.fn(), toggleSort: vi.fn(), openDetail: vi.fn() }
vi.mock('@/lib/state-management/data-management.store', () => ({
  useDataManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ ...actions, collection: null, q: '', page: 1, sort: [], detailId: null }),
}))
import { useQueryUrlSync } from '@/lib/hooks/use-query-url-sync'

describe('useQueryUrlSync', () => {
  it('hydrates collection, search, and record from the URL on mount', () => {
    renderHook(() => useQueryUrlSync())
    expect(actions.setCollection).toHaveBeenCalledWith('products')
    expect(actions.setSearch).toHaveBeenCalledWith('laptop')
    expect(actions.openDetail).toHaveBeenCalledWith('abc')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run lib/hooks/__tests__/use-query-url-sync.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `use-query-url-sync.ts`**

```ts
'use client'
import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'

/** Two-way projection between the URL and the data-management store. */
export function useQueryUrlSync() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const store = useDataManagementStore((s) => s)
  const hydrated = React.useRef(false)

  React.useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    const collection = params.get('collection')
    const q = params.get('q')
    const page = params.get('page')
    const sort = params.get('sort')
    const record = params.get('record')
    if (collection) store.setCollection(collection)
    if (q) store.setSearch(q)
    if (page) store.setPage(Number(page) || 1)
    if (sort) {
      const [field, dir] = sort.split(':')
      if (field && (dir === 'asc' || dir === 'desc')) {
        store.toggleSort(field)                 // → asc
        if (dir === 'desc') store.toggleSort(field) // → desc
      }
    }
    if (record) store.openDetail(record)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (!hydrated.current) return
    const next = new URLSearchParams()
    if (store.collection) next.set('collection', store.collection)
    if (store.q) next.set('q', store.q)
    if (store.page > 1) next.set('page', String(store.page))
    if (store.sort[0]) next.set('sort', `${store.sort[0].field}:${store.sort[0].dir}`)
    if (store.detailId) next.set('record', store.detailId)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [store.collection, store.q, store.page, store.sort, store.detailId, pathname, router])
}
```

- [ ] **Step 4: Invoke in the view** — in `DataManagementView`, call `useQueryUrlSync()` before the "default to first collection" effect, and guard that effect so it only fires when the URL did not set a collection (it already checks `!collection`, which the hydration will have populated — no further change needed).

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run lib/hooks/__tests__/use-query-url-sync.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/hooks/use-query-url-sync.ts frontend/components/data-management/data-management-view.tsx frontend/lib/hooks/__tests__/use-query-url-sync.test.tsx
git commit -m "feat(data-mgmt): URL-synced query + record deep-link"
```

---

## Phase 3 gate: full suite + build

- [ ] `cd frontend && npx vitest run` — all green.
- [ ] `cd frontend && npm run build` — clean.
- [ ] `cd api && npm test && npm run build` — clean.

---

# Phase 4 — Optional: date-range filter

> Implement only if date-range **filtering** is wanted this iteration. Recency **sort** already works (Task 13 + always-sortable `createdAt`/`updatedAt`). This adds range operators to the query filter builder.

## Task 15 (optional): range filter operators + date-range control

**Files:**
- Modify: `api/src/features/search-service/search.types.ts` (`SearchFilterValue` +range)
- Modify: `api/src/features/search-service/dto/search-query.dto.ts` (filter union +range)
- Modify: `api/src/features/search-service/search-record.service.ts` (`toFilterClause` range)
- Test: `api/src/features/search-service/search-record.service.spec.ts`
- Modify: `frontend/lib/interfaces/search.interface.ts` (`FilterValue` +range)
- Modify: `frontend/components/data-management/field-to-filter.tsx` (date/number range inputs)

- [ ] **Step 1: Backend test**

```ts
it('emits >= / <= for a range filter value', async () => {
  const { service, engine } = make()
  await service.search('articles', { q: '', page: 1, filters: { createdAt: { gte: 100, lte: 200 } } as never })
  expect(searchArg(engine).filter).toEqual(['createdAt >= 100 AND createdAt <= 200'])
})
```

(`createdAt` is in the test collection's `filterableAttributes`.)

- [ ] **Step 2: Widen `SearchFilterValue`** in `search.types.ts`:

```ts
export type SearchFilterValue =
  | string | number | boolean | Array<string | number>
  | { gte?: number; lte?: number };
```

- [ ] **Step 3: Extend `searchQuerySchema`** filter union:

```ts
z.union([
  z.string(), z.number(), z.boolean(),
  z.array(z.union([z.string(), z.number()])),
  z.object({ gte: z.number().optional(), lte: z.number().optional() }),
])
```

- [ ] **Step 4: Extend `toFilterClause`** (handle the range object before the array/scalar branches):

```ts
if (value && typeof value === 'object' && !Array.isArray(value)) {
  const parts: string[] = []
  const r = value as { gte?: number; lte?: number }
  if (typeof r.gte === 'number') parts.push(`${field} >= ${r.gte}`)
  if (typeof r.lte === 'number') parts.push(`${field} <= ${r.lte}`)
  return parts.join(' AND ')
}
```

- [ ] **Step 5: Frontend** — add `{ gte?: number; lte?: number }` to `FilterValue`; in `field-to-filter.tsx`, render two `type="date"`/`type="number"` inputs for `date`/`number` fields that emit `{ gte, lte }` (omit empty bounds; emit `undefined` when both empty).

- [ ] **Step 6: Run, build, commit**

```bash
cd api && npx jest src/features/search-service/search-record.service.spec.ts && npm run build
cd ../frontend && npx vitest run components/data-management/__tests__/field-to-filter.test.tsx && npm run build
git add api/src/features/search-service/ frontend/lib/interfaces/search.interface.ts frontend/components/data-management/field-to-filter.tsx
git commit -m "feat(search): range filter operators + date-range control"
```

---

## Self-Review

**Spec coverage:** §2.2 single-record read → T1; frontend read → T2–T3; §4 detail/edit off-page + live status → T3; deep-link → T14; §5 creation redesign → T4; §6 schema management → T5–T9; §7 facets → T10–T11, highlight → T10, T12, multi-sort + recency → T13, URL-sync → T14, date-range (optional) → T15; §10 RBAC/edge cases → T3 (404/not-found, read-only), T8 (reindex caveat banner), T9 (admin gating).

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every test step shows real assertions + a run command with expected output.

**Type consistency:** `RecordDetail` (nested) vs `RecordHit` (flat) kept distinct; `RecordView` (backend) shape mirrors `RecordDetail` (frontend); `toSearchRequestBody(query, opts)` and `recordService.query(collection, query, opts)` share the same `{ facets?, highlight? }` opts; `toggleSort(field, additive?)` is defined once (T13) and called with the modifier in the table (T13) and hydration (T14); `CollectionPanel` union, `Create/UpdateCollectionInput`, and `collectionFormSchema`/`CollectionFormValues` are each defined once and imported consistently.

**Known intentional deviations:** the optimistic "pending row" in the table (design §5) is omitted as non-load-bearing now that the PG read authoritatively shows a just-created record — the toast **View** action + bounded revalidation cover the flow; if a visible pending row is later wanted, it is an additive change to `record-data-table.tsx`.
```
