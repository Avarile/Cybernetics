// The editing form, generated from SPEC.
//
// Not a line of this form is written by hand. Every control, its type, its
// range and its label come from the schema in data/schema.ts, so declaring a
// field there is the whole job of adding it to the panel — there is no markup
// to keep in step and no second copy of the validation rules.

import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import type { TranslationKeys } from '@/components/system-core/shims/localize';
import type { FieldSpec, Module } from './data/schema';
import type { Reading } from './live/bind';
import type { Reader } from './Fields';
import { SPEC, GROUPS, isGroup, groupFields } from './data/schema';
import { Field, ReaderRegistry } from './Fields';
import { BINDINGS } from './live/bind';
import { useLocalize } from '@/components/system-core/shims/localize';

/** Everything editable, as [path, spec], in schema order. */
const FIELDS: [string, FieldSpec][] = (() => {
  const out: [string, FieldSpec][] = [];
  for (const [key, spec] of Object.entries(SPEC)) {
    if (isGroup(spec)) {
      for (const [fk, fs] of Object.entries(spec.fields)) {
        out.push([key + '.' + fk, fs]);
      }
      continue;
    }
    out.push([key, spec]);
  }
  return out;
})();

const SCALAR_FIELDS = FIELDS.filter(([p]) => !p.includes('.'));

function readPath(m: Module, path: string): unknown {
  const p = path.split('.');
  const bag = m as unknown as Record<string, unknown>;
  if (p.length === 1) {
    return bag[p[0]];
  }
  const group = bag[p[0]] as Record<string, unknown> | undefined;
  return (group || {})[p[1]];
}

function writePath(m: Module, path: string, v: unknown): void {
  const p = path.split('.');
  const bag = m as unknown as Record<string, unknown>;
  if (p.length === 1) {
    bag[p[0]] = v;
    return;
  }
  if (!bag[p[0]] || typeof bag[p[0]] !== 'object') {
    bag[p[0]] = {};
  }
  (bag[p[0]] as Record<string, unknown>)[p[1]] = v;
}

interface FormProps {
  module: Module;
  /**
   * The module's live sample, or null when the poll is off.
   *
   * Null is what makes the feature-off path free of special cases: with no
   * reading nothing is bound, so every field is editable and the form behaves
   * exactly as it did before there was a feed at all.
   */
  live: Reading | null;
  /** Bumped by the parent to refill every control from `module` — the revert
   *  path, and the confirmation after a successful edit. */
  refillKey: number;
  /** Every control's current value, gathered into a copy of the module. */
  onCommit: (candidate: Module) => void;
  onPin: () => void;
}

export default function Form({ module, live, refillKey, onCommit, onPin }: FormProps) {
  const localize = useLocalize();
  const readers = useRef<Map<string, Reader>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Section open/closed state lives above the refill boundary, so refilling the
  // controls never snaps sections the user has opened back shut.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of GROUPS) {
      const s = SPEC[g];
      init[g] = isGroup(s) ? s.open === true : false;
    }
    return init;
  });

  // Read every control into a copy of the module. Cloning rather than building
  // fresh is what preserves fields this build does not know about.
  const latest = useRef({ module, onCommit });
  latest.current = { module, onCommit };

  const commit = useCallback(() => {
    const { module: cur, onCommit: send } = latest.current;
    const next = structuredClone(cur);
    for (const [path] of FIELDS) {
      const read = readers.current.get(path);
      if (read) {
        writePath(next, path, read());
      }
    }
    send(next);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    // The native `change` event, not React's onChange — see the note in
    // Fields.tsx. It bubbles, so one delegated listener covers every native
    // control; the Radix ones call commit() themselves.
    const handler = () => commit();
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, [commit]);

  // A locked module stays readable but not editable — except for the lock
  // itself, which is the way back out.
  const locked = module.layout.locked === true;
  const disabledFor = (path: string) => locked && path !== 'layout.locked';

  // The same per-path shape as `disabledFor`, which is the whole reason locking
  // a live field cost almost nothing: `BINDINGS` is keyed by the dotted paths
  // this form already enumerates, so the mechanism was here waiting.
  const boundAt = (path: string): TranslationKeys | undefined =>
    live == null ? undefined : BINDINGS[path]?.name;

  // What a bound control actually shows. `module` is the authored arrangement,
  // seeded from the first snapshot and never rewritten by a poll — so reading a
  // bound path off it displayed a first-poll value under a "Driven by live data"
  // badge for the rest of the session. The binding knows how to resolve its own
  // path; ask it.
  const valueAt = (path: string): unknown => {
    if (live == null) {
      return readPath(module, path);
    }
    const bound = BINDINGS[path];
    return bound == null ? readPath(module, path) : bound.display(module, live);
  };

  const groups = useMemo(
    () => GROUPS.map((g) => ({ g, spec: SPEC[g], fields: Object.entries(groupFields(g)) })),
    [],
  );

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      {locked && (
        <p className="rounded-lg bg-status-warning-subtle px-2 py-1 text-xs text-status-warning">
          {localize('com_ui_system_core_locked')}
        </p>
      )}
      {/* Keyed on the module and the refill counter: a new key rebuilds the
          controls, which is how defaultValue gets to speak again. */}
      <div key={`${module.id}:${refillKey}`} className="flex flex-col gap-3">
        <ReaderRegistry readers={readers} commit={commit}>
          {/* The ungrouped scalars — id, label, status — sit at the top. */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {SCALAR_FIELDS.map(([path, spec]) => (
              <Field
                key={path}
                path={path}
                spec={spec}
                value={valueAt(path)}
                disabled={disabledFor(path)}
                bound={boundAt(path)}
              />
            ))}
          </div>

          {groups.map(({ g, spec, fields }) => (
            <details
              key={g}
              open={open[g]}
              onToggle={(e) => {
                // Read during the handler: React clears `currentTarget` once it
                // returns, and the updater below runs after that.
                const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                setOpen((o) => ({ ...o, [g]: isOpen }));
              }}
              className="rounded-lg border border-border-light"
            >
              <summary className="cursor-pointer select-none px-2 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary">
                {isGroup(spec) ? spec.title : g}
              </summary>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-2 pb-2 pt-1">
                {fields.map(([k, fs]) => {
                  const path = g + '.' + k;
                  return (
                    <Field
                      key={path}
                      path={path}
                      spec={fs}
                      value={valueAt(path)}
                      disabled={disabledFor(path)}
                      bound={boundAt(path)}
                      onPin={onPin}
                    />
                  );
                })}
              </div>
            </details>
          ))}
        </ReaderRegistry>
      </div>
    </div>
  );
}
