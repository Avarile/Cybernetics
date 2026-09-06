/**
 * Formats an ISO timestamp as `YYYY-MM-DD HH:MM` in local time. Falls back
 * to the raw string for anything `Date` can't parse, rather than printing
 * "Invalid Date".
 *
 * Shared across domains that print a timestamp column (sessions' `EXPIRES`,
 * knowledge's `UPDATED`, ...) — previously defined once in
 * `commands/auth/sessions.command.ts` and reached into from elsewhere, which
 * made an unrelated domain list depend on an auth command module for a
 * plain date formatter.
 */
export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const pad2 = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}
