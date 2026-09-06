// The control panel: the module list, the editing form, and the actions.
//
// Commit flow, and why a rejected edit does not refill the form: the form hands
// over a candidate module, the schema judges it, and only a clean one reaches
// the scene. On success `refillKey` is bumped so every control re-reads from the
// normalised module — that is how "0.050" becomes "0.05" and a lower-case hex
// becomes upper-case. On failure the controls are deliberately left alone, so
// the value the user is arguing with is still on screen to be corrected.

import { useMemo, useState, useCallback } from 'react';
import { Plus, Copy, Trash2, RotateCcw, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/system-core/shims/ui';
import type { TranslationKeys } from '@/components/system-core/shims/localize';
import type { LiveState } from '@/components/system-core/hooks/useLive';
import type { Reading } from './live/bind';
import type { Module } from './data/schema';
import { serialize } from './data/serialize';
import { displayName } from './data/schema';
import Channels from './Channels';
import Form from './Form';
import List from './List';
import { useLocalize } from '@/components/system-core/shims/localize';
import { cn } from '@/lib/utils';

interface PanelProps {
  modules: Module[];
  /** Live samples by module id. Empty when the poll is off, which is what keeps
   *  the fixture-only panel fully editable with no special case. */
  readings: ReadonlyMap<string, Reading>;
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  /** Returns the reasons it was refused; empty means committed. */
  onReplace: (id: string, draft: unknown) => string[];
  onReset: () => void;
  livePhase: (id: string) => number | null;
  /** What the poll is doing, for the header chip. */
  liveState: LiveState;
  /** Age of the served snapshot, so "live" can say how live. */
  cacheAgeMs: number | null;
  /** Clears the error latch and asks again. */
  onRetry: () => void;
}

/** How the chip reads in each state. */
const LIVE_LABEL: Record<LiveState, TranslationKeys> = {
  off: 'com_ui_system_core_live_off',
  paused: 'com_ui_system_core_live_paused',
  loading: 'com_ui_loading',
  live: 'com_ui_system_core_live',
  stale: 'com_ui_system_core_live',
  error: 'com_ui_system_core_live_error',
};

/** The dot's colour, from the scene's own palette rather than a text role — the
 *  chip is a legend for the bands, same reasoning as List.tsx. */
const LIVE_DOT: Record<LiveState, string> = {
  off: 'bg-text-tertiary',
  paused: 'bg-text-tertiary',
  loading: 'bg-text-tertiary',
  live: 'bg-status-success',
  stale: 'bg-status-warning',
  error: 'bg-status-error',
};

/** Whole seconds, then whole minutes. Nobody needs "94.2s ago". */
function ageLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

const ACTION = 'h-7 gap-1 rounded-lg px-2 text-xs text-text-secondary hover:text-text-primary';

export default function Panel({
  modules,
  readings,
  selected,
  onSelect,
  onAdd,
  onRemove,
  onReplace,
  onReset,
  livePhase,
  liveState,
  cacheAgeMs,
  onRetry,
}: PanelProps) {
  const localize = useLocalize();
  const [refillKey, setRefillKey] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const current = useMemo(
    () => modules.find((m) => m.id === selected) ?? null,
    [modules, selected],
  );

  const handleCommit = useCallback(
    (candidate: Module) => {
      if (!selected) {
        return;
      }
      const problems = onReplace(selected, candidate);
      setErrors(problems);
      if (problems.length === 0) {
        setRefillKey((k) => k + 1);
      }
    },
    [selected, onReplace],
  );

  // Capture where the strip has actually turned to, rather than making anyone
  // type a radian angle by hand.
  const handlePin = useCallback(() => {
    if (!current || !selected) {
      return;
    }
    const phase = livePhase(selected);
    if (phase == null) {
      return;
    }
    const draft = structuredClone(current);
    draft.motion.phase = Number(phase.toFixed(4));
    const problems = onReplace(selected, draft);
    setErrors(problems);
    if (problems.length === 0) {
      setRefillKey((k) => k + 1);
    }
  }, [current, selected, livePhase, onReplace]);

  // Emits the *authored* arrangement, never the live one. That is the point of
  // keeping the two layers apart: a live value in here would export a momentary
  // telemetry sample as though it were composition data, and pasting it back
  // would pin those numbers permanently.
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(serialize(modules)).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setErrors([localize('com_ui_system_core_copy_failed')]),
    );
  }, [modules, localize]);

  const handleRemove = useCallback(() => {
    if (selected) {
      onRemove(selected);
      setErrors([]);
    }
  }, [selected, onRemove]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col border-l border-border-light bg-surface-primary text-text-primary">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-light px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-text-secondary">
          <span className="shrink-0">
            {localize('com_ui_system_core_modules')}
            <span className="ml-1 text-text-tertiary">({modules.length})</span>
          </span>
          {/* One chip for the whole feed. Without it there is no way to tell a
              quiet cluster from a poll that stopped. */}
          <span
            className="flex min-w-0 items-center gap-1 text-[10px] font-normal text-text-tertiary"
            title={
              liveState === 'stale' && cacheAgeMs != null
                ? localize('com_ui_system_core_live_stale', { age: ageLabel(cacheAgeMs) })
                : undefined
            }
          >
            <i
              aria-hidden="true"
              className={cn('size-1.5 shrink-0 rounded-full', LIVE_DOT[liveState])}
            />
            <span className="truncate">{localize(LIVE_LABEL[liveState])}</span>
          </span>
          {liveState === 'error' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="h-5 shrink-0 gap-1 rounded px-1 text-[10px] text-text-secondary hover:text-text-primary"
            >
              <RefreshCw className="size-3" aria-hidden="true" />
              {localize('com_ui_system_core_live_retry')}
            </Button>
          )}
        </span>
        <div className="flex items-center gap-1">
          {/* A hand-added module has no reading, so all of its fields are
              editable — and it becomes bound the moment its id matches a target
              the server reports, which is a usable way to adopt a module by
              hand. */}
          <Button variant="ghost" size="sm" onClick={onAdd} className={ACTION}>
            <Plus className="size-3.5" aria-hidden="true" />
            {localize('com_ui_add')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={!current || current.layout.locked === true}
            className={cn(ACTION, 'text-text-secondary hover:text-status-error')}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {localize('com_ui_delete')}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <List modules={modules} readings={readings} selected={selected} onSelect={onSelect} />
      </div>

      {/* The form only claims its share of the height once there is something to
          edit; otherwise the list gets the whole panel, which matters at full
          screen where an empty form pane would waste half of it. */}
      <div
        className={cn(
          'min-h-0 overflow-y-auto border-t border-border-light px-3 py-3',
          current ? 'flex-[1.4]' : 'shrink-0',
        )}
      >
        {current ? (
          <>
            <p className="mb-2 truncate text-xs font-medium text-text-primary">
              {displayName(current)}
            </p>
            {/* Above the form, because it is what the cluster says and the form
                is what the arrangement says. Renders nothing when the poll is
                off, which is what keeps the fixture-only panel unchanged. */}
            <Channels channels={readings.get(current.id)?.channels ?? []} />
            <Form
              module={current}
              live={readings.get(current.id) ?? null}
              refillKey={refillKey}
              onCommit={handleCommit}
              onPin={handlePin}
            />
          </>
        ) : (
          <p className="text-xs text-text-tertiary">
            {localize('com_ui_system_core_no_selection')}
          </p>
        )}

        {errors.length > 0 && (
          <ul
            role="alert"
            className="mt-3 flex flex-col gap-1 rounded-lg bg-status-error-subtle px-2 py-1.5 text-xs text-status-error"
          >
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-border-light px-3 py-2">
        <Button variant="ghost" size="sm" onClick={handleCopy} className={ACTION}>
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copied ? localize('com_ui_copied') : localize('com_ui_system_core_copy_json')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className={cn(ACTION, 'ml-auto')}
          // Reset means "back to pristine", and where pristine comes from
          // depends on whether there is a feed behind it.
          title={localize(
            readings.size > 0 ? 'com_ui_system_core_reset_source' : 'com_ui_system_core_reset_data',
          )}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {localize('com_ui_reset')}
        </Button>
      </div>
    </div>
  );
}
