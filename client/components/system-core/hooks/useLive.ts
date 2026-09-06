// The live layer, as the dialog consumes it.
//
// WHY THE REACT QUERY CACHE *IS* THE STATE
// ---------------------------------------
// There is no atom here and no ref. Jotai's role in this app is very-high-
// frequency writes where one write should re-render exactly one subscriber; a
// twenty-second tick whose whole payload the whole scene consumes is the
// opposite, so there is no fine-grained subscription to buy. Recoil is the
// conversation model and atom families, neither of which applies. An atom would
// need a `useEffect` syncing query→atom: a second source of truth, a frame of
// skew, no benefit. The precedent is explicit — `useActiveJobs` holds no client
// state at all, and ~/data-provider owns "polling and backoff".
//
// WHY IT LIVES ABOVE THE LAZY BOUNDARY
// ------------------------------------
// Called from Dialog.tsx, not from Scene.tsx. Scene is the `three`-only chunk
// behind the lazy boundary and data has no business in it. Calling this above the
// `open &&` render gate is fine because the query's `enabled` gates the network,
// not the mount — so nothing is fetched while the modal is closed, and the
// default five-minute cacheTime means reopening inside that window paints the
// last snapshot immediately and refetches in the background.

import { useMemo, useEffect } from 'react';
import type { SystemCoreSnapshotResponse } from '@/components/system-core/live/types';
import type { Reading } from '@/components/system-core/live/bind';
import type { Module } from '@/components/system-core/data/schema';
import { readingsOf, catalogOf, NO_READINGS } from '@/components/system-core/live/adapt';
import useSystemCoreAvailable from './useAvailable';
import {
  snapshotBreakerOpen,
  resetSnapshotBreaker,
  useSystemCoreSnapshot,
  useRetrySystemCoreSnapshot,
} from '@/components/system-core/shims/data-provider';

/** What the poll is doing, for the panel's chip. */
export type LiveState = 'off' | 'paused' | 'loading' | 'live' | 'stale' | 'error';

export interface UseLiveReturn {
  /** Whether the feature is configured and this user may read it. */
  available: boolean;
  state: LiveState;
  readings: ReadonlyMap<string, Reading>;
  /**
   * The server's module list as editable modules, or null when there is none.
   *
   * Null rather than an empty array so that "no catalogue" and "a catalogue with
   * nothing in it" stay distinguishable — the first keeps the fixture, the second
   * would clear the scene.
   */
  catalog: Module[] | null;
  /** Changes only when the module set changes, never when a sample does. */
  catalogRevision: string | null;
  /** Snapshot problems and modules the schema refused. Empty in the happy path. */
  errors: string[];
  /** Age of the served snapshot, for the panel's "as of" readout. */
  cacheAgeMs: number | null;
  retry: () => void;
}

function stateOf(
  enabled: boolean,
  available: boolean,
  snapshot: SystemCoreSnapshotResponse | undefined,
  isError: boolean,
): LiveState {
  if (!available) {
    return 'off';
  }
  if (!enabled) {
    // Configured and permitted, but nobody is looking.
    return 'paused';
  }
  if (snapshot == null) {
    return isError ? 'error' : 'loading';
  }
  if (!snapshot.configured) {
    return 'off';
  }
  if (isError || snapshotBreakerOpen()) {
    return 'error';
  }
  // Either the server served a cached snapshot after a failed refresh, or a
  // scrape has gone quiet. Both mean the numbers on screen are not current.
  const stale = snapshot.modules.some((m) => m.staleness?.stale === true);
  return stale ? 'stale' : 'live';
}

/**
 * @param enabled Whether anything is watching. False keeps the query mounted and
 *   idle, which is what preserves the cache across an open/close cycle.
 */
export default function useLive(enabled: boolean): UseLiveReturn {
  // Shared with the button and the sidebar link, so all three agree and between
  // them cost one request per session.
  const available = useSystemCoreAvailable();

  const snapshotQuery = useSystemCoreSnapshot({ enabled: available && enabled });
  const snapshot = snapshotQuery.data;
  const retry = useRetrySystemCoreSnapshot();

  // Reopening the modal is the natural retry gesture, so it clears the latch. In
  // an effect rather than in the render body because it mutates module-level
  // state that the refetch predicate reads.
  useEffect(() => {
    if (enabled) {
      resetSnapshotBreaker();
    }
  }, [enabled]);

  const readings = useMemo(() => readingsOf(snapshot), [snapshot]);

  // Keyed on the revision, not on the payload: this is what stops the module list
  // being rebuilt twenty times a minute. `catalogOf` walks every module and runs
  // each through the schema, which is far too much to redo per tick — and
  // reconciling on every tick would also mean re-adding a module the user had
  // just dismissed.
  const revision = snapshot?.configured === true ? snapshot.catalogRevision : null;
  const catalog = useMemo(() => {
    if (revision == null) {
      return { modules: null as Module[] | null, errors: [] as string[] };
    }
    const { modules, errors } = catalogOf(snapshot);
    return { modules, errors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const errors = useMemo(() => {
    const out = [...catalog.errors];
    for (const error of snapshot?.errors ?? []) {
      out.push(`${error.source}: ${error.message}`);
    }
    return out;
  }, [catalog.errors, snapshot?.errors]);

  return {
    available,
    state: stateOf(enabled, available, snapshot, snapshotQuery.isError),
    readings: available ? readings : NO_READINGS,
    catalog: catalog.modules,
    catalogRevision: revision,
    errors,
    cacheAgeMs: snapshot?.cacheAgeMs ?? null,
    retry,
  };
}
