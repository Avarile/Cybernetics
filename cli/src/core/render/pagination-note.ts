/** The `{ data, total, page, limit }` shape every list envelope in this CLI shares. */
export interface PaginatedEnvelope {
  data: readonly unknown[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Announces rows that exist beyond this page, rather than letting a
 * `--limit` default silently hide the rest. `null` when every matching row
 * fit on this page.
 *
 * Shared across every domain's `ls` command (contacts, finance, invoices,
 * projects, tasks, knowledge) — they all page the same `{ data, total, page,
 * limit }` envelope shape, so this used to be copy-pasted once per
 * `*.helpers.ts` file. Each of those still re-exports it under its own name
 * for backward-compatible imports; this is the one implementation.
 *
 * Not the whole story for every domain: knowledge additionally has
 * `withheldRowsNote` (knowledge.helpers.ts) for rows an access filter drops
 * *after* this page was fetched — a different fact (visibility, not
 * pagination) computed from a different field (`totalBeforeAccess`), so it
 * stays separate rather than folded in here.
 */
export function morePagesNote(envelope: PaginatedEnvelope): string | null {
  const seenSoFar = (envelope.page - 1) * envelope.limit + envelope.data.length;
  const remaining = envelope.total - seenSoFar;
  if (remaining <= 0) return null;

  return (
    `${remaining} more record(s) beyond this page — use --page ${envelope.page + 1} ` +
    `(or a larger --limit) to see them.`
  );
}
