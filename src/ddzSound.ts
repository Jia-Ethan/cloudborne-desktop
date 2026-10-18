// Table sounds for 斗地主, synthesized with WebAudio so nothing ships as a
// file. The context is created on the first user gesture (browsers refuse to
// start audio before one), and every cue is a few short oscillators or a
// burst of filtered noise through one master gain.

import { useSyncExternalStore } from 'react';
import type { Kind } from './ddz';

const KEY = 'cloudborne.ddz.sound';
const VOLUME = 0.35;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
const listeners = new Set<() => void>();

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}
let on = readOn();

export function soundOn() {
  return on;
}

export function setSoundOn(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    /* private mode: keep it for this session */
  }
  if (next) unlock();
  listeners.forEach((f) => f());
}

export function useSoundOn() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    soundOn,
    soundOn,
  );
}

/** Creates or resumes the context; call from a user gesture. */
export function unlock() {
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

if (typeof window !== 'undefined') {
  const first = () => {
    unlock();
    window.removeEventListener('pointerdown', first, true);
    window.removeEventListener('keydown', first, true);
  };
  window.addEventListener('pointerdown', first, true);
  window.addEventListener('keydown', first, true);
}

function ready(): AudioContext | null {
  if (!on || !ctx || !master || ctx.state !== 'running') return null;
  return ctx;
}

type Tone = { f: number; to?: number; at?: number; dur: number; gain?: number; type?: OscillatorType };

function tone(c: AudioContext, { f, to, at = 0, dur, gain = 0.5, type = 'sine' }: Tone) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

type Hiss = { at?: number; dur: number; gain?: number; freq: number; to?: number; q?: number; filter?: BiquadFilterType };

function hiss(c: AudioContext, { at = 0, dur, gain = 0.4, freq, to, q = 0.8, filter = 'bandpass' }: Hiss) {
  const t = c.currentTime + at;
  const s = c.createBufferSource();
  s.buffer = noise;
  const bq = c.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(freq, t);
  if (to) bq.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(bq).connect(g).connect(master!);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

/** A card laid on the table: a soft paper slap. */
function slap(c: AudioContext, at = 0, gain = 0.35) {
  hiss(c, { at, dur: 0.07, gain, freq: 2400, q: 0.7 });
  tone(c, { at, f: 220, to: 140, dur: 0.06, gain: gain * 0.5, type: 'triangle' });
}

function boom(c: AudioContext, at = 0, big = false) {
  tone(c, { at, f: big ? 120 : 95, to: 34, dur: big ? 0.9 : 0.65, gain: 0.95, type: 'sine' });
  hiss(c, { at, dur: big ? 0.8 : 0.55, gain: 0.7, freq: 900, to: 120, q: 0.5, filter: 'lowpass' });
  hiss(c, { at, dur: 0.12, gain: 0.45, freq: 3200, q: 0.6 });
}

export type Cue = 'turn' | 'pass' | 'skill' | 'win' | 'lose' | 'select';

export function cue(name: Cue) {
  const c = ready();
  if (!c) return;
  switch (name) {
    case 'turn':
      tone(c, { f: 880, dur: 0.16, gain: 0.22 });
      tone(c, { f: 1320, at: 0.09, dur: 0.22, gain: 0.18 });
      break;
    case 'pass':
      tone(c, { f: 330, to: 260, dur: 0.12, gain: 0.16, type: 'triangle' });
      break;
    case 'select':
      tone(c, { f: 1500, dur: 0.035, gain: 0.07, type: 'triangle' });
      break;
    case 'skill':
      [784, 1047, 1319, 1568].forEach((f, i) => tone(c, { f, at: i * 0.05, dur: 0.45, gain: 0.16, type: 'sine' }));
      hiss(c, { dur: 0.5, gain: 0.12, freq: 5000, to: 9000, q: 2 });
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(c, { f, at: i * 0.09, dur: 0.5, gain: 0.24, type: 'triangle' }));
      tone(c, { f: 1568, at: 0.36, dur: 0.7, gain: 0.14 });
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) => tone(c, { f, at: i * 0.13, dur: 0.42, gain: 0.2, type: 'triangle' }));
      break;
  }
}

/** The sound of a play, by its shape; `n` is how many cards. */
export function playSound(kind: Kind, n: number) {
  const c = ready();
  if (!c) return;
  switch (kind) {
    case 'straight':
    case 'pair_straight': {
      // Dominoes: one slap per card, the pitch stepping up a scale.
      const scale = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];
      const steps = kind === 'straight' ? n : n / 2;
      for (let i = 0; i < steps; i++) {
        slap(c, i * 0.045, 0.22);
        tone(c, { f: 440 * 2 ** (scale[Math.min(i, scale.length - 1)] / 12), at: i * 0.045, dur: 0.16, gain: 0.12, type: 'triangle' });
      }
      break;
    }
    case 'plane':
    case 'plane_singles':
    case 'plane_pairs':
      hiss(c, { dur: 0.7, gain: 0.5, freq: 400, to: 3200, q: 1.4 });
      tone(c, { f: 180, to: 520, dur: 0.6, gain: 0.12, type: 'sawtooth' });
      slap(c, 0.42, 0.3);
      break;
    case 'bomb':
    case 'four_singles':
    case 'four_pairs':
      if (kind === 'bomb') {
        boom(c, 0.08);
      } else {
        slap(c);
        tone(c, { f: 160, to: 90, dur: 0.25, gain: 0.3 });
      }
      break;
    case 'rocket':
      hiss(c, { dur: 0.55, gain: 0.45, freq: 300, to: 4000, q: 1.2 });
      tone(c, { f: 200, to: 1400, dur: 0.5, gain: 0.16, type: 'sawtooth' });
      boom(c, 0.5, true);
      break;
    case 'trio':
    case 'trio_single':
    case 'trio_pair':
      slap(c, 0, 0.3);
      slap(c, 0.05, 0.3);
      tone(c, { f: 392, dur: 0.18, gain: 0.12, type: 'triangle' });
      break;
    default:
      slap(c, 0, kind === 'pair' ? 0.4 : 0.32);
  }
}

/** One step of the result's multiplier climbing: higher each time. */
export function climbTick(i: number, times: boolean) {
  const c = ready();
  if (!c) return;
  const f = 523 * 2 ** (Math.min(i, 14) / 12);
  tone(c, { f, dur: 0.14, gain: 0.16, type: times ? 'square' : 'triangle' });
  if (times) tone(c, { f: f * 1.5, at: 0.03, dur: 0.16, gain: 0.08 });
}
