// The sound the mainframe makes, standing still at the centre of the stack.
//
// Sibling to ./Tone.tsx and shaped the same way, but wired to bus.hold rather
// than bus.track, and that is the only interesting thing about it. A strip's
// level comes from where it has orbited to; the mainframe never goes anywhere,
// so its level comes from how far off the camera is and nothing else. Feeding it
// the orbit law instead would return a constant and look like it worked — see
// humLevel() in ../scene/tone.ts.
//
// No position prop: the mainframe group's own origin is where this should emit
// from, which is the middle of the machine.

import { useMemo, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import type { ToneBus } from '../scene/audio';

interface HumProps {
  bus: ToneBus;
}

export default function Hum({ bus }: HumProps) {
  const camera = useThree((state) => state.camera);

  const audio = useMemo(() => bus.hum(), [bus]);

  useEffect(() => {
    return () => bus.release(audio);
  }, [bus, audio]);

  useFrame((_, delta) => {
    bus.steady(audio, camera, delta);
  });

  return <primitive object={audio} />;
}
