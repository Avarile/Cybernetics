// Where a metric becomes an appearance.
//
// THE INVARIANT THIS FILE EXISTS TO HOLD
// -------------------------------------
// Every channel that reaches `MaterialRegistry.get()` must have a finite,
// enumerable codomain declared as a constant in this file.
//
// That is not a style rule. The registry (../scene/materials.ts) caches one
// material per distinct appearance, and five materials are requested per module
// per build. Bind a continuously-varying number to colour or opacity and every
// build allocates a fresh set of GPU materials — at 26 modules that is 130 per
// tick. So colour is driven by `status`, whose codomain is the five keys in
// ../data/status.ts, and the leak is closed by construction rather than by
// cleanup. `MaterialRegistry.sweep()` is the backstop, not the fix.
//
// `motion.speed` and `audio.level` are safe to drive continuously for the
// opposite reason: neither is part of a material key. Speed reaches a `useFrame`
// closure and allocates nothing; level reaches `ToneBus.setLevel`, which moves
// one number on an existing voice. `appearance.opacity` *is* part of the key, so
// it is bound to a single constant rather than to a curve — see boundOpacity.
//
// LIVE MODULATES AUTHORED, IT DOES NOT REPLACE IT
// ----------------------------------------------
// Every bound channel starts from the module's authored value and moves it.
// `boundSpeed` keeps the authored sign, so a strip authored to turn the other
// way still does and only its rate changes; a strip authored at rest stays at
// rest. That is what keeps a hand edit meaningful on a field the poll owns, and
// it is the shape every channel added later should follow.
//
// Deliberately free of `three`, of React, and of any I/O — this is the part
// worth testing, and ../scene/resolve.ts (which imports it) has to stay
// three-free so the dialog shell does not drag the library into the eager
// bundle.

import type { SystemCoreChannel } from '@/components/system-core/live/types';
import type { TranslationKeys } from '@/components/system-core/shims/localize';
import type { Module } from '../data/schema';
import { groupFields } from '../data/schema';
import { STATUS, STATUS_KEYS } from '../data/status';

/**
 * Membership by key, not by lookup.
 *
 * `STATUS` is a plain object literal, so `STATUS['__proto__']` is
 * `Object.prototype` and `STATUS['constructor']` is a function — both truthy. A
 * presence check written as a lookup therefore admits any inherited property
 * name, which is exactly how an unbounded string would reach
 * `MaterialRegistry.get()` and defeat the codomain invariant at the top of this
 * file.
 */
const KNOWN_STATUSES = new Set(STATUS_KEYS);

/**
 * One module's live sample, already normalized by the server.
 *
 * `null` is not zero. A channel the backend could not resolve — no such series,
 * or a query that failed — arrives as `null`, and a gauge reading zero has to
 * stay distinguishable from a gauge that does not exist, or the scene renders
 * "idle" where it should render "unknown".
 */
export interface Reading {
  /**
   * The status the server resolved for this module, as a key of ../data/status.
   *
   * The server owns this rather than the client re-deriving it, because it knows
   * strictly more: which channels are marked *critical*, and how the scrape age
   * compares to the interval it was configured with. Deriving it here from mean
   * health alone silently downgraded exactly the cases that matter — a root
   * filesystem at 96% faults on the server while averaging out to "degraded"
   * against a healthy availability channel.
   */
  status: string;
  /** Whether the module's target is responding at all. For display. */
  up: boolean;
  /** Aggregate health, 0 bad .. 1 good. */
  health: number | null;
  /** Utilisation, 0 .. 1. */
  load: number | null;
  /** Throughput in events per second. Unbounded and non-negative. */
  rate: number | null;
  /**
   * No sample within the staleness window. Already folded into `status` by the
   * server; carried separately so the panel can say *why* a module reads unknown.
   */
  stale: boolean;
  /** Arrived without a catalogue entry, so it belongs on the overflow lane. */
  overflow: boolean;
  /**
   * Every channel the server resolved for this module, verbatim.
   *
   * Deliberately not reduced here, unlike everything above it. `health` is
   * already the mean of the health-polarity channels and `load` and `rate` are
   * already picks off named ids; this is the layer underneath those three, and it
   * is the only one that still knows what each reading is called, what unit it is
   * in, and whether it resolved at all. Both the panel readout and the band
   * ticker want that, and neither can recover it from a mean.
   *
   * Empty rather than absent when nothing resolved, so no consumer has to
   * null-check before iterating. Read-only because it is handed straight out of
   * the query cache and shared with every other consumer of that snapshot —
   * nothing downstream may sort or splice it in place.
   */
  channels: readonly SystemCoreChannel[];
}

/**
 * Which `Reading` field drives a given module path, and what the panel shows for
 * it.
 *
 * `display` is what makes a bound control a readout rather than a label. Without
 * it the form rendered the *authored* value under a "Driven by live data" badge
 * — the module is seeded from the first snapshot and never rewritten, so a module
 * could go from running to fault, recolour in the scene, recolour in the list,
 * and still read `running` in the form for the rest of the session.
 */
export interface LiveBinding {
  channel: keyof Reading;
  name: TranslationKeys;
  /** The value to show for this path when there is a reading. */
  display: (m: Module, live: Reading) => unknown;
}

// Speed bounds come from the schema rather than from literals here. Bound values
// never pass through normalize(), so nothing else would catch an out-of-range
// speed, and a stack turning at 40 rev/s is a blur rather than a visualisation.
const SPEED_SPEC = groupFields('motion').speed;
const SPEED_MIN = SPEED_SPEC.min ?? -10;
const SPEED_MAX = SPEED_SPEC.max ?? 10;

// HOW THROUGHPUT MOVES A STRIP, AND WHY IT ONLY *MOVES* IT
// -------------------------------------------------------
// This used to compute a magnitude from the rate alone and keep nothing but
// `Math.sign(authored)`. Two things went wrong with that, and both were visible.
// The authored spread — the whole reason no two rings in the scene are
// synchronised — was discarded for every module that had a throughput channel.
// And the log curve was unbounded at the top, so redis at 52 ops/s landed on
// 0.561 while everything else sat between 0.04 and 0.2: one strip visibly
// turning and twenty-seven apparently stopped.
//
// So the rate is a *factor* on the authored speed, not a replacement for it. The
// band is deliberately narrow: a busy module should read as busier than its
// neighbour, not as the only living thing on screen.
const RATE_QUIET = 0.85;
const RATE_BUSY = 1.55;
/** Throughput treated as "fully busy". Past it the factor is pinned to RATE_BUSY. */
const RATE_FULL = 200;

/**
 * Rounded so an unchanged sample produces an unchanged number.
 *
 * A duplicate poll tick is expected — the client polls faster than Prometheus
 * scrapes — and it should cost nothing. Float noise in the third decimal would
 * make every tick look like a change to R3F.
 */
const PRECISION = 1000;

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) {
    return lo;
  }
  if (v > hi) {
    return hi;
  }
  return v;
}

/** A finite number, or null. Guards NaN and ±Infinity out of the scene. */
function finite(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) {
    return null;
  }
  return v;
}

/** A finite number clamped into 0..1, or null. */
export function ratio(v: number | null | undefined): number | null {
  const n = finite(v);
  if (n == null) {
    return null;
  }
  return clamp(n, 0, 1);
}

/**
 * The status the scene should draw a module with.
 *
 * Returns a key of STATUS, always — the codomain guarantee the material registry
 * depends on, and the reason this is a function here rather than a field read at
 * the call site. The server's status is *validated*, not trusted: a key the
 * palette does not have would otherwise reach `MaterialRegistry.get()` and put an
 * unbounded string into its key space.
 *
 * Ownership: the server decides what a module's status is when there is a
 * reading, because it can see per-channel critical flags and the scrape age. The
 * authored status answers only when there is no reading at all — which is what
 * makes an unconfigured deployment a no-op rather than a special case.
 */
export function effectiveStatus(m: Module, live: Reading | null): string {
  // Identity, not health: the controller is the centre of the composition and is
  // drawn white whatever the cluster is doing. Asserted here as well as on the
  // server so that a catalogue disagreement cannot repaint the centre ring.
  if (m.status === 'controller') {
    return 'controller';
  }
  if (live == null) {
    return m.status;
  }
  return KNOWN_STATUSES.has(live.status) ? live.status : m.status;
}

/** The colour a module is drawn in: its own override, else its status colour. */
export function statusColor(status: string): number {
  return STATUS[status]?.color ?? 0xffffff;
}

/** Emissive scaling for the band, by status. */
export function statusGain(status: string): number {
  return STATUS[status]?.gain ?? 1;
}

/**
 * How fast a module's strip turns.
 *
 * Logarithmic: throughput on this cluster spans from 0 to a few thousand events
 * per second across modules, and a linear map would leave everything but the
 * busiest module visually stopped.
 *
 * The authored value supplies the direction and, when there is no reading, the
 * whole answer. A module authored at rest stays at rest — `Math.sign(0)` is 0 —
 * which is how a strip is deliberately parked.
 */
export function boundSpeed(m: Module, live: Reading | null): number {
  const authored = m.motion.speed;
  const rate = live == null ? null : finite(live.rate);
  if (rate == null) {
    return authored;
  }
  // Logarithmic in the rate: throughput across this cluster spans zero to a few
  // thousand events a second, and a linear map would leave everything but the
  // busiest module pinned at the quiet end.
  const busy = clamp(Math.log1p(Math.max(0, rate)) / Math.log1p(RATE_FULL), 0, 1);
  const factor = RATE_QUIET + (RATE_BUSY - RATE_QUIET) * busy;
  const signed = authored * factor;
  return Math.round(clamp(signed, SPEED_MIN, SPEED_MAX) * PRECISION) / PRECISION;
}

/**
 * The opacity a stale module is drawn at.
 *
 * ONE value, not a ladder scaled from the authored opacity. Opacity is part of
 * the material key, so the codomain here is the thing that matters: a single
 * constant adds exactly one entry per colour/gain combination to the registry,
 * where a proportional dim would add one per distinct authored opacity. It also
 * needs no hysteresis, which a continuous dim would — `stale` is already a
 * boolean the server derived from a threshold three scrape intervals wide, so
 * there is no edge for a value to hover on.
 *
 * Visually it is the better answer too: every stale module fading to the same
 * ghost reads as a category, where per-module dimming reads as noise.
 */
const STALE_OPACITY = 0.3;

/**
 * Opacity: the authored value, or a fixed ghost when the sample is stale.
 *
 * Staleness already shows in the status colour ('loading'), so this is the second
 * channel saying the same thing — which is the point. A dim band reads as "not
 * to be trusted" from across the room, before anyone has looked at a colour.
 */
export function boundOpacity(m: Module, live: Reading | null): number | null {
  if (live != null && live.stale) {
    return STALE_OPACITY;
  }
  return m.appearance.opacity;
}

/**
 * The quietest a module goes when it is completely unwell.
 *
 * A floor rather than zero: silence reads as "not configured", and a failing
 * service should still be present in the mix.
 */
const LEVEL_FLOOR = 0.4;

/**
 * How loud a module's roar is.
 *
 * Health scales the authored level *down* and never up, so the arrangement's
 * loudness is a ceiling the cluster cannot exceed. That direction is the safe
 * one: `audio.ts` notes that overlapping voices sum, and "everything gets louder
 * as things break" is how a monitoring scene turns into an alarm nobody can sit
 * next to. A cluster going quiet as it degrades reads as going dark, which is
 * both pleasanter and the honest metaphor.
 *
 * Continuous rather than a ladder, unlike opacity: level is not part of any
 * material key, and ToneBus.setLevel writes one AudioParam target rather than
 * building anything, so there is nothing here for a quantiser to protect.
 */
export function boundLevel(m: Module, live: Reading | null): number {
  const authored = m.audio.level;
  const health = live == null ? null : ratio(live.health);
  if (health == null) {
    return authored;
  }
  const scaled = authored * (LEVEL_FLOOR + (1 - LEVEL_FLOOR) * health);
  return Math.round(clamp(scaled, 0, 1) * PRECISION) / PRECISION;
}

/**
 * Health for display, with the authored value as the floor.
 *
 * This is what finally makes `telemetry.health` load-bearing. It is not the
 * carrier for live data — it stays authored, editable and serialized — it is the
 * fallback underneath it, so the fixture can express health per module and an
 * unconfigured scene still has something to say.
 */
export function effectiveHealth(m: Module, live: Reading | null): number | null {
  return (live == null ? null : ratio(live.health)) ?? ratio(m.telemetry.health);
}

/** Utilisation for display, with `telemetry.progress` as the floor. */
export function effectiveProgress(m: Module, live: Reading | null): number | null {
  return (live == null ? null : ratio(live.load)) ?? ratio(m.telemetry.progress);
}

/**
 * The paths the poll owns, keyed exactly as `Form.tsx` addresses its controls.
 *
 * Declared here rather than at the top of the file because every `display` below
 * references a function defined above it — an object literal is evaluated at
 * module load, so hoisting this would be a temporal dead zone error rather than a
 * style question.
 *
 * Kept small on purpose. Everything absent here — geometry, lane, labels,
 * audio, the colour override, opacity, the glow/halo/trail flags, visibility —
 * stays authored and fully editable, which is what lets the arrangement remain
 * something a person composes rather than something the cluster dictates.
 *
 * `status` is the only entry that reaches a material, and it is safe because its
 * codomain is STATUS_KEYS. Adding an entry here that resolves to a continuous
 * appearance value would reopen the leak described at the top of this file.
 *
 * OWNED IS NOT THE SAME AS MODULATED
 * ----------------------------------
 * `appearance.opacity` and `audio.level` are both driven by the poll and are
 * deliberately *absent* here, which is not an oversight. This map means "the poll
 * owns this field, so lock it"; those two are modulations of an authored value
 * that stays meaningful and is the only control over it — opacity applies
 * whenever the sample is current, and level is the ceiling the health curve
 * scales down from. Locking them would take away the only way to set them.
 * Before adding a path here, ask which of the two it is.
 */
export const BINDINGS: Record<string, LiveBinding> = {
  status: {
    channel: 'health',
    name: 'com_ui_system_core_channel_health',
    display: effectiveStatus,
  },
  'motion.speed': {
    channel: 'rate',
    name: 'com_ui_system_core_channel_rate',
    display: boundSpeed,
  },
  'telemetry.health': {
    channel: 'health',
    name: 'com_ui_system_core_channel_health',
    display: effectiveHealth,
  },
  'telemetry.progress': {
    channel: 'load',
    name: 'com_ui_system_core_channel_load',
    display: effectiveProgress,
  },
};
