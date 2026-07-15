import { RequestContext } from '@mastra/core/request-context';
import { REQUEST_CTX } from '../mastra.constants';
import type { PendingApproval, ToolRuntime } from '../mastra.types';

/**
 * Build the per-call requestContext Mastra passes to tools.
 *
 * Confirmed against `node_modules/@mastra/core/dist/agent/agent.types.d.ts`
 * (`AgentExecutionOptionsBase.requestContext?: RequestContext<any>`): the option is
 * typed as Mastra's `RequestContext` **class**, not a plain object — a plain
 * `Record` would satisfy `unknown`-typed call sites but Mastra internals (and our own
 * `tools/tool-context.ts::readRuntime`) call `.get(key)` on it, which a plain object
 * doesn't support. `RequestContext`'s constructor accepts an iterable of `[key, value]`
 * tuples (`dist/_types/@internal_core/dist/request-context/index.d.ts`); confirmed
 * loadable under CJS/Jest with no ESM-only transitive deps (unlike `@mastra/core/tools`,
 * which pulls in `@sindresorhus/slugify`).
 */
export function buildRequestContext(rt: ToolRuntime): RequestContext {
  return new RequestContext([
    [REQUEST_CTX.principal, rt.principal],
    [REQUEST_CTX.runId, rt.runId],
    [REQUEST_CTX.conversationId, rt.conversationId],
  ]);
}

/**
 * Map a `generate()` result to our pending-approval list.
 *
 * Confirmed shape (`@mastra/core` 1.50.1):
 * - `dist/docs/references/docs-agents-agent-approval.md` ("Tool approval with
 *   generate()"): "When a tool requires approval, `generate()` returns immediately with
 *   `finishReason: 'suspended'`, a `suspendPayload` containing the tool call details
 *   (`toolCallId`, `toolName`, `args`), and a `runId`."
 * - `suspendPayload` is a SINGLE object, not an array: `toolCallConcurrency` defaults to
 *   1 "when approval may be required" (`dist/agent/agent.types.d.ts` doc comment on
 *   `toolCallConcurrency`), so at most one tool call is ever pending per `generate()`
 *   call. Both our tools that require approval (`send-email`, `db-write`) set
 *   `requireApproval: true` at the tool definition, which is one of the two flags
 *   (OR'd with `requireToolApproval` on the call) that triggers this suspension.
 * - The result's own typed field is `suspendPayload: any` (`dist/stream/base/output.d.ts`
 *   `PromiseResults`); the concrete `{ toolCallId, toolName, args }` shape is documented,
 *   not typed, so we narrow it defensively here.
 */
export function toPendingApprovals(result: unknown): PendingApproval[] {
  const r = result as {
    finishReason?: string;
    suspendPayload?: {
      toolCallId: string;
      toolName: string;
      args?: Record<string, unknown>;
    };
  };
  if (r.finishReason !== 'suspended' || !r.suspendPayload) return [];
  const { toolCallId, toolName, args } = r.suspendPayload;
  const typeByTool: Record<string, PendingApproval['actionType']> = {
    'send-email': 'send_email',
    'db-write': 'db_write',
  };
  return [
    {
      toolCallId,
      actionType: typeByTool[toolName] ?? 'other',
      title: `Approve ${toolName}`,
      payload: args ?? {},
    },
  ];
}

/**
 * Read text + token usage off a `generate()` result.
 *
 * Confirmed shape: `Agent.generate()` resolves to `FullOutput<T>`
 * (`dist/stream/base/output.d.ts`), a plain resolved object (not a stream — `text`,
 * `usage`, `totalUsage`, `response`, `finishReason`, `runId`, `suspendPayload` are all
 * already-resolved values, unlike `MastraModelOutput`'s promise-returning getters used by
 * `stream()`).
 * - `text: string` — resolved text output across all (non-rejected) steps.
 * - `usage`/`totalUsage: LanguageModelUsage` (`dist/stream/types.d.ts`, extending
 *   `LanguageModelV2Usage`) both expose `inputTokens`/`outputTokens` — matching the
 *   originally-guessed field names. `usage` is "Token usage for the last step" per the
 *   `FullOutput` doc comment, while `totalUsage` is the aggregate across every step in
 *   the turn (relevant when the agent loops through tool calls before finishing); we bind
 *   to `totalUsage` (falling back to `usage`) so the run ledger reflects the whole turn.
 * - `model` is NOT a top-level `FullOutput` field. It lives at
 *   `response.modelId` (`LLMStepResult['response']`, `dist/stream/types.d.ts` ~L1148-1159).
 */
export function readUsage(result: unknown): {
  model: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  text: string;
} {
  const r = result as {
    text?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    totalUsage?: { inputTokens?: number; outputTokens?: number };
    response?: { modelId?: string };
  };
  const usage = r.totalUsage ?? r.usage;
  return {
    model: r.response?.modelId ?? null,
    tokensInput: usage?.inputTokens ?? null,
    tokensOutput: usage?.outputTokens ?? null,
    text: r.text ?? '',
  };
}
