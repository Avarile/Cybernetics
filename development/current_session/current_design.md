# Design: Comprehensive AI Assistant UI (Claude-style) over the Mastra backend

## Context

The frontend already ships the full **AI Elements v1.9.0** component kit (`frontend/components/ai-elements/*`) but it is **100% unused** — there is no chat route, no `useChat` wiring, and the only agent client is a **buffered REST** call (`lib/services/agent.service.ts` → `POST /agent/chat`). The backend `api/src/features/mastra` exposes a working orchestrator agent with HITL tool-approvals, conversation metadata, and Postgres+Mastra persistence, but has **three gaps** for a Claude-grade UX: (1) no token-streaming endpoint that preserves the audit ledger + approvals, (2) no "get thread messages" endpoint for rehydrating history, (3) no document-text-extraction step linking an uploaded docx/pdf/markdown to a searchable record.

This design delivers a **Claude-style assistant** (streaming, reasoning, tool calls, HITL approvals, attachments, persistent history) by composing the existing AI Elements, and specifies the **full-stack** work (frontend + the three backend gaps) needed to support it.

## Decisions (confirmed with user)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Chat delivery | **Add a proper streaming endpoint** (`POST /agent/chat/stream`) that preserves the `agent_run` ledger + HITL approvals. No use of the ownership-bypassing Mastra catch-all. |
| 2 | Design scope | **Full-stack** — frontend UI + the 3 backend gaps (extraction→record, streaming, messages). |
| 3 | Doc upload entry | **Both** — chat composer attachments *and* a document-upload flow on the data-management page. |
| 4 | History | **Full persistent history** — left rail lists conversations; selecting one rehydrates its full message thread. |

---

## 1. Architecture overview

Three-pane, Claude-like layout inside the standard dashboard shell (`SidebarProvider` + `AppSidebar` + `SiteHeader` + `SidebarInset`, copied from `app/dashboard/data-management/page.tsx`).

```
┌──────────┬──────────────────────────────────────────────┬───────────────┐
│ App      │  ┌ SiteHeader ───────────────────────────┐    │               │
│ Sidebar  │  │ ☰  Assistant           [Context ⓘ]     │    │  Artifact /   │
│ (nav)    │  ├────────────────────────────────────────┤    │  Detail panel │
│          │  │                                        │    │  (optional,   │
│  …       │  │   Conversation (stick-to-bottom log)   │    │  slide-in for │
│  Assist. │  │   ┌ Message (assistant) ────────────┐  │    │  code /       │
│  Data    │  │   │ Reasoning ▸                      │  │    │  markdown     │
│  Files   │  │   │ MessageResponse (Streamdown md)  │  │    │  artifacts)   │
│          │  │   │ Tool ▸ (input/output/approval)   │  │    │               │
│  ┌─────┐ │  │   │ InlineCitation ¹ ²               │  │    │               │
│  │Conv │ │  │   └──────────────────────────────────┘  │    │               │
│  │hist │ │  │   ┌ Confirmation (HITL approval) ────┐  │    │               │
│  │rail │ │  │   │ Approve / Reject                 │  │    │               │
│  │(SWR)│ │  │   └──────────────────────────────────┘  │    │               │
│  └─────┘ │  │   [ConversationScrollButton]           │    │               │
│          │  ├────────────────────────────────────────┤    │               │
│          │  │ PromptInput: [attach] textarea [▶/■]   │    │               │
│          │  │  └ staged attachments (upload/extract) │    │               │
│          │  └────────────────────────────────────────┘    │               │
└──────────┴──────────────────────────────────────────────┴───────────────┘
```

- **History rail** = a second, inner column (not the app sidebar). Collapses into a `Sheet` on mobile. Lists conversations from `GET /agent/conversations`.
- **Center** = `Conversation`/`ConversationContent` + `PromptInput`, driven by AI SDK `useChat`.
- **Right panel** = optional Claude-style `Artifact` viewer (deferred-friendly; Phase 4).

**Data flow:** `useChat` (AI SDK v6) owns the live streamed `UIMessage[]` + `ChatStatus`. A Zustand `chat.store` owns cross-cutting UI/selection/attachment/approval state. SWR owns server lists + history hydration. All HTTP goes through the existing `apiClient` (Bearer, no `/api` prefix, error-envelope), except the streaming fetch which uses a token-injecting wrapper.

---

## 2. Routes & navigation

- **New route:** `app/dashboard/chat/page.tsx` — replicate the page-shell from `data-management/page.tsx`, render `<ChatView/>`. Auth-gating is inherited from `app/dashboard/layout.tsx` (`AuthGuard`) + `middleware.ts`.
- **Active conversation in the URL:** sync `?c=<conversationId>` (refresh-safe, shareable) using the existing `lib/hooks/use-query-url-sync.ts` pattern.
- **Nav entry:** append to `data.navMain` in `frontend/components/app-sidebar.tsx`:
  `{ title: 'Assistant', url: '/dashboard/chat', icon: <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} /> }` (confirm exact Hugeicons export at build).
- Add a nav test alongside the existing `components/__tests__/nav-main.test.tsx` precedent.

---

## 3. Frontend component tree (compose from AI Elements)

New folder `frontend/components/chat/` (shared-folder convention, like `components/data-management/`):

| File | Responsibility | Key AI Elements used |
|------|----------------|----------------------|
| `chat-view.tsx` | Top-level orchestrator: layout, wires `useChat` + `chat.store` + SWR, handles conversation switching/URL sync | layout only |
| `conversation-history-rail.tsx` | SWR conversation list, new-chat button, active highlight, rename/delete, name filter | `ScrollArea`, `Button`, `Empty` |
| `chat-thread.tsx` | Scroll log; maps `messages: UIMessage[]` → rows; renders scroll button + empty state | `Conversation`, `ConversationContent`, `ConversationScrollButton`, `ConversationEmptyState` |
| `chat-message.tsx` | Renders one `UIMessage`'s parts in order (text/reasoning/tool/source/file) | `Message`, `MessageContent`, `MessageResponse`, `Reasoning`, `MessageActions` |
| `chat-tool-call.tsx` | Renders a tool part by state (input-available/output-available/approval-requested/error) | `Tool`, `ToolHeader`, `ToolInput`, `ToolOutput`, `CodeBlock` |
| `chat-approval-card.tsx` | HITL: renders a pending approval, calls decide + resumes stream | `Confirmation`, `ConfirmationActions`, `ConfirmationAction` |
| `chat-citations.tsx` | Renders document-source citations from `search-documents` results | `InlineCitation*` |
| `chat-composer.tsx` | Prompt textarea + submit/stop + attach button; submits via `useChat.sendMessage` | `PromptInput`, `PromptInputTextarea`, `PromptInputSubmit`, `PromptInputTools` |
| `chat-attachments.tsx` | Staged attachment chips with upload/extract status | `Attachments`, `Attachment`, `AttachmentPreview`, `AttachmentRemove` |
| `chat-empty-state.tsx` | Greeting + starter suggestion chips (no `Suggestion` element exists — build simple `Button` chips) | `ConversationEmptyState`, `Button` |
| `artifact-panel.tsx` *(Phase 4, optional)* | Right-side viewer for code/markdown artifacts | `Artifact*`, `CodeBlock` |

**Deferred (YAGNI) AI Elements:** `voice/*`, `workflow/*`, `model-selector` (single agent — no picker), `queue`, `checkpoint`, `MessageBranch*`, `web-preview`/`sandbox`. Kept as future work.

---

## 4. State management design

Follow existing conventions exactly (Zustand `devtools` + `useShallow` composite selectors + labeled `set(..., false, 'chat/x')`; SWR tuple keys + service-closure fetchers + predicate invalidation).

**A. `useChat` (AI SDK v6, `@ai-sdk/react`)** — owns the live turn:
- Provides `messages: UIMessage[]`, `status: ChatStatus`, `sendMessage`, `stop`, `regenerate`, `addToolResult`, `setMessages`.
- Configured per active conversation: `useChat({ id: conversationId, transport, onError })`; seed history via `setMessages(hydrated)` on switch.
- Directly powers `MessageResponse`, `Reasoning.isStreaming`, `Tool` state, and `PromptInputSubmit status`.

**B. `lib/state-management/chat.store.ts` (Zustand)** — cross-cutting UI/selection not owned by the stream:
```
activeConversationId: string | null;  setActiveConversation(id | null)
historyRailOpen: boolean;             toggleHistoryRail()
artifact: { open: boolean; part?: … };  openArtifact / closeArtifact
attachments: StagedAttachment[];      // { file, status, fileId?, recordId?, error? }
addAttachments / patchAttachment / removeAttachment / clearAttachments
approvals: PendingApproval[];         setApprovals / removeApproval   // surfaced from stream + SWR
```
Selectors: `useActiveConversationId`, `useHistoryRailOpen`, `useStagedAttachments` (`useShallow`), `usePendingApprovals`.

**C. SWR hooks (`lib/hooks/`)** — server lists + hydration:

| Hook | Key | Source | Invalidation |
|------|-----|--------|--------------|
| `use-conversations.ts` | `['agent','conversations', page]` | `agentService.listConversations` | predicate `k[0]==='agent' && k[1]==='conversations'` after send/new/rename/delete |
| `use-conversation-messages.ts` | `['agent','conversation', id, 'messages']` | `agentService.getMessages(id)` → `UIMessage[]` | on switch |
| `use-approvals.ts` | `['agent','approvals']` | `agentService.listApprovals` | after decide |
| `use-chat-attachments.ts` | — | wraps existing `useFileUpload` + poll ingest status | — |

---

## 5. Streaming integration

**Backend contract:** `POST /agent/chat/stream` returns a **Vercel AI SDK UI-message data stream** (`toUIMessageStreamResponse()` semantics) so `@ai-sdk/react` `useChat` consumes it natively. Same `memory` + `requestContext` wiring as the existing `AgentRunnerService.runChat`; the run is still recorded in `agent_run`, and suspended tool calls still create `agent_approval` rows and surface as a tool part in `approval-requested` state before the stream closes.

**Auth transport (frontend):** `useChat` needs the Bearer token that today lives in the in-memory `lib/http/token-store.ts`. Add `lib/http/chat-fetch.ts`: a `fetch` wrapper that injects `Authorization: Bearer <token>` from the token store and, on an `AUTH_TOKEN_EXPIRED` response, runs the existing single-flight refresh (`lib/auth/session.ts`) once and retries — mirroring the `api-client` interceptor so streaming stays consistent with the rest of the app. Wire it as `transport: new DefaultChatTransport({ api: <apiUrl>/agent/chat/stream, fetch: chatFetch })`.

**Message mapping (history):** `GET /agent/conversations/:id/messages` returns `UIMessage[]` already shaped for the SDK (role + ordered parts: `text`, `reasoning`, `tool-*`, `file`). The frontend feeds it into `setMessages` — no client-side transform of Mastra internals.

---

## 6. HITL approval flow (streaming-aware)

1. Stream emits a tool part; when the tool requires approval the run suspends → stream surfaces a `PendingApproval` (as the tool part's `approval-requested` state and/or a typed data part) and closes; `agent_run.status = awaiting_approval`.
2. `chat-approval-card.tsx` renders `Confirmation` with the `title` + `payload`.
3. User approves/rejects → `agentService.decideApproval(id, { approved, note? })` (existing `POST /agent/approvals/:id`).
4. On approve, resume: `POST /agent/chat/stream` with `{ conversationId, resume: { approvalId } }` → server resumes the suspended Mastra run and streams the continuation into the same `useChat` thread. (Exact Mastra resume API — `resumeStream`/`sendToolApproval` — confirmed at implementation.)

This reuses the `Confirmation`/`Tool` elements whose state machine already models `approval-requested → executed/rejected`.

---

## 7. File → text → record pipeline

**Goal:** uploading a docx/pdf/markdown produces a persisted, agent-searchable text **record**, from **both** the chat composer and the data-management page, using the **same server-side pipeline**.

**Frontend (both entry points reuse the same primitives):**
- Reuse `lib/hooks/use-file-upload.ts` (`sha256Hex` + `fileService.initiate/uploadToPolicy/complete`) and the `file-dropzone.tsx` pattern.
- **Chat:** `PromptInput` attach → `use-chat-attachments` uploads with metadata `{ conversationId }`, shows per-file status (`hashing → uploading → extracting → ready`), then the doc is available to the agent in that conversation.
- **Data-management:** add `components/data-management/document-upload-dialog.tsx` + a toolbar action; when the `documents` collection is selected, uploaded docs appear as records in the existing `RecordDataTable`.

**Backend delta (owner-scoped, NOT the admin HTTP route):**
- **Extraction service** in `api/src/features/file-processor/`: add libs `mammoth` (docx→text), `pdf-parse` (pdf→text), markdown/txt read as UTF-8. `DocumentExtractionService.extract(mime, stream): Promise<{ title, text }>`.
- **Ingest step:** on upload-complete for a supported doc mime, enqueue `ingest-document` (extend `processors/file-processing.processor.ts` or add a consumer): `FileService.getContentStream(fileId, owner)` → extract → `SearchRecordService.persist('documents', [{ externalId: fileId, document: {...} }])` **in-process** (bypasses the admin-gated `RecordController`, stays owner-scoped). Link `recordId` onto file metadata and set `ownerUserId` + optional `conversationId` on the record.
- **`documents` collection** (bootstrap/migration) field spec: `title:string`, `text:string(searchable)`, `fileId:string`, `mimeType:string`, `ownerUserId:string(filterable)`, `conversationId:string(filterable,optional)`, `createdAt`. v1 = one record per document; paragraph chunking + embeddings are future (Meili is lexical; `semanticRecall` is off).
- **Agent retrieval:** add a `search-documents` tool (or extend `search-query`) that targets `documents` and injects a Meili filter `ownerUserId = <principal> AND (conversationId = <ctx.conversationId> OR conversationId NOT EXISTS)` from `tools/tool-context.ts` requestContext. Update `agents/prompts.ts` so the orchestrator uses it. Results feed `InlineCitation` in the UI.

---

## 8. Backend deltas — summary (contracts)

| Area | File(s) | Change |
|------|---------|--------|
| Streaming chat | `mastra/controllers/chat.controller.ts`, `services/agent-runner.service.ts` | `POST /agent/chat/stream` (data-stream; ledger + approvals preserved; `{ resume:{approvalId} }` continuation) |
| Messages | `mastra/controllers/chat.controller.ts` (or new `conversation.controller.ts`), `services/conversation.service.ts` | `GET /agent/conversations/:id/messages` → owner-checked `UIMessage[]` |
| Doc search tool | `mastra/tools/search-documents.tool.ts`, `agents/orchestrator.agent.ts`, `agents/prompts.ts`, `tools/tool-context.ts` | conversation/owner-scoped document search |
| Extraction + ingest | `file-processor/services/document-extraction.service.ts`, `processors/file-processing.processor.ts`, `file.controller.ts` | extract text; in-process persist to `documents`; link file↔record; pass `conversationId` metadata |
| Collection bootstrap | search-service migration/seed | create `documents` collection field spec |

All new `/agent/*` and `/files/*` routes stay behind the global `JwtAuthGuard`; document ingest is owner-scoped (no admin requirement) because it runs in-process, not via `RecordController`.

---

## 9. Reuse map (do not rebuild)

- **AI UI:** `frontend/components/ai-elements/{chatbot,code}/*` — compose, don't author from scratch.
- **Upload:** `lib/hooks/use-file-upload.ts`, `lib/services/file.service.ts`, `app/dashboard/file-management/components/file-dropzone.tsx`.
- **Records:** `lib/services/record.service.ts` (`persist/query/get`), `components/data-management/record-data-table.tsx` (`buildColumns` + manual TanStack + `DataTablePagination`).
- **Agent client:** `lib/services/agent.service.ts` (+ extend with `getMessages`, streaming wired via transport), `lib/interfaces/mastra.interface.ts`.
- **Patterns:** `data-management.store.ts` (Zustand shape), `data-management-view.tsx` (view composition), `swr-fetcher.ts`, `lib/http/api-client.ts` + `token-store.ts`, `use-query-url-sync.ts`, `lib/auth/guards.tsx`.
- **Theme:** emerald oklch tokens in `app/globals.css`, Geist fonts, Hugeicons, `cn()`.

---

## 10. Phased implementation plan

- **Phase 0 — Backend foundations:** `documents` collection; `DocumentExtractionService` + ingest pipeline (docx/pdf/md); `GET /agent/conversations/:id/messages`; `POST /agent/chat/stream` (+resume); `search-documents` tool + prompt update.
- **Phase 1 — Chat shell & streaming:** add `@ai-sdk/react`; route + nav + `ChatView` + history rail + `chat-thread` + `chat-composer` on `useChat` streaming; empty state + suggestions; `?c=` URL sync.
- **Phase 2 — Tools, reasoning, HITL:** `chat-tool-call`, `Reasoning`/`ChainOfThought`, `chat-approval-card` + resume, `chat-citations`.
- **Phase 3 — Attachments & ingestion:** chat composer attachments → conversation-scoped doc records; data-management `document-upload-dialog`.
- **Phase 4 — History & polish:** full rehydration, rename/delete conversation, optional `artifact-panel`, mobile `Sheet` rail, a11y (`role="log"`, focus), dark-mode QA.

---

## 11. Verification

- **Frontend (Vitest, co-located `__tests__/`, `*.test.tsx`, `@testing-library/react` + `axios-mock-adapter`):**
  - `chat.store` reducers; `use-conversations`/`use-conversation-messages`/`use-chat-attachments` (mocked services); `chat-thread` renders text/reasoning/tool/citation parts; `chat-approval-card` calls `decideApproval` + triggers resume; `chat-composer` submit/stop; `nav-main` includes Assistant entry. Streaming transport tested with a mocked SSE/data-stream reader.
- **Backend (Jest, `*.spec.ts`):**
  - `DocumentExtractionService` over docx/pdf/md fixtures; ingest pipeline (`getContentStream`→`persist`) writes a `documents` record + links file; `POST /agent/chat/stream` emits a data stream, writes `agent_run`, and suspends→`agent_approval` on an approval tool; `GET …/messages` maps to `UIMessage[]` and enforces ownership; `search-documents` applies the owner/conversation filter.
- **Manual E2E (dev):**
  1. Data-management → select `documents` → upload a pdf/docx/md → record appears.
  2. Assistant → new chat → attach a pdf → ask about it → agent calls `search-documents`, answer cites the doc.
  3. Ask something triggering `send-email` → `Confirmation` card → approve → stream resumes and completes.
  4. Refresh mid-conversation → history rail lists it, selecting rehydrates full thread.
  5. Toggle dark mode (`d`) and narrow viewport → rail collapses to `Sheet`, layout holds.

---

## Status & next step

This is the **design-stage** artifact of the `goal → design → plan → implement` session workflow. The design is approved. The next stage is a detailed, task-numbered **implementation plan** (TDD-style, per phase) before any code is written.
