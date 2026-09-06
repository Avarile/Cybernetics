/**
 * SystemCore wire types.
 *
 * Copied verbatim from the reference's
 * `packages/data-provider/src/types/queries.ts` (lines 277-423), which the
 * SystemCore tree imports as `librechat-data-provider`. We have no such
 * package, and these are pure types with no runtime, so they live here rather
 * than pulling in a monorepo dependency.
 *
 * Do not edit by hand — re-copy from the reference if it changes upstream.
 */

export type SystemCoreStatus = 'running' | 'degraded' | 'fault' | 'init' | 'loading' | 'controller';

/** Whether a module came from the curated catalogue or was found by discovery. */
export type SystemCoreOrigin = 'catalog' | 'discovered';

export type SystemCoreUnit =
  | 'ratio'
  | 'bytes'
  | 'seconds'
  | 'days'
  | 'count'
  | 'cores'
  | 'per_second'
  | 'boolean';

export type SystemCoreChannelId =
  | 'load'
  | 'saturation'
  | 'throughput'
  | 'latency'
  | 'errors'
  | 'capacity'
  | 'connections'
  | 'availability';

/**
 * 'activity' is a level to animate — busier means more, and nothing more.
 * 'health' is 0 bad .. 1 good and is averaged into the module's `health`.
 */
export type SystemCoreChannelPolarity = 'activity' | 'health';

/**
 * 'ok' carries a value. 'missing' means the series is not being scraped, which
 * is not a failure. 'error' means its query did not come back.
 *
 * The distinction matters: a gauge reading zero and a gauge that does not exist
 * must not look the same, or the scene draws "idle" where it means "unknown".
 */
export type SystemCoreChannelState = 'ok' | 'missing' | 'error';

export type SystemCoreChannel = {
  id: SystemCoreChannelId;
  label: string;
  state: SystemCoreChannelState;
  polarity: SystemCoreChannelPolarity;
  /** Normalized 0..1 and clamped. null unless `state` is 'ok'. */
  value: number | null;
  /** The upstream number in `unit`, for the panel's read-only display. */
  raw: number | null;
  unit: SystemCoreUnit;
  /** The catalogue query id behind this channel. Never an expression. */
  source: string;
};

export type SystemCoreTarget = {
  job: string;
  instance: string;
  namespace: string | null;
  pod: string | null;
  up: boolean;
};

/** The authored arrangement for one module, as the server holds it. */
export type SystemCorePlacement = {
  radius: number;
  y: number;
  arc: number;
  band: number;
  speed: number;
  hz: number | null;
  level: number;
  lane: number | null;
  order: number;
};

export type SystemCoreStaleness = {
  /** Seconds since the sample backing this module was scraped; null with no target. */
  scrapeAgeSeconds: number | null;
  stale: boolean;
};

export type SystemCoreModule = {
  id: string;
  label: string;
  status: SystemCoreStatus;
  origin: SystemCoreOrigin;
  /** Mean of the 'health'-polarity channels that resolved. null if none did. */
  health: number | null;
  /** Utilisation, for the panel readout. null when nothing reported it. */
  load: number | null;
  /** Throughput in events per second, unbounded. Drives the strip's spin. */
  rate: number | null;
  placement: SystemCorePlacement;
  channels: SystemCoreChannel[];
  staleness: SystemCoreStaleness;
  description: string;
  group: string;
  tags: string[];
  dependsOn: string[];
  target: SystemCoreTarget | null;
};

export type SystemCoreErrorCode =
  | 'timeout'
  | 'unreachable'
  | 'upstream_error'
  | 'bad_response'
  | 'truncated';

export type SystemCoreQueryError = {
  /** A catalogue query id, or 'up' for collection-wide problems. Never a URL. */
  source: string;
  code: SystemCoreErrorCode;
  message: string;
};

export type SystemCoreUnconfiguredReason = 'unset' | 'invalid_url';

export type SystemCoreSnapshotResponse = {
  /** false when the feed is not configured. The client keeps its fixture. */
  configured: boolean;
  reason?: SystemCoreUnconfiguredReason;
  /** When the upstream queries ran — not when this response was served. */
  collectedAt: string;
  /** Age of the served snapshot in the server's cache. 0 on a fresh fetch. */
  cacheAgeMs: number;
  /** Poll floor the server is asking for. Polling faster returns identical samples. */
  nextPollMs: number;
  /** Prometheus' scrape_interval, for the client's staleness wording. */
  scrapeIntervalSeconds: number;
  /**
   * Changes only when the *set* of modules or their placement changes, never
   * when a sample does. Lets the client reconcile its module list rarely and
   * apply readings often.
   */
  catalogRevision: string;
  modules: SystemCoreModule[];
  /** Per-query failures. Non-empty alongside populated `modules` is normal. */
  errors: SystemCoreQueryError[];
};

export type SystemCoreAvailabilityResponse = {
  /** Whether a Prometheus URL is configured at all. */
  configured: boolean;
  /** Whether *this* caller may read the feed. Both must hold to show the entry point. */
  enabled: boolean;
};
