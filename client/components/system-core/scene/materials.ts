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
 * The appearance the picked strip wears.
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

/** How far the resting layers sit below the emphasised ones. */
const DIM = 0.55;

/**
 * What an unselected strip's overlay rests at.
 *
 * Derived from the emphasis pair rather than written as two fresh numbers,
 * because it is not a new look: it is exactly the treatment the dimming pass used
 * to apply on selection, made permanent. It had to become permanent. `hot` and
 * `mark` shared one recipe, and the only two things that told them apart — the
 * pulse and the dimming pass — both switched on `selected != null`. So a freshly
 * opened scene, with nothing picked, drew every strip at full emphasis: the whole
 * stack wearing the selection treatment, each strip indistinguishable from a
 * picked one at the trough of its cycle. The first click was what finally dimmed
 * them, which read as the stack changing status rather than as one strip being
 * chosen.
 */
const RESTING_EMISSIVE = EMPHASIS_EMISSIVE * DIM;
const RESTING_OPACITY = EMPHASIS_OPACITY * DIM;

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
  // THE TWO OVERLAYS, AND THE GAP BETWEEN THEM
  // ------------------------------------------
  // `hot` is how a strip looks normally; `mark` is the picked one. One recipe,
  // two brightnesses, and the gap between them is fixed rather than conditional —
  // that is the whole of the selection signal in a still frame. `pulse()` then
  // drives `mark` further up from its own base, so the picked strip also
  // breathes.
  //
  // These used to be the same recipe, separated only while something was
  // selected; see RESTING_OPACITY for what that cost. Both stay out of the
  // dimming pass below: they are the thing being emphasised, so dimming them
  // along with the rest would defeat them.
  hot: (c) => ({
    color: 0x000000,
    emissive: c,
    emissiveIntensity: RESTING_EMISSIVE,
    transparent: true,
    opacity: RESTING_OPACITY,
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
 * The background layers, and neither overlay.
 *
 * `hot` was in this set, which is how the picked strip used to be told apart:
 * select something and every *other* overlay dropped to 55%. That worked, and it
 * also meant the separation existed only while a selection did — with nothing
 * picked there was no gap at all, and the resting stack was drawn at the selected
 * brightness. RESTING_OPACITY now bakes the same 55% into `hot` itself, so the
 * ~1.8x separation is there from the first frame and holds in a *still* one,
 * which the pulse alone can never manage: at its trough `mark` sits at its own
 * base, and if that base matched `hot` nothing would distinguish them.
 *
 * What is left here is the background — band, glow, halo — which still recedes on
 * selection so the overlays read louder against it.
 */
const DIMMABLE = new Set<MatKind>(['band', 'glow', 'halo']);

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

/** One material's share of the dimming pass. Driven off the material's own
 *  recorded base rather than recomputed constants, since a per-module colour
 *  override means there is no fixed set of materials to enumerate. */
function applyDim(mat: THREE.MeshStandardMaterial, k: number): void {
  if (mat.userData.dimmable !== true) {
    return;
  }
  mat.emissiveIntensity = (mat.userData.baseEmissive as number) * k;
  if (mat.userData.baseOpacity != null) {
    mat.opacity = (mat.userData.baseOpacity as number) * k;
  }
}

export class MaterialRegistry {
  private readonly reg = new Map<string, THREE.MeshStandardMaterial>();

  /** The build currently being resolved. Bumped by sweep(). */
  private gen = 0;

  /**
   * The factor setDimmed last applied.
   *
   * Held because the dimming pass walks the registry once, from an effect keyed
   * on the selection, while materials are minted lazily during render. A status
   * arriving on a poll tick while something is selected asks for a material that
   * has never been through the pass: it would be born at full strength and stay
   * there, one strip flaring brighter than its neighbours until the next time the
   * selection changed.
   */
  private dim = 1;

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
    // After the bases are recorded, so they stay the undimmed truth every later
    // pass scales from rather than compounding with whatever is in force here.
    if (this.dim !== 1) {
      applyDim(mat, this.dim);
    }
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

  /** Drop the background layers while something is picked, so the emphasis
   *  overlays read louder against them. A global pass, not a per-module one — the
   *  registry is keyed by appearance and shared, so it cannot single one strip
   *  out. The factor is kept as well as applied, so a material minted later in
   *  the same selection arrives already dimmed. */
  setDimmed(on: boolean): void {
    this.dim = on ? DIM : 1;
    for (const mat of this.reg.values()) {
      applyDim(mat, this.dim);
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
