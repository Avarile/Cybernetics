// Every measurement in the scene, in one place.
//
// Ported from the reference implementation's per-object DEFAULTS blocks. These
// are layout, not appearance — see ./palette.ts for the colours and ./tone.ts
// for the sound, and CLAUDE.md on why feature geometry stays feature-owned
// rather than becoming theme tokens.

/** The central column and the cap rings that mark the stack's extent. */
export const MAINFRAME = {
  spineRadius: 0.055,
  spineHeight: 3.1,
  /** The cap rings share the (unrendered) containment shell's radius. */
  shellRadius: 1.24,
  capY: 1.55,
  capThickness: 0.01,
} as const;

/** The sensor deck under the mainframe. */
export const SCANNER = {
  /** Height of the deck, relative to the mainframe's origin. */
  y: -1.86,
  radius: 12,
  /** Grid rings, as fractions of the radius. */
  rings: [0.84, 2],
  /** Radial spokes. They span the full diameter, so n spokes draw 2n arms. */
  spokes: 4,
  /** Sweep needle: how wide its wedge is, in radians, and how fast it turns. */
  sweepArc: 0.42,
  sweepSpeed: 0.3,
} as const;

/** How far a strip's soft layers reach past the band they wrap: `h` as a
 *  multiple of the band's own height, `pad` in radians past each end of its
 *  arc, `r` in world units outside its radius.
 *
 *  Both are flush with the band — same height, same arc — so they add light to
 *  it rather than bleeding around it. `r` still differs between them and stays
 *  non-zero: the two layers and the band would otherwise be coplanar, and the
 *  band writes depth, so they need separating or they z-fight. */
export const SOFT = {
  glow: { h: 1.0, pad: 0, r: 0.014 },
  halo: { h: 1.0, pad: 0, r: 0.03 },
} as const;

/** Preferred world height of a label; thin bands shrink it to fit. */
export const LABEL_H = 0.058;

/** How much of a band's height the text may occupy. Most bands are shorter
 *  than LABEL_H allows for, so this — not LABEL_H — is what actually sets the
 *  size on the majority of modules. */
export const LABEL_FILL = 0.95;

/** Inset from the strip's leading edge, as a fraction of its arc. The label is
 *  set flush left rather than centred, so names line up with each other as the
 *  stack turns instead of drifting with each strip's own arc length. */
export const LABEL_LEAD = 0.05;

/** Where along a strip's arc its sound comes from, as a fraction of that arc.
 *  The midpoint, so a wide band is not heard from one of its own edges. Position
 *  in the model, hence here rather than in ./tone.ts with the audible values. */
export const TONE_ARC = 0.5;

/** Longest frame the simulation will integrate. Without a clamp, returning to
 *  a backgrounded tab hands over one enormous delta and every strip jumps. */
export const MAX_DELTA = 0.1;

/** Vertical field of view the scene is composed for. The canvas and the
 *  framing pass share it, so the default view is stated once. */
export const FRAME_FOV = 45;

/** Camera framing: the extent below is fitted to the frame, then pulled in by
 *  this much. Close enough that the wide controller ring runs off the sides,
 *  which is the composition — the stack is the subject, not the ring. */
export const FRAME_FILL = 0.84;

/** Direction the camera is framed along, before distance is applied. The y term
 *  is the elevation: 0.85 against a horizontal reach of 1.6 looks down on the
 *  stack at ~28°, high enough to open the cap rings into ellipses without
 *  looking into the top of the column. */
export const FRAME_DIRECTION = [1, 0.85, 1.25] as const;

/** Slack past the fitted extent, so nothing touches the edges. */
export const FRAME_MARGIN = 1.35;

/** Half-diagonal of the box the two cap rings enclose.
 *
 *  This, and not the stack's measured bounding box, is what the camera frames
 *  on. A module's radius is editable and its contact reaches out to the deck,
 *  so a measured box moves with the data: widening one module, or adding one,
 *  would silently pull the default view back. The cap rings are what mark the
 *  stack's extent, and they hold still. */
const FRAME_EXTENT = Math.hypot(
  MAINFRAME.shellRadius + MAINFRAME.capThickness,
  MAINFRAME.capY + MAINFRAME.capThickness,
  MAINFRAME.shellRadius + MAINFRAME.capThickness,
);

/** How far the camera sits from the stack's centre in the default view. */
export const FRAME_DISTANCE =
  (FRAME_EXTENT / Math.tan((FRAME_FOV * Math.PI) / 360)) * FRAME_MARGIN * FRAME_FILL;
