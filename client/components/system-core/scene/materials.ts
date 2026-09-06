// The scene's module materials: how they look, and who shares which.
//
// Shared by appearance rather than by module. Two modules with the same status
// and no overrides get one material between them, so the common case still
// costs one of each kind; a per-module colour or opacity gets its own entry,
// keyed by the values that produced it. With 25 modules at up to six meshes
// each that sharing is the difference between five materials and a hundred.
//
// Everything is registered in one map because the selection dimming pass has to
// reach every always-on material, and with overrides in play there is no longer
// a fixed set of four to reach for. That is also why there is exactly one
// registry per scene: an object handed its own copy would be invisible to the
// pass, and would light up while the rest of the stack dimmed around it.
//
// Plain class rather than React state on purpose — these are mutated per frame
// by the pulse and the dimming pass, which must never go through a re-render.

import * as THREE from 'three';
import logger from '@/components/system-core/shims/logger';

export type MatKind = 'band' | 'glow' | 'halo' | 'hot' | 'mark';

/** The materials one module renders with. */
export interface ModuleMaterials {
  band: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  halo: THREE.MeshStandardMaterial;
  hot: THREE.MeshStandardMaterial;
  mark: THREE.MeshStandardMaterial;
}

/**
 * The resting appearance both overlays share.
 *
 * WHY THE PULSE IS ON OPACITY AND NOT ON emissiveIntensity
 * -------------------------------------------------------
 * R3F applies `ACESFilmicToneMapping` unless the Canvas passes `flat`, and ours
 * does not (see Scene.tsx). Tone mapping runs in the fragment shader *before* the
 * additive blend; `opacity` is the blend factor applied *after* it. So the two
 * knobs are not interchangeable:
 *
 *   emissiveIntensity  saturates hard past ~1.5 and has almost no authority at
 *                      3.2. Swinging it 3.2 -> 5.0 moves the light actually added
 *                      by about 4% — and by a different 4% per colour, because
 *                      where a channel clips depends on the hue. A pulse written
 *                      this way is invisible on white and obvious on red.
 *   opacity            multiplies the added light linearly, identically for every
 *                      colour. Full authority.
 *
 * So the pulse is an opacity swing, and the ratio it produces is exact and
 * colour-independent: 1.00 / 0.85 = 1.176x on every status in the palette.
 */
const EMPHASIS_EMISSIVE = 3.2;
const EMPHASIS_OPACITY = 0.85;
/**
 * How far above the resting opacity the pulse reaches.
 *
 * 0.15 takes it to exactly 1.0, which is the ceiling — added light is clamped per
 * channel, and the resting overlay already spends most of the budget. There is no
 * more swing to be had here without lowering `EMPHASIS_OPACITY`, which would
 * change how the scene looks at rest.
 */
const PULSE_GAIN = 0.15;
/**
 * Pulse angular frequency, in radians per millisecond: a 2.6-second breath.
 *
 * The old rate was 0.005 — a 1.26s cycle — tuned when the pulse was the whole
 * scene throbbing. On a single bright ring that reads as a fault blinker, which
 * collides with what `fault` already means in this palette. A slower cycle also
 * gives a modest swing the dwell time it needs to register as breathing rather
 * than as flicker.
 */
const PULSE_W = 0.0024;

const MAT_KINDS: Record<
  MatKind,
  (c: number, o: number | null, gain: number) => THREE.MeshStandardMaterialParameters
> = {
  band: (c, o, gain) => ({
    color: 0x0a0a0a,
    emissive: c,
    emissiveIntensity: 1.9 * gain,
    roughness: 0.5,
    metalness: 0.0,
    side: THREE.DoubleSide,
    // Left opaque unless asked otherwise: transparency costs a sorting pass.
    transparent: o != null,
    opacity: o == null ? 1 : o,
  }),
  glow: (c, o) => ({
    color: 0x000000,
    emissive: c,
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: (o == null ? 1 : o) * 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }),
  halo: (c, o) => ({
    color: 0x000000,
    emissive: c,
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: (o == null ? 1 : o) * 0.055,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }),
  // THE TWO EMPHASIS OVERLAYS, WHICH DIFFER ONLY IN WHETHER THEY MOVE
  // -----------------------------------------------------------------
  // `hot` is how a strip looks normally — this used to be the selection
  // treatment, and it is now the resting appearance of every strip in the scene.
  // `mark` is the picked one. Their recipes are deliberately identical, because
  // motion is the whole of the difference: `pulse()` drives `mark` upward from
  // this shared base, so a selected strip is never dimmer than its neighbours,
  // only livelier.
  //
  // Both stay out of the dimming pass below: they are the thing being emphasised,
  // so dimming them along with the rest would defeat them.
  hot: (c) => ({
    color: 0x000000,
    emissive: c,
    emissiveIntensity: EMPHASIS_EMISSIVE,
    transparent: true,
    opacity: EMPHASIS_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }),
  mark: (c) => ({
    color: 0x000000,
    emissive: c,
    emissiveIntensity: EMPHASIS_EMISSIVE,
    transparent: true,
    opacity: EMPHASIS_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }),
};

/**
 * `hot` is in here; `mark` is not. That asymmetry is the selection signal.
 *
 * `hot` was excluded while `pulse()` owned its opacity — two writers on one
 * property. The pulse now touches only `mark`, so the conflict is gone and the
 * dimming pass can do something useful again. Without `hot` in the set the pass
 * had become decorative: every strip carries the overlay now, so dimming only the
 * base layers drops all 28 identically and produces no picked-vs-unpicked
 * difference at all — just a global flinch on every click.
 *
 * With it, an unselected overlay drops to 55% while the picked one holds full, a
 * ~2x separation. That matters because it is the only cue legible in a *still*
 * frame: at the trough of its cycle `mark` is pixel-identical to `hot` by
 * construction, so the pulse alone cannot say which strip is selected.
 */
const DIMMABLE = new Set<MatKind>(['band', 'glow', 'halo', 'hot']);

/** How far the always-on materials drop while something is picked. */
const DIM = 0.55;

/**
 * When the registry is bigger than this, something is feeding it a continuous
 * value.
 *
 * The registry is keyed by appearance, so its size is bounded by the number of
 * *distinct* appearances the scene can ask for — five statuses plus per-module
 * overrides, times five kinds. A few hundred is generous for a hand-authored
 * arrangement. A number that keeps climbing past it means a channel with an
 * unbounded codomain reached get(), which is the one thing the binding layer
 * promises never to do (see live/bind.ts). Warned rather than thrown: a noisy
 * scene is better than a blank one.
 */
export const MAX_MATERIALS = 192;

export class MaterialRegistry {
  private readonly reg = new Map<string, THREE.MeshStandardMaterial>();

  /** The build currently being resolved. Bumped by sweep(). */
  private gen = 0;

  /** How many materials are held. For the leak test, and for the size warning. */
  get size(): number {
    return this.reg.size;
  }

  /** One material of one kind, made once and shared from then on. */
  get(
    kind: MatKind,
    colorHex: number,
    opacity: number | null,
    gain: number,
  ): THREE.MeshStandardMaterial {
    const key = kind + '|' + colorHex + '|' + (opacity == null ? 'auto' : opacity) + '|' + gain;
    const found = this.reg.get(key);
    if (found) {
      // Stamped on the hit, not just on the miss: a material still in use has
      // to look used, or the next sweep would dispose it out from under a mesh.
      found.userData.gen = this.gen;
      return found;
    }
    const mat = new THREE.MeshStandardMaterial(MAT_KINDS[kind](colorHex, opacity, gain));
    mat.name = kind + '-' + colorHex.toString(16).padStart(6, '0');
    // The dimming pass scales from this, so it has to be remembered before
    // anything touches emissiveIntensity.
    mat.userData.kind = kind;
    mat.userData.baseEmissive = mat.emissiveIntensity;
    mat.userData.baseOpacity = mat.transparent ? mat.opacity : null;
    mat.userData.dimmable = DIMMABLE.has(kind);
    mat.userData.gen = this.gen;
    this.reg.set(key, mat);
    return mat;
  }

  /** Every material one module needs, resolved once per build. Only the band
   *  carries the per-status gain, so the others key on 1 and stay shared. */
  forModule(colorHex: number, opacity: number | null, gain: number): ModuleMaterials {
    return {
      band: this.get('band', colorHex, opacity, gain),
      glow: this.get('glow', colorHex, opacity, 1),
      halo: this.get('halo', colorHex, opacity, 1),
      hot: this.get('hot', colorHex, null, 1),
      mark: this.get('mark', colorHex, null, 1),
    };
  }

  /** Dim the always-on materials while something is picked, so the emphasis
   *  overlays carry the eye. This is a global pass, not a per-module one — the
   *  registry is keyed by appearance and shared, so it cannot single one strip
   *  out; what it does is drop the background so the overlays read louder.
   *  Driven off each material's own recorded base rather than recomputed
   *  constants, since a per-module colour override means there is no fixed set of
   *  materials to enumerate. */
  setDimmed(on: boolean): void {
    const k = on ? DIM : 1;
    for (const mat of this.reg.values()) {
      if (mat.userData.dimmable !== true) {
        continue;
      }
      mat.emissiveIntensity = (mat.userData.baseEmissive as number) * k;
      if (mat.userData.baseOpacity != null) {
        mat.opacity = (mat.userData.baseOpacity as number) * k;
      }
    }
  }

  /**
   * The selection pulse: `mark` and nothing else.
   *
   * `hot` is deliberately untouched. It is the resting appearance of every
   * unselected strip, and because the registry is keyed by appearance rather than
   * by module, animating it here would make the entire stack breathe in lockstep
   * the moment anything was selected — the steady default would survive exactly
   * until the first click.
   *
   * Walking the registry rather than taking a module is what keeps the cost
   * independent of how many strips are on screen. It also means every *selected*
   * strip would pulse in step, which is fine: there is only ever one.
   */
  pulse(now: number): void {
    const p = 0.5 + 0.5 * Math.sin(now * PULSE_W);
    for (const mat of this.reg.values()) {
      if (mat.userData.kind === 'mark') {
        mat.opacity = EMPHASIS_OPACITY + PULSE_GAIN * p;
      }
    }
  }

  /**
   * Releases materials nothing has asked for lately, and opens a new generation.
   *
   * Must be called *after* a build has been committed, never during render and
   * never per frame — a disposed material still referenced by a live mesh
   * renders black, so the disposal has to trail the render that stopped using
   * it.
   *
   * Two generations of grace rather than one: a value that vanishes for a single
   * build and comes back must not pay to be rebuilt, and with a poll driving the
   * scene that happens whenever a sample is briefly missing.
   *
   * With a hand-authored arrangement this frees nothing, which is correct — the
   * whole point is that the steady state is already bounded. It exists so that a
   * future binding with a wider codomain degrades into churn instead of a leak.
   */
  sweep(): void {
    const floor = this.gen - 1;
    for (const [key, mat] of this.reg) {
      if ((mat.userData.gen as number) >= floor) {
        continue;
      }
      mat.dispose();
      this.reg.delete(key);
    }
    this.gen += 1;
    if (this.reg.size > MAX_MATERIALS) {
      logger.warn(
        'system_core',
        `material registry holds ${this.reg.size} entries (cap ${MAX_MATERIALS}); ` +
          'a channel with an unbounded codomain is probably bound to a material',
      );
    }
  }

  dispose(): void {
    for (const mat of this.reg.values()) {
      mat.dispose();
    }
    this.reg.clear();
  }
}
