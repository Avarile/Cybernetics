// Orbit controls, built imperatively rather than through drei.
//
// drei is a large dependency for the one control this scene uses, and its v9
// line is the only one paired with @react-three/fiber v8. Constructing
// OrbitControls directly avoids both, at the cost of the twenty lines below.
//
// `extend()` plus a JSX element would be the other option, but that needs a
// global JSX namespace augmentation in a feature file to stay typed.

import { useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MutableRefObject } from 'react';

interface OrbitProps {
  /** Published so the framing helper and the reset button can retarget it. */
  controlsRef: MutableRefObject<OrbitControls | null>;
  /** Damping is inertia, which is motion: off when the user asked for less. */
  damping: boolean;
}

export default function Orbit({ controlsRef, damping }: OrbitProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  // Construction, publication and teardown as one effect. Built here rather than
  // in a useMemo because react-hooks/immutability forbids mutating a value made
  // during render, and every setting below is mutation. Symmetric besides: the
  // memo built once but this cleanup disposes, so a double-invoked effect used to
  // republish an instance that had already been torn down.
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.dampingFactor = 0.08;
    // Under frameloop="demand" nothing repaints on its own, so a drag has to ask
    // for the frames it needs. Harmless in "always" mode: invalidate is a no-op
    // there.
    const onChange = () => invalidate();
    controls.addEventListener('change', onChange);
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener('change', onChange);
      controlsRef.current = null;
      controls.dispose();
    };
  }, [camera, gl, invalidate, controlsRef]);

  // Damping is inertia, which is motion: off when the user asked for less.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }
    controls.enableDamping = damping;
  }, [controlsRef, damping]);

  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
}
