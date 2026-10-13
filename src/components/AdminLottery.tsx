import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { api, errorText, type Draw, type LotterySettings, type LotterySummary, type Prize, type Rarity } from '../api';
import { useI18n } from '../i18n';
import {
  KINDS,
  RARITIES,
  costCeiling,
  fromPercent,
  probabilities,
  settingsProblem,
  toPercent,
  shanghaiToday,
  withKind,
  dollars,
} from '../lottery';
import { Pager } from './AdminUsers';
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
            label={t('admin.lottery.spent')}
            value={summary ? dollars(summary.value) : '—'}
            sub={summary ? `/ ${summary.budget > 0 ? dollars(summary.budget) : t('admin.lottery.noCap')}` : undefined}
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="usage-stat">
      <span>{label}</span>
      <b>
        {value}
        {sub && <em className="stat-sub"> {sub}</em>}
      </b>
    </div>
  );
}

// ---- Settings ----

function SettingsEditor({ onToast }: { onToast: (m: string) => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<LotterySettings | null>(null);
  const [s, setS] = useState<LotterySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminLotterySettings().then(
      (x) => {
        setSaved(x);
        setS(x);
      },
      (e) => setError(errorText(e, t('common.genericError'))),
    );
  }, [t]);

  const probs = useMemo(() => probabilities(s?.prizes ?? []), [s]);
  const ceiling = useMemo(() => costCeiling(s?.prizes ?? []), [s]);
  const problem = s ? settingsProblem(s) : null;
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  if (!s) return error ? <div className="usage-error">{error}</div> : null;

  const setPrize = (i: number, p: Prize) => setS({ ...s, prizes: s.prizes.map((x, j) => (j === i ? p : x)) });

  async function save() {
    if (!s || problem) return;
    setBusy(true);
    setError('');
    try {
      const x = await api.adminLotterySave(s);
      setSaved(x);
      setS(x);
      onToast(t('admin.lottery.saved'));
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    } finally {
      setBusy(false);
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

      <div className="lot-settings-top">
        <NumField label={t('admin.lottery.threshold')} prefix="$" value={s.threshold} onChange={(v) => setS({ ...s, threshold: v })} />
        <NumField label={t('admin.lottery.budget')} prefix="$" value={s.daily_budget} onChange={(v) => setS({ ...s, daily_budget: v })} />
        <div className="ceiling">
          <span>{t('admin.lottery.ceiling')}</span>
          <b>{Number.isFinite(ceiling) ? dollars(ceiling) : t('admin.lottery.noCap')}</b>
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
        {problem && <p className="form-error mr-auto">{t(`admin.lottery.problem.${problem.problem}`, { n: (problem.index ?? 0) + 1 })}</p>}
        {!problem && <span className="mr-auto" />}
        <button className="btn btn-quiet" disabled={!dirty || busy} onClick={() => setS(saved)}>
          {t('admin.lottery.reset')}
        </button>
        <button className="btn btn-primary" disabled={!dirty || !!problem || busy} onClick={save}>
          {busy ? t('common.wait') : t('keys.save')}
        </button>
      </div>
      {error && <div className="usage-error mt-3">{error}</div>}
    </section>
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
