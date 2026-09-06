// Orbit controls, built imperatively rather than through drei.
//
// drei is a large dependency for the one control this scene uses, and its v9
// line is the only one paired with @react-three/fiber v8. Constructing
// OrbitControls directly avoids both, at the cost of the twenty lines below.
//
// `extend()` plus a JSX element would be the other option, but that needs a
// global JSX namespace augmentation in a feature file to stay typed.
//
// Ported to R3F v9 / React 19: MutableRefObject is deprecated there, and plain
// RefObject is mutable by default.

import { useEffect, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RefObject } from 'react';

interface OrbitProps {
  /** Published so the framing helper and the reset button can retarget it. */
  controlsRef: RefObject<OrbitControls | null>;
  /** Damping is inertia, which is motion: off when the user asked for less. */
  damping: boolean;
}

export default function Orbit({ controlsRef, damping }: OrbitProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl]);

  useEffect(() => {
    controls.enableDamping = damping;
    controls.dampingFactor = 0.08;
  }, [controls, damping]);

  useEffect(() => {
    controlsRef.current = controls;
    return () => {
      controlsRef.current = null;
      controls.dispose();
    };
  }, [controls, controlsRef]);

  // Under frameloop="demand" nothing repaints on its own, so a drag has to ask
  // for the frames it needs. Harmless in "always" mode: invalidate is a no-op
  // there.
  useEffect(() => {
    const onChange = () => invalidate();
    controls.addEventListener('change', onChange);
    return () => controls.removeEventListener('change', onChange);
  }, [controls, invalidate]);

  useFrame(() => {
    controls.update();
  });

  return null;
}
