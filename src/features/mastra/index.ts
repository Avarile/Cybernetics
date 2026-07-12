import { Mastra } from '@mastra/core';

/**
 * Central Mastra instance (scaffold).
 *
 * Agents, tools, and workflows will be registered here as the feature grows.
 * A persistent storage adapter (e.g. `@mastra/pg`) should be configured before
 * production use; the default in-memory store is not durable.
 */
export const mastra = new Mastra({
  agents: {},
});
