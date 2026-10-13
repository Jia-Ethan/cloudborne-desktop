import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  api,
  errorText,
  type ToolId,
  type UsageKey,
  type UsageQuery,
  type UsageSnapshot,
  type UsageStats,
} from '../api';
import { useI18n } from '../i18n';
import { byVendor, compact, fillTrend, hitRate, money, percent, rangeDates, type Range, type Vendor } from '../usage';
import { Logo } from './Logo';
import { Icon } from './Icon';
import { ToolGlyph } from './ToolGlyph';
import { UsageChart, type Metric } from './UsageChart';

const RANGES: Range[] = ['today', 'week', 'month'];

export function UsageView() {
  const { t } = useI18n();
  const [range, setRange] = useState<Range>('week');
  const [tool, setTool] = useState<ToolId | 'all'>('all');
  const [metric, setMetric] = useState<Metric>('tokens');
  const [keys, setKeys] = useState<UsageKey[]>([]);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [snap, setSnap] = useState<UsageSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Drops responses from a filter the user has already moved away from.
  const generation = useRef(0);

  useEffect(() => {
    api.usageKeys().then(setKeys, () => {});
  }, []);

  const toolKey = keys.find((k) => k.tool === tool);
  const query = useMemo((): UsageQuery | null => {
    if (tool !== 'all' && !toolKey) return null;
    const { start, end } = rangeDates(range);
    return {
      start_date: start,
      end_date: end,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(toolKey ? { api_key_id: toolKey.id } : {}),
    };
  }, [range, tool, toolKey]);

  const load = useCallback(async () => {
    const g = ++generation.current;
    setBusy(true);
    setError('');
    if (!query) {
      setStats(null);
      setSnap(null);
      setBusy(false);
      return;
    }
    try {
      const [s, sn] = await Promise.all([
        api.usageStats(query),
        api.usageSnapshot({ ...query, granularity: range === 'today' ? 'hour' : 'day' }),
      ]);
      if (g !== generation.current) return;
      setStats(s);
      setSnap(sn);
    } catch (e) {
      if (g === generation.current) setError(errorText(e, t('common.genericError')));
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }, [query, range, t]);

  useEffect(() => {
    load();
  }, [load]);

  const trend = useMemo(() => fillTrend(snap?.trend ?? [], range), [snap, range]);
  const vendors = useMemo(() => byVendor(snap?.models ?? []), [snap]);
  const tools = useMemo(
    () => keys.flatMap((k) => (k.tool ? [k.tool] : [])).filter((x, i, a) => a.indexOf(x) === i),
    [keys],
  );

  const hit = stats
    ? hitRate({
        input_tokens: stats.total_input_tokens,
        output_tokens: stats.total_output_tokens,
        cache_creation_tokens: stats.total_cache_creation_tokens,
        cache_read_tokens: stats.total_cache_read_tokens,
      })
    : null;

  return (
    <div className="main-scroll">
      <div className="main-column">
        <div className="usage-head rise" style={{ '--i': 0 } as CSSProperties}>
          <div className="seg" role="tablist">
            {RANGES.map((r) => (
              <button key={r} role="tab" aria-selected={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
                {t(`usage.range.${r}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {tools.length > 0 && (
              <div className="seg" role="tablist">
                <button role="tab" aria-selected={tool === 'all'} className={tool === 'all' ? 'on' : ''} onClick={() => setTool('all')}>
                  {t('usage.allTools')}
                </button>
                {tools.map((id) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tool === id}
                    className={tool === id ? 'on' : ''}
                    title={keys.find((k) => k.tool === id)?.name}
                    onClick={() => setTool(id)}
                  >
                    <ToolGlyph id={id} size="xs" />
                  </button>
                ))}
              </div>
            )}
            <button className="usage-refresh" title={t('usage.refresh')} aria-label={t('usage.refresh')} disabled={busy} onClick={load}>
              <Icon name="refresh" className={`size-[15px] ${busy ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && <div className="usage-error rise">{error}</div>}

        <div className="usage-stats rise" style={{ '--i': 1 } as CSSProperties}>
          <Stat label={t('usage.cost')} value={stats ? money(stats.total_actual_cost) : '—'} />
          <Stat label={t('usage.requests')} value={stats ? compact(stats.total_requests) : '—'} />
          <Stat label={t('usage.tokens')} value={stats ? compact(stats.total_tokens) : '—'} />
          <Stat label={t('usage.hitRate')} value={percent(hit)} />
        </div>

        <section className="card usage-card rise" style={{ '--i': 2 } as CSSProperties}>
          <div className="usage-card-head">
            <h2>{t('usage.trend')}</h2>
            <div className="seg seg-sm" role="tablist">
              {(['tokens', 'cost'] as Metric[]).map((m) => (
                <button key={m} role="tab" aria-selected={metric === m} className={metric === m ? 'on' : ''} onClick={() => setMetric(m)}>
                  {t(`usage.metric.${m}`)}
                </button>
              ))}
            </div>
          </div>
          <UsageChart points={trend} metric={metric} hourly={range === 'today'} />
        </section>

        <section className="card usage-card rise" style={{ '--i': 3 } as CSSProperties}>
          <div className="usage-card-head">
            <h2>{t('usage.models')}</h2>
          </div>
          {vendors.length === 0 ? (
            <p className="usage-empty">{busy ? t('common.wait') : t('usage.none')}</p>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>{t('usage.vendor')}</th>
                  <th>{t('usage.requests')}</th>
                  <th>{t('usage.tokens')}</th>
                  <th>{t('usage.hitRate')}</th>
                  <th>{t('usage.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.vendor.id}>
                    <td className="usage-model" title={v.models.join('\n')}>
                      <VendorName vendor={v.vendor} fallback={t('usage.otherVendor')} />
                    </td>
                    <td>{compact(v.requests)}</td>
                    <td>{compact(v.total_tokens)}</td>
                    <td>{percent(hitRate(v))}</td>
                    <td>{money(v.actual_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

      </div>
    </div>
  );
}

function VendorMark({ vendor }: { vendor: Vendor }) {
  return (
    <span className="usage-vendor-mark" aria-hidden>
      {vendor.logo && <Logo id={vendor.logo} className="size-[13px]" />}
    </span>
  );
}

function VendorName({ vendor, fallback }: { vendor: Vendor; fallback: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <VendorMark vendor={vendor} />
      {vendor.name || fallback}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="usage-stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
