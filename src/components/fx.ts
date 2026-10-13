// Hand-rolled canvas effects for the lucky draw: a radial particle burst and
// falling confetti. Each returns a function that stops it early.

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

function fit(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
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

/** Sparks flying out from (cx, cy) in the rarity's colour, falling a little as they fade. */
export function burst(canvas: HTMLCanvasElement, opts: { x: number; y: number; colors: string[]; count: number; power: number }) {
  const { ctx, width, height } = fit(canvas);
  if (!ctx) return () => {};
  const ps: Particle[] = Array.from({ length: opts.count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = (0.35 + Math.random() * 0.65) * opts.power;
    const max = 50 + Math.random() * 40;
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
  return loop(
    (dt) => {
      ctx.clearRect(0, 0, width, height);
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
          // A four-point twinkle.
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
      return alive > 0;
    },
    () => ctx.clearRect(0, 0, width, height),
  );
}

/** Paper confetti falling over the whole canvas for about `ms`. */
export function confetti(canvas: HTMLCanvasElement, opts: { colors: string[]; ms: number }) {
  const { ctx, width, height } = fit(canvas);
  if (!ctx) return () => {};
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
  spawn(140, false);
  return loop(
    (dt) => {
      const t = performance.now() - start;
      if (t < opts.ms * 0.6 && ps.length < 520) spawn(4, true);
      ctx.clearRect(0, 0, width, height);
      const fade = t > opts.ms ? Math.max(0, 1 - (t - opts.ms) / 600) : 1;
      let visible = 0;
      for (const p of ps) {
        p.vy = Math.min(p.vy + 0.18 * dt, 4.2);
        p.vx *= 0.99 ** dt;
        p.x += (p.vx + Math.sin((t + p.size * 300) / 380) * 0.6) * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;
        if (p.y > height + 30) continue;
        visible++;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.scale(1, Math.abs(Math.cos(p.angle * 1.7)) * 0.8 + 0.2);
        ctx.fillStyle = p.color;
        if (p.shape) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      return fade > 0 && (visible > 0 || t < opts.ms * 0.6);
    },
    () => ctx.clearRect(0, 0, width, height),
  );
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
          // Thrown motes brake hard, then go back to drifting up.
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

/** A gold coin drawn once and stamped for each falling coin. */
function coinSprite(): HTMLCanvasElement {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (!g) return c;
  const body = g.createRadialGradient(s * 0.38, s * 0.32, 2, s / 2, s / 2, s / 2);
  body.addColorStop(0, '#fff6c8');
  body.addColorStop(0.45, '#ffd34d');
  body.addColorStop(1, '#b7791f');
  g.fillStyle = body;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(122,74,10,0.75)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(122,74,10,0.9)';
  g.font = `800 ${s * 0.42}px -apple-system, "PingFang SC", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('$', s / 2, s / 2 + 2);
  return c;
}

/** Gold coins tumbling down the whole canvas for about `ms`. */
export function coinRain(canvas: HTMLCanvasElement, ms: number) {
  const { ctx, width, height } = fit(canvas);
  if (!ctx) return () => {};
  const sprite = coinSprite();
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
  for (let i = 0; i < 20; i++) spawn(true);
  return loop(
    (dt) => {
      const t = performance.now() - start;
      if (t < ms * 0.6 && Math.random() < 0.28 * dt) spawn(false);
      ctx.clearRect(0, 0, width, height);
      const fade = t > ms ? Math.max(0, 1 - (t - ms) / 500) : 1;
      let visible = 0;
      for (const c of cs) {
        c.vy = Math.min(c.vy + 0.32 * dt, 9);
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.spin += c.vs * dt;
        if (c.y > height + 40) continue;
        visible++;
        const sx = Math.cos(c.spin);
        ctx.save();
        ctx.globalAlpha = fade * (0.75 + 0.25 * Math.abs(sx));
        ctx.translate(c.x, c.y);
        ctx.rotate(c.tilt);
        ctx.scale(Math.max(0.08, Math.abs(sx)), 1);
        if (sx < 0) ctx.filter = 'brightness(0.78)';
        ctx.drawImage(sprite, -c.size / 2, -c.size / 2, c.size, c.size);
        ctx.restore();
      }
      return fade > 0 && (visible > 0 || t < ms * 0.65);
    },
    () => ctx.clearRect(0, 0, width, height),
  );
}

/** Forked arcs crackling out of (x, y) for `ms`. */
export function lightning(canvas: HTMLCanvasElement, opts: { x: number; y: number; colors: string[]; ms: number }) {
  const { ctx, width, height } = fit(canvas);
  if (!ctx) return () => {};
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
  return loop(
    () => {
      const t = performance.now() - start;
      if (t > next) {
        next = t + 70 + Math.random() * 60;
        bolts = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => {
          // Mostly upward and to the sides, out of the open lid.
          const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
          return { pts: bolt(opts.x, opts.y, a, 110 + Math.random() * 190, 5), color: opts.colors[Math.floor(Math.random() * opts.colors.length)], w: 1.5 + Math.random() * 1.6 };
        });
      }
      ctx.clearRect(0, 0, width, height);
      const k = Math.max(0, 1 - t / opts.ms);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      for (const b of bolts) {
        ctx.beginPath();
        b.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.globalAlpha = k * (0.6 + Math.random() * 0.4);
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.w * 2.2;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = b.w * 0.7;
        ctx.stroke();
      }
      return t < opts.ms;
    },
    () => ctx.clearRect(0, 0, width, height),
  );
}
