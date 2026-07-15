import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { CuratedSearchResult, ToolServices } from '../mastra.types';
import { readRuntime } from './tool-context';

export const searchQueryInput = z.object({
  collection: z.string().min(1),
  query: z.string().default(''),
  filters: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
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
    q: input.query ?? '',
    page: 1,
    limit,
    filters: input.filters,
  });
  return {
    collection: input.collection,
    totalHits: res.totalHits,
    hits: res.hits.slice(0, limit),
    facets: res.facetDistribution,
  };
}

/** Mastra wrapper — not unit tested (imports @mastra). */
export function makeSearchQueryTool(services: ToolServices) {
  return createTool({
    id: 'search-query',
    description:
      'Search a collection and return the top matches with facet counts. Read-only. Use to gather data before analysis; never request more than 25 results.',
    inputSchema: searchQueryInput,
    outputSchema: z.object({
      collection: z.string(),
      totalHits: z.number(),
      hits: z.array(z.record(z.string(), z.unknown())),
      facets: z.record(z.string(), z.record(z.string(), z.number())).optional(),
    }),
    execute: async (input: SearchQueryInput, context: unknown) => {
      void readRuntime(context);
      return searchQueryExecute(input, services);
    },
  });
}
