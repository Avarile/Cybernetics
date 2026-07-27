# AI Assistant — Document Attachments & Upload (Part 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload docx/pdf/markdown documents from two places — as **attachments in the chat composer** and via a **document-upload dialog on the data-management page** — so they become owner-scoped, agent-searchable records.

**Architecture:** Entirely frontend. The Part-1 backend already auto-ingests any uploaded docx/pdf/md/txt (on upload-complete) into the owner-scoped `documents` search collection; the `search-documents` tool makes them agent-searchable. So both entry points just need to run the existing presigned upload flow (`useFileUpload` → `/files`) and let the backend do the rest. Chat attachments upload on-add with `{ conversationId }` metadata; the data-management dialog uploads then watches the `documents` records until the async-ingested row appears.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Vitest + Testing Library, Zustand v5, SWR v2. Reuses `useFileUpload`, `FileDropzone`, `FileUploadList` (from the file-management feature), and the Part-2 chat components. Base branch `feat/ai-main-dashboard` (Parts 1 & 2 already committed here).

**Scope:** design **Phase 3** (attachments + document upload). **Deferred to an optional Part 4:** artifact panel + mobile `Sheet` rail + a11y/dark-mode polish (design Phase 4).

## Global Constraints

- **All commands run from `frontend/`.** Test runner **Vitest**: `npx vitest run <path>` / `npm test`. Typecheck `npm run typecheck`. Read a file before editing it. Files < ~300 lines. Single quotes.
- **Commits:** plain conventional messages, **NO `Co-Authored-By` trailer**. `git add` ONLY the task's explicit files — NEVER `.claude-flow/`, `.superpowers/`, `development/`, or daemon scratch. Explicit paths only.
- **No backend changes** — Part 1 already: (a) auto-enqueues `ingest-document` on upload-complete for ingestable MIME types, (b) ingests owner-scoped into the `documents` collection reading `conversationId` from the file's `metadata`, (c) exposes `search-documents` (owner-scoped). Do not touch `api/`.
- **No new npm dependencies.** Reuse `useFileUpload` (`@/lib/hooks/use-file-upload`), `FileDropzone` + `FileUploadList` (`@/app/dashboard/file-management/components/...`), the AI Elements, and the data-management/chat stores.
- **Owner-scoped, not admin-gated:** document upload goes through `/files` (owner-scoped), NOT the admin-only `RecordController`. So the "Upload documents" action must be **ungated** (usable by non-admins), like the file-management Upload button.
- **Reuse note:** `FileDropzone`/`FileUploadList` live under `app/dashboard/file-management/components/`; this plan imports them cross-feature (a known, accepted reuse). A future cleanup may promote them to `components/upload/` — out of scope here.
- **Ingestable MIME set** (mirror the backend `document-ingest.constants.ts`): `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/markdown`, `text/plain` — plus filename fallbacks `.pdf/.docx/.md/.markdown/.txt` (browsers sometimes give `.md` an empty `type`).
- **Known v1 limitation (document, don't fix):** ingestion is async (BullMQ + Meili), so a doc attached in a chat message may not be searchable on that *same* turn — it becomes searchable shortly after. Owner-scoped, so it's found on later turns.

---

## File Structure

**New:**
- `frontend/lib/upload/ingestable-docs.ts` — the ingestable-MIME set, `DOC_ACCEPT` string, `isIngestableDoc(file)`, `partitionIngestable(files)`.
- `frontend/lib/hooks/use-chat-attachments.ts` — wraps `useFileUpload` for the composer (uploads on-add with `conversationId`).
- `frontend/components/data-management/document-upload-dialog.tsx` — the data-management upload dialog.

**Modified:**
- `frontend/app/dashboard/file-management/components/file-dropzone.tsx` — add an optional `accept?: string` prop.
- `frontend/components/chat/chat-composer.tsx` — add the attach button + staged list; new `conversationId?` prop.
- `frontend/components/chat/chat-view.tsx` — pass `conversationId` to `ChatComposer`.
- `frontend/lib/state-management/data-management.store.ts` — add `uploadOpen`/`openUpload`/`closeUpload` + `watchUntil`/`startWatch`.
- `frontend/lib/hooks/use-records.ts` — add a `refreshInterval` (watch-window polling) so an async-ingested record appears.
- `frontend/components/data-management/record-toolbar.tsx` — add the ungated "Upload documents" button.
- `frontend/components/data-management/data-management-view.tsx` — mount `<DocumentUploadDialog/>`.

---

## Task 1: Ingestable-doc constants + `FileDropzone` `accept` prop

**Files:**
- Create: `frontend/lib/upload/ingestable-docs.ts`
- Modify: `frontend/app/dashboard/file-management/components/file-dropzone.tsx`
- Test: `frontend/lib/upload/__tests__/ingestable-docs.test.ts`, and extend `frontend/app/dashboard/file-management/components/__tests__/file-dropzone.test.tsx` (if it exists; else create it)

**Interfaces:**
- Produces: `DOC_ACCEPT: string`, `isIngestableDoc(file: File): boolean`, `partitionIngestable(files: File[]): { accepted: File[]; rejected: File[] }`; `FileDropzone` gains optional `accept?: string`.

- [ ] **Step 1: Write the constants + helpers**

```ts
// frontend/lib/upload/ingestable-docs.ts
/** MIME types the backend auto-ingests into the `documents` collection (mirrors
 *  api document-ingest.constants.ts). Browsers sometimes give .md an empty type,
 *  so isIngestableDoc also checks the filename extension. */
export const INGESTABLE_DOC_MIMES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
])

const INGESTABLE_EXTS = ['.pdf', '.docx', '.md', '.markdown', '.txt']

/** The `accept` attribute for a doc file picker. */
export const DOC_ACCEPT =
  '.pdf,.docx,.md,.markdown,.txt,' +
  'application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'text/markdown,text/plain'

export function isIngestableDoc(file: File): boolean {
  if (file.type && INGESTABLE_DOC_MIMES.has(file.type)) return true
  const name = file.name.toLowerCase()
  return INGESTABLE_EXTS.some((ext) => name.endsWith(ext))
}

/** Split files into ingestable docs vs. the rest. */
export function partitionIngestable(files: File[]): { accepted: File[]; rejected: File[] } {
  const accepted: File[] = []
  const rejected: File[] = []
  for (const f of files) (isIngestableDoc(f) ? accepted : rejected).push(f)
  return { accepted, rejected }
}
```

- [ ] **Step 2: Write the failing constants test**

```ts
// frontend/lib/upload/__tests__/ingestable-docs.test.ts
import { describe, it, expect } from 'vitest'
import { isIngestableDoc, partitionIngestable } from '@/lib/upload/ingestable-docs'

const file = (name: string, type = '') => new File(['x'], name, { type })

describe('isIngestableDoc', () => {
  it('accepts by MIME and by extension (incl. empty-type .md)', () => {
    expect(isIngestableDoc(file('a.pdf', 'application/pdf'))).toBe(true)
    expect(isIngestableDoc(file('notes.md', ''))).toBe(true)
    expect(isIngestableDoc(file('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBe(true)
    expect(isIngestableDoc(file('pic.png', 'image/png'))).toBe(false)
  })
  it('partitions files', () => {
    const { accepted, rejected } = partitionIngestable([file('a.pdf', 'application/pdf'), file('b.png', 'image/png')])
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf'])
    expect(rejected.map((f) => f.name)).toEqual(['b.png'])
  })
})
```

- [ ] **Step 3: Run → fail → (code already written in Step 1) → pass.** `cd frontend && npx vitest run lib/upload/__tests__/ingestable-docs.test.ts` → PASS.

- [ ] **Step 4: Add `accept?` to `FileDropzone`** — read the file first, then thread an optional `accept` prop to the `<input>`:

```tsx
// signature change:
export function FileDropzone({
  onFiles, disabled = false, accept,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  accept?: string
}) {
  // ...unchanged...
  // on the hidden <input>, add:  accept={accept}
```
Leave everything else identical (default `accept` undefined = current behavior). Confirm the existing file-management dropzone/upload-dialog tests still pass.

- [ ] **Step 5: Test the accept prop** — extend (or create) `file-dropzone.test.tsx`:

```tsx
it('forwards the accept attribute to the file input', () => {
  render(<FileDropzone onFiles={() => {}} accept=".pdf,.docx" />)
  expect(screen.getByTestId('file-input')).toHaveAttribute('accept', '.pdf,.docx')
})
```
(Import `render`/`screen` from `@testing-library/react`, `FileDropzone` from its path.)

- [ ] **Step 6: Run affected tests + commit**

Run: `cd frontend && npx vitest run lib/upload app/dashboard/file-management/components/__tests__/file-dropzone.test.tsx && npm run typecheck`
Expected: all pass.
```bash
git add frontend/lib/upload/ingestable-docs.ts frontend/lib/upload/__tests__/ingestable-docs.test.ts frontend/app/dashboard/file-management/components/file-dropzone.tsx frontend/app/dashboard/file-management/components/__tests__/file-dropzone.test.tsx
git commit -m "feat(upload): ingestable-doc helpers + FileDropzone accept prop"
```

---

## Task 2: `useChatAttachments` hook

**Files:**
- Create: `frontend/lib/hooks/use-chat-attachments.ts`
- Test: `frontend/lib/hooks/__tests__/use-chat-attachments.test.tsx`

**Interfaces:**
- Consumes: `useFileUpload` (`@/lib/hooks/use-file-upload`) → `{ items, uploadAll(files, metadata?), reset }`; `partitionIngestable` (Task 1).
- Produces: `useChatAttachments(conversationId: string | null) → { items, addFiles(files: File[]): Promise<void>, reset(), rejectedCount: number }`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/lib/hooks/__tests__/use-chat-attachments.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const uploadAll = vi.fn().mockResolvedValue(['f1'])
const reset = vi.fn()
vi.mock('@/lib/hooks/use-file-upload', () => ({
  useFileUpload: () => ({ items: [], uploadAll, reset }),
}))
import { useChatAttachments } from '@/lib/hooks/use-chat-attachments'

const file = (name: string, type = 'application/pdf') => new File(['x'], name, { type })
beforeEach(() => vi.clearAllMocks())

describe('useChatAttachments', () => {
  it('uploads only ingestable docs, tagging conversationId', async () => {
    const { result } = renderHook(() => useChatAttachments('c1'))
    await act(async () => { await result.current.addFiles([file('a.pdf'), file('b.png', 'image/png')]) })
    expect(uploadAll).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.pdf' })], { conversationId: 'c1' })
    expect(result.current.rejectedCount).toBe(1)
  })
  it('omits conversationId metadata for a new chat (null id)', async () => {
    const { result } = renderHook(() => useChatAttachments(null))
    await act(async () => { await result.current.addFiles([file('a.pdf')]) })
    expect(uploadAll).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.pdf' })], undefined)
  })
})
```

- [ ] **Step 2: Run → fail.** `cd frontend && npx vitest run lib/hooks/__tests__/use-chat-attachments.test.tsx` → FAIL (missing module).

- [ ] **Step 3: Write the hook**

```ts
// frontend/lib/hooks/use-chat-attachments.ts
'use client'
import { useCallback, useState } from 'react'
import { useFileUpload } from '@/lib/hooks/use-file-upload'
import { partitionIngestable } from '@/lib/upload/ingestable-docs'

/** Composer attachments: uploads ingestable docs on-add (owner-scoped, tagged with
 *  the conversation when one exists). Non-doc files are rejected (counted). */
export function useChatAttachments(conversationId: string | null) {
  const { items, uploadAll, reset: resetUpload } = useFileUpload()
  const [rejectedCount, setRejectedCount] = useState(0)

  const addFiles = useCallback(
    async (files: File[]) => {
      const { accepted, rejected } = partitionIngestable(files)
      if (rejected.length) setRejectedCount((n) => n + rejected.length)
      if (!accepted.length) return
      await uploadAll(accepted, conversationId ? { conversationId } : undefined)
    },
    [uploadAll, conversationId],
  )

  const reset = useCallback(() => {
    resetUpload()
    setRejectedCount(0)
  }, [resetUpload])

  return { items, addFiles, reset, rejectedCount }
}
```

- [ ] **Step 4: Run → pass.** Same command → PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add frontend/lib/hooks/use-chat-attachments.ts frontend/lib/hooks/__tests__/use-chat-attachments.test.tsx
git commit -m "feat(chat): useChatAttachments (upload docs on-add, conversation-tagged)"
```

---

## Task 3: Chat composer attachments UI

**Files:**
- Modify: `frontend/components/chat/chat-composer.tsx`
- Modify: `frontend/components/chat/chat-view.tsx` (pass `conversationId`)
- Test: `frontend/components/chat/__tests__/chat-composer.test.tsx` (extend)

**Interfaces:**
- Consumes: `useChatAttachments` (Task 2); `FileUploadList` (`@/app/dashboard/file-management/components/file-upload-list`); `DOC_ACCEPT` (Task 1); `Button` (`@/components/ui/button`), a Hugeicons attach icon.
- Produces: `ChatComposer` gains `conversationId?: string | null`; renders an attach button + a staged upload list; clears attachments on send.

- [ ] **Step 1: Write the failing test** (extend the existing composer test)

```tsx
// add to frontend/components/chat/__tests__/chat-composer.test.tsx
import { vi } from 'vitest'
const addFiles = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/hooks/use-chat-attachments', () => ({
  useChatAttachments: () => ({ items: [], addFiles, reset: vi.fn(), rejectedCount: 0 }),
}))

it('routes selected files to the attachments hook', async () => {
  const { container } = render(<ChatComposer status="ready" onSend={vi.fn()} conversationId="c1" />)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
  const { fireEvent } = await import('@testing-library/react')
  fireEvent.change(input, { target: { files: [file] } })
  expect(addFiles).toHaveBeenCalledWith([file])
})
```
(Keep the existing composer tests; add the `vi.mock` at the top of the file.)

- [ ] **Step 2: Run → fail.** `cd frontend && npx vitest run components/chat/__tests__/chat-composer.test.tsx` → FAIL (no file input yet).

- [ ] **Step 3: Rewrite `chat-composer.tsx`** to add attachments (read the current file first):

```tsx
// frontend/components/chat/chat-composer.tsx
'use client'
import * as React from 'react'
import type { ChatStatus } from 'ai'
import { HugeiconsIcon } from '@hugeicons/react'
import { Attachment01Icon } from '@hugeicons/core-free-icons'
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from '@/components/ai-elements/chatbot/prompt-input'
import { Button } from '@/components/ui/button'
import { FileUploadList } from '@/app/dashboard/file-management/components/file-upload-list'
import { useChatAttachments } from '@/lib/hooks/use-chat-attachments'
import { DOC_ACCEPT } from '@/lib/upload/ingestable-docs'

interface Props {
  status: ChatStatus
  onSend: (text: string) => void
  onStop?: () => void
  conversationId?: string | null
}

export function ChatComposer({ status, onSend, onStop, conversationId = null }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const { items, addFiles, reset } = useChatAttachments(conversationId)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      {items.length > 0 && (
        <div className="rounded-md border p-2">
          <FileUploadList items={items} />
        </div>
      )}
      <PromptInput
        onSubmit={(message) => {
          if (message.text.trim()) {
            onSend(message.text)
            reset()
          }
        }}
      >
        <PromptInputTextarea placeholder="Message the assistant…" />
        <div className="flex items-center justify-between px-1 pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Attach documents"
            onClick={() => inputRef.current?.click()}
          >
            <HugeiconsIcon icon={Attachment01Icon} strokeWidth={2} className="size-4" />
          </Button>
          <PromptInputSubmit status={status} onStop={onStop} />
        </div>
      </PromptInput>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={DOC_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}
```
Notes: verify `Attachment01Icon` is a real `@hugeicons/core-free-icons` export (grep; fallback `Link01Icon` or `PaperClipIcon`). `size="icon-sm"` is used by the AI Elements' `MessageAction` — confirm the `Button` variant supports it; else use `size="icon"`. The exact placement of the attach button vs. `PromptInputSubmit` is styling — keep it functional; adjust to match the composer's look.

- [ ] **Step 4: Pass `conversationId` from ChatView** — in `chat-view.tsx`, change the composer render to include it:
```tsx
<ChatComposer status={status} onSend={sendMessage} onStop={stop} conversationId={activeConversationId} />
```
(`activeConversationId` is already in scope in `ChatView`.)

- [ ] **Step 5: Run → pass + full suite + typecheck.** `cd frontend && npx vitest run components/chat/__tests__/chat-composer.test.tsx components/chat/__tests__/chat-view.test.tsx && npm run typecheck`
Expected: all pass (the existing chat-view test mocks hooks; the new `conversationId` prop is inert there).

- [ ] **Step 6: Commit**
```bash
git add frontend/components/chat/chat-composer.tsx frontend/components/chat/chat-view.tsx frontend/components/chat/__tests__/chat-composer.test.tsx
git commit -m "feat(chat): composer document attachments (attach + upload status)"
```

---

## Task 4: Data-management upload state + records watch-refresh

**Files:**
- Modify: `frontend/lib/state-management/data-management.store.ts`
- Modify: `frontend/lib/hooks/use-records.ts`
- Test: extend `frontend/lib/state-management/__tests__/data-management.store.test.ts`; add `frontend/lib/hooks/__tests__/use-records-refresh.test.ts`

**Interfaces:**
- Produces: store fields `uploadOpen: boolean`, `openUpload()`, `closeUpload()`, `watchUntil: number`, `startWatch()`; a pure `recordsRefreshInterval(watchUntil: number, now: number): number`; `useRecords()` polls while inside the watch window.

- [ ] **Step 1: Add store fields** — read `data-management.store.ts` first, then add to the interface + creator (mirror the file-management store's `uploadOpen`/`watchUntil` exactly):

```ts
// interface additions:
  uploadOpen: boolean
  openUpload: () => void
  closeUpload: () => void
  watchUntil: number
  startWatch: () => void

// creator additions (with a module const `const WATCH_MS = 20_000` near the top):
  uploadOpen: false,
  openUpload: () => set({ uploadOpen: true }, false, 'dm/openUpload'),
  closeUpload: () => set({ uploadOpen: false }, false, 'dm/closeUpload'),
  watchUntil: 0,
  startWatch: () => set({ watchUntil: Date.now() + WATCH_MS }, false, 'dm/startWatch'),
```

- [ ] **Step 2: Add the pure refresh helper + wire it into `useRecords`** — read `use-records.ts` first:

```ts
// in use-records.ts, add near the top:
const POLL_MS = 4000
/** Poll while inside the post-upload watch window (async ingest → Meili index lag). */
export function recordsRefreshInterval(watchUntil: number, now: number): number {
  return now < watchUntil ? POLL_MS : 0
}
```
Then add to the `useSWR` options (alongside `keepPreviousData: true`):
```ts
      refreshInterval: () =>
        recordsRefreshInterval(useDataManagementStore.getState().watchUntil, Date.now()),
```
(Import `useDataManagementStore` from `@/lib/state-management/data-management.store` in `use-records.ts` — read the file to confirm it isn't already imported; it currently imports `useCollection`/`useRecordQuery` from that module, so extend that import.)

- [ ] **Step 3: Write the failing tests**

```ts
// add to frontend/lib/state-management/__tests__/data-management.store.test.ts
it('opens/closes the upload dialog and starts a watch window', () => {
  const s = useDataManagementStore.getState()
  s.openUpload(); expect(useDataManagementStore.getState().uploadOpen).toBe(true)
  s.closeUpload(); expect(useDataManagementStore.getState().uploadOpen).toBe(false)
  s.startWatch(); expect(useDataManagementStore.getState().watchUntil).toBeGreaterThan(Date.now())
})
```
```ts
// frontend/lib/hooks/__tests__/use-records-refresh.test.ts
import { describe, it, expect } from 'vitest'
import { recordsRefreshInterval } from '@/lib/hooks/use-records'

describe('recordsRefreshInterval', () => {
  it('polls inside the watch window, stops after', () => {
    const now = 1_000_000
    expect(recordsRefreshInterval(now + 5000, now)).toBe(4000)
    expect(recordsRefreshInterval(now - 1, now)).toBe(0)
    expect(recordsRefreshInterval(0, now)).toBe(0)
  })
})
```

- [ ] **Step 4: Run fail → pass + full suite + typecheck.** `cd frontend && npx vitest run lib/state-management/__tests__/data-management.store.test.ts lib/hooks/__tests__/use-records-refresh.test.ts && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/lib/state-management/data-management.store.ts frontend/lib/state-management/__tests__/data-management.store.test.ts frontend/lib/hooks/use-records.ts frontend/lib/hooks/__tests__/use-records-refresh.test.ts
git commit -m "feat(data-management): upload-dialog state + records watch-refresh"
```

---

## Task 5: `DocumentUploadDialog`

**Files:**
- Create: `frontend/components/data-management/document-upload-dialog.tsx`
- Test: `frontend/components/data-management/__tests__/document-upload-dialog.test.tsx`

**Interfaces:**
- Consumes: `useDataManagementStore` (`uploadOpen`/`closeUpload`/`startWatch`/`setCollection` — Task 4 + existing); `useFileUpload`; `FileDropzone`/`FileUploadList`; `DOC_ACCEPT`/`partitionIngestable` (Task 1); `useSWRConfig().mutate`; the `documents` collection name.
- Produces: `<DocumentUploadDialog/>` (store-driven, self-contained) — uploads ingestable docs, then selects the `documents` collection + starts the watch window + revalidates records.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/data-management/__tests__/document-upload-dialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const closeUpload = vi.fn()
const startWatch = vi.fn()
const setCollection = vi.fn()
vi.mock('@/lib/state-management/data-management.store', () => ({
  useDataManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ uploadOpen: true, closeUpload, startWatch, setCollection }),
}))
const uploadAll = vi.fn().mockResolvedValue(['f1'])
vi.mock('@/lib/hooks/use-file-upload', () => ({ useFileUpload: () => ({ items: [], uploadAll, reset: vi.fn() }) }))
const mutate = vi.fn()
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate }) }))

import { DocumentUploadDialog } from '@/components/data-management/document-upload-dialog'
beforeEach(() => vi.clearAllMocks())

describe('DocumentUploadDialog', () => {
  it('uploads ingestable docs, selects the documents collection, watches + revalidates', async () => {
    render(<DocumentUploadDialog />)
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByTestId('file-dropzone'), { dataTransfer: { files: [pdf] } })
    await waitFor(() => expect(uploadAll).toHaveBeenCalledWith([pdf], undefined))
    await waitFor(() => expect(setCollection).toHaveBeenCalledWith('documents'))
    expect(startWatch).toHaveBeenCalled()
    expect(mutate).toHaveBeenCalled()
  })
  it('ignores non-ingestable files', async () => {
    render(<DocumentUploadDialog />)
    const png = new File(['x'], 'b.png', { type: 'image/png' })
    fireEvent.drop(screen.getByTestId('file-dropzone'), { dataTransfer: { files: [png] } })
    await waitFor(() => expect(uploadAll).not.toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run → fail.** `cd frontend && npx vitest run components/data-management/__tests__/document-upload-dialog.test.tsx` → FAIL (missing module).

- [ ] **Step 3: Write the dialog**

```tsx
// frontend/components/data-management/document-upload-dialog.tsx
'use client'
import * as React from 'react'
import { useSWRConfig } from 'swr'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileDropzone } from '@/app/dashboard/file-management/components/file-dropzone'
import { FileUploadList } from '@/app/dashboard/file-management/components/file-upload-list'
import { useFileUpload } from '@/lib/hooks/use-file-upload'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import { DOC_ACCEPT, partitionIngestable } from '@/lib/upload/ingestable-docs'

const DOCUMENTS_COLLECTION = 'documents'

export function DocumentUploadDialog() {
  const open = useDataManagementStore((s) => s.uploadOpen)
  const closeUpload = useDataManagementStore((s) => s.closeUpload)
  const startWatch = useDataManagementStore((s) => s.startWatch)
  const setCollection = useDataManagementStore((s) => s.setCollection)
  const { items, uploadAll, reset } = useFileUpload()
  const { mutate } = useSWRConfig()
  const [busy, setBusy] = React.useState(false)

  const onFiles = async (files: File[]) => {
    const { accepted } = partitionIngestable(files)
    if (!accepted.length) return
    setBusy(true)
    try {
      await uploadAll(accepted)
      setCollection(DOCUMENTS_COLLECTION) // show the docs collection so the new records land in view
      startWatch() // poll records until the async-ingested rows appear
      await mutate((key) => Array.isArray(key) && key[0] === 'records')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { closeUpload(); reset() } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload documents</DialogTitle>
          <DialogDescription>
            PDF, DOCX, or Markdown files are extracted into searchable records the assistant can use.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FileDropzone onFiles={(files) => void onFiles(files)} disabled={busy} accept={DOC_ACCEPT} />
          <FileUploadList items={items} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run → pass + full suite + typecheck.** `cd frontend && npx vitest run components/data-management/__tests__/document-upload-dialog.test.tsx && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/components/data-management/document-upload-dialog.tsx frontend/components/data-management/__tests__/document-upload-dialog.test.tsx
git commit -m "feat(data-management): document upload dialog (docs → documents collection)"
```

---

## Task 6: Wire the toolbar button + mount the dialog

**Files:**
- Modify: `frontend/components/data-management/record-toolbar.tsx`
- Modify: `frontend/components/data-management/data-management-view.tsx`
- Test: extend `frontend/components/data-management/__tests__/data-management-view.test.tsx` (or the toolbar's test if present)

**Interfaces:**
- Consumes: `openUpload` (Task 4 store); `DocumentUploadDialog` (Task 5).
- Produces: an ungated "Upload documents" button in the record toolbar + the mounted dialog.

- [ ] **Step 1: Add the button to `record-toolbar.tsx`** — read the file first. Add (in the `ml-auto` cluster, **NOT** wrapped in `isAdmin &&`, before the admin buttons):
```tsx
// near the other store selectors:
const openUpload = useDataManagementStore((state) => state.openUpload)
// in the ml-auto cluster (ungated):
<Button variant="outline" size="sm" onClick={openUpload}>
  <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} />
  Upload documents
</Button>
```
Add `Upload01Icon` to the `@hugeicons/core-free-icons` import (it's used by the file-management dropzone, so it's a confirmed export).

- [ ] **Step 2: Mount the dialog in `data-management-view.tsx`** — read the file first. Add `<DocumentUploadDialog/>` as a sibling near `<CollectionManagerDialog/>` (unconditional):
```tsx
import { DocumentUploadDialog } from '@/components/data-management/document-upload-dialog'
// ...at the bottom, next to <CollectionManagerDialog />:
<DocumentUploadDialog />
```

- [ ] **Step 3: Write/extend the test** — assert the button opens the dialog. In the data-management-view or toolbar test (mock the store's `openUpload`):
```tsx
it('has an ungated Upload documents button that opens the upload dialog', () => {
  const openUpload = vi.fn()
  // ...render the toolbar with a mocked store exposing openUpload (and useIsAdmin=false to prove it's ungated)...
  // click getByRole('button', { name: /upload documents/i }) → expect(openUpload).toHaveBeenCalled()
})
```
Follow the existing `data-management-view.test.tsx` mocking pattern (mock `next/navigation`, the collections/records hooks, `useIsAdmin`). Assert the button renders even when `useIsAdmin` returns `false`.

- [ ] **Step 4: Run affected tests + full suite + typecheck + build**

Run: `cd frontend && npx vitest run components/data-management && npm run typecheck && npm run build`
Expected: tests pass; typecheck clean; build succeeds.

- [ ] **Step 5: Commit**
```bash
git add frontend/components/data-management/record-toolbar.tsx frontend/components/data-management/data-management-view.tsx frontend/components/data-management/__tests__/data-management-view.test.tsx
git commit -m "feat(data-management): Upload documents button + mount dialog"
```

---

## Manual end-to-end verification (after all tasks)

With the API running (Parts 1 & 2) + a logged-in non-admin user, `cd frontend && npm run dev`:
1. **Data-management upload:** Data Management → "Upload documents" → drop a `.pdf`/`.docx`/`.md` → after a moment the view switches to the `documents` collection and the new record appears (watch-window polling). A `.png` is ignored.
2. **Chat attachment:** `/dashboard/chat` → click the attach button → pick a `.pdf` → the staged upload list shows it upload → send a follow-up message; on a subsequent turn, ask "summarize my uploaded documents" → the agent's `search-documents` returns the doc.
3. **Non-admin:** the "Upload documents" button is visible/usable without admin (unlike "New record"/"Manage…").

## Self-review notes

- **Spec coverage (design Phase 3):** chat composer attachments (Tasks 1–3) ✓; data-management document upload (Tasks 1, 4–6) ✓. Both reuse Part-1's ingest pipeline (no backend change). Phase 4 (artifact panel + mobile/a11y polish) is the deferred optional Part 4.
- **Type consistency:** `isIngestableDoc`/`partitionIngestable`/`DOC_ACCEPT` (Task 1) reused in Tasks 2, 3, 5; `useChatAttachments` (Task 2) consumed by the composer (Task 3); the store's `uploadOpen`/`startWatch`/`watchUntil` (Task 4) consumed by the dialog (Task 5) + `recordsRefreshInterval` (Task 4) + the toolbar button (Task 6).
- **Verify-at-implementation flags (inline):** `Attachment01Icon` export + `Button size="icon-sm"` (Task 3 — fallbacks noted); the existing file-management dropzone test's location/existence (Task 1); that `useRecords` doesn't already import the store (Task 4); the exact data-management-view/toolbar test mocking shape (Task 6).
- **Known limitation (documented):** async ingestion means a chat-attached doc may not be searchable on the same turn.
- **Cross-feature reuse (documented):** `FileDropzone`/`FileUploadList` imported from the file-management route folder; candidate for promotion to `components/upload/` later.
