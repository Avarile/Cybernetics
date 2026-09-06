/**
 * Converts a camelCase DTO field name to the kebab-case flag a user actually
 * types, e.g. `periodStart` -> `--period-start`. nest-commander option flags
 * are always declared kebab-case (`@Option({ flags: '--period-start <date>' })`);
 * rendering a raw DTO key as `--${key}` instead names a flag that doesn't
 * exist.
 */
export function toFlagName(key: string): string {
  return `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

/**
 * Renders a "Missing required flag(s)" message listing each key's real
 * flag name, for a `UsageError`.
 */
export function missingFlagsMessage(missing: string[]): string {
  return `Missing required flag(s): ${missing.map(toFlagName).join(', ')}.`;
}
