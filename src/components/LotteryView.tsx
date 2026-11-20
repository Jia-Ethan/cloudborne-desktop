import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, errorText, type ChestSource, type LotteryBonus, type LotteryStatus, type Perk } from '../api';
import { useI18n, type T } from '../i18n';
import {
  RARITIES,
  batchSize,
  countdown,
  dailyState,
  dollars,
  earnProgress,
  quotaLeft,
  shanghaiShort,
  zhe,
  zheVars,
  type Phase as ActivityPhase,
} from '../lottery';
import { lotterySfx, setLotterySoundOn, useLotterySoundOn } from '../lottery/lotterySound';
import { Dialog } from './Dialog';
import { FoilPack, type FoilPackHandle, type PackHandoff, type PackIdleState, type PackOpenResult } from './FoilPack';
import { Icon } from './Icon';
import { PackPortal } from './PackPortal';
import { GuaranteeTag, PrizeText } from './Prize';

/**
 * The card-pack page: tear open foil booster packs (single or 2..10 batch)
 * earned by spending or bought with balance. `onStatus` keeps the sidebar
 * badge and visibility in step; `onBalance` refetches balance after an open
 * or purchase.
 */
export function LotteryView({
  balance,
  onBalance,
  onStatus,
}: {
  balance: number;
  onBalance: () => void;
  onStatus: (s: LotteryStatus) => void;
}) {
  const { t } = useI18n();
  const soundOn = useLotterySoundOn();
  const [status, setStatusState] = useState<LotteryStatus | null>(null);
  // Server clock minus ours, so countdowns follow the relay.
  const [skew, setSkew] = useState(0);
  const [error, setError] = useState('');
  const [selectedCount, setSelectedCount] = useState<number>(1);
  const [portalHandoff, setPortalHandoff] = useState<PackHandoff | null>(null);
  const [lastSkinId, setLastSkinId] = useState<string | undefined>(undefined);
  const packRef = useRef<FoilPackHandle>(null);
  const alive = useRef(true);

  const setStatus = useCallback(
    (s: LotteryStatus) => {
      setStatusState(s);
      const at = Date.parse(s.now);
      if (Number.isFinite(at)) setSkew(at - Date.now());
      onStatus(s);
    },
    [onStatus],
  );

  const load = useCallback(async () => {
    try {
      const s = await api.lottery();
      if (!alive.current) return;
      setStatus(s);
      setError('');
    } catch (e) {
      if (alive.current) setError(errorText(e, t('common.genericError')));
    }
  }, [setStatus, t]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const s = status;
  const win: ActivityPhase =
    !s || s.active ? 'running' : s.starts_at && Date.now() + skew < Date.parse(s.starts_at) ? 'upcoming' : 'ended';

  // Reload when the window opens or closes or midnight passes.
  useEffect(() => {
    if (!s?.enabled) return;
    const at = Date.now() + skew;
    const next = [s.starts_at, s.ends_at, s.daily?.expires_at ?? null]
      .map((x) => (x ? Date.parse(x) - at : NaN))
      .filter((d) => d > 0);
    if (next.length === 0) return;
    const id = setTimeout(load, Math.min(...next, 2 ** 31 - 1) + 1000);
    return () => clearTimeout(id);
  }, [s, skew, load]);

  const many = s ? batchSize(s.chests) : null;

  // Keep selected stack count in bounds whenever pack count changes.
  useEffect(() => {
    if (!s) return;
    if (many === null) {
      if (selectedCount !== 1) setSelectedCount(1);
    } else if (selectedCount > 1 && selectedCount !== many) {
      setSelectedCount(many);
    }
  }, [s, many, selectedCount]);

  const packState: PackIdleState = !s || s.chests > 0 ? 'ready' : win === 'running' ? 'locked' : 'empty';
  const earn = s && s.earn.enabled !== false ? earnProgress(s.earn) : null;
  const ratio = earn && win === 'running' ? earn.ratio : 0;
  const canOpen = !!s && s.enabled && s.chests > 0 && portalHandoff === null;
  const cap = s?.hold_cap ?? 0;

  /** Called by FoilPack only once the tear crosses the commit point (>55% / click). */
  const handleCommitOpen = useCallback(async (count: number): Promise<PackOpenResult> => {
    setError('');
    const res = await api.lotteryOpen(count);
    const draws = res.draws?.length ? res.draws : [res.draw];
    return { draws, status: res.status };
  }, []);

  const handleOpened = useCallback((handoff: PackHandoff) => {
    setLastSkinId(handoff.skin.id);
    setPortalHandoff(handoff);
  }, []);

  const handleOpenError = useCallback(
    (e: unknown) => {
      if (!alive.current) return;
      setError(errorText(e, t('common.genericError')));
      load();
    },
    [t, load],
  );

  const handleResultAccepted = useCallback(
    (nextStatus: LotteryStatus) => {
      if (!alive.current) return;
      setStatus(nextStatus);
      onBalance();
    },
    [setStatus, onBalance],
  );

  const triggerOpen = (count: number) => {
    if (!canOpen) return;
    setSelectedCount(count);
    packRef.current?.triggerTear(count, false);
  };

  return (
    <div className="main-scroll">
      <div className="main-column">
        <section className="card lot-head rise" style={{ '--i': 0 } as CSSProperties}>
          <div className="lot-head-text">
            <h1>
              {t('lottery.myChests', { n: s ? s.chests : '—' })}
              {cap > 0 && <em className={s?.full ? 'full' : ''}>{t('lottery.held', { n: s?.chests ?? 0, cap })}</em>}
            </h1>
            {s && <ActivityLine status={s} phase={win} skew={skew} />}
            {s?.bonus && <BonusLine bonus={s.bonus} />}
            {s?.full && <p className="lot-full">{t('lottery.full')}</p>}
          </div>
          <div className="lot-open">
            <button className="btn btn-primary" disabled={!canOpen} onClick={() => triggerOpen(1)}>
              <Icon name="pack" className="size-4" />
              {t('lottery.openN', { n: 1 })}
            </button>
            {many !== null && (
              <button className="btn btn-quiet" disabled={!canOpen} onClick={() => triggerOpen(many)}>
                {t('lottery.openN', { n: many })}
              </button>
            )}
          </div>
        </section>

        {error && <div className="usage-error rise">{error}</div>}

        {/* ---- Warm studio card-pack stage (holo.yashb.xyz gallery aesthetic) ---- */}
        <section className={`pk-stage rise state-${packState}`} style={{ '--i': 0 } as CSSProperties}>
          <div className="pk-stage-top">
            <span className="pk-stage-hint">
              {packState === 'ready'
                ? t('lottery.dragHint')
                : packState === 'locked'
                  ? t('lottery.lockedHint')
                  : t('lottery.ended')}
            </span>
            <button
              type="button"
              className="pk-mute-btn"
              aria-label={soundOn ? t('lottery.muteSound') : t('lottery.unmuteSound')}
              aria-pressed={!soundOn}
              onClick={() => setLotterySoundOn(!soundOn)}
            >
              <Icon name={soundOn ? 'volumeOn' : 'volumeOff'} className="size-[17px]" />
            </button>
          </div>

          <div className="pk-stage-center">
            {packState === 'locked' && <SpendRing ratio={ratio} />}
            <FoilPack
              ref={packRef}
              mode="embedded"
              packState={packState}
              packCount={selectedCount}
              suspended={portalHandoff !== null}
              excludeSkinId={lastSkinId}
              bonus={s?.bonus}
              dailyUnopened={s?.daily?.unopened ?? 0}
              onCommitOpen={handleCommitOpen}
              onOpened={handleOpened}
              onError={handleOpenError}
            />
          </div>

          <div className="pk-stage-foot">
            <div className="pk-meter">
              <span>{t('lottery.todayCost')}</span>
              <b>
                {s ? dollars(s.earn.today_spend) : '—'}
                {s && win === 'running' && earn && !earn.capped && (
                  <em> · {t('lottery.toNext', { amount: dollars(earn.toNext) })}</em>
                )}
              </b>
            </div>

            {many !== null && packState === 'ready' && (
              <div className="pk-stack-switch" role="group" aria-label={t('lottery.count')}>
                <button
                  type="button"
                  className={selectedCount === 1 ? 'on' : ''}
                  onClick={() => {
                    if (selectedCount !== 1) {
                      lotterySfx.tick();
                      setSelectedCount(1);
                    }
                  }}
                >
                  ×1
                </button>
                <button
                  type="button"
                  className={selectedCount === many ? 'on' : ''}
                  onClick={() => {
                    if (selectedCount !== many) {
                      lotterySfx.tick();
                      setSelectedCount(many);
                    }
                  }}
                >
                  ×{many}
                </button>
              </div>
            )}

            <div className="pk-meter right">
              <span>{t('lottery.chests')}</span>
              <b>{s ? s.chests : '—'}</b>
            </div>
          </div>
        </section>

        {s && (
          <div className="lot-ways">
            {s.daily && <DailyCard status={s} phase={win} skew={skew} index={1} />}
            <EarnCard status={s} phase={win} index={2} />
            <BuyCard
              status={s}
              phase={win}
              balance={balance}
              index={3}
              onBought={(next) => {
                setStatus(next);
                onBalance();
              }}
            />
          </div>
        )}

        {s && s.perks.length > 0 && (
          <div className="lot-perks">
            {s.perks.map((p, i) => (
              <PerkCard key={p.id} perk={p} index={i + 1} />
            ))}
          </div>
        )}

        <div className="lot-cols">
          <section className="card usage-card rise" style={{ '--i': 2 } as CSSProperties}>
            <div className="usage-card-head">
              <h2>{t('lottery.pool')}</h2>
            </div>
            <div className="lot-pool">
              {[...(s?.prizes ?? [])]
                .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity))
                .map((p) => (
                  <span key={p.id} className={`lot-chip r-${p.rarity}`}>
                    <i />
                    {p.name}
                  </span>
                ))}
            </div>
          </section>

          <section className="card usage-card rise" style={{ '--i': 3 } as CSSProperties}>
            <div className="usage-card-head">
              <h2>{t('lottery.today')}</h2>
            </div>
            {s && s.today.length === 0 ? (
              <p className="usage-empty">{t('lottery.noneToday')}</p>
            ) : (
              <div className="lot-results">
                {[...(s?.today ?? [])].reverse().map((d) => (
                  <div key={d.id} className={`lot-result r-${d.rarity}`}>
                    <i />
                    <span className="truncate">
                      {d.name} <GuaranteeTag draw={d} />
                    </span>
                    <SourceTag source={d.source} />
                    <b>
                      <PrizeText draw={d} />
                    </b>
                    <time>{new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {portalHandoff && s && (
        <PackPortal
          initialHandoff={portalHandoff}
          status={s}
          onCommitOpen={handleCommitOpen}
          onResultAccepted={handleResultAccepted}
          onClose={() => setPortalHandoff(null)}
        />
      )}
    </div>
  );
}

/** Subtle circular spend-progress halo behind a locked pack. */
function SpendRing({ ratio }: { ratio: number }) {
  const r = 178;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`pk-spend-ring ${ratio >= 1 ? 'full' : ''}`} viewBox="0 0 380 380" aria-hidden>
      <circle cx="190" cy="190" r={r} className="track" />
      <circle cx="190" cy="190" r={r} className="fill" strokeDasharray={`${c * ratio} ${c}`} transform="rotate(-90 190 190)" />
    </svg>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function PerkCard({ perk, index }: { perk: Perk; index: number }) {
  const { t } = useI18n();
  const now = useNow();
  const left = countdown(new Date(perk.expires_at).getTime() - now);
  const clock = left.days > 0 ? t('lottery.daysClock', { d: left.days, clock: left.clock }) : left.clock;
  const discount = perk.kind === 'discount';
  const used = discount ? (perk.refunded ?? 0) : (perk.left ?? 0);
  const cap = discount ? (perk.cap ?? 0) : (perk.amount ?? 0);
  return (
    <div className={`card lot-perk rise ${perk.kind}`} style={{ '--i': index } as CSSProperties}>
      <div className="lot-perk-head">
        <span>{discount ? t('lottery.perk.discount') : t('lottery.perk.credit')}</span>
        <time>{clock}</time>
      </div>
      <b className="lot-perk-big">{discount ? t('lottery.zhe', zheVars(zhe(perk.rate ?? 0))) : dollars(perk.amount ?? 0)}</b>
      <div className="lot-perk-meter">
        <div className="key-meter">
          <i style={{ width: `${cap > 0 ? Math.min(100, (used / cap) * 100) : 0}%` }} />
        </div>
        <span>
          {discount ? t('lottery.perk.refunded') : t('lottery.perk.left')} {dollars(used)} / {dollars(cap)}
        </span>
      </div>
    </div>
  );
}

/** What the guarantees promise this user right now. */
function BonusLine({ bonus: b }: { bonus: LotteryBonus }) {
  const { t } = useI18n();
  const items: { key: string; text: string; hot?: boolean }[] = [];
  if (b.pity_epic >= 2) items.push({ key: 'pity', text: t('lottery.bonus.pity', { n: b.pity_left }), hot: b.pity_left <= 3 });
  if (b.first_open_boost > 1 && b.first_open_ready) items.push({ key: 'first', text: t('lottery.bonus.first', { x: b.first_open_boost }), hot: true });
  if (b.batch_rare >= 2) items.push({ key: 'batch', text: t('lottery.bonus.batch', { n: b.batch_rare }) });
  if (items.length === 0) return null;
  return (
    <p className="lot-bonus">
      {items.map((x) => (
        <span key={x.key} className={x.hot ? 'hot' : ''}>
          {x.text}
        </span>
      ))}
    </p>
  );
}

function ActivityLine({ status: s, phase, skew }: { status: LotteryStatus; phase: ActivityPhase; skew: number }) {
  const { t } = useI18n();
  const now = useNow() + skew;
  const start = s.starts_at ? shanghaiShort(s.starts_at) : null;
  const end = s.ends_at ? shanghaiShort(s.ends_at) : null;
  const range = !start && !end ? t('lottery.forever') : `${start ?? t('lottery.fromNow')} – ${end ?? t('lottery.forever')}`;
  const target = phase === 'upcoming' && s.starts_at ? s.starts_at : phase === 'running' && s.ends_at ? s.ends_at : null;
  let clock = '';
  if (target) {
    const left = countdown(Date.parse(target) - now);
    clock = left.days > 0 ? t('lottery.daysClock', { d: left.days, clock: left.clock }) : left.clock;
  }
  return (
    <p className="lot-window">
      <span>
        {t('lottery.window')} {range}
      </span>
      {phase === 'upcoming' && <em>{t('lottery.startsIn', { clock })}</em>}
      {phase === 'running' && target && <em>{t('lottery.endsIn', { clock })}</em>}
      {phase === 'ended' && <em className="off">{t('lottery.ended')}</em>}
    </p>
  );
}

const closedText = (phase: ActivityPhase, t: T) => (phase === 'upcoming' ? t('lottery.notStarted') : t('lottery.ended'));

function EarnCard({ status: s, phase, index }: { status: LotteryStatus; phase: ActivityPhase; index: number }) {
  const { t } = useI18n();
  const e = s.earn;
  const p = earnProgress(e);
  const quota = quotaLeft(e.left_today);
  return (
    <section className="card usage-card lot-way rise" style={{ '--i': index } as CSSProperties}>
      <div className="usage-card-head">
        <h2>{t('lottery.earnTitle')}</h2>
      </div>
      {phase !== 'running' ? (
        <p className="usage-empty">{closedText(phase, t)}</p>
      ) : e.enabled === false ? (
        <p className="usage-empty">{t('lottery.earnOff')}</p>
      ) : (
        <>
          <p className="lot-way-line">
            {t('lottery.earnLine', { spent: dollars(e.today_spend), per: dollars(e.spend_per_chest) })}
          </p>
          <div className="key-meter lot-way-meter">
            <i style={{ width: `${Math.round(p.ratio * 100)}%` }} />
          </div>
          <div className="lot-way-foot">
            <span>
              {quota === 'out' ? t('lottery.earnSoldOut') : p.capped ? t('lottery.earnCapped') : t('lottery.toNextLong', { amount: dollars(p.toNext) })}
            </span>
            <b>
              {t('lottery.earnedToday', { n: e.earned_today })}
              {e.daily_cap > 0 && <em> / {e.daily_cap}</em>}
            </b>
          </div>
          {quota !== null && (
            <p className={`lot-quota ${quota === 'out' ? 'out' : ''}`}>
              {quota === 'out' ? t('lottery.earnQuotaOut') : t('lottery.earnQuotaLeft', { n: quota })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function BuyCard({
  status: s,
  phase,
  balance,
  index,
  onBought,
}: {
  status: LotteryStatus;
  phase: ActivityPhase;
  balance: number;
  index: number;
  onBought: (s: LotteryStatus) => void;
}) {
  const { t } = useI18n();
  const b = s.buy;
  const [count, setCount] = useState(1);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const max = Math.max(1, b.left_today);
  const n = Math.min(Math.max(1, count), max);
  const total = Math.round(b.price * n * 100) / 100;
  const sold = quotaLeft(b.sold_left);
  const short = balance < b.price;
  const over = total > balance + 1e-9;
  const can = b.enabled && b.left_today > 0 && !short;

  async function buy() {
    setBusy(true);
    setError('');
    try {
      const r = await api.lotteryBuy(n);
      setAsking(false);
      setCount(1);
      setDone(t('lottery.bought', { n: r.bought }));
      onBought(r.status);
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card usage-card lot-way rise" style={{ '--i': index } as CSSProperties}>
      <div className="usage-card-head">
        <h2>{t('lottery.buyTitle')}</h2>
        {phase === 'running' && b.enabled && <span className="lot-price">{t('lottery.price', { price: dollars(b.price) })}</span>}
      </div>
      {phase !== 'running' ? (
        <p className="usage-empty">{closedText(phase, t)}</p>
      ) : !b.enabled ? (
        <p className="usage-empty">{t('lottery.buyOff')}</p>
      ) : (
        <>
          <div className="lot-buy">
            <div className="stepper" aria-label={t('lottery.count')}>
              <button aria-label="−" disabled={!can || n <= 1} onClick={() => setCount(n - 1)}>
                <Icon name="minus" className="size-3.5" />
              </button>
              <b>{n}</b>
              <button aria-label="+" disabled={!can || n >= max} onClick={() => setCount(n + 1)}>
                <Icon name="plus" className="size-3.5" />
              </button>
            </div>
            <button
              className="btn btn-primary"
              disabled={!can || over}
              onClick={() => {
                setDone('');
                setError('');
                setAsking(true);
              }}
            >
              {t('lottery.buy')} · {dollars(total)}
            </button>
          </div>
          <div className="lot-way-foot">
            <span className={short || over ? 'warn' : ''}>
              {sold === 'out'
                ? t('lottery.soldOut')
                : s.full
                  ? t('lottery.full')
                  : b.left_today === 0
                    ? t('lottery.buyLimit')
                    : short || over
                      ? t('lottery.buyShort')
                      : done || t('lottery.balance', { amount: dollars(balance) })}
            </span>
            <b>{t('lottery.leftToday', { n: b.left_today })}</b>
          </div>
          {sold !== null && (
            <p className={`lot-quota ${sold === 'out' ? 'out' : ''}`}>
              {sold === 'out' ? t('lottery.soldOut') : t('lottery.soldLeft', { n: sold })}
            </p>
          )}
          {error && !asking && <p className="form-error">{error}</p>}
        </>
      )}
      {asking && (
        <Dialog
          title={t('lottery.buyTitle')}
          onClose={() => !busy && setAsking(false)}
          footer={
            <>
              {error && <p className="mr-auto text-[13px] text-[var(--danger)]">{error}</p>}
              <button className="btn btn-quiet" disabled={busy} onClick={() => setAsking(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={buy}>
                {busy ? t('common.wait') : t('lottery.buyConfirm', { amount: dollars(total) })}
              </button>
            </>
          }
        >
          <p className="confirm-text">
            {t('lottery.buyAsk', { n, price: dollars(b.price), amount: dollars(total), balance: dollars(Math.max(0, balance - total)) })}
          </p>
        </Dialog>
      )}
    </section>
  );
}

function DailyCard({ status: s, phase, skew, index }: { status: LotteryStatus; phase: ActivityPhase; skew: number; index: number }) {
  const { t } = useI18n();
  const d = s.daily!;
  const st = dailyState(d, s.earn.today_spend);
  const quota = quotaLeft(d.left_today);
  return (
    <section className="card usage-card lot-way lot-daily rise" style={{ '--i': index } as CSSProperties}>
      <div className="usage-card-head">
        <h2>{t('lottery.dailyTitle')}</h2>
        {phase === 'running' && d.enabled && (
          <span className={`lot-quota-tag ${quota === 'out' ? 'out' : ''}`}>
            {quota === 'out' ? t('lottery.dailySoldOut') : quota !== null ? t('lottery.dailyLeft', { n: quota }) : null}
          </span>
        )}
      </div>
      {phase !== 'running' ? (
        <p className="usage-empty">{closedText(phase, t)}</p>
      ) : st.kind === 'off' ? (
        <p className="usage-empty">{t('lottery.dailyOff')}</p>
      ) : (
        <>
          <p className="lot-way-line">
            {t('lottery.dailyLine', { amount: dollars(d.threshold), n: d.per_user })}
          </p>
          <div className="key-meter lot-way-meter">
            <i style={{ width: `${st.kind === 'progress' ? Math.round(st.ratio * 100) : st.kind === 'done' ? 100 : 0}%` }} />
          </div>
          <div className="lot-way-foot">
            <span className={st.kind === 'soldOut' ? 'warn' : ''}>
              {st.kind === 'progress'
                ? t('lottery.toNextLong', { amount: dollars(st.toNext) })
                : st.kind === 'done'
                  ? t('lottery.dailyGot')
                  : t('lottery.dailySoldOut')}
            </span>
            <b>
              {t('lottery.earnedToday', { n: d.mine_today })}
              <em> / {d.per_user}</em>
            </b>
          </div>
        </>
      )}
      {d.unopened > 0 && <DailyExpiry n={d.unopened} at={d.expires_at} skew={skew} />}
    </section>
  );
}

function DailyExpiry({ n, at, skew }: { n: number; at: string; skew: number }) {
  const { t } = useI18n();
  const now = useNow() + skew;
  const left = countdown(Date.parse(at) - now);
  return (
    <p className="lot-expiry">
      <Icon name="alert" className="size-3.5" />
      <span>{t('lottery.dailyUnopened', { n })}</span>
      <time>{left.clock}</time>
    </p>
  );
}

function SourceTag({ source }: { source?: ChestSource }) {
  const { t } = useI18n();
  if (!source) return <span />;
  return <em className={`lot-source s-${source}`}>{t(`lottery.source.${source}`)}</em>;
}
