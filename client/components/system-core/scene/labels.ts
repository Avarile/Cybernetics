// The names printed on the bands.
//
// Drawn to a canvas, then handed back as a material for the strip to map onto a
// slice of cylinder. A canvas texture needs no font loader and no extra
// dependency; the cost is that the type has to be laid out by hand, which is
// what most of the code below is doing.
//
// The reference hard-coded a brand face loaded from its own /public tree. This
// port reads `--theme-font-family` instead, so band names are set in whatever
// the active theme uses for UI type and no font assets have to ship. The face
// is resolved once and shared by the preload gate and the rasteriser — if those
// two disagreed, the first build would land on the fallback while the gate
// reported success.

import * as THREE from 'three';
import logger from '@/components/system-core/shims/logger';
import { LABEL_INK } from './palette';

/* All-caps and widely tracked, so a name reads as stamped onto the strip rather
 * than set on it. 400 is the one weight the gate loads; asking for another gets
 * a synthetic bolding of the nearest available file. */
const LABEL_WEIGHT = 400;

/** Canvas rasterisation size. Oversampled and heavy: at the on-screen size the
 *  glyphs land on few pixels, and thin strokes plus mipmap minification are
 *  what read as "dim". */
const LABEL_PX = 128;

const LABEL_FALLBACK = 'Inter, system-ui, sans-serif';

/** Tracking, as a fraction of the font size. */
const LABEL_TRACK = 0.18;

/** Clear space around the type, at LABEL_PX. Scales with the rasterisation. */
const LABEL_PAD = 24;

let resolvedFace: string | null = null;

/** The theme's UI face, resolved once. Read lazily rather than at module scope
 *  so the stylesheet is guaranteed to have been applied. */
function labelFace(): string {
  if (resolvedFace != null) {
    return resolvedFace;
  }
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue('--theme-font-family')
    .trim();
  resolvedFace = declared || LABEL_FALLBACK;
  return resolvedFace;
}

function labelFont(px: number = LABEL_PX): string {
  return LABEL_WEIGHT + ' ' + px + 'px ' + labelFace();
}

/**
 * Pull the face in before the first build, so labels rasterise in the theme
 * font rather than whatever the fallback happens to be. The weight must match
 * the one LabelFactory draws with — each weight is its own font file.
 */
export async function preloadLabelFont(): Promise<void> {
  try {
    await document.fonts.load(labelFont());
  } catch {
    /* the fallback face still renders; it is only less on-theme */
  }
}

/** Band text is set in caps. Done at rasterisation time only — the stored name
 *  keeps its own casing, so the panel and the module list still show what the
 *  user actually typed. */
function bandCaps(name: string): string {
  return name.toLocaleUpperCase();
}

/**
 * Separates the parts of a cache key.
 *
 * `\u0000` rather than a space because it cannot occur in any of them: it makes
 * `ticker('a', 'b c')` and `ticker('a b', 'c')` provably distinct without anyone
 * having to know what characters an id is allowed to contain.
 */
const KEY_SEP = '\u0000';

/**
 * When the cache holds more than this, something is feeding it a continuous value.
 *
 * Bounded by the number of *distinct* strings the scene can ask for: one name per
 * module plus one ticker per module, so twice the module count with a generation
 * of slack. A number that keeps climbing past it means a string with an unbounded
 * codomain reached the factory — the same failure ../live/bind.ts guards the
 * material registry against, in the cache that invariant does not cover.
 * Warned rather than thrown: a noisy scene is better than a blank one.
 */
export const MAX_LABELS = 128;

export class LabelFactory {
  private readonly cache = new Map<string, THREE.MeshBasicMaterial>();
  private readonly anisotropy: number;
  private readonly maxTextureSize: number;

  /** The build currently being resolved. Bumped by sweep(). */
  private gen = 0;

  /** Takes two numbers off the renderer rather than the renderer itself: the
   *  anisotropy the sampler may use, and the widest texture the GPU will accept.
   *  They are the only things about the hardware this needs to know. */
  constructor(anisotropy: number, maxTextureSize: number) {
    this.anisotropy = anisotropy;
    this.maxTextureSize = maxTextureSize;
  }

  /** How many materials are held. For the leak test, and for the size warning. */
  get size(): number {
    return this.cache.size;
  }

  /**
   * The fixed band name, made once per distinct string.
   *
   * Shared across modules on purpose: the codomain is the set of module names, so
   * two strips called the same thing cost one canvas between them. The aspect
   * ratio is left on `userData.aspect` — the strip sizes its label cylinder from
   * it.
   */
  get(text: string): THREE.MeshBasicMaterial {
    return this.material('name' + KEY_SEP + text, text, false);
  }

  /**
   * The scrolling readout.
   *
   * Keyed by module id as well as by text, which is the one thing that must not
   * be shared. The scroll is a per-frame write to `map.offset.x` by whichever
   * strip owns the mesh; hand two strips the same texture and it is advanced once
   * per sharer, so two modules whose readings happened to format identically
   * would both scroll at double speed. Keying by id makes that impossible rather
   * than unlikely.
   */
  ticker(id: string, text: string): THREE.MeshBasicMaterial {
    return this.material('ticker' + KEY_SEP + id + KEY_SEP + text, text, true);
  }

  private material(key: string, text: string, repeating: boolean): THREE.MeshBasicMaterial {
    const found = this.cache.get(key);
    if (found) {
      // Stamped on the hit as well as the miss: a material still in use has to
      // look used, or the next sweep would dispose it out from under a mesh.
      found.userData.gen = this.gen;
      return found;
    }
    const mat = this.rasterize(text, repeating);
    mat.userData.gen = this.gen;
    this.cache.set(key, mat);
    return mat;
  }

  /**
   * Releases materials nothing has asked for lately, and opens a generation.
   *
   * Must be called *after* a build has been committed, never during render and
   * never per frame — a disposed texture still referenced by a live mesh renders
   * blank, so the disposal has to trail the render that stopped using it.
   *
   * Two generations of grace rather than one, for the same reason
   * MaterialRegistry gives: a string that vanishes for a single build and comes
   * back must not pay to be rasterised again, and with a poll driving the scene
   * that happens whenever a sample is briefly missing.
   */
  sweep(): void {
    const floor = this.gen - 1;
    for (const [key, mat] of this.cache) {
      if ((mat.userData.gen as number) >= floor) {
        continue;
      }
      mat.map?.dispose();
      mat.dispose();
      this.cache.delete(key);
    }
    this.gen += 1;
    if (this.cache.size > MAX_LABELS) {
      logger.warn(
        'system_core',
        `label cache holds ${this.cache.size} entries (cap ${MAX_LABELS}); ` +
          'a string with an unbounded codomain is probably reaching LabelFactory',
      );
    }
  }

  /**
   * How far down the rasterisation has to be scaled to fit the GPU.
   *
   * A name is twenty-odd characters and lands around 2000px, comfortably inside
   * anything. A readout is not: six channels of "Memory used 138 MB || " runs to
   * a hundred characters, which at LABEL_PX is a canvas roughly 9500px wide, and
   * WebGL2 only guarantees 2048. Past the limit the upload fails and the band
   * renders blank — so the width has to be brought inside it here rather than
   * discovered on somebody's laptop.
   *
   * Scaling costs sharpness and nothing else: the mesh takes its world height
   * from the layout and its horizontal extent from the texture's aspect ratio,
   * and this scales the whole canvas, so the aspect — and therefore the layout —
   * is unchanged. At the band sizes in this scene the type is heavily minified
   * anyway; what a smaller canvas gives up is crispness when zoomed right in.
   *
   * There is deliberately no legibility floor here. The limit is what the driver
   * will accept and the alternative to fitting is a blank band, so it wins over
   * any preference about type size. A string long enough to scale to something
   * unreadable is not a rasteriser problem — it means too many channels are being
   * put on one strip, which is a decision made in ../live/ticker.ts.
   */
  private fitScale(naturalWidth: number): number {
    if (naturalWidth <= this.maxTextureSize) {
      return 1;
    }
    return this.maxTextureSize / naturalWidth;
  }

  private rasterize(text: string, repeating: boolean): THREE.MeshBasicMaterial {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('System Core: 2D canvas context unavailable for band labels');
    }

    // Set in caps and letter-spaced by hand. Tracking is applied between the
    // glyphs below rather than by the shaper, so the run has to be measured the
    // same way — one measureText over the whole string would come up short by
    // every gap. Splitting per code point means kerning pairs are lost, which
    // at this tracking is the intent anyway.
    const chars = [...bandCaps(text)];

    // Measured once at full size. Advances scale linearly with the font size, so
    // the fitted pass below multiplies rather than measuring again.
    ctx.font = labelFont();
    const measured = chars.map((ch) => ctx.measureText(ch).width);
    const naturalRun =
      measured.reduce((a, b) => a + b, 0) + LABEL_PX * LABEL_TRACK * Math.max(0, chars.length - 1);

    const scale = this.fitScale(Math.ceil(naturalRun) + LABEL_PAD * 2);
    const FS = LABEL_PX * scale;
    const PAD = LABEL_PAD * scale;
    const track = FS * LABEL_TRACK;
    const adv = measured.map((w) => w * scale);
    const run = naturalRun * scale;

    // Min'd rather than trusted to the scale above: that is exact in the reals,
    // and the three ceilings here can each add a pixel. Losing up to three from
    // the tail of a string that was already scaled to the limit is invisible;
    // exceeding the limit by one is a texture the driver refuses.
    canvas.width = Math.min(this.maxTextureSize, Math.max(1, Math.ceil(run) + Math.ceil(PAD) * 2));
    canvas.height = Math.max(1, Math.ceil(FS + PAD * 2));
    // Resizing the canvas resets the context, so restate the draw settings.
    ctx.font = labelFont(FS);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = LABEL_INK;

    // Drawn twice so the anti-aliased edges reach full opacity rather than
    // washing out to a half-covered grey.
    for (let pass = 0; pass < 2; pass++) {
      let x = PAD;
      for (let i = 0; i < chars.length; i++) {
        ctx.fillText(chars[i], x, canvas.height / 2);
        x += adv[i] + track;
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    // A readout tiles along its window so it can be scrolled by advancing
    // `offset.x`, which costs one uniform and rasterises nothing. A name is drawn
    // once where it sits, and must keep the default clamp or a wide arc would
    // repeat it.
    if (repeating) {
      tex.wrapS = THREE.RepeatWrapping;
    }

    // Unlit, so the name holds its own flat tone against the band's emission
    // rather than picking up scene lighting on top of it.
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    mat.name = (repeating ? 'ticker-' : 'label-') + text;
    mat.userData.aspect = canvas.width / canvas.height;
    return mat;
  }

  dispose(): void {
    for (const mat of this.cache.values()) {
      mat.map?.dispose();
      mat.dispose();
    }
    this.cache.clear();
  }
}
