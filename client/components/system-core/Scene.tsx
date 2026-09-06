// The canvas: renderer, camera, lights, and the model the strips turn inside.
//
// This is the lazy boundary's payload — `three` is reachable only from here
// down, so the library is not fetched until the modal is actually opened.
//
// R3F absorbs most of what the reference implementation's Stage class did by
// hand: it owns the renderer, measures and resizes the canvas, disposes
// geometry on unmount, and runs one loop instead of the reference's two (a
// render loop and a separate simulation loop that both had to be torn down).
// What is left here is the framing pass and the scene's own furniture.

import { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { useMediaQuery } from '@/components/system-core/shims/ui';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MutableRefObject } from 'react';
import type { Reading } from './live/bind';
import type { Module } from './data/schema';
import type { Runtime } from './scene/resolve';
import Orbit from './objects/Orbit';
import Strip from './objects/Strip';
import Scanner from './objects/Scanner';
import Mainframe from './objects/Mainframe';
import { LabelFactory, preloadLabelFont } from './scene/labels';
import { MaterialRegistry } from './scene/materials';
import { createToneBus } from './scene/audio';
import { stripSpec, appearanceOf } from './scene/resolve';
import logger from '@/components/system-core/shims/logger';
import { LIGHTS, STAGE_BACKGROUND } from './scene/palette';
import { SCANNER, FRAME_FOV, FRAME_DISTANCE, FRAME_DIRECTION } from './scene/config';

export interface SceneProps {
  modules: Module[];
  /** Live samples by module id. Empty when the feature is off or unconfigured,
   *  which is what makes the fixture-only scene the same code path. */
  readings: ReadonlyMap<string, Reading>;
  runtimeFor: (m: Module) => Runtime;
  parkPhase: (id: string, phase: number) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  scannerVisible: boolean;
  /** Bumped to re-run the framing pass. */
  resetToken: number;
}

/** The one default view: the framing direction, at the framed distance, looking
 *  at the stack's centre. The canvas opens on it and the reset button returns
 *  to it, so there is a single composition to get right. */
const DEFAULT_VIEW = new THREE.Vector3(...FRAME_DIRECTION).setLength(FRAME_DISTANCE);

/**
 * Puts the camera in the default view, once, and again whenever the reset
 * button asks.
 *
 * Composed against the cap rings rather than measured off the scene — see
 * FRAME_EXTENT. A measured bounding box was what the reference fitted, and it
 * cannot hold a composition still here: the deck is a backdrop 10× wider than
 * the thing worth looking at, and a strip's contact reaches out to sit on that
 * deck, so the box a measured fit sees is set by the widest module's contact.
 * Editing one module's radius, or adding a module, would then move the default
 * view.
 */
function Frame({
  controlsRef,
  resetToken,
}: {
  controlsRef: MutableRefObject<OrbitControls | null>;
  resetToken: number;
}) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }
    camera.position.copy(DEFAULT_VIEW);
    camera.near = Math.max(FRAME_DISTANCE / 100, 0.01);
    camera.far = FRAME_DISTANCE * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    invalidate();
  }, [camera, invalidate, controlsRef, resetToken]);

  return null;
}

/**
 * The selection pulse.
 *
 * Motion *is* the selection signal now: every strip carries the bright overlay as
 * its resting appearance, and only the picked one breathes. So this runs while
 * something is selected and not otherwise — and `pulse()` deliberately animates
 * only the `mark` kind, which is the picked strip's material alone. Were it to
 * touch `hot` as well, the whole stack would pulse together the instant anything
 * was clicked, because the registry is keyed by appearance and every unselected
 * strip of a given status shares one material.
 */
function Pulse({ mats, active }: { mats: MaterialRegistry; active: boolean }) {
  useFrame(({ clock }) => {
    if (active) {
      mats.pulse(clock.elapsedTime * 1000);
    }
  });
  return null;
}

function Core({
  modules,
  readings,
  runtimeFor,
  parkPhase,
  selected,
  onSelect,
  scannerVisible,
  resetToken,
  animate,
}: SceneProps & { animate: boolean }) {
  const controlsRef = useRef<OrbitControls | null>(null);
  const camera = useThree((state) => state.camera);
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());
  // What the GPU will accept as a texture width. A readout string runs to a
  // hundred characters, which at the rasteriser's type size is a canvas several
  // thousand pixels wide, and WebGL2 only guarantees 2048 — so the factory needs
  // this to scale the canvas into range rather than have the upload fail.
  const maxTextureSize = useThree((state) => state.gl.capabilities.maxTextureSize);

  // One registry per scene. Materials are shared across modules that look
  // alike, and the dimming pass has to be able to reach every one of them.
  const mats = useMemo(() => new MaterialRegistry(), []);
  const labels = useMemo(
    () => new LabelFactory(maxAnisotropy, maxTextureSize),
    [maxAnisotropy, maxTextureSize],
  );
  // Not built at all when the stack is holding still, which silences the
  // mainframe's hum as well as the strips.
  //
  // This is a choice, not a technical limit, and worth saying so. Under reduced
  // motion `frameloop` is "demand", but Orbit invalidates on every controls
  // change and R3F renders once at mount, so a static voice would in fact be
  // handed a correct level and would track zoom perfectly well. It is left silent
  // because a continuous unmutable drone over a deliberately still frame, with no
  // visible motion to account for it, is worse than nothing. Skipping the bus
  // also means no AudioContext for a scene that was never going to use one, and
  // null likewise covers a browser that refuses us one — see createToneBus.
  const bus = useMemo(() => (animate ? createToneBus(camera) : null), [animate, camera]);

  useEffect(() => {
    return () => {
      mats.dispose();
      labels.dispose();
    };
  }, [mats, labels]);

  // Its own effect rather than a line in the one above: the bus can be rebuilt
  // without the materials being rebuilt, and folding it in would mean a change
  // of `animate` disposed the material registry the live scene is still using.
  useEffect(() => {
    if (!bus) {
      return;
    }
    return () => bus.dispose();
  }, [bus]);

  // Band names are rasterised through the theme's UI face. Rather than block
  // the whole scene on the font, the stack renders immediately and labels
  // appear once it resolves — usually the next frame, since the face is already
  // in use by the app around it. Gating matters because the rasteriser caches
  // per string: drawing early would cache the fallback face permanently.
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let alive = true;
    preloadLabelFont().then(() => {
      if (alive) {
        setFontReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Dim the always-on materials while something is picked, so the selected
  // strip and its contact carry the eye.
  useEffect(() => {
    mats.setDimmed(selected != null);
    return () => mats.setDimmed(false);
  }, [mats, selected]);

  // Where the three sources meet: the authored module, its live sample, and the
  // per-frame runtime. Rebuilt on every data change, which at a 20s poll is
  // rare; the strips are keyed by module id below, so a rebuild re-renders them
  // without remounting and without disturbing their rotation.
  const strips = useMemo(
    () =>
      modules.map((m) => {
        const rt = runtimeFor(m);
        const live = readings.get(m.id) ?? null;
        const spec = stripSpec(m, rt, live);
        const look = appearanceOf(m, live);
        return {
          spec: fontReady ? spec : { ...spec, label: null },
          initialPhase: rt.phase,
          mats: mats.forModule(look.color, look.opacity, look.gain),
        };
      }),
    [modules, readings, runtimeFor, mats, fontReady],
  );

  // Release materials and label textures the build above stopped asking for, and
  // open the next generation. After the commit rather than inside the memo: a
  // material still referenced by a mesh that has just rendered would draw black
  // if disposed, and a texture would draw blank.
  useEffect(() => {
    mats.sweep();
    labels.sweep();
  }, [strips, mats, labels]);

  // What the caches are holding. Free unless VITE_ENABLE_LOGGER is on. Every
  // number here should be flat across ticks in the steady state — a climbing count
  // means something with an unbounded codomain reached a cache (see live/bind.ts).
  // `labels` is the one to watch once a band carries live text: it is a canvas and
  // a texture per distinct string, so it climbs first and fastest.
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    logger.log('system_core', {
      modules: strips.length,
      materials: mats.size,
      labels: labels.size,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length,
    });
  }, [strips, mats, labels, gl]);

  return (
    <>
      <color attach="background" args={[STAGE_BACKGROUND]} />
      <hemisphereLight args={[LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity]} />
      <directionalLight
        color={LIGHTS.keyColor}
        intensity={LIGHTS.keyIntensity}
        position={[4, 7, 5]}
      />
      <directionalLight
        color={LIGHTS.fillColor}
        intensity={LIGHTS.fillIntensity}
        position={[-5, 3, -4]}
      />

      <group name="digital-system-core">
        <group name="scanner-view" position-y={SCANNER.y} visible={scannerVisible}>
          <Scanner animate={animate} />
        </group>
        <group name="stack">
          <Mainframe />
          {/* A sibling of the mainframe rather than a child of it: `mainframe`
              and `stack` are both untransformed, so this sits in exactly the same
              place, and Mainframe stays propless with its claim to no per-frame
              work intact. Mirrors the gate Strip uses for its own voice. */}
          {strips.map((strip) => (
            <Strip
              key={strip.spec.id}
              spec={strip.spec}
              mats={strip.mats}
              labels={labels}
              bus={bus}
              picked={selected === strip.spec.id}
              scannerVisible={scannerVisible}
              animate={animate}
              initialPhase={strip.initialPhase}
              onPhase={parkPhase}
              onPick={onSelect}
            />
          ))}
        </group>
      </group>

      <Orbit controlsRef={controlsRef} damping={animate} />
      <Frame controlsRef={controlsRef} resetToken={resetToken} />
      <Pulse mats={mats} active={selected != null} />
    </>
  );
}

export default function Scene(props: SceneProps) {
  // Reduced motion renders a static frame rather than a paused animation, which
  // is the convention the shared AnimatedGridPattern and OrbitMark primitives
  // already follow. "demand" means nothing repaints unless something asks, and
  // Orbit asks while the user is dragging.
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const animate = !reducedMotion;

  return (
    <Canvas
      frameloop={animate ? 'always' : 'demand'}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{
        fov: FRAME_FOV,
        near: 0.01,
        far: 500,
        position: [DEFAULT_VIEW.x, DEFAULT_VIEW.y, DEFAULT_VIEW.z],
      }}
    >
      <Core {...props} animate={animate} />
    </Canvas>
  );
}
