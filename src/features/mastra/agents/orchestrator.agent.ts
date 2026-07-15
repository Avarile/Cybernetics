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
