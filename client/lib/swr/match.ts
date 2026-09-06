/**
 * Whether an SWR cache key starts with the given tuple.
 *
 * Invalidation is expressed as a prefix — `["list", "/contacts"]` reaches every
 * page, filter and sort of that domain — which is what lets one window's delete
 * refresh another window showing the same list. Non-array keys are rejected
 * rather than coerced: SWR's cache also holds its own internal string keys, and
 * a loose match there would evict them.
 */
export function hasPrefix(key: unknown, prefix: readonly unknown[]): boolean {
  if (!Array.isArray(key)) return false
  if (prefix.length > key.length) return false
  return prefix.every((part, i) => Object.is(part, key[i]))
}
