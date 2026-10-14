import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { api, errorText, type Draw, type LotterySettings, type LotterySummary, type Prize, type Rarity } from '../api';
import { useI18n } from '../i18n';
import {
  KINDS,
  RARITIES,
  costCeiling,
  fromPercent,
  fromShanghaiInput,
  payoutRatio,
  sellsAtLoss,
  toShanghaiInput,
  probabilities,
  settingsProblem,
  toPercent,
  shanghaiToday,
  withKind,
  dollars,
} from '../lottery';
import { Pager } from './AdminUsers';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { PrizeText, RarityTag } from './Prize';
import { BigWins, WinnerSheet, when } from './WinnerSheet';

const PAGE = 30;

export function AdminLottery({ onOpenUser, onToast }: { onOpenUser: (u: { id: number; email: string }) => void; onToast: (m: string) => void }) {
  const { t } = useI18n();
  // Draw days are counted in the relay's timezone.
  const [date, setDate] = useState(shanghaiToday);
  const [summary, setSummary] = useState<LotterySummary | null>(null);
  const [rarity, setRarity] = useState<Rarity | ''>('');
  const [page, setPage] = useState(1);
  const [draws, setDraws] = useState<Draw[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [win, setWin] = useState<Draw | null>(null);

  const loadSummary = useCallback(async () => {
    setBusy(true);
    try {
      setSummary(await api.adminLotterySummary(date));
      setError('');
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    } finally {
      setBusy(false);
    }
  }, [date, t]);

  const loadDraws = useCallback(async () => {
    try {
      const p = await api.adminLotteryDraws({ date, rarity, page, pageSize: PAGE });
      setDraws(p.items);
      setTotal(p.total);
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    }
  }, [date, rarity, page, t]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    loadDraws();
  }, [loadDraws]);

  const refresh = () => {
    loadSummary();
    loadDraws();
  };

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="main-scroll">
      <div className="main-column">
        <div className="usage-head rise" style={{ '--i': 0 } as CSSProperties}>
          <input
            type="date"
            className="field date-field"
            value={date}
            max={shanghaiToday()}
            onChange={(e) => {
              if (!e.target.value) return;
              setDate(e.target.value);
              setPage(1);
            }}
          />
          <button className="usage-refresh" title={t('usage.refresh')} aria-label={t('usage.refresh')} disabled={busy} onClick={refresh}>
            <Icon name="refresh" className={`size-[15px] ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && <div className="usage-error rise">{error}</div>}

        <div className="usage-stats rise" style={{ '--i': 1 } as CSSProperties}>
          <Stat label={t('admin.lottery.draws')} value={summary ? String(summary.draws) : '—'} />
          <Stat label={t('admin.lottery.participants')} value={summary ? String(summary.participants) : '—'} />
          <Stat
            label={t('admin.lottery.chestsIn')}
            value={summary ? String((summary.earned_chests ?? 0) + (summary.bought_chests ?? 0) + (summary.daily_chests ?? 0)) : '—'}
            sub={
              summary
                ? t('admin.lottery.chestsSplit', { daily: summary.daily_chests ?? 0, earned: summary.earned_chests ?? 0, bought: summary.bought_chests ?? 0 })
                : undefined
            }
          />
          <Stat
            label={t('admin.lottery.dailyExpired')}
            value={summary ? String(summary.daily_expired ?? 0) : '—'}
            sub={summary ? `/ ${summary.daily_chests ?? 0}` : undefined}
          />
          <Stat label={t('admin.lottery.forfeited')} value={summary ? String(summary.forfeited_chests ?? 0) : '—'} title={t('admin.lottery.forfeitedHint')} />
          <Stat
            label={t('admin.lottery.spent')}
            value={summary ? dollars(summary.value_earn ?? summary.value) : '—'}
            sub={summary ? `/ ${summary.budget > 0 ? dollars(summary.budget) : t('admin.lottery.noCap')}` : undefined}
          />
          <Stat
            label={t('admin.lottery.revenue')}
            value={summary ? dollars(summary.buy_revenue ?? 0) : '—'}
            sub={summary ? t('admin.lottery.paidOut', { amount: dollars(summary.value_buy ?? 0) }) : undefined}
          />
          <Stat
            label={t('admin.lottery.poolBalance')}
            value={summary?.pool ? dollars(summary.pool.balance) : '—'}
            tone={summary?.pool && summary.pool.balance < 0 ? 'bad' : undefined}
            title={
              summary?.pool
                ? t('admin.lottery.poolDetail', {
                    reserve: dollars(summary.pool.reserve),
                    revenue: dollars(summary.pool.revenue),
                    payout: dollars(summary.pool.payout),
                  })
                : undefined
            }
          />
          <div className="usage-stat">
            <span>{t('admin.lottery.byRarity')}</span>
            <div className="rarity-counts">
              {RARITIES.map((r) => (
                <span key={r} className={`r-${r}`} title={t(`rarity.${r}`)}>
                  <i />
                  {summary?.by_rarity[r] ?? 0}
                </span>
              ))}
            </div>
          </div>
        </div>

        <section className="card usage-card big-card rise" style={{ '--i': 2 } as CSSProperties}>
          <div className="usage-card-head">
            <h2>{t('admin.lottery.bigWins')}</h2>
            {summary && summary.big_wins.length > 0 && <span className="head-count">{summary.big_wins.length}</span>}
          </div>
          {summary ? <BigWins wins={summary.big_wins} onOpen={setWin} /> : <p className="usage-empty">{t('common.wait')}</p>}
        </section>

        <section className="card usage-card rise" style={{ '--i': 3 } as CSSProperties}>
          <div className="usage-card-head">
            <h2>{t('admin.lottery.allDraws')}</h2>
            <div className="seg seg-sm" role="tablist">
              {(['', ...RARITIES] as const).map((r) => (
                <button
                  key={r || 'all'}
                  role="tab"
                  aria-selected={rarity === r}
                  className={rarity === r ? 'on' : ''}
                  onClick={() => {
                    setRarity(r);
                    setPage(1);
                  }}
                >
                  {r ? t(`rarity.${r}`) : t('usage.allTools')}
                </button>
              ))}
            </div>
          </div>
          {draws && draws.length === 0 ? (
            <p className="usage-empty">{t('admin.lottery.noDraws')}</p>
          ) : (
            <div className="draw-list">
              {(draws ?? []).map((d) => {
                const big = d.rarity === 'epic' || d.rarity === 'legendary';
                return (
                  <div
                    key={d.id}
                    className={`draw-row ${big ? 'clickable' : ''}`}
                    onClick={big ? () => setWin(d) : undefined}
                    role={big ? 'button' : undefined}
                    tabIndex={big ? 0 : undefined}
                    onKeyDown={big ? (e) => e.key === 'Enter' && setWin(d) : undefined}
                  >
                    <time>{when(d.created_at)}</time>
                    <span className="truncate" title={d.email}>
                      {d.email || d.username || `#${d.user_id}`}
                    </span>
                    <RarityTag rarity={d.rarity} />
                    <span className="truncate">{d.name}</span>
                    <b>
                      <PrizeText draw={d} />
                    </b>
                  </div>
                );
              })}
            </div>
          )}
          {pages > 1 && <Pager page={page} pages={pages} onPage={setPage} />}
        </section>

        <SettingsEditor onToast={onToast} />
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

function Stat({ label, value, sub, tone, title }: { label: string; value: string; sub?: string; tone?: 'bad'; title?: string }) {
  return (
    <div className={`usage-stat ${tone ?? ''}`} title={title}>
      <span>{label}</span>
      <b>
        {value}
        {sub && <em className="stat-sub"> {sub}</em>}
      </b>
    </div>
  );
}

// ---- Settings ----

/** Fills fields an older relay leaves out, so the form always has every key. */
function complete(x: LotterySettings): LotterySettings {
  // Typed as what the relay may send: an older one leaves the new keys out.
  const { threshold: old, ...rest } = x as Partial<LotterySettings> & Pick<LotterySettings, 'enabled' | 'daily_budget' | 'prizes'> & { threshold?: number };
  return {
    starts_at: null,
    ends_at: null,
    earn_enabled: true,
    earn_spend: 50,
    earn_daily_cap: 0,
    earn_quota: 100,
    buy_enabled: false,
    buy_price: 5,
    buy_daily_cap: 5,
    buy_quota: 100,
    pool_reserve: 0,
    hold_cap: 100,
    daily_enabled: true,
    // v1's threshold becomes the low-spend chest's, as the relay does.
    daily_threshold: old && old > 0 ? old : 20,
    daily_per_user: 1,
    daily_quota: 50,
    ...rest,
  };
}

function SettingsEditor({ onToast }: { onToast: (m: string) => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<LotterySettings | null>(null);
  const [s, setS] = useState<LotterySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askDefaults, setAskDefaults] = useState(false);

  useEffect(() => {
    api.adminLotterySettings().then(
      (x) => {
        setSaved(complete(x));
        setS(complete(x));
      },
      (e) => setError(errorText(e, t('common.genericError'))),
    );
  }, [t]);

  const probs = useMemo(() => probabilities(s?.prizes ?? []), [s]);
  const ceiling = useMemo(() => costCeiling(s?.prizes ?? []), [s]);
  const ratio = s ? payoutRatio(ceiling, s.buy_price) : Infinity;
  const loss = !!s && s.buy_enabled && sellsAtLoss(ceiling, s.buy_price);
  const problem = s ? settingsProblem(s) : null;
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  if (!s) return error ? <div className="usage-error">{error}</div> : null;

  const setPrize = (i: number, p: Prize) => setS({ ...s, prizes: s.prizes.map((x, j) => (j === i ? p : x)) });

  async function save() {
    if (!s || problem) return;
    setBusy(true);
    setError('');
    try {
      const x = complete(await api.adminLotterySave(s));
      setSaved(x);
      setS(x);
      onToast(t('admin.lottery.saved'));
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    } finally {
      setBusy(false);
    }
  }

  async function loadDefaults() {
    setAskDefaults(false);
    setError('');
    try {
      const d = complete(await api.adminLotteryDefaults());
      // Only the table and the money knobs; the switches and window stay as edited.
      setS((cur) =>
        cur
          ? {
              ...d,
              enabled: cur.enabled,
              starts_at: cur.starts_at,
              ends_at: cur.ends_at,
              earn_enabled: cur.earn_enabled,
              daily_enabled: cur.daily_enabled,
              buy_enabled: cur.buy_enabled,
            }
          : d,
      );
      onToast(t('admin.lottery.defaultsLoaded'));
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    }
  }

  return (
    <section className="card usage-card rise" style={{ '--i': 4 } as CSSProperties}>
      <div className="usage-card-head">
        <h2>{t('admin.lottery.settings')}</h2>
        <button
          role="switch"
          aria-checked={s.enabled}
          className={`switch ${s.enabled ? 'on' : ''}`}
          onClick={() => setS({ ...s, enabled: !s.enabled })}
          aria-label={t('admin.lottery.enabled')}
        >
          <span>{s.enabled ? t('admin.lottery.on') : t('admin.lottery.off')}</span>
          <i />
        </button>
      </div>

      <div className="lot-settings">
        <div className="lot-settings-group">
          <h3>{t('admin.lottery.activity')}</h3>
          <div className="lot-settings-row">
            <TimeField label={t('admin.lottery.startsAt')} value={s.starts_at} onChange={(v) => setS({ ...s, starts_at: v })} />
            <TimeField label={t('admin.lottery.endsAt')} value={s.ends_at} onChange={(v) => setS({ ...s, ends_at: v })} />
            <NumField label={t('admin.lottery.holdCap')} value={s.hold_cap} onChange={(v) => setS({ ...s, hold_cap: v })} />
          </div>
          <p className="lot-settings-hint">{t('admin.lottery.windowHint')}</p>
        </div>

        <div className="lot-settings-group">
          <div className="lot-settings-head">
            <h3>{t('admin.lottery.dailyGroup')}</h3>
            <button
              role="switch"
              aria-checked={s.daily_enabled}
              className={`switch ${s.daily_enabled ? 'on' : ''}`}
              onClick={() => setS({ ...s, daily_enabled: !s.daily_enabled })}
              aria-label={t('admin.lottery.dailyEnabled')}
            >
              <span>{s.daily_enabled ? t('admin.lottery.on') : t('admin.lottery.off')}</span>
              <i />
            </button>
          </div>
          <div className="lot-settings-row">
            <NumField label={t('admin.lottery.dailyThreshold')} prefix="$" value={s.daily_threshold} onChange={(v) => setS({ ...s, daily_threshold: v })} />
            <NumField label={t('admin.lottery.dailyPerUser')} value={s.daily_per_user} onChange={(v) => setS({ ...s, daily_per_user: v })} />
            <NumField label={t('admin.lottery.dailyQuota')} value={s.daily_quota} onChange={(v) => setS({ ...s, daily_quota: v })} />
          </div>
          <p className="lot-settings-hint">{t('admin.lottery.dailyHint')}</p>
        </div>

        <div className="lot-settings-group">
          <div className="lot-settings-head">
            <h3>{t('admin.lottery.earnGroup')}</h3>
            <button
              role="switch"
              aria-checked={s.earn_enabled}
              className={`switch ${s.earn_enabled ? 'on' : ''}`}
              onClick={() => setS({ ...s, earn_enabled: !s.earn_enabled })}
              aria-label={t('admin.lottery.earnEnabled')}
            >
              <span>{s.earn_enabled ? t('admin.lottery.on') : t('admin.lottery.off')}</span>
              <i />
            </button>
          </div>
          <div className="lot-settings-row">
            <NumField label={t('admin.lottery.earnSpend')} prefix="$" value={s.earn_spend} onChange={(v) => setS({ ...s, earn_spend: v })} />
            <NumField label={t('admin.lottery.earnCap')} value={s.earn_daily_cap} onChange={(v) => setS({ ...s, earn_daily_cap: v })} />
            <NumField label={t('admin.lottery.earnQuota')} value={s.earn_quota} onChange={(v) => setS({ ...s, earn_quota: v })} />
            <NumField label={t('admin.lottery.budget')} prefix="$" value={s.daily_budget} onChange={(v) => setS({ ...s, daily_budget: v })} />
          </div>
          <p className="lot-settings-hint">{t('admin.lottery.zeroUnlimited')}</p>
        </div>

        <div className="lot-settings-group">
          <div className="lot-settings-head">
            <h3>{t('admin.lottery.buyGroup')}</h3>
            <button
              role="switch"
              aria-checked={s.buy_enabled}
              className={`switch ${s.buy_enabled ? 'on' : ''}`}
              onClick={() => setS({ ...s, buy_enabled: !s.buy_enabled })}
              aria-label={t('admin.lottery.buyEnabled')}
            >
              <span>{s.buy_enabled ? t('admin.lottery.on') : t('admin.lottery.off')}</span>
              <i />
            </button>
          </div>
          <div className="lot-settings-row">
            <NumField label={t('admin.lottery.buyPrice')} prefix="$" value={s.buy_price} onChange={(v) => setS({ ...s, buy_price: v })} />
            <NumField label={t('admin.lottery.buyCap')} value={s.buy_daily_cap} onChange={(v) => setS({ ...s, buy_daily_cap: v })} />
            <NumField label={t('admin.lottery.buyQuota')} value={s.buy_quota} onChange={(v) => setS({ ...s, buy_quota: v })} />
            <NumField label={t('admin.lottery.reserve')} prefix="$" value={s.pool_reserve} onChange={(v) => setS({ ...s, pool_reserve: v })} />
          </div>
          <p className="lot-settings-hint">{t('admin.lottery.quotaHint')}</p>
        </div>

        <div className={`ceiling ${loss ? 'bad' : ''}`}>
          <span>{t('admin.lottery.ceiling')}</span>
          <b>{Number.isFinite(ceiling) ? dollars(ceiling) : t('admin.lottery.noCap')}</b>
          {s.buy_enabled && (
            <em>
              {t('admin.lottery.payout', { pct: Number.isFinite(ratio) ? `${(Math.round(ratio * 1000) / 10).toFixed(1)}%` : '∞' })}
            </em>
          )}
          {loss && (
            <p className="ceiling-warn">
              {t('admin.lottery.lossWarn', { ceiling: Number.isFinite(ceiling) ? dollars(ceiling) : '∞', price: dollars(s.buy_price) })}
            </p>
          )}
        </div>
      </div>

      <div className="prize-table">
        <div className="prize-head">
          <span>{t('admin.lottery.prizeName')}</span>
          <span>{t('admin.lottery.rarity')}</span>
          <span>{t('admin.lottery.kind')}</span>
          <span>{t('admin.lottery.weight')}</span>
          <span className="text-right">{t('admin.lottery.chance')}</span>
          <span />
        </div>
        {s.prizes.map((p, i) => (
          <div key={i} className={`prize-row ${problem?.index === i ? 'bad' : ''}`}>
            <div className="prize-name">
              <i className={`dot r-${p.rarity}`} />
              <input className="field" value={p.name} maxLength={20} onChange={(e) => setPrize(i, { ...p, name: e.target.value })} />
            </div>
            <select className="field" value={p.rarity} onChange={(e) => setPrize(i, { ...p, rarity: e.target.value as Rarity })}>
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {t(`rarity.${r}`)}
                </option>
              ))}
            </select>
            <select className="field" value={p.kind} onChange={(e) => setPrize(i, withKind(p, e.target.value as Prize['kind']))}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </select>
            <Num value={p.weight} onChange={(v) => setPrize(i, { ...p, weight: v })} />
            <Params p={p} onChange={(x) => setPrize(i, x)} />
            <b className="prize-chance">{(probs[i] * 100).toFixed(probs[i] < 0.1 ? 1 : 0)}%</b>
            <button
              className="icon-button danger"
              aria-label={t('keys.delete')}
              title={t('keys.delete')}
              disabled={s.prizes.length <= 1}
              onClick={() => setS({ ...s, prizes: s.prizes.filter((_, j) => j !== i) })}
            >
              <Icon name="trash" className="size-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="prize-foot">
        <button
          className="btn btn-quiet"
          disabled={s.prizes.length >= 20}
          onClick={() =>
            setS({
              ...s,
              prizes: [...s.prizes, withKind({ id: newId(s.prizes), name: t('admin.lottery.newPrize'), rarity: 'common', kind: 'balance_fixed', weight: 1 }, 'balance_fixed')],
            })
          }
        >
          <Icon name="plus" className="size-4" />
          {t('admin.lottery.addPrize')}
        </button>
        <button className="btn btn-quiet" disabled={busy} onClick={() => setAskDefaults(true)}>
          <Icon name="sparkle" className="size-4" />
          {t('admin.lottery.useDefaults')}
        </button>
        {problem && <p className="form-error mr-auto">{t(`admin.lottery.problem.${problem.problem}`, { n: (problem.index ?? 0) + 1, ceiling: Number.isFinite(ceiling) ? dollars(ceiling) : '∞', price: dollars(s.buy_price) })}</p>}
        {!problem && <span className="mr-auto" />}
        <button className="btn btn-quiet" disabled={!dirty || busy} onClick={() => setS(saved)}>
          {t('admin.lottery.reset')}
        </button>
        <button className="btn btn-primary" disabled={!dirty || !!problem || busy} onClick={save}>
          {busy ? t('common.wait') : t('keys.save')}
        </button>
      </div>
      {error && <div className="usage-error mt-3">{error}</div>}
      {askDefaults && (
        <Dialog
          title={t('admin.lottery.useDefaults')}
          onClose={() => setAskDefaults(false)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setAskDefaults(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={loadDefaults}>
                {t('admin.lottery.useDefaults')}
              </button>
            </>
          }
        >
          <p className="confirm-text">{t('admin.lottery.defaultsAsk')}</p>
        </Dialog>
      )}
    </section>
  );
}

/** A datetime-local in Shanghai time; empty means no bound. */
function TimeField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const { t } = useI18n();
  return (
    <label className="form-row">
      <span>{label}</span>
      <span className="time-field">
        <input type="datetime-local" className="field" value={toShanghaiInput(value)} onChange={(e) => onChange(fromShanghaiInput(e.target.value))} />
        {value && (
          <button type="button" className="icon-button" aria-label={t('common.clear')} title={t('common.clear')} onClick={() => onChange(null)}>
            <Icon name="close" className="size-3.5" />
          </button>
        )}
      </span>
    </label>
  );
}

function newId(prizes: Prize[]): string {
  for (let i = prizes.length + 1; ; i++) {
    const id = `prize_${i}`;
    if (!prizes.some((p) => p.id === id)) return id;
  }
}

/** Per-kind parameters. Percent kinds show % and store fractions. */
function Params({ p, onChange }: { p: Prize; onChange: (p: Prize) => void }) {
  const { t } = useI18n();
  const set = (k: keyof Prize, v: number) => onChange({ ...p, [k]: v });
  const cap = (
    <Tagged label={t('admin.lottery.cap')}>
      <Num value={p.cap ?? 0} prefix="$" onChange={(v) => set('cap', v)} />
    </Tagged>
  );
  switch (p.kind) {
    case 'balance_fixed':
      return (
        <div className="prize-params">
          <Tagged label={t('admin.lottery.range')}>
            <Num value={p.min ?? 0} prefix="$" onChange={(v) => set('min', v)} />
            <i>–</i>
            <Num value={p.max ?? 0} prefix="$" onChange={(v) => set('max', v)} />
          </Tagged>
        </div>
      );
    case 'cashback':
    case 'balance_percent':
      return (
        <div className="prize-params">
          <Tagged label={p.kind === 'cashback' ? t('admin.lottery.ofCost') : t('admin.lottery.ofBalance')}>
            <Pct value={p.min ?? 0} onChange={(v) => set('min', v)} />
            <i>–</i>
            <Pct value={p.max ?? 0} onChange={(v) => set('max', v)} />
          </Tagged>
          {cap}
        </div>
      );
    case 'discount':
      return (
        <div className="prize-params">
          <Tagged label={t('admin.lottery.rate')}>
            <Num value={Math.round((p.rate ?? 0) * 1000) / 100} suffix={t('admin.lottery.zheUnit')} onChange={(v) => set('rate', Math.round(v * 100) / 1000)} />
          </Tagged>
          <Tagged label={t('admin.lottery.hours')}>
            <Num value={p.hours ?? 0} suffix="h" onChange={(v) => set('hours', Math.round(v))} />
          </Tagged>
          {cap}
        </div>
      );
    case 'credit':
      return (
        <div className="prize-params">
          <Tagged label={t('admin.lottery.amount')}>
            <Num value={p.amount ?? 0} prefix="$" onChange={(v) => set('amount', v)} />
          </Tagged>
          <Tagged label={t('admin.lottery.hours')}>
            <Num value={p.hours ?? 0} suffix="h" onChange={(v) => set('hours', Math.round(v))} />
          </Tagged>
        </div>
      );
    case 'extra_draw':
      return <div className="prize-params empty">—</div>;
  }
}

function Tagged({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="tagged">
      <em>{label}</em>
      {children}
    </span>
  );
}

/**
 * Numeric input that keeps the text being typed ("1.", "0.0") and reports the
 * parsed number; the shown text follows outside changes.
 */
function Num({ value, onChange, prefix, suffix }: { value: number; onChange: (v: number) => void; prefix?: string; suffix?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((cur) => (parseFloat(cur) === value ? cur : String(value)));
  }, [value]);
  return (
    <span className="num">
      {prefix && <i>{prefix}</i>}
      <input
        className="field"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, '');
          setText(v);
          const n = parseFloat(v);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
      {suffix && <i className="suffix">{suffix}</i>}
    </span>
  );
}

function Pct({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(toPercent(value));
  useEffect(() => {
    setText((cur) => (fromPercent(cur) === value ? cur : toPercent(value)));
  }, [value]);
  return (
    <span className="num">
      <input
        className="field"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, '');
          setText(v);
          onChange(fromPercent(v));
        }}
      />
      <i className="suffix">%</i>
    </span>
  );
}

function NumField({ label, value, onChange, prefix }: { label: string; value: number; onChange: (v: number) => void; prefix?: string }) {
  return (
    <label className="form-row">
      <span>{label}</span>
      <Num value={value} prefix={prefix} onChange={onChange} />
    </label>
  );
}
