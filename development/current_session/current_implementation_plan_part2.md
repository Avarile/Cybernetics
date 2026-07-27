# AI Assistant Frontend — Implementation Plan (Part 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Claude-style Assistant UI at `/dashboard/chat` — a streaming conversation with text, reasoning, tool-calls, and human-in-the-loop approvals, plus a conversation-history rail — composed from the already-installed AI Elements and wired to the Part-1 backend endpoints.

**Architecture:** The backend `POST /agent/chat/stream` emits a custom SSE protocol (documented below), so we do NOT use `@ai-sdk/react`'s `useChat` (not installed). Instead: a `fetch`-based streaming client (`agent-stream.ts`) parses the SSE frames and injects the Bearer token + refresh; a custom `useAgentChat` hook turns those events into a `ChatMessage[]` + a `ChatStatus`; thin `components/chat/*` wrappers render those with the AI Elements (which all accept plain data — no SDK objects). SWR loads the conversation list + rehydrates a thread's history (`GET /agent/conversations/:id/messages`, which returns exactly our `ChatMessage` shape). Zustand holds cross-cutting UI state (active conversation, rail toggle).

**Tech Stack:** Next.js 16 (App Router) + React 19, TypeScript, Vitest + Testing Library, Zustand v5, SWR v2, axios (`apiClient`) + raw `fetch` (SSE), Tailwind v4, shadcn/ui + Hugeicons, `ai` v6.0.146 (type-only imports). Base branch `feat/ai-main-dashboard` (Part-1 backend already committed here).

**Scope:** design Phases 1–2 (streaming chat + tools/reasoning/HITL + history). **Deferred to a Part 3 plan:** chat-composer attachments + data-management document upload (Phase 3), artifact panel + mobile polish (Phase 4).

## Global Constraints

- **All commands run from `frontend/`.** Test runner is **Vitest**: `npx vitest run <path>` (single file) / `npm test` (full). Typecheck: `npm run typecheck`. Read a file before editing it. Keep files under ~300 lines.
- **Import alias** `@/*` → `frontend/*`. Backend base URL = `clientEnv.apiUrl` (`NEXT_PUBLIC_API_URL`), **NO `/api` prefix** — routes are root-level. `apiClient` (axios) injects the bearer + refreshes; the SSE `fetch` must do the same manually (see Task 1).
- **Commits:** plain conventional messages, **NO `Co-Authored-By` trailer** (branch precedent + this repo's frontend convention). `git add` ONLY the task's explicit files — NEVER `.claude-flow/`, `.superpowers/`, `development/`, or daemon scratch. Explicit paths only.
- **Component placement:** all chat components under `frontend/components/chat/`. State under `frontend/lib/state-management/`, hooks under `frontend/lib/hooks/`, services under `frontend/lib/services/`, interfaces under `frontend/lib/interfaces/`. Co-locate tests in `__tests__/` named `*.test.ts`/`*.test.tsx`.
- **Quote style:** the app uses **single quotes** everywhere EXCEPT `components/app-sidebar.tsx` (double quotes) — match the file you're editing. `eslint --fix` resolves prettier nits.
- **AI Elements accept plain data** — do NOT construct AI-SDK `UIMessage`/`ToolUIPart` objects. `import type { ChatStatus } from 'ai'` is fine (type only). Watch-out: `MessageResponse`/`ReasoningContent`/`Shimmer` require `children: string`; there is no `PromptInputToolbar` (use `PromptInputFooter`/`PromptInputTools` or omit).
- No new npm dependencies. Everything needed is installed (`ai`, `swr`, `zustand`, `@hugeicons/*`, testing-library, `axios-mock-adapter`).

## SSE contract (consumed here; produced by Part-1 `POST /agent/chat/stream`)

Response is `text/event-stream`; each event is a line `data: <json>\n\n` where `<json>` is one of:
```
{ "type":"start",             "conversationId":string, "runId":string }
{ "type":"text-delta",        "delta":string }
{ "type":"reasoning-delta",   "delta":string }
{ "type":"tool-input",        "toolCallId":string, "toolName":string, "args":object }
{ "type":"tool-output",       "toolCallId":string, "toolName":string, "result":unknown, "isError":boolean }
{ "type":"approval-required", "approvalId":string, "toolCallId":string, "toolName":string, "actionType":string, "title":string, "payload":object }
{ "type":"error",             "message":string }
{ "type":"done",              "status":"succeeded"|"awaiting_approval"|"cancelled"|"failed" }
```
Request body: `{ conversationId?:string, message?:string, resume?:{ approvalId:string, approved:boolean } }` (exactly one of `message`/`resume`). `GET /agent/conversations/:id/messages` returns `ChatMessage[]` (same shape defined in Task 1). `GET /agent/conversations?page&limit` returns `Paginated<Conversation>`.

---

## File Structure

**New:**
- `frontend/lib/interfaces/chat.interface.ts` — `SseEvent`, `ChatPart`, `ChatMessage`, `ChatToolState`, `PendingApproval` (UI), `ChatStreamBody`.
- `frontend/lib/services/agent-stream.ts` — `streamAgentChat(body, { onEvent, signal })` (fetch + auth-refresh + SSE parse).
- `frontend/lib/hooks/use-conversations.ts`, `use-conversation-messages.ts` — SWR.
- `frontend/lib/state-management/chat.store.ts` — Zustand (active conversation + rail).
- `frontend/lib/hooks/use-agent-chat.ts` — the streaming chat state machine.
- `frontend/lib/hooks/use-chat-url-sync.ts` — `?c=` two-way sync.
- `frontend/components/chat/` — `chat-tool-part.tsx`, `chat-approval-card.tsx`, `chat-message.tsx`, `chat-composer.tsx`, `chat-thread.tsx`, `conversation-history-rail.tsx`, `chat-view.tsx`.
- `frontend/app/dashboard/chat/page.tsx`.

**Modified:**
- `frontend/lib/services/agent.service.ts` — add `getMessages(id)`.
- `frontend/components/app-sidebar.tsx` — add the "Assistant" nav entry.

---

## Task 1: Chat types + streaming SSE client

**Files:**
- Create: `frontend/lib/interfaces/chat.interface.ts`
- Create: `frontend/lib/services/agent-stream.ts`
- Test: `frontend/lib/services/__tests__/agent-stream.test.ts`

**Interfaces:**
- Consumes: `getAccessToken` (`@/lib/http/token-store`), `refreshSession` (`@/lib/auth/session`), `clientEnv.apiUrl` (`@/lib/config/env`), `ERROR_CODES` (`@/lib/config/constants`).
- Produces: the type module + `streamAgentChat(body: ChatStreamBody, opts: { onEvent: (e: SseEvent) => void; signal?: AbortSignal }): Promise<void>`.

- [ ] **Step 1: Write the types**

```ts
// frontend/lib/interfaces/chat.interface.ts
export type ChatRole = 'user' | 'assistant' | 'system'

/** Tool-invocation UI states — the AI Elements ToolHeader union (v5). History from the
 *  backend may carry v4-ish states ('call'/'result'); normalize with normalizeToolState. */
export type ChatToolState =
  | 'input-streaming' | 'input-available' | 'approval-requested'
  | 'approval-responded' | 'output-available' | 'output-denied' | 'output-error'

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; toolCallId: string; toolName: string; state: string; input?: unknown; output?: unknown; errorText?: string }
  | { type: 'source'; sourceId?: string; title?: string; url?: string; mediaType?: string }

/** The unified chat message — identical to the backend GET .../messages DTO. */
export interface ChatMessage {
  id: string
  role: ChatRole
  parts: ChatPart[]
  createdAt?: string
}

/** A HITL approval surfaced mid-stream. */
export interface UiApproval {
  approvalId: string
  toolCallId: string
  toolName: string
  actionType: string
  title: string
  payload: Record<string, unknown>
}

export type SseEvent =
  | { type: 'start'; conversationId: string; runId: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-input'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-output'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'approval-required'; approvalId: string; toolCallId: string; toolName: string; actionType: string; title: string; payload: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'done'; status: 'succeeded' | 'awaiting_approval' | 'cancelled' | 'failed' }

export interface ChatStreamBody {
  conversationId?: string
  message?: string
  resume?: { approvalId: string; approved: boolean }
}
```

- [ ] **Step 2: Write the failing streaming-client test** (establishes the repo's SSE-test pattern)

```ts
// frontend/lib/services/__tests__/agent-stream.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const refreshSession = vi.fn()
vi.mock('@/lib/auth/session', () => ({ refreshSession: (...a: unknown[]) => refreshSession(...a) }))
vi.mock('@/lib/http/token-store', () => ({ getAccessToken: () => 'tok-1' }))

import { streamAgentChat } from '@/lib/services/agent-stream'
import type { SseEvent } from '@/lib/interfaces/chat.interface'

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close() },
  })
}
const FRAMES = [
  'data: {"type":"start","conversationId":"c1","runId":"r1"}\n\n',
  'data: {"type":"text-delta","delta":"Hi "}\n\ndata: {"type":"text-delta","delta":"there"}\n\n',
  'data: {"type":"done","status":"succeeded"}\n\n',
]

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('streamAgentChat', () => {
  it('parses SSE frames (including two in one chunk) into events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: sseBody(FRAMES) }))
    const events: SseEvent[] = []
    await streamAgentChat({ message: 'hello' }, { onEvent: (e) => events.push(e) })
    expect(events.map((e) => e.type)).toEqual(['start', 'text-delta', 'text-delta', 'done'])
    expect(events[1]).toMatchObject({ type: 'text-delta', delta: 'Hi ' })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3000/agent/chat/stream')
    expect(init.headers.Authorization).toBe('Bearer tok-1')
    expect(JSON.parse(init.body)).toEqual({ message: 'hello' })
  })

  it('refreshes once and retries on an AUTH_TOKEN_EXPIRED response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: sseBody(['data: {"type":"done","status":"succeeded"}\n\n']) })
    vi.stubGlobal('fetch', fetchMock)
    refreshSession.mockResolvedValue({ accessToken: 'tok-2' })
    const events: SseEvent[] = []
    await streamAgentChat({ message: 'x' }, { onEvent: (e) => events.push(e) })
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(events.map((e) => e.type)).toEqual(['done'])
  })

  it('throws with the envelope message on a non-refreshable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: { code: 'FORBIDDEN', message: 'nope' } }) }))
    await expect(streamAgentChat({ message: 'x' }, { onEvent: () => {} })).rejects.toThrow('nope')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run lib/services/__tests__/agent-stream.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/agent-stream'`.

- [ ] **Step 4: Write the streaming client**

```ts
// frontend/lib/services/agent-stream.ts
import { clientEnv } from '@/lib/config/env'
import { ERROR_CODES } from '@/lib/config/constants'
import { getAccessToken } from '@/lib/http/token-store'
import { refreshSession } from '@/lib/auth/session'
import type { ChatStreamBody, SseEvent } from '@/lib/interfaces/chat.interface'

const ENDPOINT = `${clientEnv.apiUrl}/agent/chat/stream`

interface StreamOpts {
  onEvent: (event: SseEvent) => void
  signal?: AbortSignal
}

async function postStream(body: ChatStreamBody, signal?: AbortSignal): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })
}

/** POST the chat stream and invoke onEvent per SSE event. Injects the bearer and
 *  refreshes once on an AUTH_TOKEN_EXPIRED response (mirrors the api-client interceptor). */
export async function streamAgentChat(body: ChatStreamBody, opts: StreamOpts): Promise<void> {
  let res = await postStream(body, opts.signal)

  if (!res.ok) {
    const envelope = await res.json().catch(() => null)
    const code = envelope?.error?.code
    if (code === ERROR_CODES.AUTH_TOKEN_EXPIRED) {
      await refreshSession()
      res = await postStream(body, opts.signal)
    }
    if (!res.ok) {
      const msg = envelope?.error?.message ?? `Stream failed (${res.status})`
      throw new Error(msg)
    }
  }

  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const line = frame.trim()
      if (!line.startsWith('data:')) continue
      const json = line.slice(line.indexOf(':') + 1).trim()
      if (!json || json === '[DONE]') continue
      try {
        opts.onEvent(JSON.parse(json) as SseEvent)
      } catch {
        // ignore malformed frame
      }
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run lib/services/__tests__/agent-stream.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/interfaces/chat.interface.ts frontend/lib/services/agent-stream.ts frontend/lib/services/__tests__/agent-stream.test.ts
git commit -m "feat(chat): SSE streaming client + chat types"
```

---

## Task 2: `getMessages` service + conversation SWR hooks

**Files:**
- Modify: `frontend/lib/services/agent.service.ts`
- Create: `frontend/lib/hooks/use-conversations.ts`, `frontend/lib/hooks/use-conversation-messages.ts`
- Test: `frontend/lib/services/__tests__/agent.service.test.ts` (extend), `frontend/lib/hooks/__tests__/use-conversation-messages.test.tsx`

**Interfaces:**
- Consumes: `apiClient` (`@/lib/http/api-client`), `ChatMessage` (Task 1), `Conversation`/`Paginated` (existing).
- Produces: `agentService.getMessages(id): Promise<ChatMessage[]>`; `useConversations(page?)` → `{ conversations, isLoading, error, mutate }`; `useConversationMessages(id | null)` → `{ messages, isLoading, error }`.

- [ ] **Step 1: Extend the service + its test**

Add to `agent.service.ts` (match the file's existing style):
```ts
  getMessages(conversationId: string): Promise<ChatMessage[]> {
    return apiClient
      .get<ChatMessage[]>(`/agent/conversations/${conversationId}/messages`)
      .then((r) => r.data)
  },
```
(import `ChatMessage` from `@/lib/interfaces/chat.interface`.) Add to `agent.service.test.ts`:
```ts
it('getMessages GETs the conversation thread', async () => {
  mock.onGet('/agent/conversations/c1/messages').reply(200, [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }])
  const res = await agentService.getMessages('c1')
  expect(res[0].parts[0]).toEqual({ type: 'text', text: 'hi' })
})
```

- [ ] **Step 2: Write the SWR hooks**

```ts
// frontend/lib/hooks/use-conversations.ts
'use client'
import useSWR from 'swr'
import { agentService } from '@/lib/services/agent.service'
import type { Conversation } from '@/lib/interfaces/mastra.interface'
import type { Paginated } from '@/lib/interfaces/auth.interface'

export function useConversations(page = 1, limit = 30) {
  const { data, isLoading, error, mutate } = useSWR<Paginated<Conversation>>(
    ['agent', 'conversations', page, limit],
    () => agentService.listConversations(page, limit),
    { keepPreviousData: true },
  )
  return { conversations: data?.data ?? [], total: data?.total ?? 0, isLoading, error, mutate }
}
```
```ts
// frontend/lib/hooks/use-conversation-messages.ts
'use client'
import useSWR from 'swr'
import { agentService } from '@/lib/services/agent.service'
import type { ChatMessage } from '@/lib/interfaces/chat.interface'

/** Null id (a fresh chat) short-circuits — SWR skips fetching on a null key. */
export function useConversationMessages(conversationId: string | null) {
  const { data, isLoading, error } = useSWR<ChatMessage[]>(
    conversationId ? ['agent', 'conversation', conversationId, 'messages'] : null,
    () => agentService.getMessages(conversationId as string),
    { revalidateOnFocus: false },
  )
  return { messages: data ?? [], isLoading, error }
}
```

- [ ] **Step 3: Write the failing hook test**

```tsx
// frontend/lib/hooks/__tests__/use-conversation-messages.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import React from 'react'

vi.mock('@/lib/services/agent.service', () => ({ agentService: { getMessages: vi.fn() } }))
import { agentService } from '@/lib/services/agent.service'
import { useConversationMessages } from '@/lib/hooks/use-conversation-messages'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
beforeEach(() => vi.clearAllMocks())

describe('useConversationMessages', () => {
  it('fetches a thread when an id is given', async () => {
    vi.mocked(agentService.getMessages).mockResolvedValue([{ id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'yo' }] }])
    const { result } = renderHook(() => useConversationMessages('c1'), { wrapper })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(agentService.getMessages).toHaveBeenCalledWith('c1')
  })

  it('does NOT fetch for a null id (new chat)', async () => {
    const { result } = renderHook(() => useConversationMessages(null), { wrapper })
    expect(result.current.messages).toEqual([])
    expect(agentService.getMessages).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run tests to verify fail → pass**

Run: `cd frontend && npx vitest run lib/services/__tests__/agent.service.test.ts lib/hooks/__tests__/use-conversation-messages.test.tsx`
Expected: FAIL first (missing hook), then PASS after Steps 1–2 exist. (Write the failing test before the hook if following strict TDD; the hook code above is Step 2.)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/services/agent.service.ts frontend/lib/services/__tests__/agent.service.test.ts frontend/lib/hooks/use-conversations.ts frontend/lib/hooks/use-conversation-messages.ts frontend/lib/hooks/__tests__/use-conversation-messages.test.tsx
git commit -m "feat(chat): getMessages service + conversations/messages SWR hooks"
```

---

## Task 3: `chat.store.ts` (Zustand)

**Files:**
- Create: `frontend/lib/state-management/chat.store.ts`
- Test: `frontend/lib/state-management/__tests__/chat.store.test.ts`

**Interfaces:**
- Produces: `useChatStore`; selectors `useActiveConversationId`, `useSetActiveConversation`, `useHistoryRailOpen`, `useToggleHistoryRail`.

- [ ] **Step 1: Write the failing store test**

```ts
// frontend/lib/state-management/__tests__/chat.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '@/lib/state-management/chat.store'

beforeEach(() => useChatStore.setState({ activeConversationId: null, historyRailOpen: true }))

describe('chat.store', () => {
  it('sets the active conversation', () => {
    useChatStore.getState().setActiveConversation('c1')
    expect(useChatStore.getState().activeConversationId).toBe('c1')
    useChatStore.getState().setActiveConversation(null)
    expect(useChatStore.getState().activeConversationId).toBeNull()
  })
  it('toggles the history rail', () => {
    expect(useChatStore.getState().historyRailOpen).toBe(true)
    useChatStore.getState().toggleHistoryRail()
    expect(useChatStore.getState().historyRailOpen).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `cd frontend && npx vitest run lib/state-management/__tests__/chat.store.test.ts` → FAIL (missing module).

- [ ] **Step 3: Write the store**

```ts
// frontend/lib/state-management/chat.store.ts
'use client'
import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'

interface ChatState {
  activeConversationId: string | null
  historyRailOpen: boolean
  setActiveConversation: (id: string | null) => void
  toggleHistoryRail: () => void
}

const creator: StateCreator<ChatState, [['zustand/devtools', never]], [], ChatState> = (set) => ({
  activeConversationId: null,
  historyRailOpen: true,
  setActiveConversation: (id) => set({ activeConversationId: id }, false, 'chat/setActiveConversation'),
  toggleHistoryRail: () => set((s) => ({ historyRailOpen: !s.historyRailOpen }), false, 'chat/toggleHistoryRail'),
})

export const useChatStore = create<ChatState>()(
  devtools(creator, { name: 'ChatStore', enabled: process.env.NODE_ENV === 'development' }),
)

// ── selectors ──────────────────────────────────────────────────────
export const useActiveConversationId = () => useChatStore((s) => s.activeConversationId)
export const useSetActiveConversation = () => useChatStore((s) => s.setActiveConversation)
export const useHistoryRailOpen = () => useChatStore((s) => s.historyRailOpen)
export const useToggleHistoryRail = () => useChatStore((s) => s.toggleHistoryRail)
```

- [ ] **Step 4: Run to verify pass.** Same command → PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add frontend/lib/state-management/chat.store.ts frontend/lib/state-management/__tests__/chat.store.test.ts
git commit -m "feat(chat): chat UI store (active conversation + history rail)"
```

---

## Task 4: `use-agent-chat.ts` — the streaming state machine

**Files:**
- Create: `frontend/lib/hooks/use-agent-chat.ts`
- Test: `frontend/lib/hooks/__tests__/use-agent-chat.test.tsx`

**Interfaces:**
- Consumes: `streamAgentChat` (Task 1, mocked in tests), `ChatMessage`/`SseEvent`/`UiApproval` (Task 1).
- Produces: `useAgentChat({ conversationId, initialMessages, onConversationId }) → { messages, status, pendingApproval, sendMessage(text), stop(), respondApproval(approved) }`. `status: ChatStatus` = `'ready'|'submitted'|'streaming'|'error'`.

- [ ] **Step 1: Write the failing hook test** (drive the state machine by mocking `streamAgentChat`)

```tsx
// frontend/lib/hooks/__tests__/use-agent-chat.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { SseEvent } from '@/lib/interfaces/chat.interface'

const streamAgentChat = vi.fn()
vi.mock('@/lib/services/agent-stream', () => ({ streamAgentChat: (...a: unknown[]) => streamAgentChat(...a) }))
import { useAgentChat } from '@/lib/hooks/use-agent-chat'

// Helper: a streamAgentChat mock that emits a scripted list of events.
function emits(events: SseEvent[]) {
  return vi.fn(async (_body: unknown, opts: { onEvent: (e: SseEvent) => void }) => {
    for (const e of events) opts.onEvent(e)
  })
}
beforeEach(() => vi.clearAllMocks())

describe('useAgentChat', () => {
  it('appends the user message, streams assistant text, and ends ready', async () => {
    streamAgentChat.mockImplementation(emits([
      { type: 'start', conversationId: 'c1', runId: 'r1' },
      { type: 'text-delta', delta: 'Hel' },
      { type: 'text-delta', delta: 'lo' },
      { type: 'done', status: 'succeeded' },
    ]))
    const onConversationId = vi.fn()
    const { result } = renderHook(() => useAgentChat({ conversationId: null, initialMessages: [], onConversationId }))
    await act(async () => { await result.current.sendMessage('hi') })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const roles = result.current.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant'])
    const assistantText = result.current.messages[1].parts.find((p) => p.type === 'text')
    expect(assistantText).toEqual({ type: 'text', text: 'Hello' })
    expect(onConversationId).toHaveBeenCalledWith('c1')
  })

  it('surfaces a pending approval and clears it on respondApproval (stream resume)', async () => {
    streamAgentChat.mockImplementationOnce(emits([
      { type: 'start', conversationId: 'c1', runId: 'r1' },
      { type: 'tool-input', toolCallId: 't1', toolName: 'send-email', args: { to: 'x@y.z' } },
      { type: 'approval-required', approvalId: 'a1', toolCallId: 't1', toolName: 'send-email', actionType: 'send_email', title: 'Approve send-email', payload: {} },
      { type: 'done', status: 'awaiting_approval' },
    ]))
    const { result } = renderHook(() => useAgentChat({ conversationId: 'c1', initialMessages: [], onConversationId: vi.fn() }))
    await act(async () => { await result.current.sendMessage('email x') })
    await waitFor(() => expect(result.current.pendingApproval?.approvalId).toBe('a1'))

    streamAgentChat.mockImplementationOnce(emits([
      { type: 'text-delta', delta: 'sent!' },
      { type: 'tool-output', toolCallId: 't1', toolName: 'send-email', result: { ok: true }, isError: false },
      { type: 'done', status: 'succeeded' },
    ]))
    await act(async () => { await result.current.respondApproval(true) })
    await waitFor(() => expect(result.current.pendingApproval).toBeNull())
    expect(streamAgentChat.mock.calls[1][0]).toEqual({ conversationId: 'c1', resume: { approvalId: 'a1', approved: true } })
    expect(result.current.status).toBe('ready')
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `cd frontend && npx vitest run lib/hooks/__tests__/use-agent-chat.test.tsx` → FAIL (missing module).

- [ ] **Step 3: Write the hook**

```ts
// frontend/lib/hooks/use-agent-chat.ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatStatus } from 'ai'
import { streamAgentChat } from '@/lib/services/agent-stream'
import type { ChatMessage, ChatPart, SseEvent, UiApproval } from '@/lib/interfaces/chat.interface'

let seq = 0
const nextId = () => `local-${Date.now()}-${seq++}`

interface Params {
  conversationId: string | null
  initialMessages: ChatMessage[]
  onConversationId?: (id: string) => void
}

/** Mutates the LAST assistant message in `list` via `fn`, returning a new array. */
function patchAssistant(list: ChatMessage[], fn: (parts: ChatPart[]) => ChatPart[]): ChatMessage[] {
  const idx = [...list].reverse().findIndex((m) => m.role === 'assistant')
  if (idx === -1) return list
  const realIdx = list.length - 1 - idx
  const next = list.slice()
  next[realIdx] = { ...next[realIdx], parts: fn(next[realIdx].parts.slice()) }
  return next
}

function upsertText(parts: ChatPart[], delta: string, kind: 'text' | 'reasoning'): ChatPart[] {
  const i = parts.findIndex((p) => p.type === kind)
  if (i === -1) return [...parts, { type: kind, text: delta }]
  const p = parts[i] as { type: 'text' | 'reasoning'; text: string }
  parts[i] = { ...p, text: p.text + delta }
  return parts
}

function upsertTool(parts: ChatPart[], toolCallId: string, patch: Partial<Extract<ChatPart, { type: 'tool' }>>): ChatPart[] {
  const i = parts.findIndex((p) => p.type === 'tool' && p.toolCallId === toolCallId)
  if (i === -1) return [...parts, { type: 'tool', toolCallId, toolName: '', state: 'input-available', ...patch }]
  parts[i] = { ...(parts[i] as object), ...patch } as ChatPart
  return parts
}

export function useAgentChat({ conversationId, initialMessages, onConversationId }: Params) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [status, setStatus] = useState<ChatStatus>('ready')
  const [pendingApproval, setPendingApproval] = useState<UiApproval | null>(null)
  const convRef = useRef<string | null>(conversationId)
  const abortRef = useRef<AbortController | null>(null)

  // Reset when switching conversations (seed from freshly-fetched history).
  useEffect(() => {
    convRef.current = conversationId
    setMessages(initialMessages)
    setStatus('ready')
    setPendingApproval(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, initialMessages])

  const handleEvent = useCallback((e: SseEvent) => {
    switch (e.type) {
      case 'start':
        if (!convRef.current) { convRef.current = e.conversationId; onConversationId?.(e.conversationId) }
        setStatus('streaming')
        break
      case 'text-delta':
        setMessages((m) => patchAssistant(m, (p) => upsertText(p, e.delta, 'text')))
        break
      case 'reasoning-delta':
        setMessages((m) => patchAssistant(m, (p) => upsertText(p, e.delta, 'reasoning')))
        break
      case 'tool-input':
        setMessages((m) => patchAssistant(m, (p) => upsertTool(p, e.toolCallId, { toolName: e.toolName, state: 'input-available', input: e.args })))
        break
      case 'tool-output':
        setMessages((m) => patchAssistant(m, (p) => upsertTool(p, e.toolCallId, { toolName: e.toolName, state: e.isError ? 'output-error' : 'output-available', output: e.result, errorText: e.isError ? String((e.result as { message?: string })?.message ?? 'error') : undefined })))
        break
      case 'approval-required':
        setPendingApproval({ approvalId: e.approvalId, toolCallId: e.toolCallId, toolName: e.toolName, actionType: e.actionType, title: e.title, payload: e.payload })
        setMessages((m) => patchAssistant(m, (p) => upsertTool(p, e.toolCallId, { toolName: e.toolName, state: 'approval-requested' })))
        break
      case 'error':
        setMessages((m) => patchAssistant(m, (p) => upsertText(p, `\n\n_Error: ${e.message}_`, 'text')))
        setStatus('error')
        break
      case 'done':
        setStatus('ready')
        break
    }
  }, [onConversationId])

  const run = useCallback(async (body: Parameters<typeof streamAgentChat>[0]) => {
    abortRef.current = new AbortController()
    setStatus('submitted')
    try {
      await streamAgentChat(body, { onEvent: handleEvent, signal: abortRef.current.signal })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((m) => patchAssistant(m, (p) => upsertText(p, `\n\n_Error: ${(err as Error).message}_`, 'text')))
        setStatus('error')
      } else {
        setStatus('ready')
      }
    }
  }, [handleEvent])

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || status === 'submitted' || status === 'streaming') return
    setMessages((m) => [
      ...m,
      { id: nextId(), role: 'user', parts: [{ type: 'text', text: trimmed }] },
      { id: nextId(), role: 'assistant', parts: [] },
    ])
    await run({ conversationId: convRef.current ?? undefined, message: trimmed })
  }, [run, status])

  const respondApproval = useCallback(async (approved: boolean) => {
    const appr = pendingApproval
    if (!appr) return
    setPendingApproval(null)
    setMessages((m) => patchAssistant(m, (p) => upsertTool(p, appr.toolCallId, { state: 'approval-responded' })))
    await run({ conversationId: convRef.current ?? undefined, resume: { approvalId: appr.approvalId, approved } })
  }, [pendingApproval, run])

  const stop = useCallback(() => { abortRef.current?.abort(); setStatus('ready') }, [])

  return { messages, status, pendingApproval, sendMessage, stop, respondApproval }
}
```

- [ ] **Step 4: Run to verify it passes.** Same command → PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add frontend/lib/hooks/use-agent-chat.ts frontend/lib/hooks/__tests__/use-agent-chat.test.tsx
git commit -m "feat(chat): useAgentChat streaming state machine (text/reasoning/tools/HITL)"
```

---

## Task 5: Message renderers (`chat-tool-part`, `chat-approval-card`, `chat-message`)

**Files:**
- Create: `frontend/components/chat/chat-tool-part.tsx`, `chat-approval-card.tsx`, `chat-message.tsx`
- Test: `frontend/components/chat/__tests__/chat-message.test.tsx`

**Interfaces:**
- Consumes: AI Elements `Message`/`MessageContent`/`MessageResponse` (`@/components/ai-elements/chatbot/message`), `Reasoning`/`ReasoningTrigger`/`ReasoningContent` (`.../reasoning`), `Tool`/`ToolHeader`/`ToolContent`/`ToolInput`/`ToolOutput` (`@/components/ai-elements/code/tool`), `Confirmation`/`ConfirmationTitle`/`ConfirmationRequest`/`ConfirmationActions`/`ConfirmationAction` (`.../confirmation`); `ChatMessage`/`ChatPart`/`UiApproval` (Task 1).
- Produces: `<ChatMessage message onRespondApproval? pendingApproval? />`, `<ChatToolPart part />` (with `normalizeToolState`), `<ChatApprovalCard approval onRespond />`.

- [ ] **Step 1: Write `chat-tool-part.tsx`** (normalize v4→v5 states; render the Tool element from plain data)

```tsx
// frontend/components/chat/chat-tool-part.tsx
'use client'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/code/tool'
import type { ChatPart, ChatToolState } from '@/lib/interfaces/chat.interface'

/** Backend history carries Mastra/v4 states ('call'/'result'/'partial-call'); live SSE uses v5.
 *  Normalize both to the AI Elements ToolHeader union. */
export function normalizeToolState(state: string): ChatToolState {
  switch (state) {
    case 'call': return 'input-available'
    case 'partial-call': return 'input-streaming'
    case 'result': return 'output-available'
    case 'input-streaming':
    case 'input-available':
    case 'approval-requested':
    case 'approval-responded':
    case 'output-available':
    case 'output-denied':
    case 'output-error':
      return state
    default: return 'output-available'
  }
}

export function ChatToolPart({ part }: { part: Extract<ChatPart, { type: 'tool' }> }) {
  const state = normalizeToolState(part.state)
  return (
    <Tool>
      <ToolHeader type="dynamic-tool" state={state} toolName={part.toolName || 'tool'} />
      <ToolContent>
        {part.input !== undefined && <ToolInput input={part.input} />}
        {(part.output !== undefined || part.errorText) && (
          <ToolOutput output={part.output as never} errorText={part.errorText} />
        )}
      </ToolContent>
    </Tool>
  )
}
```

- [ ] **Step 2: Write `chat-approval-card.tsx`**

```tsx
// frontend/components/chat/chat-approval-card.tsx
'use client'
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle } from '@/components/ai-elements/chatbot/confirmation'
import type { UiApproval } from '@/lib/interfaces/chat.interface'

export function ChatApprovalCard({ approval, onRespond }: { approval: UiApproval; onRespond: (approved: boolean) => void }) {
  return (
    <Confirmation state="approval-requested" approval={{ id: approval.approvalId }}>
      <ConfirmationRequest>
        <ConfirmationTitle>{approval.title}</ConfirmationTitle>
        <ConfirmationActions>
          <ConfirmationAction variant="outline" onClick={() => onRespond(false)}>Reject</ConfirmationAction>
          <ConfirmationAction onClick={() => onRespond(true)}>Approve</ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationRequest>
    </Confirmation>
  )
}
```

- [ ] **Step 3: Write `chat-message.tsx`** (render a whole message's parts in order)

```tsx
// frontend/components/chat/chat-message.tsx
'use client'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/chatbot/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/chatbot/reasoning'
import { ChatToolPart } from '@/components/chat/chat-tool-part'
import { ChatApprovalCard } from '@/components/chat/chat-approval-card'
import type { ChatMessage as ChatMessageType, UiApproval } from '@/lib/interfaces/chat.interface'

interface Props {
  message: ChatMessageType
  isStreaming?: boolean
  pendingApproval?: UiApproval | null
  onRespondApproval?: (approved: boolean) => void
}

export function ChatMessage({ message, isStreaming, pendingApproval, onRespondApproval }: Props) {
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, i) => {
          switch (part.type) {
            case 'text':
              return <MessageResponse key={i} isAnimating={isStreaming}>{part.text}</MessageResponse>
            case 'reasoning':
              return (
                <Reasoning key={i} isStreaming={isStreaming}>
                  <ReasoningTrigger />
                  <ReasoningContent>{part.text}</ReasoningContent>
                </Reasoning>
              )
            case 'tool':
              return (
                <div key={i} className="space-y-2">
                  <ChatToolPart part={part} />
                  {pendingApproval && pendingApproval.toolCallId === part.toolCallId && onRespondApproval && (
                    <ChatApprovalCard approval={pendingApproval} onRespond={onRespondApproval} />
                  )}
                </div>
              )
            default:
              return null // 'source' rendered inline in a later phase
          }
        })}
      </MessageContent>
    </Message>
  )
}
```

- [ ] **Step 4: Write the failing test**

```tsx
// frontend/components/chat/__tests__/chat-message.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatMessage } from '@/components/chat/chat-message'
import { normalizeToolState } from '@/components/chat/chat-tool-part'

describe('normalizeToolState', () => {
  it('maps v4 states to the v5 union', () => {
    expect(normalizeToolState('call')).toBe('input-available')
    expect(normalizeToolState('result')).toBe('output-available')
    expect(normalizeToolState('approval-requested')).toBe('approval-requested')
  })
})

describe('ChatMessage', () => {
  it('renders assistant text', () => {
    render(<ChatMessage message={{ id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'Hello world' }] }} />)
    expect(screen.getByText(/Hello world/)).toBeInTheDocument()
  })
  it('renders an approval card for a pending tool and wires the buttons', () => {
    const onRespond = vi.fn()
    render(
      <ChatMessage
        message={{ id: 'm2', role: 'assistant', parts: [{ type: 'tool', toolCallId: 't1', toolName: 'send-email', state: 'approval-requested' }] }}
        pendingApproval={{ approvalId: 'a1', toolCallId: 't1', toolName: 'send-email', actionType: 'send_email', title: 'Approve send-email', payload: {} }}
        onRespondApproval={onRespond}
      />,
    )
    screen.getByRole('button', { name: /approve/i }).click()
    expect(onRespond).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 5: Run fail → implement → pass.** `cd frontend && npx vitest run components/chat/__tests__/chat-message.test.tsx` → PASS.

- [ ] **Step 6: Commit**
```bash
git add frontend/components/chat/chat-tool-part.tsx frontend/components/chat/chat-approval-card.tsx frontend/components/chat/chat-message.tsx frontend/components/chat/__tests__/chat-message.test.tsx
git commit -m "feat(chat): message part renderers (text/reasoning/tool/approval)"
```

---

## Task 6: `chat-composer.tsx`

**Files:**
- Create: `frontend/components/chat/chat-composer.tsx`
- Test: `frontend/components/chat/__tests__/chat-composer.test.tsx`

**Interfaces:**
- Consumes: `PromptInput`/`PromptInputTextarea`/`PromptInputSubmit` (`@/components/ai-elements/chatbot/prompt-input`), `ChatStatus` from `ai`.
- Produces: `<ChatComposer status onSend(text) onStop />`.

- [ ] **Step 1: Write the composer**

```tsx
// frontend/components/chat/chat-composer.tsx
'use client'
import type { ChatStatus } from 'ai'
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from '@/components/ai-elements/chatbot/prompt-input'

interface Props {
  status: ChatStatus
  onSend: (text: string) => void
  onStop?: () => void
}

export function ChatComposer({ status, onSend, onStop }: Props) {
  return (
    <PromptInput
      className="mx-auto w-full max-w-3xl"
      onSubmit={(message) => {
        if (message.text.trim()) onSend(message.text)
      }}
    >
      <PromptInputTextarea placeholder="Message the assistant…" />
      <PromptInputSubmit status={status} onStop={onStop} />
    </PromptInput>
  )
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/components/chat/__tests__/chat-composer.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatComposer } from '@/components/chat/chat-composer'

describe('ChatComposer', () => {
  it('sends the typed text on submit (Enter)', async () => {
    const onSend = vi.fn()
    render(<ChatComposer status="ready" onSend={onSend} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'hello there')
    await userEvent.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('hello there')
  })
  it('shows a stop affordance while streaming', () => {
    const onStop = vi.fn()
    render(<ChatComposer status="streaming" onSend={vi.fn()} onStop={onStop} />)
    // the submit button becomes a stop button (type=button) while streaming
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run fail → pass.** `cd frontend && npx vitest run components/chat/__tests__/chat-composer.test.tsx`. If `PromptInput` doesn't clear the textarea on submit automatically, hold the value in local state and clear it in `onSubmit` — verify against the component and adjust; keep the test asserting `onSend`.

- [ ] **Step 4: Commit**
```bash
git add frontend/components/chat/chat-composer.tsx frontend/components/chat/__tests__/chat-composer.test.tsx
git commit -m "feat(chat): prompt composer (send + stop)"
```

---

## Task 7: `chat-thread.tsx`

**Files:**
- Create: `frontend/components/chat/chat-thread.tsx`
- Test: `frontend/components/chat/__tests__/chat-thread.test.tsx`

**Interfaces:**
- Consumes: `Conversation`/`ConversationContent`/`ConversationScrollButton`/`ConversationEmptyState` (`@/components/ai-elements/chatbot/conversation`); `ChatMessage` component (Task 5); `ChatMessage`/`UiApproval` types.
- Produces: `<ChatThread messages status pendingApproval onRespondApproval />`.

- [ ] **Step 1: Write the thread**

```tsx
// frontend/components/chat/chat-thread.tsx
'use client'
import type { ChatStatus } from 'ai'
import { HugeiconsIcon } from '@hugeicons/react'
import { AiChat01Icon } from '@hugeicons/core-free-icons'
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '@/components/ai-elements/chatbot/conversation'
import { ChatMessage } from '@/components/chat/chat-message'
import type { ChatMessage as ChatMessageType, UiApproval } from '@/lib/interfaces/chat.interface'

interface Props {
  messages: ChatMessageType[]
  status: ChatStatus
  pendingApproval: UiApproval | null
  onRespondApproval: (approved: boolean) => void
}

export function ChatThread({ messages, status, pendingApproval, onRespondApproval }: Props) {
  const lastId = messages[messages.length - 1]?.id
  return (
    <Conversation className="flex-1">
      <ConversationContent className="mx-auto w-full max-w-3xl">
        {messages.length === 0 ? (
          <ConversationEmptyState
            title="How can I help?"
            description="Ask a question, or reference your uploaded documents."
            icon={<HugeiconsIcon icon={AiChat01Icon} className="size-6" strokeWidth={2} />}
          />
        ) : (
          messages.map((m) => (
            <ChatMessage
              key={m.id}
              message={m}
              isStreaming={status === 'streaming' && m.id === lastId && m.role === 'assistant'}
              pendingApproval={m.role === 'assistant' ? pendingApproval : null}
              onRespondApproval={onRespondApproval}
            />
          ))
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/components/chat/__tests__/chat-thread.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatThread } from '@/components/chat/chat-thread'

const noop = vi.fn()
describe('ChatThread', () => {
  it('shows the empty state with no messages', () => {
    render(<ChatThread messages={[]} status="ready" pendingApproval={null} onRespondApproval={noop} />)
    expect(screen.getByText(/how can i help/i)).toBeInTheDocument()
  })
  it('renders user + assistant messages', () => {
    render(
      <ChatThread
        status="ready" pendingApproval={null} onRespondApproval={noop}
        messages={[
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'ping' }] },
          { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'pong' }] },
        ]}
      />,
    )
    expect(screen.getByText('ping')).toBeInTheDocument()
    expect(screen.getByText('pong')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run fail → pass.** `cd frontend && npx vitest run components/chat/__tests__/chat-thread.test.tsx`.

- [ ] **Step 4: Commit**
```bash
git add frontend/components/chat/chat-thread.tsx frontend/components/chat/__tests__/chat-thread.test.tsx
git commit -m "feat(chat): conversation thread (stream log + empty state)"
```

---

## Task 8: `conversation-history-rail.tsx`

**Files:**
- Create: `frontend/components/chat/conversation-history-rail.tsx`
- Test: `frontend/components/chat/__tests__/conversation-history-rail.test.tsx`

**Interfaces:**
- Consumes: `useConversations` (Task 2, mocked in test); `ScrollArea` (`@/components/ui/scroll-area`), `Button` (`@/components/ui/button`), `Empty` (`@/components/ui/empty`) if present else a plain div.
- Produces: `<ConversationHistoryRail activeId onSelect(id|null) />` — a "New chat" button + the conversation list with active highlight.

- [ ] **Step 1: Write the rail**

```tsx
// frontend/components/chat/conversation-history-rail.tsx
'use client'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useConversations } from '@/lib/hooks/use-conversations'

interface Props {
  activeId: string | null
  onSelect: (id: string | null) => void
}

export function ConversationHistoryRail({ activeId, onSelect }: Props) {
  const { conversations, isLoading } = useConversations()
  return (
    <div className="flex h-full w-64 flex-col gap-2 border-r p-2">
      <Button variant="outline" className="justify-start gap-2" onClick={() => onSelect(null)}>
        <HugeiconsIcon icon={PlusSignIcon} className="size-4" strokeWidth={2} />
        New chat
      </Button>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1">
          {isLoading && <p className="px-2 py-1 text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && conversations.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground">No conversations yet</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                'truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                c.id === activeId && 'bg-accent font-medium',
              )}
            >
              {c.title || 'Untitled conversation'}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/components/chat/__tests__/conversation-history-rail.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/lib/hooks/use-conversations', () => ({ useConversations: vi.fn() }))
import { useConversations } from '@/lib/hooks/use-conversations'
import { ConversationHistoryRail } from '@/components/chat/conversation-history-rail'

beforeEach(() => vi.clearAllMocks())
describe('ConversationHistoryRail', () => {
  it('lists conversations and highlights the active one', () => {
    vi.mocked(useConversations).mockReturnValue({ conversations: [{ id: 'c1', title: 'First', createdAt: '', updatedAt: '' }], total: 1, isLoading: false, error: undefined, mutate: vi.fn() } as never)
    render(<ConversationHistoryRail activeId="c1" onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
    expect(screen.getByText('First')).toBeInTheDocument()
  })
  it('starts a new chat', () => {
    vi.mocked(useConversations).mockReturnValue({ conversations: [], total: 0, isLoading: false, error: undefined, mutate: vi.fn() } as never)
    const onSelect = vi.fn()
    render(<ConversationHistoryRail activeId={null} onSelect={onSelect} />)
    screen.getByRole('button', { name: /new chat/i }).click()
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 3: Run fail → pass.** Verify `PlusSignIcon` exists in `@hugeicons/core-free-icons` (grep); if not, use `Add01Icon`. Verify `@/components/ui/empty` — omit it (used a plain `<p>` above).

- [ ] **Step 4: Commit**
```bash
git add frontend/components/chat/conversation-history-rail.tsx frontend/components/chat/__tests__/conversation-history-rail.test.tsx
git commit -m "feat(chat): conversation history rail (list + new chat + active highlight)"
```

---

## Task 9: `chat-view.tsx` + `use-chat-url-sync.ts`

**Files:**
- Create: `frontend/components/chat/chat-view.tsx`, `frontend/lib/hooks/use-chat-url-sync.ts`
- Test: `frontend/components/chat/__tests__/chat-view.test.tsx`

**Interfaces:**
- Consumes: `useChatStore` selectors (Task 3), `useConversationMessages` (Task 2), `useAgentChat` (Task 4), `useConversations` mutate, `ConversationHistoryRail`/`ChatThread`/`ChatComposer`.
- Produces: `<ChatView />` — the orchestrator; `useChatUrlSync()` (`?c=` two-way sync mirroring `use-query-url-sync.ts`).

- [ ] **Step 1: Write `use-chat-url-sync.ts`** (hydrate `?c=` → store, write store → URL; two-effect + skip-once, per the `use-query-url-sync.ts` precedent)

```ts
// frontend/lib/hooks/use-chat-url-sync.ts
'use client'
import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useChatStore } from '@/lib/state-management/chat.store'

export function useChatUrlSync() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const activeId = useChatStore((s) => s.activeConversationId)
  const setActive = useChatStore((s) => s.setActiveConversation)
  const hydrated = React.useRef(false)
  const justHydrated = React.useRef(false)

  React.useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    const c = params.get('c')
    if (c) setActive(c)
    justHydrated.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (!hydrated.current) return
    if (justHydrated.current) { justHydrated.current = false; return }
    const next = new URLSearchParams()
    if (activeId) next.set('c', activeId)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [activeId, pathname, router])
}
```

- [ ] **Step 2: Write `chat-view.tsx`**

```tsx
// frontend/components/chat/chat-view.tsx
'use client'
import { useSWRConfig } from 'swr'
import { useActiveConversationId, useSetActiveConversation } from '@/lib/state-management/chat.store'
import { useConversationMessages } from '@/lib/hooks/use-conversation-messages'
import { useAgentChat } from '@/lib/hooks/use-agent-chat'
import { useChatUrlSync } from '@/lib/hooks/use-chat-url-sync'
import { ConversationHistoryRail } from '@/components/chat/conversation-history-rail'
import { ChatThread } from '@/components/chat/chat-thread'
import { ChatComposer } from '@/components/chat/chat-composer'

export function ChatView() {
  useChatUrlSync()
  const { mutate } = useSWRConfig()
  const activeConversationId = useActiveConversationId()
  const setActiveConversation = useSetActiveConversation()
  const { messages: history } = useConversationMessages(activeConversationId)

  const { messages, status, pendingApproval, sendMessage, stop, respondApproval } = useAgentChat({
    conversationId: activeConversationId,
    initialMessages: history,
    onConversationId: (id) => {
      setActiveConversation(id)
      void mutate((key) => Array.isArray(key) && key[0] === 'agent' && key[1] === 'conversations')
    },
  })

  return (
    <div className="flex h-[calc(100svh-var(--header-height))] min-h-0">
      <ConversationHistoryRail activeId={activeConversationId} onSelect={setActiveConversation} />
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatThread messages={messages} status={status} pendingApproval={pendingApproval} onRespondApproval={respondApproval} />
        <div className="border-t p-3">
          <ChatComposer status={status} onSend={sendMessage} onStop={stop} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the failing test** (mock all the hooks; assert composition + send wiring)

```tsx
// frontend/components/chat/__tests__/chat-view.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => '/dashboard/chat', useSearchParams: () => new URLSearchParams() }))
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }))
vi.mock('@/lib/hooks/use-conversations', () => ({ useConversations: () => ({ conversations: [], isLoading: false }) }))
vi.mock('@/lib/hooks/use-conversation-messages', () => ({ useConversationMessages: () => ({ messages: [] }) }))
const sendMessage = vi.fn()
vi.mock('@/lib/hooks/use-agent-chat', () => ({
  useAgentChat: () => ({ messages: [], status: 'ready', pendingApproval: null, sendMessage, stop: vi.fn(), respondApproval: vi.fn() }),
}))

import { ChatView } from '@/components/chat/chat-view'
beforeEach(() => vi.clearAllMocks())

describe('ChatView', () => {
  it('renders the rail + thread + composer and sends a message', async () => {
    render(<ChatView />)
    expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
    expect(screen.getByText(/how can i help/i)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox'), 'hi')
    await userEvent.keyboard('{Enter}')
    expect(sendMessage).toHaveBeenCalledWith('hi')
  })
})
```

- [ ] **Step 4: Run fail → pass.** `cd frontend && npx vitest run components/chat/__tests__/chat-view.test.tsx`.

- [ ] **Step 5: Commit**
```bash
git add frontend/components/chat/chat-view.tsx frontend/lib/hooks/use-chat-url-sync.ts frontend/components/chat/__tests__/chat-view.test.tsx
git commit -m "feat(chat): ChatView orchestrator + ?c= URL sync"
```

---

## Task 10: Route + sidebar nav entry

**Files:**
- Create: `frontend/app/dashboard/chat/page.tsx`
- Modify: `frontend/components/app-sidebar.tsx`
- Test: `frontend/components/__tests__/nav-main.test.tsx` (extend)

**Interfaces:**
- Consumes: the page-shell pattern from `data-management/page.tsx`; `ChatView` (Task 9); the `NavMain` item shape.
- Produces: the `/dashboard/chat` route + an "Assistant" nav entry.

- [ ] **Step 1: Write the page** (copy the shell verbatim; swap the view)

```tsx
// frontend/app/dashboard/chat/page.tsx
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { ChatView } from '@/components/chat/chat-view'

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
          <div className="@container/main flex flex-1 flex-col">
            <ChatView />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

- [ ] **Step 2: Add the nav entry** — in `frontend/components/app-sidebar.tsx` (DOUBLE quotes here), add `AiChat01Icon` to the `@hugeicons/core-free-icons` import (line ~19) and prepend an entry to `data.navMain`:
```tsx
    {
      title: "Assistant",
      url: "/dashboard/chat",
      icon: (
        <HugeiconsIcon icon={AiChat01Icon} strokeWidth={2} />
      ),
    },
```

- [ ] **Step 3: Extend the nav test** — add to `frontend/components/__tests__/nav-main.test.tsx`:
```tsx
it('renders the Assistant entry linking to /dashboard/chat', () => {
  render(
    <TooltipProvider><SidebarProvider>
      <NavMain items={[{ title: 'Assistant', url: '/dashboard/chat' }]} />
    </SidebarProvider></TooltipProvider>,
  )
  expect(screen.getByRole('link', { name: /assistant/i })).toHaveAttribute('href', '/dashboard/chat')
})
```

- [ ] **Step 4: Verify build + full suite + typecheck**

Run: `cd frontend && npx vitest run components/__tests__/nav-main.test.tsx && npm run typecheck && npm run build`
Expected: tests pass; typecheck clean; production build succeeds (the new route compiles).

- [ ] **Step 5: Commit**
```bash
git add frontend/app/dashboard/chat/page.tsx frontend/components/app-sidebar.tsx frontend/components/__tests__/nav-main.test.tsx
git commit -m "feat(chat): /dashboard/chat route + Assistant sidebar entry"
```

---

## Manual end-to-end verification (after all tasks)

With the API running (Part-1 backend) + a logged-in non-admin user, `cd frontend && npm run dev`, open `/dashboard/chat`:
1. **Streaming:** type a question → the assistant reply streams token-by-token; the submit button shows the stop affordance while streaming; a new conversation appears in the rail and the URL gains `?c=<id>`.
2. **Tools + docs:** ask "summarize my uploaded documents" (after ingesting one via the Part-1 pipeline) → a `search-documents` tool card renders (input → output), then the streamed answer.
3. **HITL:** ask something triggering `send-email` → the stream pauses with an approval card; click **Approve** → the continuation streams and completes; the tool card moves to output. Click **Reject** on another → the run cancels.
4. **History:** reload the page (URL has `?c=`) → the thread rehydrates from `GET /agent/conversations/:id/messages` (text/reasoning/tool parts intact). Click a different conversation in the rail → it loads. Click **New chat** → empty state.
5. **Dark mode (`d`) + narrow width** → layout holds (rail + thread + composer).

## Self-review notes

- **Spec coverage (design Phases 1–2):** streaming chat (Tasks 1, 4), history rehydration (Task 2), tools/reasoning/HITL rendering (Task 5), composer/thread/rail (Tasks 6–8), orchestration + URL sync + route/nav (Tasks 9–10). ✓
- **Deferred to Part 3:** composer attachments + data-management document upload (design Phase 3); artifact panel + mobile `Sheet` rail + a11y polish (Phase 4).
- **Type consistency:** `ChatMessage`/`ChatPart`/`SseEvent`/`UiApproval`/`ChatToolState` defined in Task 1, reused everywhere; `useAgentChat`'s return shape (Task 4) is consumed verbatim by `ChatView` (Task 9); the SWR tuple keys (`['agent','conversations',…]`, `['agent','conversation',id,'messages']`) match between the hooks (Task 2) and the `onConversationId` mutate predicate (Task 9).
- **Verify-at-implementation flags (inline):** whether `PromptInput` self-clears on submit (Task 6); real Hugeicons exports `AiChat01Icon`/`PlusSignIcon` (Tasks 8, 10 — grep `@hugeicons/core-free-icons`; fall back to `Add01Icon`); the `Empty` primitive's presence (Task 8 — used a plain `<p>`); that `ConversationScrollButton`/`Conversation` render under jsdom without a real scroll container (Task 7 — if `use-stick-to-bottom` needs polyfills beyond the setup's `ResizeObserver`, wrap the assertion accordingly).
- **Auth:** the SSE `fetch` mirrors the api-client's single refresh-retry on `AUTH_TOKEN_EXPIRED`; it does NOT share the api-client's module-private single-flight guard (a concurrent stream + axios refresh could double-POST `/auth/refresh` — acceptable; note for Part 3 if it matters).
