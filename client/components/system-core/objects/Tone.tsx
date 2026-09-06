// The sound one strip makes, hung inside the group that spins it.
//
// Thin by design: every audible decision is in ../scene/tone.ts and every audio
// node in ../scene/audio.ts. What this component owns is the lifecycle — one
// voice per mount, released on unmount — and the mount point, which is the only
// place a module's own geometry is still needed once the bus has the rest.
//
// Being a child of the spinning group is the whole mechanism. PositionalAudio
// drives its panner from its own world matrix, and nothing else in a strip is
// ever off the spin axis: the radius lives in each cylinder's vertex data rather
// than in a transform, so every mesh sits at the local origin and would emit
// from the middle. Placed out at the arc, this one node inherits the turn for
// free — the same reason Contact is nested rather than synced per frame.
//
// Shaped after ./Orbit.tsx, the house pattern for a three object built by hand:
// useThree for what the canvas provides, useMemo to construct, an effect per
// concern, useFrame for per-frame work, cleanup in the effect's return. Nothing
// per-frame goes through React state, for the reason Strip's header sets out.

import { useMemo, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { emitterOffset } from '../scene/tone';
import type { ToneBus } from '../scene/audio';

interface ToneProps {
  bus: ToneBus;
  /** Centre of the roar's rumble band, in Hz. */
  hz: number;
  /** This module's share of the one global ceiling, 0 to 1. */
  level: number;
  radius: number;
  arcDeg: number;
}

export default function Tone({ bus, hz, level, radius, arcDeg }: ToneProps) {
  const camera = useThree((state) => state.camera);

  // Keyed on [bus, hz], deliberately not on `level`. `level` is bound to live
  // health, so including it would rebuild the whole voice on every poll — see
  // ToneBus.setLevel, which retunes the running one instead. `hz` stays in the
  // key because retuning it properly means three biquad frequencies plus the
  // make-up gain, which is a rebuild either way; it is authored, so it moves only
  // on a hand edit, which is exactly when rebuilding is the right answer.
  // `level` is read here only as the voice's starting value; the effect below
  // owns it from then on, which is why it is not a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const audio = useMemo(() => bus.roar(hz, level), [bus, hz]);
  const position = useMemo(() => emitterOffset(radius, arcDeg), [radius, arcDeg]);

  useEffect(() => {
    bus.setLevel(audio, level);
  }, [bus, audio, level]);

  useEffect(() => {
    return () => bus.release(audio);
  }, [bus, audio]);

  useFrame((_, delta) => {
    bus.track(audio, camera, delta);
  });

  return <primitive object={audio} position={position} />;
}
