// The module list: every module, grouped and ordered, with its status colour.
//
// The swatches read their colour from the scene's palette rather than from a
// `--status-*` theme role. That is deliberate and it is the one place outside
// the canvas allowed to: a legend has to match the thing it is a legend for,
// and the bands on screen are the saturated scene colours. See
// scene/palette.ts.

import { Fragment, useMemo } from 'react';
import { Lock } from 'lucide-react';
import type { Reading } from './live/bind';
import type { Module } from './data/schema';
import { effectiveStatus } from './live/bind';
import { displayName } from './data/schema';
import { STATUS } from './data/status';
import { useLocalize } from '@/components/system-core/shims/localize';
import { cn } from '@/lib/utils';

interface ListProps {
  modules: Module[];
  /** Live samples by module id; empty when the poll is off. The swatch has to
   *  read through these or the legend contradicts the bands it stands for. */
  readings: ReadonlyMap<string, Reading>;
  selected: string | null;
  onSelect: (id: string) => void;
}

/** Ungrouped modules sort last, whatever they are called. */
const LAST = '￿';

export default function List({ modules, readings, selected, onSelect }: ListProps) {
  const localize = useLocalize();

  // Grouped by meta.group, then ordered by layout.order where it is set and by
  // list order where it is not. Sorting by group first is what keeps each
  // group's rows contiguous, so the headings below can be emitted on change.
  const rows = useMemo(() => {
    const out = modules.map((m, i) => ({ m, i }));
    out.sort((a, b) => {
      const ag = a.m.meta.group || LAST;
      const bg = b.m.meta.group || LAST;
      if (ag !== bg) {
        return ag < bg ? -1 : 1;
      }
      const ao = a.m.layout.order;
      const bo = b.m.layout.order;
      if (ao != null && bo != null && ao !== bo) {
        return ao - bo;
      }
      if (ao != null && bo == null) {
        return -1;
      }
      if (ao == null && bo != null) {
        return 1;
      }
      return a.i - b.i;
    });
    return out;
  }, [modules]);

  const grouped = rows.some((r) => r.m.meta.group);
  let lastGroup: string | undefined;

  return (
    <div
      className="flex flex-col gap-0.5"
      role="listbox"
      aria-label={localize('com_ui_system_core_modules')}
    >
      {rows.map(({ m }) => {
        const g = m.meta.group || '';
        const heading = grouped && g !== lastGroup ? g || 'ungrouped' : null;
        lastGroup = g;
        const hint = m.meta.tooltip || m.meta.description;
        const on = m.id === selected;

        return (
          <Fragment key={m.id}>
            {heading !== null && (
              <div className="px-2 pb-0.5 pt-2 text-[10px] uppercase tracking-wider text-text-tertiary">
                {heading}
              </div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={on}
              title={hint || undefined}
              onClick={() => onSelect(m.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors duration-theme-fast',
                on
                  ? 'bg-surface-active-alt text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                // A hidden module still lists, so it can be found again.
                m.layout.visible ? '' : 'opacity-50',
              )}
            >
              <i
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{
                  background:
                    m.appearance.color ||
                    STATUS[effectiveStatus(m, readings.get(m.id) ?? null)]?.hex,
                }}
              />
              {/* Plain text, not markup: a label is free text. */}
              <span className="truncate">{displayName(m)}</span>
              {m.layout.locked === true && (
                <Lock
                  className="ml-auto size-3 shrink-0 text-text-tertiary"
                  aria-label={localize('com_ui_system_core_locked')}
                />
              )}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
