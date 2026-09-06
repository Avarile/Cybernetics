// Every colour inside the canvas, in one place.
//
// Why these are constants and not theme tokens
// --------------------------------------------
// The scene is lit almost entirely by emissive and additively-blended
// materials. That only reads as light against a near-black ground, so the
// viewport is a fixed dark stage in both light and dark mode — the convention
// every 3D editor uses, and what the reference implementation renders.
// Semantic roles would fight it: `--surface-primary` is white in light mode,
// and the `--status-*` roles are text colours (light mode resolves
// `--status-warning` to `amber-700`, dark mode to a pastel `amber-300`), so
// neither survives being used as an emissive colour. The reference author hit
// the same wall and documented it: a design-system gold at 68% saturation
// "reads dusty against black where the reference reads lit".
//
// CLAUDE.md sanctions this — specialized visualization stays feature-owned. The
// rule that still applies: everything OUTSIDE the canvas (dialog chrome, the
// control panel, the module list) uses semantic tokens only. The one exception
// is the status legend, which has to match the colours actually on screen, so
// it reads its swatches from STATUS.hex.
//
// If a second visualization ever needs this stage, promote these into the
// versioned theme registry as `rgb-viewport-*` then. Not for one feature.

/** The stage. Near-black with a blue cast, so the emissive bands read warm. */
export const STAGE_BACKGROUND = 0x00001c;

/** Turns a module's `speed` (revolutions per second) into radians per second. */
export const SPIN = Math.PI * 2 * 0.15;

/** The central column and its two cap rings. */
export const MAINFRAME = {
  spineColor: 0xffffff,
  spineEmissive: 0xbb9244,
  spineEmissiveIntensity: 0.08,
  spineRoughness: 0.7,
  spineMetalness: 0.2,
} as const;

/** The sensor plate under the mainframe, and the sweep turning across it. */
export const SCANNER_COLORS = {
  plateColor: 0x04121f,
  plateEmissive: 0x01182b,
  plateEmissiveIntensity: 0.55,
  plateOpacity: 0.34,
  gridEmissive: 0x01182b,
  gridEmissiveIntensity: 1.1,
  gridOpacity: 0.42,
  rimEmissive: 0x8fc7f2,
  rimEmissiveIntensity: 1.5,
  rimOpacity: 0.7,
  sweepEmissive: 0xb6b7db,
  sweepEmissiveIntensity: 1.0,
  sweepOpacity: 0.1,
} as const;

/** Ink the band names are drawn in: deep enough to hold against the band's own
 *  emission rather than blowing out with it. */
export const LABEL_INK = '#674E1E';

/** Hemisphere and the two directional lights. */
export const LIGHTS = {
  hemiSky: 0xffffff,
  hemiGround: 0xd8d2c4,
  hemiIntensity: 1.0,
  keyColor: 0xffffff,
  keyIntensity: 2.2,
  fillColor: 0xfff4e6,
  fillIntensity: 0.5,
} as const;
