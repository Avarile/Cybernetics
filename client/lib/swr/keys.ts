import { buildListUrl, type TableQuery } from "@/components/data-table/query"
import type { TabSpec } from "@/components/data-table/types"

/**
 * Every SWR cache key in the app, spelled exactly once.
 *
 * Keys are tuples rather than strings for two reasons: SWR compares them
 * structurally, so no serialisation step of our own is needed, and a tuple has a
 * meaningful *prefix* — which is how `useInvalidate` reaches every page of a
 * domain without knowing which pages are cached.
 *
 * Where a key's last segment is a URL, that is deliberate: it makes the key both
 * canonical (one cache entry per distinct request) and directly fetchable, so
 * `createFetcher` never has to rebuild a query it was already handed.
 */
export const keys = {
  session: () => ["session"] as const,

  conversations: (page = 1, limit = 20) =>
    ["conversations", `/agent/conversations?page=${page}&limit=${limit}`] as const,

  messages: (id: string) => ["conversation", id, "messages"] as const,

  list: (endpoint: string, query: TableQuery, tabs?: TabSpec[]) =>
    ["list", endpoint, buildListUrl(endpoint, query, tabs)] as const,

  record: (endpoint: string, id: string) => ["record", endpoint, id] as const,
}

/** Prefixes used for invalidation, so call sites never hand-write a tuple. */
export const scopes = {
  allLists: (endpoint: string) => ["list", endpoint] as const,
  allRecords: (endpoint: string) => ["record", endpoint] as const,
  conversations: () => ["conversations"] as const,
}
