// The only place a Module is read and turned into numbers for the scene.
//
// Everything below the scene — strips, contacts, materials — is built from
// plain specs, so the schema is resolved exactly once, here. That is what lets
// the 3D objects be sized and reasoned about without knowing the module format
// or the status table.
//
// Each function takes the module's live Reading alongside it, or null when there
// is none. Non-optional on purpose: a caller that forgets it would silently
// render the authored arrangement while a poll ran, so the type system asks the
// question instead. The policy for what a reading does to an appearance lives in
// ../live/bind.ts, not here — this file resolves, it does not decide.
//
// Deliberately free of any `three` import. This module is reachable from the
// dialog shell, which is in the eagerly-loaded bundle; pulling three in here
// would put the whole library there with it and defeat the lazy boundary around
// the canvas. Hence the hex parser below instead of THREE.Color — the schema
// has already validated the string, and THREE.Color's sRGB round trip returns
// the same integer anyway. ../live/bind.ts is three-free for the same reason.

import { bandText } from '../data/schema';
import { tickerOf } from '../live/ticker';
import type { Reading } from '../live/bind';
import type { StripSpec } from '../objects/Strip';
import type { Module } from '../data/schema';
import {
  boundLevel,
  boundSpeed,
  statusGain,
  statusColor,
  boundOpacity,
  effectiveStatus,
  effectiveHealth,
  effectiveProgress,
} from '../live/bind';

/** Per-module state that has to outlive the meshes. Anything derived when a
 *  strip is built — its spin phase, its scanner lane — lives here or it
 *  silently resets the next time that strip is rebuilt. */
export interface Runtime {
  phase: number;
  lane: number;
}

/** How many rings of the scanner deck contacts are spread across. */
export const LANES = 5;

/** The outermost ring, kept for modules that arrived without a catalogue entry
 *  so an unrecognised target never displaces a curated one. */
export const OVERFLOW_LANE = LANES - 1;

/** Rings available to curated modules. */
const CURATED_LANES = LANES - 1;

/** `#RGB` or `#RRGGBB`, already validated and upper-cased by the schema. */
function hexToInt(hex: string): number {
  const s = hex.slice(1);
  if (s.length === 3) {
    return parseInt(s[0] + s[0] + s[1] + s[1] + s[2] + s[2], 16);
  }
  return parseInt(s, 16);
}

/** Everything the material registry keys on, for one module. */
export interface Appearance {
  color: number;
  opacity: number | null;
  gain: number;
}

/**
 * A module's material inputs.
 *
 * One function rather than three so the effective status is derived once per
 * module per build instead of once per value — the scene resolves this for every
 * module on every data change, and the status walk is the only real work in it.
 *
 * The colour override wins over the live status, which is deliberate: an
 * explicitly coloured module is a composition decision, and the poll should not
 * overrule it. Its status still moves, so the panel and the list still tell the
 * truth about it.
 */
export function appearanceOf(m: Module, live: Reading | null): Appearance {
  const status = effectiveStatus(m, live);
  return {
    color: m.appearance.color != null ? hexToInt(m.appearance.color) : statusColor(status),
    opacity: boundOpacity(m, live),
    gain: statusGain(status),
  };
}

export function stripSpec(m: Module, rt: Runtime, live: Reading | null): StripSpec {
  return {
    id: m.id,
    radius: m.geometry.radius,
    y: m.geometry.y,
    arcDeg: m.geometry.arc,
    band: m.geometry.band,
    visible: m.layout.visible,
    glow: m.appearance.glow,
    halo: m.appearance.halo,
    trail: m.appearance.trail,
    label: m.appearance.labelVisible ? bandText(m) : null,
    labelScale: m.appearance.labelScale,
    // The one live channel that is words rather than an appearance. It is here
    // rather than in ../live/bind.ts because it modulates nothing — the binding
    // layer decides what a reading does to how a strip *looks*, and this is what
    // a reading says.
    ticker: live == null ? null : tickerOf(live.channels),
    speed: boundSpeed(m, live),
    tone: m.audio.hz,
    toneLevel: boundLevel(m, live),
    lane: rt.lane,
    selectable: m.layout.selectable,
  };
}

/**
 * The readings a module shows in the panel, whether they came from the poll or
 * from its own authored telemetry. Not part of StripSpec: nothing in the scene
 * draws these yet, and the panel is the only reader.
 */
export interface Readout {
  health: number | null;
  progress: number | null;
}

export function readoutOf(m: Module, live: Reading | null): Readout {
  return {
    health: effectiveHealth(m, live),
    progress: effectiveProgress(m, live),
  };
}

/** A module's starting angle and lane, honouring pinned values. A pinned phase
 *  means a saved arrangement reloads exactly as it was left; null means pick
 *  one, so a fresh stack does not start with every strip aligned.
 *
 *  Overflow modules are placed on the reserved outer ring rather than taking the
 *  next free lane. That is keyed off the module's origin, not its current
 *  reading, so a discovered module whose sample lapses keeps its ring instead of
 *  migrating inward. */
function laneFor(m: Module, laneSeq: number, overflow: boolean): number {
  if (m.motion.lane != null) {
    return m.motion.lane;
  }
  if (overflow) {
    return OVERFLOW_LANE;
  }
  return laneSeq % CURATED_LANES;
}

export function newRuntime(m: Module, laneSeq: number, overflow = false): Runtime {
  return {
    phase: m.motion.phase != null ? m.motion.phase : Math.random() * Math.PI * 2,
    lane: laneFor(m, laneSeq, overflow),
  };
}
