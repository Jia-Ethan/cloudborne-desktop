import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api, errorText, type DdzSummary } from '../api';
import { useI18n, type MessageKey } from '../i18n';
import { dollars } from '../lottery';
import { Figure, Line, Panel } from './AdminLottery';
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
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [s, st] = await Promise.all([api.adminDdzSummary(days), api.adminDdzSettings()]);
      setSummary(s);
      setEnabled(st.enabled);
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
    try {
      const st = await api.adminDdzSave({ enabled: on });
      setEnabled(st.enabled);
      onToast(t(st.enabled ? 'admin.ddz.turnedOn' : 'admin.ddz.turnedOff'));
    } catch (e) {
      onToast(errorText(e, t('common.genericError')));
    }
  };

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
        </section>

        <div className="lot-panels rise" style={{ '--i': 2 } as CSSProperties}>
          <Panel title={t('admin.ddz.panel.games')}>
            <Figure label={t('admin.ddz.games')} value={summary ? String(summary.games) : '—'} />
            <div className="lot-split">
              <Line label={t('admin.ddz.players')} value={summary ? String(summary.players) : '—'} />
              <Line label={t('admin.ddz.botGames')} value={summary ? String(summary.bot_games) : '—'} />
            </div>
          </Panel>
          <Panel title={t('admin.ddz.panel.money')}>
            <Figure
              label={t('admin.ddz.platformNet')}
              value={summary ? signed(summary.platform_net) : '—'}
              tone={summary && summary.platform_net < 0 ? 'bad' : undefined}
              title={t('admin.ddz.platformNetHint')}
            />
            <div className="lot-split">
              <Line label={t('admin.ddz.won')} value={summary ? dollars(summary.won) : '—'} title={t('admin.ddz.wonHint')} />
            </div>
          </Panel>
        </div>

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
                    {dollars(g.base)} · {t(`ddz.field.${g.field}` as MessageKey)}
                  </span>
                  {g.users.map((u, s) => (
                    <span key={s} className={`ddz-admin-seat ${g.delta[s] >= 0 ? 'up' : 'down'}`}>
                      {g.landlord === s && <Icon name="crown" className="size-3" />}
                      {u ? (
                        <button className="text-link" onClick={() => onOpenUser({ id: u, email: '' })}>
                          #{u}
                        </button>
                      ) : (
                        <em>AI</em>
                      )}
                      <b>{signed(g.delta[s])}</b>
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
