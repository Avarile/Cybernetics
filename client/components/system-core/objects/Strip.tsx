// One module's strip: the light band that turns inside the mainframe, plus
// everything drawn flush with it, plus its contact down on the scanner deck.
//
// HOW THE SPIN SURVIVES AN EDIT
// -----------------------------
// The reference implementation argued against a declarative renderer here, on
// the grounds that "a declarative renderer diffing a module list into a scene
// graph would take every strip's spin phase with it". Three rules keep that
// from happening, and all three matter:
//
//   1. `rotation.y` is never passed as a prop. React only writes props it is
//      given, so leaving it out means no re-render can reset the live angle.
//      It is set once per mount, in the callback ref below, and from then on
//      only useFrame touches it.
//   2. The parent keys strips by module id. Editing one module re-renders its
//      strip with new props but does not remount it, and never touches its
//      siblings — so nothing jumps.
//   3. The live angle is parked in the parent's runtime map every frame, via a
//      ref-held callback. If a strip ever *is* remounted, it resumes from
//      there rather than snapping back to the saved phase.
//
// Per-frame values never go through React state. `onPhase` writes into a Map
// held in a ref; it does not trigger a render.
//
// Built from a plain spec rather than from a Module: nothing here knows the
// module schema or the status table. The scene resolves all of that and hands
// over numbers, which is what lets a strip be sized and reasoned about alone.

import { useRef, useMemo, useEffect, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Tone from './Tone';
// Kept for the deliberately-dormant <Contact> block at the bottom of this file.
// Deleting it would turn restoring that block from "uncomment three lines" into a
// small archaeology exercise.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import Contact from './Contact';
import { SPIN } from '../scene/palette';
import { bandLayout } from '../scene/layout';
import { SOFT, LABEL_H, LABEL_FILL, MAX_DELTA } from '../scene/config';
import type { LabelFactory } from '../scene/labels';
import type { ModuleMaterials } from '../scene/materials';
import type { ToneBus } from '../scene/audio';

export interface StripSpec {
  /** Names every mesh in the strip. Identity, not display text. */
  id: string;
  radius: number;
  /** Height in the stack. */
  y: number;
  /** Arc length, in degrees. */
  arcDeg: number;
  /** Band height. */
  band: number;
  visible: boolean;
  glow: boolean;
  halo: boolean;
  trail: boolean;
  /** Text printed on the band; null draws no label at all. */
  label: string | null;
  labelScale: number;
  /**
   * The scrolling readout: every resolved reading, quantised and separated.
   *
   * null draws no readout — nothing resolved, or the poll is off. It is also
   * ignored under reduced motion, where there is no frame loop to scroll it and
   * a string frozen mid-loop would read as broken text rather than as a still.
   */
  ticker: string | null;
  /** Revolutions per second, before SPIN scales it. */
  speed: number;
  /** Drone fundamental in Hz; null makes no sound at all. */
  tone: number | null;
  /** Share of the global ceiling this module's drone may use, 0 to 1. */
  toneLevel: number;
  /** Which ring of the scanner deck this module's contact stands on. */
  lane: number;
  selectable: boolean;
}

interface StripProps {
  spec: StripSpec;
  mats: ModuleMaterials;
  labels: LabelFactory;
  /** null when the scene is making no sound: reduced motion, or a browser that
   *  refused us an AudioContext. */
  bus: ToneBus | null;
  picked: boolean;
  /** Whether the scanner deck, and so this strip's contact, is showing. */
  scannerVisible: boolean;
  /** False under prefers-reduced-motion: the stack holds a static frame. */
  animate: boolean;
  /** Where this strip resumes from. Read once, on mount. */
  initialPhase: number;
  /** Parks the live angle so a later rebuild picks up exactly here. */
  onPhase: (id: string, phase: number) => void;
  onPick: (id: string) => void;
}

export default function Strip({
  spec,
  mats,
  labels,
  bus,
  picked,
  // Unused while <Contact> stays commented. The scanner *deck* has its own
  // `visible` binding in Scene.tsx, so the toggle still does something; this is
  // only the per-strip contact marker. Kept so Strip's contract does not change
  // when the block comes back.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scannerVisible,
  animate,
  initialPhase,
  onPhase,
  onPick,
}: StripProps) {
  const { id, radius, band: h } = spec;
  const groupRef = useRef<THREE.Group | null>(null);
  const phaseRef = useRef(initialPhase);
  const rate = spec.speed * SPIN;

  // Callback ref rather than an effect: this must run exactly once per mount,
  // and expressing that as a stable callback avoids an empty dependency array
  // that lies about what it depends on.
  const attach = useCallback((group: THREE.Group | null) => {
    groupRef.current = group;
    if (group) {
      group.rotation.y = phaseRef.current;
    }
  }, []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || !animate) {
      return;
    }
    const step = Math.min(delta, MAX_DELTA);
    group.rotation.y += rate * step;
    onPhase(id, group.rotation.y);
    // One float per strip per frame, and it allocates nothing: `offset` feeds the
    // sampler's uv transform, which the renderer re-derives each frame from
    // `matrixAutoUpdate`. No texture data is re-uploaded, so this is the same
    // cost class as the rotation above rather than a redraw.
    //
    // Clamped by the same delta for the same reason: coming back to a
    // backgrounded tab hands over one enormous frame, and text that leapt half a
    // loop would read as a glitch.
    const map = text?.readout?.material.map;
    if (map) {
      map.offset.x += (text?.readout?.slice.step ?? 0) * step;
    }
  });

  const arc = THREE.MathUtils.degToRad(spec.arcDeg);
  const seg = Math.max(24, Math.round(spec.arcDeg / 3));

  // Text on the band: cylinder slices on the same axis, a hair outside the
  // band's own radius. The cylinder's UVs run along the arc, so a texture wraps
  // with the curve instead of hovering flat in front of it — which is also what
  // lets the readout below be scrolled by sliding its `offset.x`.
  //
  // A readout is built only when the scene is animating: there is no frame loop
  // under reduced motion to move it, and a string stopped mid-loop reads as
  // broken text rather than as a still frame. The panel carries the same numbers.
  const text = useMemo(() => {
    const line = animate ? spec.ticker : null;
    // The separator belongs to the *name* texture, so the join between a fixed
    // title and a moving readout needs no mesh and no measurement of its own.
    const name = spec.label == null ? null : labels.get(spec.label + (line == null ? '' : ' ||'));
    const readout = line == null ? null : labels.ticker(id, line);
    if (name == null && readout == null) {
      return null;
    }
    // Clear of the band by enough that depth testing never nibbles the text.
    const lr = radius + 0.014;
    const layout = bandLayout({
      arc,
      radius: lr,
      height: Math.min(LABEL_H, h * LABEL_FILL) * spec.labelScale,
      nameAspect: name == null ? null : (name.userData.aspect as number),
      readoutAspect: readout == null ? null : (readout.userData.aspect as number),
    });
    // The window can come back null when the name leaves too little arc to read
    // through. The material is still cached and swept — it simply is not drawn.
    return {
      lr,
      name: layout.name == null || name == null ? null : { material: name, slice: layout.name },
      readout:
        layout.readout == null || readout == null
          ? null
          : { material: readout, slice: layout.readout },
    };
  }, [labels, id, spec.label, spec.ticker, spec.labelScale, animate, radius, h, arc]);

  // Where the readout has scrolled to, kept across a content swap.
  //
  // The string changes whenever a number does, which replaces the texture and
  // would otherwise restart it from zero — a visible snap three times a minute.
  // Seeding the incoming offset from the outgoing one buys continuity of motion;
  // it cannot buy continuity of content, because the string itself changed
  // length, so which reading sits under the window is not preserved.
  const scrolled = useRef(0);
  useEffect(() => {
    const readout = text?.readout;
    const map = readout?.material.map;
    if (!map) {
      return;
    }
    // In an effect rather than in the memo above: both of these mutate a cached
    // object, and a render-phase write to something the registry hands out would
    // land whether or not the render was committed.
    map.repeat.x = readout.slice.repeat;
    map.offset.x = scrolled.current % 1;
    return () => {
      scrolled.current = map.offset.x;
    };
  }, [text]);

  // R3F reports how far the pointer travelled between down and up, which is how
  // a click on a band is told apart from an orbit drag that happened to end on
  // one.
  const handleClick = useCallback(
    (event: { delta: number; stopPropagation: () => void }) => {
      if (event.delta > 3 || !spec.selectable) {
        return;
      }
      event.stopPropagation();
      onPick(id);
    },
    [id, onPick, spec.selectable],
  );

  return (
    <group ref={attach} name={id} position-y={spec.y} visible={spec.visible}>
      <mesh name={`${id}-band`} material={mats.band} onClick={handleClick}>
        <cylinderGeometry args={[radius, radius, h, seg, 1, true, 0, arc]} />
      </mesh>

      {/* The three soft layers are optional per module: a dense stack reads
          better with some of them off, and they are the cheapest thing to
          drop. */}
      {spec.glow && (
        <mesh name={`${id}-glow`} material={mats.glow}>
          <cylinderGeometry
            args={[
              radius + SOFT.glow.r,
              radius + SOFT.glow.r,
              h * SOFT.glow.h,
              seg,
              1,
              true,
              -SOFT.glow.pad,
              arc + SOFT.glow.pad * 2,
            ]}
          />
        </mesh>
      )}

      {spec.halo && (
        <mesh name={`${id}-halo`} material={mats.halo}>
          <cylinderGeometry
            args={[
              radius + SOFT.halo.r,
              radius + SOFT.halo.r,
              h * SOFT.halo.h,
              seg,
              1,
              true,
              -SOFT.halo.pad,
              arc + SOFT.halo.pad * 2,
            ]}
          />
        </mesh>
      )}

      {/* Trailing light streak: a thinner, dimmer continuation of the arc. */}
      {spec.trail && (
        <mesh name={`${id}-trail`} material={mats.glow}>
          <cylinderGeometry
            args={[radius, radius, h * 0.34, seg, 1, true, arc, Math.min(arc * 0.8, 2.4)]}
          />
        </mesh>
      )}

      {text?.name && (
        <mesh name={`${id}-label`} material={text.name.material} renderOrder={10}>
          <cylinderGeometry
            args={[
              text.lr,
              text.lr,
              text.name.slice.height,
              Math.max(12, Math.round(text.name.slice.theta * 48)),
              1,
              true,
              text.name.slice.start,
              text.name.slice.theta,
            ]}
          />
        </mesh>
      )}

      {/* The readout: a window onto a tiling texture, scrolled by useFrame above.
          Its arc does not change between polls, so this geometry is built once
          and only the material swaps when the numbers move. */}
      {text?.readout && (
        <mesh name={`${id}-readout`} material={text.readout.material} renderOrder={10}>
          <cylinderGeometry
            args={[
              text.lr,
              text.lr,
              text.readout.slice.height,
              Math.max(12, Math.round(text.readout.slice.theta * 48)),
              1,
              true,
              text.readout.slice.start,
              text.readout.slice.theta,
            ]}
          />
        </mesh>
      )}

      {/* The emphasis overlay: a brighter twin of the band, and the resting
          appearance of every strip rather than a selection state.
          `hot` and `mark` share one recipe, so this mesh looks the same either
          way — what marks the picked strip is that `mark` is the only kind
          MaterialRegistry.pulse() animates. Motion is the selection signal. */}
      <mesh name={`${id}-select`} material={picked ? mats.mark : mats.hot}>
        <cylinderGeometry
          args={[radius + 0.006, radius + 0.006, h * 1.45, seg, 1, true, -0.015, arc + 0.03]}
        />
      </mesh>

      {/* Hidden means hidden: a strip nobody can see should not be heard
          either, and hanging the check here rather than inside Tone means the
          voice is released instead of left running behind an invisible band. */}
      {bus && spec.tone != null && spec.visible && (
        <Tone
          bus={bus}
          hz={spec.tone}
          level={spec.toneLevel}
          radius={radius}
          arcDeg={spec.arcDeg}
        />
      )}

      {/* Deliberately dormant, not a TODO. Contacts stay off by choice, so the
          scanner deck shows its grid and no markers.

          Two knock-on effects are expected rather than bugs: `spec.lane` drives
          nothing visible, and the overflow ring that useModules assigns to a
          discovered module is computed and tested but never drawn. Both are
          correct and inert; restoring them is uncommenting this block, then
          checking Contact.tsx's distance formula against SCANNER.rings.

      <Contact
        spec={{ id, radius, y: spec.y, lane: spec.lane }}
        mats={mats}
        visible={scannerVisible}
        picked={picked}
      /> */}
    </group>
  );
}
