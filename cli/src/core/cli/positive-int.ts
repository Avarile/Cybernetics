import { UsageError } from '../errors';

/**
 * Parses a `--page`/`--limit`-style flag's raw string value as a positive
 * integer (> 0), throwing a `UsageError` naming the flag when it isn't one.
 * Shared across every `ls` command's pagination flags rather than
 * copy-pasted per file.
 */
export function positiveInt(flag: string, v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new UsageError(`${flag} must be a positive integer, got "${v}".`);
  }
  return n;
}
