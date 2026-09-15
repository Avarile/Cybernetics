import { QUEUE_NAMES } from '../../infrastructure/queue/queue-names';

/**
 * The registered agents, by id.
 *
 * `assistant` is the default a new conversation binds to: it holds no tools, so
 * it answers directly instead of forcing a search round-trip through
 * `ORCHESTRATOR_INSTRUCTIONS`' "ALWAYS gather facts first" rule, and it can
 * never suspend on an approval. `orchestrator` remains the agent for anything
 * that must touch real data, and is the only one schedules may run.
 */
export const ORCHESTRATOR_AGENT_ID = 'orchestrator';
export const ASSISTANT_AGENT_ID = 'assistant';
export const DEFAULT_AGENT_ID = ASSISTANT_AGENT_ID;
export const AGENT_IDS = [ASSISTANT_AGENT_ID, ORCHESTRATOR_AGENT_ID] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Served by `GET /agent/agents`; drives the client's agent picker. */
export const AGENT_CATALOG: ReadonlyArray<{
  id: AgentId;
  name: string;
  description: string;
  hasTools: boolean;
}> = [
  {
    id: ASSISTANT_AGENT_ID,
    name: 'Assistant',
    description:
      'General conversation. No access to your data, and never pauses for approval.',
    hasTools: false,
  },
  {
    id: ORCHESTRATOR_AGENT_ID,
    name: 'Operations',
    description:
      'Searches your records and documents, and can send email with your approval.',
    hasTools: true,
  },
];

/** Narrow an arbitrary stored id to a registered agent, falling back to the default. */
export function resolveAgentId(id: string | null | undefined): AgentId {
  return (AGENT_IDS as readonly string[]).includes(id ?? '')
    ? (id as AgentId)
    : DEFAULT_AGENT_ID;
}
export const SCHEDULED_REPORT_WORKFLOW_ID = 'scheduled-report';
export const AGENT_RUN_QUEUE = QUEUE_NAMES.agentRun;
export const RUN_SCHEDULE_JOB = 'run-schedule';
/** Job: relabel pending approvals whose deadline has passed. */
export const EXPIRE_APPROVALS_JOB = 'expire-approvals';
export const EXPIRE_APPROVALS_SCHEDULER_ID = 'agent-approval-expiry';
export const MASTRA_PG_SCHEMA = 'mastra';
/**
 * DI token for the thread-purge port (see `ThreadStore` in mastra.types.ts).
 *
 * Exists so `ConversationService` can delete a Mastra thread without importing
 * `@mastra/nestjs`. That package reaches `@sindresorhus/slugify`, which is
 * ESM-only and cannot be parsed by this repo's CJS Jest transform — importing it
 * into a unit-tested service breaks the suite at load time, not at runtime. Same
 * hazard `mastra-adapters.ts` documents for `@mastra/core/tools`.
 */
export const THREAD_STORE = 'MASTRA_THREAD_STORE';
export const REQUEST_CTX = {
  principal: 'principal',
  runId: 'runId',
  conversationId: 'conversationId',
} as const;
export const AGENT_RUN_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 100,
};
