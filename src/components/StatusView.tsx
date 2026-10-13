import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, errorText, type Monitor } from '../api';
import { brandOf } from '../brands';
import { useI18n } from '../i18n';
import { byProvider, duration, uptime, worst } from '../status';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';

// The relay probes about once a minute.
const POLL_MS = 60_000;

export function StatusView() {
  const { t } = useI18n();
  const [items, setItems] = useState<Monitor[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.serviceStatus();
      if (!alive.current) return;
      setItems(r.items ?? []);
      setError('');
    } catch (e) {
      if (alive.current) setError(errorText(e, t('common.genericError')));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    alive.current = true;
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [load]);

  const rows = useMemo(() => byProvider(items ?? []), [items]);
  const overall = worst(rows.map((r) => r.state));

  return (
    <div className="main-scroll">
      <div className="main-column">
        <div className="usage-head rise" style={{ '--i': 0 } as CSSProperties}>
          <div className={`status-overall s-${overall}`}>
            <span className="status-dot" />
            {items === null ? t('common.wait') : rows.length === 0 ? t('status.none') : t(`status.overall.${overall}`)}
          </div>
          <button className="usage-refresh" title={t('status.refresh')} aria-label={t('status.refresh')} disabled={busy} onClick={load}>
            <Icon name="refresh" className={`size-[15px] ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && <div className="usage-error rise">{error}</div>}

        {rows.length > 0 && (
          <section className="card status-card rise" style={{ '--i': 1 } as CSSProperties}>
            {rows.map((r) => (
              <div key={r.provider} className="status-row">
                <div className="status-row-head">
                  <span className="inline-flex min-w-0 items-center gap-3">
                    <BrandMark platform={r.provider} size="md" />
                    <b className="truncate">{brandOf(r.provider).name}</b>
                  </span>
                  <span className={`status-state s-${r.state}`}>
                    <span className="status-dot" />
                    {t(`status.state.${r.state}`)}
                  </span>
                </div>
                <div className="status-bar" aria-hidden>
                  {r.history.map((s, i) => (
                    <i key={i} className={`s-${s}`} />
                  ))}
                </div>
                <div className="status-meta">
                  <span>{t('status.uptime', { value: uptime(r.uptime) })}</span>
                  <span>{t('status.latency', { value: duration(r.latency) })}</span>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
