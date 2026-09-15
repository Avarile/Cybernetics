import { Agent } from '@mastra/core/agent';
import type { Pool } from 'pg';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import { ASSISTANT_AGENT_ID } from '../mastra.constants';
import { buildMemory } from '../memory/memory.factory';
import { buildModel } from '../memory/model.factory';
import { ASSISTANT_INSTRUCTIONS } from './prompts';

export interface BuildAssistantParams {
  cfg: MastraConfig;
  pool: Pool;
  /** Test-only override so no live model call is made in integration. */
  modelOverride?: unknown;
}

/**
 * The default agent a new conversation binds to.
 *
 * Deliberately takes no `ToolServices`: unlike `buildOrchestratorAgent` it has
 * no tool closures to capture, and an empty `tools` map is the whole point —
 * with nothing to call it answers in one turn, never suspends on an approval,
 * and never pays for a search the user did not ask for.
 *
 * Storage is shared with the orchestrator (`buildMemory` over the same pool and
 * `mastra` schema), so a conversation's thread, working memory and generated
 * title behave identically whichever agent it is bound to.
 */
export function buildAssistantAgent(params: BuildAssistantParams): Agent {
  return new Agent({
    id: ASSISTANT_AGENT_ID,
    name: 'Assistant',
    instructions: ASSISTANT_INSTRUCTIONS,
    model: (params.modelOverride ?? buildModel(params.cfg)) as never,
    tools: {},
    memory: buildMemory(params.pool, params.cfg),
    maxRetries: params.cfg.maxRetries,
  });
}
