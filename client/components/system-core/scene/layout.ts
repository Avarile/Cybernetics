// Where the text sits on a band: the fixed name, and the window the readout
// scrolls through.
//
// Pure arithmetic, extracted from Strip so it can be tested without a renderer.
// Nothing here knows about three, about React or about a material — it takes an
// arc and two aspect ratios and hands back slices.
//
// THE BAND IS A VIEWPORT, NOT A LABEL SLOT
// ----------------------------------------
// The name is drawn once where it sits and has to fit. The readout does not: its
// texture tiles across the window and is scrolled by advancing `offset.x`, so a
// module with six channels loops for longer rather than overflowing. That is what
// makes "too much data to fit on a band" stop being a failure mode.
//
// The scroll rate is deliberately independent of how long the string is. A stack
// where a busy module's text raced its neighbour's would read as noise; every
// band moving at one speed reads as one instrument.

import { LABEL_LEAD, NAME_SHARE, TICKER_SPEED, TICKER_MIN_SHARE } from './config';

/** A run of text along the arc. Angles are radians from the strip's origin. */
export interface BandSlice {
  start: number;
  theta: number;
  /** World height of the type on it. */
  height: number;
}

export interface BandReadout extends BandSlice {
  /** How many times the string tiles across the window. */
  repeat: number;
  /** How fast to advance `offset.x`, in uv units per second. */
  step: number;
}

export interface BandLayout {
  name: BandSlice | null;
  readout: BandReadout | null;
}

export interface BandInput {
  /** The strip's arc, in radians. */
  arc: number;
  /** The radius the text cylinders sit at, a hair outside the band. */
  radius: number;
  /** Preferred world height of the type, before anything is fitted. */
  height: number;
  /** Width/height of the name's texture, or null when there is no name. */
  nameAspect: number | null;
  /** Width/height of the readout's texture, or null when there is none. */
  readoutAspect: number | null;
}

/**
 * The name slice and the readout window for one strip.
 *
 * The name keeps its existing behaviour exactly when there is no readout: the
 * whole usable arc, shrinking rather than squashing if it does not fit. Given a
 * readout it is held to `NAME_SHARE` of that arc instead, and the readout takes
 * whatever is left — unless what is left is too narrow to read, in which case
 * there is no window at all rather than a sliver of moving text.
 */
export function bandLayout(input: BandInput): BandLayout {
  const { arc, radius, height, nameAspect, readoutAspect } = input;
  const lead = arc * LABEL_LEAD;
  const usable = arc * (1 - 2 * LABEL_LEAD);
  const end = lead + usable;

  // A name with nothing behind it still gets the whole arc — the readout is what
  // creates the competition for it.
  const nameFit = readoutAspect == null ? usable : usable * NAME_SHARE;

  let name: BandSlice | null = null;
  let cursor = lead;
  if (nameAspect != null) {
    let nameHeight = height;
    let theta = (nameHeight * nameAspect) / radius;
    // Long name on a short arc: scale it down rather than squash it.
    if (theta > nameFit) {
      nameHeight *= nameFit / theta;
      theta = nameFit;
    }
    name = { start: lead, theta, height: nameHeight };
    cursor = lead + theta;
  }

  if (readoutAspect == null) {
    return { name, readout: null };
  }

  const theta = end - cursor;
  if (theta < usable * TICKER_MIN_SHARE) {
    return { name, readout: null };
  }

  // Matched to the name, so a strip that had to shrink its title does not then
  // carry readings at a different size.
  const readoutHeight = name?.height ?? height;
  // World width of one copy of the string.
  const tile = readoutHeight * readoutAspect;
  return {
    name,
    readout: {
      start: cursor,
      theta,
      height: readoutHeight,
      repeat: (theta * radius) / tile,
      // uv units per second: one uv unit is one tile, so a constant world speed
      // divided by the tile's world width. Independent of string length by
      // construction — a longer string makes a bigger tile and a smaller step.
      step: TICKER_SPEED / tile,
    },
  };
}
