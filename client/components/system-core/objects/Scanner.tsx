// The scanner view: a flat sensor plate pinned under the mainframe, with a
// radar sweep turning across it.
//
// The disc primitives — circles, rings, planes — are all authored facing +Z, so
// everything drawn on the deck is turned onto its back by the wrapping group's
// rotation rather than one rotation per mesh.
//
// The sweep is the only moving part, and it is rotated through a ref rather
// than a prop: a `rotation` array prop would call Euler.set() on every
// re-render and snap it back to zero.
//
// DIVERGENCE FROM THE REFERENCE: the reference has the sweep mesh commented out
// while still running its rotation every frame — the animation drives nothing.
// The sweep is restored here rather than deleted: the shell chrome exposes a
// scanner toggle, and a deck with no sweep is a grid, not a scanner. Reduced
// motion still parks it, via `animate`.

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SCANNER, MAX_DELTA } from '../scene/config';
import { SCANNER_COLORS } from '../scene/palette';

interface ScannerProps {
  /** The sweep stands still when the user asked for less motion. */
  animate: boolean;
}

export default function Scanner({ animate }: ScannerProps) {
  const sweepRef = useRef<THREE.Mesh>(null);
  const R = SCANNER.radius;

  const mats = useMemo(() => {
    const plate = new THREE.MeshStandardMaterial({
      name: 'scanner-plate',
      color: SCANNER_COLORS.plateColor,
      emissive: SCANNER_COLORS.plateEmissive,
      emissiveIntensity: SCANNER_COLORS.plateEmissiveIntensity,
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: SCANNER_COLORS.plateOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const grid = new THREE.MeshStandardMaterial({
      name: 'scanner-grid',
      color: 0x000000,
      emissive: SCANNER_COLORS.gridEmissive,
      emissiveIntensity: SCANNER_COLORS.gridEmissiveIntensity,
      transparent: true,
      opacity: SCANNER_COLORS.gridOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rim = new THREE.MeshStandardMaterial({
      name: 'scanner-rim',
      color: 0x000000,
      emissive: SCANNER_COLORS.rimEmissive,
      emissiveIntensity: SCANNER_COLORS.rimEmissiveIntensity,
      transparent: true,
      opacity: SCANNER_COLORS.rimOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // The sweep is the same surface as the plate, lit brighter, so it clones
    // the plate's material — that keeps the two in step if the plate is retuned.
    const sweep = plate.clone();
    sweep.name = 'scanner-sweep';
    sweep.emissive = new THREE.Color(SCANNER_COLORS.sweepEmissive);
    sweep.emissiveIntensity = SCANNER_COLORS.sweepEmissiveIntensity;
    sweep.opacity = SCANNER_COLORS.sweepOpacity;
    return { plate, grid, rim, sweep };
  }, []);

  useEffect(
    () => () => {
      mats.plate.dispose();
      mats.grid.dispose();
      mats.rim.dispose();
      mats.sweep.dispose();
    },
    [mats],
  );

  useFrame((_, delta) => {
    if (!animate || !sweepRef.current) {
      return;
    }
    sweepRef.current.rotation.z -= SCANNER.sweepSpeed * Math.min(delta, MAX_DELTA);
  });

  return (
    <group name="scanner-deck" rotation-x={-Math.PI / 2}>
      <mesh name="scanner-plate" material={mats.plate}>
        <circleGeometry args={[R, 128]} />
      </mesh>
      <mesh name="scanner-rim" material={mats.rim}>
        <ringGeometry args={[R - 0.012, R, 160]} />
      </mesh>
      {SCANNER.rings.map((f, i) => (
        <mesh key={`ring-${i}`} name={`scanner-ring-${i + 1}`} material={mats.grid}>
          <ringGeometry args={[R * f - 0.006, R * f + 0.006, 128]} />
        </mesh>
      ))}
      {Array.from({ length: SCANNER.spokes }, (_, i) => (
        <mesh
          key={`axis-${i}`}
          name={`scanner-axis-${i + 1}`}
          material={mats.grid}
          rotation-z={(i * Math.PI) / SCANNER.spokes}
        >
          <planeGeometry args={[0.007, R * 2]} />
        </mesh>
      ))}
      <mesh ref={sweepRef} name="scanner-sweep" material={mats.sweep}>
        <circleGeometry args={[R * 0.995, 90, 0, SCANNER.sweepArc]} />
      </mesh>
    </group>
  );
}
