// Every colour inside the canvas, in one place.
//
// Why these are constants and not theme tokens
// --------------------------------------------
// The scene is lit almost entirely by emissive and additively-blended
// materials. That only reads as light against a near-black ground, so the
// viewport is a fixed dark stage in both light and dark mode — the convention
// every 3D editor uses. Semantic roles would fight it: our `--background` is
// white in light mode, and `--destructive`/`--chart-*` are surface and text
// colours that go pastel in dark mode, so neither survives being used as an
// emissive colour. The reference author hit the same wall and documented it: a
// design-system gold at 68% saturation "reads dusty against black where the
// reference reads lit".
//
// Design doc 4.3 ratifies this: fixed colours inside the canvas, semantic
// shadcn tokens everywhere outside it. The modal scrim in WindowLayer is part
// of "inside" for the same reason — a themed scrim over this stage washes it
// to grey in light mode.
//
// If a second visualization ever needs this stage, promote these into the
// theme layer as `--viewport-*` then. Not for one feature.

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
