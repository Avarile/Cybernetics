// The wire format into the two shapes the scene actually consumes.
//
// The snapshot carries both of the things the client needs and they have very
// different lifetimes, so this file splits them apart rather than handing the
// payload around:
//
//   `readingsOf`    a Map of live samples. Recomputed every poll.
//   `catalogOf`     authored modules. Recomputed only when `catalogRevision`
//                   changes, which is the whole reason the server sends it.
//
// Keeping them separate is what lets the scene apply readings twenty times a
// minute while reconciling its module list almost never. See ../../hooks/
// SystemCore/useModules.ts for why a module's authored fields must not be
// rewritten by a poll.
//
// Nothing here throws. A snapshot is remote input, and the failure mode for a
// malformed one is a module that does not appear — not a modal that white-screens
// behind an error boundary.

import type {
  SystemCoreModule,
  SystemCorePlacement,
  SystemCoreSnapshotResponse,
} from '@/components/system-core/live/types';
import type { Reading } from './bind';
import type { Module } from '../data/schema';
import { STATUS_KEYS } from '../data/status';
import { normalize } from '../data/schema';

const NORMALIZE_OPTS = { statuses: STATUS_KEYS };

/**
 * The empty reading set.
 *
 * Module-level so its identity is stable: the scene's build memo keys on it, and
 * a fresh Map per render would rebuild every strip on the screen.
 */
export const NO_READINGS: ReadonlyMap<string, Reading> = new Map();

/** A finite number, or null. Guards a malformed payload out of the scene. */
function finite(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : v;
}

function readingOf(m: SystemCoreModule): Reading {
  return {
    status: m.status,
    // A module with no scrape target of its own — the app's own pod, say — is not
    // "down"; there is simply nothing to be down. Its health comes from its
    // channels instead.
    up: m.target == null ? true : m.target.up === true,
    health: finite(m.health),
    load: finite(m.load),
    rate: finite(m.rate),
    stale: m.staleness?.stale === true,
    overflow: m.origin === 'discovered',
    // Guarded like everything else here: a snapshot is remote input, and the
    // failure mode for a malformed one is a module with no readings rather than a
    // modal that white-screens behind an error boundary.
    channels: Array.isArray(m.channels) ? m.channels : [],
  };
}

/**
 * Live samples by module id.
 *
 * A `Map` rather than an object or an array because the scene does one lookup per
 * module per build — twenty-odd point reads on every tick.
 */
export function readingsOf(
  snapshot: SystemCoreSnapshotResponse | undefined,
): ReadonlyMap<string, Reading> {
  if (snapshot == null || !snapshot.configured || snapshot.modules.length === 0) {
    return NO_READINGS;
  }
  const out = new Map<string, Reading>();
  for (const m of snapshot.modules) {
    if (typeof m?.id === 'string' && m.id.length > 0) {
      out.set(m.id, readingOf(m));
    }
  }
  return out;
}

/**
 * The placement the server authored, as the schema's geometry and motion groups.
 *
 * `phase` is deliberately absent rather than null-and-explicit: null means "pick
 * one at load time", and a server-chosen starting angle would make every module
 * in the stack line up.
 */
function draftOf(m: SystemCoreModule) {
  const p: Partial<SystemCorePlacement> = m.placement ?? {};
  return {
    id: m.id,
    label: m.label,
    // Guarded: `normalize` rejects a status it does not know, which would drop
    // the module entirely. A server we cannot parse should still draw something.
    status: STATUS_KEYS.includes(m.status) ? m.status : 'init',
    geometry: { radius: p.radius, y: p.y, arc: p.arc, band: p.band },
    motion: { speed: p.speed, lane: p.lane ?? null },
    audio: { hz: p.hz ?? null, level: p.level },
    appearance: {},
    layout: { order: p.order ?? null },
    meta: {
      description: m.description ?? '',
      group: m.group ?? '',
      tags: Array.isArray(m.tags) ? m.tags : [],
    },
    links: { dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn : [] },
    // The authored floor beneath the live layer, so a module still says something
    // about itself when the feed goes quiet.
    telemetry: { health: finite(m.health), progress: finite(m.load) },
  };
}

export interface CatalogResult {
  modules: Module[];
  /** Modules the schema refused, with why. Surfaced rather than swallowed. */
  errors: string[];
}

/**
 * The snapshot's modules as authored `Module`s the panel can edit.
 *
 * Every one goes through the schema's own `normalize`, so a module that reaches
 * the scene is a module the scene can render and the panel can serialize. That
 * matters most for discovered targets, whose ids and labels come from whatever an
 * exporter happened to be called.
 */
export function catalogOf(snapshot: SystemCoreSnapshotResponse | undefined): CatalogResult {
  if (snapshot == null || !snapshot.configured) {
    return { modules: [], errors: [] };
  }
  const modules: Module[] = [];
  const errors: string[] = [];
  const taken = new Set<string>();

  for (const m of snapshot.modules) {
    const { module, errors: rejected } = normalize(draftOf(m), NORMALIZE_OPTS);
    if (module == null) {
      errors.push(`${m?.id ?? '(no id)'}: ${rejected.join('; ')}`);
      continue;
    }
    // A duplicate id would give two strips the same runtime entry, and they would
    // share one rotation.
    if (taken.has(module.id)) {
      errors.push(`${module.id}: duplicate id in the snapshot`);
      continue;
    }
    taken.add(module.id);
    modules.push(module);
  }
  return { modules, errors };
}

/** Whether a snapshot is worth reconciling against at all. */
export function hasCatalog(snapshot: SystemCoreSnapshotResponse | undefined): boolean {
  return snapshot != null && snapshot.configured && snapshot.modules.length > 0;
}

/**
 * The group the server files a discovered target under.
 *
 * Carried in `meta.group` rather than in a new schema field, which is what lets
 * the panel promote a module out of the overflow ring by hand — it is an ordinary
 * editable value, not a hidden flag.
 */
export const OVERFLOW_GROUP = 'overflow';

/**
 * Whether a module belongs on the reserved outer ring.
 *
 * Read off the authored group rather than off the current reading on purpose: a
 * discovered module whose sample lapses should keep its ring rather than migrate
 * inward and displace a curated one.
 */
export function isOverflow(m: Module): boolean {
  return m.meta.group === OVERFLOW_GROUP;
}
