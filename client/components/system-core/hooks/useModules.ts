// The System Core's module list, and the per-module state that outlives its
// meshes.
//
// Two stores, deliberately separate:
//
//   `modules`  React state. Changing it re-renders the scene graph.
//   `runtime`  a Map in a ref, keyed by module id. Written 60×/second by every
//              strip on screen, and never read by React's render path — a
//              setState here would re-render the whole stack every frame.
//
// The runtime map is keyed by id rather than by list index so that deleting a
// module cannot shift everyone else's phase and lane onto their neighbours'.
//
// RECONCILE ADDS AND REMOVES. IT NEVER REWRITES.
// ---------------------------------------------
// A catalogue arriving from the server changes *which* modules exist, never what
// an existing one looks like. Placement hints are consumed exactly once, when a
// module is first added, and after that the arrangement belongs to whoever is
// editing it. That is what makes "hand edits never fight the poll" free rather
// than a per-field merge: there is no field-level conflict to resolve, because
// the poll never writes a field.
//
// It is keyed on `catalogRevision` for the same reason — the server changes that
// string only when the module set does, so a tick that merely carries new numbers
// does not reconcile at all.
//
// Edits are in-memory. Nothing here is persisted, and `reset` is the only way
// back to a pristine arrangement.

import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import type { Module } from '@/components/system-core/data/schema';
import type { Runtime } from '@/components/system-core/scene/resolve';
import { STATUS_KEYS } from '@/components/system-core/data/status';
import { loadFixture } from '@/components/system-core/data/fixture';
import { newRuntime } from '@/components/system-core/scene/resolve';
import { isOverflow } from '@/components/system-core/live/adapt';
import { uniqueId, normalize, blankModule } from '@/components/system-core/data/schema';

const NORMALIZE_OPTS = { statuses: STATUS_KEYS };

export interface UseModulesParams {
  /**
   * The server's module list, or null when there is no feed.
   *
   * Null keeps the bundled fixture, which is what makes an unconfigured
   * deployment a working scene rather than an empty one.
   */
  catalog?: Module[] | null;
  /** Changes only when the module *set* changes. Reconcile is keyed on it. */
  catalogRevision?: string | null;
}

export interface UseModulesReturn {
  modules: Module[];
  /** Fixture problems, surfaced rather than swallowed. Empty in the happy path. */
  loadErrors: string[];
  selected: string | null;
  select: (id: string | null) => void;
  /** The phase and lane a strip should resume from, created on first ask. */
  runtimeFor: (m: Module) => Runtime;
  /** Parks a strip's live angle. Does not trigger a render. */
  parkPhase: (id: string, phase: number) => void;
  /** Where a strip has actually turned to, for the phase control's pin button. */
  livePhase: (id: string) => number | null;
  /** Validates before committing, and reports why not. */
  replace: (id: string, draft: unknown) => string[];
  add: () => string;
  remove: (id: string) => void;
  reset: () => void;
}

export default function useModules(params: UseModulesParams = {}): UseModulesReturn {
  const { catalog = null, catalogRevision = null } = params;

  const initial = useMemo(() => loadFixture(), []);
  const [modules, setModules] = useState<Module[]>(initial.modules);
  const [selected, setSelected] = useState<string | null>(null);

  const runtime = useRef(new Map<string, Runtime>());
  const laneSeq = useRef(0);
  /** Ids the user removed. A catalogue tick must not resurrect them. */
  const dismissed = useRef(new Set<string>());
  /** The revision already applied, so a re-render does not reconcile again. */
  const applied = useRef<string | null>(null);
  /** Whether the scene is still showing the bundled fixture. */
  const fromFixture = useRef(true);

  /** Ids that came from a catalogue, so a hand-added module survives a reconcile. */
  const fromCatalog = useRef(new Set<string>());

  // Reconcile. Runs when the revision changes, which is when the module *set*
  // changed — not when the numbers did.
  useEffect(() => {
    if (catalog == null || catalogRevision == null || catalogRevision === applied.current) {
      return;
    }
    applied.current = catalogRevision;
    const arriving = catalog.filter((m) => !dismissed.current.has(m.id));
    const arrivingIds = new Set(arriving.map((m) => m.id));

    setModules((current) => {
      // The first catalogue replaces the fixture rather than joining it: the
      // bundled arrangement is a stand-in for real modules, not a set of extra
      // ones, and adding to it would draw the cluster twice.
      if (fromFixture.current) {
        fromFixture.current = false;
        fromCatalog.current = arrivingIds;
        for (const id of runtime.current.keys()) {
          if (!arrivingIds.has(id)) {
            runtime.current.delete(id);
          }
        }
        laneSeq.current = 0;
        return arriving;
      }

      const kept = current.filter((m) => !fromCatalog.current.has(m.id) || arrivingIds.has(m.id));
      const present = new Set(kept.map((m) => m.id));
      const added = arriving.filter((m) => !present.has(m.id));

      // Idempotent, so React invoking this updater twice under StrictMode cannot
      // do damage. It has to happen here rather than during render because
      // `runtimeFor` writes `laneSeq` while rendering, and a render-phase prune
      // would race its lazy create.
      for (const m of current) {
        if (!present.has(m.id) && !arrivingIds.has(m.id)) {
          runtime.current.delete(m.id);
        }
      }

      if (added.length === 0 && kept.length === current.length) {
        // Nothing changed. Returning `current` keeps the array identity, so the
        // scene's build memo does not run.
        return current;
      }
      for (const id of arrivingIds) {
        fromCatalog.current.add(id);
      }
      return [...kept, ...added];
    });
  }, [catalog, catalogRevision]);

  const runtimeFor = useCallback((m: Module): Runtime => {
    const found = runtime.current.get(m.id);
    if (found) {
      return found;
    }
    const overflow = isOverflow(m);
    const created = newRuntime(m, laneSeq.current, overflow);
    // Only a curated module draws from the lane sequence. An overflow module goes
    // on the reserved outer ring, so counting it would punch a gap in the
    // rotation of everything after it.
    if (m.motion.lane == null && !overflow) {
      laneSeq.current += 1;
    }
    runtime.current.set(m.id, created);
    return created;
  }, []);

  const parkPhase = useCallback((id: string, phase: number) => {
    const rt = runtime.current.get(id);
    if (rt) {
      rt.phase = phase;
    }
  }, []);

  // Wrapped into 0..2π: the live angle grows without bound, and the schema
  // bounds `phase` to one revolution.
  const livePhase = useCallback((id: string): number | null => {
    const rt = runtime.current.get(id);
    if (!rt) {
      return null;
    }
    const turn = Math.PI * 2;
    return ((rt.phase % turn) + turn) % turn;
  }, []);

  const select = useCallback((id: string | null) => {
    setSelected((current) => (current === id ? null : id));
  }, []);

  const replace = useCallback((id: string, draft: unknown): string[] => {
    const { module, errors } = normalize(draft, NORMALIZE_OPTS);
    if (!module) {
      return errors;
    }
    let rejected: string[] = [];
    setModules((current) => {
      const at = current.findIndex((m) => m.id === id);
      if (at < 0) {
        return current;
      }
      if (module.id !== id && current.some((m) => m.id === module.id)) {
        rejected = ['the id "' + module.id + '" is already taken'];
        return current;
      }
      const next = current.slice();
      next[at] = module;
      return next;
    });
    // An id change carries the strip's live angle and lane across with it, so
    // renaming a module does not restart its spin.
    if (module.id !== id) {
      const rt = runtime.current.get(id);
      if (rt) {
        runtime.current.set(module.id, rt);
        runtime.current.delete(id);
      }
      setSelected((current) => (current === id ? module.id : current));
    }
    return rejected;
  }, []);

  const add = useCallback((): string => {
    const id = uniqueId('module', new Set(modules.map((m) => m.id)));
    setModules((current) => [...current, blankModule(id, 'init')]);
    setSelected(id);
    return id;
  }, [modules]);

  const remove = useCallback((id: string) => {
    // Recorded, so the next catalogue tick does not put it back. Dismissing a
    // module the server still reports has to mean something, or the button looks
    // broken twenty seconds later.
    dismissed.current.add(id);
    setModules((current) => current.filter((m) => m.id !== id));
    runtime.current.delete(id);
    setSelected((current) => (current === id ? null : current));
  }, []);

  const reset = useCallback(() => {
    runtime.current.clear();
    laneSeq.current = 0;
    dismissed.current.clear();
    setSelected(null);
    // Back to the catalogue when there is one, and to the fixture when there is
    // not — in both cases to the pristine arrangement rather than to an empty
    // scene.
    if (catalog != null) {
      fromCatalog.current = new Set(catalog.map((m) => m.id));
      fromFixture.current = false;
      applied.current = catalogRevision;
      setModules(catalog);
      return;
    }
    fromCatalog.current.clear();
    fromFixture.current = true;
    applied.current = null;
    setModules(loadFixture().modules);
  }, [catalog, catalogRevision]);

  return {
    modules,
    loadErrors: initial.errors,
    selected,
    select,
    runtimeFor,
    parkPhase,
    livePhase,
    replace,
    add,
    remove,
    reset,
  };
}
