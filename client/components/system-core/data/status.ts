// The statuses a module may carry.
//
// `color` is what three.js wants (a hex number), `hex` what CSS wants, and
// `gain` scales the band's emissive intensity — running is the common case and
// reads too hot at full strength when a dozen of them are on screen at once.
//
// These are deliberately NOT the `--status-*` theme tokens. Those are text
// colours: light mode resolves `--status-warning` to `amber-700` (dark, for
// text on white) and dark mode to `amber-300` (pastel, for text on near-black).
// Neither survives being used as an emissive colour — the scene's additive
// materials need full saturation to read as lit rather than dusty against the
// stage. See `../scene/palette.ts` for why the stage stays dark in both themes.

export interface StatusDef {
  color: number;
  hex: string;
  name: string;
  gain?: number;
}

export const STATUS: Record<string, StatusDef> = {
  running: { color: 0xf89945, hex: '#F89945', name: 'running', gain: 0.62 },
  // Yellow rather than amber, and deliberately so: `running` is already an
  // orange (hue ~28°), and an amber degraded would have sat right next to it.
  // This is ~48°, which separates on a dark stage where the two are adjacent in
  // the stack. No `gain`, so it defaults to full strength like `fault` — a
  // degraded module is uncommon and is meant to draw the eye, unlike `running`,
  // which is damped precisely because a dozen of them are on screen at once.
  degraded: { color: 0xefc71f, hex: '#EFC71F', name: 'degraded' },
  fault: { color: 0xe0342b, hex: '#E0342B', name: 'fault' },
  init: { color: 0x2fcb6a, hex: '#2FCB6A', name: 'initializing' },
  loading: { color: 0x3e8cf0, hex: '#3E8CF0', name: 'loading' },
  controller: { color: 0xffffff, hex: '#ffffff', name: 'loading' },
};

export const STATUS_KEYS = Object.keys(STATUS);
