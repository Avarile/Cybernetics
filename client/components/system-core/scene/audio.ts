// The listener, the sources, and the bus that owns them.
//
// Every tunable number and every curve is in ./tone.ts, which stays free of
// three and of Web Audio so it can be tested. This file is the half that cannot
// be: it is all AudioContext and scene graph.
//
// WHY THE PANNER DOES NOT SET THE LEVEL
// -------------------------------------
// A PannerNode attenuates with distance on its own, and that is the obvious way
// to build this. It does not survive the camera. Orbit sets neither minDistance
// nor maxDistance, so the user can zoom anywhere, and any fixed
// refDistance/maxDistance pair is either permanently silent from far enough out
// or permanently full-blast from close enough in. Either way the swell — the
// entire point — is the first thing lost. Worse, none of the three distance
// models is even the right shape: `linear` is the only one that reaches exactly
// zero, and it is also the flattest, so it stays loud through most of the orbit.
//
// So rolloffFactor is zeroed and the panner does only what it is uniquely good
// at, which is direction. Loudness and brightness come from roarLevel() and
// roarCutoff(), normalised against the camera's own distance to the orbit,
// which is what makes the effect hold at any zoom. A pleasant side effect: with
// the panner distance-neutral, the timeDelta smear handled in track() can only
// ever glide the stereo image, never the volume.
//
// THE CONTEXT IS NEVER CLOSED
// ---------------------------
// three caches one AudioContext in a module-level variable for the whole life of
// the page (AudioContext.getContext). Closing it would leave that variable
// pointing at a dead context, so the next AudioListener built after this dialog
// reopened would throw from createGain — during render, which Boundary would
// catch by blanking the entire scene. A decorative hum is not worth that. The
// context is suspended on teardown and resumed on the next mount.

import * as THREE from 'three';
import {
  HUM,
  ROAR,
  BANDS,
  CHURN,
  FILTER,
  HUM_MIX,
  mixGain,
  humLevel,
  roarLevel,
  roarCutoff,
  NOISE_SECONDS,
  saturationCurve,
} from './tone';
import { MAX_DELTA } from './config';

/** Scratch, in three's own module-level idiom: this runs every frame. */
const _emitter = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _eye = new THREE.Vector3();

/** What a browser accepts as the gesture it wants before it will make a sound.
 *  `touchend` rather than `touchstart` because that is the one iOS treats as
 *  activation. */
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

/**
 * How many buses this page has built.
 *
 * Teardown defers its suspend past the last fade, and three hands every bus the
 * same cached AudioContext — so closing and reopening the dialog inside that
 * window let the *outgoing* bus suspend the *incoming* one's context. Nothing
 * then resumed it: arming only waits on a statechange, and the one it got said
 * "suspended". The scene came back silent until the user's next click, which an
 * orbiting roar mostly got away with and a continuous hum would not.
 *
 * A counter rather than a reference to the live bus, which would both trip
 * no-this-alias and keep a disposed one reachable for no reason.
 */
let built = 0;

interface Voice {
  /** Written every frame from the distance curve. */
  level: GainNode;
  /** The filter the distance curve sweeps, or null for a voice with nothing
   *  worth sweeping — pure sines have no harmonics for a lowpass to remove. */
  cutoff: BiquadFilterNode | null;
  /** Noise players and modulators alike: both need stopping, and neither can be
   *  started twice. */
  sources: AudioScheduledSourceNode[];
  /** Everything to disconnect on teardown. */
  nodes: AudioNode[];
  /** Peak amplitude for this module: ROAR.ceiling times its own level. */
  ceiling: number;
  /** Seconds since this voice last wrote its parameters. */
  since: number;
  /** Last level written, so an unchanged one is not written again. Matters for
   *  the hum: its level moves only when the camera does, so an idle scene would
   *  otherwise spend twenty automation events a second saying the same thing. */
  wrote: number;
}

/**
 * Owns the one AudioListener and every sounding strip's voice.
 *
 * Built and disposed alongside MaterialRegistry and LabelFactory, and with one
 * asymmetry worth stating: a leaked MaterialRegistry is invisible, a leaked
 * voice is audible. Two buses means two roars at double amplitude, so if
 * StrictMode is ever switched on in this app, this is the first thing in the
 * feature that breaks.
 *
 * Reached through createToneBus, never constructed directly — see there.
 */
export class ToneBus {
  private readonly listener: THREE.AudioListener;
  private readonly ctx: AudioContext;
  private voices = new Map<THREE.Audio<AudioNode>, Voice>();
  private disarm: (() => void) | null = null;
  /** Built on first use and shared: one buffer of white noise is the source for
   *  every band of every voice, and it is by far the largest thing here. */
  /** Which bus this is, so teardown can tell whether it is still the current
   *  one by the time its deferred suspend runs. */
  private readonly generation: number;
  private noise: AudioBuffer | null = null;
  private curve: Float32Array<ArrayBuffer> | null = null;

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    this.ctx = this.listener.context as AudioContext;
    camera.add(this.listener);
    this.generation = ++built;
    this.arm();
  }

  /**
   * A rocket, already running: noise through three bandwidth-weighted windows,
   * churned, soft-clipped, behind a lowpass the distance curve sweeps.
   */
  roar(hz: number, level: number): THREE.PositionalAudio {
    const ctx = this.ctx;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];

    // Signal flows bottom-up through what follows: noise into three bands, the
    // bands into the churn, the churn through the saturator, and the saturator
    // into the master lowpass the distance curve sweeps.
    const cutoff = ctx.createBiquadFilter();
    cutoff.type = 'lowpass';
    cutoff.frequency.value = FILTER.low.min;
    cutoff.Q.value = FILTER.low.q;

    // Soft clip. Timbre — a launch is heard through its own compression — and
    // peak limiter, since the curve is normalised to ±1 and so nothing past this
    // point can clip however the three bands happen to sum.
    const saturate = ctx.createWaveShaper();
    saturate.curve = this.shape();
    saturate.oversample = '4x';
    saturate.connect(cutoff);

    // The irregular swell of combustion. Sits at unity and is pushed around by
    // the modulators below: connecting a node to an AudioParam sums on top of
    // whatever that parameter already holds.
    const churn = ctx.createGain();
    churn.gain.value = 1;
    churn.connect(saturate);

    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = FILTER.high.hz;
    high.Q.value = FILTER.high.q;
    high.connect(churn);

    nodes.push(cutoff, saturate, churn, high);

    // One noise player feeding all three bands rather than one each: the bands
    // sit two and then almost five octaves apart, far enough that sharing a
    // source costs nothing in correlation and saves two players.
    const noise = ctx.createBufferSource();
    noise.buffer = this.white();
    noise.loop = true;
    sources.push(noise);

    // Depends on the sample rate, so it cannot be a constant in ./tone.ts: the
    // same three windows pass twice the fraction of the noise's power at 22 kHz
    // that they do at 44.
    const makeup = mixGain(hz, ctx.sampleRate / 2);

    for (const band of BANDS) {
      const filter = ctx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = hz * band.mul;
      filter.Q.value = band.q;
      const amp = ctx.createGain();
      amp.gain.value = band.gain * makeup;
      noise.connect(filter);
      filter.connect(amp);
      amp.connect(high);
      nodes.push(filter, amp);
    }

    for (const mod of CHURN) {
      sources.push(this.modulate(mod.hz, mod.depth, churn.gain, nodes));
    }

    const audio = new THREE.PositionalAudio(this.listener);
    audio.setRolloffFactor(0);
    // three's PositionalAudio constructor asks for HRTF. A launch lives well
    // below the couple of hundred Hz where interaural cues start to exist, so the
    // convolution colours the signal and costs real work without buying any sense
    // of where the sound is. Equal-power keeps the stereo sweep, which is the
    // part that sells the orbit.
    audio.panner.panningModel = 'equalpower';

    this.mount(audio, {
      head: cutoff,
      cutoff,
      nodes,
      sources,
      ceiling: ROAR.ceiling * level,
      fadeIn: ROAR.fadeIn,
    });
    return audio;
  }

  /**
   * The mainframe, already running: mains hum built additively, its even
   * harmonics carrying it, barely wandering.
   *
   * No saturator and no swept cutoff. Pure sines have no harmonics for a lowpass
   * to take away, so sweeping one would cost a biquad to change nothing audible.
   */
  hum(): THREE.Audio<GainNode> {
    const ctx = this.ctx;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];

    // Sits at unity, nudged by the one modulator below. Small as that is, it is
    // the only thing keeping this from being a mathematically constant signal:
    // the mainframe never moves, so nothing else varies unless the user does.
    const mix = ctx.createGain();
    mix.gain.value = HUM_MIX;
    nodes.push(mix);

    for (const partial of HUM.partials) {
      const osc = ctx.createOscillator();
      osc.type = partial.wave;
      osc.frequency.value = HUM.mains * partial.mul;
      osc.detune.value = partial.cents;
      const amp = ctx.createGain();
      amp.gain.value = partial.gain;
      osc.connect(amp);
      amp.connect(mix);
      nodes.push(osc, amp);
      sources.push(osc);
    }

    // A plain Audio, not a PositionalAudio, and that is not a shortcut. The
    // camera orbits the origin *looking at* it, so a source sitting there is
    // permanently dead ahead: a panner would spend six linearRampToValueAtTime
    // calls a frame, forever, computing an azimuth of exactly zero. Orbit sets no
    // minDistance either, so this is also the one voice that can end up
    // coincident with the listener. THREE.Audio does not override
    // updateMatrixWorld at all, which is the whole saving.
    const audio = new THREE.Audio(this.listener);
    this.mount(audio, {
      head: mix,
      cutoff: null,
      nodes,
      sources,
      ceiling: HUM.ceiling,
      fadeIn: HUM.fadeIn,
    });
    return audio;
  }

  /** One frame of a strip: how near it has orbited, and how that sounds. */
  track(audio: THREE.PositionalAudio, camera: THREE.Camera, delta: number): void {
    const voice = this.voices.get(audio);
    if (!voice || !this.due(voice, delta)) {
      return;
    }

    // The emitter's parent is the strip's spinning group, so its origin is the
    // centre of the orbit: turning a group about its own Y axis cannot move it.
    // Taking the radius from the two of them rather than from the module spec
    // keeps this correct if the stack above ever gains a transform.
    const pivot = audio.parent;
    if (!pivot) {
      return;
    }
    // Refreshes every ancestor matrix on the way up, including the pivot's.
    audio.getWorldPosition(_emitter);
    _centre.setFromMatrixPosition(pivot.matrixWorld);
    camera.getWorldPosition(_eye);

    this.write(
      voice,
      roarLevel(_eye.distanceTo(_emitter), _eye.distanceTo(_centre), _emitter.distanceTo(_centre)),
    );
  }

  /**
   * One frame of something that does not move: how far off the camera is, and
   * how that sounds.
   *
   * Not track(). That one normalises against the orbit it is given, which for a
   * static emitter is no orbit at all — see humLevel() in ./tone.ts for what
   * borrowing it would silently do. Kept as its own method rather than a law
   * passed into one: track() early-returns when the emitter has no parent, a
   * precondition that is meaningless here, and a static voice inheriting it would
   * go silent on a condition it does not have.
   */
  steady(audio: THREE.Audio<AudioNode>, camera: THREE.Camera, delta: number): void {
    const voice = this.voices.get(audio);
    if (!voice || !this.due(voice, delta)) {
      return;
    }
    audio.getWorldPosition(_emitter);
    camera.getWorldPosition(_eye);
    this.write(voice, humLevel(_eye.distanceTo(_emitter)));
  }

  /** Ends one voice. Terminal: neither a noise player nor a modulator can be
   *  started twice, so a strip that comes back asks for a new one. */
  release(audio: THREE.Audio<AudioNode>): void {
    const voice = this.voices.get(audio);
    if (!voice) {
      return;
    }
    this.voices.delete(audio);

    const now = this.ctx.currentTime;
    const gain = voice.level.gain;
    // cancelScheduledValues on its own would step the parameter to whatever was
    // last scheduled; pinning the current value first is what keeps this smooth.
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + ROAR.fadeOut);

    // Stopping is not optional. A started source keeps running, and keeps
    // costing, with nothing connected to it — disconnect alone would leave a
    // looping noise player and three modulators alive per modal open.
    const end = now + ROAR.fadeOut;
    for (const source of voice.sources) {
      source.stop(end + 0.02);
    }
    // Deferred past the ramp, or the fade is cut off and clicks. A timer rather
    // than the `ended` event, which never arrives if the context was suspended
    // before the stop time came round.
    setTimeout(
      () => {
        for (const node of voice.nodes) {
          node.disconnect();
        }
        audio.disconnect();
        // Only a positional voice has a panner between its source and its gain.
        if (audio instanceof THREE.PositionalAudio) {
          audio.panner.disconnect();
        }
        audio.gain.disconnect();
      },
      (ROAR.fadeOut + 0.1) * 1000,
    );
  }

  dispose(): void {
    for (const audio of Array.from(this.voices.keys())) {
      this.release(audio);
    }
    if (this.disarm) {
      this.disarm();
      this.disarm = null;
    }
    this.listener.removeFromParent();
    const { listener, ctx, generation } = this;
    // Both deferred past the fade the releases above just started. Cutting the
    // master gain now would be silence a quarter of a second early, which is
    // exactly the discontinuity the fade exists to avoid.
    setTimeout(
      () => {
        // AudioListener wires its own gain straight to the destination, so
        // without this every modal open leaves another master on the speakers.
        listener.gain.disconnect();
        // Only if nobody has opened the dialog again in the meantime. The context
        // is shared and cached for the life of the page, so suspending it here
        // unconditionally would mute a scene that has already replaced this one.
        if (generation !== built) {
          return;
        }
        // Suspended, never closed — see the note at the top of this file.
        void ctx.suspend().catch(() => undefined);
      },
      (ROAR.fadeOut + 0.2) * 1000,
    );
  }

  /**
   * The tail every voice ends in, whatever built its head.
   *
   * `head` is where the source chain terminates and `cutoff` is the filter the
   * distance curve should sweep, or null for a voice that has nothing worth
   * sweeping. Everything from the fade gate down is identical between a rocket
   * and a hum, which is the whole reason this is one method.
   */
  /**
   * The tail every voice ends in, whatever built its head.
   *
   * `head` is where the source chain terminates; `cutoff` is the filter the
   * distance curve should sweep, or null for a voice with nothing worth
   * sweeping. Everything from the fade gate down is identical between a rocket
   * and a hum — including the registration, which is the line that would
   * silently diverge if each builder kept its own copy.
   *
   * Takes the audio object rather than making it, so each builder keeps its own
   * exact type and neither needs a cast.
   */
  private mount(
    audio: THREE.Audio<AudioNode>,
    spec: {
      head: AudioNode;
      cutoff: BiquadFilterNode | null;
      nodes: AudioNode[];
      sources: AudioScheduledSourceNode[];
      ceiling: number;
      fadeIn: number;
    },
  ): void {
    const ctx = this.ctx;

    // Opens once, on the first frames the context is actually running. It earns
    // its place twice over on the hum, which is at full level the instant the
    // dialog opens rather than orbiting into earshot the way a strip does.
    const gate = ctx.createGain();
    gate.gain.value = 0;
    spec.head.connect(gate);

    const out = ctx.createGain();
    out.gain.value = 0;
    gate.connect(out);

    spec.nodes.push(gate, out);
    audio.setNodeSource(out);

    // A suspended context has a frozen currentTime, so everything scheduled here
    // simply waits for arming. That is why there is no start/stop API: a voice
    // exists exactly as long as the component that asked for it renders.
    const now = ctx.currentTime;
    for (const source of spec.sources) {
      source.start(now);
    }
    gate.gain.setTargetAtTime(1, now, spec.fadeIn);

    this.voices.set(audio, {
      level: out,
      cutoff: spec.cutoff,
      sources: spec.sources,
      nodes: spec.nodes,
      ceiling: spec.ceiling,
      since: ROAR.interval,
      wrote: -1,
    });
  }

  /** Whether this voice is due a parameter write this frame, and the one thing
   *  that has to happen on every frame regardless. */
  private due(voice: Voice, delta: number): boolean {
    // three's AudioListener runs an unclamped timer, and the panner ramps toward
    // its new position across that interval using the value written on the
    // previous frame — the renderer updates the scene before the camera. Coming
    // back to a backgrounded tab hands over one enormous delta, exactly the
    // hazard MAX_DELTA exists for, and the stereo image would glide for seconds.
    // This runs between the write and the read, which is the only place the
    // value is reachable. three's types call it readonly and then three writes it
    // itself every frame, so a mutable view is not a cast around the type system
    // — it is clamping three's own working value, not adding state. With more
    // than one voice this now runs once per voice rather than once per frame,
    // which is harmless only because Math.min is idempotent.
    const timer: { timeDelta: number } = this.listener;
    timer.timeDelta = Math.min(timer.timeDelta, MAX_DELTA);

    voice.since += delta;
    if (voice.since < ROAR.interval) {
      return false;
    }
    voice.since = 0;
    return true;
  }

  /** Writes one nearness value into a voice: level always, brightness only if it
   *  has a filter worth sweeping. */
  private write(voice: Voice, t: number): void {
    const level = t * voice.ceiling;
    // setTargetAtTime is an unbounded exponential approach, so not re-issuing one
    // that has not changed keeps converging on the same target. An idle hum ends
    // up genuinely free rather than writing the same value twenty times a second.
    if (Math.abs(level - voice.wrote) < ROAR.epsilon) {
      return;
    }
    voice.wrote = level;
    const now = this.ctx.currentTime;
    voice.level.gain.setTargetAtTime(level, now, ROAR.glide.level);
    if (voice.cutoff) {
      voice.cutoff.frequency.setTargetAtTime(roarCutoff(t), now, ROAR.glide.cutoff);
    }
  }

  private modulate(
    hz: number,
    depth: number,
    target: AudioParam,
    nodes: AudioNode[],
  ): OscillatorNode {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz;
    const amp = this.ctx.createGain();
    amp.gain.value = depth;
    osc.connect(amp);
    amp.connect(target);
    // The oscillator as well as its gain: a stopped source is inert either way,
    // but leaving it out made the teardown contract say one thing and do another.
    nodes.push(osc, amp);
    return osc;
  }

  /**
   * White noise to loop, built once and shared by every voice.
   *
   * Web Audio has no noise node, so the standard answer is a buffer of random
   * samples played on repeat. The loop seam is inaudible for the same reason the
   * content is useful: one patch of white noise sounds like any other. A couple
   * of seconds at 48 kHz is a few hundred kilobytes, which is worth caching once
   * and not worth caching twice.
   */
  private white(): AudioBuffer {
    if (this.noise) {
      return this.noise;
    }
    const length = Math.floor(this.ctx.sampleRate * NOISE_SECONDS);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      samples[i] = Math.random() * 2 - 1;
    }
    this.noise = buffer;
    return buffer;
  }

  /** The saturator's transfer curve, built once and shared: it depends on
   *  nothing but the constants in ./tone.ts. */
  private shape(): Float32Array<ArrayBuffer> {
    if (!this.curve) {
      this.curve = saturationCurve();
    }
    return this.curve;
  }

  /**
   * Gets the context running, and keeps it that way.
   *
   * The dialog is opened by a click, so the first attempt usually succeeds on
   * the document's sticky activation. It cannot be relied on: the scene is
   * behind lazy(), so the mount can land well past the gesture on a cold cache,
   * and the atom that opens the dialog can be set with no pointer involved at
   * all. The listeners cover that, and are kept until the context reports itself
   * running rather than fired once, because a browser may suspend it again on
   * its own and the next click should bring it back.
   */
  private arm(): void {
    const ctx = this.ctx;
    // resume() rejects with NotAllowedError when there is no activation to spend,
    // and an unhandled rejection is a console error in every browser.
    const attempt = () => void Promise.resolve(ctx.resume()).catch(() => undefined);

    const settled = () => {
      if (ctx.state !== 'running') {
        return;
      }
      for (const type of GESTURES) {
        window.removeEventListener(type, attempt, true);
      }
      ctx.removeEventListener('statechange', settled);
    };

    for (const type of GESTURES) {
      window.addEventListener(type, attempt, { capture: true, passive: true });
    }
    ctx.addEventListener('statechange', settled);

    // requestAnimationFrame stops in a hidden tab but Web Audio does not, so
    // without this the tab holds whatever note it last reached, indefinitely,
    // while the user is somewhere else entirely.
    const visibility = () => {
      if (document.hidden) {
        void ctx.suspend().catch(() => undefined);
        return;
      }
      attempt();
    };
    document.addEventListener('visibilitychange', visibility);

    this.disarm = () => {
      for (const type of GESTURES) {
        window.removeEventListener(type, attempt, true);
      }
      ctx.removeEventListener('statechange', settled);
      document.removeEventListener('visibilitychange', visibility);
    };

    attempt();
  }
}

/**
 * A bus, or null if this browser will not give us one.
 *
 * Chrome caps a page at six hardware AudioContexts and throws NotSupportedError
 * on the seventh, which is genuinely reachable here: useSpeechToTextExternal
 * creates one per voice recording and never closes it. The bus is built during
 * render, so an uncaught throw would trip Boundary and replace the whole
 * visualisation with an error state over a sound effect. Callers treat null as
 * ordinary and simply stay silent.
 */
export function createToneBus(camera: THREE.Camera): ToneBus | null {
  try {
    return new ToneBus(camera);
  } catch {
    return null;
  }
}
