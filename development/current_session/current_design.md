# Cybernetics Client — Frontend Design

> **Status:** design, pre-implementation.
> **Scope:** the whole `client/` application — the 3D System Core shell, its window
> system, the agent terminal, live voice, the feature-module tables, and the file
> ingest pipeline.
> **Backend:** `api/` as it exists today. Every endpoint named here was verified
> against a controller in `api/src/features/**`. Where a capability does not exist,
> it is called out in [§11 Open questions](#11-open-questions) rather than assumed.

---

## 1. Premise

After login the user is not dropped into a dashboard. They are dropped into a
**machine** — a dark, slowly turning 3D core that *is* the system. Each rotating
band is one live feature domain; its colour and brightness are that domain's real
state. Everything else — the agent terminal, a contacts table, settings, a voice
call — arrives as a window floating over that core, and leaves again.

The design goal is Claude's restraint applied to a machine-room aesthetic: quiet
surfaces, one accent, generous space, no chrome that isn't doing work.

### 1.1 What already exists

| Layer | State |
|---|---|
| `client/` | Next 16 · React 19.2 · Tailwind v4 · shadcn (`radix-vega`, olive base). **49 ai-elements** and **60+ ui primitives** vendored. Only stock demo pages. No zustand, no `three`. |
| `api/` | NestJS, **37 controllers / 16 domains**. Mastra agent with SSE streaming, approvals, schedules. Presigned upload → text extraction → search indexing, complete. |
| Reference | `cybernetics-agentics/client/src/components/SystemCore` — the 3D core, **partially**. See §4.1. |

### 1.2 Hard constraints discovered

These shaped the design and are non-negotiable:

1. **The API mounts at root.** No `setGlobalPrefix` anywhere in `api/src`. Base URL
   is the origin, not `/api`.
2. **Bearer only.** `main.ts` sets `credentials: false` — *"Bearer transport — no
   cookies, no CSRF surface"*. No cookie session is possible.
3. **The agent stream is SSE over `POST`.** `EventSource` only issues `GET`, so it
   cannot be used. The transport must be `fetch` + `ReadableStream`.
4. **The upload is a presigned multipart `POST` policy**, not a `PUT`, and it can
   short-circuit on content-address dedup. See §9.
5. **There is no public signup.** `users.controller.ts`: *"Admin-only user
   provisioning (no public signup)."*
6. **There is no realtime/voice backend.** No WebSocket gateway, no STT/TTS routes.
7. **The 3D reference is incomplete.** Its entire `data/` directory is missing. §4.1.

---

## 2. Application shell

### 2.1 Routes

The app is effectively single-route. Navigation is window state, not URL state.

```
app/
  layout.tsx              # fonts, ThemeProvider, TooltipProvider, Toaster (sonner)
  page.tsx                # redirect → /core
  core/
    page.tsx              # THE app: canvas + window layer + chrome
  reset-password/
    page.tsx              # standalone — reached from an email link, pre-auth
```

`core/page.tsx` renders three stacked layers:

```
┌──────────────────────────────────────────────────────────────┐
│  <SystemCoreCanvas />        z-0    full-viewport WebGL      │
│  <WindowLayer />             z-10   portal, sorted by zIndex │
│  <ShellChrome />             z-20   always-on controls       │
└──────────────────────────────────────────────────────────────┘
```

When unauthenticated, the canvas renders in a dimmed, `pointer-events-none`,
reduced-motion state behind the modal auth window. The machine is visibly *there*,
just not yours yet.

### 2.2 Persistent chrome

```
┌────────────────────────────────────────────────────────────────────┐
│ ◆ CYBERNETICS                    [◎ scanner] [⟲ reset] [⌘K]  [◐] ▾ │  ← top bar
│                                                                     │
│                                                                     │
│                          ( 3D core )                                │
│                                                                     │
│                                                                     │
│                                                          ┌────────┐ │
│                                                          │  🎙    │ │  ← voice FAB
│                                                          └────────┘ │
├────────────────────────────────────────────────────────────────────┤
│ ▣ Terminal   ▣ Contacts   ▣ Files                          3 open  │  ← dock
└────────────────────────────────────────────────────────────────────┘
```

| Element | Behaviour |
|---|---|
| Identity chip (top-left) | Wordmark; click opens the command palette. |
| Scanner / reset view | Ported from the reference's `Dialog.tsx` toolbar. Scene-only controls. |
| `⌘K` | `cmdk` palette: open any window, jump to a conversation, run a domain query. |
| Avatar menu | Profile, Settings, Notifications (with unread dot), Theme, Sign out. |
| Voice FAB (bottom-right) | Toggles the mic. **Does not own the voice window** — see §7.2. |
| Dock (bottom) | Minimised windows. Hidden when empty. Becomes a tab bar under `md`. |

All chrome uses semantic shadcn tokens. Only the canvas uses fixed colours (§4.3).

### 2.3 Responsive strategy

| Breakpoint | Shell |
|---|---|
| `< md` (mobile) | Canvas stays as backdrop but drops to `frameloop="demand"` and hides the scanner. **Every window becomes a full-screen `Sheet`.** Dock → bottom tab bar. Tables switch to a card list (`components/ui/item.tsx`). |
| `md – lg` (tablet) | Floating windows, but they open maximised by default. Drag enabled, resize disabled. |
| `≥ lg` (desktop) | Full window manager: free drag, resize, tile, multiple concurrent windows. |

One rule keeps this honest: **no feature component knows its breakpoint.** They
render content; `WindowFrame` decides whether that content lives in a floating
frame or a sheet.

---

## 3. Window manager

The goal file requires the terminal and the live-conversation window to be open
simultaneously, and requires the voice toggle to be independent of the voice
window's lifecycle. That rules out a modal stack. It does *not* justify a full
desktop metaphor — so this is deliberately the smallest thing that satisfies it.

### 3.1 Model

```ts
// lib/windows/types.ts
export type WindowKind =
  | 'auth' | 'terminal' | 'voice' | 'settings' | 'notifications' | 'profile'
  | 'files' | 'contacts' | 'knowledge' | 'projects' | 'tasks' | 'mailbox'
  | 'finance' | 'invoices' | 'tags' | 'activity' | 'search'
  | 'record-create' | 'record-edit' | 'record-detail' | 'confirm'

export interface WindowInstance {
  id: string                  // nanoid; stable across re-render
  kind: WindowKind
  title: string
  props?: Record<string, unknown>
  rect: { x: number; y: number; w: number; h: number }
  zIndex: number
  state: 'normal' | 'minimised' | 'maximised'
  modal: boolean              // true ⇒ focus trap + scrim, blocks the layer below
}

export interface WindowDescriptor {
  kind: WindowKind
  title: string | ((props: never) => string)
  icon: LucideIcon
  singleton: boolean          // focus-if-open instead of duplicating
  modal?: boolean
  defaultRect: Partial<WindowInstance['rect']>
  minSize?: { w: number; h: number }
  component: React.LazyExoticComponent<React.ComponentType<never>>
}
```

`lib/windows/registry.ts` maps every `WindowKind` to a `WindowDescriptor`, with
`component` behind `React.lazy` so a window's code is fetched the first time it
opens. The registry is the single place a new feature is registered.

### 3.2 Behaviour

- **Singletons.** `terminal`, `voice`, `settings`, `notifications`, `profile` and
  each domain table are singleton. Re-opening focuses and un-minimises rather than
  spawning a duplicate.
- **Non-singletons.** `record-create` / `record-edit` / `record-detail` are keyed by
  `${kind}:${domain}:${recordId}`, so two different contacts can be open side by
  side but the same contact never opens twice.
- **Modality.** Only `auth` and `confirm` set `modal: true`. They render a scrim,
  trap focus (Radix `Dialog`), and are pinned to the top of the z-order.
  Everything else is non-modal and freely interleaved.
- **Z-order.** A counter in the store. `focusWindow(id)` assigns `++zSeq`. Modal
  windows are drawn from a separate, always-higher band so a non-modal window can
  never occlude the auth dialog.
- **Cascade.** New windows offset `+24px` from the last-opened one, clamped to the
  viewport so nothing opens off-screen.
- **Persistence.** Open windows and their rects persist to `localStorage`, so a
  reload restores the workspace. Modal windows and `record-*` windows are excluded
  from persistence — restoring a half-filled create form would be worse than not.

### 3.3 `WindowFrame`

One component owns all window chrome, so no feature ever draws a title bar:

```
┌─ ▣ Terminal ─────────────────────────── ─  ▢  ✕ ─┐   ← drag handle / controls
│                                                   │
│   {children}                                      │
│                                                   │
└───────────────────────────────────────────────◢──┘   ← resize grip
```

- Drag via pointer events on the title bar; resize via edge/corner grips.
  `react-resizable-panels` is already a dependency but is panel-oriented — window
  drag/resize is ~80 lines of pointer maths and is written directly.
- Keyboard: `Esc` closes the focused non-modal window; `⌘W` closes; `⌘M` minimises.
- Under `md`, `WindowFrame` renders `components/ui/sheet.tsx` full-screen instead,
  with the title bar collapsing to the sheet header. Children are untouched.
- Surface: `bg-popover/95 backdrop-blur-xl border border-border rounded-xl
  shadow-2xl`. The blur is what keeps the machine visible behind the work.

---

## 4. The 3D System Core

### 4.1 What can and cannot be ported

The reference at
`cybernetics-agentics/client/src/components/SystemCore` is **incomplete**. Every
one of `Scene.tsx`, `Panel.tsx`, `List.tsx`, `Form.tsx`, `Fields.tsx` and
`scene/resolve.ts` imports from `./data/…` — and that directory does not exist:

```
./data/schema     → Module, FieldSpec, SPEC, GROUPS, normalize, blankModule, bandText, displayName
./data/status     → STATUS, STATUS_KEYS
./data/fixture    → loadFixture
./data/serialize  → serialize
```

It also targets a different stack: **R3F v8 / React 18 / Recoil /
`@librechat/client` / `useLocalize`**.

| Reference file | Action |
|---|---|
| `objects/*` (`Strip`, `Orbit`, `Scanner`, `Mainframe`, `Hum`, `Tone`, `Contact`) | **Port as-is.** Pure R3F meshes, no app coupling. |
| `scene/*` (`audio`, `config`, `labels`, `materials`, `palette`, `tone`) | **Port as-is.** Framework-free. |
| `scene/resolve.ts` | Port, but re-point at our new `data/`. |
| `Scene.tsx` | Port; swap `useMediaQuery` from `@librechat/client` for a local hook. |
| `Dialog.tsx` | **Do not port.** Its job (full-screen modal shell + toolbar) is now `core/page.tsx` + `ShellChrome`. Lift its toolbar and its lazy-boundary discipline. |
| `Panel.tsx` / `List.tsx` / `Form.tsx` / `Fields.tsx` | **Do not port.** These are a module *editor*; our strips are live domains, not user-authored records. |
| `data/*` | **Author from scratch** — §4.2. |
| `hooks/SystemCore/useModules.ts` | Rewrite as `useDomainModules()` — fixture editing replaced by live domain data. |

Dependencies to add: `three`, `@react-three/fiber@^9` (v8 is React 18-only; we are
on React 19.2), `@types/three`.

### 4.2 The data layer (new)

```
components/system-core/data/
  domains.ts     # the DOMAINS constant — one entry per feature domain
  schema.ts      # zod Module schema + normalize/blankModule/bandText/displayName
  status.ts      # STATUS table: health → { color, gain }
  resolve.ts     # (ported) Module → StripSpec
```

`domains.ts` is the keystone — it is the single place the 3D core, the command
palette, the dock and the table registry all read from:

```ts
export const DOMAINS = [
  { key: 'agent',         label: 'Agent',         window: 'terminal', endpoint: '/agent/conversations', icon: TerminalIcon, band: 0 },
  { key: 'contacts',      label: 'Contacts',      window: 'contacts', endpoint: '/contacts',            icon: UsersIcon,    band: 1 },
  { key: 'knowledge',     label: 'Knowledge',     window: 'knowledge',endpoint: '/knowledge',           icon: BookIcon,     band: 2 },
  { key: 'projects',      label: 'Projects',      window: 'projects', endpoint: '/projects',            icon: KanbanIcon,   band: 3 },
  { key: 'files',         label: 'Files',         window: 'files',    endpoint: '/files',               icon: FileIcon,     band: 4 },
  { key: 'mailbox',       label: 'Mailbox',       window: 'mailbox',  endpoint: '/mailbox/messages',    icon: InboxIcon,    band: 5 },
  { key: 'finance',       label: 'Finance',       window: 'finance',  endpoint: '/invoices',            icon: CoinsIcon,    band: 6 },
  { key: 'notifications', label: 'Notifications', window: 'notifications', endpoint: '/notifications',  icon: BellIcon,     band: 7 },
] as const
```

Two `endpoint` values are deliberately not the obvious ones, because the obvious
ones do not exist: **`/mailbox` has no root list** (only `/mailbox/messages`), and
**`/finance` has no root list at all** (§8.3). The finance strip therefore counts
`/invoices` and escalates to `attention` from `/finance/budgets/at-risk`.

`status.ts` maps a resolved health to emissive colour and gain, mirroring the
reference's `STATUS` contract (`{ color: number; gain: number }`):

| Health | Meaning | Reads as |
|---|---|---|
| `nominal` | Reachable, nothing pending | Cool, dim — the resting state |
| `active` | Work in flight (running agent, uploading file, unread mail) | Bright, faster spin |
| `attention` | Pending approvals, failed ingests, overdue tasks | Warm/amber, pulsing |
| `error` | Endpoint returned non-2xx | Red, slow |
| `unknown` | Not yet loaded | Near-black, static |

### 4.3 Colour: the canvas is exempt from theme tokens

The reference's `scene/palette.ts` carries a long, correct justification for *not*
using semantic tokens inside the canvas: the scene is lit by emissive and
additively-blended materials, which only read as light against a near-black
ground, so the viewport is a **fixed dark stage in both light and dark mode** —
the convention every 3D editor follows. Semantic roles fight it (`--surface-primary`
is white in light mode; the `--status-*` roles are *text* colours that go pastel in
dark mode and read dusty as emissives).

**We keep that decision and its reasoning.** So:

- Inside the canvas: fixed constants in `scene/palette.ts` (`STAGE_BACKGROUND
  0x00001c`, `LIGHTS`, `MAINFRAME`, `SCANNER_COLORS`, `LABEL_INK`). Untouched.
- Outside the canvas: **semantic shadcn tokens only** — every window, the dock,
  the chrome, the tables.
- The one bridge: a domain-status legend in the command palette reads its swatches
  from `STATUS.hex`, so the legend matches what is actually on screen.

This does mean the olive/oklch palette in `app/globals.css` stops at the canvas
edge. That is intentional and is the same boundary the reference drew.

### 4.4 Rendering discipline

Ported verbatim from the reference, because each line of it prevents a real bug:

- **Lazy boundary.** `three` is reachable only from `Scene.tsx` down, loaded via
  `next/dynamic(() => import('./Scene'), { ssr: false })`. `ssr: false` is
  mandatory — there is no WebGL context on the server.
- **Reduced motion.** `prefers-reduced-motion` ⇒ `frameloop="demand"` and no audio
  bus. A static frame, not a paused animation.
- **Disposal.** `MaterialRegistry` and `LabelFactory` disposed on unmount; the tone
  bus disposed in its own effect so rebuilding it doesn't dispose live materials.
- **Per-frame state stays in refs.** Strip phase and lane live in a `Map` in a ref,
  keyed by domain key — never in React state, never in zustand. A `setState` at
  60 fps would re-render the whole stack every frame.
- **Font gating.** Labels render only once the UI face resolves, or the rasteriser
  permanently caches the fallback.

### 4.5 Live data feeding the strips

One hook, `useDomainHealth()`, owns all of it:

- A single polled pass (default 30 s, paused when `document.hidden`) issuing
  `GET <endpoint>?page=1&limit=1` per domain and reading `{ total }` off the
  standard envelope. One cheap request per domain, no bespoke stats endpoint.
- Overlaid with event-driven bumps: an in-flight agent run, a pending approval from
  `GET /agent/approvals`, an active upload from the upload store.
- Writes to `stores/domain.store.ts`. `<DomainStrips>` subscribes there and hands
  plain `StripSpec`s down. The scene never fetches anything.

Clicking a strip calls `openWindow({ kind: domain.window })`. Hovering shows a
`TooltipAnchor` with the domain's label, count and health.

---

## 5. Authentication

### 5.1 Endpoints (all verified in `auth.controller.ts`)

| Route | Notes |
|---|---|
| `POST /auth/login` | `@Public`, throttled 5/min. Returns a `TokenPair`. |
| `POST /auth/refresh` | `@Public`, throttled 10/min. **Rotates** — reuse of an old token revokes the whole family. |
| `POST /auth/logout` | `@Public`. Body carries the refresh token. |
| `POST /auth/logout-all` | Revokes every session. |
| `GET /auth/me` | Current principal. |
| `GET /auth/sessions` | Active sessions — surfaced in Settings → Security. |
| `PATCH /auth/password` | Change password. |
| `POST /auth/forgot-password` | `@Public`. |
| `POST /auth/reset-password` | `@Public`. |

### 5.2 The auth window

The single `modal: true` window. Tabs inside one frame, built from
`components/ui/field.tsx` (the existing `login-form.tsx` is a useful visual
starting point but is unwired Acme boilerplate — its markup is reused, its content
is replaced):

```
┌─ Access ───────────────────────────────────────┐
│                    ◆                            │
│              CYBERNETICS                        │
│                                                 │
│   [ Sign in ]  [ Register ]                     │
│                                                 │
│   Email      ┌──────────────────────────────┐   │
│   Password   ┌──────────────────────────────┐   │
│                                                 │
│   ┌───────────────── Sign in ──────────────┐    │
│                                                 │
│   Forgot your password?                         │
└─────────────────────────────────────────────────┘
```

Panes: `sign-in` · `register` · `forgot` · `reset-sent`. The `reset-password` page
is a standalone route because it is reached from an email link before any session
exists.

**Register is designed but disabled.** No backend route exists. The pane renders
only when `NEXT_PUBLIC_ENABLE_REGISTER === 'true'` and posts to this contract,
recorded here so the backend task has a spec:

```
POST /auth/register            @Public, throttled
  { email: string, password: string, displayName?: string }
  → 201 TokenPair | 409 EMAIL_TAKEN | 422 WEAK_PASSWORD
```

With the flag off, the Register tab is replaced by a line reading *"Accounts are
provisioned by an administrator"* — an honest dead end rather than a button that
500s.

### 5.3 Token handling

Bearer-only, so:

- **Access token in memory only** (zustand, not persisted). Never in
  `localStorage` — it is the credential an XSS would want.
- **Refresh token in `localStorage`.** With no cookie transport available this is
  the only way to survive a reload. Noted as a known trade-off in §11.
- **Single-flight refresh.** `lib/api/client.ts` holds one in-flight refresh
  promise. Concurrent 401s all await it, then retry once. This is load-bearing:
  `auth.service.ts` uses compare-and-set rotation (`claimForRotation`), so two
  parallel refreshes with the same token means one of them is treated as **token
  theft and revokes the entire family**. Serialising refresh is a correctness
  requirement, not an optimisation.
- On refresh failure: clear both tokens, close every window, open `auth`.

---

## 6. The terminal — primary agent interface

### 6.1 Layout

```
┌─ ▣ Terminal ──────────────────────────────────── ─ ▢ ✕ ─┐
│ ┌──────────────┬────────────────────────────────────────┐│
│ │ + New        │  ┌──────────────────────────────────┐  ││
│ │              │  │ ▸ Reasoning            2.4s      │  ││
│ │ ● Q3 report  │  └──────────────────────────────────┘  ││
│ │   Contacts…  │                                        ││
│ │   Invoice 42 │  Here's what I found across the        ││
│ │              │  knowledge base…                       ││
│ │              │                                        ││
│ │              │  ┌─ 🔧 search-documents ────── ✓ ──┐   ││
│ │              │  │ { "query": "Q3 revenue" }       │   ││
│ │              │  └─────────────────────────────────┘   ││
│ │              │                                        ││
│ │              │  ┌─ ⚠ Approval required ───────────┐   ││
│ │              │  │ send-email → 3 recipients       │   ││
│ │              │  │        [ Reject ]  [ Approve ]  │   ││
│ │              │  └─────────────────────────────────┘   ││
│ ├──────────────┼────────────────────────────────────────┤│
│ │              │ ┌────────────────────────────────────┐ ││
│ │              │ │ Ask the system…                    │ ││
│ │              │ │ [📎] [🎙]                    [ ↑ ] │ ││
│ │              │ └────────────────────────────────────┘ ││
│ └──────────────┴────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

Left rail collapses below `lg` into a conversation dropdown in the header.

### 6.2 ai-elements composition

Every one of these is already vendored in `client/components/ai-elements/`:

| Concern | Component(s) |
|---|---|
| Scroll container, auto-stick | `conversation.tsx` (`use-stick-to-bottom`) |
| Message bubbles | `message.tsx` |
| Markdown / code | `streamdown` via `code-block.tsx` |
| Chain of thought | `reasoning.tsx`, `chain-of-thought.tsx` |
| Tool calls | `tool.tsx`, `task.tsx` |
| Approvals | `confirmation.tsx` |
| Citations | `sources.tsx`, `inline-citation.tsx` |
| Composer | `prompt-input.tsx` (the whole `PromptInput*` family, incl. attachments + action menu) |
| Attachments | `attachments.tsx` |
| Token budget | `context.tsx` + `tokenlens` |
| Empty state | `suggestion.tsx` |
| Loading | `shimmer.tsx` + `ui/spinner.tsx` |

`terminal.tsx` (the ANSI console element) is **not** the right primitive for the
main interface — it renders a raw ANSI byte stream, not structured agent turns. It
is reserved for a future tool-output-as-console view. The window is called a
terminal; its content is a conversation.

### 6.3 The stream transport

`lib/agent/stream.ts` — the most delicate module in the client.

**Event contract, mirrored verbatim from `api/src/features/mastra/services/chunk-to-sse.ts`:**

```ts
export type SseEvent =
  | { type: 'start'; conversationId: string; runId: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-input'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-output'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'approval-required'; approvalId: string; toolCallId: string; toolName: string;
      actionType: ActionType; title: string; payload: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'done'; status: 'succeeded' | 'awaiting_approval' | 'cancelled' | 'failed' }
```

This type is **copied, not derived** — the client does not import from `api/`. A
comment points at the source file, and a contract test (§12) fails if they drift.

**Request.** `POST /agent/chat/stream`, body per `chatStreamSchema`:

```ts
{ conversationId?: uuid, message: string }        // a new turn
{ conversationId?: uuid, resume: { approvalId, approved } }   // resuming
```

The DTO's `.refine` enforces **exactly one** of `message` / `resume`. The client
mirrors that as a discriminated union so the wrong shape cannot be constructed.

**Reading.** `fetch` with `signal` from an `AbortController`, then:

```
reader → TextDecoder({stream:true}) → append to buffer
       → while buffer contains '\n\n':
             take frame, strip leading 'data: ', JSON.parse → dispatch
       → keep the remainder in the buffer
```

The buffer is the point. A `text-delta` frame is routinely split across two network
chunks; parsing per-chunk instead of per-`\n\n` corrupts the stream.

**Reducer.** A pure `(state, event) => state` function, unit-testable without a
network:

| Event | Effect |
|---|---|
| `start` | Bind `conversationId` (a first turn has none until now) and `runId`; set `status: 'streaming'`. |
| `text-delta` | Append to the open `text` part, creating it if absent. |
| `reasoning-delta` | Append to the open `reasoning` part. Collapsed by default; auto-expands while it is the only thing streaming. |
| `tool-input` | Push a `tool` part keyed by `toolCallId`, `state: 'running'`. |
| `tool-output` | Resolve that part by `toolCallId` → `'complete'` or `'error'`. |
| `approval-required` | Push a `confirmation` part; also add to `pendingApprovals`. Stream ends after this. |
| `error` | Attach the message to the turn; `status: 'error'`. |
| `done` | `status` from the payload. `awaiting_approval` keeps the turn visually open. |

**Failure handling.**
- *Abort* — user pressed stop. Mark the turn `cancelled`, keep partial text, no toast.
- *Network drop mid-stream* — mark `interrupted`, keep partial text, offer Retry.
  History is server-side, so a reload recovers the true state.
- *Non-2xx before the stream opens* — parse the `ErrorEnvelope` and surface it in
  the composer, not as a message bubble.
- Cleanup (`reader.cancel()`, abort listeners) runs in a `finally`.

### 6.4 Approvals

`approval-required` renders inline via `confirmation.tsx`. The decision has two
paths and they are **not** interchangeable:

- **Inline, mid-stream** → `POST /agent/chat/stream` with
  `{ resume: { approvalId, approved } }`. This continues the run and streams the
  rest of the turn.
- **Out-of-band** (from the notifications window, or a run started elsewhere) →
  `POST /agent/approvals/:id` with `{ approved, note? }`, per `decisionSchema`.
  `GET /agent/approvals` backs a pending-approvals list.

Pending approvals also drive the `agent` strip to `attention` in the 3D core.

### 6.5 History

`GET /agent/conversations?page&limit` → `{ data: PublicConversation[], total, page, limit }`
for the rail. `GET /agent/conversations/:id/messages` → `ChatMessageDto[]`, whose
`parts` union (`text` · `reasoning` · `tool` · `source`) maps onto **the same
renderers** as live stream parts. One renderer, two sources — a replayed
conversation and a live one are indistinguishable, which is the whole point.

---

## 7. Live conversation

### 7.1 The transport seam

There is no voice backend. Rather than block the feature or hard-wire a browser
API, voice goes behind an interface:

```ts
// lib/voice/transport.ts
export interface VoiceTransport {
  readonly id: string
  isSupported(): boolean
  start(opts: { deviceId?: string; lang?: string }): Promise<void>
  stop(): Promise<void>
  speak(text: string, opts?: { voice?: string; rate?: number }): Promise<void>
  interrupt(): void
  on(ev: 'partial',    cb: (text: string) => void): Unsubscribe
  on(ev: 'final',      cb: (text: string) => void): Unsubscribe
  on(ev: 'level',      cb: (rms: number) => void): Unsubscribe
  on(ev: 'state',      cb: (s: VoiceState) => void): Unsubscribe
  on(ev: 'error',      cb: (e: VoiceError) => void): Unsubscribe
}
```

**v1 adapter: `web-speech.adapter.ts`** — `SpeechRecognition` (continuous, interim
results) for input, `SpeechSynthesis` for output, and a `WebAudio`
`AnalyserNode` for the level meter that drives the waveform. Zero backend work,
real conversation today.

A future `realtime-ws.adapter.ts` implements the same interface against a server
gateway. Nothing above the interface changes.

`isSupported()` is checked at render. Unsupported browsers get an explicit
*"Live conversation needs a browser with speech recognition (Chrome, Edge, or
Safari 16+)"* panel — not a button that silently does nothing.

### 7.2 FAB and window independence

The goal file is explicit here, and it is easy to get wrong. Two **separate** pieces
of state:

```ts
voiceEnabled: boolean          // is the mic hot?          ← the FAB toggles this
windowOpen('voice'): boolean   // is the window on screen? ← the ✕ toggles this
```

| Action | `voiceEnabled` | voice window |
|---|---|---|
| Click FAB (off → on) | `true` | **opens** if closed |
| Click FAB (on → off) | `false` | **stays open** ← the requirement |
| Click window `✕` | `false` | closes |
| Reopen from dock | unchanged | restores |

So the FAB is a mic switch that happens to summon the window; the window's close
button is the only thing that dismisses it, and doing so also stops the mic
(leaving a hot mic behind an invisible window would be indefensible).

### 7.3 The window

```
┌─ ▣ Live ──────────────────────────────── ─ ▢ ✕ ─┐
│                                                  │
│              ╭─────────────╮                     │
│              │    ◉        │   ← level ring      │
│              ╰─────────────╯                     │
│                 Listening…                       │
│                                                  │
│   "what's the status of the Q3 report"           │  ← Transcription (interim)
│                                                  │
│   ─────────────────────────────────────────      │
│   ▸ Three tasks remain open…                     │  ← assistant, spoken + shown
│                                                  │
│   [🎙 Mute]  [⏹ Stop]  [⚙ Mic ▾] [🔊 Voice ▾]    │
└──────────────────────────────────────────────────┘
```

Built from `speech-input.tsx` (waveform), `transcription.tsx` (interim text),
`audio-player.tsx`, `mic-selector.tsx`, `voice-selector.tsx`.

**Shared conversation.** A voice `final` calls the *same* `sendMessage()` the
terminal uses, against the same `conversationId`. Open both windows and you see one
conversation in two views. Assistant `text-delta`s are buffered to sentence
boundaries before being handed to `speak()` — speaking every token produces
stuttering garbage.

**Barge-in.** A `partial` while TTS is playing calls `interrupt()`. Natural
interruption is the difference between a conversation and a walkie-talkie.

State machine: `idle → requesting-permission → listening → thinking → speaking →
listening`, with `error` and `unsupported` as terminal branches.

---

## 8. Feature modules

### 8.1 Generalising the existing table

`client/components/data-table.tsx` (822 lines) is the reference the goal file names.
It is a **TanStack Table v9** implementation — the new `tableFeatures()` /
`createColumnHelper<typeof features, T>()` / `useTable` API, not v8 — and it already
demonstrates every required affordance: tabs, drag-reorder, row selection with a
selected-count line, column-visibility menu, rows-per-page select, full pager, a
row-action dropdown, and a `Drawer` detail view.

It is refactored into `components/data-table/` with **one substantive change**: the
demo paginates client-side (`createPaginatedRowModel`), but every API list endpoint
is server-paginated and returns `{ data, total, page, limit }`. The generic table
therefore runs in **manual pagination** mode, with sorting and filtering also lifted
to query params. Keeping client-side paging would silently page only the current 20
rows and misreport totals.

```
components/data-table/
  data-table.tsx          # generic shell — tabs, toolbar, table, pager
  table-toolbar.tsx       # search, filters, column visibility, Create
  table-pagination.tsx    # count, rows-per-page, pager  (verbatim from the demo)
  row-actions.tsx         # ⋮ → Edit / Duplicate / Delete
  table-state.tsx         # loading skeleton / empty / error triad
  use-domain-table.ts     # query params ⇄ server fetch ⇄ table state
  types.ts                # DomainTableConfig<T>
```

### 8.2 Per-domain configuration

A domain is declared, not implemented:

```ts
export interface DomainTableConfig<T> {
  key: string
  endpoint: string
  columns: ColumnDef<T>[]
  tabs?: { value: string; label: string; query: Record<string, unknown> }[]
  filters?: FilterSpec[]
  searchable?: boolean
  createSchema?: z.ZodType          // omit ⇒ no Create button
  editSchema?: z.ZodType            // omit ⇒ read-only
  detail?: React.ComponentType<{ id: string }>
  permissions?: { create?: string; update?: string; delete?: string }
  rowActions?: RowAction<T>[]
}
```

`permissions` keys mirror the backend's `@RequirePermission` values (`contact.create`,
`knowledge.publish`, …), read off the principal from `GET /auth/me`. Actions the
user cannot perform are **hidden, not disabled** — a disabled button the user can
never enable is noise.

### 8.3 Domains and verified endpoints

| Domain | List | CRUD | Notes |
|---|---|---|---|
| Contacts | `GET /contacts` | `POST` · `PATCH /:id` · `DELETE /:id` | Sub-tabs: channels, relationships, interactions |
| Knowledge | `GET /knowledge` | `POST` · `PATCH /:id` · `DELETE /:id` | `POST /:id/status` publish; grants; contact links |
| Projects | `GET /projects` | `POST` · `PATCH /:id` · `DELETE /:id` | Members, milestones, goals |
| Tasks | `GET /tasks` | full | Standalone resource. Also dependencies, watchers, time entries (`/tasks/time`) |
| Files | `GET /files` | `POST` (initiate) · `DELETE /:id` | §9 |
| Mailbox | `GET /mailbox/messages` | `PATCH /messages/:id/seen` · `POST /sync` | **No root list** — messages only. Read-mostly |
| Invoices | `GET /invoices` | `POST` · `POST /:id/issue` · `/void` · `/payments` | **Top-level `/invoices`, not under `/finance`** |
| Notifications | `GET /notifications` | prefs via `GET`/`PUT /notifications/preferences` | |
| Tags | `GET /tags` | full | |
| Activity | `GET /activity`, `GET /activity/me` | read-only | Audit feed; `/me` is the user's own |
| Comments | `GET /comments` | `POST` · `PATCH /:id` · `DELETE /:id` | Embedded in detail views |
| Search | `POST /search/collections/:name/query` | — | Cross-domain |

**Finance is not a table domain.** `finance.controller.ts` exposes **no root list** —
it is a cluster of sub-resources (`/finance/transactions`, `/finance/accounts`,
`/finance/budgets`, `/finance/recurring`, `/finance/categories`, `/finance/fx-rates`)
plus four report endpoints (`/finance/reports/{summary,income-by-category,
spend-by-category,forecast}`). So the Finance window is a **tabbed multi-table
window**: one `DomainTableConfig` per sub-resource, plus a reports tab built from
`components/ui/chart.tsx` and `section-cards.tsx`. Its 3D strip resolves health from
`/finance/reports/summary` and `/finance/budgets/at-risk`, not from a row count.

Admin-only surfaces (`/system/**`, `/users`, `/search/collections` management,
`/agent/schedules` — which is `@Roles('admin')`) live in a **System** window shown
only to admins.

### 8.4 Create / Edit / Detail as windows

Per the goal file, these are never inline:

```
openWindow({ kind: 'record-create', props: { domain: 'contacts' } })
openWindow({ kind: 'record-edit',   props: { domain: 'contacts', id } })
openWindow({ kind: 'record-detail', props: { domain: 'contacts', id } })
```

Forms are generated from the domain's zod schema through
`components/ui/field.tsx` + `components/ui/questionnaire.tsx`, with per-domain
overrides for anything a schema can't express. Deletes route through the modal
`confirm` window. Optimistic updates on the table, rolled back with a `sonner`
toast on failure.

---

## 9. File upload and ingest

### 9.1 The real pipeline

Verified end to end. **No backend work is required** — the client only drives it:

```
POST /files                       initiate: metadata in, presigned target out
   ↓  (may short-circuit — see dedup)
POST <target.url>                 multipart form: target.fields + the file
   ↓                              ← direct to MinIO, never through the API
POST /files/:id/complete          verifies the object, PENDING → AVAILABLE,
   ↓                              enqueues processing
[ BullMQ ]                        checksum + magic-byte check
   ↓
[ document-ingest ]               DocumentExtractionService:
                                    pdf   → pdf-parse
                                    docx  → mammoth
                                    md/txt→ utf8
   ↓                              chunked 2000 chars / 200 overlap
[ search-service ]                → `documents` collection, one record per chunk
```

### 9.2 Two details that will bite an implementer

**It is a POST policy, not a PUT.** `initiateUpload` returns
`PresignedTarget { url, fields?, expiresIn }` from `presignedPostPolicy`. The client
must build a `FormData`, append **every** entry of `fields` **first**, then the file
last, and POST it. Sending a bare `PUT` body will fail the policy.

**Initiate can short-circuit.** If the client supplies `sha256` and the content is
already stored, the response is `{ fileId, deduplicated: true }` with **no `upload`
key**. The client must detect this and skip *both* the upload and the complete call
— the file is already available. Treating a missing `upload` as an error would break
every re-upload.

Computing `sha256` client-side (via `crypto.subtle.digest`) is therefore worth it:
it enables dedup, and `completeUpload` verifies it. Files above ~50 MB are hashed in
a worker to avoid blocking the main thread.

### 9.3 MIME gate

The ingestable set is fixed in `document-ingest.constants.ts`:

```
application/pdf
application/vnd.openxmlformats-officedocument.wordprocessingml.document
text/markdown
text/plain
```

Other types can still be *stored* (the file API accepts them subject to its own
policy) but will not produce text records. The dropzone states this plainly per
file rather than silently accepting something that never gets indexed.

### 9.4 Client state machine

```
queued → hashing → uploading(%) → completing → processing → indexed
                            ↓           ↓            ↓
                          failed      failed       failed
```

`processing → indexed` is resolved by polling `GET /files/:id` until `AVAILABLE`,
then confirming chunks exist via
`POST /search/collections/documents/query` filtered on `fileId`. Backoff: 1 s → 2 s
→ 4 s, capped at 10 s, given up after 2 minutes with a Retry affordance.

Progress comes from `XMLHttpRequest.upload.onprogress` — `fetch` still has no upload
progress event.

### 9.5 Surfaces

- **Files window** — a dropzone above the standard domain table. Row detail shows
  extracted text with chunk boundaries and a link to search within the document.
- **Terminal attachments** — `PromptInputActionAddAttachments` runs the identical
  `lib/files/upload.ts` flow, then passes `fileId`s with the message so the agent's
  `search-documents` tool can reach them.
- Both read one `stores/upload.store.ts`, so a file attached in the terminal shows
  its progress in the Files window too.

---

## 10. State management

### 10.1 Slices

Zustand, one store per concern, all under `client/stores/`. Cross-slice reads go
through selectors, never by importing another store's setter.

| Store | Holds | Persisted |
|---|---|---|
| `auth.store.ts` | principal, access token (memory), refresh token, `status` | refresh token only |
| `window.store.ts` | instances, z-order, focus, dock | yes (minus modal + `record-*`) |
| `conversation.store.ts` | conversations, messages, stream status, pending approvals | no |
| `voice.store.ts` | `voiceEnabled`, transport state, transcript, device prefs | device prefs only |
| `domain.store.ts` | per-domain count + health for the strips | no |
| `upload.store.ts` | per-file state machine + progress | no |
| `ui.store.ts` | theme, reduced motion, palette open, table prefs | yes |

### 10.2 Rules

1. **Explicit status, never boolean pairs.** Every async slice carries
   `status: 'idle' | 'loading' | 'ready' | 'error'` plus `error?: ApiError`.
   `isLoading` + `isError` booleans permit `loading && error` — a state that has no
   meaning and that components then render incoherently.
2. **The 3D scene never touches a store per frame.** Phase and lane stay in refs
   inside `useDomainModules()`. Stores are read once per data change, not per frame.
3. **Server data is not duplicated.** Slices cache what a window is displaying, keyed
   by query. A window closing drops its cache.
4. **Actions are async thunks inside the store**, so components never assemble
   multi-step flows. `sendMessage()` owns optimistic append → stream → reconcile.
5. **`persist` only where a reload would otherwise lose the user's place**: session,
   workspace layout, preferences. Never in-flight work.

### 10.3 API layer

```
lib/api/
  client.ts       # fetch wrapper: base URL, bearer, single-flight refresh, ErrorEnvelope
  errors.ts       # ApiError; maps the backend ErrorCode enum to display copy
  types.ts        # hand-mirrored DTOs, each citing its source file
  endpoints/      # one thin module per domain
```

`client.ts` is the only place that knows about tokens, refresh, or the base URL.
The backend's `ErrorEnvelope` (registered in `openapi.setup.ts`) is parsed into a
typed `ApiError` so `AUTH_TOKEN_EXPIRED` can trigger a refresh while
`FILE_MIME_NOT_ALLOWED` shows inline on the dropzone.

`NEXT_PUBLIC_API_URL` points at the origin with **no `/api` suffix** — the API has
no global prefix.

---

## 11. Open questions

Carried forward deliberately; none blocks the frontend build.

1. **`POST /auth/register`** — contract drafted in §5.2, endpoint not built.
   Needs a decision on self-service signup at all, default role, and email
   verification.
2. **Server-side voice** — the Web Speech adapter is browser-dependent and sends
   audio to the browser vendor's service. A `realtime-ws.adapter.ts` against an
   owned gateway is the eventual answer; the interface is ready for it.
3. **Refresh token in `localStorage`** — forced by `credentials: false`. If a
   same-site deployment ever becomes possible, an `httpOnly` cookie for the refresh
   token is strictly better. Worth revisiting.
4. **Domain health polling** — one `limit=1` request per domain per 30 s is eight
   requests. Acceptable now; a single `GET /system/summary` aggregate would be better
   if the strip data grows richer.
5. **Agent schedules** are `@Roles('admin')` only. If ordinary users should schedule
   their own agent runs, that is a backend authorisation change.
6. **`three` bundle weight** — ~600 KB gzipped. Mitigated by the lazy boundary, but
   it is the first thing an authenticated user waits for. Measure before optimising.

---

## 12. Build order

Each step is independently verifiable; nothing later is needed to prove something
earlier works.

| # | Step | Done when |
|---|---|---|
| 1 | Deps + scaffold: `zustand`, `three`, `@react-three/fiber@9`, `@types/three`. Remove demo pages. | `pnpm build` clean |
| 2 | `lib/api/` — client, errors, refresh interceptor | Contract test: a 401 triggers exactly one refresh under 5 concurrent requests |
| 3 | Auth store + auth window | Real login against a running API; reload restores the session |
| 4 | Window manager + `WindowFrame` + dock | Three windows open, drag, resize, minimise, restore; layout survives reload |
| 5 | 3D core: port `objects/` + `scene/`, author `data/` | Canvas renders, strips turn, reduced motion yields a static frame, no WebGL context leak on unmount |
| 6 | `useDomainHealth` → strips | Strip colour changes when a domain's count changes |
| 7 | Terminal + `lib/agent/stream.ts` | A full turn streams: reasoning, text, tool call, approval, done |
| 8 | Generic data table + two domains (Contacts, Files) | Server pagination correct; create/edit/detail open as windows |
| 9 | Upload pipeline | A PDF reaches `indexed` and its chunks are searchable |
| 10 | Voice window + Web Speech adapter | Spoken question produces a spoken answer in the shared conversation |
| 11 | Remaining domains from config | Each is a config object, not new components |
| 12 | Responsive pass + a11y pass | Windows become sheets under `md`; keyboard-only operation of every window |

### Verification specific to this design

- **Contract test** asserting the client's `SseEvent` union matches
  `api/src/features/mastra/services/chunk-to-sse.ts`. These two files must not drift.
- **Reducer unit tests** over recorded event sequences — including a `text-delta`
  split across chunk boundaries, and an `approval-required` mid-turn.
- **Upload test** covering the dedup short-circuit (`deduplicated: true`, no
  `upload` key) as well as the normal path.
- **Refresh concurrency test** — five parallel 401s must produce one refresh call,
  because two would revoke the token family.
