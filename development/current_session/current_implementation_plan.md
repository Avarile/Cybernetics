# Mastra AI Agent Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 Mastra AI agent module in `src/features/mastra` — a conversational + scheduled agent that pulls curated data, analyzes it, and responds / takes approval-gated actions, per `development/current_session/current_design.md`.

**Architecture:** A conventional NestJS feature module that fronts a Mastra instance (built via `MastraCoreModule.registerAsync`). Mastra + `@mastra/pg` own conversation content (threads/messages/snapshots) in a dedicated `mastra` Postgres schema; we own a 5-table Drizzle orchestration/audit layer. Tools capture app services as closures; the per-request `Principal` flows through Mastra's `requestContext`. BullMQ drives scheduled runs; human-in-the-loop uses tool-level `requireApproval` (chat) and workflow `suspend()`/`resume()` (scheduled).

**Tech Stack:** NestJS 11, Drizzle ORM (node-postgres), `@mastra/core@1.50.1` + `@mastra/nestjs@0.2.6`, `@mastra/memory` + `@mastra/pg` (to add), Vercel AI Gateway via `@ai-sdk/gateway` (to add), BullMQ, Zod 3, Jest + `@swc/jest`.

## Global Constraints

- Files under 500 lines; validate input at system boundaries; read a file before editing it.
- NEVER add a `Co-Authored-By` trailer to commits (this repo's `.claude/settings.json` has no `attribution.commit`).
- Drizzle: UUID PKs (`defaultRandom()`), `snake_case` columns / `camelCase` keys, `timestamp(..., { withTimezone: true })`, `jsonb().$type<T>()`, partial-unique "live rows" via `.where(sql\`${t.isDeleted} = false\`)`. Spread `baseColumns` from `schema/common.ts` (except append-only logs).
- DTOs are Zod schemas + inferred types, applied with `new ZodValidationPipe(schema)`.
- Unit specs (`*.spec.ts`, run by `jest.config.js`, rootDir `src`) MUST NOT import any `@mastra/*` or `@ai-sdk/*` **value** (only `import type`). Rationale: those packages are ESM and the swc/Jest setup does not transform `node_modules`, so importing them at runtime breaks the spec (the `e2e-focused-module-imports` project note). Test logic via pure functions and `new Service(mock as never)` — the existing `search-record.service.spec.ts` is the reference style.
- Mastra-touching files (factories, agent, tool `createTool` wrappers, `buildMastra`, module, workflow, resume/detect adapters) are verified by **manual integration** (§ Manual Verification), not unit specs.
- Model calls cost money and are non-deterministic — no automated test performs a live model call.
- Migrations: `pnpm db:generate` then `pnpm db:migrate`. Datastore ports come from `.env` (Postgres :30898, Redis :30490), not docker defaults.

## Shared Contracts (names/types every task must use verbatim)

`src/features/mastra/mastra.constants.ts`
```ts
export const AGENT_ID = 'orchestrator';
export const SCHEDULED_REPORT_WORKFLOW_ID = 'scheduled-report';
export const AGENT_RUN_QUEUE = 'agent-run';
export const RUN_SCHEDULE_JOB = 'run-schedule';
export const MASTRA_PG_SCHEMA = 'mastra';
export const REQUEST_CTX = { principal: 'principal', runId: 'runId', conversationId: 'conversationId' } as const;
export const AGENT_RUN_JOB_OPTS = { attempts: 3, backoff: { type: 'exponential' as const, delay: 1000 }, removeOnComplete: true, removeOnFail: 100 };
```

Enum value arrays (single source of truth, declared in `agent.schema.ts`, mirrored as TS unions in `mastra.types.ts`):
- `conversationKind` = `['chat','scheduled','event']`
- `conversationStatus` = `['active','archived']`
- `runTrigger` = `['user_message','schedule','event','api']`
- `runStatus` = `['queued','running','awaiting_approval','succeeded','failed','cancelled']`
- `actionType` = `['send_email','db_write','external_api','other']`
- `approvalStatus` = `['pending','approved','rejected','expired','executed','failed']`
- `actionStatus` = `['success','failed']`
- `deliveryChannel` = `['conversation','email','none']`

Key cross-task interfaces (defined in `mastra.types.ts`, Task 3):
```ts
export interface PrincipalRef { id: string | null; role?: string }
export interface CuratedSearchResult { collection: string; totalHits: number; hits: Array<Record<string, unknown>>; facets?: Record<string, Record<string, number>> }
export interface CuratedMetric { metric: string; value: number; unit: string; period: string; breakdown: Array<{ key: string; value: number }> }
export interface PendingApproval { toolCallId: string; actionType: ActionType; title: string; payload: Record<string, unknown> }
export interface ToolRuntime { principal: PrincipalRef; runId: string | null; conversationId: string | null }
```

## File Structure (created/modified)

- Config: `src/config/configurations/mastra.config.ts` (new); `src/config/env.validation.ts`, `src/config/config.module.ts` (modify).
- Schema: `src/infrastructure/database/schema/agent.schema.ts` (new); `schema/index.ts` (modify); one generated migration.
- Module root: `src/features/mastra/{mastra.constants.ts,mastra.types.ts,index.ts,mastra.module.ts}`.
- Factories: `src/features/mastra/memory/{model.factory.ts,memory.factory.ts}`.
- Tools: `src/features/mastra/tools/{tool-context.ts,search-query.tool.ts,calculate-metric.tool.ts,send-email.tool.ts,db-write.tool.ts}`.
- Agent/workflow: `src/features/mastra/agents/{prompts.ts,orchestrator.agent.ts}`; `src/features/mastra/workflows/scheduled-report.workflow.ts`.
- Repos: `src/features/mastra/repositories/{conversation,agent-run,approval,action-log,schedule}.repository.ts`.
- Services: `src/features/mastra/services/{conversation,agent-runner,approval,schedule}.service.ts` + `mastra-adapters.ts`.
- Controllers/DTOs: `src/features/mastra/controllers/{chat,approval,schedule}.controller.ts`; `src/features/mastra/dto/{chat,approval,schedule}.dto.ts`.
- BullMQ: `src/features/mastra/processors/agent-run.processor.ts`; `src/features/mastra/schedulers/agent-schedule.scheduler.ts`.
- SMTP send: `src/features/system/connection/smtp-tester.ts` (add `sendSmtpMail`), `src/features/system/smtp-config.service.ts` (add `sendActive`), `src/features/system/smtp-config.repository.ts` (add `findActive`).
- Wiring: `src/app.module.ts` (MastraModule already last — verify).

## Coverage map (design § → task)
§3 module/DI → T3,T11; §4 persistence → T2,T4; §5 schema → T2; §6 model → T4; §7 tools → T5,T6; §8 agent → T7; §9 workflow → T12; §10 flows → T9,T10,T13; §11 errors/retries → T9,T13; §12 authz → T8,T10; §13 config/deps → T1; §14 testing → all + Manual Verification.

---

### Task 1: Dependencies, config namespace, env vars

**Files:**
- Modify: `package.json` (deps)
- Create: `src/config/configurations/mastra.config.ts`
- Create: `src/config/configurations/mastra.config.spec.ts`
- Modify: `src/config/env.validation.ts`
- Modify: `src/config/config.module.ts`

**Interfaces:**
- Produces: `mastraConfig` (registerAs 'mastra'); `type MastraConfig = ReturnType<typeof mastraConfig>` with fields `{ aiGatewayApiKey: string; model: string; maxRetries: number; memoryLastMessages: number; approvalTtlMs: number; schedulesEnabled: boolean }`.

- [ ] **Step 1: Install packages**

Run:
```bash
pnpm add @mastra/memory@^1.50 @mastra/pg@^1.50 @ai-sdk/gateway@latest
```
Expected: installs succeed. If pnpm prints a peer-version warning for `@mastra/*` vs `@mastra/core@1.50.1`, pin the two `@mastra/*` packages to exactly `1.50.1` and re-run. Confirm `node -e "require('@mastra/pg')"` and `node -e "require('@ai-sdk/gateway')"` do not throw.

- [ ] **Step 2: Add env vars to `env.validation.ts`**

Add inside `envSchema` (after the MeiliSearch block):
```ts
    // Mastra AI agent
    AI_GATEWAY_API_KEY: z.string().default(''),
    MASTRA_MODEL: z.string().min(1).default('anthropic/claude-sonnet-4.6'),
    MASTRA_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
    MASTRA_MEMORY_LAST_MESSAGES: z.coerce.number().int().positive().default(20),
    MASTRA_APPROVAL_TTL_MS: z.coerce.number().int().positive().default(86_400_000),
    MASTRA_SCHEDULES_ENABLED: booleanFromEnv.default(false),
```
Add this production rule inside the existing `.superRefine`:
```ts
    if (env.NODE_ENV === 'production' && env.AI_GATEWAY_API_KEY.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_GATEWAY_API_KEY'],
        message: 'AI_GATEWAY_API_KEY is required when NODE_ENV=production.',
      });
    }
```

- [ ] **Step 3: Create `mastra.config.ts`**

```ts
import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/** Namespaced config for the Mastra AI agent module. */
export const mastraConfig = registerAs('mastra', () => {
  const env = validateEnv(process.env);
  return {
    aiGatewayApiKey: env.AI_GATEWAY_API_KEY,
    model: env.MASTRA_MODEL,
    maxRetries: env.MASTRA_MAX_RETRIES,
    memoryLastMessages: env.MASTRA_MEMORY_LAST_MESSAGES,
    approvalTtlMs: env.MASTRA_APPROVAL_TTL_MS,
    schedulesEnabled: env.MASTRA_SCHEDULES_ENABLED,
  };
});

export type MastraConfig = ReturnType<typeof mastraConfig>;
```

- [ ] **Step 4: Register in `config.module.ts`** — add `mastraConfig` to the imports and to the `load: [...]` array (follow the existing `searchConfig` entry).

- [ ] **Step 5: Write the failing test `mastra.config.spec.ts`**

```ts
import { mastraConfig } from './mastra.config';

describe('mastraConfig', () => {
  const OLD = process.env;
  afterEach(() => { process.env = OLD; });

  it('reads defaults', () => {
    process.env = { ...OLD };
    const cfg = mastraConfig();
    expect(cfg.model).toBe('anthropic/claude-sonnet-4.6');
    expect(cfg.memoryLastMessages).toBe(20);
    expect(cfg.schedulesEnabled).toBe(false);
  });

  it('reads overrides from env', () => {
    process.env = { ...OLD, MASTRA_MODEL: 'anthropic/claude-opus-4.8', MASTRA_SCHEDULES_ENABLED: 'true' };
    const cfg = mastraConfig();
    expect(cfg.model).toBe('anthropic/claude-opus-4.8');
    expect(cfg.schedulesEnabled).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests** — `pnpm jest src/config/configurations/mastra.config.spec.ts` → 2 passing.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add package.json pnpm-lock.yaml src/config
git commit -m "feat(mastra): add deps, config namespace, and env vars"
```

---

### Task 2: Drizzle schema + migration

**Files:**
- Create: `src/infrastructure/database/schema/agent.schema.ts`
- Create: `src/infrastructure/database/schema/agent.schema.spec.ts`
- Modify: `src/infrastructure/database/schema/index.ts`

**Interfaces:**
- Produces: tables `agentConversations`, `agentRuns`, `agentApprovals`, `agentActionLog`, `agentSchedules`; row types `*Row`/`New*Row`; enum objects (`runStatus`, etc.).

- [ ] **Step 1: Confirm the users table export**

Run: `grep -n "export const" src/infrastructure/database/schema/identity.schema.ts | head`
Expected: shows the users table export name (assume `users`; use the confirmed name in the FKs below).

- [ ] **Step 2: Create `agent.schema.ts`**

```ts
import { sql } from 'drizzle-orm';
import {
  boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { users } from './identity.schema';

export const conversationKind = pgEnum('agent_conversation_kind', ['chat', 'scheduled', 'event']);
export const conversationStatus = pgEnum('agent_conversation_status', ['active', 'archived']);
export const runTrigger = pgEnum('agent_run_trigger', ['user_message', 'schedule', 'event', 'api']);
export const runStatus = pgEnum('agent_run_status', ['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled']);
export const actionType = pgEnum('agent_action_type', ['send_email', 'db_write', 'external_api', 'other']);
export const approvalStatus = pgEnum('agent_approval_status', ['pending', 'approved', 'rejected', 'expired', 'executed', 'failed']);
export const actionStatus = pgEnum('agent_action_status', ['success', 'failed']);
export const deliveryChannel = pgEnum('agent_schedule_delivery', ['conversation', 'email', 'none']);

/** Thin metadata over a Mastra thread; `id` IS the Mastra thread id. Stores no messages. */
export const agentConversations = pgTable('agent_conversation', {
  ...baseColumns,
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  resourceId: text('resource_id').notNull(),
  title: varchar('title', { length: 500 }),
  kind: conversationKind('kind').notNull().default('chat'),
  status: conversationStatus('status').notNull().default('active'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  messageCount: integer('message_count').notNull().default(0),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  index('agent_conversation_owner_idx').on(t.ownerUserId).where(sql`${t.isDeleted} = false`),
  index('agent_conversation_resource_idx').on(t.resourceId),
  index('agent_conversation_kind_status_idx').on(t.kind, t.status),
]);

/** Ledger of every agent invocation. */
export const agentRuns = pgTable('agent_run', {
  ...baseColumns,
  conversationId: uuid('conversation_id').references(() => agentConversations.id),
  trigger: runTrigger('trigger').notNull(),
  triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id),
  status: runStatus('status').notNull().default('queued'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb('output').$type<Record<string, unknown>>(),
  error: jsonb('error').$type<{ message: string; code?: string; category?: string }>(),
  attempts: integer('attempts').notNull().default(0),
  mastraRunId: text('mastra_run_id'),
  agentId: text('agent_id').notNull(),
  model: text('model'),
  tokensInput: integer('tokens_input'),
  tokensOutput: integer('tokens_output'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  latencyMs: integer('latency_ms'),
}, (t) => [
  index('agent_run_conversation_idx').on(t.conversationId),
  index('agent_run_status_idx').on(t.status),
  index('agent_run_trigger_idx').on(t.trigger),
  index('agent_run_mastra_run_idx').on(t.mastraRunId),
]);

/** Pending human-in-the-loop decisions. */
export const agentApprovals = pgTable('agent_approval', {
  ...baseColumns,
  runId: uuid('run_id').notNull().references(() => agentRuns.id),
  conversationId: uuid('conversation_id').references(() => agentConversations.id),
  mastraRunId: text('mastra_run_id'),
  toolCallId: text('tool_call_id'),
  suspendPath: text('suspend_path'),
  actionType: actionType('action_type').notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  status: approvalStatus('status').notNull().default('pending'),
  decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: varchar('decision_note', { length: 1000 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  result: jsonb('result').$type<Record<string, unknown>>(),
}, (t) => [
  index('agent_approval_run_idx').on(t.runId),
  index('agent_approval_conversation_idx').on(t.conversationId),
  index('agent_approval_pending_idx').on(t.status).where(sql`${t.status} = 'pending'`),
]);

/** Append-only audit of side-effects the agent performed (no baseColumns). */
export const agentActionLog = pgTable('agent_action_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  runId: uuid('run_id').notNull().references(() => agentRuns.id),
  conversationId: uuid('conversation_id'),
  actorUserId: uuid('actor_user_id'),
  actionType: actionType('action_type').notNull(),
  toolId: text('tool_id').notNull(),
  status: actionStatus('status').notNull(),
  summary: varchar('summary', { length: 1000 }).notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  approvalId: uuid('approval_id').references(() => agentApprovals.id),
}, (t) => [
  index('agent_action_log_run_idx').on(t.runId),
  index('agent_action_log_created_idx').on(t.createdAt),
  index('agent_action_log_type_idx').on(t.actionType),
]);

/** Scheduled-run definitions (admin-managed). */
export const agentSchedules = pgTable('agent_schedule', {
  ...baseColumns,
  name: varchar('name', { length: 200 }).notNull(),
  description: varchar('description', { length: 1000 }),
  cron: varchar('cron', { length: 120 }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
  enabled: boolean('enabled').notNull().default(true),
  targetUserId: uuid('target_user_id').references(() => users.id),
  agentId: text('agent_id').notNull(),
  promptTemplate: text('prompt_template').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  deliveryChannel: deliveryChannel('delivery_channel').notNull().default('conversation'),
  deliveryTarget: varchar('delivery_target', { length: 500 }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunStatus: varchar('last_run_status', { length: 40 }),
  lastRunId: uuid('last_run_id'),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('agent_schedule_name_idx').on(t.name).where(sql`${t.isDeleted} = false`),
  index('agent_schedule_enabled_idx').on(t.enabled).where(sql`${t.isDeleted} = false`),
]);

export type AgentConversationRow = typeof agentConversations.$inferSelect;
export type NewAgentConversationRow = typeof agentConversations.$inferInsert;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type NewAgentRunRow = typeof agentRuns.$inferInsert;
export type AgentApprovalRow = typeof agentApprovals.$inferSelect;
export type NewAgentApprovalRow = typeof agentApprovals.$inferInsert;
export type AgentActionLogRow = typeof agentActionLog.$inferSelect;
export type NewAgentActionLogRow = typeof agentActionLog.$inferInsert;
export type AgentScheduleRow = typeof agentSchedules.$inferSelect;
export type NewAgentScheduleRow = typeof agentSchedules.$inferInsert;
```

- [ ] **Step 3: Barrel-export** — add to `schema/index.ts`: `export * from './agent.schema';`

- [ ] **Step 4: Write the failing test `agent.schema.spec.ts`** (mirror `search.schema.spec.ts` style)

```ts
import { agentConversations, agentApprovals, agentSchedules, runStatus } from './agent.schema';

describe('agent.schema', () => {
  it('agent_conversation exposes id + owner + resource columns', () => {
    expect(agentConversations.id).toBeDefined();
    expect(agentConversations.ownerUserId).toBeDefined();
    expect(agentConversations.resourceId).toBeDefined();
  });
  it('agent_run status enum has the six states', () => {
    expect(runStatus.enumValues).toEqual(['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled']);
  });
  it('agent_approval references a run; agent_schedule has cron + enabled', () => {
    expect(agentApprovals.runId).toBeDefined();
    expect(agentSchedules.cron).toBeDefined();
    expect(agentSchedules.enabled).toBeDefined();
  });
});
```

- [ ] **Step 5: Run tests + generate migration**

Run: `pnpm jest src/infrastructure/database/schema/agent.schema.spec.ts` → 3 passing.
Run: `pnpm db:generate`
Expected: a new SQL migration appears under `src/infrastructure/database/migrations/` creating the 8 enums + 5 tables. Open it and confirm no unexpected drops.

- [ ] **Step 6: Apply migration + commit**

Run: `pnpm db:migrate` → applies cleanly against Postgres :30898.
```bash
git add src/infrastructure/database/schema src/infrastructure/database/migrations
git commit -m "feat(mastra): agent orchestration/audit schema + migration"
```

---

### Task 3: Constants + shared types

**Files:**
- Create: `src/features/mastra/mastra.constants.ts`
- Create: `src/features/mastra/mastra.types.ts`
- Create: `src/features/mastra/mastra.types.spec.ts`

**Interfaces:**
- Produces: everything in **Shared Contracts** above; TS unions derived from the schema enums; the `AgentReport` Zod schema.

- [ ] **Step 1: Create `mastra.constants.ts`** — copy the Shared Contracts constants block verbatim.

- [ ] **Step 2: Create `mastra.types.ts`**

```ts
import { z } from 'zod';
import type { SearchRecordService } from '../search-service/search-record.service';

export type ConversationKind = 'chat' | 'scheduled' | 'event';
export type ConversationStatus = 'active' | 'archived';
export type RunTrigger = 'user_message' | 'schedule' | 'event' | 'api';
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled';
export type ActionType = 'send_email' | 'db_write' | 'external_api' | 'other';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed';
export type ActionStatus = 'success' | 'failed';
export type DeliveryChannel = 'conversation' | 'email' | 'none';

export interface PrincipalRef { id: string | null; role?: string }
export interface CuratedSearchResult { collection: string; totalHits: number; hits: Array<Record<string, unknown>>; facets?: Record<string, Record<string, number>> }
export interface CuratedMetric { metric: string; value: number; unit: string; period: string; breakdown: Array<{ key: string; value: number }> }
export interface PendingApproval { toolCallId: string; actionType: ActionType; title: string; payload: Record<string, unknown> }
export interface ToolRuntime { principal: PrincipalRef; runId: string | null; conversationId: string | null }

/** Deps captured by tool closures at buildMastra time (app-lifetime services). */
export interface ToolServices {
  searchRecords: Pick<SearchRecordService, 'search'>;
  sendEmail: (msg: { to: string; subject: string; text: string; cc?: string }) => Promise<void>;
  recordAction: (entry: {
    runId: string | null; conversationId: string | null; actorUserId: string | null;
    actionType: ActionType; toolId: string; status: ActionStatus; summary: string; detail?: Record<string, unknown>;
  }) => Promise<void>;
}

/** Structured report shape produced by the analyze step / structuredOutput. */
export const AgentReportSchema = z.object({
  summary: z.string(),
  findings: z.array(z.object({ title: z.string(), detail: z.string() })),
  recommendedActions: z.array(z.object({ action: z.string(), rationale: z.string() })).default([]),
});
export type AgentReport = z.infer<typeof AgentReportSchema>;
```

- [ ] **Step 3: Write the failing test `mastra.types.spec.ts`**

```ts
import { AgentReportSchema } from './mastra.types';
import { AGENT_ID, AGENT_RUN_QUEUE } from './mastra.constants';

describe('mastra shared contracts', () => {
  it('constants are stable ids', () => {
    expect(AGENT_ID).toBe('orchestrator');
    expect(AGENT_RUN_QUEUE).toBe('agent-run');
  });
  it('AgentReportSchema validates a report and defaults actions', () => {
    const r = AgentReportSchema.parse({ summary: 's', findings: [{ title: 't', detail: 'd' }] });
    expect(r.recommendedActions).toEqual([]);
  });
});
```

- [ ] **Step 4: Run + commit**

Run: `pnpm jest src/features/mastra/mastra.types.spec.ts` → 2 passing.
```bash
git add src/features/mastra/mastra.constants.ts src/features/mastra/mastra.types.ts src/features/mastra/mastra.types.spec.ts
git commit -m "feat(mastra): shared constants, types, and report schema"
```

---

### Task 4: Model + Memory factories

**Files:**
- Create: `src/features/mastra/memory/model.factory.ts`
- Create: `src/features/mastra/memory/memory.factory.ts`

**Interfaces:**
- Consumes: `MastraConfig` (T1); `MASTRA_PG_SCHEMA` (T3); `PG_POOL` token from `src/infrastructure/database/drizzle.constants.ts`.
- Produces: `buildModel(cfg: MastraConfig)`; `buildStore(pool, cfg)`; `buildMemory(pool, cfg)` returning a Mastra `Memory`.

- [ ] **Step 1: Confirm installed adapter APIs** (fast-moving; verify before coding)

Run:
```bash
grep -rn "createGateway\|export .*gateway" node_modules/@ai-sdk/gateway/dist/*.d.ts | head
grep -rn "class PgStore\|constructor\|schemaName\|schema" node_modules/@mastra/pg/dist/**/*.d.ts | head -40
grep -rn "class Memory\|constructor" node_modules/@mastra/memory/dist/**/*.d.ts | head
```
Record: the exact `createGateway`/`gateway` export from `@ai-sdk/gateway` (if `createGateway` is absent there, import from `ai`); the `PgStore` constructor signature + the option that scopes tables to a schema (`schemaName`/`schema`); the `Memory` constructor options.

- [ ] **Step 2: Create `model.factory.ts`**

```ts
import { createGateway } from '@ai-sdk/gateway';
import type { MastraConfig } from '../../../config/configurations/mastra.config';

/**
 * Returns a Vercel AI Gateway model object for the configured slug.
 * Model string is 'creator/model' (dots for versions), e.g. 'anthropic/claude-sonnet-4.6'.
 * If Step 1 showed `createGateway` is not exported by '@ai-sdk/gateway', change the import to `from 'ai'`.
 */
export function buildModel(cfg: MastraConfig) {
  const gateway = createGateway({ apiKey: cfg.aiGatewayApiKey });
  return gateway(cfg.model);
}
```

- [ ] **Step 3: Create `memory.factory.ts`** (adjust `PgStore`/`Memory` option names to what Step 1 confirmed)

```ts
import { Memory } from '@mastra/memory';
import { PgStore } from '@mastra/pg';
import type { Pool } from 'pg';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import { MASTRA_PG_SCHEMA } from '../mastra.constants';

/** Shared PgStore over the app pool, scoped to the `mastra` schema. */
export function buildStore(pool: Pool): PgStore {
  return new PgStore({ id: 'mastra-pg', pool, schemaName: MASTRA_PG_SCHEMA });
}

/**
 * Conversation persistence is owned entirely by Mastra (threads, messages, working
 * memory, workflow snapshots) in the `mastra` Postgres schema on the SAME pool.
 * v1: recent-message window + resource-scoped working memory; semantic recall OFF.
 */
export function buildMemory(pool: Pool, cfg: MastraConfig): Memory {
  return new Memory({
    storage: buildStore(pool),
    options: {
      lastMessages: cfg.memoryLastMessages,
      semanticRecall: false,
      workingMemory: {
        enabled: true,
        scope: 'resource',
        template: '# User\n- Name:\n- Role:\n- Preferences:\n- Ongoing goals:',
      },
      generateTitle: true,
    },
  });
}
```

- [ ] **Step 4: Typecheck + commit** (no unit spec — Mastra ESM; covered by Manual Verification)

Run: `pnpm typecheck`
```bash
git add src/features/mastra/memory
git commit -m "feat(mastra): model (AI Gateway) + Postgres memory factories"
```

---

### Task 5: Read tools — search-query + calculate-metric

**Files:**
- Create: `src/features/mastra/tools/tool-context.ts`
- Create: `src/features/mastra/tools/search-query.tool.ts` (+ `.spec.ts`)
- Create: `src/features/mastra/tools/calculate-metric.tool.ts` (+ `.spec.ts`)

**Interfaces:**
- Consumes: `ToolServices`, `ToolRuntime`, `CuratedSearchResult`, `CuratedMetric`, `REQUEST_CTX`.
- Produces: pure `searchQueryExecute(input, deps)`, `calculateMetricExecute(input, deps)`; wrappers `makeSearchQueryTool(services)`, `makeCalculateMetricTool(services)`; `readRuntime(context)` helper.

- [ ] **Step 1: Create `tool-context.ts`** (isolates the only Mastra-context read; verify accessor: `grep -rn "requestContext" node_modules/@mastra/core/dist/tools/types.d.ts`)

```ts
import { REQUEST_CTX } from '../mastra.constants';
import type { ToolRuntime } from '../mastra.types';

/**
 * Reads our per-call values out of Mastra's tool execution context.
 * `context.requestContext` is Map-like (`.get(key)`). If Task 4 Step 1 showed a
 * different accessor, adjust the three `.get(...)` calls here only.
 */
export function readRuntime(context: unknown): ToolRuntime {
  const rc = (context as { requestContext?: { get(k: string): unknown } })?.requestContext;
  const principal = (rc?.get(REQUEST_CTX.principal) as ToolRuntime['principal']) ?? { id: null };
  return {
    principal,
    runId: (rc?.get(REQUEST_CTX.runId) as string) ?? null,
    conversationId: (rc?.get(REQUEST_CTX.conversationId) as string) ?? null,
  };
}
```

- [ ] **Step 2: Write the failing test `search-query.tool.spec.ts`**

```ts
import { searchQueryExecute } from './search-query.tool';

const engineResult = { hits: [{ id: '1', title: 'A' }], totalHits: 1, page: 1, hitsPerPage: 10, totalPages: 1, processingTimeMs: 1, facetDistribution: { status: { live: 1 } } };

function deps() {
  return { searchRecords: { search: jest.fn(async () => engineResult) } } as never;
}

describe('searchQueryExecute', () => {
  it('caps topK at 25 and returns a curated result', async () => {
    const d = deps();
    const out = await searchQueryExecute({ collection: 'articles', query: 'a', topK: 999 }, d);
    expect((d as any).searchRecords.search).toHaveBeenCalledWith('articles', expect.objectContaining({ q: 'a', limit: 25 }));
    expect(out.totalHits).toBe(1);
    expect(out.hits).toHaveLength(1);
    expect(out.facets).toEqual({ status: { live: 1 } });
  });

  it('passes allowlisted filters through', async () => {
    const d = deps();
    await searchQueryExecute({ collection: 'articles', query: '', filters: { status: 'live' }, topK: 5 }, d);
    expect((d as any).searchRecords.search).toHaveBeenCalledWith('articles', expect.objectContaining({ filters: { status: 'live' }, limit: 5 }));
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `pnpm jest src/features/mastra/tools/search-query.tool.spec.ts` → FAIL ("searchQueryExecute is not a function").

- [ ] **Step 4: Create `search-query.tool.ts`**

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { CuratedSearchResult, ToolServices } from '../mastra.types';
import { readRuntime } from './tool-context';

export const searchQueryInput = z.object({
  collection: z.string().min(1),
  query: z.string().default(''),
  filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  topK: z.number().int().positive().max(25).default(10),
});
export type SearchQueryInput = z.infer<typeof searchQueryInput>;

const MAX_TOP_K = 25;

/** Pure logic — unit tested. Queries via SearchRecordService and returns a compact result. */
export async function searchQueryExecute(
  input: SearchQueryInput,
  deps: Pick<ToolServices, 'searchRecords'>,
): Promise<CuratedSearchResult> {
  const limit = Math.min(input.topK ?? 10, MAX_TOP_K);
  const res = await deps.searchRecords.search(input.collection, {
    q: input.query ?? '', page: 1, limit, filters: input.filters,
  } as never);
  return {
    collection: input.collection,
    totalHits: (res as { totalHits: number }).totalHits,
    hits: (res as { hits: Array<Record<string, unknown>> }).hits.slice(0, limit),
    facets: (res as { facetDistribution?: Record<string, Record<string, number>> }).facetDistribution,
  };
}

/** Mastra wrapper — not unit tested (imports @mastra). */
export function makeSearchQueryTool(services: ToolServices) {
  return createTool({
    id: 'search-query',
    description: 'Search a collection and return the top matches with facet counts. Read-only. Use to gather data before analysis; never request more than 25 results.',
    inputSchema: searchQueryInput,
    outputSchema: z.object({
      collection: z.string(), totalHits: z.number(),
      hits: z.array(z.record(z.string(), z.unknown())),
      facets: z.record(z.string(), z.record(z.string(), z.number())).optional(),
    }),
    execute: async (input: SearchQueryInput, context: unknown) => {
      void readRuntime(context);
      return searchQueryExecute(input, services);
    },
  });
}
```
> Verify `SearchRecordService.search(name, query)` signature + return field names (`totalHits`, `hits`, `facetDistribution`) against `src/features/search-service/search-record.service.ts`; adjust the mapping if they differ.

- [ ] **Step 5: Run search test** → PASS.

- [ ] **Step 6: Write the failing test `calculate-metric.tool.spec.ts`**

```ts
import { calculateMetricExecute } from './calculate-metric.tool';

describe('calculateMetricExecute', () => {
  it('returns a curated metric with a stable shape (v1 stub)', async () => {
    const out = await calculateMetricExecute({ metric: 'income', period: '2026-06', groupBy: 'category' }, {} as never);
    expect(out).toEqual(expect.objectContaining({ metric: 'income', period: '2026-06', unit: expect.any(String) }));
    expect(Array.isArray(out.breakdown)).toBe(true);
  });
});
```

- [ ] **Step 7: Create `calculate-metric.tool.ts`**

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { CuratedMetric, ToolServices } from '../mastra.types';

export const calculateMetricInput = z.object({
  metric: z.string().min(1),
  period: z.string().min(1),
  groupBy: z.string().optional(),
});
export type CalculateMetricInput = z.infer<typeof calculateMetricInput>;

/**
 * Pure logic — unit tested. v1 STUB for the heavy-aggregation pattern: returns a
 * curated, capped metric shape. When the finance/worklog domain exists, replace the
 * body with a real repository aggregation behind this same signature.
 */
export async function calculateMetricExecute(
  input: CalculateMetricInput,
  _deps: ToolServices,
): Promise<CuratedMetric> {
  return { metric: input.metric, value: 0, unit: 'unknown', period: input.period, breakdown: [] };
}

export function makeCalculateMetricTool(services: ToolServices) {
  return createTool({
    id: 'calculate-metric',
    description: 'Compute an aggregated business metric (e.g. total income) for a period. Returns a compact number + breakdown, never raw rows. Read-only.',
    inputSchema: calculateMetricInput,
    outputSchema: z.object({
      metric: z.string(), value: z.number(), unit: z.string(), period: z.string(),
      breakdown: z.array(z.object({ key: z.string(), value: z.number() })),
    }),
    execute: async (input: CalculateMetricInput) => calculateMetricExecute(input, services),
  });
}
```

- [ ] **Step 8: Run + commit**

Run: `pnpm jest src/features/mastra/tools/ && pnpm typecheck` → green.
```bash
git add src/features/mastra/tools/tool-context.ts src/features/mastra/tools/search-query.tool.ts src/features/mastra/tools/search-query.tool.spec.ts src/features/mastra/tools/calculate-metric.tool.ts src/features/mastra/tools/calculate-metric.tool.spec.ts
git commit -m "feat(mastra): read tools (search-query, calculate-metric) with curated output"
```

---

### Task 6: SMTP send + action tools (send-email, db-write)

**Files:**
- Modify: `src/features/system/connection/smtp-tester.ts` (add `sendSmtpMail`)
- Modify: `src/features/system/smtp-config.repository.ts` (add `findActive`)
- Modify: `src/features/system/smtp-config.service.ts` (add `sendActive`)
- Create: `src/features/mastra/tools/send-email.tool.ts` (+ `.spec.ts`)
- Create: `src/features/mastra/tools/db-write.tool.ts` (+ `.spec.ts`)

**Interfaces:**
- Consumes: `ToolServices`, `ToolRuntime`, `readRuntime` (T5).
- Produces: `SmtpConfigService.sendActive(msg)`; pure `sendEmailExecute(input, deps, rt)`, `dbWriteExecute(input, deps, rt)`; wrappers `makeSendEmailTool`, `makeDbWriteTool`.

- [ ] **Step 1: Add `sendSmtpMail` to `connection/smtp-tester.ts`** (read existing `testSmtpConnection` first; build the transport the same way)

```ts
import { createTransport } from 'nodemailer';

export interface SendSmtpParams {
  host: string; port: number; secure: boolean;
  username: string | null; password: string | null;
  fromAddress: string; fromName: string | null;
  to: string; subject: string; text: string; cc?: string;
}

export async function sendSmtpMail(p: SendSmtpParams): Promise<void> {
  const transport = createTransport({
    host: p.host, port: p.port, secure: p.secure,
    auth: p.username ? { user: p.username, pass: p.password ?? '' } : undefined,
  });
  await transport.sendMail({
    from: p.fromName ? `${p.fromName} <${p.fromAddress}>` : p.fromAddress,
    to: p.to, cc: p.cc, subject: p.subject, text: p.text,
  });
}
```

- [ ] **Step 2: Add `findActive` to `smtp-config.repository.ts`** (read the repo; match its actual table/column import names)

```ts
async findActive(): Promise<SmtpConfigRow | null> {
  const rows = await this.db.select().from(smtpConfigs)
    .where(and(eq(smtpConfigs.isActive, true), eq(smtpConfigs.isDeleted, false))).limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 3: Add `sendActive` to `SmtpConfigService`**

```ts
import { sendSmtpMail } from './connection/smtp-tester';
// ...
async sendActive(msg: { to: string; subject: string; text: string; cc?: string }): Promise<void> {
  const row = await this.repo.findActive();
  if (!row) throw new NotFoundException('No active SMTP config');
  await sendSmtpMail({
    host: row.host, port: row.port, secure: row.secure,
    username: row.username, password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
    fromAddress: row.fromAddress, fromName: row.fromName,
    to: msg.to, subject: msg.subject, text: msg.text, cc: msg.cc,
  });
}
```
Confirm `SystemModule` exports `SmtpConfigService` (it does per design research).

- [ ] **Step 4: Write the failing test `send-email.tool.spec.ts`**

```ts
import { sendEmailExecute } from './send-email.tool';

describe('sendEmailExecute', () => {
  const rt = { principal: { id: 'u1' }, runId: 'r1', conversationId: 'c1' };

  it('sends then records a success action', async () => {
    const d = { sendEmail: jest.fn(async () => undefined), recordAction: jest.fn(async () => undefined) } as never;
    const out = await sendEmailExecute({ to: 'a@b.com', subject: 'Hi', body: 'Body' }, d, rt);
    expect((d as any).sendEmail).toHaveBeenCalledWith({ to: 'a@b.com', subject: 'Hi', text: 'Body', cc: undefined });
    expect((d as any).recordAction).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'send_email', status: 'success', runId: 'r1' }));
    expect(out.sent).toBe(true);
  });

  it('records a failed action and rethrows on transport error', async () => {
    const d = { sendEmail: jest.fn(async () => { throw new Error('smtp down'); }), recordAction: jest.fn(async () => undefined) } as never;
    await expect(sendEmailExecute({ to: 'a@b.com', subject: 'Hi', body: 'B' }, d, rt)).rejects.toThrow('smtp down');
    expect((d as any).recordAction).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });
});
```

- [ ] **Step 5: Create `send-email.tool.ts`**

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ToolRuntime, ToolServices } from '../mastra.types';
import { readRuntime } from './tool-context';

export const sendEmailInput = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1),
  cc: z.string().email().optional(),
});
export type SendEmailInput = z.infer<typeof sendEmailInput>;

/** Pure logic — unit tested. Executes ONLY after human approval (requireApproval gates it). */
export async function sendEmailExecute(
  input: SendEmailInput,
  deps: Pick<ToolServices, 'sendEmail' | 'recordAction'>,
  rt: ToolRuntime,
): Promise<{ sent: true }> {
  try {
    await deps.sendEmail({ to: input.to, subject: input.subject, text: input.body, cc: input.cc });
    await deps.recordAction({
      runId: rt.runId, conversationId: rt.conversationId, actorUserId: rt.principal.id,
      actionType: 'send_email', toolId: 'send-email', status: 'success',
      summary: `Sent email to ${input.to}: ${input.subject}`, detail: { to: input.to, cc: input.cc },
    });
    return { sent: true };
  } catch (err) {
    await deps.recordAction({
      runId: rt.runId, conversationId: rt.conversationId, actorUserId: rt.principal.id,
      actionType: 'send_email', toolId: 'send-email', status: 'failed',
      summary: `Failed to email ${input.to}`, detail: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

export function makeSendEmailTool(services: ToolServices) {
  return createTool({
    id: 'send-email',
    description: 'Send an email. Performs a real, external side-effect and REQUIRES human approval before it runs.',
    inputSchema: sendEmailInput,
    outputSchema: z.object({ sent: z.literal(true) }),
    requireApproval: true,
    execute: async (input: SendEmailInput, context: unknown) => sendEmailExecute(input, services, readRuntime(context)),
  });
}
```
> Verify `requireApproval` is the field name on `ToolAction` in `node_modules/@mastra/core/dist/tools/types.d.ts` (Task-1 research confirmed it exists). If renamed, update here + Task 9's detection.

- [ ] **Step 6: Run send-email test** → PASS.

- [ ] **Step 7: Write `db-write.tool.spec.ts` + `db-write.tool.ts`** (reusable guarded write; v1 records the intended write)

`db-write.tool.spec.ts`:
```ts
import { dbWriteExecute } from './db-write.tool';
describe('dbWriteExecute', () => {
  it('records the intended write as a db_write action (v1 pattern)', async () => {
    const deps = { recordAction: jest.fn(async () => undefined) } as never;
    const rt = { principal: { id: 'u1' }, runId: 'r1', conversationId: 'c1' };
    const out = await dbWriteExecute({ entity: 'note', operation: 'create', data: { text: 'x' } }, deps, rt);
    expect(out.accepted).toBe(true);
    expect((deps as any).recordAction).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'db_write', status: 'success', toolId: 'db-write' }));
  });
});
```
`db-write.tool.ts`:
```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ToolRuntime, ToolServices } from '../mastra.types';
import { readRuntime } from './tool-context';

export const dbWriteInput = z.object({
  entity: z.string().min(1),
  operation: z.enum(['create', 'update', 'delete']),
  data: z.record(z.string(), z.unknown()),
  targetId: z.string().optional(),
});
export type DbWriteInput = z.infer<typeof dbWriteInput>;

/**
 * Pure logic — unit tested. Reusable guarded write pattern; REQUIRES approval.
 * v1 has no concrete domain to write, so it validates + records the intended write.
 * Wire concrete repositories here (behind this signature) when the domain lands.
 */
export async function dbWriteExecute(
  input: DbWriteInput,
  deps: Pick<ToolServices, 'recordAction'>,
  rt: ToolRuntime,
): Promise<{ accepted: true }> {
  await deps.recordAction({
    runId: rt.runId, conversationId: rt.conversationId, actorUserId: rt.principal.id,
    actionType: 'db_write', toolId: 'db-write', status: 'success',
    summary: `${input.operation} ${input.entity}${input.targetId ? ` #${input.targetId}` : ''}`,
    detail: { entity: input.entity, operation: input.operation, targetId: input.targetId },
  });
  return { accepted: true };
}

export function makeDbWriteTool(services: ToolServices) {
  return createTool({
    id: 'db-write',
    description: 'Create/update/delete a domain record. Performs a real data side-effect and REQUIRES human approval before it runs.',
    inputSchema: dbWriteInput,
    outputSchema: z.object({ accepted: z.literal(true) }),
    requireApproval: true,
    execute: async (input: DbWriteInput, context: unknown) => dbWriteExecute(input, services, readRuntime(context)),
  });
}
```

- [ ] **Step 8: Run + commit**

Run: `pnpm jest src/features/mastra/tools/ && pnpm typecheck` → green.
```bash
git add src/features/mastra/tools src/features/system
git commit -m "feat(mastra): SMTP send + action tools (send-email, db-write) with approval gating"
```

---

### Task 7: Prompts + orchestrator agent

**Files:**
- Create: `src/features/mastra/agents/prompts.ts`
- Create: `src/features/mastra/agents/orchestrator.agent.ts`

**Interfaces:**
- Consumes: `buildModel`, `buildMemory` (T4), the four `make*Tool` factories (T5,T6), `AGENT_ID`, `MastraConfig`, `ToolServices`.
- Produces: `buildOrchestratorAgent(params)` returning a Mastra `Agent`.

- [ ] **Step 1: Create `prompts.ts`**

```ts
export const ORCHESTRATOR_INSTRUCTIONS = `You are Cybernetics' operations agent. You help users by gathering data, analyzing it, and either answering, updating data, or taking an action.

Rules:
- ALWAYS gather facts with the read tools (search-query, calculate-metric) before analysis. Never invent data or numbers.
- Keep answers concise and evidence-based; cite what you found.
- For any action with a side-effect (send-email, db-write), propose it clearly; it will pause for human approval before running. Do not claim an action succeeded until it has.
- If data is missing or a tool fails, say so plainly and suggest next steps.`;
```

- [ ] **Step 2: Create `orchestrator.agent.ts`**

```ts
import { Agent } from '@mastra/core/agent';
import type { Pool } from 'pg';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import { AGENT_ID } from '../mastra.constants';
import type { ToolServices } from '../mastra.types';
import { buildMemory } from '../memory/memory.factory';
import { buildModel } from '../memory/model.factory';
import { makeCalculateMetricTool } from '../tools/calculate-metric.tool';
import { makeDbWriteTool } from '../tools/db-write.tool';
import { makeSearchQueryTool } from '../tools/search-query.tool';
import { makeSendEmailTool } from '../tools/send-email.tool';
import { ORCHESTRATOR_INSTRUCTIONS } from './prompts';

export interface BuildAgentParams {
  cfg: MastraConfig;
  pool: Pool;
  services: ToolServices;
  /** Test-only override so no live model call is made in integration. */
  modelOverride?: unknown;
}

export function buildOrchestratorAgent(params: BuildAgentParams): Agent {
  return new Agent({
    id: AGENT_ID,
    name: 'Orchestrator',
    instructions: ORCHESTRATOR_INSTRUCTIONS,
    model: (params.modelOverride ?? buildModel(params.cfg)) as never,
    tools: {
      'search-query': makeSearchQueryTool(params.services),
      'calculate-metric': makeCalculateMetricTool(params.services),
      'send-email': makeSendEmailTool(params.services),
      'db-write': makeDbWriteTool(params.services),
    },
    memory: buildMemory(params.pool, params.cfg),
    maxRetries: params.cfg.maxRetries,
  });
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/features/mastra/agents
git commit -m "feat(mastra): orchestrator agent + instructions"
```

---

### Task 8: Repositories + Conversation service

**Files:**
- Create: `src/features/mastra/repositories/{conversation,agent-run,approval,action-log,schedule}.repository.ts`
- Create: `src/features/mastra/services/conversation.service.ts` (+ `.spec.ts`)

**Interfaces:**
- Consumes: `DRIZZLE`/`DrizzleDB`; schema tables + row types (T2); `PrincipalRef` (T3).
- Produces: five repositories; `ConversationService` with `ensure(principal, conversationId?, kind?)`, `listForOwner(principal, page, limit)`, `getOwned(principal, id)`, `touch(id)`.
  - `AgentRunRepository`: `create(NewAgentRunRow)`, `finish(id, patch)`, `findById(id)`.
  - `ApprovalRepository`: `create(NewAgentApprovalRow)`, `findById(id)`, `findPendingForOwner(userId, role)`, `decide(id, patch)`.
  - `ActionLogRepository`: `record(entry)` → insert into `agentActionLog`.
  - `ScheduleRepository`: `create`, `listEnabled`, `findLiveById`, `softDelete`, `stampRun(id, status, runId)`.

- [ ] **Step 1: Create the five repositories** — extend `BaseRepository` or inject `DRIZZLE` directly (follow `search-record.repository.ts`). Example `conversation.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../infrastructure/database/drizzle.constants';
import { agentConversations } from '../../../infrastructure/database/schema/agent.schema';
import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class ConversationRepository extends BaseRepository<typeof agentConversations> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) { super(db, agentConversations); }

  async findLiveById(id: string) {
    const rows = await this.db.select().from(agentConversations)
      .where(and(eq(agentConversations.id, id), eq(agentConversations.isDeleted, false))).limit(1);
    return rows[0] ?? null;
  }

  async listByOwner(ownerUserId: string, page: number, limit: number) {
    return this.db.select().from(agentConversations)
      .where(and(eq(agentConversations.ownerUserId, ownerUserId), eq(agentConversations.isDeleted, false)))
      .orderBy(desc(agentConversations.lastMessageAt)).limit(limit).offset((page - 1) * limit);
  }

  async touch(id: string) {
    await this.db.update(agentConversations)
      .set({ lastMessageAt: new Date(), messageCount: sql`${agentConversations.messageCount} + 1` })
      .where(eq(agentConversations.id, id));
  }
}
```
Create the other four analogously with the methods listed in **Interfaces** (use `New*Row` insert types; `finish`/`decide`/`stampRun` are `db.update(...).set(patch).where(eq(id))`; `ActionLogRepository.record` is `db.insert(agentActionLog).values(entry)`; `ApprovalRepository.findPendingForOwner` joins `agentConversations` and returns all pending when `role === 'admin'`, else only rows whose conversation `ownerUserId === userId`). Keep each under 120 lines.

- [ ] **Step 2: Write the failing test `conversation.service.spec.ts`**

```ts
import { ConversationService } from './conversation.service';

function make(over: Record<string, any> = {}) {
  const repo = {
    create: jest.fn(async (v: any) => ({ id: 'conv-1', ...v })),
    findLiveById: jest.fn(async () => null),
    listByOwner: jest.fn(async () => []),
    touch: jest.fn(async () => undefined),
    ...over,
  };
  return { service: new ConversationService(repo as never), repo };
}

describe('ConversationService.ensure', () => {
  it('creates a new conversation owned by the principal when no id given', async () => {
    const { service, repo } = make();
    const conv = await service.ensure({ id: 'user-9' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'user-9', resourceId: 'user-9', kind: 'chat' }));
    expect(conv.id).toBe('conv-1');
  });

  it('returns the existing conversation when the principal owns it', async () => {
    const { service } = make({ findLiveById: jest.fn(async () => ({ id: 'conv-2', ownerUserId: 'user-9' })) });
    const conv = await service.ensure({ id: 'user-9' }, 'conv-2');
    expect(conv.id).toBe('conv-2');
  });

  it('403s when the principal does not own the conversation', async () => {
    const { service } = make({ findLiveById: jest.fn(async () => ({ id: 'conv-3', ownerUserId: 'someone-else' })) });
    await expect(service.ensure({ id: 'user-9' }, 'conv-3')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify it fails** → FAIL (module not found).

- [ ] **Step 4: Create `conversation.service.ts`**

```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ConversationKind, PrincipalRef } from '../mastra.types';
import { ConversationRepository } from '../repositories/conversation.repository';

@Injectable()
export class ConversationService {
  constructor(private readonly repo: ConversationRepository) {}

  private resourceOf(p: PrincipalRef): string { return p.id ?? 'system'; }

  async ensure(principal: PrincipalRef, conversationId?: string, kind: ConversationKind = 'chat') {
    if (conversationId) {
      const existing = await this.repo.findLiveById(conversationId);
      if (!existing) throw new NotFoundException('Conversation not found');
      if (principal.id && existing.ownerUserId && existing.ownerUserId !== principal.id) {
        throw new ForbiddenException('Not your conversation');
      }
      return existing;
    }
    return this.repo.create({ ownerUserId: principal.id, resourceId: this.resourceOf(principal), kind } as never);
  }

  async listForOwner(principal: PrincipalRef, page = 1, limit = 20) {
    if (!principal.id) return [];
    return this.repo.listByOwner(principal.id, page, limit);
  }

  async getOwned(principal: PrincipalRef, id: string) {
    const conv = await this.repo.findLiveById(id);
    if (!conv) throw new NotFoundException('Conversation not found');
    if (principal.id && conv.ownerUserId && conv.ownerUserId !== principal.id) {
      throw new ForbiddenException('Not your conversation');
    }
    return conv;
  }

  async touch(id: string) { await this.repo.touch(id); }
}
```

- [ ] **Step 5: Run tests** → 3 passing. `pnpm typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/features/mastra/repositories src/features/mastra/services/conversation.service.ts src/features/mastra/services/conversation.service.spec.ts
git commit -m "feat(mastra): repositories + conversation service with ownership checks"
```

---

### Task 9: Mastra adapters + Agent runner service (chat turn)

**Files:**
- Create: `src/features/mastra/services/mastra-adapters.ts`
- Create: `src/features/mastra/services/agent-runner.service.ts` (+ `.spec.ts`)

**Interfaces:**
- Consumes: `ConversationService` (T8), `AgentRunRepository` + `ApprovalRepository` (T8), `MastraService` (`@mastra/nestjs`), `REQUEST_CTX`, `AGENT_ID`, `PendingApproval`, `PrincipalRef`.
- Produces: `AgentRunnerService.runChat(principal, { conversationId?, message }): Promise<ChatResult>`; adapters `toPendingApprovals(result)`, `buildRequestContext(rt)`, `readUsage(result)`. `ChatResult = { conversationId, runId, text, pendingApprovals }`.

- [ ] **Step 1: Confirm result/approval shapes** (fast-moving)

Run:
```bash
grep -rn "approval\|suspend\|pendingApproval\|toolCall\|usage\|status" node_modules/@mastra/core/dist/agent/agent.types.d.ts | head -40
grep -rn "approveToolCall\|declineToolCall\|resumeGenerate\|requireToolApproval" node_modules/@mastra/core/dist/agent/agent.d.ts | head
```
Record: (a) the field on the `generate` result that signals a required approval + how to read the tool-call id/args; (b) the exact `approveToolCall`/`declineToolCall` signatures. Bind them into the adapters below — this is the ONLY place Mastra-result shape leaks in.

- [ ] **Step 2: Create `mastra-adapters.ts`** (fill the two marked accessors from Step 1)

```ts
import { REQUEST_CTX } from '../mastra.constants';
import type { PendingApproval, ToolRuntime } from '../mastra.types';

/** Build the per-call requestContext Mastra passes to tools. */
export function buildRequestContext(rt: ToolRuntime): Record<string, unknown> {
  return {
    [REQUEST_CTX.principal]: rt.principal,
    [REQUEST_CTX.runId]: rt.runId,
    [REQUEST_CTX.conversationId]: rt.conversationId,
  };
}

/** Map a generate() result to our pending-approval list. ADJUST the two accessors per Step 1. */
export function toPendingApprovals(result: unknown): PendingApproval[] {
  const r = result as { status?: string; toolCalls?: Array<{ toolCallId: string; toolName: string; args?: Record<string, unknown> }> };
  if (r.status !== 'suspended' && r.status !== 'awaiting_approval') return [];   // <-- accessor (a): status field
  const calls = r.toolCalls ?? [];                                              // <-- accessor (a): pending tool calls
  const typeByTool: Record<string, PendingApproval['actionType']> = { 'send-email': 'send_email', 'db-write': 'db_write' };
  return calls.map((c) => ({
    toolCallId: c.toolCallId,
    actionType: typeByTool[c.toolName] ?? 'other',
    title: `Approve ${c.toolName}`,
    payload: c.args ?? {},
  }));
}

export function readUsage(result: unknown): { model: string | null; tokensInput: number | null; tokensOutput: number | null; text: string } {
  const r = result as { text?: string; usage?: { inputTokens?: number; outputTokens?: number }; model?: string };
  return {
    model: r.model ?? null,
    tokensInput: r.usage?.inputTokens ?? null,
    tokensOutput: r.usage?.outputTokens ?? null,
    text: r.text ?? '',
  };
}
```

- [ ] **Step 3: Write the failing test `agent-runner.service.spec.ts`**

```ts
import { AgentRunnerService } from './agent-runner.service';

function make(genResult: any) {
  const conversations = { ensure: jest.fn(async () => ({ id: 'conv-1', ownerUserId: 'u1', resourceId: 'u1' })), touch: jest.fn(async () => undefined) };
  const runs = { create: jest.fn(async () => ({ id: 'run-1' })), finish: jest.fn(async () => undefined) };
  const approvals = { create: jest.fn(async () => ({ id: 'appr-1' })) };
  const agent = { generate: jest.fn(async () => genResult) };
  const mastra = { getAgent: jest.fn(() => agent) };
  const service = new AgentRunnerService(conversations as never, runs as never, approvals as never, mastra as never);
  return { service, conversations, runs, approvals, agent, mastra };
}

describe('AgentRunnerService.runChat', () => {
  it('runs a turn, records the run, and returns text', async () => {
    const { service, runs, conversations } = make({ status: 'success', text: 'Answer', usage: { inputTokens: 10, outputTokens: 5 } });
    const res = await service.runChat({ id: 'u1' }, { message: 'hi' });
    expect(res.text).toBe('Answer');
    expect(res.pendingApprovals).toHaveLength(0);
    expect(runs.finish).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'succeeded', tokensInput: 10 }));
    expect(conversations.touch).toHaveBeenCalledWith('conv-1');
  });

  it('persists pending approvals and marks the run awaiting_approval', async () => {
    const { service, approvals, runs } = make({ status: 'suspended', toolCalls: [{ toolCallId: 'tc1', toolName: 'send-email', args: { to: 'a@b.com' } }] });
    const res = await service.runChat({ id: 'u1' }, { message: 'email a@b.com' });
    expect(res.pendingApprovals).toHaveLength(1);
    expect(approvals.create).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', actionType: 'send_email' }));
    expect(runs.finish).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'awaiting_approval' }));
  });

  it('records failure when generate throws', async () => {
    const { service, runs, agent } = make(undefined);
    agent.generate = jest.fn(async () => { throw new Error('model down'); });
    await expect(service.runChat({ id: 'u1' }, { message: 'hi' })).rejects.toThrow('model down');
    expect(runs.finish).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'failed' }));
  });
});
```

- [ ] **Step 4: Run to verify it fails** → FAIL.

- [ ] **Step 5: Create `agent-runner.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import { AGENT_ID } from '../mastra.constants';
import type { PendingApproval, PrincipalRef } from '../mastra.types';
import { AgentRunRepository } from '../repositories/agent-run.repository';
import { ApprovalRepository } from '../repositories/approval.repository';
import { ConversationService } from './conversation.service';
import { buildRequestContext, readUsage, toPendingApprovals } from './mastra-adapters';

export interface ChatInput { conversationId?: string; message: string }
export interface ChatResult { conversationId: string; runId: string; text: string; pendingApprovals: PendingApproval[] }

@Injectable()
export class AgentRunnerService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly runs: AgentRunRepository,
    private readonly approvals: ApprovalRepository,
    private readonly mastra: MastraService,
  ) {}

  async runChat(principal: PrincipalRef, input: ChatInput): Promise<ChatResult> {
    const conv = await this.conversations.ensure(principal, input.conversationId, 'chat');
    const run = await this.runs.create({
      conversationId: conv.id, trigger: 'user_message', triggeredByUserId: principal.id,
      status: 'running', agentId: AGENT_ID, input: { message: input.message }, startedAt: new Date(),
    } as never);
    const startedAt = Date.now();
    try {
      const agent = this.mastra.getAgent(AGENT_ID);
      const result = await agent.generate(input.message, {
        memory: { resource: conv.resourceId, thread: { id: conv.id } },
        requestContext: buildRequestContext({ principal, runId: run.id, conversationId: conv.id }),
      } as never);

      const pending = toPendingApprovals(result);
      const usage = readUsage(result);
      for (const p of pending) {
        await this.approvals.create({
          runId: run.id, conversationId: conv.id, mastraRunId: (result as { runId?: string }).runId ?? null,
          toolCallId: p.toolCallId, actionType: p.actionType, title: p.title, payload: p.payload, status: 'pending',
        } as never);
      }
      await this.runs.finish(run.id, {
        status: pending.length ? 'awaiting_approval' : 'succeeded',
        output: { text: usage.text }, model: usage.model, tokensInput: usage.tokensInput,
        tokensOutput: usage.tokensOutput, finishedAt: new Date(), latencyMs: Date.now() - startedAt,
      });
      await this.conversations.touch(conv.id);
      return { conversationId: conv.id, runId: run.id, text: usage.text, pendingApprovals: pending };
    } catch (err) {
      await this.runs.finish(run.id, {
        status: 'failed', error: { message: err instanceof Error ? err.message : String(err) },
        finishedAt: new Date(), latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  }
}
```
> `agent.generate(...)` option keys (`memory`, `requestContext`) and result fields are per Task-1 research; if Step 1 showed different names, adjust `mastra-adapters.ts` (quarantined) — this service stays unchanged.

- [ ] **Step 6: Run tests** → 3 passing. `pnpm typecheck`.

- [ ] **Step 7: Commit**

```bash
git add src/features/mastra/services/mastra-adapters.ts src/features/mastra/services/agent-runner.service.ts src/features/mastra/services/agent-runner.service.spec.ts
git commit -m "feat(mastra): agent runner (chat turn) + result adapters + run ledger"
```

---

### Task 10: Approval service (human-in-the-loop resume)

**Files:**
- Create: `src/features/mastra/services/approval.service.ts` (+ `.spec.ts`)
- Modify: `src/features/mastra/services/mastra-adapters.ts` (add `resumeAfterApproval`)

**Interfaces:**
- Consumes: `ApprovalRepository`, `AgentRunRepository`, `MastraService`, `PrincipalRef`.
- Produces: `ApprovalService.listForOwner(principal)`, `decide(principal, id, { approved, note })`.

- [ ] **Step 1: Add `resumeAfterApproval` to `mastra-adapters.ts`** (bind `approveToolCall`/`declineToolCall` from Task 9 Step 1)

```ts
/** Resume a suspended generate() after a human decision. ADJUST method names per Task 9 Step 1. */
export async function resumeAfterApproval(
  agent: { approveToolCall: (a: unknown) => Promise<unknown>; declineToolCall: (a: unknown) => Promise<unknown> },
  args: { mastraRunId: string | null; toolCallId: string | null; approved: boolean },
): Promise<void> {
  const payload = { runId: args.mastraRunId, toolCallId: args.toolCallId };
  if (args.approved) await agent.approveToolCall(payload);
  else await agent.declineToolCall(payload);
}
```

- [ ] **Step 2: Write the failing test `approval.service.spec.ts`**

```ts
import { ApprovalService } from './approval.service';

function make(appr: any) {
  const approvals = { findById: jest.fn(async () => appr), findPendingForOwner: jest.fn(async () => [appr]), decide: jest.fn(async () => undefined) };
  const runs = { finish: jest.fn(async () => undefined) };
  const agent = { approveToolCall: jest.fn(async () => undefined), declineToolCall: jest.fn(async () => undefined) };
  const mastra = { getAgent: jest.fn(() => agent) };
  return { service: new ApprovalService(approvals as never, runs as never, mastra as never), approvals, agent };
}

describe('ApprovalService.decide', () => {
  const appr = { id: 'a1', runId: 'r1', mastraRunId: 'mr1', toolCallId: 'tc1', status: 'pending' };

  it('approves: resumes the tool call and marks executed', async () => {
    const { service, approvals, agent } = make(appr);
    await service.decide({ id: 'u1', role: 'admin' }, 'a1', { approved: true });
    expect(agent.approveToolCall).toHaveBeenCalled();
    expect(approvals.decide).toHaveBeenCalledWith('a1', expect.objectContaining({ status: 'executed' }));
  });

  it('rejects: declines and marks rejected', async () => {
    const { service, agent, approvals } = make(appr);
    await service.decide({ id: 'u1', role: 'admin' }, 'a1', { approved: false, note: 'no' });
    expect(agent.declineToolCall).toHaveBeenCalled();
    expect(approvals.decide).toHaveBeenCalledWith('a1', expect.objectContaining({ status: 'rejected' }));
  });

  it('409s when the approval is not pending', async () => {
    const { service } = make({ ...appr, status: 'executed' });
    await expect(service.decide({ id: 'u1', role: 'admin' }, 'a1', { approved: true })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify it fails** → FAIL.

- [ ] **Step 4: Create `approval.service.ts`**

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import { AGENT_ID } from '../mastra.constants';
import type { PrincipalRef } from '../mastra.types';
import { AgentRunRepository } from '../repositories/agent-run.repository';
import { ApprovalRepository } from '../repositories/approval.repository';
import { resumeAfterApproval } from './mastra-adapters';

export interface DecisionInput { approved: boolean; note?: string }

@Injectable()
export class ApprovalService {
  constructor(
    private readonly approvals: ApprovalRepository,
    private readonly runs: AgentRunRepository,
    private readonly mastra: MastraService,
  ) {}

  async listForOwner(principal: PrincipalRef) {
    return this.approvals.findPendingForOwner(principal.id, principal.role);
  }

  async decide(principal: PrincipalRef, id: string, decision: DecisionInput) {
    const appr = await this.approvals.findById(id);
    if (!appr) throw new NotFoundException('Approval not found');
    if (appr.status !== 'pending') throw new ConflictException('Approval already decided');

    try {
      await resumeAfterApproval(this.mastra.getAgent(AGENT_ID) as never, {
        mastraRunId: appr.mastraRunId, toolCallId: appr.toolCallId, approved: decision.approved,
      });
      await this.approvals.decide(id, {
        status: decision.approved ? 'executed' : 'rejected',
        decidedByUserId: principal.id, decidedAt: new Date(), decisionNote: decision.note ?? null,
      });
      await this.runs.finish(appr.runId, { status: decision.approved ? 'succeeded' : 'cancelled', finishedAt: new Date() });
      return { id, status: decision.approved ? 'executed' : 'rejected' };
    } catch (err) {
      await this.approvals.decide(id, {
        status: 'failed', decidedByUserId: principal.id, decidedAt: new Date(),
        result: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }
}
```
> `ApprovalRepository.findPendingForOwner(userId, role)` returns admins all pending, users only their own conversations' approvals (join on `agent_conversation.ownerUserId`); implement that filter in the repo (T8).

- [ ] **Step 5: Run tests** → 3 passing. `pnpm typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/features/mastra/services/approval.service.ts src/features/mastra/services/approval.service.spec.ts src/features/mastra/services/mastra-adapters.ts
git commit -m "feat(mastra): approval service (HITL resume) + resume adapter"
```

---

### Task 11: DTOs, controllers, buildMastra + module wiring

**Files:**
- Create: `src/features/mastra/dto/{chat,approval,schedule}.dto.ts`
- Create: `src/features/mastra/controllers/{chat,approval}.controller.ts`
- Create: `src/features/mastra/index.ts` (buildMastra)
- Modify: `src/features/mastra/mastra.module.ts`
- Verify: `src/app.module.ts` (MastraModule last)

**Interfaces:**
- Consumes: all services (T8–T10,T13), `buildOrchestratorAgent` (T7), `buildScheduledReportWorkflow` (T12), `buildStore` (T4), config, `SearchRecordService`, `SmtpConfigService`, `ActionLogRepository`, `PG_POOL`.
- Produces: `buildMastra(deps): Mastra`; routes `POST /agent/chat`, `GET /agent/conversations`, `GET /agent/approvals`, `POST /agent/approvals/:id`.

> Note: `ScheduleController` (T13) and the workflow (T12) are referenced by this task's module. If executing strictly in order, create empty stubs or reorder so T12/T13 land before this task's Step 5. Recommended order: T12 → T13 → T11.

- [ ] **Step 1: Create DTOs** (Zod + inferred type; follow `search-query.dto.ts`)

`chat.dto.ts`:
```ts
import { z } from 'zod';
export const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(8000),
});
export type ChatDto = z.infer<typeof chatSchema>;
```
`approval.dto.ts`:
```ts
import { z } from 'zod';
export const decisionSchema = z.object({ approved: z.boolean(), note: z.string().max(1000).optional() });
export type DecisionDto = z.infer<typeof decisionSchema>;
```
`schedule.dto.ts`:
```ts
import { z } from 'zod';
import { AGENT_ID } from '../mastra.constants';
export const createScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  cron: z.string().min(1).max(120),
  timezone: z.string().max(64).default('UTC'),
  agentId: z.string().default(AGENT_ID),
  promptTemplate: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  deliveryChannel: z.enum(['conversation', 'email', 'none']).default('conversation'),
  deliveryTarget: z.string().max(500).optional(),
  targetUserId: z.string().uuid().optional(),
  enabled: z.boolean().default(true),
});
export type CreateScheduleDto = z.infer<typeof createScheduleSchema>;
```

- [ ] **Step 2: Create `chat.controller.ts`**

```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Principal } from '../../../common/principal';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { chatSchema, type ChatDto } from '../dto/chat.dto';
import { AgentRunnerService } from '../services/agent-runner.service';
import { ConversationService } from '../services/conversation.service';

@Controller('agent')
export class ChatController {
  constructor(
    private readonly runner: AgentRunnerService,
    private readonly conversations: ConversationService,
  ) {}

  @Post('chat')
  chat(@CurrentUser() user: Principal, @Body(new ZodValidationPipe(chatSchema)) dto: ChatDto) {
    return this.runner.runChat(user, dto);
  }

  @Get('conversations')
  list(@CurrentUser() user: Principal, @Query('page') page = '1', @Query('limit') limit = '20') {
    return this.conversations.listForOwner(user, Number(page), Number(limit));
  }
}
```

- [ ] **Step 3: Create `approval.controller.ts`**

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Principal } from '../../../common/principal';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { decisionSchema, type DecisionDto } from '../dto/approval.dto';
import { ApprovalService } from '../services/approval.service';

@Controller('agent/approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @Get()
  list(@CurrentUser() user: Principal) { return this.approvals.listForOwner(user); }

  @Post(':id')
  decide(@CurrentUser() user: Principal, @Param('id') id: string, @Body(new ZodValidationPipe(decisionSchema)) dto: DecisionDto) {
    return this.approvals.decide(user, id, dto);
  }
}
```

- [ ] **Step 4: Create `index.ts` (buildMastra)**

```ts
import { Mastra } from '@mastra/core';
import type { Pool } from 'pg';
import type { MastraConfig } from '../../config/configurations/mastra.config';
import { buildOrchestratorAgent } from './agents/orchestrator.agent';
import { buildStore } from './memory/memory.factory';
import { AGENT_ID, SCHEDULED_REPORT_WORKFLOW_ID } from './mastra.constants';
import type { ToolServices } from './mastra.types';
import { buildScheduledReportWorkflow } from './workflows/scheduled-report.workflow';

export interface BuildMastraDeps {
  cfg: MastraConfig;
  pool: Pool;
  services: ToolServices;
  modelOverride?: unknown;
}

export function buildMastra(deps: BuildMastraDeps): Mastra {
  const agent = buildOrchestratorAgent({ cfg: deps.cfg, pool: deps.pool, services: deps.services, modelOverride: deps.modelOverride });
  return new Mastra({
    storage: buildStore(deps.pool) as never,
    agents: { [AGENT_ID]: agent },
    workflows: { [SCHEDULED_REPORT_WORKFLOW_ID]: buildScheduledReportWorkflow() },
  });
}
```
> Setting `storage` on the `Mastra` instance is what makes workflow snapshots (suspend/resume) durable; confirm against Task-1 research (`Config.storage: MastraCompositeStore`).

- [ ] **Step 5: Rewrite `mastra.module.ts`**

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MastraModule as MastraCoreModule } from '@mastra/nestjs';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infrastructure/database/drizzle.constants';
import type { MastraConfig } from '../../config/configurations/mastra.config';
import { SearchServiceModule } from '../search-service/search-service.module';
import { SearchRecordService } from '../search-service/search-record.service';
import { SystemModule } from '../system/system.module';
import { SmtpConfigService } from '../system/smtp-config.service';
import { buildMastra } from './index';
import { AGENT_RUN_QUEUE } from './mastra.constants';
import type { ToolServices } from './mastra.types';
import { ChatController } from './controllers/chat.controller';
import { ApprovalController } from './controllers/approval.controller';
import { ScheduleController } from './controllers/schedule.controller';
import { ConversationRepository } from './repositories/conversation.repository';
import { AgentRunRepository } from './repositories/agent-run.repository';
import { ApprovalRepository } from './repositories/approval.repository';
import { ActionLogRepository } from './repositories/action-log.repository';
import { ScheduleRepository } from './repositories/schedule.repository';
import { ConversationService } from './services/conversation.service';
import { AgentRunnerService } from './services/agent-runner.service';
import { ApprovalService } from './services/approval.service';
import { ScheduleService } from './services/schedule.service';
import { AgentRunProcessor } from './processors/agent-run.processor';
import { AgentScheduleScheduler } from './schedulers/agent-schedule.scheduler';

@Module({
  imports: [
    SearchServiceModule,
    SystemModule,
    BullModule.registerQueue({ name: AGENT_RUN_QUEUE }),
    MastraCoreModule.registerAsync({
      imports: [SearchServiceModule, SystemModule],
      inject: [ConfigService, SearchRecordService, SmtpConfigService, ActionLogRepository, PG_POOL],
      useFactory: (
        config: ConfigService, search: SearchRecordService, smtp: SmtpConfigService,
        actionLog: ActionLogRepository, pool: Pool,
      ) => {
        const cfg = config.getOrThrow<MastraConfig>('mastra');
        const services: ToolServices = {
          searchRecords: search,
          sendEmail: (m) => smtp.sendActive(m),
          recordAction: (e) => actionLog.record(e),
        };
        return { mastra: buildMastra({ cfg, pool, services }), prefix: '/api/agent-core' };
      },
    }),
  ],
  controllers: [ChatController, ApprovalController, ScheduleController],
  providers: [
    ConversationRepository, AgentRunRepository, ApprovalRepository, ActionLogRepository, ScheduleRepository,
    ConversationService, AgentRunnerService, ApprovalService, ScheduleService,
    AgentRunProcessor, AgentScheduleScheduler,
  ],
})
export class MastraModule {}
```
> `ActionLogRepository` is injected into the core-module factory; it stays in `providers` so Nest resolves it. Confirm `registerAsync` accepts returning `{ mastra, prefix }` (Task-1 research: options include `prefix`); if `prefix` must be a top-level register option, pass it accordingly.

- [ ] **Step 6: Verify `app.module.ts`** — confirm `MastraModule` is imported LAST. No change if already so.

- [ ] **Step 7: Build + typecheck + commit**

Run: `pnpm typecheck && pnpm build` → compiles.
```bash
git add src/features/mastra/dto src/features/mastra/controllers/chat.controller.ts src/features/mastra/controllers/approval.controller.ts src/features/mastra/index.ts src/features/mastra/mastra.module.ts
git commit -m "feat(mastra): DTOs, chat/approval controllers, buildMastra + module wiring"
```

---

### Task 12: Scheduled-report workflow

**Files:**
- Create: `src/features/mastra/workflows/scheduled-report.workflow.ts`

**Interfaces:**
- Consumes: `AGENT_ID`, `SCHEDULED_REPORT_WORKFLOW_ID`, `AgentReportSchema` (T3).
- Produces: `buildScheduledReportWorkflow(): Workflow` with input `{ scheduleId, userId?, promptTemplate, params, deliveryChannel, deliveryTarget? }`.

- [ ] **Step 1: Confirm workflow API** — `grep -rn "createWorkflow\|createStep\|suspend\|commit\|createRun" node_modules/@mastra/core/dist/workflows/*.d.ts | head -40`. Confirm `createStep`, `.then`, `.commit`, and the step `execute` params (`mastra`, `inputData`, `suspend`, `resumeData`).

- [ ] **Step 2: Create `scheduled-report.workflow.ts`**

```ts
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { AGENT_ID, SCHEDULED_REPORT_WORKFLOW_ID } from '../mastra.constants';
import { AgentReportSchema } from '../mastra.types';

const inputSchema = z.object({
  scheduleId: z.string(),
  userId: z.string().nullable().optional(),
  promptTemplate: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  deliveryChannel: z.enum(['conversation', 'email', 'none']).default('conversation'),
  deliveryTarget: z.string().nullable().optional(),
});

export function buildScheduledReportWorkflow() {
  const analyze = createStep({
    id: 'analyze',
    inputSchema,
    outputSchema: z.object({ report: AgentReportSchema, deliveryChannel: inputSchema.shape.deliveryChannel, deliveryTarget: z.string().nullable().optional() }),
    execute: async ({ inputData, mastra }) => {
      const agent = mastra.getAgent(AGENT_ID);
      const res = await agent.generate(inputData.promptTemplate, { structuredOutput: { schema: AgentReportSchema } } as never);
      return { report: (res as { object: unknown }).object as never, deliveryChannel: inputData.deliveryChannel, deliveryTarget: inputData.deliveryTarget };
    },
  });

  const deliver = createStep({
    id: 'deliver',
    inputSchema: analyze.outputSchema,
    outputSchema: z.object({ delivered: z.boolean() }),
    resumeSchema: z.object({ approved: z.boolean() }),
    suspendSchema: z.object({ reason: z.string() }),
    execute: async ({ inputData, resumeData, suspend }) => {
      const external = inputData.deliveryChannel === 'email';
      if (external && !resumeData?.approved) {
        // External email from a SYSTEM run requires approval (design decision #7).
        return await suspend({ reason: 'external email requires approval' });
      }
      // Internal delivery auto-proceeds; the processor persists the report into the conversation.
      return { delivered: true };
    },
  });

  return createWorkflow({
    id: SCHEDULED_REPORT_WORKFLOW_ID,
    inputSchema,
    outputSchema: z.object({ delivered: z.boolean() }),
    retryConfig: { attempts: 2, delay: 2000 },
  }).then(analyze).then(deliver).commit();
}
```
> `agent.generate(..., { structuredOutput })` returning `.object` is per Task-1 research; adjust the `.object` accessor if Step 1 shows otherwise. Delivering the report into a conversation (design §9/§10) is done by the processor (T13) using the returned report, keeping the workflow storage-agnostic.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/features/mastra/workflows
git commit -m "feat(mastra): scheduled-report workflow (analyze -> deliver, external-email suspend)"
```

---

### Task 13: Schedule service + BullMQ processor & scheduler

**Files:**
- Create: `src/features/mastra/services/schedule.service.ts` (+ `.spec.ts`)
- Create: `src/features/mastra/controllers/schedule.controller.ts`
- Create: `src/features/mastra/processors/agent-run.processor.ts`
- Create: `src/features/mastra/schedulers/agent-schedule.scheduler.ts`

**Interfaces:**
- Consumes: `ScheduleRepository`, `AgentRunRepository`, `MastraService`, the `AGENT_RUN_QUEUE`, `RUN_SCHEDULE_JOB`, `SCHEDULED_REPORT_WORKFLOW_ID`, `MastraConfig`.
- Produces: `ScheduleService` (`create`, `remove`, `syncRepeatableJobs`); `AgentRunProcessor`; `AgentScheduleScheduler`.

- [ ] **Step 1: Write the failing test `schedule.service.spec.ts`**

```ts
import { ScheduleService } from './schedule.service';

function make() {
  const repo = {
    create: jest.fn(async (v: any) => ({ id: 'sch-1', enabled: true, ...v })),
    listEnabled: jest.fn(async () => [{ id: 'sch-1', cron: '*/5 * * * *', enabled: true }]),
    findLiveById: jest.fn(async () => ({ id: 'sch-1', cron: '*/5 * * * *' })),
    softDelete: jest.fn(async () => undefined),
  };
  const queue = { add: jest.fn(async () => undefined), removeRepeatable: jest.fn(async () => undefined) };
  return { service: new ScheduleService(repo as never, queue as never), repo, queue };
}

describe('ScheduleService', () => {
  it('creates a schedule and registers a repeatable job when enabled', async () => {
    const { service, queue } = make();
    await service.create({ name: 'daily', cron: '0 9 * * *', agentId: 'orchestrator', promptTemplate: 'report' } as any);
    expect(queue.add).toHaveBeenCalledWith('run-schedule', expect.objectContaining({ scheduleId: 'sch-1' }),
      expect.objectContaining({ jobId: 'sch-1', repeat: expect.objectContaining({ pattern: '0 9 * * *' }) }));
  });

  it('syncRepeatableJobs registers all enabled schedules', async () => {
    const { service, queue } = make();
    await service.syncRepeatableJobs();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Create `schedule.service.ts`** (BullMQ `repeat.pattern` for cron; follow `search-reconciliation.scheduler` for `@InjectQueue`)

```ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AGENT_RUN_QUEUE, RUN_SCHEDULE_JOB } from '../mastra.constants';
import { ScheduleRepository } from '../repositories/schedule.repository';

export interface CreateScheduleInput {
  name: string; cron: string; agentId: string; promptTemplate: string;
  timezone?: string; params?: Record<string, unknown>; description?: string;
  deliveryChannel?: string; deliveryTarget?: string; targetUserId?: string; enabled?: boolean;
}

@Injectable()
export class ScheduleService {
  constructor(
    private readonly repo: ScheduleRepository,
    @InjectQueue(AGENT_RUN_QUEUE) private readonly queue: Queue,
  ) {}

  private async register(s: { id: string; cron: string; timezone?: string }) {
    await this.queue.add(RUN_SCHEDULE_JOB, { scheduleId: s.id }, {
      jobId: s.id, repeat: { pattern: s.cron, tz: s.timezone }, removeOnComplete: true, removeOnFail: true,
    } as never);
  }

  async create(dto: CreateScheduleInput) {
    const row = await this.repo.create(dto as never);
    if (row.enabled) await this.register(row);
    return row;
  }

  async syncRepeatableJobs() {
    const rows = await this.repo.listEnabled();
    for (const r of rows) await this.register(r);
  }

  async remove(id: string) {
    await this.repo.softDelete(id);
    await this.queue.removeRepeatable(RUN_SCHEDULE_JOB, { jobId: id } as never);
  }
}
```
> Confirm the BullMQ repeatable-cron option in the installed bullmq (`repeat: { pattern }` for cron vs `{ every }` for interval — `search-reconciliation.scheduler` uses `every`). Adjust if different.

- [ ] **Step 4: Run tests** → 2 passing.

- [ ] **Step 5: Create `agent-run.processor.ts`** (WorkerHost)

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { MastraService } from '@mastra/nestjs';
import type { Job } from 'bullmq';
import { AGENT_RUN_QUEUE, RUN_SCHEDULE_JOB, SCHEDULED_REPORT_WORKFLOW_ID } from '../mastra.constants';
import { ScheduleRepository } from '../repositories/schedule.repository';
import { AgentRunRepository } from '../repositories/agent-run.repository';

@Processor(AGENT_RUN_QUEUE)
export class AgentRunProcessor extends WorkerHost {
  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly runs: AgentRunRepository,
    private readonly mastra: MastraService,
  ) { super(); }

  async process(job: Job): Promise<void> {
    if (job.name !== RUN_SCHEDULE_JOB) return;
    const schedule = await this.schedules.findLiveById(job.data.scheduleId as string);
    if (!schedule || !schedule.enabled) return;
    const run = await this.runs.create({
      trigger: 'schedule', status: 'running', agentId: schedule.agentId,
      input: { scheduleId: schedule.id }, startedAt: new Date(),
    } as never);
    try {
      const wf = this.mastra.getWorkflow(SCHEDULED_REPORT_WORKFLOW_ID);
      const runHandle = await wf.createRun();
      const result = await runHandle.start({
        inputData: {
          scheduleId: schedule.id, userId: schedule.targetUserId ?? null,
          promptTemplate: schedule.promptTemplate, params: schedule.params,
          deliveryChannel: schedule.deliveryChannel, deliveryTarget: schedule.deliveryTarget,
        },
      } as never);
      await this.runs.finish(run.id, { status: 'succeeded', output: result as never, mastraRunId: (runHandle as { runId?: string }).runId ?? null, finishedAt: new Date() });
      await this.schedules.stampRun(schedule.id, 'succeeded', run.id);
    } catch (err) {
      await this.runs.finish(run.id, { status: 'failed', error: { message: err instanceof Error ? err.message : String(err) }, finishedAt: new Date() });
      await this.schedules.stampRun(schedule.id, 'failed', run.id);
      throw err; // let BullMQ retry
    }
  }
}
```
> Confirm `mastra.getWorkflow(...).createRun()` / `run.start({ inputData })` names against Task-12 Step 1. Delivering the report into a conversation (design §9/§10) can be added here once the workflow returns the report object; v1 records the run output.

- [ ] **Step 6: Create `agent-schedule.scheduler.ts`** (bootstrap hook; NOT auto-run at import — mirror `search-reconciliation.scheduler`)

```ts
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import { ScheduleService } from '../services/schedule.service';

@Injectable()
export class AgentScheduleScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentScheduleScheduler.name);
  constructor(private readonly schedules: ScheduleService, private readonly config: ConfigService) {}

  async onApplicationBootstrap(): Promise<void> {
    const cfg = this.config.getOrThrow<MastraConfig>('mastra');
    if (!cfg.schedulesEnabled) { this.logger.log('Agent schedules disabled (MASTRA_SCHEDULES_ENABLED=false)'); return; }
    try { await this.schedules.syncRepeatableJobs(); this.logger.log('Registered agent repeatable jobs'); }
    catch (err) { this.logger.warn(`Schedule sync skipped: ${err instanceof Error ? err.message : String(err)}`); }
  }
}
```

- [ ] **Step 7: Create `schedule.controller.ts`** (`@Roles('admin')`)

```ts
import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { createScheduleSchema, type CreateScheduleDto } from '../dto/schedule.dto';
import { ScheduleService } from '../services/schedule.service';

@Controller('agent/schedules')
@Roles('admin')
export class ScheduleController {
  constructor(private readonly schedules: ScheduleService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createScheduleSchema)) dto: CreateScheduleDto) { return this.schedules.create(dto); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.schedules.remove(id); }
}
```

- [ ] **Step 8: Run + build + commit**

Run: `pnpm jest src/features/mastra && pnpm typecheck && pnpm build` → green.
```bash
git add src/features/mastra/services/schedule.service.ts src/features/mastra/services/schedule.service.spec.ts src/features/mastra/controllers/schedule.controller.ts src/features/mastra/processors src/features/mastra/schedulers
git commit -m "feat(mastra): schedule service + BullMQ processor/scheduler for scheduled runs"
```

---

### Task 14: Full-suite gate + documentation of Mastra-owned tables

**Files:**
- Modify: `src/features/mastra/readme.md`

- [ ] **Step 1: Run the whole unit suite** — `pnpm test`. Expect all specs pass, including the new mastra specs. Grep to confirm no spec imports a `@mastra/*`/`@ai-sdk/*` value: `grep -rn "from '@mastra\|from '@ai-sdk" src --include=*.spec.ts` → no results (only `import type` allowed, which shows as `import type`).

- [ ] **Step 2: Typecheck + format own files + build** — `pnpm typecheck && pnpm build` → clean. Do NOT run repo-wide `pnpm lint` (its `--fix` reformats unrelated files); if any new mastra file needs formatting, run `npx prettier --write` on those files ONLY.

- [ ] **Step 3: Document Mastra-owned tables** — append to `src/features/mastra/readme.md`: `@mastra/pg` creates and owns `mastra.mastra_threads`, `mastra.mastra_messages`, `mastra.mastra_resources`, `mastra.mastra_workflow_snapshot` in the `mastra` Postgres schema via `PgStore.init()` at boot — NOT under drizzle-kit control; our `agent_conversation.id` is deliberately the same value as the Mastra `thread.id`.

- [ ] **Step 4: Commit**

```bash
git add src/features/mastra/readme.md
git commit -m "docs(mastra): document Mastra-owned mastra-schema tables"
```

---

## Manual Verification (integration — the design's §15, against live infra)

These replace automated e2e for the Mastra-touching layer (booting `@mastra/*` under Jest is unreliable; the app itself is the harness).

1. **Boot:** `pnpm start:dev`. Expect no errors; `PgStore` initializes the `mastra` schema; `MastraModule` loads last. `psql` → confirm `mastra.mastra_threads` etc. and `public.agent_*` tables exist.
2. **Chat + run ledger:** authenticate (JWT), `POST /agent/chat {"message":"Summarize the products_livetest collection"}`. Expect a curated answer; `select status,trigger from agent_run order by created_at desc limit 1;` → `succeeded,user_message`; one `agent_conversation` row owned by the caller.
3. **HITL:** `POST /agent/chat {"conversationId":"<id>","message":"Email a one-line summary to me@example.com"}`. Expect `pendingApprovals` in the response and `agent_run.status=awaiting_approval`; `GET /agent/approvals` lists it. `POST /agent/approvals/:id {"approved":true}` → email sent, `agent_action_log` has a `send_email/success` row, `agent_approval.status=executed`.
4. **Scheduled:** set `MASTRA_SCHEDULES_ENABLED=true`, create a schedule via `POST /agent/schedules` (admin) with `cron:"*/1 * * * *"`, `deliveryChannel:"conversation"`. Within ~1 min expect an `agent_run(trigger=schedule)` and `agent_schedule.last_run_status='succeeded'`.
5. **Failure path:** temporarily set a bad `MASTRA_MODEL`; a chat turn records `agent_run.status=failed` with an `error` payload and surfaces a clean error (not a 500 stack) to the client.

---

## Notes on fast-moving Mastra APIs
Three integration points depend on `@mastra/*@1.50.1` runtime shapes that the docs (latest) may describe slightly differently. Each is quarantined behind a `grep`-first confirmation step and isolated in one small adapter, so binding them correctly never ripples into the tested logic:
1. `createGateway` export location + `PgStore`/`Memory` options (T4 Step 1).
2. `generate()` result approval/usage fields + `approveToolCall`/`declineToolCall` (T9 Step 1 → `mastra-adapters.ts`).
3. Workflow `createStep`/`createRun`/`suspend` + `structuredOutput.object` (T12 Step 1).

## Recommended execution order
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → **T12 → T13** → T11 → T14.
(T11's module references the workflow (T12) and schedule pieces (T13); build those first.)
