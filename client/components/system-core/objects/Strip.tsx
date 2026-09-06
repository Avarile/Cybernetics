// One domain's strip: the light band that turns inside the mainframe, plus
// everything drawn flush with it.
//
// HOW THE SPIN SURVIVES A RE-RENDER
// ---------------------------------
// The reference implementation argued against a declarative renderer here, on
// the grounds that "a declarative renderer diffing a module list into a scene
// graph would take every strip's spin phase with it". Three rules keep that
// from happening, and all three matter:
//
//   1. `rotation.y` is never passed as a prop. React only writes props it is
//      given, so leaving it out means no re-render can reset the live angle.
//      It is set once per mount, in the callback ref below, and from then on
//      only useFrame touches it.
//   2. The parent keys strips by domain key. A health change re-renders that
//      strip with new props but does not remount it, and never touches its
//      siblings — so nothing jumps when one domain's count moves.
//   3. The live angle is parked in the parent's runtime map every frame, via a
//      ref-held callback. If a strip ever *is* remounted, it resumes from
//      there rather than snapping back to the saved phase.
//
// Per-frame values never go through React state. `onPhase` writes into a Map
// held in a ref; it does not trigger a render.
//
// Built from a plain spec rather than from a Domain: nothing here knows what a
// domain is or how health maps to colour. scene/resolve.ts does all of that and
// hands over numbers, which is what lets a strip be sized and reasoned about
// alone.
//
// DIVERGENCE FROM THE REFERENCE: the reference renders a `Contact` — a blip on
// the scanner deck tethered up to the strip — but has it commented out, while
// still threading `lane` and `scannerVisible` through to reach it. Those are
// dropped here rather than carried as dead parameters. Contact.tsx is not
// ported; if the deck blips are wanted later, it comes back with its own lane
// allocation.

import { useRef, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Tone from './Tone';
import { SPIN } from '../scene/palette';
import { SOFT, LABEL_H, LABEL_FILL, LABEL_LEAD, MAX_DELTA } from '../scene/config';
import type { LabelFactory } from '../scene/labels';
import type { ModuleMaterials } from '../scene/materials';
import type { ToneBus } from '../scene/audio';
import type { StripSpec } from '../scene/resolve';

interface StripProps {
  spec: StripSpec;
  mats: ModuleMaterials;
  labels: LabelFactory;
  /** null when the scene is making no sound: reduced motion, sound switched
   *  off, or a browser that refused us an AudioContext. */
  bus: ToneBus | null;
  picked: boolean;
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
    group.rotation.y += rate * Math.min(delta, MAX_DELTA);
    onPhase(id, group.rotation.y);
  });

  const arc = THREE.MathUtils.degToRad(spec.arcDeg);
  const seg = Math.max(24, Math.round(spec.arcDeg / 3));

  // Text printed on the band: a cylinder slice on the same axis, a hair outside
  // the band's own radius. The cylinder's UVs run along the arc, so the texture
  // wraps with the curve instead of hovering flat in front of it.
  const label = useMemo(() => {
    if (spec.label == null) {
      return null;
    }
    const material = labels.get(spec.label);
    // Clear of the band by enough that depth testing never nibbles the text.
    const lr = radius + 0.014;
    let lh = Math.min(LABEL_H, h * LABEL_FILL) * spec.labelScale;
    let lTheta = (lh * (material.userData.aspect as number)) / lr;
    // Set flush to the arc's leading edge, one lead in. The tail keeps a
    // matching gap, so a name that fills its strip still stops short of both
    // edges rather than running off one of them.
    const lead = arc * LABEL_LEAD;
    // Long name on a short arc: scale the label down rather than squash it.
    const fit = arc * (1 - 2 * LABEL_LEAD);
    if (lTheta > fit) {
      lh *= fit / lTheta;
      lTheta = fit;
    }
    return { material, lr, lh, lTheta, lead };
  }, [labels, spec.label, spec.labelScale, radius, h, arc]);

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

      {/* The three soft layers are optional per strip: a dense stack reads
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

      {label && (
        <mesh name={`${id}-label`} material={label.material} renderOrder={10}>
          <cylinderGeometry
            args={[
              label.lr,
              label.lr,
              label.lh,
              Math.max(12, Math.round(label.lTheta * 48)),
              1,
              true,
              label.lead,
              label.lTheta,
            ]}
          />
        </mesh>
      )}

      {/* Selection overlay: a brighter twin of the band, hidden until picked. */}
      <mesh name={`${id}-select`} material={mats.hot} visible={picked}>
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
    </group>
  );
}
