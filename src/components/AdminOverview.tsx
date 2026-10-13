import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, errorText, type AdminOverview as Overview, type Draw, type LotterySummary } from '../api';
import { useI18n } from '../i18n';
import { RARITIES, dollars } from '../lottery';
import { compact, fillTrend, money, rangeDates } from '../usage';
import { Icon } from './Icon';
import { RarityTag } from './Prize';
import { UsageChart } from './UsageChart';
import { BigWins, WinnerSheet } from './WinnerSheet';

export function AdminOverview({
  onOpenUser,
  onOpenLottery,
}: {
  onOpenUser: (u: { id: number; email: string }) => void;
  onOpenLottery: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [lottery, setLottery] = useState<LotterySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [win, setWin] = useState<Draw | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const { start, end } = rangeDates('week');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const [o] = await Promise.all([
        api.adminOverview(end, start, tz),
        // The lottery block is extra; the rest still shows on a relay without it.
        api.adminLotterySummary('').then(setLottery, () => setLottery(null)),
      ]);
      setData(o);
      setError('');
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const trend = useMemo(() => fillTrend(data?.trend ?? [], 'week'), [data]);
  const models = useMemo(() => [...(data?.models ?? [])].sort((a, b) => b.actual_cost - a.actual_cost).slice(0, 8), [data]);
  const topCost = models[0]?.actual_cost || 1;
  const st = data?.stats;

  return (
    <div className="main-scroll">
      <div className="main-column">
        <div className="usage-head rise" style={{ '--i': 0 } as CSSProperties}>
          <h1 className="page-title">{t('nav.adminOverview')}</h1>
          <button className="usage-refresh" title={t('usage.refresh')} aria-label={t('usage.refresh')} disabled={busy} onClick={load}>
            <Icon name="refresh" className={`size-[15px] ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && <div className="usage-error rise">{error}</div>}

        <div className="usage-stats rise" style={{ '--i': 1 } as CSSProperties}>
          <Stat label={t('admin.todayCost')} value={st ? money(st.today_actual_cost) : '—'} />
          <Stat label={t('admin.todayRequests')} value={st ? compact(st.today_requests) : '—'} />
          <Stat label={t('admin.activeUsers')} value={st ? compact(st.active_users) : '—'} />
          <Stat label={t('admin.totalUsers')} value={st ? compact(st.total_users) : '—'} />
        </div>

        {lottery && (
          <section className="card usage-card rise" style={{ '--i': 2 } as CSSProperties}>
            <div className="usage-card-head">
              <h2>{t('admin.todayLottery')}</h2>
              <button className="text-link" onClick={onOpenLottery}>
                {t('nav.adminLottery')}
                <Icon name="chevronRight" className="size-3.5" />
              </button>
            </div>
            <div className="lot-sum">
              <div>
                <span>{t('admin.lottery.draws')}</span>
                <b>{lottery.draws}</b>
              </div>
              <div>
                <span>{t('admin.lottery.spent')}</span>
                <b>
                  {dollars(lottery.value)}
                  <em> / {lottery.budget > 0 ? dollars(lottery.budget) : t('admin.lottery.noCap')}</em>
                </b>
              </div>
              <div className="lot-sum-rarity">
                {RARITIES.map((r) => (
                  <span key={r}>
                    <RarityTag rarity={r} />
                    <b>{lottery.by_rarity[r] ?? 0}</b>
                  </span>
                ))}
              </div>
            </div>
            <BigWins wins={lottery.big_wins} onOpen={setWin} limit={5} />
          </section>
        )}

        <section className="card usage-card rise" style={{ '--i': 3 } as CSSProperties}>
          <div className="usage-card-head">
            <h2>{t('admin.trend7')}</h2>
          </div>
          <UsageChart points={trend} metric="cost" hourly={false} />
        </section>

        <section className="card usage-card rise" style={{ '--i': 4 } as CSSProperties}>
          <div className="usage-card-head">
            <h2>{t('admin.todayModels')}</h2>
          </div>
          {models.length === 0 ? (
            <p className="usage-empty">{busy ? t('common.wait') : t('usage.none')}</p>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>{t('admin.model')}</th>
                  <th className="w-[34%]" />
                  <th>{t('usage.requests')}</th>
                  <th>{t('usage.tokens')}</th>
                  <th>{t('usage.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.model}>
                    <td className="usage-model">{m.model}</td>
                    <td>
                      <div className="share-bar">
                        <i style={{ width: `${(m.actual_cost / topCost) * 100}%` }} />
                      </div>
                    </td>
                    <td>{compact(m.requests)}</td>
                    <td>{compact(m.total_tokens)}</td>
                    <td>{money(m.actual_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {win && (
        <WinnerSheet
          draw={win}
          onClose={() => setWin(null)}
          onOpenUser={(u) => {
            setWin(null);
            onOpenUser(u);
          }}
        />
      )}
    </div>
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
