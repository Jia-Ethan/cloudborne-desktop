/**
 * SwiftUI-style damped harmonic spring physics, sub-stepped at 240Hz so stiff
 * springs stay rock-solid even on slow frames or 60Hz/120Hz switches.
 */

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

export const rand = (min: number, max: number): number => min + Math.random() * (max - min);

export class Spring {
  x: number;
  to: number;
  v: number;
  k = 0;
  c = 0;

  constructor(initial: number, response = 0.5, bounce = 0) {
    this.x = initial;
    this.to = initial;
    this.v = 0;
    this.set(response, bounce);
  }

  /** Re-tune stiffness and damping from SwiftUI's (response, bounce) pair. */
  set(response: number, bounce = 0): this {
    const r = Math.max(0.02, response);
    this.k = ((2 * Math.PI) / r) ** 2;
    this.c = (4 * Math.PI * (1 - bounce)) / r;
    return this;
  }

  /** Freeze springs so external parametric motion (e.g. orbit) can own `x`. */
  free(): this {
    this.k = 0;
    this.c = 0;
    this.v = 0;
    return this;
  }

  /** Instantly snap position and target with zero velocity. */
  snap(value: number): this {
    this.x = value;
    this.to = value;
    this.v = 0;
    return this;
  }

  /** Integrate one small substep of duration `h` seconds. */
  step(h: number): void {
    if (this.k === 0 && this.c === 0) return;
    this.v += (this.k * (this.to - this.x) - this.c * this.v) * h;
    this.x += this.v * h;
  }

  /** True when close enough to target with negligible velocity to sleep. */
  settled(epsPos = 0.02, epsVel = 0.05): boolean {
    return Math.abs(this.to - this.x) <= epsPos && Math.abs(this.v) <= epsVel;
  }
}

export type Pose<K extends string> = Record<K, Spring>;

export function createPose<K extends string>(init: Record<K, number>, response = 0.5, bounce = 0): Pose<K> {
  const out = {} as Pose<K>;
  for (const key in init) {
    out[key] = new Spring(init[key], response, bounce);
  }
  return out;
}

/** Advance a list of springs using 240Hz sub-stepping. */
export function stepSprings(springs: readonly Spring[], dt: number): void {
  const clamped = Math.min(0.05, Math.max(0, dt));
  if (clamped <= 0) return;
  const substeps = Math.max(1, Math.ceil(clamped * 240));
  const h = clamped / substeps;
  for (let i = 0; i < substeps; i++) {
    for (let j = 0; j < springs.length; j++) {
      springs[j].step(h);
    }
  }
}

/** Returns true when every spring in the list has settled. */
export function allSettled(springs: readonly Spring[], epsPos = 0.02, epsVel = 0.05): boolean {
  for (let i = 0; i < springs.length; i++) {
    if (!springs[i].settled(epsPos, epsVel)) return false;
  }
  return true;
}
