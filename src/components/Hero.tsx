import { useEffect, useRef } from 'react';
import type { ToolId } from '../api';
import { Mark } from './Mark';
import { ToolGlyph } from './ToolGlyph';

const CHIPS: { id: ToolId; name: string }[] = [
  { id: 'codex', name: 'Codex' },
  { id: 'claude', name: 'Claude Code' },
  { id: 'zcode', name: 'ZCode' },
  { id: 'grok', name: 'Grok Build' },
];

// Where each chip lands before it joins the orbit.
const START = [
  { x: -120, y: -110 },
  { x: 120, y: -110 },
  { x: -140, y: 40 },
  { x: 140, y: 40 },
];

const TAU = Math.PI * 2;
const ORBIT = { rx: 165, ry: 84, period: 34 };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Damped spring from 0 to 1 (stiffness 190, damping 13, mass 0.9). */
function spring(t: number) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(190 / 0.9);
  const z = 13 / (2 * Math.sqrt(190 * 0.9));
  const wd = w0 * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
}

function Sparkle({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 0c.7 6.4 5 11 12 12-7 1-11.3 5.6-12 12-.7-6.4-5-11-12-12 7-1 11.3-5.6 12-12Z" />
    </svg>
  );
}

/**
 * The mark springs in, the tool chips rise into place around it, then drift
 * onto a slow tilted orbit. Driven by requestAnimationFrame writing styles
 * directly, and paused while the window is hidden or unfocused.
 */
export function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  const core = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let elapsed = reduce ? 3 : 0;
    let since = 0;
    let scale = 1;

    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      scale = Math.min(Math.max(Math.min(width / 520, height / 520), 0.7), 1.4);
    });
    if (stage.current) ro.observe(stage.current);

    const draw = (t: number) => {
      const c = spring(t - 0.15);
      const bob = Math.sin(t / 1.15) * 3;
      if (core.current) {
        core.current.style.opacity = String(clamp01(c * 1.4));
        core.current.style.transform =
          `translate3d(0, ${bob * scale}px, 0) rotateX(${Math.sin(t / 1.6) * 2}deg) ` +
          `rotateY(${Math.cos(t / 1.3) * 2.5}deg) scale(${(0.35 + c * 0.65) * scale}) rotate(${(1 - c) * -8}deg)`;
      }
      const r = clamp01((t - 0.22) / 0.93);
      if (ring.current) {
        ring.current.style.opacity = String(t > 0.22 ? (1 - r) * 0.55 : 0);
        ring.current.style.transform = `scale(${(0.55 + r * 1.7) * scale})`;
      }
      const morph = easeInOut(clamp01((t - 1.4) / 1.4));
      chips.current.forEach((el, i) => {
        if (!el) return;
        const enter = easeOut(clamp01((t - 0.2 - i * 0.2) / 0.37));
        const a = (i / CHIPS.length) * TAU + 0.7 + (t / ORBIT.period) * TAU;
        const depth = Math.sin(a);
        const x = lerp(START[i].x, Math.cos(a) * ORBIT.rx, morph);
        const y = lerp(START[i].y + (1 - enter) * 22, depth * ORBIT.ry, morph) + Math.sin(t / 0.83 + i * 1.7) * 2 * morph;
        const s = lerp(1, 0.95 + depth * 0.25, morph);
        const o = lerp(enter, depth < -0.2 ? 0.55 + (depth + 1) * 0.44 : 0.9 + clamp01(depth / 0.4) * 0.1, morph);
        el.style.opacity = String(o);
        el.style.zIndex = morph > 0.55 && depth < 0 ? '10' : '60';
        el.style.transform =
          `translate3d(-50%, -50%, 0) translate3d(${x * scale}px, ${y * scale}px, 0) ` +
          `rotateY(${-Math.cos(a) * 18 * morph}deg) scale(${s * scale})`;
      });
    };

    const tick = (now: number) => {
      draw(elapsed + (now - since) / 1000);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (raf || reduce || document.hidden || !document.hasFocus()) return;
      since = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
      elapsed += (performance.now() - since) / 1000;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    draw(elapsed);
    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', start);
    window.addEventListener('blur', stop);
    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', start);
      window.removeEventListener('blur', stop);
    };
  }, []);

  return (
    <div ref={stage} className="hero-stage" aria-hidden>
      <div ref={ring} className="hero-ring" />
      <div ref={core} className="hero-core">
        <Mark className="h-[46px] text-[#141414]" />
        <Sparkle className="hero-sparkle s1" />
        <Sparkle className="hero-sparkle s2" />
      </div>
      {CHIPS.map((c, i) => (
        <div
          key={c.id}
          ref={(el) => {
            chips.current[i] = el;
          }}
          className="hero-chip-pos"
        >
          <span className="hero-chip">
            <ToolGlyph id={c.id} size="sm" />
            {c.name}
          </span>
        </div>
      ))}
    </div>
  );
}
