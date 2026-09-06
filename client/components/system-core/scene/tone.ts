// Every sound inside the canvas, in one place.
//
// Companion to ./palette.ts: that file holds every colour and the argument for
// why colours stay feature-owned, this one holds every audible number and the
// curves that shape them. ./config.ts keeps the measurements, and TONE_ARC there
// is the single audio value that is genuinely a position in the model rather
// than a sound.
//
// WHAT A LAUNCH IS MADE OF
// ------------------------
// A rocket is noise, not notes. Nearly all of it is broadband turbulence out of
// the nozzle, so it is built by filtering white noise into three bands rather
// than by stacking oscillators — which is why it needs no audio asset and no
// pitch to be in tune with anything. Two things do the work that filtering
// alone cannot:
//
//   CHURN, because static filtered noise is an air conditioner. The irregular
//   swell of combustion is most of what makes it read as a rocket at all.
//
//   SATURATE, because a launch is heard through its own compression. The soft
//   clip is also the peak limiter: the curve is normalised to ±1, so however the
//   bands happen to sum, nothing downstream of it can clip.
//
// WHAT A MAINFRAME IS MADE OF
// ---------------------------
// The exact opposite, which is why both live here rather than in one shared
// recipe. A powered machine is almost purely tonal — see HUM — and it does not
// move, so it needs its own distance law as well as its own timbre. See
// humLevel() on why borrowing the roar's would look like it worked.
//
// Deliberately free of any `three` import and of any Web Audio call, for the
// same reason ./resolve.ts is free of three: it is what makes the arithmetic
// below reachable from a test. jsdom has no AudioContext, so anything touching
// one can only be tested against a stand-in, and a test of a stand-in proves the
// stand-in works. The curves are the part with decisions in them, so they live
// where those decisions can be checked.

import { TONE_ARC } from './config';

/** One band of the roar: a filter, where it sits as a multiple of the module's
 *  own frequency, and how much of the mix it takes. */
export interface Band {
  type: BiquadFilterType;
  mul: number;
  q: number;
  gain: number;
}

/**
 * The three bands, and the one thing that is easy to get wrong about them.
 *
 * These gains are weighted for **bandwidth**, not for how loud each band sounds
 * on its own, because white noise delivers power in proportion to the width of
 * the window you open on it. A lowpass at 86 Hz passes about 0.4% of the noise's
 * power; a highpass at 2 kHz passes about 90% of it. Give those two the same
 * gain and the top band arrives some two hundred times stronger — the result is
 * static with a hint of rumble underneath, which is the opposite of a launch.
 *
 * Hence the very small top-band gain, and hence a bandpass up there rather than
 * a highpass: a highpass hands over everything to Nyquist, which is both
 * unbounded and untrue to a real exhaust, whose high end rolls off.
 */
export const BANDS: readonly Band[] = [
  // The rumble. Nearly all of a launch's energy is down here, and it is what
  // makes the near pass felt rather than merely heard.
  { type: 'lowpass', mul: 1, q: 1.1, gain: 1 },
  // The body of the roar. The band that actually carries on speakers which
  // cannot reproduce the rumble at all, which is most of them.
  { type: 'bandpass', mul: 4, q: 0.6, gain: 0.35 },
  // Exhaust crackle. A trace, and the first thing distance takes away — the
  // master lowpass in FILTER sweeps right across it.
  { type: 'bandpass', mul: 24, q: 0.7, gain: 0.04 },
];

/** RMS the band mix is driven to before the saturator.
 *
 *  It matters that this is a real number and not 1. The bands together pass a
 *  small fraction of the noise's power, so left alone the mix arrives at a tenth
 *  of full scale, tanh runs in its linear region and the saturator is a straight
 *  wire — no compression, no character. At 0.6 the peaks of noise, three or four
 *  times its RMS, sit well into the soft clip, and that is where the squashed
 *  roar of a launch actually comes from. */
export const DRIVE_RMS = 0.6;

/** How much of white noise's power a band passes, as a fraction. Crude by
 *  design: a biquad is not a brick wall, but the ratios are what matter here and
 *  they are right to well within what an ear would notice. */
function passband(band: Band, hz: number, nyquist: number): number {
  const centre = hz * band.mul;
  if (band.type === 'lowpass') {
    return clamp01(centre / nyquist);
  }
  if (band.type === 'highpass') {
    return clamp01((nyquist - centre) / nyquist);
  }
  return clamp01(centre / band.q / nyquist);
}

/**
 * Make-up gain for the band mix, so the saturator is driven the same however low
 * the module is pitched.
 *
 * Needs the sample rate, which is why it takes one rather than being a constant:
 * the same bands pass twice the fraction of the power at 22 kHz that they do at
 * 44. Bands sum in power rather than amplitude — three filters on one noise
 * source, but in windows far enough apart to be effectively uncorrelated.
 */
export function mixGain(hz: number, nyquist: number): number {
  const power = BANDS.reduce((sum, b) => sum + b.gain * b.gain * passband(b, hz, nyquist), 0);
  if (power < ROAR.epsilon) {
    return 0;
  }
  return DRIVE_RMS / Math.sqrt(power);
}

/**
 * The irregular swell of combustion.
 *
 * Three modulators at rates with no short common multiple: summed they wander
 * for minutes before repeating. Sines rather than band-limited noise, which
 * would be the more authentic source, because their depth is exactly known —
 * noise through a sub-10 Hz filter keeps an unpredictable fraction of its
 * amplitude, and the failure mode is a roar that quietly modulates itself down
 * to nothing.
 */
export const CHURN: readonly { hz: number; depth: number }[] = [
  { hz: 0.37, depth: 0.2 },
  { hz: 0.61, depth: 0.13 },
  // 1.31 and not 1.13: the latter lands within 2% of three times 0.37, which is
  // close enough to lock into an audible pulse. The ratio test in the spec is
  // what caught it.
  { hz: 1.31, depth: 0.09 },
];

/** The soft clip, which is both the timbre and the peak limiter. */
export const SATURATE = {
  /** tanh drive. Higher is dirtier and more compressed. */
  drive: 2.4,
  /** Samples in the transfer curve. */
  steps: 1024,
} as const;

/** Seconds of white noise to loop. Long enough that the seam is not a rhythm,
 *  short enough to be cheap: one buffer is shared by every voice. */
export const NOISE_SECONDS = 2;

/** The master lowpass the distance curve sweeps, and a highpass that never
 *  moves. Sub-25 Hz content is inaudible, eats headroom and rattles small
 *  drivers, so it is removed once rather than managed. */
export const FILTER = {
  low: { min: 120, max: 5200, q: 0.7, bias: 0.45 },
  high: { hz: 25, q: 0.7 },
} as const;

export const ROAR = {
  /** Exponent on nearness. Above 1 the approach blooms late instead of fading in
   *  evenly, which is the difference between reading as immense and reading as
   *  merely louder. */
  falloff: 3.2,
  /** Where the absolute-distance fade starts to bite, in world units, and how
   *  hard it bites. Nearness on its own is scale-free, so without this the roar
   *  would be as loud viewed from a mile out as from arm's length. The knee sits
   *  well outside the default framing, so ordinary use never reaches it. */
  knee: 16,
  kneeExp: 1.2,
  /** Hard ceiling on output amplitude; a module's own level is a fraction of it.
   *  There is no mute control, so the loudest this can ever get is a decision
   *  worth making once, here rather than per module.
   *
   *  The saturator upstream bounds its own output to ±1, so unlike an oscillator
   *  stack this figure is the peak amplitude exactly, with no summing headroom to
   *  reserve. Broadband noise also reads as considerably louder than a sine at
   *  the same peak, so 0.6 is a long way from timid. */
  ceiling: 0.6,
  /** Seconds to open on arming, and to close on teardown. */
  fadeIn: 1,
  fadeOut: 0.25,
  /** Per-frame writes are throttled to this interval, in seconds, and glide with
   *  these time constants. An envelope whose fastest motion is measured in
   *  seconds has no use for sixty automation events a second, and every one of
   *  them is an event left on the parameter's timeline. */
  interval: 0.05,
  glide: { level: 0.09, cutoff: 0.14 },
  epsilon: 1e-4,
} as const;

/** One partial of the hum: waveform, frequency as a multiple of mains, a detune
 *  in cents, and a gain relative to the loudest partial. */
export interface Overtone {
  wave: OscillatorType;
  mul: number;
  cents: number;
  gain: number;
}

/**
 * The mainframe's hum.
 *
 * THE EVEN HARMONICS CARRY IT, and that is the whole design. Magnetostriction
 * flexes a transformer core twice per AC cycle, so mains hum is loudest at twice
 * the mains frequency — 120 Hz here — with 240 Hz next and the 60 Hz fundamental
 * sitting underneath them both. Built fundamental-first it stops sounding like
 * equipment and starts sounding like a test tone.
 *
 * THE GAINS ARE NOT THE TRANSFORMER'S. A stack weighted purely by physics puts
 * its loudest partial at 120 Hz, where the ear is some 17 dB less sensitive than
 * at 1 kHz and where most laptop speakers have already rolled off. Measured
 * against A-weighting, the honest version landed 20 dB under the roar: not the
 * quiet bed it was meant to be, just inaudible. So real weight is moved up into
 * 240 and 360, and a ×8 partial is here purely so something survives on a
 * machine with no bass at all — while ×2 stays the loudest, because that part is
 * true and it is what the thing sounds like.
 */
export const HUM = {
  /** 60 for North America, 50 for most of the rest of the world. Audibly
   *  different, hence one number rather than frequencies written out. */
  mains: 60,
  partials: [
    { wave: 'sine', mul: 1, cents: 0, gain: 0.4 },
    { wave: 'sine', mul: 2, cents: 0, gain: 1 },
    // Five cents off its twin. THIS IS WHAT MAKES THE HUM BREATHE, and it does
    // it far harder than any modulator would: the pair's envelope swings between
    // |1 − 0.4| and |1 + 0.4|, which is about 4 dB of movement across the whole
    // stack on a 2.9-second cycle. An earlier draft also carried a 0.083 Hz
    // wander LFO at depth 0.04 — 0.7 dB peak to peak, below the threshold for
    // hearing amplitude modulation that slow, against a beat already six times
    // larger in the same dimension. It was two nodes doing nothing and is gone.
    { wave: 'sine', mul: 2, cents: 5, gain: 0.4 },
    { wave: 'sine', mul: 4, cents: 0, gain: 0.55 },
    { wave: 'triangle', mul: 6, cents: 0, gain: 0.3 },
    { wave: 'sine', mul: 8, cents: 0, gain: 0.14 },
  ] as readonly Overtone[],
  /** Distance at which the hum is already as loud as it gets, in world units.
   *  Inside this it plateaus rather than climbing — see humLevel. */
  near: 8.5,
  /** Pure inverse-distance amplitude falloff for a point source. 1 rather than
   *  some tuned exponent because that is what the physics says and there is no
   *  reason here to argue with it. */
  falloff: 1,
  /** Peak amplitude, absolute — not a fraction of ROAR.ceiling. The two are only
   *  comparable when exactly one module is sounding at level 1, and the panel
   *  will happily voice all 26, so a figure that looked like a guaranteed ratio
   *  would be lying. Tuned against the shipped fixture: one rocket at 0.7.
   *
   *  0.30 puts the hum about 7 dB under the roar's *time-averaged* level, which
   *  is the right reference. The roar's peak happens for a few seconds out of
   *  every 67; a bed measured against that peak is a bed nobody ever hears. */
  ceiling: 0.3,
  /** Time constant — NOT a duration — for the opening ramp: 63% at this many
   *  seconds, 95% at three times it. Longer than the roar's on purpose, because
   *  this is the first thing anyone hears and a hum should arrive without
   *  announcing itself. */
  fadeIn: 2,
} as const;

/** Normalises the hum against the sum of its gains.
 *
 *  A safety bound rather than a calibration, and worth being honest about which.
 *  Web Audio oscillators all start at phase 0, and in a harmonic series that
 *  means the partials do not peak together — when the fundamental is at maximum,
 *  sin 2θ and sin 4θ are both zero. The true worst case for this stack is nearer
 *  0.8 than 1.0, so this leaves roughly 2 dB unclaimed. That is the right way
 *  round to be wrong: the bound still holds if a partial is ever added, or if
 *  some implementation stops starting at zero phase. */
export const HUM_MIX = 1 / HUM.partials.reduce((sum, p) => sum + p.gain, 0);

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * The tanh transfer curve for the saturator, normalised so full scale in is full
 * scale out. Pure arithmetic, so it is built here and handed to the WaveShaper.
 */
export function saturationCurve(): Float32Array<ArrayBuffer> {
  const { drive, steps } = SATURATE;
  const curve = new Float32Array(steps);
  const ceiling = Math.tanh(drive);
  for (let i = 0; i < steps; i++) {
    const x = (i / (steps - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / ceiling;
  }
  return curve;
}

/**
 * Where a strip's sound comes from, in the spinning group's own space.
 *
 * Nothing in the scene graph actually sits out at the radius: a band is an arc
 * of a cylinder whose radius lives in the geometry rather than in a transform,
 * so every mesh in a strip is at the local origin and would emit from the spin
 * axis. CylinderGeometry lays its torso vertices at x = r·sin θ, z = r·cos θ
 * measured from thetaStart, and Strip passes thetaStart 0.
 */
export function emitterOffset(radius: number, arcDeg: number): [number, number, number] {
  const theta = ((arcDeg * Math.PI) / 180) * TONE_ARC;
  return [radius * Math.sin(theta), 0, radius * Math.cos(theta)];
}

/** The absolute-distance fade: exactly 1 inside the knee, falling away outside. */
export function reach(centre: number): number {
  if (centre <= ROAR.knee) {
    return 1;
  }
  return Math.pow(ROAR.knee / centre, ROAR.kneeExp);
}

/**
 * How loud the roar should be, from 0 on the far side of its orbit to 1 at
 * closest approach.
 *
 * Normalised against the camera's own distance to the orbit centre rather than
 * against fixed world distances, and that is the point. The near and far bounds
 * travel with the camera, so the swell survives the user zooming instead of
 * going permanently silent past some hard-coded maximum, or permanently
 * full-blast inside some hard-coded minimum. No PannerNode distance model can do
 * this — see the note in ./audio.ts on why the panner is left at unity gain.
 *
 * The bounds are `centre ± radius`, which brackets the true extrema rather than
 * hitting them: they ignore the emitter's height offset, so at the default
 * framing the peak lands near 0.93 instead of 1. That is deliberate. The bound
 * is monotone, costs two additions, and needs to know nothing about the scene
 * hierarchy or how tall the strip sits.
 *
 * `centre` is clamped to `radius` so the camera can be flown inside the ring.
 * Unclamped, the near bound goes negative and the middle of the orbit — where a
 * steady roar is the only sensible answer — comes out silent.
 */
export function roarLevel(distance: number, centre: number, radius: number): number {
  const r = Math.max(radius, ROAR.epsilon);
  const c = Math.max(centre, r);
  const t = (distance - (c - r)) / (2 * r);
  return Math.pow(1 - clamp01(t), ROAR.falloff) * reach(c);
}

/**
 * A module's peak amplitude: its own share of the one global ceiling.
 *
 * Lives here rather than inline in ../audio.ts because two callers now need it —
 * `roar` when it builds a voice and `setLevel` when it retunes one — and the two
 * disagreeing would mean a retuned voice landing at a different loudness from a
 * freshly built one at the same level. It is also the only part of `setLevel`
 * that can be tested honestly: jsdom has no AudioContext, so everything the
 * other side of that boundary is only reachable behind a stand-in.
 */
export function roarCeiling(level: number): number {
  return clamp01(level) * ROAR.ceiling;
}

/**
 * The master lowpass cutoff for a given level, interpolated in log frequency.
 *
 * Cutoffs are heard geometrically, not arithmetically: halfway between 120 Hz
 * and 5200 Hz sounds like 790 Hz, not 2660 Hz. Interpolating linearly in Hz
 * spends most of the sweep up where nothing is changing audibly.
 *
 * This is the air-absorption cue, and on a launch it is doing more work than the
 * level is. Far off, everything above the rumble is gone and it is a low
 * geological grumble; close up the whole crackle band arrives at once.
 */
export function roarCutoff(level: number): number {
  const { min, max, bias } = FILTER.low;
  return min * Math.pow(max / min, Math.pow(clamp01(level), bias));
}

/**
 * How loud the mainframe hum should be with the camera this far from it.
 *
 * The same shape as reach() above, with its own constants — a plateau out to
 * HUM.near and an inverse-distance falloff past it. Kept as a sibling rather
 * than by parameterising reach(), whose doc-comment is specifically about the
 * roar's normalisation and would have to get vaguer to save three lines.
 *
 * The plateau is load-bearing in two ways. It is physically right: a transformer
 * at two metres and at one metre sound about the same, because you are inside its
 * near field, and distance *away* is what kills a hum rather than closeness
 * amplifying it. And it makes the maximum structurally 1, so HUM.ceiling is a
 * real peak instead of a nominal one. An earlier draft grew past 1 and clamped at
 * 1.5 instead; that clamp engaged at 6.1 units, while the camera is still outside
 * a model 3.6 units in radius, so most of the zoom-in range was a dead control
 * that only cost headroom.
 *
 * Deliberately **not** roarLevel(). That normalises against the orbit radius,
 * which is what lets a strip's swell survive a zoom — and exactly what makes it
 * useless here, because a thing bolted to the centre of the scene has no orbit
 * and no radius. Fed radius 0 it returns 0.1088 at every camera distance inside
 * ROAR.knee, to within float noise: it would look like it worked and respond to
 * nothing but the far field.
 */
export function humLevel(distance: number): number {
  if (distance <= HUM.near) {
    return 1;
  }
  return Math.pow(HUM.near / distance, HUM.falloff);
}
