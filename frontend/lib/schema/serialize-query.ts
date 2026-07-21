import type { SearchQuery, SearchRequestBody } from '@/lib/interfaces/search.interface'

/** Normalize UI query state into the API request body. */
export function toSearchRequestBody(
  query: SearchQuery,
  opts: { facets?: string[]; highlight?: string[] } = {},
): SearchRequestBody {
  const body: SearchRequestBody = { page: query.page, limit: query.limit }
  if (query.q.trim()) body.q = query.q.trim()

  const filters: Record<string, SearchQuery['filters'][string]> = {}
  for (const [field, value] of Object.entries(query.filters)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'string' && value === '') continue
    filters[field] = value
  }
  if (Object.keys(filters).length) body.filters = filters

  if (query.sort.length) body.sort = query.sort.map((s) => `${s.field}:${s.dir}`)
  if (opts.facets?.length) body.facets = opts.facets
  if (opts.highlight?.length) body.highlight = opts.highlight
  return body
}
