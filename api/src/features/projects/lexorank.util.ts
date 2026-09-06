/**
 * Lexicographic ranks for drag-and-drop ordering.
 *
 * A task board reorders constantly. With an integer `sort_order`, moving one
 * card rewrites every row after it; with a rank string, a move writes exactly
 * one row, because a new rank can always be generated *between* two existing
 * ones.
 *
 * Ranks are base-36 strings compared bytewise, so ordering is whatever
 * Postgres's `ORDER BY sort_rank` already does — no application-side sort.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length;
const MID = ALPHABET[Math.floor(BASE / 2)]; // 'i'

/** First rank in an empty list. */
export function initialRank(): string {
  return MID;
}

/**
 * A rank strictly between `before` and `after`.
 *
 * Either bound may be null, meaning "start of list" / "end of list". When the
 * two bounds are adjacent with no room between them, the result extends the
 * string by one character rather than failing — which is why ranks grow slowly
 * over time and why {@link needsRebalance} exists.
 */
export function rankBetween(
  before: string | null,
  after: string | null,
): string {
  const lo = before ?? '';
  const hi = after ?? '';

  if (lo && hi && lo >= hi) {
    throw new Error(
      `rankBetween requires before < after (got "${lo}", "${hi}")`,
    );
  }

  let prefix = '';
  let i = 0;
  for (;;) {
    const loChar = lo[i] ?? ALPHABET[0];
    const hiChar = hi[i] ?? undefined;
    const loIdx = ALPHABET.indexOf(loChar);
    const hiIdx = hiChar === undefined ? BASE : ALPHABET.indexOf(hiChar);

    if (hiIdx - loIdx > 1) {
      const midIdx = Math.floor((loIdx + hiIdx) / 2);
      return prefix + ALPHABET[midIdx];
    }

    // No gap at this position: keep the shared prefix and look one deeper.
    prefix += loChar;
    i += 1;

    // Past the end of the lower bound with the upper bound immediately above:
    // append a midpoint, which is always strictly between the two.
    if (i >= lo.length && hiIdx - loIdx <= 1 && hi.length <= i) {
      return prefix + MID;
    }
  }
}

/**
 * Whether ranks have grown long enough to warrant a rebalance.
 *
 * Repeated insertion at the same point lengthens the string by a character each
 * time. Nothing breaks — comparison still works — but a sweep that rewrites the
 * list with fresh short ranks keeps the index small.
 */
export function needsRebalance(ranks: string[], maxLength = 12): boolean {
  return ranks.some((r) => r.length > maxLength);
}

/** Evenly spaced ranks for `count` items — used when rebalancing a list. */
export function evenlySpacedRanks(count: number): string[] {
  if (count <= 0) return [];
  const step = Math.max(1, Math.floor(BASE / (count + 1)));
  return Array.from({ length: count }, (_, i) => {
    const idx = Math.min(BASE - 1, step * (i + 1));
    return ALPHABET[idx];
  });
}
