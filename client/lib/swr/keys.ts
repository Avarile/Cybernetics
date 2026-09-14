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

  /**
   * A bare-array endpoint — `/finance/accounts`, `/me/preferences`, every
   * vocabulary list.
   *
   * No query in the key: the whole collection is one cache entry and paging,
   * filtering and search happen client-side over it. That is only defensible
   * because these sets are bounded (tens of rows); the 282 contacts that
   * forced server paging never come through here.
   */
  collection: (endpoint: string) => ["collection", endpoint] as const,

  /**
   * Id → label options for reference columns and async filters.
   *
   * Deliberately a different head from `collection`, even for the same
   * endpoint: a lookup wants one fixed page of 100, while a collection table
   * wants whatever the user is paging through. Sharing a key would make the
   * table's page size silently change what a label column can resolve.
   */
  lookup: (endpoint: string) => ["lookup", endpoint] as const,

  /** An aggregate. The date range is part of the path, so the path is the key. */
  report: (path: string) => ["report", path] as const,
}

/** Prefixes used for invalidation, so call sites never hand-write a tuple. */
export const scopes = {
  allLists: (endpoint: string) => ["list", endpoint] as const,
  allRecords: (endpoint: string) => ["record", endpoint] as const,
  allCollections: (endpoint: string) => ["collection", endpoint] as const,
  allLookups: (endpoint: string) => ["lookup", endpoint] as const,
  allReports: () => ["report"] as const,
  conversations: () => ["conversations"] as const,
}
