// What the cluster actually measured, for the selected module.
//
// The snapshot carries a labelled, united reading per channel — getting on for a
// hundred of them across the stack, and the count moves whenever the catalogue
// does — and for a long time none of them reached a person: the client kept a mean
// and two picks and dropped the rest at live/adapt.ts. This is the surface that
// reads them.
//
// It is the panel and not the scene on purpose. Colour, rotation and opacity are
// the three channels the 3D has, they are spoken for, and live/bind.ts explains
// why adding a fourth is expensive. A list costs nothing on the GPU and can say
// "Root filesystem free 71%" in words, which no amount of hue ever will.
//
// AN ABSENT READING IS SHOWN, NOT SKIPPED
// ---------------------------------------
// The opposite call from live/ticker.ts, and deliberately so. On a band there is
// no room to explain an absence and a line reading "unknown || unknown" teaches
// nobody anything, so the ticker skips them. Here there is room, and the
// difference between a gauge reading zero and a gauge that does not exist is
// exactly what the server went to the trouble of preserving — see the state
// comment on SystemCoreChannel.

import type { SystemCoreChannel } from '@/components/system-core/live/types';
import type { TranslationKeys } from '@/components/system-core/shims/localize';
import { format } from './live/ticker';
import { useLocalize } from '@/components/system-core/shims/localize';

interface ChannelsProps {
  /** The selected module's readings. Empty when the poll is off or it has none. */
  channels: readonly SystemCoreChannel[];
}

/** How a channel that carries no number reads. */
const ABSENT: Record<string, TranslationKeys> = {
  missing: 'com_ui_system_core_channel_missing',
  error: 'com_ui_system_core_channel_unavailable',
};

export default function Channels({ channels }: ChannelsProps) {
  const localize = useLocalize();

  if (channels.length === 0) {
    return null;
  }

  return (
    <section className="mb-3">
      <h3 className="mb-1 text-[10px] uppercase tracking-wider text-text-tertiary">
        {localize('com_ui_system_core_channels')}
      </h3>
      <dl className="flex flex-col gap-0.5">
        {channels.map((c) => {
          const resolved = c.state === 'ok' && c.raw != null;
          return (
            <div key={c.id + '-' + c.label} className="flex items-baseline justify-between gap-2">
              {/* Free text from the server's catalogue, the same as a module
                  label — so it is printed rather than localized. */}
              <dt className="min-w-0 truncate text-xs text-text-secondary">{c.label}</dt>
              <dd
                className={
                  resolved
                    ? 'shrink-0 text-xs tabular-nums text-text-primary'
                    : 'shrink-0 text-xs italic text-text-tertiary'
                }
                // The query behind the reading, so a number that looks wrong can
                // be traced without reading the catalogue source.
                title={c.source}
              >
                {c.state === 'ok' && c.raw != null
                  ? format(c.raw, c.unit)
                  : localize(ABSENT[c.state] ?? 'com_ui_system_core_channel_unavailable')}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
