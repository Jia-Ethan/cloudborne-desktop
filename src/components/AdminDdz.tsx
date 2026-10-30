import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api, errorText, type DdzSettings, type DdzSummary } from '../api';
import { useI18n, type MessageKey } from '../i18n';
import { dollars } from '../lottery';
import { Figure, Line, Panel } from './AdminLottery';
import { HERO_NAMES, type Hero } from '../ddz';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { when } from './WinnerSheet';

const RANGES = [1, 7, 30] as const;

const signed = (n: number) => (n > 0 ? `+${dollars(n)}` : n < 0 ? `−${dollars(-n)}` : dollars(0));

/** 小丑斗地主 for admins: the on/off switch, money over a range, and the latest deals. */
export function AdminDdz({ onOpenUser, onToast }: { onOpenUser: (u: { id: number; email: string }) => void; onToast: (m: string) => void }) {
  const { t } = useI18n();
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [summary, setSummary] = useState<DdzSummary | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [feeEnabled, setFeeEnabled] = useState(false);
  const [feeRate, setFeeRate] = useState('5');
  const [minBalanceTimes, setMinBalanceTimes] = useState('20');
  const [laizi, setLaizi] = useState<NonNullable<DdzSettings['laizi']>>('off');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [s, st] = await Promise.all([api.adminDdzSummary(days), api.adminDdzSettings()]);
      setSummary(s);
      setEnabled(st.enabled);
      setFeeEnabled(st.fee_enabled ?? false);
      setFeeRate(String((st.fee_bps ?? 500) / 100));
      setMinBalanceTimes(String(st.min_balance_times ?? 20));
      setLaizi(st.laizi ?? 'off');
      setError('');
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    } finally {
      setBusy(false);
    }
  }, [days, t]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (on: boolean) => {
    setConfirm(false);
    setSaving(true);
    try {
      const st = await api.adminDdzSave({ enabled: on });
      setEnabled(st.enabled);
      onToast(t(st.enabled ? 'admin.ddz.turnedOn' : 'admin.ddz.turnedOff'));
    } catch (e) {
      onToast(errorText(e, t('common.genericError')));
    } finally { setSaving(false); }
  };

  const saveFee = async () => {
    setSaving(true);
    try {
      const st = await api.adminDdzSave({ fee_enabled: feeEnabled, fee_bps: Math.round(Number(feeRate) * 100) });
      setFeeEnabled(st.fee_enabled);
      setFeeRate(String(st.fee_bps / 100));
      onToast(t('admin.ddz.feeSaved'));
    } catch (e) { onToast(errorText(e, t('common.genericError'))); }
    finally { setSaving(false); }
  };

  const saveBalancePolicy = async () => {
    setSaving(true);
    try {
      const st = await api.adminDdzSave({ min_balance_times: Math.round(Number(minBalanceTimes)) });
      setMinBalanceTimes(String(st.min_balance_times ?? 20));
      onToast(t('admin.ddz.balanceSaved'));
    } catch (e) { onToast(errorText(e, t('common.genericError'))); }
    finally { setSaving(false); }
  };

  const saveLaizi = async () => {
    setSaving(true);
    try {
      const st = await api.adminDdzSave({ laizi });
      setLaizi(st.laizi ?? 'off');
      onToast(t('admin.ddz.laiziSaved'));
    } catch (e) { onToast(errorText(e, t('common.genericError'))); }
    finally { setSaving(false); }
  };

  const modeName = (m: string) => t(m === 'laizi' ? 'ddz.mode.laizi' : 'ddz.mode.joker');

  return (
    <div className="main-scroll">
      <div className="main-column">
        <div className="usage-head rise" style={{ '--i': 0 } as CSSProperties}>
          <div className="seg" role="tablist">
            {RANGES.map((d) => (
              <button key={d} role="tab" aria-selected={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
                {t(d === 1 ? 'admin.ddz.today' : 'admin.ddz.days', { n: d })}
              </button>
            ))}
          </div>
          <div className="admin-lot-date">
            <button className="usage-refresh" title={t('usage.refresh')} aria-label={t('usage.refresh')} disabled={busy} onClick={load}>
              <Icon name="refresh" className={`size-[15px] ${busy ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && <div className="usage-error rise">{error}</div>}

        <section className="card usage-card rise" style={{ '--i': 1 } as CSSProperties}>
          <div className="usage-card-head">
            <h2>{t('nav.ddz')}</h2>
            {enabled !== null && (
              <button
                disabled={busy || saving}
                role="switch"
                aria-checked={enabled}
                className={`switch ${enabled ? 'on' : ''}`}
                onClick={() => (enabled ? save(false) : setConfirm(true))}
                aria-label={t('admin.ddz.switch')}
              >
                <span>{enabled ? t('admin.lottery.on') : t('admin.lottery.off')}</span>
                <i />
              </button>
            )}
          </div>
          <p className="lot-settings-hint">{t('admin.ddz.switchHint')}</p>
          <form className="ddz-fee-settings" onSubmit={e => {e.preventDefault();void saveFee();}}>
            <label><input type="checkbox" checked={feeEnabled} disabled={busy || saving || enabled === null} onChange={e=>setFeeEnabled(e.target.checked)} /> {t('admin.ddz.feeEnabled')}</label>
            <label>{t('admin.ddz.feeBps')} <input type="number" min="0" max="10" step="0.01" required value={feeRate} disabled={busy || saving || enabled === null} onChange={e=>setFeeRate(e.target.value)} /> %</label>
            <button className="btn btn-primary" disabled={busy || saving || enabled === null}>{t('admin.ddz.feeSave')}</button>
          </form>
          <p className="lot-settings-hint">{t('admin.ddz.feeHint')}</p>
          <form className="ddz-fee-settings" onSubmit={e => {e.preventDefault();void saveBalancePolicy();}}>
            <label>{t('admin.ddz.balanceTimes')} <input type="number" min="10" max="100" step="1" required value={minBalanceTimes} disabled={busy || saving || enabled === null} onChange={e=>setMinBalanceTimes(e.target.value)} /> ×</label>
            <button className="btn btn-primary" disabled={busy || saving || enabled === null}>{t('admin.ddz.balanceSave')}</button>
          </form>
          <p className="lot-settings-hint">{t('admin.ddz.balanceHint')}</p>
          <form className="ddz-fee-settings" onSubmit={e => {e.preventDefault();void saveLaizi();}}>
            <label>{t('admin.ddz.laizi')} <select className="field" value={laizi} disabled={busy || saving || enabled === null} onChange={e=>setLaizi(e.target.value as typeof laizi)}>
              {(['off', 'admin', 'on'] as const).map(v => <option key={v} value={v}>{t(`admin.ddz.laizi.${v}`)}</option>)}
            </select></label>
            <button className="btn btn-primary" disabled={busy || saving || enabled === null}>{t('admin.ddz.laiziSave')}</button>
          </form>
          <p className="lot-settings-hint">{t('admin.ddz.laiziHint')}</p>
        </section>

        <div className="lot-panels rise" style={{ '--i': 2 } as CSSProperties}>
          <Panel title={t('admin.ddz.panel.games')}>
            <Figure label={t('admin.ddz.games')} value={summary ? String(summary.games) : '—'} />
            <div className="lot-split">
              <Line label={t('admin.ddz.players')} value={summary ? String(summary.players) : '—'} />
              <Line label={t('admin.ddz.botGames')} value={summary ? String(summary.bot_games) : '—'} />
              {summary?.modes?.laizi && (['joker', 'laizi'] as const).map(m => (
                <Line key={m} label={modeName(m)} value={String(summary.modes?.[m]?.games ?? 0)} />
              ))}
            </div>
          </Panel>
          <Panel title={t('admin.ddz.panel.money')}>
            <Figure
              label={t('admin.ddz.platformTotal')}
              value={summary ? signed(summary.total_net ?? summary.platform_net) : '—'}
              tone={summary && (summary.total_net ?? summary.platform_net) < 0 ? 'bad' : undefined}
              title={t('admin.ddz.platformNetHint')}
            />
            <div className="lot-split">
              <Line label={t('admin.ddz.platformNet')} value={summary ? signed(summary.platform_net) : '—'} />
              <Line label={t('admin.ddz.feeIncome')} value={summary ? dollars(summary.fee_income ?? 0) : '—'} />
              <Line label={t('admin.ddz.grossWon')} value={summary ? dollars(summary.gross_won ?? summary.won) : '—'} />
              <Line label={t('admin.ddz.netWon')} value={summary ? dollars(summary.won) : '—'} />
              {summary?.modes?.laizi && (['joker', 'laizi'] as const).map(m => (
                <Line key={m} label={t('admin.ddz.modeNet', { mode: modeName(m) })} value={signed(summary.modes?.[m]?.platform_net ?? 0)} />
              ))}
            </div>
          </Panel>
        </div>

        {!!summary?.unknown_seats && <p className="lot-settings-hint">{t('admin.ddz.unknownSeats', {n: summary.unknown_seats})}</p>}

        <section className="card usage-card rise" style={{ '--i': 3 } as CSSProperties}>
          <div className="usage-card-head">
            <h2>{t('admin.ddz.recent')}</h2>
          </div>
          {!summary ? (
            <p className="usage-empty">{t('common.wait')}</p>
          ) : !summary.recent?.length ? (
            <p className="usage-empty">{t('admin.ddz.none')}</p>
          ) : (
            <div className="draw-list">
              {summary.recent.map((g) => (
                <div key={g.id} className="draw-row ddz-admin-row">
                  <time>{when(g.at)}</time>
                  <span className="ddz-admin-field">
                    {dollars(g.base)} · {g.mode === 'laizi' ? t('ddz.mode.laizi') : t(`ddz.field.${g.field}` as MessageKey)}
                  </span>
                  {g.users.map((u, s) => (
                    <span key={s} className={`ddz-admin-seat ${g.delta[s] >= 0 ? 'up' : 'down'}`}>
                      {g.landlord === s && <Icon name="crown" className="size-3" />}
                      {u ? (
                        <button className="text-link" onClick={() => onOpenUser({ id: u, email: '' })}>
                          {g.names?.[s] || `#${u}`}
                        </button>
                      ) : (
                        <em>{g.kinds?.[s] === 'bot' ? g.names?.[s] || HERO_NAMES[g.roles[s] as Hero] || 'AI' : t('admin.ddz.unknown')}</em>
                      )}
                      <b>{signed(g.delta[s])}</b>
                      {!!g.fee?.[s] && <small>{t('admin.ddz.feeIncome')} {dollars(g.fee[s])} · {(g.fee_policy?.bps ?? 0)/100}%</small>}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {confirm && (
        <Dialog
          title={t('admin.ddz.confirmTitle')}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={() => save(true)}>
                {t('admin.ddz.turnOn')}
              </button>
            </>
          }
        >
          <p className="ddz-dialog-text">{t('admin.ddz.confirmBody')}</p>
        </Dialog>
      )}
    </div>
  );
}
