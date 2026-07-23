import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DOCUMENTS_COLLECTION } from '../../document-ingest/document-ingest.constants';
import type {
  CuratedSearchResult,
  ToolRuntime,
  ToolServices,
} from '../mastra.types';
import { readRuntime } from './tool-context';

export const searchDocumentsInput = z.object({
  query: z
    .string()
    .default('')
    .describe(
      'Full-text query over uploaded documents. Pass "" to list the user\'s documents.',
    ),
  topK: z.number().int().positive().max(25).default(10),
});
export type SearchDocumentsInput = z.infer<typeof searchDocumentsInput>;

const MAX_TOP_K = 25;
const EMPTY: CuratedSearchResult = {
  collection: DOCUMENTS_COLLECTION,
  totalHits: 0,
  hits: [],
};

/** Pure logic — unit tested. Scopes to the caller's own documents. */
export async function searchDocumentsExecute(
  input: SearchDocumentsInput,
  deps: Pick<ToolServices, 'searchRecords'>,
  rt: ToolRuntime,
): Promise<CuratedSearchResult> {
  if (!rt.principal.id) return EMPTY;
  const limit = Math.min(input.topK ?? 10, MAX_TOP_K);
  const res = await deps.searchRecords.search(DOCUMENTS_COLLECTION, {
    q: input.query ?? '',
    page: 1,
    limit,
    filters: { ownerUserId: rt.principal.id },
  });
  return {
    collection: DOCUMENTS_COLLECTION,
    totalHits: res.totalHits,
    hits: res.hits.slice(0, limit),
    facets: res.facetDistribution,
  };
}

/** Mastra wrapper — not unit tested (imports @mastra). */
export function makeSearchDocumentsTool(services: ToolServices) {
  return createTool({
    id: 'search-documents',
    description:
      "Search the current user's uploaded documents (PDF/DOCX/Markdown) by full text and return the " +
      'top matches. Read-only, automatically scoped to the current user. Pass an EMPTY query to list ' +
      'their documents. Use this to ground answers in files the user has attached or uploaded.',
    inputSchema: searchDocumentsInput,
    outputSchema: z.object({
      collection: z.string(),
      totalHits: z.number(),
      hits: z.array(z.record(z.string(), z.unknown())),
      facets: z.record(z.string(), z.record(z.string(), z.number())).optional(),
    }),
    execute: async (input: SearchDocumentsInput, context: unknown) =>
      searchDocumentsExecute(input, services, readRuntime(context)),
  });
}
