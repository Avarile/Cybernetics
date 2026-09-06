"use client"

// The canvas: renderer, camera, lights, and the model the strips turn inside.
//
// This is the lazy boundary's payload — `three` is reachable only from here
// down, so the library is not fetched until the core is actually mounted.
//
// R3F absorbs most of what the reference implementation's Stage class did by
// hand: it owns the renderer, measures and resizes the canvas, disposes
// geometry on unmount, and runs one loop instead of the reference's two.
// What is left here is the framing pass and the scene's own furniture.

import { useRef, useMemo, useState, useEffect } from "react"
import { Canvas, useThree, useFrame } from "@react-three/fiber"
import * as THREE from "three"
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import type { RefObject } from "react"
import type { Domain } from "./data/domains"
import type { Health } from "./data/status"
import Orbit from "./objects/Orbit"
import Strip from "./objects/Strip"
import Scanner from "./objects/Scanner"
import Mainframe from "./objects/Mainframe"
import Hum from "./objects/Hum"
import { LabelFactory, preloadLabelFont } from "./scene/labels"
import { MaterialRegistry } from "./scene/materials"
import { createToneBus } from "./scene/audio"
import { colorOf, gainOf, newRuntime, stripSpec, type Runtime } from "./scene/resolve"
import { LIGHTS, STAGE_BACKGROUND } from "./scene/palette"
import { SCANNER, FRAME_FOV, FRAME_DISTANCE, FRAME_DIRECTION } from "./scene/config"

export interface SceneProps {
  domains: readonly Domain[]
  /** Live health per domain key. Missing keys resolve to "unknown". */
  healthFor: (key: string) => Health
  selected: string | null
  onSelect: (id: string | null) => void
  scannerVisible: boolean
  /** Opt-in. Browsers refuse an AudioContext without a gesture, and an
   *  unprompted drone on the landing surface is hostile — see the Phase 2 plan. */
  soundEnabled: boolean
  /** Bumped to re-run the framing pass. */
  resetToken: number
}

/** The one default view: the framing direction, at the framed distance, looking
 *  at the stack's centre. The canvas opens on it and the reset button returns
 *  to it, so there is a single composition to get right. */
const DEFAULT_VIEW = new THREE.Vector3(...FRAME_DIRECTION).setLength(FRAME_DISTANCE)

/**
 * Puts the camera in the default view, once, and again whenever the reset
 * button asks.
 *
 * Composed against the cap rings rather than measured off the scene — see
 * FRAME_EXTENT in config.ts. A measured bounding box cannot hold a composition
 * still here: the deck is a backdrop 10x wider than the thing worth looking at,
 * so the box a measured fit sees is set by the deck, not the stack.
 */
function Frame({
  controlsRef,
  resetToken,
}: {
  controlsRef: RefObject<OrbitControls | null>
  resetToken: number
}) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) {
      return
    }
    camera.position.copy(DEFAULT_VIEW)
    camera.near = Math.max(FRAME_DISTANCE / 100, 0.01)
    camera.far = FRAME_DISTANCE * 100
    camera.updateProjectionMatrix()
    controls.target.set(0, 0, 0)
    controls.update()
    invalidate()
  }, [camera, invalidate, controlsRef, resetToken])

  return null
}

/** The selection pulse. Only the picked strip's overlay renders with these
 *  materials, so this animates it alone. */
function Pulse({ mats, active }: { mats: MaterialRegistry; active: boolean }) {
  useFrame(({ clock }) => {
    if (active) {
      mats.pulse(clock.elapsedTime * 1000)
    }
  })
  return null
}

function Core({
  domains,
  healthFor,
  selected,
  onSelect,
  scannerVisible,
  soundEnabled,
  resetToken,
  animate,
}: SceneProps & { animate: boolean }) {
  const controlsRef = useRef<OrbitControls | null>(null)
  const camera = useThree((state) => state.camera)
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy())

  // One registry per scene. Materials are shared across strips that look alike,
  // and the dimming pass has to be able to reach every one of them.
  const mats = useMemo(() => new MaterialRegistry(), [])
  const labels = useMemo(() => new LabelFactory(maxAnisotropy), [maxAnisotropy])

  // Per-strip spin phase. A Map in a ref, written 60x/second by every strip on
  // screen and never read by React's render path — a setState here would
  // re-render the whole stack every frame. Keyed by domain key rather than list
  // index so removing a domain cannot shift everyone else's phase onto their
  // neighbours'.
  const runtime = useRef(new Map<string, Runtime>())
  const runtimeFor = (d: Domain): Runtime => {
    const found = runtime.current.get(d.key)
    if (found) return found
    const created = newRuntime(d)
    runtime.current.set(d.key, created)
    return created
  }
  const parkPhase = (id: string, phase: number) => {
    const rt = runtime.current.get(id)
    if (rt) rt.phase = phase
  }

  // Not built at all when the stack is holding still or sound is off, which
  // silences the mainframe's hum as well as the strips. null also covers a
  // browser that refuses us an AudioContext — see createToneBus.
  const bus = useMemo(
    () => (animate && soundEnabled ? createToneBus(camera) : null),
    [animate, soundEnabled, camera],
  )

  useEffect(() => {
    return () => {
      mats.dispose()
      labels.dispose()
    }
  }, [mats, labels])

  // Its own effect rather than a line in the one above: the bus can be rebuilt
  // without the materials being rebuilt, and folding it in would mean toggling
  // sound disposed the material registry the live scene is still using.
  useEffect(() => {
    if (!bus) {
      return
    }
    return () => bus.dispose()
  }, [bus])

  // Band names are rasterised through the theme's UI face. Rather than block
  // the whole scene on the font, the stack renders immediately and labels
  // appear once it resolves. Gating matters because the rasteriser caches per
  // string: drawing early would cache the fallback face permanently.
  const [fontReady, setFontReady] = useState(false)
  useEffect(() => {
    let alive = true
    preloadLabelFont().then(() => {
      if (alive) {
        setFontReady(true)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  // Dim the always-on materials while something is picked, so the selected
  // strip carries the eye.
  useEffect(() => {
    mats.setDimmed(selected != null)
    return () => mats.setDimmed(false)
  }, [mats, selected])

  const strips = useMemo(
    () =>
      domains.map((d) => {
        const health = healthFor(d.key)
        const spec = stripSpec(d, health)
        return {
          spec: fontReady ? spec : { ...spec, label: null },
          initialPhase: runtimeFor(d).phase,
          mats: mats.forModule(colorOf(health), null, gainOf(health)),
        }
      }),
    // runtimeFor is intentionally excluded: it reads and writes a ref, and
    // including it would rebuild every spec on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [domains, healthFor, mats, fontReady],
  )

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
          {/* A sibling of the mainframe rather than a child of it: both groups
              are untransformed, so this sits in exactly the same place, and
              Mainframe stays propless with its claim to no per-frame work
              intact. Mirrors the gate Strip uses for its own voice. */}
          {bus && <Hum bus={bus} />}
          {strips.map((strip) => (
            <Strip
              key={strip.spec.id}
              spec={strip.spec}
              mats={strip.mats}
              labels={labels}
              bus={bus}
              picked={selected === strip.spec.id}
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
  )
}

export default function Scene(props: SceneProps) {
  // Reduced motion renders a static frame rather than a paused animation.
  // "demand" means nothing repaints unless something asks, and Orbit asks while
  // the user is dragging.
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReducedMotion(mql.matches)
    sync()
    mql.addEventListener("change", sync)
    return () => mql.removeEventListener("change", sync)
  }, [])

  const animate = !reducedMotion

  return (
    <Canvas
      frameloop={animate ? "always" : "demand"}
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
  )
}
