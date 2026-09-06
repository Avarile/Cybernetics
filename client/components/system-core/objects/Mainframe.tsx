// The mainframe itself: the central column, and the two rings marking the
// extent of the stack that turns inside it.
//
// Static furniture — nothing here changes once built, which is why it is the
// one object in the scene with no per-frame work and no per-module anything.
// Its hum is a sibling in the stack rather than a child here, so that stays true
// — see Hum.tsx.
//
// The reference also built a containment shell here and then stopped adding it
// to the group ("due to I dont like it"). It is left out rather than carried
// over commented, since nothing references it.

import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { MAINFRAME } from '../scene/config';
import { MAINFRAME as COLORS } from '../scene/palette';

const CAPS = [
  { y: MAINFRAME.capY, name: 'cap-top' },
  { y: -MAINFRAME.capY, name: 'cap-base' },
] as const;

export default function Mainframe() {
  // One material across the spine and both rings. Passed by prop rather than
  // declared as a child element, so R3F treats it as borrowed and never
  // disposes it out from under the other two meshes — this component owns the
  // lifetime instead.
  const spineMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        name: 'spine',
        color: COLORS.spineColor,
        emissive: COLORS.spineEmissive,
        emissiveIntensity: COLORS.spineEmissiveIntensity,
        roughness: COLORS.spineRoughness,
        metalness: COLORS.spineMetalness,
      }),
    [],
  );

  useEffect(() => () => spineMat.dispose(), [spineMat]);

  return (
    <group name="mainframe">
      {/* <mesh name="mainframe-spine" material={spineMat}>
        <cylinderGeometry
          args={[MAINFRAME.spineRadius, MAINFRAME.spineRadius, MAINFRAME.spineHeight, 20]}
        />
      </mesh> */}
      {CAPS.map((cap) => (
        <mesh
          key={cap.name}
          name={cap.name}
          material={spineMat}
          position-y={cap.y}
          rotation-x={Math.PI / 2}
        >
          <torusGeometry args={[MAINFRAME.shellRadius, MAINFRAME.capThickness, 10, 96]} />
        </mesh>
      ))}
    </group>
  );
}
