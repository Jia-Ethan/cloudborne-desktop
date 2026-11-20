/**
 * Procedural Web Audio foley & chimes for card pack tearing and card inspection.
 * Zero external audio assets — synthesized on the fly with a velocity-coupled
 * on-demand foil-rip generator, a lightweight dual-tap stereo shimmer reverb
 * (replacing FFT ConvolverNode so macOS WKWebView's GPUProcess stays stutter-free),
 * and a C-major pentatonic harmonic palette.
 */

import { useSyncExternalStore } from 'react';
import type { Rarity } from '../api';
import { clamp } from './spring';

const STORAGE_KEY = 'cloudborne.lottery.sound';
const VOLUME = 0.72;

// C5 major pentatonic steps: C5, D5, E5, G5, A5, C6, ...
const pentatonic = (step: number): number => {
  const octave = Math.floor(step / 5);
  const degree = ((step % 5) + 5) % 5;
  const semitone = [0, 2, 4, 7, 9][degree];
  return 440 * 2 ** ((72 + 12 * octave + semitone - 69) / 12);
};

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let enabled = readInitial();
const listeners = new Set<() => void>();

export function lotterySoundOn(): boolean {
  return enabled;
}

export function setLotterySoundOn(next: boolean): void {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
  } catch {
    /* private mode */
  }
  engine?.setMuted(!next);
  if (next) unlockLotterySound();
  listeners.forEach((fn) => fn());
}

export function useLotterySoundOn(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    lotterySoundOn,
    lotterySoundOn,
  );
}

interface SoundEngine {
  ctx: AudioContext;
  setMuted: (off: boolean) => void;
  rip: (velocity: number) => void;
  grab: () => void;
  tugStart: () => void;
  phew: () => void;
  boing: () => void;
  nope: () => void;
  pop: (rarity: Rarity, animated: boolean) => void;
  swirl: (durationSec: number) => void;
  land: (rarity: Rarity, mystery: boolean, slot: number, total: number) => void;
  flip: (rarity: Rarity, slot: number, total: number) => void;
  lift: (slot: number, total: number) => void;
  tick: () => void;
  arrive: () => void;
}

let engine: SoundEngine | null = null;

function buildEngine(ctx: AudioContext): SoundEngine {
  const sr = ctx.sampleRate;
  const now = () => ctx.currentTime;

  const master = ctx.createGain();
  master.gain.value = enabled ? VOLUME : 0;
  master.connect(ctx.destination);

  // Lightweight dual-tap damped stereo delay bus (warm room tail with negligible CPU vs FFT ConvolverNode).
  const reverbIn = ctx.createGain();
  const tapL = ctx.createDelay(0.2);
  const tapR = ctx.createDelay(0.2);
  tapL.delayTime.value = 0.048;
  tapR.delayTime.value = 0.079;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 3200;
  const fb = ctx.createGain();
  fb.gain.value = 0.24;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;

  reverbIn.connect(tapL);
  reverbIn.connect(tapR);
  tapL.connect(damp);
  tapR.connect(damp);
  damp.connect(wet).connect(master);
  damp.connect(fb).connect(reverbIn);

  const makeBuffer = (seconds: number, fill: (d: Float32Array) => void) => {
    const buf = ctx.createBuffer(1, Math.floor(seconds * sr), sr);
    fill(buf.getChannelData(0));
    return buf;
  };

  // White noise sheet for air swooshes & cardstock slides.
  const hiss = makeBuffer(0.8, (d) => {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  });

  // Crisp decaying foil micro-folds: slow playback reveals discrete crackles; fast playback merges into a rip.
  const foil = makeBuffer(0.8, (d) => {
    for (let n = 0; n < 360; n++) {
      const start = Math.floor(Math.random() * (d.length - 260));
      const amp = Math.random() ** 3 * (Math.random() < 0.5 ? -1 : 1);
      const len = Math.floor(24 + Math.random() * 180);
      for (let i = 0; i < len; i++) {
        d[start + i] += amp * (Math.random() * 2 - 1) * Math.exp((-i / len) * 5);
      }
    }
  });

  const env = (param: AudioParam, at: number, peak: number, attack: number, dur: number) => {
    param.setValueAtTime(0.0001, at);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    param.exponentialRampToValueAtTime(0.0001, at + dur);
  };

  const route = (node: AudioNode, send = 0) => {
    node.connect(master);
    if (send > 0.2) node.connect(reverbIn);
  };

  const panFor = (slot: number, total: number) => {
    if (total <= 1) return 0;
    return clamp(((slot / (total - 1)) * 2 - 1) * 0.45, -0.65, 0.65);
  };

  function air(opts: {
    at?: number;
    buffer?: AudioBuffer;
    type?: BiquadFilterType;
    from: number;
    to: number;
    Q?: number;
    gain: number;
    attack?: number;
    dur: number;
    send?: number;
    pan?: [number, number];
  }) {
    const at = opts.at ?? now();
    const s = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    s.buffer = opts.buffer ?? hiss;
    s.loop = true;
    f.type = opts.type ?? 'bandpass';
    f.Q.value = opts.Q ?? 1;
    f.frequency.setValueAtTime(opts.from, at);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), at + opts.dur);
    env(g.gain, at, opts.gain, opts.attack ?? 0.004, opts.dur);

    const pan = opts.pan;
    if (pan && (pan[0] !== 0 || pan[1] !== 0)) {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(pan[0], at);
      if (pan[1] !== pan[0]) p.pan.linearRampToValueAtTime(pan[1], at + opts.dur);
      s.connect(f).connect(g).connect(p);
      route(p, opts.send ?? 0);
      s.onended = () => {
        s.disconnect();
        f.disconnect();
        g.disconnect();
        p.disconnect();
      };
    } else {
      s.connect(f).connect(g);
      route(g, opts.send ?? 0);
      s.onended = () => {
        s.disconnect();
        f.disconnect();
        g.disconnect();
      };
    }
    s.start(at, Math.random() * 0.6);
    s.stop(at + opts.dur + 0.02);
  }

  function chime(freq: number, opts: { at?: number; gain?: number; dur?: number; send?: number; pan?: number } = {}) {
    const at = opts.at ?? now();
    const dur = Math.max(0.05, opts.dur ?? 0.5);
    const out = opts.pan ? ctx.createStereoPanner() : ctx.createGain();
    if (out instanceof StereoPannerNode) out.pan.value = opts.pan ?? 0;
    route(out, opts.send ?? 0.5);

    const baseGain = opts.gain ?? 0.085;
    // Fundamental + bright bell overtone (2 oscillators instead of 3 for lower audio-thread pressure).
    for (const [ratio, level, life] of [
      [1, baseGain, 1],
      [3.9, baseGain * 0.2, 0.24],
    ]) {
      const o = ctx.createOscillator();
      const a = ctx.createGain();
      const d = Math.max(0.03, dur * life);
      o.frequency.value = freq * ratio;
      env(a.gain, at, level, 0.002, d);
      o.connect(a).connect(out);
      o.onended = () => {
        o.disconnect();
        a.disconnect();
        if (ratio === 1) out.disconnect();
      };
      o.start(at);
      o.stop(at + d + 0.02);
    }
  }

  function tone(
    freq: number,
    shape: [number, number][],
    opts: { at?: number; gain?: number; attack?: number; send?: number; pan?: number; wave?: OscillatorType } = {},
  ) {
    const at = opts.at ?? now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const dur = shape[shape.length - 1][0] + 0.05;
    o.type = opts.wave ?? 'triangle';
    for (const [sec, mult] of shape) {
      if (sec === 0) o.frequency.setValueAtTime(freq * mult, at);
      else o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * mult), at + sec);
    }
    env(g.gain, at, opts.gain ?? 0.06, opts.attack ?? 0.008, dur);
    o.connect(g);
    route(g, opts.send ?? 0.25);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  const sparkle = (count: number, at: number, spread: number, level: number) => {
    const capped = Math.min(count, 5);
    for (let i = 0; i < capped; i++) {
      chime(pentatonic(8 + Math.floor(Math.random() * 5)), {
        at: at + Math.random() ** 1.4 * spread,
        gain: level * (0.6 + Math.random() * 0.8),
        dur: 0.32,
        send: 0.7,
        pan: Math.random() * 1.4 - 0.7,
      });
    }
  };

  // On-demand foil-rip generator: only runs while actively tearing.
  const ripShape = ctx.createBiquadFilter();
  const ripTop = ctx.createBiquadFilter();
  const ripGain = ctx.createGain();
  ripShape.type = 'bandpass';
  ripShape.Q.value = 0.6;
  ripTop.type = 'lowpass';
  ripTop.frequency.value = 6000;
  ripGain.gain.value = 0;
  ripShape.connect(ripTop).connect(ripGain);
  ripGain.connect(master);

  let ripBody: AudioBufferSourceNode | null = null;
  let ripStopTimer: ReturnType<typeof setTimeout> | null = null;
  let level = 0;
  let lastLiftAt = 0;

  const stopRipSource = () => {
    if (ripStopTimer) {
      clearTimeout(ripStopTimer);
      ripStopTimer = null;
    }
    if (ripBody) {
      try {
        ripBody.stop();
        ripBody.disconnect();
      } catch {
        /* already stopped */
      }
      ripBody = null;
    }
  };

  return {
    ctx,
    setMuted(off) {
      master.gain.setTargetAtTime(off ? 0 : VOLUME, now(), 0.015);
    },
    rip(v) {
      const clamped = clamp(v, 0, 1);
      if (Math.abs(clamped - level) < 0.01 && (clamped > 0 || level === 0)) return;
      const rising = clamped > level;
      level = clamped;
      const at = now();
      if (clamped > 0.01) {
        if (ripStopTimer) {
          clearTimeout(ripStopTimer);
          ripStopTimer = null;
        }
        if (!ripBody) {
          const src = ctx.createBufferSource();
          src.buffer = foil;
          src.loop = true;
          src.connect(ripShape);
          src.start(at, Math.random() * 0.5);
          ripBody = src;
        }
        ripGain.gain.setTargetAtTime(clamped ** 0.8 * 0.17, at, rising ? 0.008 : 0.05);
        ripShape.frequency.setTargetAtTime(1800 + 2100 * clamped, at, 0.02);
        ripBody.playbackRate.setTargetAtTime(0.7 + 0.85 * clamped, at, 0.02);
      } else {
        ripGain.gain.setTargetAtTime(0, at, 0.03);
        if (ripBody && !ripStopTimer) {
          ripStopTimer = setTimeout(stopRipSource, 140);
        }
      }
    },
    grab() {
      air({ buffer: foil, from: 3000, to: 2100, Q: 0.7, gain: 0.28, attack: 0.003, dur: 0.09 });
    },
    tugStart() {
      tone(1180, [[0, 0.85], [0.05, 1.2], [0.12, 1.04]], { gain: 0.036, wave: 'sine', send: 0.35 });
    },
    phew() {
      tone(880, [[0, 1.08], [0.22, 0.62]], { gain: 0.04, send: 0.4, wave: 'sine' });
      air({ from: 1500, to: 700, Q: 0.6, gain: 0.028, attack: 0.02, dur: 0.24 });
    },
    boing() {
      tone(330, [[0, 0.8], [0.05, 1.55], [0.12, 0.85], [0.2, 1.22], [0.3, 1]], { gain: 0.1, send: 0.2 });
    },
    nope() {
      tone(190, [[0, 1], [0.1, 0.68]], { gain: 0.09, attack: 0.004, send: 0, wave: 'triangle' });
    },
    pop(rarity, animated) {
      const at = now();
      air({ at, from: 5000, to: 1800, Q: 0.9, gain: 0.14, attack: 0.002, dur: 0.1 });
      tone(300, [[0, 0.8], [0.05, 3.4]], { at, gain: 0.24, send: 0 });
      if (!animated) return;
      air({ at: at + 0.01, from: 500, to: 3200, Q: 0.8, gain: 0.09, attack: 0.18, dur: 0.64, send: 0.5 });
      tone(540, [[0, 1], [0.55, 2.8]], { at: at + 0.02, gain: 0.026, attack: 0.2, send: 0.45, wave: 'sine' });
      if (rarity === 'legendary') sparkle(5, at + 0.08, 0.6, 0.03);
      else if (rarity === 'epic') sparkle(4, at + 0.1, 0.5, 0.024);
      else sparkle(2, at + 0.12, 0.4, 0.016);
    },
    swirl(len) {
      air({
        from: 700,
        to: 1800,
        Q: 0.9,
        gain: 0.11,
        attack: len * 0.4,
        dur: len,
        send: 0.35,
        pan: [-0.55, 0.55],
      });
    },
    land(rarity, mystery, slot, total) {
      const at = now();
      const pan = panFor(slot, total);
      // In large batches, stagger only every other cardstock thud to avoid audio-node burst.
      if (total <= 5 || slot % 2 === 0 || mystery) {
        air({ at, from: 2600, to: 1300, Q: 0.6, gain: 0.065, attack: 0.002, dur: 0.05, pan: [pan, pan] });
      }
      if (mystery) {
        const freq = rarity === 'legendary' ? pentatonic(5) : pentatonic(3);
        chime(freq, { at: at + 0.04, gain: 0.045, dur: 0.42, send: 0.65, pan });
        return;
      }
      if (rarity === 'legendary') {
        [0, 2, 4, 5, 7].forEach((step, idx) =>
          chime(pentatonic(step + 2), { at: at + 0.04 + idx * 0.065, gain: 0.075, dur: 0.85, send: 0.75, pan }),
        );
        sparkle(4, at + 0.15, 0.5, 0.026);
      } else if (rarity === 'epic') {
        chime(pentatonic(4), { at: at + 0.04, gain: 0.065, dur: 0.65, send: 0.65, pan });
        chime(pentatonic(7), { at: at + 0.11, gain: 0.06, dur: 0.7, send: 0.7, pan });
      } else if (rarity === 'rare' && (total <= 5 || slot % 2 === 0)) {
        chime(pentatonic(5), { at: at + 0.04, gain: 0.042, dur: 0.42, send: 0.45, pan });
      }
    },
    flip(rarity, slot, total) {
      const at = now();
      const pan = panFor(slot, total);
      air({ at, from: 1100, to: 3400, Q: 0.85, gain: 0.1, attack: 0.015, dur: 0.2, send: 0.35, pan: [pan, pan] });
      if (rarity === 'legendary') {
        [0, 2, 4, 5, 7, 9].forEach((step, idx) =>
          chime(pentatonic(step + 2), { at: at + 0.06 + idx * 0.06, gain: 0.08, dur: 0.95, send: 0.8, pan }),
        );
        sparkle(5, at + 0.14, 0.6, 0.028);
      } else if (rarity === 'epic') {
        [2, 4, 7].forEach((step, idx) =>
          chime(pentatonic(step + 2), { at: at + 0.05 + idx * 0.065, gain: 0.068, dur: 0.72, send: 0.7, pan }),
        );
        sparkle(3, at + 0.12, 0.42, 0.022);
      } else {
        chime(pentatonic(5), { at: at + 0.05, gain: 0.05, dur: 0.42, send: 0.45, pan });
      }
    },
    lift(slot, total) {
      // Rate-limit hover cardstock swooshes during rapid sweeps across 10 cards.
      const t = performance.now();
      if (t - lastLiftAt < 85) return;
      lastLiftAt = t;
      const pan = panFor(slot, total);
      air({ type: 'lowpass', from: 760, to: 480, Q: 0.3, gain: 0.038, attack: 0.04, dur: 0.18, pan: [pan, pan] });
    },
    tick() {
      tone(880, [[0, 0.9], [0.05, 1.12]], { gain: 0.036, send: 0 });
    },
    arrive() {
      const at = now();
      air({ at, from: 900, to: 2600, gain: 0.055, attack: 0.26, dur: 0.68, send: 0.35, pan: [0.65, 0] });
      air({ at: at + 0.65, buffer: foil, from: 3000, to: 2200, Q: 0.7, gain: 0.14, attack: 0.003, dur: 0.09 });
      tone(pentatonic(3), [[0, 0.92], [0.05, 1.03]], { at: at + 0.72, gain: 0.04, wave: 'sine' });
      tone(pentatonic(5), [[0, 0.92], [0.06, 1.03]], { at: at + 0.8, gain: 0.04, wave: 'sine' });
    },
  };
}

function ensureEngine(): SoundEngine | null {
  if (typeof window === 'undefined' || !enabled) return null;
  if (engine) return engine;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = new AC({ latencyHint: 'balanced' });
    engine = buildEngine(ctx);
    return engine;
  } catch {
    engine = null;
    return null;
  }
}

/** Pre-allocates the AudioContext and procedural buffers off the critical click path. */
export function warmLotterySound(): void {
  ensureEngine();
}

export function unlockLotterySound(): void {
  const eng = ensureEngine();
  if (!eng) return;
  if (eng.ctx.state === 'suspended') void eng.ctx.resume().catch(() => {});
}

function safeCall<K extends keyof Omit<SoundEngine, 'ctx' | 'setMuted'>>(
  fn: K,
  ...args: Parameters<SoundEngine[K]>
): void {
  if (!enabled) return;
  if (!engine) unlockLotterySound();
  if (!engine) return;
  if (engine.ctx.state === 'suspended') void engine.ctx.resume().catch(() => {});
  try {
    (engine[fn] as (...a: unknown[]) => void)(...args);
  } catch {
    /* audio must never interrupt animation */
  }
}

export const lotterySfx = {
  unlock: unlockLotterySound,
  rip: (v: number) => {
    if (!engine) return;
    try {
      engine.rip(enabled ? v : 0);
    } catch {
      /* ignore */
    }
  },
  grab: () => safeCall('grab'),
  tugStart: () => safeCall('tugStart'),
  phew: () => safeCall('phew'),
  boing: () => safeCall('boing'),
  nope: () => safeCall('nope'),
  pop: (rarity: Rarity, animated = true) => safeCall('pop', rarity, animated),
  swirl: (dur: number) => safeCall('swirl', dur),
  land: (rarity: Rarity, mystery: boolean, slot: number, total: number) => safeCall('land', rarity, mystery, slot, total),
  flip: (rarity: Rarity, slot: number, total: number) => safeCall('flip', rarity, slot, total),
  lift: (slot: number, total: number) => safeCall('lift', slot, total),
  tick: () => safeCall('tick'),
  arrive: () => safeCall('arrive'),
};
