# File Management — Frontend Design

**Date:** 2026-07-21
**Branch:** feat/ai-main-dashboard
**Status:** Approved design (not yet built)
**Backend module:** `api/src/features/file-processor`
**Frontend feature dir:** `frontend/app/dashboard/file-management`

---

## 1. Goal

Design the frontend for the backend **file-processor** module: a clean, production-grade
File Management panel that lets a user browse, upload, download, and delete their files,
with a **first-class quarantine-review** workflow surfacing the module's async
processing lifecycle.

The design deliberately mirrors the existing **`data-management`** feature (Zustand store
+ SWR hooks + a TanStack/shadcn table adapted from `data-table.tsx`) so it drops into the
codebase as a sibling feature rather than a new paradigm.

---

## 2. Backend contract (as-built)

The frontend speaks to these endpoints (all under `/files`, owner-scoped by the resolved
principal):

| Method | Route | Purpose | Shape |
|---|---|---|---|
| POST | `/files` | Initiate presigned upload | body `{filename, mimeType, size, sha256?, metadata?}` → `{fileId, deduplicated, upload?}` |
| POST | `/files/:id/complete` | Finalize upload | body `{sha256?}` → `FileMetadata`; flips `PENDING→AVAILABLE`, enqueues processing |
| GET | `/files` | Paginated list | query `{page, limit, status?, mimeType?}` → `Paginated<FileMetadata>` |
| GET | `/files/:id` | Metadata | → `FileMetadata` |
| GET | `/files/:id/download-url?ttl=` | Presigned GET URL | → `PresignedTarget` (requires `AVAILABLE`) |
| DELETE | `/files/:id` | Soft delete | → 204 |

**`FileMetadata`:** `{ id, ownerId, filename, mimeType, size, checksumSha256, status,
metadata, createdAt, updatedAt }`. `status ∈ { PENDING, AVAILABLE, QUARANTINED }`.

**`PresignedTarget`:** `{ url, fields?, expiresIn }` — a MinIO POST policy; the client sends
a multipart form with `fields` then `file` appended **last**.

### Lifecycle nuance that shapes the UX

`complete` sets the row **AVAILABLE synchronously**, then enqueues a BullMQ job. That job
streams the object, verifies SHA-256 + magic bytes, and **can flip AVAILABLE → QUARANTINED**
seconds later, writing `metadata.quarantineReason` (`checksum-mismatch` | `mime-mismatch`).
There is no `PROCESSING` status. Therefore a freshly uploaded file shows AVAILABLE
immediately and may quarantine shortly after — the UI must re-check status without a manual
reload.

### Hard constraints (drive design decisions)

| Backend reality | Frontend consequence |
|---|---|
| No `PATCH`/update endpoint | Files are **immutable** — no edit form; upload / download / delete only. |
| Single `DELETE` only (no bulk route) | Bulk delete = client-side loop of single deletes with `Promise.allSettled` + partial-failure reporting. |
| Filter = `status` + **exact** `mimeType` only | Status → server-side (drives tabs). Type → server-side exact-MIME select. Filename search is **client-side over the loaded page** (labeled as such; no server search exists). |
| `quarantineReason` lives in `metadata` | Surfaced in the status-badge tooltip + detail drawer. |
| Download requires `AVAILABLE` | Download / Copy-link actions disabled for non-AVAILABLE rows. |

---

## 3. Design decisions (approved)

1. **Scope:** Management **+** first-class quarantine review — status tabs
   (All / Available / Pending / Quarantined) with a count badge on Quarantined; reason
   surfaced on hover and in the detail drawer.
2. **Upload:** Drag-and-drop multi-file dropzone with **client-side SHA-256** (Web Crypto)
   so uploads dedup against existing content and integrity is verified end-to-end.
3. **Live status:** **Smart auto-refresh** — revalidate on window focus + short poll (4s)
   only while a file is settling (any row `PENDING`, or inside a post-upload watch window);
   stop when stable. A manual Refresh button is always present.
4. **Filename search:** client-side, page-scoped (no server search exists). *(default —
   flagged for review)*
5. **Detail view:** right-side `Drawer`, echoing `data-table.tsx`'s `TableCellViewer`.
   *(default — flagged for review)*

---

## 4. Component location policy (requirement #4)

Every **feature component** lives in `frontend/app/dashboard/file-management/components/`,
including components extended from the shared shadcn base. State (Zustand) and data (SWR
hooks, service) are **not** components — they live in `lib/`, beside their `data-management`
counterparts. All components consume shadcn `@/components/ui/*` primitives (the "extended
from `frontend/components`" base). The table is adapted from `frontend/components/data-table.tsx`
following the `record-data-table` precedent.

---

## 5. State management — `lib/state-management/file-management.store.ts`

A Zustand store (`devtools` + `useShallow` selectors), a direct analog of
`data-management.store.ts`. **The store is the single source of truth; every component is a
pure render of it.**

```
Query (server-bound)                 UI / table state          Overlays
──────────────────────────           ─────────────────         ─────────────────────────
status: FileStatusFilter             selection: {id: bool}     uploadOpen: boolean
  'ALL'|'PENDING'|                    columnVisibility: {}      detailId: string | null
  'AVAILABLE'|'QUARANTINED'                                     deleteTarget: string[] | null
mimeType?: string                                              watchUntil: number
page: number                                                     (post-upload poll window)
limit: number
nameFilter: string  (client-only, filters current page)
```

**Actions** (named for devtools, mirroring the `dm/…` convention):
`setStatus` (resets `page` + `selection`), `setMimeType`, `setPage`, `setLimit`,
`setNameFilter`, `setSelection`, `clearSelection`, `setColumnVisibility`,
`openUpload`/`closeUpload`, `openDetail`/`closeDetail`, `requestDelete`/`cancelDelete`,
`startWatch()` (`watchUntil = Date.now() + 20_000`).

**Selector hooks** exported alongside: `useFileStatus`, `useFileQuery`
(shallow `{status, mimeType, page, limit}`), etc., to keep re-renders scoped.

---

## 6. Data layer (`lib/`)

**Extend `lib/services/file.service.ts`** (add the two missing methods):
- `list(query): Promise<PaginatedFiles>` → `GET /files` with `{page, limit, status?, mimeType?}`
  (omit `status` when `ALL`).
- `remove(id): Promise<void>` → `DELETE /files/:id`.

**Interfaces** (`lib/interfaces/search.interface.ts`, beside the existing File types):
add `FileStatus` union, `FilesQuery`, and
`PaginatedFiles = { items: FileMetadata[]; total: number; page: number; limit: number }`.

**`lib/hooks/use-files.ts`** — SWR list hook, keyed `['files', query]`,
`keepPreviousData: true`. Smart refresh:

```ts
const shouldPoll =
  (data?.items.some(f => f.status === 'PENDING') ?? false) || Date.now() < watchUntil
// refreshInterval: shouldPoll ? 4000 : 0   (+ SWR revalidateOnFocus, default on)
```

**`lib/hooks/use-file-upload.ts`** — enhance the *existing* hook:
- Compute SHA-256 with Web Crypto: `crypto.subtle.digest('SHA-256', await file.arrayBuffer())`.
- Pass `sha256` to `initiate` (server dedup) and to `complete` (integrity confirmation).
- Add `'hashing'` and `'deduplicated'` to the per-file status union.
- **Uploads become independent** — one failure no longer aborts siblings; each row owns its
  error (change from current stop-on-first-failure behavior).
- On completion → `mutate()` the list + `startWatch()`.

> Client hashing note: `crypto.subtle` needs the file as an `ArrayBuffer` (whole-file,
> secure context — fine on localhost/https). Acceptable within the server's `maxFileSize`
> policy; streaming-hash is a documented future option.

**`lib/hooks/use-file-detail.ts`** — small SWR hook keyed `['file', id]` calling
`fileService.get(id)`, used by the detail drawer to show fresh metadata (incl. a
`quarantineReason` that may have landed after the list was fetched). Returns `null`
key when no `detailId` is open.

---

## 7. Components — `app/dashboard/file-management/components/`

| Component | Responsibility |
|---|---|
| `file-management-view.tsx` | Orchestrator. Reads `useFiles` + store; composes toolbar, tabs, table, upload dialog, detail drawer, delete dialog. Applies client-side `nameFilter` before the table. |
| `file-toolbar.tsx` | Type-MIME select · client filename search · Refresh (⟳) · bulk "Delete (N)" when rows selected · primary "Upload" button. |
| `file-status-tabs.tsx` | Segmented tabs All / Available / Pending / Quarantined(n), bound to `store.status`; Quarantined shows a count badge. |
| `file-data-table.tsx` | TanStack + shadcn `Table`, adapted from `data-table.tsx` via the `record-data-table` precedent: `manualPagination`, select column, column-visibility menu, skeleton rows, `Empty` + Retry states. |
| `file-columns.tsx` | `ColumnDef<FileMetadata>[]`: select · name (+ type icon) · type · size (humanized) · status · created · actions. |
| `file-status-badge.tsx` | status → colored `Badge`; ⚠ + reason tooltip for QUARANTINED. |
| `file-row-actions.tsx` | Per-row ⋮: Download · Copy link · Details · Delete (Download/Copy disabled unless AVAILABLE). |
| `file-upload-dialog.tsx` | `Dialog` wrapping dropzone + queue; wired to `store.uploadOpen`. |
| `file-dropzone.tsx` | Drag-and-drop + click-to-browse (native DnD, no new dependency). |
| `file-upload-list.tsx` | Per-file rows: hashing → uploading(%) → done / deduplicated / error, using `ui/progress`. |
| `file-detail-drawer.tsx` | Right-side `Drawer`: full metadata, checksum, quarantine reason, timestamps + Download / Delete. Fetches fresh via a small `useFileDetail`. |
| `file-delete-dialog.tsx` | `AlertDialog` confirm; single or bulk (looped deletes, partial-failure toast). |
| `file-pagination.tsx` | Page-size + prev/next, based on the shared `DataTablePagination` pattern (kept local per requirement #4). |
| `__tests__/` | RTL/jest specs (focused imports per project convention). |

Plus the route entry **`app/dashboard/file-management/page.tsx`** — identical shell to
`data-management/page.tsx` (`SidebarProvider` + `AppSidebar` + `SiteHeader` +
`<FileManagementView/>`), and a nav link added in `app-sidebar`.

### Table "based on `data-table.tsx`"

Follow the established `record-data-table` interpretation: `useReactTable` with
`manualPagination`, shadcn `Table/TableHeader/TableBody/…` primitives, a `Checkbox` select
column, a column-visibility dropdown, `DataTablePagination`, skeleton loading rows, and
`Empty` states. **Drop** the base block's drag-reorder / tabs / chart / per-row drawer
(not meaningful for a server-paginated file list); keep its structural DNA. Row detail uses
a right-side `Drawer` echoing the base block's `TableCellViewer`.

---

## 8. Data flow (end to end)

```
Mount → store defaults (status ALL, page 1, limit 20) → useFiles → GET /files → table renders
Tab / type / page change → store setter → SWR key changes → refetch
Upload → dialog → drop files → per file:
    hash (SHA-256) → initiate
      → deduplicated?  mark ✓ deduped (skip upload/complete)
      → else           uploadToPolicy → complete → ✓ done
    → all settle → mutate(list) + startWatch() → poll 4s catches QUARANTINED flip
Row ⋮ → Download: downloadUrl → open URL | Copy link | Details: openDetail(id) → drawer
        Delete: requestDelete([id]) → confirm → remove → mutate
Bulk  → requestDelete(selectedIds) → confirm → Promise.allSettled(remove) →
        "Deleted X of Y" toast → mutate + clearSelection
```

---

## 9. Error handling

- **List:** table-body `Empty` + Retry (mirrors `record-data-table`).
- **Upload:** per-file error row (isolated); `ApiError.message` shown;
  `FILE_MIME_NOT_ALLOWED` / `FILE_TOO_LARGE` surfaced verbatim.
- **Delete:** toast; bulk reports partial success ("Deleted X of Y; N failed").
- **Download:** action disabled unless `AVAILABLE`; guards the backend `FILE_INVALID_STATE`.
- All errors ride the existing normalized `ApiError` from `api-client` (`code`, `message`,
  `fieldErrors`).

---

## 10. Testing

Mirror `data-management/__tests__` (RTL + jest, focused module imports per project
convention — no `AppModule`-style boots):

- **Store** reducers (status reset behavior, watch window, selection, overlays).
- **`file-columns`** + **`file-status-badge`** mapping (incl. quarantine reason tooltip).
- **`file-dropzone`** accept + native DnD.
- **`use-file-upload`** — hashing, dedup path, error isolation (`fileService` mocked).
- **`file-detail-drawer`** rendering + actions.
- **`file-delete-dialog`** — single + bulk partial failure.
- **`file-management-view`** integration — renders the table from a mocked `useFiles`.

Bar: `npm test` green, `npm run build` + lint clean.

---

## 11. Out of scope / future

- Server-side filename search (no endpoint today).
- Streaming client-side hash for very large files (whole-file `ArrayBuffer` used now).
- File preview/thumbnails.
- Editing file metadata (no backend endpoint).
