# Design: Mastra AI Agent Module (`src/features/mastra`) — v1

## Context

Cybernetics needs its core AI-agent capability: an agent that serves comprehensive human
interaction. **Stage one** scope: the agent answers a human request (e.g. "give me a
comprehensive analysis of the ERP Project") or a scheduled event (e.g. "draft a report from
yesterday's tasks"), **pulls curated data** (never raw dumps), **analyzes** it, and then
**responds / updates data / takes an action** (send email, call an API). It must remember
conversations, handle failures with retries, and gate consequential actions behind
human-in-the-loop (HITL) approval.

The design is built on three verified research passes: the **installed** `@mastra/core@1.50.1`
`.d.ts` surface (the ground truth we code against), the **latest** online Mastra docs, and the
**house conventions** already used by `search-service`, `auth`, and `system`. It is intentionally
**simple but production-grade** — the first version, clean and reliable, with clear extension points.

### Decisions (locked during design discussion)
1. **Persistence = Hybrid.** `@mastra/pg` (`PgStore`) + Mastra `Memory` own the raw
   threads/messages/working-memory/workflow-snapshots. **We** own a Drizzle orchestration/audit
   layer (5 tables).
2. **v1 tools:** `search-query` (read), `calculate-metric` (read, pattern stub), `send-email`
   (action), `db-write` (action, reusable pattern). External-API calls follow the action shape.
3. **Scheduling:** BullMQ repeatable jobs (consistent with `search-reconciliation.scheduler`).
4. **Model:** Vercel AI Gateway via `@ai-sdk/gateway` `createGateway({ apiKey })`, key
   `AI_GATEWAY_API_KEY`, model strings like `anthropic/claude-sonnet-4.6` (dots for versions).
5. **`agent_conversation`:** a thin owned table (`id` = Mastra thread id) for ownership/authz/listing.
6. **Action audit:** a dedicated append-only `agent_action_log`.
7. **Approval required for:** send-email, db-write, external-api. **Auto-approve** SYSTEM
   scheduled runs delivered *internally*; external email from a scheduled run still needs approval.

### Non-goals (v1)
Semantic recall / vector memory (no embedder or `PgVector` yet), SSE token streaming to clients,
multi-agent networks, the real finance/worklog domains (tools are patterns wired later), and the
Mastra Studio/playground UI. All are listed under §16 (Deferred to v2).

---

## 1. Mastra 1.50.1 API facts we build on

- `new Agent({ id, name, instructions, model, tools, memory, workflows, maxRetries })`.
  `generate()`/`stream()` are the modern methods (`*Legacy` = AI-SDK v4). Typed output via the
  `structuredOutput` execution option.
- `model` accepts an **AI-SDK model object** → `model: gw('anthropic/claude-…')` works directly.
- Conversations keyed by **`resource`** (owner) + **`thread`** (one conversation), passed per call:
  `agent.generate(msg, { memory: { resource, thread: { id } } })`.
- `Memory` + a concrete `PgStore` are **NOT in core** — we add `@mastra/memory` + `@mastra/pg`.
- `createTool({ id, description, inputSchema, outputSchema, execute })`; `execute(inputData, ctx)`
  is **two positional args**; DI/services and the per-request principal flow via `ctx.requestContext`.
- **HITL:** tool-level `requireApproval: true` + `agent.approveToolCall` / `declineToolCall`
  (chat path); workflow step `suspend()` / `run.resume()` (scheduled path). Durable via
  `mastra_workflow_snapshot` in `PgStore`.
- **Retries:** agent `maxRetries`; workflow `retryConfig { attempts, delay }` + per-step `retries`.
- `@mastra/nestjs`: `MastraModule.register/registerAsync`, `MastraService`, `MASTRA` token;
  it auto-mounts a **catch-all** HTTP controller (scope it under a prefix; keep the module last).

---

## 2. Architecture overview

```
                      ┌──────────────────────────────────────────────┐
  HTTP (JWT guard) ─▶  │  /agent/*  (our guarded controllers)         │
                      │   chat · approvals · schedules · conversations│
                      └───────────────┬──────────────────────────────┘
                                      │
                     ┌────────────────▼─────────────────┐   requestContext:{principal}
                     │  AgentRunnerService               │───────────────┐
                     │  (records agent_run, opens convo) │               │
                     └───────┬───────────────┬───────────┘               ▼
   BullMQ repeatable ───▶ AgentRunProcessor   │                 ┌──────────────────┐
   (agent_schedule)         (scheduled runs)  │                 │  MastraService    │
                                              │                 │  getAgent/Workflow│
                     ┌────────────────────────▼─────────┐       └────────┬─────────┘
                     │  Mastra instance (registerAsync)  │                │
                     │  Agent + tools + Memory + Workflow │◀──────────────┘
                     └───┬─────────────┬─────────────┬────┘
                         │             │             │
                   PgStore/Memory   tools (closures)  scheduled-report workflow
                   (mastra_* tables) search/calc/     (gather→analyze→deliver,
                                     email/db-write     suspend for approval)
```

Our Drizzle tables (`agent_conversation`, `agent_run`, `agent_approval`, `agent_action_log`,
`agent_schedule`) live in `public`; Mastra's `mastra_*` tables live in a dedicated `mastra` Postgres
schema (same database, same connection pool) so Drizzle migrations stay clean.

---

## 3. Module & file structure

Follows house layout (flat feature folder; repos + services + processors + schedulers in
`providers`; only services `export`ed). The existing `MastraModule` is **expanded** (kept last in
`AppModule`).

```
src/features/mastra/
  mastra.module.ts            # MastraCoreModule.registerAsync(factory) + our controllers/providers
  index.ts                    # buildMastra(deps) → new Mastra({ agents, workflows, storage, memory })
  mastra.constants.ts         # AGENT_ID, queue/job names, DI tokens, approval TTL
  mastra.types.ts             # shared types (RunTrigger, ActionType, CuratedResult, ToolDeps…)
  agents/
    orchestrator.agent.ts     # buildOrchestratorAgent(deps): Agent (instructions, model, tools, memory)
    prompts.ts                # system instructions + report templates
  memory/
    memory.factory.ts         # buildMemory(pool): Memory over PgStore (schema 'mastra')
    model.factory.ts          # buildModel(config): gateway model object
  tools/
    search-query.tool.ts      # read — SearchRecordService, capped/curated
    calculate-metric.tool.ts  # read — aggregation pattern stub
    send-email.tool.ts        # action (requireApproval) — SMTP + EncryptionService
    db-write.tool.ts          # action (requireApproval) — reusable guarded write pattern
    tool-deps.ts              # ToolDeps interface + requestContext key
  workflows/
    scheduled-report.workflow.ts  # gather → analyze(agent) → deliver (suspend if external email)
  services/
    agent-runner.service.ts   # invoke agent/workflow w/ Principal; write agent_run; usage/latency
    conversation.service.ts   # CRUD agent_conversation; map to Mastra thread; authz
    approval.service.ts       # list/approve/reject; resume via approveToolCall / run.resume
    schedule.service.ts       # CRUD agent_schedule; (de)register BullMQ repeatable jobs
  repositories/
    conversation.repository.ts  agent-run.repository.ts  approval.repository.ts
    action-log.repository.ts    schedule.repository.ts
  controllers/
    chat.controller.ts        # POST /agent/chat ; GET /agent/conversations[/:id]
    approval.controller.ts    # GET /agent/approvals ; POST /agent/approvals/:id
    schedule.controller.ts    # CRUD /agent/schedules  (@Roles('admin'))
  dto/
    chat.dto.ts  approval.dto.ts  schedule.dto.ts   # Zod schemas + inferred types
  processors/
    agent-run.processor.ts    # BullMQ WorkerHost — executes queued/scheduled runs
  schedulers/
    agent-schedule.scheduler.ts  # registers repeatable jobs from agent_schedule (bootstrap hook)
```

**DI split:** `MastraModule` uses `MastraCoreModule.registerAsync({ imports, inject, useFactory })`.
The factory injects `ConfigService`, `SearchRecordService`, the SMTP/crypto services, and the
`PG_POOL`, then calls `buildMastra(deps)`, which constructs tools as **closures over those
services**. The **per-request `Principal`** is *not* baked in — it flows through `requestContext` on
each call. `MastraModule` imports `SearchServiceModule`, `SystemModule`, `CryptoModule` to reuse
their exported services. The adapter's catch-all is mounted under `prefix: '/api/agent-core'`; our
`/agent/*` routes are separate and stay behind the global `JwtAuthGuard`.

---

## 4. Persistence model (hybrid)

- **Mastra-owned (`PgStore.init()`, schema `mastra`, NOT in Drizzle migrations — documented):**
  `mastra_threads`, `mastra_messages`, `mastra_resources` (working memory), `mastra_workflow_snapshot`
  (durable suspend/resume). Configured with the existing `PG_POOL` and `schemaName: 'mastra'`
  (verify the exact option name at implementation time).
- **Resource/thread mapping:** `resource = agent_conversation.ownerUserId ?? 'system'`;
  `thread.id = agent_conversation.id` — we generate the uuid and reuse it as the Mastra thread id,
  so no mapping column is needed.
- **Memory config (v1):** `lastMessages: 20`; `workingMemory: { enabled: true, scope: 'resource',
  template: <short user/profile block> }`; `semanticRecall: false` (deferred — needs `PgVector` +
  embedder). `generateTitle: true` so conversations get readable titles.

---

## 5. Schema (Drizzle) — `src/infrastructure/database/schema/agent.schema.ts`

New file, barrel-exported from `schema/index.ts`; migration via `pnpm db:generate && db:migrate`.
All tables spread `baseColumns` (uuid `id`, tz `createdAt`/`updatedAt`, `isDeleted`, `deletedAt`)
except the append-only `agent_action_log`. FKs reference `users.id` (identity.schema). Enums via
`pgEnum`. JSON via `jsonb().$type<T>()`. Partial-unique "live rows" idiom uses
`.where(sql\`${t.isDeleted} = false\`)`.

**Enums:**
`agent_conversation_kind` = [`chat`,`scheduled`,`event`] ·
`agent_conversation_status` = [`active`,`archived`] ·
`agent_run_trigger` = [`user_message`,`schedule`,`event`,`api`] ·
`agent_run_status` = [`queued`,`running`,`awaiting_approval`,`succeeded`,`failed`,`cancelled`] ·
`agent_action_type` = [`send_email`,`db_write`,`external_api`,`other`] (shared by approval + log) ·
`agent_approval_status` = [`pending`,`approved`,`rejected`,`expired`,`executed`,`failed`] ·
`agent_action_status` = [`success`,`failed`] ·
`agent_schedule_delivery` = [`conversation`,`email`,`none`].

**`agent_conversation`** — thin metadata over a Mastra thread (`id` = thread id).
`ownerUserId uuid?→users.id`, `resourceId text notNull` (the Mastra resource string),
`title text?`, `kind`(dflt `chat`), `status`(dflt `active`), `lastMessageAt tz?`,
`messageCount int dflt 0`, `metadata jsonb dflt {}`.
Indexes: `(ownerUserId) where live`, `(resourceId)`, `(kind,status)`.
> **Source of truth:** conversation *content* (threads, messages, working memory) is owned entirely
> by Mastra's memory system (`@mastra/memory` + `@mastra/pg`, per the official docs) — we do **not**
> reimplement it. This row is an ownership/index projection that shares the Mastra `thread.id`; it
> stores **no message data**. `title`/`lastMessageAt`/`messageCount` are denormalized on write (from
> Mastra, which is authoritative) purely for FK integrity into `agent_run`/`agent_approval`,
> soft-delete/archival, domain `kind`/`status`, and house-style SQL listing.

**`agent_run`** — invocation ledger (reliability, retries, usage, HITL correlation).
`conversationId uuid?→agent_conversation.id`, `trigger notNull`, `triggeredByUserId uuid?→users.id`,
`status`(dflt `queued`), `input jsonb dflt {}`, `output jsonb?` (curated), `error jsonb?`
(`{message,code,category}`), `attempts int dflt 0`, `mastraRunId text?`, `agentId text notNull`,
`model text?`, `tokensInput int?`, `tokensOutput int?`, `startedAt tz?`, `finishedAt tz?`,
`latencyMs int?`. Indexes: `(conversationId)`, `(status)`, `(trigger)`, `(mastraRunId)`, `(createdAt)`.

**`agent_approval`** — pending HITL decisions.
`runId uuid notNull→agent_run.id`, `conversationId uuid?`, `mastraRunId text?` (workflow),
`toolCallId text?` (tool approval), `suspendPath text?` (workflow step path),
`actionType notNull`, `title text notNull`, `payload jsonb dflt {}` (the proposed action),
`status`(dflt `pending`), `decidedByUserId uuid?→users.id`, `decidedAt tz?`, `decisionNote text?`,
`expiresAt tz?`, `result jsonb?`. Indexes: `(runId)`, `(conversationId)`, partial
`(status) where status='pending'`.

**`agent_action_log`** — append-only side-effect audit (mirrors `system_audit_log`; no baseColumns).
`id uuid pk defaultRandom`, `createdAt tz notNull defaultNow`, `runId uuid notNull→agent_run.id`,
`conversationId uuid?`, `actorUserId uuid?`, `actionType notNull`, `toolId text notNull`,
`status notNull`, `summary text notNull`, `detail jsonb dflt {}`, `approvalId uuid?→agent_approval.id`.
Indexes: `(runId)`, `(createdAt)`, `(actionType)`.

**`agent_schedule`** — scheduled-run definitions (admin-manageable).
`name text notNull` (partial-unique among live), `description text?`, `cron text notNull`,
`timezone text notNull dflt 'UTC'`, `enabled boolean notNull dflt true`,
`targetUserId uuid?→users.id`, `agentId text notNull`, `promptTemplate text notNull`,
`params jsonb dflt {}`, `deliveryChannel`(dflt `conversation`), `deliveryTarget text?`,
`lastRunAt tz?`, `lastRunStatus text?`, `lastRunId uuid?→agent_run.id`, `nextRunAt tz?`.
Indexes: partial-unique `(name) where live`, `(enabled) where live`.

---

## 6. Model provider — Vercel AI Gateway

`memory/model.factory.ts`:
```ts
import { createGateway } from '@ai-sdk/gateway';
export function buildModel(cfg: MastraConfig) {
  const gw = createGateway({ apiKey: cfg.aiGatewayApiKey }); // AI_GATEWAY_API_KEY
  return gw(cfg.model); // e.g. 'anthropic/claude-sonnet-4.6' (Opus for heavy analysis, configurable)
}
```
The gateway gives one key, provider failover, and cost tracking. The returned AI-SDK model object is
accepted directly by Mastra's `model` field. The model id is config-driven; confirm the exact
current Claude slug against the gateway model list at implementation time.

---

## 7. Tools — curated-data principle

Every tool **pulls + aggregates and returns a compact, capped result**; raw rows never reach the
model. All take Zod `inputSchema`/`outputSchema`. Services come from `ctx.requestContext` (a typed
`ToolDeps`), as does the principal (for authz + audit).

- **`search-query`** (read, no approval) → `SearchRecordService.query(...)` (keeps its field/authz
  validation). Input `{ collection, query, filters?, topK<=25 }`; output = top-N hits with only the
  requested fields + `facetDistribution` + `totalHits`. Hard cap on `topK`.
- **`calculate-metric`** (read) → an aggregation **pattern stub** (e.g. "income last month"): input
  `{ metric, period, groupBy? }`; output `{ metric, value, unit, period, breakdown[] }`. Real
  finance/worklog wiring lands later behind the same interface.
- **`send-email`** (action, `requireApproval: true`) → resolves the active SMTP config via
  `SmtpConfigService` (+ `EncryptionService.decrypt`) and sends via `nodemailer`. Input
  `{ to, subject, body, cc? }`; writes to `agent_action_log`.
- **`db-write`** (action, `requireApproval: true`) → a reusable guarded write pattern; in v1 it
  validates a typed intent and (until real domains exist) records the intended write. Concrete tables
  are wired later behind the same shape.

---

## 8. Agent definition (`orchestrator.agent.ts`)

`buildOrchestratorAgent(deps)` returns an `Agent` with: id `AGENT_ID`; house instructions (its role,
the curated-data discipline, "propose consequential actions for approval, never fabricate data");
`model: buildModel(cfg)`; the four tools; and `memory: buildMemory(pool)`. Structured output is
requested per-call via `structuredOutput` when the caller needs a typed report
(`{ summary, findings[], recommendedActions[] }`).

---

## 9. Workflow — scheduled report (`scheduled-report.workflow.ts`)

`createWorkflow({ id, inputSchema:{ userId?, scheduleId, promptTemplate, params }, retryConfig:{
attempts:2, delay:2000 } })` with steps:
1. **gather** (`createStep`) — call `search-query`/`calculate-metric` (or the services directly) to
   assemble curated data for the period.
2. **analyze** — `createStep(orchestratorAgent, { structuredOutput: { schema: ReportSchema } })`
   → a typed report.
3. **deliver** — write the report as a message into the target conversation
   (`deliveryChannel:'conversation'`), and/or **`suspend()`** for approval when
   `deliveryChannel:'email'` to an external recipient; on `resume({ approved:true })` send via
   `send-email`. Internal delivery for SYSTEM runs auto-proceeds (no suspend), per decision #7.

Run via `mastra.getWorkflow('scheduled-report').createRun()` → `start({ inputData, requestContext:{
principal: SYSTEM } })`; the `mastraRunId` is stored on `agent_run` for resume/watch correlation.

---

## 10. Runtime flows

**Chat** — `POST /agent/chat {conversationId?, message}` (JWT, `@CurrentUser()`):
`ConversationService.ensure(principal, conversationId)` → `AgentRunnerService.run`: open
`agent_run(trigger=user_message, status=running)` → `agent.generate(message, { memory:{ resource,
thread }, requestContext:{ principal, deps } })` → on finish update the run (status, curated
`output`, tokens, latency) + `conversation.lastMessageAt/messageCount`; return `{ text, structured?,
pendingApprovals? }`.

**Approval (HITL)** — a `requireApproval` tool suspends the turn; `AgentRunnerService` detects the
approval-required signal, persists `agent_approval(pending)` with `mastraRunId` + `toolCallId` +
payload, and sets `agent_run.status=awaiting_approval`. Human: `GET /agent/approvals` →
`POST /agent/approvals/:id {decision, note}` → `ApprovalService`: **approve** →
`agent.approveToolCall({ runId, toolCallId })` (tool executes → `agent_action_log`); **reject** →
`declineToolCall`. Update the approval + run.

**Scheduled** — `AgentScheduleScheduler` (bootstrap/ops hook, not auto-run at import) reads enabled
`agent_schedule` rows and registers BullMQ repeatable jobs (`jobId = schedule.id`, cron). On fire →
`AgentRunProcessor` (`WorkerHost`) loads the schedule, opens `agent_run(trigger=schedule)`, runs the
scheduled-report workflow, and updates `schedule.lastRun*` + the run. Job opts `{ attempts:3,
backoff: exponential 1000, removeOnComplete:true, removeOnFail:100 }`.

---

## 11. Error handling, retries & reliability (layered)

BullMQ job retries (async/scheduled) → workflow `retryConfig`/step `retries` (transient step
failures) → agent `maxRetries` + gateway provider failover (model errors) → tool `try/catch`
returning typed errors (never leak raw errors to the model) → `MastraError` classification recorded
to `agent_run.error`. Idempotency via `agent_run.status` + dedup `jobId`; `abortSignal` + `maxSteps`
cap runaway loops; approvals expire (`expiresAt`). Sentry + Pino (already wired) capture the rest.

---

## 12. Security & authz

The global `JwtAuthGuard` covers all routes; `@CurrentUser() principal` drives ownership checks in
`ConversationService`/`ApprovalService` (a user sees only their own conversations/approvals; admins
via `@Roles('admin')`). Schedule CRUD is admin-only. Secrets (SMTP, third-party API keys) stay in the
encrypted `IntegrationCredential`/SMTP stores; the gateway key is env-only. Action tools are
approval-gated; `agent_action_log` is the immutable side-effect trail. Prompt-injection risk on tool
outputs is mitigated by curated/validated shapes + `outputSchema` and flagged for a hardening pass in
v2.

---

## 13. Config & dependencies

**New deps:** `@mastra/memory` and `@mastra/pg` (align with core `^1.50`), `@ai-sdk/gateway@latest`.
**`src/config/configurations/mastra.config.ts`** (`registerAs('mastra', …)`) exposes
`{ aiGatewayApiKey, model, maxRetries, memoryLastMessages, approvalTtlMs, scheduleEnabled }`; add it
to the `load: [...]` array in `config.module.ts`. **`env.validation.ts`:** add `AI_GATEWAY_API_KEY`
(prod `.superRefine` requires non-empty), `MASTRA_MODEL` (default a current Claude slug), and
`MASTRA_SCHEDULES_ENABLED` (bool). Reuse the existing `role: 'agent'` / `SYSTEM_PRINCIPAL`.

---

## 14. Observability & testing

- **Observability:** Mastra `observability` config → the Pino logger; token usage + latency
  persisted on `agent_run`; Sentry captures unhandled errors.
- **Testing (note the known Mastra-ESM/Jest constraint):** unit-test services/repos/tools with the
  Mastra instance and gateway **mocked** (no live model calls); use `MockMemory`/`InMemoryStore` from
  core where a store is needed. e2e specs **boot a focused module subset, not `AppModule`** (per the
  project's e2e convention — Mastra's ESM deps break a full `AppModule` boot under Jest), and stub the
  model/gateway. Verify: the schema migration applies; a chat turn records an `agent_run`; a
  `requireApproval` tool produces a pending `agent_approval` and resumes on approve; a scheduled job
  runs the workflow and writes `agent_action_log`.

---

## 15. Verification (end-to-end, at implementation time)

1. `pnpm db:generate && pnpm db:migrate` — new `agent_*` tables created; app boots with
   `MastraModule` last and `PgStore` init'ing the `mastra` schema.
2. `pnpm build` + `pnpm typecheck` clean; `pnpm test` (mocked model) green.
3. Manual: `POST /agent/chat` "summarize collection X" → returns a curated answer, `agent_run`
   succeeded, conversation created. Ask it to email a summary → `agent_approval(pending)`;
   `POST /agent/approvals/:id {approved}` → email sent, `agent_action_log(success)`.
4. Register an `agent_schedule` with a 1-min cron → `AgentRunProcessor` runs the report workflow,
   delivers into a conversation, `schedule.lastRunStatus='succeeded'`.

---

## 16. Deferred to v2
Semantic recall (`PgVector` + embedder), SSE streaming to clients, real finance/worklog domains
behind `db-write`/`calculate-metric`, a prompt-injection hardening pass, multi-agent networks, and
approval notifications (email/push) to reviewers.

---

## Next step
The implementation plan (schema → deps/config → Mastra factory + memory + model → tools → agent →
services → controllers → workflow → BullMQ → tests) is produced separately in the implementation
stage (`current_implementation_plan.md`).
