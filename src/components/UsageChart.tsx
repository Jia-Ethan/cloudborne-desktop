import { useState } from 'react';
import type { TrendPoint } from '../api';
import { useI18n } from '../i18n';
import { compact, money } from '../usage';

export type Metric = 'tokens' | 'cost';

// Bottom to top. Cache reads are the cheap part, so they sit lowest.
const LAYERS = [
  { key: 'cache_read_tokens', label: 'usage.cached', color: 'var(--chart-cache)' },
  { key: 'input_tokens', label: 'usage.input', color: 'var(--chart-input)' },
  { key: 'cache_creation_tokens', label: 'usage.cacheWrite', color: 'var(--chart-write)' },
  { key: 'output_tokens', label: 'usage.output', color: 'var(--chart-output)' },
] as const;

const W = 820;
const H = 200;
const PAD = { top: 10, right: 8, bottom: 22, left: 44 };

/** Rounds the axis top up to 1, 2 or 5 × 10ⁿ so the ticks read cleanly. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

export function UsageChart({ points, metric, hourly }: { points: TrendPoint[]; metric: Metric; hourly: boolean }) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const value = (p: TrendPoint) => (metric === 'cost' ? p.actual_cost : LAYERS.reduce((s, l) => s + p[l.key], 0));
  const top = niceMax(Math.max(0, ...points.map(value)));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const slot = iw / Math.max(points.length, 1);
  const bar = Math.max(2, Math.min(28, slot * 0.62));
  const y = (v: number) => PAD.top + ih - (v / top) * ih;
  const fmt = metric === 'cost' ? money : compact;
  // Axis ticks are round numbers; whole dollars keep large ones inside the gutter.
  const tick = (v: number) => (metric === 'cost' && v >= 100 ? `$${compact(v)}` : fmt(v));
  const label = (p: TrendPoint) => (hourly ? p.date.slice(11, 13) : p.date.slice(5).replace('-', '/'));
  const every = Math.ceil(points.length / 8);
  const h = hover === null ? null : points[hover];

  return (
    <div className="usage-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('usage.trend')} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(top * f)} y2={y(top * f)} className="usage-grid" />
            <text x={PAD.left - 8} y={y(top * f)} className="usage-axis" textAnchor="end" dominantBaseline="middle">
              {f === 0 ? '0' : tick(top * f)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = PAD.left + slot * i + (slot - bar) / 2;
          let base = 0;
          return (
            <g key={p.date} onMouseEnter={() => setHover(i)} className={hover === i ? 'usage-bar on' : 'usage-bar'}>
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={ih} fill="transparent" />
              {metric === 'cost' ? (
                <rect x={x} y={y(p.actual_cost)} width={bar} height={Math.max(0, y(0) - y(p.actual_cost))} rx={Math.min(4, bar / 3)} fill="var(--chart-output)" />
              ) : (
                LAYERS.map((l) => {
                  const v = p[l.key];
                  if (v <= 0) return null;
                  const r = <rect key={l.key} x={x} y={y(base + v)} width={bar} height={y(base) - y(base + v)} fill={l.color} />;
                  base += v;
                  return r;
                })
              )}
              {i % every === 0 && (
                <text x={PAD.left + slot * i + slot / 2} y={H - 6} className="usage-axis" textAnchor="middle">
                  {label(p)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="usage-legend">
        {metric === 'tokens' &&
          LAYERS.map((l) => (
            <span key={l.key}>
              <i style={{ background: l.color }} />
              {t(l.label)}
            </span>
          ))}
        {h && (
          <span className="usage-tip">
            {hourly ? `${h.date.slice(11)}` : h.date.slice(5).replace('-', '/')} · {compact(h.total_tokens)} tokens · {money(h.actual_cost)}
          </span>
        )}
      </div>
    </div>
  );
}
