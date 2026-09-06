// The only place a domain + its health is read and turned into numbers for the
// scene.
//
// Everything below the scene — strips, materials — is built from plain specs, so
// this resolution happens exactly once, here. That is what lets the 3D objects
// be sized and reasoned about without knowing what a "domain" is.
//
// Deliberately free of any `three` import. This module is reachable from the
// shell, which is in the eagerly-loaded bundle; pulling three in here would put
// the whole library there with it and defeat the lazy boundary around the
// canvas.
//
// DIVERGENCE FROM THE REFERENCE
// -----------------------------
// The reference resolved a user-authored `Module` (a zod schema with geometry,
// appearance, motion and audio groups, edited through a side panel). We do not
// port that panel, and our strips are bound to live feature domains rather than
// hand-edited rows, so a Module schema would have no consumer and no editor.
// A Domain plus a Health resolves straight to a StripSpec instead.

import type { Domain } from "../data/domains"
import { STATUS, type Health } from "../data/status"

/** What one strip needs to draw itself. Produced here, consumed by Strip. */
export interface StripSpec {
  /** Names every mesh in the strip. Identity, not display text. */
  id: string
  radius: number
  /** Height in the stack. */
  y: number
  /** Arc length, in degrees. */
  arcDeg: number
  /** Band height. */
  band: number
  visible: boolean
  glow: boolean
  halo: boolean
  trail: boolean
  /** Text printed on the band; null draws no label at all. */
  label: string | null
  labelScale: number
  /** Revolutions per second, before SPIN scales it. */
  speed: number
  /** Drone fundamental in Hz; null makes no sound at all. */
  tone: number | null
  /** Share of the global ceiling this strip's drone may use, 0 to 1. */
  toneLevel: number
  selectable: boolean
}

/** Per-strip state that has to outlive the meshes. A strip's spin phase is
 *  derived when it is built, so it lives here or it silently resets the next
 *  time that strip is rebuilt. */
export interface Runtime {
  phase: number
}

/** Vertical spacing between bands in the stack. */
const BAND_STEP = 0.34
/** Height of a single band. */
const BAND_HEIGHT = 0.09
/** Where the bottom band sits, so the stack straddles the origin. */
const STACK_BASE = -1.19

/** Base revolutions per second, before the status multiplier. */
const BASE_SPEED = 0.06

/** Drone fundamentals, walked down the stack so bands beat against each other
 *  rather than landing in unison. Only used when sound is switched on. */
const TONE_BASE = 42
const TONE_STEP = 5.5

export function yOf(domain: Domain): number {
  return STACK_BASE + domain.band * BAND_STEP
}

/** A domain's colour comes from its health — there are no per-domain overrides,
 *  because nobody authors these. */
export function colorOf(health: Health): number {
  return STATUS[health].color
}

/** Emissive scaling. Nominal is the common case and reads too hot at full
 *  strength with eight bands on screen. */
export function gainOf(health: Health): number {
  return STATUS[health].gain
}

/** Revolutions per second. Health drives it, so a busy domain visibly spins up
 *  and a failed one nearly stops. */
export function speedOf(health: Health): number {
  return BASE_SPEED * STATUS[health].speed
}

export function stripSpec(domain: Domain, health: Health): StripSpec {
  return {
    id: domain.key,
    radius: domain.radius,
    y: yOf(domain),
    arcDeg: domain.arcDeg,
    band: BAND_HEIGHT,
    visible: true,
    glow: true,
    // The halo is the most expensive soft layer and the least legible once
    // eight bands overlap; kept for the widest few only.
    halo: domain.band >= 5,
    trail: health === "active",
    label: domain.label,
    labelScale: 1,
    speed: speedOf(health),
    tone: TONE_BASE + domain.band * TONE_STEP,
    // Quieter up the stack, so the low bands carry the drone.
    toneLevel: Math.max(0.15, 0.75 - domain.band * 0.07),
    selectable: true,
  }
}

/** A strip's starting angle. Spread deterministically by band rather than
 *  randomly, so the stack looks the same on every load and tests are stable. */
export function newRuntime(domain: Domain): Runtime {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5))
  return { phase: (domain.band * GOLDEN) % (Math.PI * 2) }
}
