/**
 * Stand-in for the reference's `~/utils/logger`.
 *
 * Same call shape (`logger.log(tag, payload)` / `.warn(...)`), routed to the
 * console. Kept so the ported files need no edits at their call sites.
 */
type Args = unknown[]

const logger = {
  log: (...args: Args) => console.log(...args),
  info: (...args: Args) => console.info(...args),
  warn: (...args: Args) => console.warn(...args),
  error: (...args: Args) => console.error(...args),
  debug: (...args: Args) => console.debug(...args),
}

export default logger
