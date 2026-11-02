import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api, errorText, type DdzSettings, type DdzSummary } from '../api';
import {
  dealTime,
  draftErrors,
  draftOf,
  draftPatch,
  LAIZI_STATES,
  modeRows,
  seatsOf,
  signed,
  tone,
  type DdzDraft,
  type Deal,
  type DraftField,
  type Seat,
} from '../ddzAdmin';
import { useI18n, type MessageKey } from '../i18n';
import { dollars } from '../lottery';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

const RANGES = [1, 7, 30] as const;
/** Deals shown before 「全部」; the relay sends at most 30. */
const FIRST_DEALS = 10;

const rise = (i: number) => ({ '--i': i }) as CSSProperties;

/** 小丑斗地主 for admins: the switch and table rules on top, then money and the latest deals over a range. */
export function AdminDdz({ onOpenUser, onToast }: { onOpenUser: (u: { id: number; email: string }) => void; onToast: (m: string) => void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<DdzSettings | null>(null);
  const [draft, setDraft] = useState<DdzDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [summary, setSummary] = useState<DdzSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Kept apart from `error` so a later successful summary load cannot hide why the settings stay locked.
  const [settingsError, setSettingsError] = useState('');
  const [allDeals, setAllDeals] = useState(false);
  const seq = useRef(0);

  const loadSettings = useCallback(async () => {
    try {
      const st = await api.adminDdzSettings();
      setSettings(st);
      setDraft(draftOf(st));
      setSettingsError('');
    } catch (e) {
      setSettingsError(errorText(e, t('common.genericError')));
    }
  }, [t]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const loadSummary = useCallback(async () => {
    const n = ++seq.current;
    setBusy(true);
    try {
      const s = await api.adminDdzSummary(days);
      if (n !== seq.current) return;
      setSummary(s);
      setError('');
    } catch (e) {
      if (n === seq.current) setError(errorText(e, t('common.genericError')));
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }, [days, t]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const toggle = async (on: boolean) => {
    setConfirm(false);
    setSaving(true);
    try {
      const st = await api.adminDdzSave({ enabled: on });
      setSettings(st);
      onToast(t(st.enabled ? 'admin.ddz.turnedOn' : 'admin.ddz.turnedOff'));
    } catch (e) {
      onToast(errorText(e, t('common.genericError')));
    } finally {
      setSaving(false);
    }
  };

  const patch = settings && draft ? draftPatch(settings, draft) : null;
  const errors = draft ? draftErrors(draft) : {};
  const invalid = Object.keys(errors).length > 0;
  const changed = (...keys: (keyof DdzSettings)[]) => !!patch && keys.some((k) => k in patch);
  const edit = (p: Partial<DdzDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const errorFor = (f: DraftField) => errors[f] && t(errors[f] === 'fee' ? 'admin.ddz.err.fee' : 'admin.ddz.err.times');

  const save = async () => {
    if (!settings || !patch || invalid) return;
    setSaving(true);
    try {
      const st = await api.adminDdzSave(patch);
      setSettings(st);
      setDraft(draftOf(st));
      onToast(t('admin.ddz.saved'));
    } catch (e) {
      onToast(errorText(e, t('common.genericError')));
    } finally {
      setSaving(false);
    }
  };

  const locked = !settings || !draft || saving;
  const modes = summary ? modeRows(summary) : null;
  const deals = summary?.recent ?? [];
  const total = summary ? (summary.total_net ?? summary.platform_net) : 0;

  return (
    <div className="main-scroll">
      <div className="main-column">
        {(settingsError || error) && <div className="usage-error rise">{settingsError || error}</div>}

        <section className="card ddz-adm-card rise" style={rise(0)}>
          <header className="ddz-adm-head">
            <div>
              <h2>{t('nav.ddz')}</h2>
              <p>{t('admin.ddz.switchHint')}</p>
            </div>
            {settings && (
              <button
                disabled={saving}
                role="switch"
                aria-checked={settings.enabled}
                className={`switch ${settings.enabled ? 'on' : ''}`}
                onClick={() => (settings.enabled ? toggle(false) : setConfirm(true))}
                aria-label={t('admin.ddz.switch')}
              >
                <span>{settings.enabled ? t('admin.lottery.on') : t('admin.lottery.off')}</span>
                <i />
              </button>
            )}
          </header>

          <form
            className="ddz-adm-rows"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Row label={t('admin.ddz.fee')} hint={t('admin.ddz.feeHint')} changed={changed('fee_enabled', 'fee_bps')} error={errorFor('fee_rate')}>
              <Choice
                label={t('admin.ddz.fee')}
                value={draft ? (draft.fee_enabled ? 'on' : 'off') : null}
                options={[
                  ['off', t('admin.ddz.feeOff')],
                  ['on', t('admin.ddz.feeOn')],
                ]}
                disabled={locked}
                onChange={(v) => edit({ fee_enabled: v === 'on' })}
              />
              <NumInput
                label={t('admin.ddz.feeRate')}
                value={draft?.fee_rate ?? ''}
                unit="%"
                dim={!draft?.fee_enabled}
                invalid={!!errors.fee_rate}
                disabled={locked}
                onChange={(v) => edit({ fee_rate: v })}
              />
            </Row>
            <Row label={t('admin.ddz.jokerTimes')} hint={t('admin.ddz.balanceHint')} changed={changed('min_balance_times')} error={errorFor('min_balance_times')}>
              <NumInput
                label={t('admin.ddz.jokerTimes')}
                value={draft?.min_balance_times ?? ''}
                unit={t('admin.ddz.timesUnit')}
                invalid={!!errors.min_balance_times}
                disabled={locked}
                onChange={(v) => edit({ min_balance_times: v })}
              />
            </Row>
            <Row
              label={t('admin.ddz.laizi')}
              hint={draft ? `${t(`admin.ddz.laiziHint.${draft.laizi}`)}${draft.laizi === 'off' ? '' : t('admin.ddz.laiziOld')}` : t('admin.ddz.laiziOld')}
              changed={changed('laizi')}
            >
              <Choice
                label={t('admin.ddz.laizi')}
                value={draft?.laizi ?? null}
                options={LAIZI_STATES.map((v) => [v, t(`admin.ddz.laizi.${v}`)] as const)}
                disabled={locked}
                onChange={(v) => edit({ laizi: v })}
              />
            </Row>
            <Row label={t('admin.ddz.laiziTimes')} hint={t('admin.ddz.laiziTimesHint')} changed={changed('laizi_min_balance_times')} error={errorFor('laizi_min_balance_times')}>
              <NumInput
                label={t('admin.ddz.laiziTimes')}
                value={draft?.laizi_min_balance_times ?? ''}
                unit={t('admin.ddz.timesUnit')}
                invalid={!!errors.laizi_min_balance_times}
                disabled={locked}
                onChange={(v) => edit({ laizi_min_balance_times: v })}
              />
            </Row>

            <footer className={`ddz-adm-save ${patch ? 'dirty' : ''}`}>
              <span aria-live="polite">{!draft ? t('admin.ddz.notLoaded') : patch ? t('admin.ddz.unsaved', { n: Object.keys(patch).length }) : t('admin.ddz.allSaved')}</span>
              <button type="button" className="btn btn-quiet" disabled={!patch || saving} onClick={() => settings && setDraft(draftOf(settings))}>
                {t('admin.ddz.revert')}
              </button>
              <button className="btn btn-primary" disabled={!patch || invalid || saving}>
                {t('admin.ddz.save')}
              </button>
            </footer>
          </form>
        </section>

        <div className="ddz-adm-section rise" style={rise(1)}>
          <h2>{t('admin.ddz.stats')}</h2>
          <div className="ddz-adm-tools">
            <div className="seg" role="tablist">
              {RANGES.map((d) => (
                <button key={d} role="tab" aria-selected={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
                  {t(d === 1 ? 'admin.ddz.today' : 'admin.ddz.days', { n: d })}
                </button>
              ))}
            </div>
            <button className="usage-refresh" title={t('admin.ddz.refresh')} aria-label={t('admin.ddz.refresh')} disabled={busy}
              onClick={() => {
                // Settings only reload here when they failed to load; otherwise an unsaved draft would be thrown away.
                if (!settings) loadSettings();
                loadSummary();
              }}
            >
              <Icon name="refresh" className={`size-[15px] ${busy ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className={`ddz-adm-kpis rise ${busy ? 'loading' : ''}`} style={rise(2)}>
          <Kpi lead label={t('admin.ddz.platformTotal')} value={summary ? signed(total) : '—'} tone={tone(total)} sub={[t('admin.ddz.totalSub')]} title={t('admin.ddz.platformNetHint')} />
          <Kpi
            label={t('admin.ddz.feeIncome')}
            value={summary ? dollars(summary.fee_income ?? 0) : '—'}
            sub={summary ? [t('admin.ddz.grossSub', { v: dollars(summary.gross_won ?? summary.won) }), t('admin.ddz.netSub', { v: dollars(summary.won) })] : []}
          />
          <Kpi
            label={t('admin.ddz.platformNet')}
            value={summary ? signed(summary.platform_net) : '—'}
            tone={summary ? tone(summary.platform_net) : undefined}
            sub={summary ? [t('admin.ddz.botSub', { n: summary.bot_games })] : []}
          />
          <Kpi label={t('admin.ddz.games')} value={summary ? String(summary.games) : '—'} sub={summary ? [t('admin.ddz.playersSub', { n: summary.players })] : []} />
        </div>

        {!!summary?.unknown_seats && <p className="ddz-adm-note rise">{t('admin.ddz.unknownSeats', { n: summary.unknown_seats })}</p>}

        {modes && (
          <section className="card ddz-adm-card rise" style={rise(3)}>
            <h2 className="ddz-adm-title">{t('admin.ddz.byMode')}</h2>
            <table className="ddz-adm-table">
              <thead>
                <tr>
                  <th>{t('admin.ddz.col.mode')}</th>
                  <th>{t('admin.ddz.col.games')}</th>
                  <th>{t('admin.ddz.feeIncome')}</th>
                  <th>{t('admin.ddz.col.ai')}</th>
                  <th>{t('admin.ddz.platformTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {modes.map((r) => (
                  <tr key={r.mode}>
                    <td>
                      <span className={`ddz-adm-mode ${r.mode}`}>{t(`ddz.mode.${r.mode}`)}</span>
                    </td>
                    <td>{r.games}</td>
                    <td>{dollars(r.fee)}</td>
                    <td className={tone(r.ai)}>{signed(r.ai)}</td>
                    <td className={tone(r.total)}>{signed(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="card ddz-adm-card rise" style={rise(4)}>
          <div className="ddz-adm-title-row">
            <h2 className="ddz-adm-title">{t('admin.ddz.recent')}</h2>
            {deals.length > 0 && <span>{t('admin.ddz.recentHint')}</span>}
          </div>
          {!summary ? (
            <p className="usage-empty">{t('common.wait')}</p>
          ) : !deals.length ? (
            <p className="usage-empty">{t('admin.ddz.none')}</p>
          ) : (
            <>
              <div className="ddz-adm-deals" role="table" aria-label={t('admin.ddz.recent')}>
                <div className="ddz-adm-deal head" role="row">
                  <span role="columnheader">{t('admin.ddz.col.time')}</span>
                  <span role="columnheader">{t('admin.ddz.col.deal')}</span>
                  <span role="columnheader" className="seats">
                    {t('admin.ddz.col.seats')}
                  </span>
                </div>
                {(allDeals ? deals : deals.slice(0, FIRST_DEALS)).map((g, i) => (
                  <DealRow key={g.id} g={g} fresh={allDeals && i >= FIRST_DEALS} onOpenUser={onOpenUser} />
                ))}
              </div>
              {deals.length > FIRST_DEALS && (
                <button className="ddz-adm-more" aria-expanded={allDeals} onClick={() => setAllDeals(!allDeals)}>
                  {allDeals ? t('admin.ddz.fewer') : t('admin.ddz.more', { n: deals.length })}
                  <Icon name="chevronDown" className="size-3" />
                </button>
              )}
            </>
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
              <button className="btn btn-primary" onClick={() => toggle(true)}>
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

/** One setting: name and explanation on the left, its controls on the right. A dot marks unsaved changes. */
function Row({ label, hint, changed, error, children }: { label: string; hint: string; changed: boolean; error?: string | false; children: ReactNode }) {
  return (
    <div className={`ddz-adm-row ${changed ? 'changed' : ''}`}>
      <div>
        <h3>{label}</h3>
        <p>{hint}</p>
        {error && <p className="err">{error}</p>}
      </div>
      <div className="ddz-adm-ctl">{children}</div>
    </div>
  );
}

function Choice<V extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  /** Null while the settings are not loaded: nothing is shown as chosen. */
  value: V | null;
  options: readonly (readonly [V, string])[];
  disabled: boolean;
  onChange: (v: V) => void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, name]) => (
        <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} disabled={disabled} onClick={() => onChange(v)}>
          {name}
        </button>
      ))}
    </div>
  );
}

function NumInput({
  label,
  value,
  unit,
  dim,
  invalid,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  unit: string;
  dim?: boolean;
  invalid: boolean;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className={`ddz-adm-num ${dim ? 'dim' : ''} ${invalid ? 'invalid' : ''}`}>
      <input
        className="field"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
      />
      <span>{unit}</span>
    </label>
  );
}

function Kpi({ label, value, tone, sub, lead, title }: { label: string; value: string; tone?: 'up' | 'down'; sub: string[]; lead?: boolean; title?: string }) {
  return (
    <div className={`ddz-adm-kpi ${lead ? 'lead' : ''}`} title={title}>
      <span>{label}</span>
      <b key={value} className={tone}>
        {value}
      </b>
      {sub.map((s) => (
        <small key={s}>{s}</small>
      ))}
    </div>
  );
}

function DealRow({ g, fresh, onOpenUser }: { g: Deal; fresh: boolean; onOpenUser: (u: { id: number; email: string }) => void }) {
  const { t } = useI18n();
  const when = dealTime(g.at);
  const mode = g.mode === 'laizi' ? 'laizi' : 'joker';
  return (
    <div className={`ddz-adm-deal ${fresh ? 'fresh' : ''}`} role="row">
      <span className="ddz-adm-when" role="cell">
        <b>{when.time}</b>
        <small>{when.day}</small>
      </span>
      <span className="ddz-adm-stake" role="cell">
        <b>{dollars(g.base)}</b>
        <small title={mode === 'joker' && g.field ? t(`ddz.field.${g.field}` as MessageKey) : undefined}>
          <span className={`ddz-adm-mode ${mode}`}>{t(`ddz.mode.${mode}`)}</span>
          {mode === 'joker' && g.field && ` · ${t(`ddz.field.${g.field}` as MessageKey)}`}
        </small>
      </span>
      {seatsOf(g).map((seat, s) => (
        <SeatCell key={s} seat={seat} bps={g.fee_policy?.bps ?? 0} onOpenUser={onOpenUser} />
      ))}
    </div>
  );
}

function SeatCell({ seat, bps, onOpenUser }: { seat: Seat; bps: number; onOpenUser: (u: { id: number; email: string }) => void }) {
  const { t } = useI18n();
  return (
    <span className={`ddz-adm-seat ${seat.landlord ? 'lord' : ''}`} role="cell">
      <span className="who">
        {seat.landlord && (
          <span className="crown" role="img" aria-label={t('ddz.landlord')} title={t('ddz.landlord')}>
            <Icon name="crown" className="size-3" />
          </span>
        )}
        {seat.kind === 'human' && seat.user ? (
          <button className="ddz-adm-user" title={seat.name} onClick={() => onOpenUser({ id: seat.user!, email: '' })}>
            {seat.name}
          </button>
        ) : seat.kind === 'bot' ? (
          <em title={seat.name}>
            {seat.name}
            <i>AI</i>
          </em>
        ) : (
          <em className="unknown">{t('admin.ddz.unknown')}</em>
        )}
      </span>
      <span className="amt">
        <b className={tone(seat.delta)}>{signed(seat.delta)}</b>
        {seat.fee > 0 && <small title={`${bps / 100}%`}>{t('admin.ddz.feeShort', { v: dollars(seat.fee) })}</small>}
      </span>
    </span>
  );
}
