import { useEffect, useState } from 'react';
import { api, errorText, type AdminUser, type Draw } from '../api';
import { useI18n } from '../i18n';
import { dollars, zhe, zheVars } from '../lottery';
import { money } from '../usage';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { GuaranteeTag, PrizeText, RarityTag } from './Prize';

export const when = (iso: string) =>
  new Date(iso).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** A big win and the person behind it: account, the prize in full and their draw history. */
export function WinnerSheet({
  draw,
  onClose,
  onOpenUser,
}: {
  draw: Draw;
  onClose: () => void;
  onOpenUser: (u: { id: number; email: string }) => void;
}) {
  const { t } = useI18n();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [history, setHistory] = useState<Draw[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const uid = draw.user_id;

  useEffect(() => {
    if (!uid) return;
    api.adminUser(uid).then(setUser, (e) => setError(errorText(e, t('common.genericError'))));
    api.adminLotteryDraws({ userId: uid, page: 1, pageSize: 200 }).then(
      (p) => {
        setHistory(p.items);
        setTotal(p.total);
      },
      () => setHistory([]),
    );
  }, [uid, t]);

  const won = history?.reduce((s, d) => s + (d.amount || 0), 0) ?? 0;
  const big = history?.filter((d) => d.rarity === 'epic' || d.rarity === 'legendary').length ?? 0;

  return (
    <Dialog
      wide
      title={draw.email || draw.username || `#${uid}`}
      onClose={onClose}
      footer={
        <>
          {error && <p className="mr-auto text-[13px] text-[var(--danger)]">{error}</p>}
          <button className="btn btn-quiet" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!uid}
            onClick={() => uid && onOpenUser({ id: uid, email: user?.email ?? draw.email ?? '' })}
          >
            <Icon name="users" className="size-4" />
            {t('admin.win.openUser')}
          </button>
        </>
      }
    >
      <div className={`win-hero r-${draw.rarity}`}>
        <div className="win-hero-top">
          <RarityTag rarity={draw.rarity} />
          <time>{when(draw.created_at)}</time>
        </div>
        <h3>
          {draw.name} <GuaranteeTag draw={draw} />
        </h3>
        <b className="win-amount">
          <PrizeText draw={draw} />
        </b>
        <Details draw={draw} />
      </div>

      <div className="win-user">
        <Field label={t('admin.win.email')} value={user?.email ?? draw.email ?? '—'} />
        <Field label={t('admin.win.username')} value={user?.username || draw.username || '—'} />
        <Field label="ID" value={uid ? String(uid) : '—'} />
        <Field label={t('admin.users.balance')} value={user ? money(user.balance) : '—'} />
        <Field
          label={t('admin.users.status')}
          value={user ? (user.status === 'active' ? t('admin.users.active') : t('admin.users.disabled')) : '—'}
          tone={user && user.status !== 'active' ? 'off' : undefined}
        />
      </div>

      <div className="win-history-head">
        <h4>{t('admin.win.history')}</h4>
        {history && history.length > 0 && (
          <span>
            {t('admin.win.historyStats', { n: total, big, won: dollars(won) })}
          </span>
        )}
      </div>
      {history === null ? (
        <p className="usage-empty">{t('common.wait')}</p>
      ) : history.length === 0 ? (
        <p className="usage-empty">{t('admin.lottery.noDraws')}</p>
      ) : (
        <div className="win-history">
          {history.map((d) => (
            <div key={d.id} className={`draw-row compact ${d.id === draw.id ? 'on' : ''}`}>
              <time>{when(d.created_at)}</time>
              <RarityTag rarity={d.rarity} />
              <span className="truncate">{d.name}</span>
              <b>
                <PrizeText draw={d} />
              </b>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: 'off' }) {
  return (
    <div className={`win-field ${tone ?? ''}`}>
      <span>{label}</span>
      <b className="truncate" title={value}>
        {value}
      </b>
    </div>
  );
}

/** The draw's detail object as labelled values; unknown keys are left out. */
function Details({ draw }: { draw: Draw }) {
  const { t } = useI18n();
  const d = draw.detail ?? {};
  const rows: [string, string][] = [];
  const num = (k: string) => (d[k] === undefined || d[k] === null ? null : Number(d[k]));
  const pct = num('percent');
  if (pct !== null) rows.push([t('admin.win.percent'), `${Math.round(pct * 1000) / 10}%`]);
  const cost = num('today_cost');
  if (cost !== null) rows.push([t('admin.win.todayCost'), dollars(cost)]);
  const bal = num('balance');
  if (bal !== null) rows.push([t('admin.win.balanceThen'), dollars(bal)]);
  const rate = num('rate');
  if (rate !== null) rows.push([t('admin.lottery.rate'), t('lottery.zhe', zheVars(zhe(rate)))]);
  const cap = num('cap');
  if (cap !== null) rows.push([t('admin.lottery.cap'), cap > 0 ? dollars(cap) : t('admin.lottery.noCap')]);
  const hours = num('hours');
  if (hours !== null) rows.push([t('admin.lottery.hours'), t('lottery.hours', { n: hours })]);
  if (typeof d.expires_at === 'string') rows.push([t('admin.win.expires'), when(d.expires_at)]);
  rows.push([t('admin.lottery.value'), dollars(draw.value)]);
  return (
    <dl className="win-details">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Clickable list of epic and legendary wins. */
export function BigWins({ wins, onOpen, limit }: { wins: Draw[]; onOpen: (d: Draw) => void; limit?: number }) {
  const { t } = useI18n();
  const shown = limit ? wins.slice(0, limit) : wins;
  if (shown.length === 0) return <p className="usage-empty">{t('admin.lottery.noBigWins')}</p>;
  return (
    <div className="big-wins">
      {shown.map((d) => (
        <button key={d.id} className={`big-win r-${d.rarity}`} onClick={() => onOpen(d)}>
          <i className="big-win-bar" />
          <RarityTag rarity={d.rarity} />
          <span className="big-win-name truncate">{d.name}</span>
          <b>
            <PrizeText draw={d} />
          </b>
          <span className="big-win-user truncate">{d.email || d.username || `#${d.user_id}`}</span>
          <time>{when(d.created_at)}</time>
          <Icon name="chevronRight" className="size-4 text-ink-3" />
        </button>
      ))}
    </div>
  );
}
