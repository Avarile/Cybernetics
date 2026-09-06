// A module's channels as text: one reading, and the whole line.
//
// The server sends every channel with a `label`, a `raw` value and a `unit`, and
// until now nothing turned those three into something a person could read. This
// is that step, and it has exactly two consumers: the panel's readout list, and
// the string printed on a band.
//
// WHY EVERY BRANCH ROUNDS
// -----------------------
// The quantisation below is for the *cache*, not for legibility. A ticker string
// is a LabelFactory key (../scene/labels.ts), and that cache holds one canvas,
// one texture and one material per distinct string. Feed it an unrounded gauge
// and every poll asks for a fresh one, for every module, for ever — the same
// unbounded-codomain failure ./bind.ts exists to keep away from the material
// registry. Rounded, a module whose numbers have not meaningfully moved yields a
// byte-identical string, the cache hits, and nothing is rasterised at all.
//
// So the rule is the one in ./bind.ts, applied to a different cache: a value that
// reaches a cache key must have a small codomain. Anything added here rounds.
//
// Deliberately free of `three`, of React and of any I/O — ../scene/resolve.ts
// imports it, and that file has to stay three-free so the dialog shell does not
// drag the library into the eager bundle.

import type { SystemCoreUnit, SystemCoreChannel } from '@/components/system-core/live/types';

/**
 * Between readings, and after the last one.
 *
 * The trailing separator is not a stray: the band's texture tiles, so the seam
 * where the last reading meets the first again has to read as just another
 * divider rather than as two values run together.
 */
export const SEPARATOR = ' || ';

/** Decimal, not binary: exporters report bytes, and operators read GB not GiB. */
const BYTE_STEP = 1000;
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

function bytes(raw: number): string {
  let n = Math.abs(raw);
  let step = 0;
  while (n >= BYTE_STEP && step < BYTE_UNITS.length - 1) {
    n /= BYTE_STEP;
    step += 1;
  }
  const rounded = step === 0 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${raw < 0 ? '-' : ''}${rounded} ${BYTE_UNITS[step]}`;
}

/**
 * One reading, in its own unit.
 *
 * Takes the raw value rather than the normalized one because the normalized one
 * has already lost what makes it legible: `scale.ts` maps 37 pods and 1.4 GB and
 * 56 days all onto 0..1, which is exactly right for driving an appearance and
 * exactly wrong for telling somebody what is going on.
 */
export function format(raw: number, unit: SystemCoreUnit): string {
  switch (unit) {
    case 'ratio':
      return `${Math.round(raw * 100)}%`;
    case 'bytes':
      return bytes(raw);
    // Probe latencies live between a millisecond and a second, where seconds
    // rounds to "0" and says nothing.
    case 'seconds':
      return raw >= 1 ? `${Math.round(raw * 10) / 10}s` : `${Math.round(raw * 1000)}ms`;
    case 'days':
      return `${Math.round(raw)}d`;
    case 'count':
      return `${Math.round(raw)}`;
    case 'cores':
      return `${(Math.round(raw * 100) / 100).toFixed(2)} cores`;
    case 'per_second':
      return `${Math.round(raw * 10) / 10}/s`;
    case 'boolean':
      return raw === 0 ? 'no' : 'yes';
    default:
      return `${Math.round(raw)}`;
  }
}

/**
 * Every resolved reading for one module as a single line, or null if there is
 * nothing to say.
 *
 * Channels that did not resolve are skipped rather than rendered as "unknown".
 * That is a decision about *this* surface only: on a band there is no room to
 * explain an absence, and a strip whose whole line reads "unknown || unknown"
 * teaches nobody anything. The panel makes the opposite call and shows them,
 * because there it can say why — see ../Channels.tsx.
 *
 * The caller is responsible for the width of what it does with this. A module
 * with six channels produces a line well over a hundred characters, which at the
 * rasteriser's 128px type is a canvas several thousand pixels wide; see
 * ../scene/labels.ts for the texture bound that keeps it inside what a GPU will
 * accept.
 */
export function tickerOf(channels: readonly SystemCoreChannel[]): string | null {
  const parts: string[] = [];
  for (const c of channels) {
    // Inline rather than behind a helper so `raw` narrows to a number here.
    if (c.state !== 'ok' || c.raw == null) {
      continue;
    }
    parts.push(`${c.label} ${format(c.raw, c.unit)}`);
  }
  return parts.length === 0 ? null : parts.join(SEPARATOR) + SEPARATOR;
}
