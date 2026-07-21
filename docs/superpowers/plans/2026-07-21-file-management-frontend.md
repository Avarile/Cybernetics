# File Management Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade File Management panel over the backend `file-processor` API — browse, upload (drag-and-drop + client SHA-256 dedup/integrity), download, delete, and review quarantined files.

**Architecture:** Mirrors the existing `data-management` feature: a Zustand store is the single source of truth, SWR hooks fetch/mutate, and a TanStack + shadcn table (adapted from `components/data-table.tsx` via the `record-data-table` precedent) renders the list. All feature components live in `frontend/app/dashboard/file-management/components/`; state/data modules live under `frontend/lib/`.

**Tech Stack:** Next.js (app router, client components), React, TypeScript, Zustand (+devtools), SWR, `@tanstack/react-table`, shadcn/ui, `@hugeicons/react` + `@hugeicons/core-free-icons`, `sonner` (toasts), Web Crypto (`crypto.subtle`), Vitest + Testing Library.

## Global Constraints

- **Test runner:** Vitest. Run a single file with `npx vitest run <path>`; full suite `npm test`. Config: `frontend/vitest.config.ts` (jsdom, `globals: true`, `@` → repo `frontend/` root, setup `frontend/vitest.setup.ts`).
- **All commands run from `frontend/`.** Paths in this plan are relative to `frontend/` unless prefixed with `api/`.
- **Import alias:** `@/` → `frontend/` (e.g. `@/components/ui/button`, `@/lib/...`).
- **Backend base URL has NO `/api` prefix**; routes are root-level. `apiClient` (axios) injects the bearer and normalizes errors to `ApiError` — never build raw fetch calls except the presigned upload POST (which must be unauthenticated).
- **Backend facts (immutable):** endpoints are `POST /files`, `POST /files/:id/complete`, `GET /files`, `GET /files/:id`, `GET /files/:id/download-url?ttl=`, `DELETE /files/:id`. There is **no update endpoint** and **no bulk-delete endpoint**. List filters accept `status` and **exact** `mimeType` only. `status ∈ {PENDING, AVAILABLE, QUARANTINED}`. `complete` sets `AVAILABLE` synchronously; an async job may flip it to `QUARANTINED` (writing `metadata.quarantineReason`).
- **Component location (requirement):** every feature component under `frontend/app/dashboard/file-management/components/`. Do not import another feature's components; extend shadcn `@/components/ui/*` primitives.
- **Commits:** conventional-commit style. **Do NOT add a `Co-Authored-By` trailer** (repo policy — `.claude/settings.json` has no `attribution.commit`).
- **Icons:** use only verified `@hugeicons/core-free-icons` exports. Verified for this plan: `Upload01Icon`, `Download01Icon`, `Copy01Icon`, `Link01Icon`, `Cancel01Icon`, `Alert02Icon`, `AlertCircleIcon`, `CheckmarkCircle02Icon`, `File01Icon`, `Image01Icon`, `FileZipIcon`, `Archive02Icon`, `InformationCircleIcon`, `Delete02Icon`, `RefreshIcon`, `Add01Icon`, `MoreVerticalCircle01Icon`.
- **Spec:** `docs/superpowers/specs/2026-07-21-file-management-frontend-design.md`.

---

## File Structure

**State / data (`frontend/lib/`)**
- `lib/interfaces/search.interface.ts` — *modify:* add `FileStatus`, `FileStatusFilter`, `FilesQuery`, `PaginatedFiles`.
- `lib/services/file.service.ts` — *modify:* add `list()`, `remove()`.
- `lib/state-management/file-management.store.ts` — *create:* Zustand store + selectors.
- `lib/hooks/use-file-upload.ts` — *modify:* SHA-256 hashing, dedup path, per-file error isolation, new statuses.
- `lib/hooks/use-files.ts` — *create:* list hook + `computeRefreshInterval` helper.
- `lib/hooks/use-file-detail.ts` — *create:* single-file detail hook.
- `lib/hooks/use-file-mutations.ts` — *create:* bulk delete (looped single deletes, partial-failure aware).

**Feature components (`frontend/app/dashboard/file-management/components/`)**
- `file-format.ts` — pure presentation helpers (bytes, datetime, mime label/icon, quarantine reason).
- `file-status-badge.tsx` — status → colored badge (+ quarantine reason tooltip).
- `file-columns.tsx` — `buildFileColumns()` data columns.
- `file-row-actions.tsx` — per-row `⋮` menu.
- `file-pagination.tsx` — pagination footer (based on `data-table.tsx`).
- `file-data-table.tsx` — TanStack + shadcn table.
- `file-status-tabs.tsx` — All/Available/Pending/Quarantined tabs (+ quarantine count).
- `file-dropzone.tsx` — drag-and-drop + browse.
- `file-upload-list.tsx` — per-file upload progress rows.
- `file-upload-dialog.tsx` — upload dialog (dropzone + queue).
- `file-detail-drawer.tsx` — right-side detail drawer.
- `file-delete-dialog.tsx` — confirm dialog (single + bulk).
- `file-toolbar.tsx` — type filter, search, refresh, bulk delete, upload button.
- `file-management-view.tsx` — orchestrator.
- `__tests__/…` — one spec per module above.

**Route / nav**
- `app/dashboard/file-management/page.tsx` — *create:* page shell.
- `components/app-sidebar.tsx` — *modify:* add "File Management" nav entry.

---

### Task 1: Interfaces + service methods (`list`, `remove`)

**Files:**
- Modify: `lib/interfaces/search.interface.ts` (append to the `// ── Files` block, ~line 107)
- Modify: `lib/services/file.service.ts`
- Test: `lib/services/__tests__/file.service.test.ts` (create)

**Interfaces:**
- Consumes: existing `FileMetadata` (search.interface.ts), `apiClient` (`@/lib/http/api-client`).
- Produces:
  - `type FileStatus = 'PENDING' | 'AVAILABLE' | 'QUARANTINED'`
  - `type FileStatusFilter = 'ALL' | FileStatus`
  - `interface FilesQuery { status: FileStatusFilter; mimeType?: string; page: number; limit: number }`
  - `interface PaginatedFiles { items: FileMetadata[]; total: number; page: number; limit: number }`
  - `fileService.list(query: FilesQuery): Promise<PaginatedFiles>`
  - `fileService.remove(id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/__tests__/file.service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/lib/http/api-client'
import { fileService } from '@/lib/services/file.service'

let mock: MockAdapter
beforeEach(() => { mock = new MockAdapter(apiClient) })
afterEach(() => mock.restore())

describe('fileService.list', () => {
  it('omits status when ALL and passes paging + mimeType', async () => {
    mock.onGet('/files').reply((config) => {
      expect(config.params).toEqual({ page: 2, limit: 20, mimeType: 'application/pdf' })
      return [200, { items: [], total: 0, page: 2, limit: 20 }]
    })
    const res = await fileService.list({ status: 'ALL', mimeType: 'application/pdf', page: 2, limit: 20 })
    expect(res.page).toBe(2)
  })

  it('sends status when not ALL', async () => {
    mock.onGet('/files').reply((config) => {
      expect(config.params).toEqual({ page: 1, limit: 20, status: 'QUARANTINED' })
      return [200, { items: [], total: 0, page: 1, limit: 20 }]
    })
    await fileService.list({ status: 'QUARANTINED', page: 1, limit: 20 })
  })
})

describe('fileService.remove', () => {
  it('DELETEs the file by id', async () => {
    mock.onDelete('/files/abc').reply(204)
    await expect(fileService.remove('abc')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/services/__tests__/file.service.test.ts`
Expected: FAIL — `fileService.list is not a function`.

- [ ] **Step 3: Add the interfaces**

Append to `lib/interfaces/search.interface.ts` inside the Files block (after `FileMetadata`):

```ts
export type FileStatus = 'PENDING' | 'AVAILABLE' | 'QUARANTINED'
export type FileStatusFilter = 'ALL' | FileStatus

export interface FilesQuery {
  status: FileStatusFilter
  mimeType?: string
  page: number
  limit: number
}

export interface PaginatedFiles {
  items: FileMetadata[]
  total: number
  page: number
  limit: number
}
```

- [ ] **Step 4: Add the service methods**

In `lib/services/file.service.ts`, extend the imports and add two methods to the exported object:

```ts
import type {
  FileMetadata,
  FilesQuery,
  InitiateUploadInput,
  InitiateUploadResult,
  PaginatedFiles,
  PresignedTarget,
} from '@/lib/interfaces/search.interface'
```

```ts
  list(query: FilesQuery): Promise<PaginatedFiles> {
    const params: Record<string, string | number> = {
      page: query.page,
      limit: query.limit,
    }
    if (query.status !== 'ALL') params.status = query.status
    if (query.mimeType) params.mimeType = query.mimeType
    return apiClient.get<PaginatedFiles>('/files', { params }).then((r) => r.data)
  },

  remove(id: string): Promise<void> {
    return apiClient.delete(`/files/${id}`).then(() => undefined)
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/services/__tests__/file.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/interfaces/search.interface.ts lib/services/file.service.ts lib/services/__tests__/file.service.test.ts
git commit -m "feat(file-management): add file list + remove service methods and query types"
```

---

### Task 2: Zustand store

**Files:**
- Create: `lib/state-management/file-management.store.ts`
- Test: `lib/state-management/__tests__/file-management.store.test.ts` (create)

**Interfaces:**
- Consumes: `FileStatusFilter`, `FilesQuery` (Task 1); `Updater` from `@tanstack/react-table`; `useShallow` from `zustand/react/shallow`.
- Produces:
  - `useFileManagementStore` (Zustand hook with `.getState()`)
  - State fields: `status`, `mimeType?`, `page`, `limit`, `nameFilter`, `selection`, `columnVisibility`, `uploadOpen`, `detailId`, `deleteTarget`, `watchUntil`.
  - Actions: `setStatus(s)`, `setMimeType(m?)`, `setPage(n)`, `setLimit(n)`, `setNameFilter(q)`, `setSelection(updater)`, `clearSelection()`, `setColumnVisibility(updater)`, `openUpload()`, `closeUpload()`, `openDetail(id)`, `closeDetail()`, `requestDelete(ids)`, `cancelDelete()`, `startWatch()`.
  - Selectors: `useFileQuery(): FilesQuery` (shallow, server-bound fields only — excludes `nameFilter`), `useFileStatus()`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/state-management/__tests__/file-management.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'

const reset = () =>
  useFileManagementStore.setState({
    status: 'ALL', mimeType: undefined, page: 1, limit: 20, nameFilter: '',
    selection: {}, columnVisibility: {}, uploadOpen: false, detailId: null,
    deleteTarget: null, watchUntil: 0,
  })

beforeEach(reset)

describe('file-management store', () => {
  it('setStatus resets page and selection', () => {
    useFileManagementStore.setState({ page: 5, selection: { a: true } })
    useFileManagementStore.getState().setStatus('QUARANTINED')
    const s = useFileManagementStore.getState()
    expect(s.status).toBe('QUARANTINED')
    expect(s.page).toBe(1)
    expect(s.selection).toEqual({})
  })

  it('setMimeType resets page', () => {
    useFileManagementStore.setState({ page: 3 })
    useFileManagementStore.getState().setMimeType('application/pdf')
    expect(useFileManagementStore.getState().page).toBe(1)
    expect(useFileManagementStore.getState().mimeType).toBe('application/pdf')
  })

  it('setSelection accepts a functional updater', () => {
    useFileManagementStore.getState().setSelection(() => ({ x: true }))
    expect(useFileManagementStore.getState().selection).toEqual({ x: true })
  })

  it('requestDelete/cancelDelete toggle the target', () => {
    useFileManagementStore.getState().requestDelete(['a', 'b'])
    expect(useFileManagementStore.getState().deleteTarget).toEqual(['a', 'b'])
    useFileManagementStore.getState().cancelDelete()
    expect(useFileManagementStore.getState().deleteTarget).toBeNull()
  })

  it('startWatch sets watchUntil into the future', () => {
    const before = Date.now()
    useFileManagementStore.getState().startWatch()
    expect(useFileManagementStore.getState().watchUntil).toBeGreaterThanOrEqual(before + 19_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/state-management/__tests__/file-management.store.test.ts`
Expected: FAIL — cannot resolve `@/lib/state-management/file-management.store`.

- [ ] **Step 3: Write the store**

```ts
// lib/state-management/file-management.store.ts
'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type { Updater } from '@tanstack/react-table'
import type { FileStatusFilter, FilesQuery } from '@/lib/interfaces/search.interface'

const DEFAULT_LIMIT = 20
const WATCH_MS = 20_000

type RowSelection = Record<string, boolean>
type ColumnVisibility = Record<string, boolean>

interface FileManagementState {
  status: FileStatusFilter
  mimeType?: string
  page: number
  limit: number
  nameFilter: string
  setStatus: (status: FileStatusFilter) => void
  setMimeType: (mimeType: string | undefined) => void
  setPage: (page: number) => void
  setLimit: (limit: number) => void
  setNameFilter: (nameFilter: string) => void

  selection: RowSelection
  setSelection: (updater: Updater<RowSelection>) => void
  clearSelection: () => void

  columnVisibility: ColumnVisibility
  setColumnVisibility: (updater: Updater<ColumnVisibility>) => void

  uploadOpen: boolean
  detailId: string | null
  deleteTarget: string[] | null
  watchUntil: number
  openUpload: () => void
  closeUpload: () => void
  openDetail: (id: string) => void
  closeDetail: () => void
  requestDelete: (ids: string[]) => void
  cancelDelete: () => void
  startWatch: () => void
}

function applyUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater
}

const creator: StateCreator<
  FileManagementState,
  [['zustand/devtools', never]],
  [],
  FileManagementState
> = (set) => ({
  status: 'ALL',
  mimeType: undefined,
  page: 1,
  limit: DEFAULT_LIMIT,
  nameFilter: '',
  setStatus: (status) => set({ status, page: 1, selection: {} }, false, 'fm/setStatus'),
  setMimeType: (mimeType) => set({ mimeType, page: 1 }, false, 'fm/setMimeType'),
  setPage: (page) => set({ page }, false, 'fm/setPage'),
  setLimit: (limit) => set({ limit, page: 1 }, false, 'fm/setLimit'),
  setNameFilter: (nameFilter) => set({ nameFilter }, false, 'fm/setNameFilter'),

  selection: {},
  setSelection: (updater) =>
    set((s) => ({ selection: applyUpdater(updater, s.selection) }), false, 'fm/setSelection'),
  clearSelection: () => set({ selection: {} }, false, 'fm/clearSelection'),

  columnVisibility: {},
  setColumnVisibility: (updater) =>
    set((s) => ({ columnVisibility: applyUpdater(updater, s.columnVisibility) }), false, 'fm/setColumnVisibility'),

  uploadOpen: false,
  detailId: null,
  deleteTarget: null,
  watchUntil: 0,
  openUpload: () => set({ uploadOpen: true }, false, 'fm/openUpload'),
  closeUpload: () => set({ uploadOpen: false }, false, 'fm/closeUpload'),
  openDetail: (id) => set({ detailId: id }, false, 'fm/openDetail'),
  closeDetail: () => set({ detailId: null }, false, 'fm/closeDetail'),
  requestDelete: (ids) => set({ deleteTarget: ids }, false, 'fm/requestDelete'),
  cancelDelete: () => set({ deleteTarget: null }, false, 'fm/cancelDelete'),
  startWatch: () => set({ watchUntil: Date.now() + WATCH_MS }, false, 'fm/startWatch'),
})

export const useFileManagementStore = create<FileManagementState>()(
  devtools(creator, { name: 'FileManagementStore', enabled: process.env.NODE_ENV === 'development' }),
)

// ── selectors ──────────────────────────────────────────────────────
export const useFileStatus = () => useFileManagementStore((s) => s.status)
export const useFileQuery = (): FilesQuery =>
  useFileManagementStore(
    useShallow((s) => ({ status: s.status, mimeType: s.mimeType, page: s.page, limit: s.limit })),
  )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/state-management/__tests__/file-management.store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/state-management/file-management.store.ts lib/state-management/__tests__/file-management.store.test.ts
git commit -m "feat(file-management): add zustand store (query, selection, overlays, watch window)"
```

---

### Task 3: Enhance `use-file-upload` (SHA-256 + dedup + error isolation)

**Files:**
- Modify: `lib/hooks/use-file-upload.ts` (full rewrite)
- Test: `lib/hooks/__tests__/use-file-upload.test.tsx` (exists — rewrite)

**Interfaces:**
- Consumes: `fileService.initiate/uploadToPolicy/complete` (existing).
- Produces:
  - `type UploadStatus = 'pending' | 'hashing' | 'uploading' | 'deduplicated' | 'done' | 'error'`
  - `interface UploadItem { file: File; status: UploadStatus; fileId?: string; error?: string }`
  - `useFileUpload(): { items: UploadItem[]; uploadAll: (files: File[], metadata?: Record<string, unknown>) => Promise<string[]>; reset: () => void }`
  - `uploadAll` uploads each file independently (one failure never aborts siblings) and resolves to the ids that succeeded.

- [ ] **Step 1: Write the failing test**

```tsx
// lib/hooks/__tests__/use-file-upload.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const initiate = vi.fn()
const uploadToPolicy = vi.fn()
const complete = vi.fn()
vi.mock('@/lib/services/file.service', () => ({
  fileService: {
    initiate: (...a: unknown[]) => initiate(...a),
    uploadToPolicy: (...a: unknown[]) => uploadToPolicy(...a),
    complete: (...a: unknown[]) => complete(...a),
  },
}))

import { useFileUpload } from '@/lib/hooks/use-file-upload'

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new Uint8Array([0xab, 0xcd]).buffer)
})

describe('useFileUpload', () => {
  it('hashes, initiates with sha256, uploads, completes, and marks done', async () => {
    initiate.mockResolvedValue({ fileId: 'f1', deduplicated: false, upload: { url: 'http://x', fields: {}, expiresIn: 60 } })
    uploadToPolicy.mockResolvedValue(undefined)
    complete.mockResolvedValue({ id: 'f1' })
    const { result } = renderHook(() => useFileUpload())

    let ids: string[] = []
    await act(async () => { ids = await result.current.uploadAll([file('a.pdf')]) })

    expect(initiate).toHaveBeenCalledWith(expect.objectContaining({ filename: 'a.pdf', sha256: 'abcd' }))
    expect(uploadToPolicy).toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith('f1', 'abcd')
    expect(ids).toEqual(['f1'])
    expect(result.current.items[0].status).toBe('done')
  })

  it('marks deduplicated files without uploading', async () => {
    initiate.mockResolvedValue({ fileId: 'dup', deduplicated: true })
    const { result } = renderHook(() => useFileUpload())
    await act(async () => { await result.current.uploadAll([file('d.pdf')]) })
    expect(uploadToPolicy).not.toHaveBeenCalled()
    expect(result.current.items[0].status).toBe('deduplicated')
  })

  it('isolates failures — one bad file does not abort the others', async () => {
    initiate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ fileId: 'ok', deduplicated: true })
    const { result } = renderHook(() => useFileUpload())
    let ids: string[] = []
    await act(async () => { ids = await result.current.uploadAll([file('bad.pdf'), file('good.pdf')]) })
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(ids).toEqual(['ok'])
    expect(result.current.items.find((i) => i.file.name === 'bad.pdf')?.status).toBe('error')
    expect(result.current.items.find((i) => i.file.name === 'good.pdf')?.status).toBe('deduplicated')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/hooks/__tests__/use-file-upload.test.tsx`
Expected: FAIL — `complete` called without sha256 / no `hashing` status / failure aborts siblings.

- [ ] **Step 3: Rewrite the hook**

```ts
// lib/hooks/use-file-upload.ts
'use client'
import { useCallback, useState } from 'react'
import { fileService } from '@/lib/services/file.service'

export type UploadStatus = 'pending' | 'hashing' | 'uploading' | 'deduplicated' | 'done' | 'error'

export interface UploadItem {
  file: File
  status: UploadStatus
  fileId?: string
  error?: string
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function useFileUpload() {
  const [items, setItems] = useState<UploadItem[]>([])

  const patch = (file: File, p: Partial<UploadItem>) =>
    setItems((prev) => prev.map((it) => (it.file === file ? { ...it, ...p } : it)))

  const uploadOne = useCallback(
    async (file: File, metadata?: Record<string, unknown>): Promise<string | null> => {
      try {
        patch(file, { status: 'hashing' })
        const sha256 = await sha256Hex(file)
        patch(file, { status: 'uploading' })
        const init = await fileService.initiate({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          sha256,
          metadata,
        })
        if (init.deduplicated) {
          patch(file, { status: 'deduplicated', fileId: init.fileId })
          return init.fileId
        }
        if (init.upload) {
          await fileService.uploadToPolicy(init.upload, file)
          await fileService.complete(init.fileId, sha256)
        }
        patch(file, { status: 'done', fileId: init.fileId })
        return init.fileId
      } catch (err) {
        patch(file, { status: 'error', error: err instanceof Error ? err.message : 'Upload failed' })
        return null
      }
    },
    [],
  )

  const uploadAll = useCallback(
    async (files: File[], metadata?: Record<string, unknown>): Promise<string[]> => {
      setItems((prev) => [...prev, ...files.map((file) => ({ file, status: 'pending' as const }))])
      const results = await Promise.all(files.map((file) => uploadOne(file, metadata)))
      return results.filter((id): id is string => id !== null)
    },
    [uploadOne],
  )

  const reset = useCallback(() => setItems([]), [])
  return { items, uploadAll, reset }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/hooks/__tests__/use-file-upload.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/use-file-upload.ts lib/hooks/__tests__/use-file-upload.test.tsx
git commit -m "feat(file-management): client SHA-256 hashing, dedup path, per-file error isolation"
```

---

### Task 4: `use-files` list hook (+ `computeRefreshInterval`) and `use-file-detail`

**Files:**
- Create: `lib/hooks/use-files.ts`
- Create: `lib/hooks/use-file-detail.ts`
- Test: `lib/hooks/__tests__/use-files.test.ts` (create)

**Interfaces:**
- Consumes: `fileService.list/get` (Tasks 1 + existing), `useFileQuery` + `useFileManagementStore` (Task 2), `FileMetadata`/`PaginatedFiles` types.
- Produces:
  - `computeRefreshInterval(items: FileMetadata[] | undefined, watchUntil: number, now: number): number` — returns `4000` while any item is `PENDING` or `now < watchUntil`, else `0`.
  - `useFiles(): { data?: PaginatedFiles; isLoading: boolean; isValidating: boolean; error: unknown; mutate: () => void }`
  - `useFileDetail(id: string | null): { file?: FileMetadata; isLoading: boolean; error: unknown; mutate: () => void }`

- [ ] **Step 1: Write the failing test**

```ts
// lib/hooks/__tests__/use-files.test.ts
import { describe, it, expect } from 'vitest'
import { computeRefreshInterval } from '@/lib/hooks/use-files'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

const f = (status: string): FileMetadata => ({
  id: 'x', ownerId: null, filename: 'a', mimeType: 'text/plain', size: 1,
  checksumSha256: null, status, metadata: {}, createdAt: '', updatedAt: '',
})

describe('computeRefreshInterval', () => {
  it('polls while a file is PENDING', () => {
    expect(computeRefreshInterval([f('PENDING')], 0, 1000)).toBe(4000)
  })
  it('polls while inside the watch window even if all AVAILABLE', () => {
    expect(computeRefreshInterval([f('AVAILABLE')], 5000, 1000)).toBe(4000)
  })
  it('stops when stable and past the watch window', () => {
    expect(computeRefreshInterval([f('AVAILABLE')], 500, 1000)).toBe(0)
  })
  it('stops with no data and no watch', () => {
    expect(computeRefreshInterval(undefined, 0, 1000)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/hooks/__tests__/use-files.test.ts`
Expected: FAIL — cannot resolve `@/lib/hooks/use-files`.

- [ ] **Step 3: Write `use-files.ts`**

```ts
// lib/hooks/use-files.ts
'use client'
import useSWR from 'swr'
import { fileService } from '@/lib/services/file.service'
import { useFileQuery, useFileManagementStore } from '@/lib/state-management/file-management.store'
import type { FileMetadata, PaginatedFiles } from '@/lib/interfaces/search.interface'

const POLL_MS = 4000

/** Poll while a file is still settling (any PENDING row, or inside the post-upload watch window). */
export function computeRefreshInterval(
  items: FileMetadata[] | undefined,
  watchUntil: number,
  now: number,
): number {
  const settling = (items?.some((f) => f.status === 'PENDING') ?? false) || now < watchUntil
  return settling ? POLL_MS : 0
}

export function useFiles() {
  const query = useFileQuery()
  const { data, isLoading, isValidating, error, mutate } = useSWR<PaginatedFiles>(
    ['files', query],
    () => fileService.list(query),
    {
      keepPreviousData: true,
      refreshInterval: (latest) =>
        computeRefreshInterval(latest?.items, useFileManagementStore.getState().watchUntil, Date.now()),
    },
  )
  return { data, isLoading, isValidating, error, mutate }
}
```

- [ ] **Step 4: Write `use-file-detail.ts`**

```ts
// lib/hooks/use-file-detail.ts
'use client'
import useSWR from 'swr'
import { fileService } from '@/lib/services/file.service'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

export function useFileDetail(id: string | null) {
  const { data, isLoading, error, mutate } = useSWR<FileMetadata>(
    id ? ['file', id] : null,
    () => fileService.get(id as string),
  )
  return { file: data, isLoading, error, mutate }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/hooks/__tests__/use-files.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/use-files.ts lib/hooks/use-file-detail.ts lib/hooks/__tests__/use-files.test.ts
git commit -m "feat(file-management): useFiles list hook with smart poll + useFileDetail"
```

---

### Task 5: `use-file-mutations` (bulk delete, partial-failure aware)

**Files:**
- Create: `lib/hooks/use-file-mutations.ts`
- Test: `lib/hooks/__tests__/use-file-mutations.test.tsx` (create)

**Interfaces:**
- Consumes: `fileService.remove` (Task 1), `useSWRConfig` (SWR global mutate).
- Produces: `useFileMutations(): { remove: (ids: string[]) => Promise<{ ok: number; failed: number }> }` — deletes each id independently and revalidates every `['files', …]` SWR key afterward.

- [ ] **Step 1: Write the failing test**

```tsx
// lib/hooks/__tests__/use-file-mutations.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const remove = vi.fn()
vi.mock('@/lib/services/file.service', () => ({ fileService: { remove: (...a: unknown[]) => remove(...a) } }))
const mutate = vi.fn()
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate }) }))

import { useFileMutations } from '@/lib/hooks/use-file-mutations'

beforeEach(() => vi.clearAllMocks())

describe('useFileMutations.remove', () => {
  it('reports partial failures and still revalidates', async () => {
    remove.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useFileMutations())
    let res = { ok: 0, failed: 0 }
    await act(async () => { res = await result.current.remove(['a', 'b', 'c']) })
    expect(res).toEqual({ ok: 2, failed: 1 })
    expect(mutate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/hooks/__tests__/use-file-mutations.test.tsx`
Expected: FAIL — cannot resolve `@/lib/hooks/use-file-mutations`.

- [ ] **Step 3: Write the hook**

```ts
// lib/hooks/use-file-mutations.ts
'use client'
import { useCallback } from 'react'
import { useSWRConfig } from 'swr'
import { fileService } from '@/lib/services/file.service'

export function useFileMutations() {
  const { mutate } = useSWRConfig()

  const remove = useCallback(
    async (ids: string[]): Promise<{ ok: number; failed: number }> => {
      const results = await Promise.allSettled(ids.map((id) => fileService.remove(id)))
      const ok = results.filter((r) => r.status === 'fulfilled').length
      await mutate((key) => Array.isArray(key) && key[0] === 'files')
      return { ok, failed: results.length - ok }
    },
    [mutate],
  )

  return { remove }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/hooks/__tests__/use-file-mutations.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/use-file-mutations.ts lib/hooks/__tests__/use-file-mutations.test.tsx
git commit -m "feat(file-management): bulk delete hook with partial-failure reporting"
```

---

### Task 6: `file-format.ts` presentation helpers

**Files:**
- Create: `app/dashboard/file-management/components/file-format.ts`
- Test: `app/dashboard/file-management/components/__tests__/file-format.test.ts` (create)

**Interfaces:**
- Consumes: `@hugeicons/core-free-icons` (`File01Icon`, `Image01Icon`, `FileZipIcon`, `Archive02Icon`), its `IconSvgObject` type.
- Produces:
  - `formatBytes(bytes: number): string`
  - `formatDateTime(iso: string): string`
  - `mimeLabel(mime: string): string`
  - `mimeIconFor(mime: string): IconSvgObject`
  - `quarantineReason(metadata: Record<string, unknown>): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// app/dashboard/file-management/components/__tests__/file-format.test.ts
import { describe, it, expect } from 'vitest'
import { formatBytes, mimeLabel, quarantineReason } from '@/app/dashboard/file-management/components/file-format'

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
  })
})

describe('mimeLabel', () => {
  it('shortens common types and falls back to subtype', () => {
    expect(mimeLabel('application/pdf')).toBe('PDF')
    expect(mimeLabel('image/png')).toBe('PNG')
    expect(mimeLabel('application/vnd.custom+json')).toBe('vnd.custom+json')
  })
})

describe('quarantineReason', () => {
  it('reads a string reason or returns null', () => {
    expect(quarantineReason({ quarantineReason: 'mime-mismatch' })).toBe('mime-mismatch')
    expect(quarantineReason({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-format.test.ts`
Expected: FAIL — cannot resolve `file-format`.

- [ ] **Step 3: Write the helpers**

```ts
// app/dashboard/file-management/components/file-format.ts
import {
  Archive02Icon, File01Icon, FileZipIcon, Image01Icon,
} from '@hugeicons/core-free-icons'
import type { IconSvgObject } from '@hugeicons/react'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`
}

export function formatDateTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'application/zip': 'ZIP',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'application/json': 'JSON',
}

export function mimeLabel(mime: string): string {
  if (MIME_LABELS[mime]) return MIME_LABELS[mime]
  const sub = mime.split('/')[1]
  return sub ? sub : mime
}

export function mimeIconFor(mime: string): IconSvgObject {
  if (mime.startsWith('image/')) return Image01Icon
  if (mime === 'application/zip' || mime.includes('zip')) return FileZipIcon
  if (mime.includes('tar') || mime.includes('compressed')) return Archive02Icon
  return File01Icon
}

export function quarantineReason(metadata: Record<string, unknown>): string | null {
  const reason = metadata?.quarantineReason
  return typeof reason === 'string' ? reason : null
}
```

> Note: `IconSvgObject` is re-exported by `@hugeicons/react`. If TypeScript cannot find it there, import the icons untyped and type the return as `typeof File01Icon`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-format.test.ts`
Expected: PASS (3 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-format.ts app/dashboard/file-management/components/__tests__/file-format.test.ts
git commit -m "feat(file-management): presentation helpers (bytes, datetime, mime label/icon, quarantine reason)"
```

---

### Task 7: `file-status-badge.tsx`

**Files:**
- Create: `app/dashboard/file-management/components/file-status-badge.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-status-badge.test.tsx` (create)

**Interfaces:**
- Consumes: `@/components/ui/badge`, `@/components/ui/tooltip`, `HugeiconsIcon` + `Alert02Icon`/`CheckmarkCircle02Icon`/`InformationCircleIcon`.
- Produces: `FileStatusBadge({ status, reason }: { status: string; reason?: string | null })`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-status-badge.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileStatusBadge } from '@/app/dashboard/file-management/components/file-status-badge'

describe('FileStatusBadge', () => {
  it('renders the humanized status label', () => {
    render(<FileStatusBadge status="AVAILABLE" />)
    expect(screen.getByText('Available')).toBeInTheDocument()
  })
  it('renders quarantined with the reason in the title', () => {
    render(<FileStatusBadge status="QUARANTINED" reason="mime-mismatch" />)
    expect(screen.getByText('Quarantined')).toBeInTheDocument()
    expect(screen.getByText('Quarantined').closest('[title]')).toHaveAttribute('title', expect.stringContaining('mime-mismatch'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-status-badge.test.tsx`
Expected: FAIL — cannot resolve `file-status-badge`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-status-badge.tsx
'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, CheckmarkCircle02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { Badge } from '@/components/ui/badge'

type Variant = 'default' | 'secondary' | 'destructive' | 'outline'

const CONFIG: Record<string, { label: string; variant: Variant; icon: typeof Alert02Icon }> = {
  AVAILABLE: { label: 'Available', variant: 'secondary', icon: CheckmarkCircle02Icon },
  PENDING: { label: 'Pending', variant: 'outline', icon: InformationCircleIcon },
  QUARANTINED: { label: 'Quarantined', variant: 'destructive', icon: Alert02Icon },
}

export function FileStatusBadge({ status, reason }: { status: string; reason?: string | null }) {
  const cfg = CONFIG[status] ?? { label: status, variant: 'outline' as Variant, icon: InformationCircleIcon }
  const title = status === 'QUARANTINED' && reason ? `Quarantined — ${reason}` : cfg.label
  return (
    <Badge variant={cfg.variant} title={title} className="gap-1">
      <HugeiconsIcon icon={cfg.icon} strokeWidth={2} className="size-3.5" />
      {cfg.label}
    </Badge>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-status-badge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-status-badge.tsx app/dashboard/file-management/components/__tests__/file-status-badge.test.tsx
git commit -m "feat(file-management): status badge with quarantine reason tooltip"
```

---

### Task 8: `file-columns.tsx` (data columns)

**Files:**
- Create: `app/dashboard/file-management/components/file-columns.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-columns.test.tsx` (create)

**Interfaces:**
- Consumes: `ColumnDef` (`@tanstack/react-table`), `FileMetadata`, `file-format` helpers (Task 6), `FileStatusBadge` (Task 7), `HugeiconsIcon`.
- Produces: `buildFileColumns(): ColumnDef<FileMetadata>[]` — columns with ids `name`, `type`, `size`, `status`, `created` (no select/actions; the table adds those).

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-columns.test.tsx
import { describe, it, expect } from 'vitest'
import { buildFileColumns } from '@/app/dashboard/file-management/components/file-columns'

describe('buildFileColumns', () => {
  it('produces the expected column ids in order', () => {
    const ids = buildFileColumns().map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey)
    expect(ids).toEqual(['name', 'type', 'size', 'status', 'created'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-columns.test.tsx`
Expected: FAIL — cannot resolve `file-columns`.

- [ ] **Step 3: Write the columns**

```tsx
// app/dashboard/file-management/components/file-columns.tsx
'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import type { FileMetadata } from '@/lib/interfaces/search.interface'
import { FileStatusBadge } from './file-status-badge'
import { formatBytes, formatDateTime, mimeIconFor, mimeLabel, quarantineReason } from './file-format'

export function buildFileColumns(): ColumnDef<FileMetadata>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex items-center gap-2 font-medium">
          <HugeiconsIcon
            icon={mimeIconFor(row.original.mimeType)}
            strokeWidth={2}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="truncate max-w-[22rem]">{row.original.filename}</span>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => <span className="text-muted-foreground">{mimeLabel(row.original.mimeType)}</span>,
    },
    {
      id: 'size',
      header: 'Size',
      cell: ({ row }) => <span className="tabular-nums">{formatBytes(row.original.size)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <FileStatusBadge status={row.original.status} reason={quarantineReason(row.original.metadata)} />
      ),
    },
    {
      id: 'created',
      header: 'Uploaded',
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>
      ),
    },
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-columns.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-columns.tsx app/dashboard/file-management/components/__tests__/file-columns.test.tsx
git commit -m "feat(file-management): data-table column definitions"
```

---

### Task 9: `file-row-actions.tsx`

**Files:**
- Create: `app/dashboard/file-management/components/file-row-actions.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-row-actions.test.tsx` (create)

**Interfaces:**
- Consumes: `FileMetadata`, `useFileManagementStore` (Task 2), `fileService.downloadUrl` (existing), `sonner` toast, shadcn `DropdownMenu`, `Button`, `HugeiconsIcon` (`MoreVerticalCircle01Icon`, `Download01Icon`, `Link01Icon`, `InformationCircleIcon`, `Delete02Icon`).
- Produces: `FileRowActions({ file }: { file: FileMetadata })`. Download + Copy link are disabled unless `file.status === 'AVAILABLE'`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-row-actions.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const openDetail = vi.fn()
const requestDelete = vi.fn()
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ openDetail, requestDelete }),
}))
vi.mock('@/lib/services/file.service', () => ({ fileService: { downloadUrl: vi.fn() } }))

import { FileRowActions } from '@/app/dashboard/file-management/components/file-row-actions'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

const meta = (over: Partial<FileMetadata> = {}): FileMetadata => ({
  id: 'f1', ownerId: null, filename: 'a.pdf', mimeType: 'application/pdf', size: 1,
  checksumSha256: null, status: 'AVAILABLE', metadata: {}, createdAt: '', updatedAt: '', ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('FileRowActions', () => {
  it('opens details from the menu', async () => {
    render(<FileRowActions file={meta()} />)
    await userEvent.click(screen.getByRole('button', { name: /open menu/i }))
    await userEvent.click(screen.getByText('Details'))
    expect(openDetail).toHaveBeenCalledWith('f1')
  })

  it('disables Download for a non-available file', async () => {
    render(<FileRowActions file={meta({ status: 'PENDING' })} />)
    await userEvent.click(screen.getByRole('button', { name: /open menu/i }))
    expect(screen.getByText('Download').closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'true')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-row-actions.test.tsx`
Expected: FAIL — cannot resolve `file-row-actions`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-row-actions.tsx
'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  MoreVerticalCircle01Icon, Download01Icon, Link01Icon, InformationCircleIcon, Delete02Icon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { fileService } from '@/lib/services/file.service'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

export function FileRowActions({ file }: { file: FileMetadata }) {
  const openDetail = useFileManagementStore((s) => s.openDetail)
  const requestDelete = useFileManagementStore((s) => s.requestDelete)
  const available = file.status === 'AVAILABLE'

  const download = async () => {
    try {
      const url = await fileService.downloadUrl(file.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not get a download link')
    }
  }

  const copyLink = async () => {
    try {
      const url = await fileService.downloadUrl(file.id)
      await navigator.clipboard.writeText(url)
      toast.success('Download link copied')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not copy the link')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
          <HugeiconsIcon icon={MoreVerticalCircle01Icon} strokeWidth={2} />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem disabled={!available} onClick={() => void download()}>
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} /> Download
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!available} onClick={() => void copyLink()}>
          <HugeiconsIcon icon={Link01Icon} strokeWidth={2} /> Copy link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openDetail(file.id)}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} /> Details
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => requestDelete([file.id])}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-row-actions.test.tsx`
Expected: PASS (2 tests).

> If the `aria-disabled` assertion is brittle across the shadcn dropdown version, assert the menu item has the `data-disabled` attribute instead — inspect the rendered DOM once and pick the attribute actually emitted.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-row-actions.tsx app/dashboard/file-management/components/__tests__/file-row-actions.test.tsx
git commit -m "feat(file-management): per-row actions (download, copy link, details, delete)"
```

---

### Task 10: `file-pagination.tsx`

**Files:**
- Create: `app/dashboard/file-management/components/file-pagination.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-pagination.test.tsx` (create)

**Interfaces:**
- Consumes: `Table` (`@tanstack/react-table`), shadcn `Button`/`Label`/`Select`, `HugeiconsIcon` (`ArrowLeftDoubleIcon`, `ArrowLeft01Icon`, `ArrowRight01Icon`, `ArrowRightDoubleIcon`).
- Produces: `FilePagination<TData>({ table, isLoading?, pageSizeOptions? }: { table: Table<TData>; isLoading?: boolean; pageSizeOptions?: number[] })` — a local copy of the shared `data-table.tsx` pagination footer (kept local per the component-location requirement).

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-pagination.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Table } from '@tanstack/react-table'
import { FilePagination } from '@/app/dashboard/file-management/components/file-pagination'

const fakeTable = () =>
  ({
    getState: () => ({ pagination: { pageIndex: 1, pageSize: 20 } }),
    getPageCount: () => 3,
    getFilteredSelectedRowModel: () => ({ rows: [] }),
    getFilteredRowModel: () => ({ rows: [{}, {}] }),
    getCanPreviousPage: () => true,
    getCanNextPage: () => true,
    setPageIndex: vi.fn(), previousPage: vi.fn(), nextPage: vi.fn(), setPageSize: vi.fn(),
  }) as unknown as Table<unknown>

describe('FilePagination', () => {
  it('shows the current page position', () => {
    render(<FilePagination table={fakeTable()} />)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-pagination.test.tsx`
Expected: FAIL — cannot resolve `file-pagination`.

- [ ] **Step 3: Write the component**

Copy the structure from `app/dashboard/data-management/components/data-table-pagination.tsx` (read it for reference), renaming the export to `FilePagination`:

```tsx
// app/dashboard/file-management/components/file-pagination.tsx
'use client'

import type { Table } from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeftDoubleIcon, ArrowLeft01Icon, ArrowRight01Icon, ArrowRightDoubleIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const DEFAULT_PAGE_SIZES = [10, 20, 30, 50]

/** Pagination footer based on `components/data-table.tsx`, kept local to the file-management feature. */
export function FilePagination<TData>({
  table,
  isLoading = false,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
}: {
  table: Table<TData>
  isLoading?: boolean
  pageSizeOptions?: number[]
}) {
  return (
    <div className="flex items-center justify-between px-4">
      <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
        {table.getFilteredSelectedRowModel().rows.length} of{' '}
        {table.getFilteredRowModel().rows.length} row(s) selected.
      </div>
      <div className="flex w-full items-center gap-8 lg:w-fit">
        <div className="hidden items-center gap-2 lg:flex">
          <Label htmlFor="file-rows-per-page" className="text-sm font-medium">Rows per page</Label>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger size="sm" className="w-20" id="file-rows-per-page">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              <SelectGroup>
                {pageSizeOptions.map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-fit items-center justify-center text-sm font-medium">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
        </div>
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage() || isLoading}>
            <span className="sr-only">Go to first page</span>
            <HugeiconsIcon icon={ArrowLeftDoubleIcon} strokeWidth={2} />
          </Button>
          <Button variant="outline" className="size-8" size="icon"
            onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage() || isLoading}>
            <span className="sr-only">Go to previous page</span>
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <Button variant="outline" className="size-8" size="icon"
            onClick={() => table.nextPage()} disabled={!table.getCanNextPage() || isLoading}>
            <span className="sr-only">Go to next page</span>
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
          </Button>
          <Button variant="outline" className="hidden size-8 lg:flex" size="icon"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage() || isLoading}>
            <span className="sr-only">Go to last page</span>
            <HugeiconsIcon icon={ArrowRightDoubleIcon} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-pagination.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-pagination.tsx app/dashboard/file-management/components/__tests__/file-pagination.test.tsx
git commit -m "feat(file-management): local pagination footer based on data-table.tsx"
```

---

### Task 11: `file-data-table.tsx`

**Files:**
- Create: `app/dashboard/file-management/components/file-data-table.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-data-table.test.tsx` (create)

**Interfaces:**
- Consumes: `useReactTable`/`flexRender`/`getCoreRowModel`/`ColumnDef` (`@tanstack/react-table`), `buildFileColumns` (Task 8), `FileRowActions` (Task 9), `FilePagination` (Task 10), `useFileManagementStore` (Task 2), shadcn `Table`/`Checkbox`/`Skeleton`/`Empty`/`Button`/`DropdownMenu`, `FileMetadata`.
- Produces: `FileDataTable({ items, pageCount, totalItems, isLoading, error, onRetry }: { items: FileMetadata[]; pageCount: number; totalItems: number; isLoading: boolean; error?: unknown; onRetry: () => void })`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-data-table.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/state-management/file-management.store', async (orig) => {
  const actual = await orig<typeof import('@/lib/state-management/file-management.store')>()
  return actual
})
vi.mock('@/app/dashboard/file-management/components/file-row-actions', () => ({
  FileRowActions: () => <span>actions</span>,
}))

import { FileDataTable } from '@/app/dashboard/file-management/components/file-data-table'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

const row = (over: Partial<FileMetadata> = {}): FileMetadata => ({
  id: 'f1', ownerId: null, filename: 'report.pdf', mimeType: 'application/pdf', size: 2100000,
  checksumSha256: null, status: 'AVAILABLE', metadata: {}, createdAt: '2026-07-20T10:00:00Z', updatedAt: '', ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('FileDataTable', () => {
  it('renders a row from data', () => {
    render(<FileDataTable items={[row()]} pageCount={1} totalItems={1} isLoading={false} onRetry={vi.fn()} />)
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('1 file(s)')).toBeInTheDocument()
  })
  it('renders an empty state', () => {
    render(<FileDataTable items={[]} pageCount={0} totalItems={0} isLoading={false} onRetry={vi.fn()} />)
    expect(screen.getByText('No files')).toBeInTheDocument()
  })
  it('renders an error state with retry', () => {
    render(<FileDataTable items={[]} pageCount={0} totalItems={0} isLoading={false} error={new Error('x')} onRetry={vi.fn()} />)
    expect(screen.getByText('Could not load files')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-data-table.test.tsx`
Expected: FAIL — cannot resolve `file-data-table`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-data-table.tsx
'use client'

import * as React from 'react'
import {
  flexRender, getCoreRowModel, useReactTable, type ColumnDef,
} from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import { LeftToRightListBulletIcon, RefreshIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import { buildFileColumns } from './file-columns'
import { FileRowActions } from './file-row-actions'
import { FilePagination } from './file-pagination'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

const PAGE_SIZES = [10, 20, 30, 50]

export function FileDataTable({
  items, pageCount, totalItems, isLoading, error, onRetry,
}: {
  items: FileMetadata[]
  pageCount: number
  totalItems: number
  isLoading: boolean
  error?: unknown
  onRetry: () => void
}) {
  const s = useFileManagementStore()

  const columns = React.useMemo<ColumnDef<FileMetadata>[]>(() => {
    const select: ColumnDef<FileMetadata> = {
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
    const actions: ColumnDef<FileMetadata> = {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => <FileRowActions file={row.original} />,
    }
    return [select, ...buildFileColumns(), actions]
  }, [])

  const table = useReactTable({
    data: items,
    columns,
    state: {
      rowSelection: s.selection,
      columnVisibility: s.columnVisibility,
      pagination: { pageIndex: s.page - 1, pageSize: s.limit },
    },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: s.setSelection,
    onColumnVisibilityChange: s.setColumnVisibility,
    onPaginationChange: (updater) => {
      const prev = { pageIndex: s.page - 1, pageSize: s.limit }
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (next.pageSize !== s.limit) s.setLimit(next.pageSize)
      else if (next.pageIndex !== prev.pageIndex) s.setPage(next.pageIndex + 1)
    },
    manualPagination: true,
    pageCount,
    getCoreRowModel: getCoreRowModel(),
  })

  const visibleColumnCount = table.getVisibleLeafColumns().length
  const selectedCount = Object.keys(s.selection).length

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {selectedCount > 0 ? `${selectedCount} selected` : `${totalItems} file(s)`}
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
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="h-40">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>Could not load files</EmptyTitle>
                      <EmptyDescription>The file service may be unavailable.</EmptyDescription>
                    </EmptyHeader>
                    <Button variant="outline" onClick={onRetry}>
                      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} /> Retry
                    </Button>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : isLoading && items.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {table.getVisibleLeafColumns().map((col) => (
                    <TableCell key={col.id}><Skeleton className="h-5 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((r) => (
                <TableRow key={r.id} data-state={r.getIsSelected() && 'selected'}>
                  {r.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="h-40">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No files</EmptyTitle>
                      <EmptyDescription>Upload a file or adjust your filters.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <FilePagination table={table} isLoading={isLoading} pageSizeOptions={PAGE_SIZES} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-data-table.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-data-table.tsx app/dashboard/file-management/components/__tests__/file-data-table.test.tsx
git commit -m "feat(file-management): TanStack + shadcn data table (adapted from data-table.tsx)"
```

---

### Task 12: `file-status-tabs.tsx` (+ quarantine count)

**Files:**
- Create: `app/dashboard/file-management/components/file-status-tabs.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-status-tabs.test.tsx` (create)

**Interfaces:**
- Consumes: `useFileStatus` + `useFileManagementStore` (Task 2), `fileService.list` (Task 1) via inline SWR for the quarantine count, shadcn `Tabs`/`TabsList`/`TabsTrigger`, `Badge`, `FileStatusFilter`.
- Produces: `FileStatusTabs()` — four tabs (`ALL`, `AVAILABLE`, `PENDING`, `QUARANTINED`) bound to `store.status`; Quarantined shows a count badge when > 0.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-status-tabs.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const setStatus = vi.fn()
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileStatus: () => 'ALL',
  useFileManagementStore: (sel: (s: unknown) => unknown) => sel({ setStatus }),
}))
vi.mock('swr', () => ({ default: () => ({ data: 2 }) }))

import { FileStatusTabs } from '@/app/dashboard/file-management/components/file-status-tabs'

beforeEach(() => vi.clearAllMocks())

describe('FileStatusTabs', () => {
  it('renders all four tabs with the quarantine count', () => {
    render(<FileStatusTabs />)
    expect(screen.getByRole('tab', { name: /all/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /quarantined/i })).toHaveTextContent('2')
  })
  it('switches status on click', async () => {
    render(<FileStatusTabs />)
    await userEvent.click(screen.getByRole('tab', { name: /available/i }))
    expect(setStatus).toHaveBeenCalledWith('AVAILABLE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-status-tabs.test.tsx`
Expected: FAIL — cannot resolve `file-status-tabs`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-status-tabs.tsx
'use client'

import useSWR from 'swr'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { fileService } from '@/lib/services/file.service'
import { useFileStatus, useFileManagementStore } from '@/lib/state-management/file-management.store'
import type { FileStatusFilter } from '@/lib/interfaces/search.interface'

const TABS: { value: FileStatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'QUARANTINED', label: 'Quarantined' },
]

export function FileStatusTabs() {
  const status = useFileStatus()
  const setStatus = useFileManagementStore((s) => s.setStatus)
  const { data: quarantined } = useSWR<number>(
    ['files-count', 'QUARANTINED'],
    () => fileService.list({ status: 'QUARANTINED', page: 1, limit: 1 }).then((r) => r.total),
  )

  return (
    <div className="px-4 lg:px-6">
      <Tabs value={status} onValueChange={(v) => setStatus(v as FileStatusFilter)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
              {t.label}
              {t.value === 'QUARANTINED' && !!quarantined && quarantined > 0 && (
                <Badge variant="destructive" className="h-5 px-1.5">{quarantined}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-status-tabs.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-status-tabs.tsx app/dashboard/file-management/components/__tests__/file-status-tabs.test.tsx
git commit -m "feat(file-management): status tabs with live quarantine count"
```

---

### Task 13: `file-dropzone.tsx`

**Files:**
- Create: `app/dashboard/file-management/components/file-dropzone.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-dropzone.test.tsx` (create)

**Interfaces:**
- Consumes: shadcn `Button`, `HugeiconsIcon` (`Upload01Icon`), `cn` (`@/lib/utils`).
- Produces: `FileDropzone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean })` — click-to-browse (hidden `<input type=file multiple>`) and drag-and-drop; both call `onFiles` with a `File[]`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-dropzone.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileDropzone } from '@/app/dashboard/file-management/components/file-dropzone'

describe('FileDropzone', () => {
  it('emits dropped files', () => {
    const onFiles = vi.fn()
    render(<FileDropzone onFiles={onFiles} />)
    const zone = screen.getByTestId('file-dropzone')
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('emits files chosen via the input', () => {
    const onFiles = vi.fn()
    render(<FileDropzone onFiles={onFiles} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    const file = new File(['x'], 'b.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-dropzone.test.tsx`
Expected: FAIL — cannot resolve `file-dropzone`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-dropzone.tsx
'use client'

import * as React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Upload01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

export function FileDropzone({
  onFiles, disabled = false,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  const emit = (list: FileList | null) => {
    if (!list || list.length === 0) return
    onFiles(Array.from(list))
  }

  return (
    <div
      data-testid="file-dropzone"
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
      }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) emit(e.dataTransfer.files)
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-input',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50',
      )}
    >
      <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} className="size-6 text-muted-foreground" />
      <div className="text-sm font-medium">Drag files here or click to browse</div>
      <div className="text-xs text-muted-foreground">Files are hashed locally before upload</div>
      <input
        ref={inputRef}
        data-testid="file-input"
        type="file"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => { emit(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-dropzone.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-dropzone.tsx app/dashboard/file-management/components/__tests__/file-dropzone.test.tsx
git commit -m "feat(file-management): drag-and-drop dropzone"
```

---

### Task 14: `file-upload-list.tsx`

**Files:**
- Create: `app/dashboard/file-management/components/file-upload-list.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-upload-list.test.tsx` (create)

**Interfaces:**
- Consumes: `UploadItem` (Task 3), `file-format.formatBytes` (Task 6), shadcn `Progress`, `HugeiconsIcon` (`CheckmarkCircle02Icon`, `Alert02Icon`).
- Produces: `FileUploadList({ items }: { items: UploadItem[] })`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-upload-list.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileUploadList } from '@/app/dashboard/file-management/components/file-upload-list'
import type { UploadItem } from '@/lib/hooks/use-file-upload'

const item = (over: Partial<UploadItem>): UploadItem => ({
  file: new File(['x'], 'a.pdf', { type: 'application/pdf' }), status: 'pending', ...over,
})

describe('FileUploadList', () => {
  it('shows each file with its status label', () => {
    render(<FileUploadList items={[item({ status: 'deduplicated' }), item({ status: 'error', error: 'boom' })]} />)
    expect(screen.getByText('Deduplicated')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-upload-list.test.tsx`
Expected: FAIL — cannot resolve `file-upload-list`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-upload-list.tsx
'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon, Alert02Icon } from '@hugeicons/core-free-icons'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from './file-format'
import type { UploadItem, UploadStatus } from '@/lib/hooks/use-file-upload'

const LABELS: Record<UploadStatus, string> = {
  pending: 'Waiting…',
  hashing: 'Hashing…',
  uploading: 'Uploading…',
  deduplicated: 'Deduplicated',
  done: 'Uploaded',
  error: 'Failed',
}

const INDETERMINATE: UploadStatus[] = ['hashing', 'uploading']

export function FileUploadList({ items }: { items: UploadItem[] }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={`${it.file.name}-${i}`} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate font-medium">{it.file.name}</span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {it.status === 'done' || it.status === 'deduplicated' ? (
                <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5 text-emerald-600" />
              ) : it.status === 'error' ? (
                <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3.5 text-destructive" />
              ) : null}
              {LABELS[it.status]}
            </span>
          </div>
          {INDETERMINATE.includes(it.status) ? (
            <Progress className="h-1.5" />
          ) : (
            <div className="text-xs text-muted-foreground">
              {it.status === 'error' ? it.error : formatBytes(it.file.size)}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-upload-list.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-upload-list.tsx app/dashboard/file-management/components/__tests__/file-upload-list.test.tsx
git commit -m "feat(file-management): upload queue list with per-file status"
```

---

### Task 15: `file-upload-dialog.tsx`

**Files:**
- Create: `app/dashboard/file-management/components/file-upload-dialog.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-upload-dialog.test.tsx` (create)

**Interfaces:**
- Consumes: `useFileManagementStore` (Task 2), `useFileUpload` (Task 3), `useSWRConfig` (SWR), `FileDropzone` (Task 13), `FileUploadList` (Task 14), shadcn `Dialog`.
- Produces: `FileUploadDialog()` — reads `store.uploadOpen`; on files chosen, runs `uploadAll`, then revalidates `['files', …]` and calls `store.startWatch()`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-upload-dialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const startWatch = vi.fn()
const closeUpload = vi.fn()
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ uploadOpen: true, closeUpload, startWatch }),
}))
const uploadAll = vi.fn().mockResolvedValue(['f1'])
vi.mock('@/lib/hooks/use-file-upload', () => ({
  useFileUpload: () => ({ items: [], uploadAll, reset: vi.fn() }),
}))
const mutate = vi.fn()
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate }) }))

import { FileUploadDialog } from '@/app/dashboard/file-management/components/file-upload-dialog'

beforeEach(() => vi.clearAllMocks())

describe('FileUploadDialog', () => {
  it('uploads dropped files then revalidates and starts the watch window', async () => {
    render(<FileUploadDialog />)
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByTestId('file-dropzone'), { dataTransfer: { files: [file] } })
    await waitFor(() => expect(uploadAll).toHaveBeenCalledWith([file]))
    await waitFor(() => expect(startWatch).toHaveBeenCalled())
    expect(mutate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-upload-dialog.test.tsx`
Expected: FAIL — cannot resolve `file-upload-dialog`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-upload-dialog.tsx
'use client'

import * as React from 'react'
import { useSWRConfig } from 'swr'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import { useFileUpload } from '@/lib/hooks/use-file-upload'
import { FileDropzone } from './file-dropzone'
import { FileUploadList } from './file-upload-list'

export function FileUploadDialog() {
  const open = useFileManagementStore((s) => s.uploadOpen)
  const closeUpload = useFileManagementStore((s) => s.closeUpload)
  const startWatch = useFileManagementStore((s) => s.startWatch)
  const { items, uploadAll, reset } = useFileUpload()
  const { mutate } = useSWRConfig()
  const [busy, setBusy] = React.useState(false)

  const onFiles = async (files: File[]) => {
    setBusy(true)
    try {
      await uploadAll(files)
      await mutate((key) => Array.isArray(key) && key[0] === 'files')
      startWatch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) { closeUpload(); reset() }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
          <DialogDescription>
            Files are hashed locally to deduplicate and verify integrity, then uploaded directly to storage.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FileDropzone onFiles={(files) => void onFiles(files)} disabled={busy} />
          <FileUploadList items={items} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-upload-dialog.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-upload-dialog.tsx app/dashboard/file-management/components/__tests__/file-upload-dialog.test.tsx
git commit -m "feat(file-management): upload dialog wiring dropzone + queue + revalidation"
```

---

### Task 16: `file-detail-drawer.tsx`

**Files:**
- Create: `app/dashboard/file-management/components/file-detail-drawer.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-detail-drawer.test.tsx` (create)

**Interfaces:**
- Consumes: `useFileManagementStore` (Task 2), `useFileDetail` (Task 4), `FileStatusBadge` (Task 7), `file-format` helpers (Task 6), `fileService.downloadUrl` (existing), shadcn `Drawer`/`Button`/`Skeleton`, `HugeiconsIcon` (`Download01Icon`, `Delete02Icon`, `Alert02Icon`).
- Produces: `FileDetailDrawer()` — opens when `store.detailId` is set; shows full metadata, checksum, quarantine reason, timestamps + Download / Delete actions.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-detail-drawer.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const requestDelete = vi.fn()
const closeDetail = vi.fn()
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ detailId: 'f1', closeDetail, requestDelete }),
}))
vi.mock('@/lib/hooks/use-file-detail', () => ({
  useFileDetail: () => ({
    file: {
      id: 'f1', ownerId: null, filename: 'bad.zip', mimeType: 'application/zip', size: 4000000,
      checksumSha256: 'abc', status: 'QUARANTINED', metadata: { quarantineReason: 'mime-mismatch' },
      createdAt: '2026-07-20T10:00:00Z', updatedAt: '2026-07-20T10:00:05Z',
    },
    isLoading: false, error: undefined, mutate: vi.fn(),
  }),
}))
vi.mock('@/lib/services/file.service', () => ({ fileService: { downloadUrl: vi.fn() } }))

import { FileDetailDrawer } from '@/app/dashboard/file-management/components/file-detail-drawer'

beforeEach(() => vi.clearAllMocks())

describe('FileDetailDrawer', () => {
  it('shows metadata and the quarantine reason', () => {
    render(<FileDetailDrawer />)
    expect(screen.getByText('bad.zip')).toBeInTheDocument()
    expect(screen.getByText(/mime-mismatch/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-detail-drawer.test.tsx`
Expected: FAIL — cannot resolve `file-detail-drawer`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-detail-drawer.tsx
'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Download01Icon, Delete02Icon, Alert02Icon } from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import {
  Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import { useFileDetail } from '@/lib/hooks/use-file-detail'
import { fileService } from '@/lib/services/file.service'
import { FileStatusBadge } from './file-status-badge'
import { formatBytes, formatDateTime, mimeLabel, quarantineReason } from './file-format'

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-sm' : 'text-sm'}>{value}</dd>
    </div>
  )
}

export function FileDetailDrawer() {
  const detailId = useFileManagementStore((s) => s.detailId)
  const closeDetail = useFileManagementStore((s) => s.closeDetail)
  const requestDelete = useFileManagementStore((s) => s.requestDelete)
  const { file, isLoading } = useFileDetail(detailId)

  const available = file?.status === 'AVAILABLE'
  const reason = file ? quarantineReason(file.metadata) : null

  const download = async () => {
    if (!file) return
    try {
      const url = await fileService.downloadUrl(file.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not get a download link')
    }
  }

  return (
    <Drawer open={detailId !== null} onOpenChange={(o) => { if (!o) closeDetail() }} direction="right">
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{file?.filename ?? 'File details'}</DrawerTitle>
          <DrawerDescription>File metadata and integrity information.</DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-4">
          {isLoading && !file ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : file ? (
            <dl className="flex flex-col gap-4">
              <Row label="Status" value={<FileStatusBadge status={file.status} reason={reason} />} />
              {reason && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <span>This file was quarantined: <strong>{reason}</strong>. Downloads are disabled.</span>
                </div>
              )}
              <Row label="Type" value={`${mimeLabel(file.mimeType)} (${file.mimeType})`} />
              <Row label="Size" value={formatBytes(file.size)} />
              <Row label="SHA-256" value={file.checksumSha256 ?? '— (not yet computed)'} mono />
              <Row label="File ID" value={file.id} mono />
              <Row label="Uploaded" value={formatDateTime(file.createdAt)} />
              <Row label="Updated" value={formatDateTime(file.updatedAt)} />
            </dl>
          ) : null}
        </div>

        <DrawerFooter className="flex-row gap-2">
          <Button className="flex-1" disabled={!available} onClick={() => void download()}>
            <HugeiconsIcon icon={Download01Icon} strokeWidth={2} /> Download
          </Button>
          <Button
            variant="destructive"
            disabled={!file}
            onClick={() => { if (file) requestDelete([file.id]) }}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} /> Delete
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-detail-drawer.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-detail-drawer.tsx app/dashboard/file-management/components/__tests__/file-detail-drawer.test.tsx
git commit -m "feat(file-management): file detail drawer with quarantine surfacing"
```

---

### Task 17: `file-delete-dialog.tsx`

**Files:**
- Create: `app/dashboard/file-management/components/file-delete-dialog.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-delete-dialog.test.tsx` (create)

**Interfaces:**
- Consumes: `useFileManagementStore` (Task 2), `useFileMutations` (Task 5), `sonner` toast, shadcn `AlertDialog`.
- Produces: `FileDeleteDialog()` — confirms deletion of `store.deleteTarget`; on confirm runs `remove`, toasts the result, clears selection, closes both the dialog and the detail drawer.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-delete-dialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const clearSelection = vi.fn()
const cancelDelete = vi.fn()
const closeDetail = vi.fn()
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ deleteTarget: ['a', 'b'], clearSelection, cancelDelete, closeDetail }),
}))
const remove = vi.fn().mockResolvedValue({ ok: 1, failed: 1 })
vi.mock('@/lib/hooks/use-file-mutations', () => ({ useFileMutations: () => ({ remove }) }))
const toastSuccess = vi.fn(); const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }))

import { FileDeleteDialog } from '@/app/dashboard/file-management/components/file-delete-dialog'

beforeEach(() => vi.clearAllMocks())

describe('FileDeleteDialog', () => {
  it('deletes the target and reports partial failure', async () => {
    render(<FileDeleteDialog />)
    expect(screen.getByText(/Delete 2 file/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(remove).toHaveBeenCalledWith(['a', 'b'])
    expect(toastError).toHaveBeenCalled()
    expect(clearSelection).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-delete-dialog.test.tsx`
Expected: FAIL — cannot resolve `file-delete-dialog`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-delete-dialog.tsx
'use client'

import * as React from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import { useFileMutations } from '@/lib/hooks/use-file-mutations'

export function FileDeleteDialog() {
  const deleteTarget = useFileManagementStore((s) => s.deleteTarget)
  const cancelDelete = useFileManagementStore((s) => s.cancelDelete)
  const clearSelection = useFileManagementStore((s) => s.clearSelection)
  const closeDetail = useFileManagementStore((s) => s.closeDetail)
  const { remove } = useFileMutations()
  const [busy, setBusy] = React.useState(false)

  const count = deleteTarget?.length ?? 0

  const confirm = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      const { ok, failed } = await remove(deleteTarget)
      if (failed === 0) toast.success(`Deleted ${ok} file(s)`)
      else toast.error(`Deleted ${ok} of ${ok + failed}; ${failed} failed`)
      clearSelection()
      closeDetail()
      cancelDelete()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) cancelDelete() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {count} file(s)?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the selected file(s). This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void confirm() }}>
            {busy ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-delete-dialog.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-delete-dialog.tsx app/dashboard/file-management/components/__tests__/file-delete-dialog.test.tsx
git commit -m "feat(file-management): delete confirm dialog (single + bulk, partial failure)"
```

---

### Task 18: `file-toolbar.tsx`

**Files:**
- Create: `app/dashboard/file-management/components/file-toolbar.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-toolbar.test.tsx` (create)

**Interfaces:**
- Consumes: `useFileManagementStore` (Task 2), shadcn `Button`/`Input`/`Select`, `HugeiconsIcon` (`Add01Icon`, `RefreshIcon`, `Delete02Icon`, `SearchIcon`).
- Produces: `FileToolbar({ onRefresh }: { onRefresh: () => void })` — type-MIME select, filename search (client-side), Refresh, bulk Delete(N) (visible when rows selected), Upload button.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-toolbar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const openUpload = vi.fn(); const setNameFilter = vi.fn(); const requestDelete = vi.fn()
const state = {
  nameFilter: '', mimeType: undefined as string | undefined, selection: {} as Record<string, boolean>,
  openUpload, setNameFilter, setMimeType: vi.fn(), requestDelete,
}
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileManagementStore: (sel: (s: unknown) => unknown) => sel(state),
}))

import { FileToolbar } from '@/app/dashboard/file-management/components/file-toolbar'

beforeEach(() => { vi.clearAllMocks(); state.selection = {} })

describe('FileToolbar', () => {
  it('opens the upload dialog', async () => {
    render(<FileToolbar onRefresh={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /upload/i }))
    expect(openUpload).toHaveBeenCalled()
  })
  it('calls onRefresh', async () => {
    const onRefresh = vi.fn()
    render(<FileToolbar onRefresh={onRefresh} />)
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(onRefresh).toHaveBeenCalled()
  })
  it('shows bulk delete when rows are selected', () => {
    state.selection = { a: true, b: true }
    render(<FileToolbar onRefresh={vi.fn()} />)
    expect(screen.getByRole('button', { name: /delete \(2\)/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-toolbar.test.tsx`
Expected: FAIL — cannot resolve `file-toolbar`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-toolbar.tsx
'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, RefreshIcon, Delete02Icon, SearchIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'

const ALL_TYPES = '__all__'
const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'application/pdf', label: 'PDF' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/gif', label: 'GIF' },
  { value: 'application/zip', label: 'ZIP' },
  { value: 'text/csv', label: 'CSV' },
  { value: 'application/json', label: 'JSON' },
]

export function FileToolbar({ onRefresh }: { onRefresh: () => void }) {
  const nameFilter = useFileManagementStore((s) => s.nameFilter)
  const setNameFilter = useFileManagementStore((s) => s.setNameFilter)
  const mimeType = useFileManagementStore((s) => s.mimeType)
  const setMimeType = useFileManagementStore((s) => s.setMimeType)
  const selection = useFileManagementStore((s) => s.selection)
  const requestDelete = useFileManagementStore((s) => s.requestDelete)
  const openUpload = useFileManagementStore((s) => s.openUpload)

  const selectedIds = Object.keys(selection)

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 lg:px-6">
      <Select
        value={mimeType ?? ALL_TYPES}
        onValueChange={(v) => setMimeType(v === ALL_TYPES ? undefined : v)}
      >
        <SelectTrigger className="w-40" size="sm">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL_TYPES}>All types</SelectItem>
            {TYPE_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <div className="relative">
        <HugeiconsIcon
          icon={SearchIcon}
          strokeWidth={2}
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="Filter this page by name…"
          className="h-8 w-56 pl-8"
          aria-label="Filter files by name"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {selectedIds.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => requestDelete(selectedIds)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Delete ({selectedIds.length})
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
          Refresh
        </Button>
        <Button size="sm" onClick={openUpload}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Upload
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-toolbar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-toolbar.tsx app/dashboard/file-management/components/__tests__/file-toolbar.test.tsx
git commit -m "feat(file-management): toolbar (type filter, name search, refresh, bulk delete, upload)"
```

---

### Task 19: `file-management-view.tsx` (orchestrator)

**Files:**
- Create: `app/dashboard/file-management/components/file-management-view.tsx`
- Test: `app/dashboard/file-management/components/__tests__/file-management-view.test.tsx` (create)

**Interfaces:**
- Consumes: `useFiles` (Task 4), `useFileManagementStore` (Task 2, for `nameFilter`), and all components from Tasks 11–18.
- Produces: `FileManagementView()` — the composed page body. Applies the client-side `nameFilter` to `data.items` before passing them to the table; passes `pageCount` and `total` from the server response.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/components/__tests__/file-management-view.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mutate = vi.fn()
vi.mock('@/lib/hooks/use-files', () => ({
  useFiles: () => ({
    data: {
      items: [
        { id: 'f1', ownerId: null, filename: 'report.pdf', mimeType: 'application/pdf', size: 2100000, checksumSha256: null, status: 'AVAILABLE', metadata: {}, createdAt: '2026-07-20T10:00:00Z', updatedAt: '' },
        { id: 'f2', ownerId: null, filename: 'photo.png', mimeType: 'image/png', size: 800000, checksumSha256: null, status: 'AVAILABLE', metadata: {}, createdAt: '2026-07-20T10:00:00Z', updatedAt: '' },
      ],
      total: 2, page: 1, limit: 20,
    },
    isLoading: false, error: undefined, mutate,
  }),
}))
vi.mock('@/lib/state-management/file-management.store', async (orig) => {
  const actual = await orig<typeof import('@/lib/state-management/file-management.store')>()
  return { ...actual, useFileManagementStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ nameFilter: 'photo', selection: {}, columnVisibility: {}, setSelection: vi.fn(), setColumnVisibility: vi.fn(), setPage: vi.fn(), setLimit: vi.fn(), page: 1, limit: 20 }),
    { getState: () => ({ watchUntil: 0 }) },
  ) }
})
// Stub the heavy leaf components to keep this an integration test of the view's own logic.
vi.mock('@/app/dashboard/file-management/components/file-toolbar', () => ({ FileToolbar: () => <div>toolbar</div> }))
vi.mock('@/app/dashboard/file-management/components/file-status-tabs', () => ({ FileStatusTabs: () => <div>tabs</div> }))
vi.mock('@/app/dashboard/file-management/components/file-upload-dialog', () => ({ FileUploadDialog: () => null }))
vi.mock('@/app/dashboard/file-management/components/file-detail-drawer', () => ({ FileDetailDrawer: () => null }))
vi.mock('@/app/dashboard/file-management/components/file-delete-dialog', () => ({ FileDeleteDialog: () => null }))
vi.mock('@/app/dashboard/file-management/components/file-data-table', () => ({
  FileDataTable: ({ items, totalItems }: { items: { filename: string }[]; totalItems: number }) => (
    <div>
      <span data-testid="row-count">{items.length}</span>
      <span data-testid="total">{totalItems}</span>
      {items.map((i) => <div key={i.filename}>{i.filename}</div>)}
    </div>
  ),
}))

import { FileManagementView } from '@/app/dashboard/file-management/components/file-management-view'

beforeEach(() => vi.clearAllMocks())

describe('FileManagementView', () => {
  it('applies the client-side name filter to the displayed rows', () => {
    render(<FileManagementView />)
    expect(screen.getByRole('heading', { name: /file management/i })).toBeInTheDocument()
    expect(screen.getByTestId('row-count')).toHaveTextContent('1')
    expect(screen.getByText('photo.png')).toBeInTheDocument()
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-management-view.test.tsx`
Expected: FAIL — cannot resolve `file-management-view`.

- [ ] **Step 3: Write the component**

```tsx
// app/dashboard/file-management/components/file-management-view.tsx
'use client'

import * as React from 'react'
import { useFiles } from '@/lib/hooks/use-files'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import { FileToolbar } from './file-toolbar'
import { FileStatusTabs } from './file-status-tabs'
import { FileDataTable } from './file-data-table'
import { FileUploadDialog } from './file-upload-dialog'
import { FileDetailDrawer } from './file-detail-drawer'
import { FileDeleteDialog } from './file-delete-dialog'

export function FileManagementView() {
  const { data, isLoading, error, mutate } = useFiles()
  const nameFilter = useFileManagementStore((s) => s.nameFilter)
  const limit = useFileManagementStore((s) => s.limit)

  const items = React.useMemo(() => {
    const all = data?.items ?? []
    const q = nameFilter.trim().toLowerCase()
    return q ? all.filter((f) => f.filename.toLowerCase().includes(q)) : all
  }, [data, nameFilter])

  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">File Management</h1>
        <p className="text-sm text-muted-foreground">
          Upload, browse, download, and review your files.
        </p>
      </div>

      <FileStatusTabs />
      <FileToolbar onRefresh={() => void mutate()} />

      <FileDataTable
        items={items}
        pageCount={pageCount}
        totalItems={total}
        isLoading={isLoading}
        error={error}
        onRetry={() => void mutate()}
      />

      <FileUploadDialog />
      <FileDetailDrawer />
      <FileDeleteDialog />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/components/__tests__/file-management-view.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/file-management/components/file-management-view.tsx app/dashboard/file-management/components/__tests__/file-management-view.test.tsx
git commit -m "feat(file-management): orchestrating view with client-side name filtering"
```

---

### Task 20: Route page + sidebar nav entry

**Files:**
- Create: `app/dashboard/file-management/page.tsx`
- Modify: `components/app-sidebar.tsx` (add a nav entry to `data.navMain`)
- Test: `app/dashboard/file-management/__tests__/page.test.tsx` (create)

**Interfaces:**
- Consumes: `FileManagementView` (Task 19), the existing `AppSidebar`/`SiteHeader`/`SidebarProvider`/`SidebarInset` shells.
- Produces: default-exported `Page` component at route `/dashboard/file-management`; sidebar link labeled "File Management" → `/dashboard/file-management`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/dashboard/file-management/__tests__/page.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/dashboard/file-management/components/file-management-view', () => ({
  FileManagementView: () => <div>file-management-view</div>,
}))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => <div>sidebar</div> }))
vi.mock('@/components/site-header', () => ({ SiteHeader: () => <div>header</div> }))

import Page from '@/app/dashboard/file-management/page'

describe('File management page', () => {
  it('renders the view', () => {
    render(<Page />)
    expect(screen.getByText('file-management-view')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/dashboard/file-management/__tests__/page.test.tsx`
Expected: FAIL — cannot resolve `@/app/dashboard/file-management/page`.

- [ ] **Step 3: Write the page**

```tsx
// app/dashboard/file-management/page.tsx
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { FileManagementView } from '@/app/dashboard/file-management/components/file-management-view'

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
            <FileManagementView />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

- [ ] **Step 4: Add the sidebar nav entry**

In `components/app-sidebar.tsx`, add `Folder01Icon` to the `@hugeicons/core-free-icons` import (it is already imported — confirm it is in the import list; if not, add it), then insert this object into `data.navMain` right after the "Data Management" entry:

```tsx
    {
      title: "File Management",
      url: "/dashboard/file-management",
      icon: (
        <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} />
      ),
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/dashboard/file-management/__tests__/page.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Full verification (whole feature)**

Run: `npm test`
Expected: entire suite green (existing + all new specs).

Run: `npm run build`
Expected: build succeeds (no type errors).

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/file-management/page.tsx app/dashboard/file-management/__tests__/page.test.tsx components/app-sidebar.tsx
git commit -m "feat(file-management): route page + sidebar navigation entry"
```

---

## Self-Review (author checklist — completed)

**1. Spec coverage:**
- State management → Task 2 (store) + selectors. ✅
- UI driven by state → every component reads the store; view composes (Tasks 11–19). ✅
- Table based on `data-table.tsx` → Task 11 (+ Task 10 pagination), documented adaptation. ✅
- All components under `file-management/components/` → Tasks 6–19; pagination kept local (Task 10). ✅
- Management + quarantine review → status tabs w/ count (Task 12), badge + reason (Tasks 7/8), detail drawer surfacing (Task 16). ✅
- Dropzone + client SHA-256 → Task 3 (hashing/dedup) + Tasks 13–15 (UI). ✅
- Smart auto-refresh → Task 4 (`computeRefreshInterval`) + watch window (Task 2 `startWatch`, Task 15 trigger). ✅
- Error handling → list Empty/Retry (Task 11), upload per-file errors (Tasks 3/14), delete partial toast (Tasks 5/17), download disabled unless AVAILABLE (Tasks 9/16). ✅
- Testing → a spec accompanies every task. ✅

**2. Placeholder scan:** No TBD/TODO; every code step carries complete code. ✅

**3. Type consistency:** `FilesQuery`/`PaginatedFiles`/`FileStatusFilter` (Task 1) are consumed unchanged in Tasks 2/4/12/18; `UploadItem`/`UploadStatus` (Task 3) consumed in Task 14; `buildFileColumns` (Task 8) consumed in Task 11; `FilePagination` (Task 10) consumed in Task 11; `useFileMutations.remove → {ok, failed}` (Task 5) consumed in Task 17; `startWatch` (Task 2) consumed in Task 15. All names align. ✅

## Notes for the implementer
- Read the neighbouring `data-management` feature files (`components/data-management/*`, `lib/state-management/data-management.store.ts`, `app/dashboard/data-management/components/data-table-pagination.tsx`) for house style — this feature is its deliberate twin.
- If a shadcn primitive prop (e.g. `Badge variant`, `Tabs` API, dropdown `data-disabled` attribute) differs from what a test asserts, inspect the rendered DOM once and align the assertion; do not change the design.
- Keep every file focused and under the repo's 500-line guideline (all are well under).
