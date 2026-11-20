// Hand-rolled canvas effects for the lucky draw & DDZ: radial particle bursts,
// falling confetti, perspective pack confetti, gold coin rain, and lightning.
// PackPortal drives all effects through `createFxEngine` on ONE shared canvas
// with ONE rAF loop (zero idle GPU compositing, zero ctx.filter, zero shadowBlur).

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  spin: number;
  angle: number;
  shape: 0 | 1;
};

type FxLayer = {
  kind: 'packConfetti' | 'burst' | 'confetti' | 'coinRain' | 'lightning';
  step: (ctx: CanvasRenderingContext2D, dtFrame: number, dpr: number, width: number, height: number) => boolean;
};

const MAX_FX_DPR = 1.5;

function fit(canvas: HTMLCanvasElement, maxDpr = MAX_FX_DPR) {
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const { width, height } = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
}

function loop(step: (dt: number) => boolean, done: () => void) {
  let last = performance.now();
  let id = 0;
  let stopped = false;
  const frame = (now: number) => {
    if (stopped) return;
    const dt = Math.min(48, now - last) / 16.67;
    last = now;
    if (step(dt)) id = requestAnimationFrame(frame);
    else done();
  };
  id = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(id);
    done();
  };
}

/** A gold coin drawn once (lit & shaded variants) so coinRain never touches `ctx.filter`. */
let cachedCoins: { lit: HTMLCanvasElement; dark: HTMLCanvasElement } | null = null;
function coinSprites(): { lit: HTMLCanvasElement; dark: HTMLCanvasElement } {
  if (cachedCoins) return cachedCoins;
  const draw = (shade: boolean) => {
    const s = 64;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    if (!g) return c;
    const body = g.createRadialGradient(s * 0.38, s * 0.32, 2, s / 2, s / 2, s / 2);
    body.addColorStop(0, shade ? '#d9cf9f' : '#fff6c8');
    body.addColorStop(0.45, shade ? '#cfa738' : '#ffd34d');
    body.addColorStop(1, shade ? '#8c5c16' : '#b7791f');
    g.fillStyle = body;
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = shade ? 'rgba(92,55,7,0.75)' : 'rgba(122,74,10,0.75)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = shade ? 'rgba(92,55,7,0.9)' : 'rgba(122,74,10,0.9)';
    g.font = `800 ${s * 0.42}px -apple-system, "PingFang SC", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('$', s / 2, s / 2 + 2);
    return c;
  };
  cachedCoins = { lit: draw(false), dark: draw(true) };
  return cachedCoins;
}

function makeBurstLayer(opts: { x: number; y: number; colors: readonly string[]; count: number; power: number }): FxLayer {
  const ps: Particle[] = Array.from({ length: opts.count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = (0.35 + Math.random() * 0.65) * opts.power;
    const max = 46 + Math.random() * 36;
    return {
      x: opts.x,
      y: opts.y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - opts.power * 0.25,
      life: max,
      max,
      size: 1.5 + Math.random() * 3,
      color: opts.colors[Math.floor(Math.random() * opts.colors.length)],
      spin: 0,
      angle: 0,
      shape: Math.random() < 0.3 ? 1 : 0,
    };
  });
  return {
    kind: 'burst',
    step(ctx, dt, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      let alive = 0;
      for (const p of ps) {
        if (p.life <= 0) continue;
        alive++;
        p.life -= dt;
        p.vx *= 0.965 ** dt;
        p.vy = p.vy * 0.965 ** dt + 0.09 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = Math.max(0, p.life / p.max);
        ctx.globalAlpha = k;
        ctx.fillStyle = p.color;
        if (p.shape) {
          const s = p.size * 2.2 * k + 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - s);
          ctx.lineTo(p.x + s * 0.28, p.y);
          ctx.lineTo(p.x, p.y + s);
          ctx.lineTo(p.x - s * 0.28, p.y);
          ctx.closePath();
          ctx.moveTo(p.x - s, p.y);
          ctx.lineTo(p.x, p.y + s * 0.28);
          ctx.lineTo(p.x + s, p.y);
          ctx.lineTo(p.x, p.y - s * 0.28);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      return alive > 0;
    },
  };
}

function makeConfettiLayer(opts: { colors: readonly string[]; ms: number }, width: number, height: number): FxLayer {
  const start = performance.now();
  const ps: Particle[] = [];
  const spawn = (n: number, fromTop: boolean) => {
    for (let i = 0; i < n; i++) {
      ps.push({
        x: fromTop ? Math.random() * width : width / 2 + (Math.random() - 0.5) * width * 0.3,
        y: fromTop ? -20 - Math.random() * height * 0.3 : height * 0.45,
        vx: fromTop ? (Math.random() - 0.5) * 2 : (Math.random() - 0.5) * 16,
        vy: fromTop ? 1.5 + Math.random() * 2.5 : -6 - Math.random() * 9,
        life: 1,
        max: 1,
        size: 5 + Math.random() * 6,
        color: opts.colors[Math.floor(Math.random() * opts.colors.length)],
        spin: (Math.random() - 0.5) * 0.3,
        angle: Math.random() * Math.PI,
        shape: Math.random() < 0.5 ? 1 : 0,
      });
    }
  };
  spawn(80, false);
  return {
    kind: 'confetti',
    step(ctx, dt, dpr, _w, h) {
      const t = performance.now() - start;
      if (t < opts.ms * 0.5 && ps.length < 200) spawn(3, true);
      const fade = t > opts.ms ? Math.max(0, 1 - (t - opts.ms) / 550) : 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = fade;
      let visible = 0;
      for (const p of ps) {
        p.vy = Math.min(p.vy + 0.18 * dt, 4.2);
        p.vx *= 0.99 ** dt;
        p.x += (p.vx + Math.sin((t + p.size * 300) / 380) * 0.6) * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;
        if (p.y > h + 30) continue;
        visible++;
        const ca = Math.cos(p.angle);
        const sa = Math.sin(p.angle);
        const sy = Math.abs(Math.cos(p.angle * 1.7)) * 0.8 + 0.2;
        ctx.setTransform(dpr * ca, dpr * sa, -dpr * sa * sy, dpr * ca * sy, p.x * dpr, p.y * dpr);
        ctx.fillStyle = p.color;
        if (p.shape) {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      return fade > 0 && (visible > 0 || t < opts.ms * 0.55);
    },
  };
}

function makeCoinRainLayer(ms: number, width: number, height: number): FxLayer {
  const { lit, dark } = coinSprites();
  const start = performance.now();
  type C = { x: number; y: number; vx: number; vy: number; size: number; spin: number; vs: number; tilt: number };
  const cs: C[] = [];
  const spawn = (burst: boolean) =>
    cs.push({
      x: burst ? width / 2 + (Math.random() - 0.5) * 120 : Math.random() * width,
      y: burst ? height * 0.42 : -40,
      vx: burst ? (Math.random() - 0.5) * 14 : (Math.random() - 0.5) * 1.5,
      vy: burst ? -8 - Math.random() * 10 : 2 + Math.random() * 3,
      size: 14 + Math.random() * 14,
      spin: Math.random() * Math.PI,
      vs: 0.12 + Math.random() * 0.2,
      tilt: (Math.random() - 0.5) * 0.6,
    });
  for (let i = 0; i < 16; i++) spawn(true);
  return {
    kind: 'coinRain',
    step(ctx, dt, dpr, _w, h) {
      const t = performance.now() - start;
      if (t < ms * 0.55 && cs.length < 60 && Math.random() < 0.24 * dt) spawn(false);
      const fade = t > ms ? Math.max(0, 1 - (t - ms) / 500) : 1;
      ctx.globalCompositeOperation = 'source-over';
      let visible = 0;
      for (const c of cs) {
        c.vy = Math.min(c.vy + 0.32 * dt, 9);
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.spin += c.vs * dt;
        if (c.y > h + 40) continue;
        visible++;
        const sx = Math.cos(c.spin);
        const scaleX = Math.max(0.08, Math.abs(sx));
        const ct = Math.cos(c.tilt);
        const st = Math.sin(c.tilt);
        ctx.globalAlpha = fade * (0.75 + 0.25 * Math.abs(sx));
        ctx.setTransform(dpr * ct * scaleX, dpr * st * scaleX, -dpr * st, dpr * ct, c.x * dpr, c.y * dpr);
        ctx.drawImage(sx < 0 ? dark : lit, -c.size / 2, -c.size / 2, c.size, c.size);
      }
      ctx.globalAlpha = 1;
      return fade > 0 && (visible > 0 || t < ms * 0.6);
    },
  };
}

function makeLightningLayer(opts: { x: number; y: number; colors: readonly string[]; ms: number }): FxLayer {
  const start = performance.now();
  let bolts: { pts: [number, number][]; color: string; w: number }[] = [];
  let next = 0;
  const bolt = (x: number, y: number, a: number, len: number, depth: number): [number, number][] => {
    let pts: [number, number][] = [
      [x, y],
      [x + Math.cos(a) * len, y + Math.sin(a) * len],
    ];
    let jitter = len * 0.22;
    for (let d = 0; d < depth; d++) {
      const out: [number, number][] = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        out.push([(x0 + x1) / 2 + (Math.random() - 0.5) * jitter, (y0 + y1) / 2 + (Math.random() - 0.5) * jitter], pts[i]);
      }
      pts = out;
      jitter *= 0.55;
    }
    return pts;
  };
  return {
    kind: 'lightning',
    step(ctx, _dt, dpr) {
      const t = performance.now() - start;
      if (t > next) {
        next = t + 70 + Math.random() * 60;
        bolts = Array.from({ length: 3 + Math.floor(Math.random() * 2) }, () => {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
          return {
            pts: bolt(opts.x, opts.y, a, 110 + Math.random() * 190, 4),
            color: opts.colors[Math.floor(Math.random() * opts.colors.length)],
            w: 1.5 + Math.random() * 1.6,
          };
        });
      }
      const k = Math.max(0, 1 - t / opts.ms);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // Layered translucent strokes emulate electric bloom without slow Canvas `shadowBlur`.
      for (const b of bolts) {
        ctx.beginPath();
        for (let i = 0; i < b.pts.length; i++) {
          const [x, y] = b.pts[i];
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        const flicker = 0.65 + Math.random() * 0.35;
        ctx.strokeStyle = b.color;
        ctx.globalAlpha = k * flicker * 0.22;
        ctx.lineWidth = b.w * 6.5;
        ctx.stroke();
        ctx.globalAlpha = k * flicker * 0.55;
        ctx.lineWidth = b.w * 2.6;
        ctx.stroke();
        ctx.globalAlpha = k * flicker * 0.92;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = b.w * 0.85;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      return t < opts.ms;
    },
  };
}

function makePackConfettiLayer(
  opts: { ox: number; oy: number; mouthWidth: number; colors: readonly string[]; count?: number },
  width: number,
  height: number,
): FxLayer {
  const shapes = [new Path2D(), new Path2D(), new Path2D('M0-6 1.3-1.3 6 0 1.3 1.3 0 6-1.3 1.3-6 0-1.3-1.3Z')];
  shapes[0].arc(0, 0, 4.2, 0, Math.PI * 2);
  shapes[1].roundRect(-3.4, -5.8, 6.8, 11.6, 1.8);

  const count = opts.count ?? 140;
  const cx = width / 2;
  const cy = height * 0.4;
  const baseX = opts.ox - cx;
  const baseY = opts.oy - cy;
  const randRange = (a: number, b: number) => a + Math.random() * (b - a);
  const spreadScale = Math.min(1, Math.max(0.55, width / 1000));

  type Bit = {
    kind: number;
    fill: string;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    r: number;
    r0: number;
    spin: number;
    drag: number;
    slip: number;
    glide: number;
    sc: number;
    ph: number;
    age: number;
  };

  const bits: Bit[] = Array.from({ length: count }, (_, i) => {
    const lane = randRange(-0.46, 0.46);
    const vt = 250 + 380 * Math.random() ** 1.5;
    const angle = (lane * 2 + randRange(-0.45, 0.45)) * spreadScale;
    const speed = randRange(580, 2300);
    const r0 = randRange(0, 360);
    return {
      kind: i % 3,
      fill: opts.colors[i % opts.colors.length],
      x: baseX + lane * opts.mouthWidth,
      y: baseY + randRange(-8, 14),
      z: randRange(10, 90),
      vx: Math.sin(angle) * speed,
      vy: -Math.cos(angle) * speed,
      vz: randRange(-40, 180),
      r: r0,
      r0,
      spin: randRange(-680, 680),
      drag: 2500 / (vt * vt),
      slip: randRange(850, 2400),
      glide: Math.sign(lane || 1) * randRange(-180, 780),
      sc: randRange(0.85, 1.75),
      ph: randRange(0, Math.PI * 2),
      age: i < 45 ? 0 : -randRange(0, 0.2),
    };
  });

  const RAD = Math.PI / 180;

  return {
    kind: 'packConfetti',
    step(ctx, dtFrame, dpr, w, h) {
      const dt = (dtFrame * 16.67) / 1000;
      const curCx = w / 2;
      const curCy = h * 0.4;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      let alive = 0;
      for (const b of bits) {
        b.age += dt;
        if (b.age < 0) {
          alive++;
          continue;
        }
        b.z += b.vz * dt;
        b.vy += 2450 * dt;
        b.vx += (Math.sin(b.ph) * b.slip + b.glide) * dt;
        const v = Math.hypot(b.vx, b.vy);
        const f = 1 / (1 + b.drag * Math.min(1, 0.07 + b.age / 0.45) * v * dt);
        const turn = 0.35 + v / 820;
        b.vx *= f;
        b.vy *= f;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.r += b.spin * turn * dt;
        b.ph += 7 * turn * dt;

        const persp = 1400 / Math.max(220, 1400 - b.z);
        const screenY = curCy + b.y * persp;
        if (screenY >= h + 40) continue;
        alive++;

        const k = dpr * persp * b.sc;
        const cr = Math.cos(b.r * RAD);
        const sr = Math.sin(b.r * RAD);
        const cq = Math.cos((b.r - b.r0) * 0.7 * RAD);
        ctx.setTransform(k * cr, k * sr, -k * sr * cq, k * cr * cq, (curCx + b.x * persp) * dpr, screenY * dpr);
        ctx.fillStyle = b.fill;
        ctx.fill(shapes[b.kind]);
      }
      return alive > 0;
    },
  };
}

export interface FxEngine {
  packConfetti: (opts: { ox: number; oy: number; mouthWidth: number; colors: readonly string[]; count?: number }) => void;
  burst: (opts: { x: number; y: number; colors: readonly string[]; count: number; power: number }) => void;
  confetti: (opts: { colors: readonly string[]; ms: number }) => void;
  coinRain: (ms: number) => void;
  lightning: (opts: { x: number; y: number; colors: readonly string[]; ms: number }) => void;
  clear: () => void;
  destroy: () => void;
}

/**
 * Single-canvas, single-rAF-loop FX composer.
 * Automatically hides the canvas when no effects are active so macOS CoreAnimation
 * skips compositing an empty full-screen alpha texture over resting 3D cards.
 */
function fitViewport(canvas: HTMLCanvasElement, maxDpr = MAX_FX_DPR) {
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const width = window.innerWidth || 1;
  const height = window.innerHeight || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
}

export function createFxEngine(canvas: HTMLCanvasElement): FxEngine {
  const layers: FxLayer[] = [];
  let rafId = 0;
  let last = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let ctx: CanvasRenderingContext2D | null = null;
  let destroyed = false;

  canvas.style.visibility = 'hidden';

  const ensureSized = () => {
    const fitted = fitViewport(canvas, MAX_FX_DPR);
    ctx = fitted.ctx;
    width = fitted.width;
    height = fitted.height;
    dpr = fitted.dpr;
  };
  ensureSized();

  const onResize = () => {
    ensureSized();
  };
  window.addEventListener('resize', onResize, { passive: true });

  const stopLoop = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvas.style.visibility = 'hidden';
  };

  const tick = (now: number) => {
    rafId = 0;
    if (destroyed || !ctx || layers.length === 0) {
      stopLoop();
      return;
    }
    const dt = Math.min(48, Math.max(1, now - last)) / 16.67;
    last = now;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = layers.length - 1; i >= 0; i--) {
      if (!layers[i].step(ctx, dt, dpr, width, height)) {
        layers.splice(i, 1);
      }
    }

    if (layers.length > 0) {
      rafId = requestAnimationFrame(tick);
    } else {
      stopLoop();
    }
  };

  const push = (make: (w: number, h: number) => FxLayer, replaceKind?: FxLayer['kind']) => {
    if (destroyed) return;
    if (layers.length === 0) {
      canvas.style.visibility = 'visible';
      ensureSized();
    }
    if (!ctx) return;
    if (replaceKind) {
      for (let i = layers.length - 1; i >= 0; i--) {
        if (layers[i].kind === replaceKind) layers.splice(i, 1);
      }
    }
    layers.push(make(width, height));
    if (!rafId) {
      last = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  };

  return {
    packConfetti: (opts) => push((w, h) => makePackConfettiLayer(opts, w, h), 'packConfetti'),
    burst: (opts) => push(() => makeBurstLayer(opts)),
    confetti: (opts) => push((w, h) => makeConfettiLayer(opts, w, h), 'confetti'),
    coinRain: (ms) => push((w, h) => makeCoinRainLayer(ms, w, h), 'coinRain'),
    lightning: (opts) => push(() => makeLightningLayer(opts)),
    clear() {
      layers.length = 0;
      stopLoop();
    },
    destroy() {
      destroyed = true;
      layers.length = 0;
      window.removeEventListener('resize', onResize);
      stopLoop();
    },
  };
}

/** Standalone helper kept for DDZ and other callers. */
function runStandalone(canvas: HTMLCanvasElement, make: (w: number, h: number) => FxLayer) {
  const { ctx, width, height, dpr } = fit(canvas);
  if (!ctx) return () => {};
  const layer = make(width, height);
  return loop(
    (dt) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return layer.step(ctx, dt, dpr, width, height);
    },
    () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  );
}

/** Sparks flying out from (cx, cy) in the rarity's colour, falling a little as they fade. */
export function burst(canvas: HTMLCanvasElement, opts: { x: number; y: number; colors: string[]; count: number; power: number }) {
  return runStandalone(canvas, () => makeBurstLayer(opts));
}

/** Paper confetti falling over the whole canvas for about `ms`. */
export function confetti(canvas: HTMLCanvasElement, opts: { colors: string[]; ms: number }) {
  return runStandalone(canvas, (w, h) => makeConfettiLayer(opts, w, h));
}

/**
 * Motes drifting up through the stage for as long as it is open. `gather`
 * pulls them into (cx, cy) while the chest charges; `scatter` throws them out.
 */
export type Motes = {
  set: (o: { color?: string; mode?: 'drift' | 'gather' | 'scatter'; cx?: number; cy?: number }) => void;
  stop: () => void;
};

export function motes(canvas: HTMLCanvasElement, still: boolean): Motes {
  let { ctx, width, height } = fit(canvas);
  const ro = new ResizeObserver(() => ({ ctx, width, height } = fit(canvas)));
  ro.observe(canvas);
  let color = '255,206,160';
  let mode: 'drift' | 'gather' | 'scatter' = 'drift';
  let cx = width / 2;
  let cy = height / 2;
  type M = { x: number; y: number; vx: number; vy: number; r: number; tw: number; sp: number };
  const spawn = (anywhere: boolean): M => ({
    x: Math.random() * width,
    y: anywhere ? Math.random() * height : height + 10,
    vx: (Math.random() - 0.5) * 0.15,
    vy: -(0.12 + Math.random() * 0.35),
    r: 0.6 + Math.random() * 1.8,
    tw: Math.random() * Math.PI * 2,
    sp: 0.02 + Math.random() * 0.04,
  });
  const ms: M[] = Array.from({ length: 56 }, () => spawn(true));
  let id = 0;
  let last = performance.now();
  const draw = () => {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    for (const m of ms) {
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(m.tw));
      ctx.fillStyle = `rgba(${color},${a * 0.12})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${color},${a})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const frame = (now: number) => {
    const dt = Math.min(48, now - last) / 16.67;
    last = now;
    if (!document.hidden) {
      for (const [i, m] of ms.entries()) {
        m.tw += m.sp * dt;
        if (mode === 'gather') {
          const dx = cx - m.x;
          const dy = cy - m.y;
          const d = Math.hypot(dx, dy) || 1;
          m.vx = m.vx * 0.94 + (dx / d) * 0.55 * dt;
          m.vy = m.vy * 0.94 + (dy / d) * 0.55 * dt;
          if (d < 14) ms[i] = { ...spawn(true), x: Math.random() < 0.5 ? -5 : width + 5 };
        } else {
          const f = Math.hypot(m.vx, m.vy) > 0.9 ? 0.92 ** dt : 0.985;
          m.vx = m.vx * f + (Math.random() - 0.5) * 0.02;
          m.vy = m.vy * f - 0.006 * dt;
        }
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.y < -12 || m.x < -20 || m.x > width + 20 || m.y > height + 20) ms[i] = spawn(false);
      }
      draw();
    }
    id = requestAnimationFrame(frame);
  };
  if (still) draw();
  else id = requestAnimationFrame(frame);
  return {
    set(o) {
      if (o.color) color = o.color;
      if (o.cx !== undefined) cx = o.cx;
      if (o.cy !== undefined) cy = o.cy;
      if (o.mode === 'scatter') {
        for (const m of ms) {
          const dx = m.x - cx;
          const dy = m.y - cy;
          const d = Math.hypot(dx, dy) || 1;
          const k = 3 + Math.random() * 6;
          m.vx = (dx / d) * k;
          m.vy = (dy / d) * k;
        }
        mode = 'drift';
      } else if (o.mode) mode = o.mode;
      if (still) draw();
    },
    stop() {
      cancelAnimationFrame(id);
      ro.disconnect();
    },
  };
}

/** Gold coins tumbling down the whole canvas for about `ms`. */
export function coinRain(canvas: HTMLCanvasElement, ms: number) {
  return runStandalone(canvas, (w, h) => makeCoinRainLayer(ms, w, h));
}

/** Forked arcs crackling out of (x, y) for `ms`. */
export function lightning(canvas: HTMLCanvasElement, opts: { x: number; y: number; colors: string[]; ms: number }) {
  return runStandalone(canvas, () => makeLightningLayer(opts));
}

/** 3D-perspective paper confetti exploding upward out of a freshly torn foil pack mouth. */
export function packConfetti(
  canvas: HTMLCanvasElement,
  opts: { ox: number; oy: number; mouthWidth: number; colors: readonly string[]; count?: number },
) {
  return runStandalone(canvas, (w, h) => makePackConfettiLayer(opts, w, h));
}
