import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  STAKES,
  byHand,
  byPlay,
  hints,
  judge,
  maxLoss,
  nextSeat,
  prevSeat,
  type Action,
  type Card,
  type Kind,
  type Move,
  type Seat,
  type SeatInfo,
  type Table,
} from '../ddz';
import { useI18n, type MessageKey, type T } from '../i18n';
import { dollars } from '../lottery';
import { Dialog } from './Dialog';
import { burst } from './fx';
import { Icon } from './Icon';
import { CardBack, CardRow, PlayingCard } from './PlayingCard';

/** Bump when the rules text changes so everyone reads it again. */
const RULES_VERSION = '1';
const RULES_KEY = 'cloudborne.ddz.rules';

/** Turn clocks; the relay enforces them, these only draw the ring. */
const BID_MS = 15000;
const PLAY_MS = 20000;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Plays worth a banner across the table. */
const SHOWY: Partial<Record<Kind, MessageKey>> = {
  bomb: 'ddz.kind.bomb',
  rocket: 'ddz.kind.rocket',
  plane: 'ddz.kind.plane',
  plane_singles: 'ddz.kind.plane',
  plane_pairs: 'ddz.kind.plane',
  straight: 'ddz.kind.straight',
  pair_straight: 'ddz.kind.pair_straight',
};

const signed = (n: number) => (n > 0 ? `+${dollars(n)}` : n < 0 ? `−${dollars(-n)}` : dollars(0));

/**
 * 斗地主: a lobby (quick match or a room by number) and the table. The relay
 * runs the game and sends a snapshot of the table on every change; this view
 * only draws it and sends the player's actions back.
 */
export function DdzView({ balance, table, send }: { balance: number; table: Table | null; send: (a: Action) => void }) {
  const [rulesFor, setRulesFor] = useState<Action | 'read' | null>(null);
  const accepted = () => localStorage.getItem(RULES_KEY) === RULES_VERSION;

  // Everything that can cost money goes through the rules once.
  const enter = useCallback(
    (a: Action) => {
      if (accepted()) send(a);
      else setRulesFor(a);
    },
    [send],
  );

  let body: ReactNode;
  if (!table) body = <Lobby balance={balance} onEnter={enter} onRules={() => setRulesFor('read')} />;
  else if (table.phase === 'waiting' && !table.code) body = <Matching table={table} send={send} />;
  else body = <TableScene table={table} send={send} />;

  return (
    <>
      {body}
      {rulesFor && (
        <RulesDialog
          agree={rulesFor !== 'read'}
          onClose={() => setRulesFor(null)}
          onAgree={() => {
            localStorage.setItem(RULES_KEY, RULES_VERSION);
            if (rulesFor !== 'read') send(rulesFor);
            setRulesFor(null);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- lobby

function Lobby({ balance, onEnter, onRules }: { balance: number; onEnter: (a: Action) => void; onRules: () => void }) {
  const { t } = useI18n();
  const affordable = (b: number) => balance >= maxLoss(b);
  const [base, setBase] = useState(STAKES[0]);
  const [code, setCode] = useState('');
  const canPlay = affordable(base);

  return (
    <div className="main-scroll">
      <div className="main-column ddz-lobby">
        <section className="ddz-hero rise" style={{ '--i': 0 } as CSSProperties}>
          <div className="ddz-hero-text">
            <h1>{t('ddz.title')}</h1>
            <p>{t('ddz.tagline')}</p>
            <div className="ddz-hero-balance">
              <span>{t('ddz.balance')}</span>
              <b>{dollars(balance)}</b>
            </div>
          </div>
          <div className="ddz-hero-fan" aria-hidden>
            <PlayingCard card={44} size="lg" style={{ '--r': '-16deg', '--x': '-58px' } as CSSProperties} />
            <PlayingCard card={49} size="lg" style={{ '--r': '-5deg', '--x': '-20px' } as CSSProperties} />
            <PlayingCard card={53} size="lg" style={{ '--r': '7deg', '--x': '20px' } as CSSProperties} />
            <PlayingCard card={52} size="lg" style={{ '--r': '18deg', '--x': '58px' } as CSSProperties} />
          </div>
        </section>

        <section className="ddz-stakes rise" style={{ '--i': 1 } as CSSProperties}>
          <h2>{t('ddz.pickBase')}</h2>
          <div className="ddz-stake-row" role="radiogroup" aria-label={t('ddz.pickBase')}>
            {STAKES.map((b) => (
              <button
                key={b}
                role="radio"
                aria-checked={base === b}
                className={`ddz-stake ${base === b ? 'on' : ''}`}
                disabled={!affordable(b)}
                title={affordable(b) ? undefined : t('ddz.needBalance', { amount: dollars(maxLoss(b)) })}
                onClick={() => setBase(b)}
              >
                <b>{dollars(b)}</b>
                <span>{t('ddz.maxLoss', { amount: dollars(maxLoss(b)) })}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="ddz-entries">
          <section className="card ddz-entry rise" style={{ '--i': 2 } as CSSProperties}>
            <div className="ddz-entry-icon">
              <Icon name="bolt" className="size-5" />
            </div>
            <h3>{t('ddz.quick')}</h3>
            <p>{t('ddz.quickHint')}</p>
            <button className="btn btn-primary ddz-entry-go" disabled={!canPlay} onClick={() => onEnter({ type: 'match', base })}>
              {t('ddz.quickGo', { base: dollars(base) })}
            </button>
          </section>

          <section className="card ddz-entry rise" style={{ '--i': 3 } as CSSProperties}>
            <div className="ddz-entry-icon">
              <Icon name="users" className="size-5" />
            </div>
            <h3>{t('ddz.room')}</h3>
            <p>{t('ddz.roomHint')}</p>
            <div className="ddz-entry-split">
              <button className="btn btn-quiet" disabled={!canPlay} onClick={() => onEnter({ type: 'create', base })}>
                <Icon name="plus" className="size-4" />
                {t('ddz.create', { base: dollars(base) })}
              </button>
              <form
                className="ddz-join"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.length === 6) onEnter({ type: 'join', code });
                }}
              >
                <input
                  className="field ddz-code-input"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t('ddz.codePlaceholder')}
                  aria-label={t('ddz.codePlaceholder')}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <button className="btn btn-primary" disabled={code.length !== 6}>
                  {t('ddz.join')}
                </button>
              </form>
            </div>
          </section>
        </div>

        <section className="ddz-rules-strip rise" style={{ '--i': 4 } as CSSProperties}>
          <Icon name="info" className="size-4" />
          <p>{t('ddz.rulesStrip', { cap: 16 })}</p>
          <button className="text-link" onClick={onRules}>
            {t('ddz.rulesRead')}
          </button>
        </section>
      </div>
    </div>
  );
}

function RulesDialog({ agree, onClose, onAgree }: { agree: boolean; onClose: () => void; onAgree: () => void }) {
  const { t } = useI18n();
  const items: MessageKey[] = [
    'ddz.rules.money',
    'ddz.rules.score',
    'ddz.rules.cap',
    'ddz.rules.entry',
    'ddz.rules.bots',
    'ddz.rules.timeout',
    'ddz.rules.fair',
  ];
  return (
    <Dialog
      title={t('ddz.rulesTitle')}
      onClose={onClose}
      footer={
        agree ? (
          <>
            <button className="btn btn-quiet" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" autoFocus onClick={onAgree}>
              {t('ddz.rulesAgree')}
            </button>
          </>
        ) : (
          <button className="btn btn-primary" autoFocus onClick={onClose}>
            {t('common.close')}
          </button>
        )
      }
    >
      <ol className="ddz-rules">
        {items.map((k, i) => (
          <li key={k} className={i === 0 ? 'warn' : ''}>
            {t(k, { cap: 16, times: 32 })}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}

function Matching({ table, send }: { table: Table; send: (a: Action) => void }) {
  const { t } = useI18n();
  const [start] = useState(() => Date.now());
  const now = useNow(500);
  const waited = Math.max(0, Math.floor((now - start) / 1000));
  return (
    <div className="ddz-felt ddz-matching">
      <div className="ddz-shuffle" aria-hidden>
        {[0, 1, 2].map((i) => (
          <CardBack key={i} size="md" style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <h2>{t('ddz.matching')}</h2>
      <p>{t('ddz.matchingLine', { base: dollars(table.base), s: waited })}</p>
      <p className="ddz-dim">{t('ddz.matchingBots')}</p>
      <button className="btn ddz-glass-btn" onClick={() => send({ type: 'cancel' })}>
        {t('common.cancel')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- table

function TableScene({ table, send }: { table: Table; send: (a: Action) => void }) {
  const { t } = useI18n();
  const me = table.me;
  const myTurn = table.turn === me && (table.phase === 'bid' || table.phase === 'play');
  const mine = table.seats[me];
  const [leaving, setLeaving] = useState(false);
  const fx = useTableFx(table);

  const leave = () => {
    if (table.phase === 'bid' || table.phase === 'play') setLeaving(true);
    else send({ type: 'leave' });
  };

  return (
    <div className={`ddz-felt ddz-table phase-${table.phase} ${fx.shake ? 'shake' : ''}`}>
      <canvas ref={fx.canvas} className="ddz-sparks" aria-hidden />
      <TopBar table={table} onLeave={leave} send={send} />

      <Opponent table={table} seat={prevSeat(me)} side="left" />
      <Opponent table={table} seat={nextSeat(me)} side="right" />

      <div className="ddz-center">
        <MoveBubble table={table} seat={prevSeat(me)} side="left" />
        <MoveBubble table={table} seat={nextSeat(me)} side="right" />
        <div className="ddz-center-me">
          {table.phase === 'waiting' ? <WaitingRoom table={table} send={send} /> : !myTurn && <MoveBubble table={table} seat={me} side="me" />}
        </div>
        {fx.banner && (
          <div key={fx.banner.key} className={`ddz-banner k-${fx.banner.kind}`}>
            {t(fx.banner.label)}
          </div>
        )}
      </div>

      {table.phase !== 'waiting' && <MyHand key={table.commit} table={table} myTurn={myTurn} send={send} />}
      {mine?.auto && table.phase === 'play' && (
        <div className="ddz-auto">
          <Icon name="bolt" className="size-4" />
          {t('ddz.autoOn')}
          <button className="btn btn-primary" onClick={() => send({ type: 'auto', on: false })}>
            {t('ddz.autoOff')}
          </button>
        </div>
      )}
      {table.result && <ResultSheet table={table} send={send} />}

      {leaving && (
        <Dialog
          title={t('ddz.leaveTitle')}
          onClose={() => setLeaving(false)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setLeaving(false)}>
                {t('ddz.stay')}
              </button>
              <button className="btn btn-danger" onClick={() => send({ type: 'leave' })}>
                {t('ddz.leaveAnyway')}
              </button>
            </>
          }
        >
          <p className="ddz-dialog-text">{t('ddz.leaveBody')}</p>
        </Dialog>
      )}
    </div>
  );
}

function TopBar({ table, onLeave, send }: { table: Table; onLeave: () => void; send: (a: Action) => void }) {
  const { t } = useI18n();
  const d = table.doubles;
  const parts = [
    d.rob && t('ddz.why.rob', { n: 2 ** d.rob }),
    d.bombs && t('ddz.why.bombs', { n: 2 ** d.bombs }),
    d.spring && t('ddz.why.spring'),
  ].filter(Boolean);
  const m = Math.min(16, 2 ** (d.rob + d.bombs) * (d.spring ? 2 : 1));
  const playing = table.phase === 'bid' || table.phase === 'play';
  const auto = table.seats[table.me]?.auto ?? false;
  return (
    <header className="ddz-top">
      <button className="ddz-chip ddz-chip-btn" onClick={onLeave}>
        <Icon name="chevronLeft" className="size-4" />
        {t('ddz.leave')}
      </button>
      <span className="ddz-chip">
        {t('ddz.base')} <b>{dollars(table.base)}</b>
      </span>
      {table.phase !== 'waiting' && (
        <>
          <span className={`ddz-chip ddz-mult ${m >= 4 ? 'hot' : ''}`} title={parts.join(' · ') || undefined}>
            {t('ddz.multiplier')} <b key={m}>×{m}</b>
          </span>

          <div className="ddz-bottom-cards" aria-label={t('ddz.bottom')}>
            {(table.bottom ?? [null, null, null]).map((c, i) =>
              c === null ? <CardBack key={i} size="sm" /> : <PlayingCard key={c} card={c} size="sm" fresh style={{ '--i': i } as CSSProperties} />,
            )}
          </div>
        </>
      )}

      <div className="ddz-top-end">
        {table.code && <RoomCode code={table.code} base={table.base} compact />}
        {playing && (
          <button className={`ddz-chip ddz-chip-btn ${auto ? 'on' : ''}`} onClick={() => send({ type: 'auto', on: !auto })} title={t('ddz.autoHint')}>
            <Icon name="bolt" className="size-4" />
            {t('ddz.auto')}
          </button>
        )}
      </div>
    </header>
  );
}

function RoomCode({ code, base, compact }: { code: string; base: number; compact?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(t('ddz.invite', { code, base: dollars(base) })).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  if (compact) {
    return (
      <button className="ddz-chip ddz-chip-btn" onClick={copy} title={t('ddz.copyInvite')}>
        <Icon name="hash" className="size-4" />
        <b className="ddz-code-sm">{code}</b>
        {copied && <Icon name="check" className="size-3.5" />}
      </button>
    );
  }
  return (
    <div className="ddz-code">
      <span className="ddz-code-label">{t('ddz.roomCode')}</span>
      <div className="ddz-code-digits">
        {code.split('').map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <button className="btn ddz-glass-btn" onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} className="size-4" />
        {copied ? t('common.copied') : t('ddz.copyInvite')}
      </button>
    </div>
  );
}

function WaitingRoom({ table, send }: { table: Table; send: (a: Action) => void }) {
  const { t } = useI18n();
  const me = table.seats[table.me];
  const empty = table.seats.filter((s) => !s).length;
  const owner = table.owner === table.me;
  return (
    <div className="ddz-room">
      {table.code && <RoomCode code={table.code} base={table.base} />}
      <p className="ddz-dim">{empty ? t('ddz.waitingFor', { n: empty }) : t('ddz.waitingReady')}</p>
      <div className="ddz-room-actions">
        {owner && empty > 0 && (
          <button className="btn ddz-glass-btn" onClick={() => send({ type: 'bots' })} title={t('ddz.botsHint')}>
            <Icon name="sparkle" className="size-4" />
            {t('ddz.fillBots')}
          </button>
        )}
        <button className={`btn ${me?.ready ? 'ddz-glass-btn' : 'btn-gold'}`} onClick={() => send({ type: 'ready' })}>
          {me?.ready ? t('ddz.unready') : t('ddz.ready')}
        </button>
      </div>
      {owner && empty > 0 && <p className="ddz-dim ddz-small">{t('ddz.botsHint')}</p>}
    </div>
  );
}

function Avatar({ info, seat, table, size = 'md' }: { info: SeatInfo | null; seat: Seat; table: Table; size?: 'md' | 'lg' }) {
  const { t } = useI18n();
  const turn = table.turn === seat && (table.phase === 'bid' || table.phase === 'play');
  const lord = table.landlord === seat;
  const left = useCountdown(turn ? table.deadline : null);
  return (
    <div className={`ddz-avatar ${size} hue-${seat} ${turn ? 'turn' : ''} ${lord ? 'lord' : ''} ${info ? '' : 'empty'}`}>
      <span className="ddz-avatar-face">{info ? info.bot ? <Icon name="sparkle" className="size-5" /> : info.name.slice(0, 1) : '?'}</span>
      {turn && table.deadline && <TimerRing key={table.deadline} deadline={table.deadline} total={table.phase === 'bid' ? BID_MS : PLAY_MS} />}
      {turn && left !== null && left <= 10 && <span className="ddz-avatar-secs">{left}</span>}
      {lord && (
        <span className="ddz-crown" title={t('ddz.landlord')}>
          <Icon name="crown" className="size-3.5" />
        </span>
      )}
    </div>
  );
}

/** Drains over the turn; started part-way when the turn began before this drew. */
function TimerRing({ deadline, total }: { deadline: number; total: number }) {
  const left = Math.min(total, Math.max(0, deadline - Date.now()));
  return (
    <svg className="ddz-ring" viewBox="0 0 44 44" aria-hidden>
      <circle
        cx="22"
        cy="22"
        r="20"
        pathLength="100"
        style={{
          animationDuration: `${total}ms`,
          animationDelay: `${left - total}ms`,
        }}
      />
    </svg>
  );
}

function SeatTags({ info, table, seat }: { info: SeatInfo; table: Table; seat: Seat }) {
  const { t } = useI18n();
  return (
    <span className="ddz-tags">
      {table.landlord !== null && (
        <span className={`ddz-role ${table.landlord === seat ? 'lord' : ''}`}>{t(table.landlord === seat ? 'ddz.landlord' : 'ddz.farmer')}</span>
      )}
      {info.bot && <span className="ddz-tag">AI</span>}
      {info.auto && <span className="ddz-tag">{t('ddz.auto')}</span>}
      {!info.online && <span className="ddz-tag warn">{t('ddz.offline')}</span>}
      {table.phase === 'waiting' && info.ready && <span className="ddz-tag ok">{t('ddz.isReady')}</span>}
    </span>
  );
}

function Opponent({ table, seat, side }: { table: Table; seat: Seat; side: 'left' | 'right' }) {
  const { t } = useI18n();
  const info = table.seats[seat];
  const left = info?.left ?? 0;
  const dealt = table.phase === 'bid' || table.phase === 'play';
  return (
    <aside className={`ddz-opp ${side}`}>
      <Avatar info={info} seat={seat} table={table} size="lg" />
      <div className="ddz-opp-meta">
        <b className="truncate">{info?.name ?? t('ddz.emptySeat')}</b>
        {info && <SeatTags info={info} table={table} seat={seat} />}
      </div>
      {dealt && (
        <div className={`ddz-stack ${left > 0 && left <= 2 ? 'alarm' : ''}`} title={t('ddz.cardsLeft', { n: left })}>
          <CardBack size="sm" />
          <b>{left}</b>
          {left > 0 && left <= 2 && <span className="ddz-alarm">{t('ddz.alarm', { n: left })}</span>}
        </div>
      )}
    </aside>
  );
}

function MoveBubble({ table, seat, side }: { table: Table; seat: Seat; side: 'left' | 'right' | 'me' }) {
  const { t } = useI18n();
  const move = table.moves[seat];
  const thinking = table.turn === seat && (table.phase === 'bid' || table.phase === 'play') && side !== 'me';
  if (thinking) {
    return (
      <div className={`ddz-move ${side} thinking`} aria-label={t('ddz.thinking')}>
        <i />
        <i />
        <i />
      </div>
    );
  }
  if (!move) return <div className={`ddz-move ${side} none`} />;
  if (move.cards?.length) {
    return (
      <div className={`ddz-move ${side} cards`} key={move.cards.join()}>
        <CardRow cards={byPlay(move.cards)} size={side === 'me' ? 'md' : 'sm'} />
        {move.pattern && <span className="ddz-move-kind">{t(`ddz.kind.${move.pattern.kind}` as MessageKey)}</span>}
      </div>
    );
  }
  return (
    <div className={`ddz-move ${side} word ${move.bid === 'call' || move.bid === 'rob' ? 'strong' : ''}`} key={`${move.seat}-${move.bid ?? 'pass'}`}>
      {t(move.bid ? (`ddz.bid.${move.bid}` as MessageKey) : 'ddz.pass')}
    </div>
  );
}

// ---------------------------------------------------------------- my hand

function MyHand({ table, myTurn, send }: { table: Table; myTurn: boolean; send: (a: Action) => void }) {
  const { t } = useI18n();
  const hand = useMemo(() => byHand(table.hand), [table.hand]);
  const [sel, setSel] = useState<Set<Card>>(() => new Set());
  const [hintAt, setHintAt] = useState(0);
  const [nudge, setNudge] = useState<string | null>(null);
  const drag = useRef<boolean | null>(null);
  const prev = table.phase === 'play' ? (table.last?.pattern ?? null) : null;
  const lastKey = table.last?.cards?.join() ?? '';

  // Drop cards that left the hand; a new trick restarts the hint cycle.
  useEffect(() => setSel((s) => new Set([...s].filter((c) => table.hand.includes(c)))), [table.hand]);
  useEffect(() => {
    setHintAt(0);
    setNudge(null);
  }, [lastKey, myTurn]);
  useEffect(() => {
    const up = () => (drag.current = null);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const set = (c: Card, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(c);
      else n.delete(c);
      return n;
    });

  const picked = hand.filter((c) => sel.has(c));
  const verdict = judge(picked, prev);
  const playing = table.phase === 'play' && myTurn;
  const bidding = table.phase === 'bid' && myTurn;
  const leading = !table.last;

  const hint = () => {
    const list = hints(table.hand, prev);
    if (list.length === 0) {
      setNudge(t('ddz.noBeat'));
      return;
    }
    setSel(new Set(list[hintAt % list.length]));
    setHintAt((i) => i + 1);
  };
  const play = () => {
    if (verdict.verdict !== 'ok') return;
    send({ type: 'play', cards: picked });
    setSel(new Set());
  };
  const pass = () => {
    if (leading) return;
    send({ type: 'pass' });
    setSel(new Set());
  };

  useEffect(() => {
    if (!playing && !bidding) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (playing && (k === ' ' || k === 'enter')) {
        e.preventDefault();
        play();
      } else if (playing && k === 'p') pass();
      else if (playing && k === 'h') hint();
      else if (k === 'escape') setSel(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Overlap the cards just enough to fit the row.
  const row = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(34);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth - 24;
      const card = 74;
      setStep(Math.max(18, Math.min(44, (w - card) / Math.max(1, hand.length - 1))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hand.length]);

  const status = (() => {
    if (nudge) return { text: nudge, tone: 'warn' };
    if (!playing) return null;
    if (verdict.verdict === 'bad') return { text: t('ddz.notAPlay'), tone: 'warn' };
    if (verdict.verdict === 'small') return { text: t('ddz.tooSmall'), tone: 'warn' };
    if (verdict.verdict === 'ok' && verdict.pattern)
      return {
        text: t(`ddz.kind.${verdict.pattern.kind}` as MessageKey),
        tone: 'ok',
      };
    return { text: leading ? t('ddz.youLead') : t('ddz.yourTurn'), tone: '' };
  })();

  return (
    <div className={`ddz-me ${myTurn ? 'turn' : ''}`}>
      <div className="ddz-bar">
        <div className="ddz-me-who">
          <Avatar info={table.seats[table.me]} seat={table.me} table={table} />
          <div className="ddz-opp-meta">
            <b className="truncate">{table.seats[table.me]?.name}</b>
            {table.seats[table.me] && <SeatTags info={table.seats[table.me]!} table={table} seat={table.me} />}
          </div>
        </div>

        <div className="ddz-actions">
          {bidding && (
            <>
              <button className="btn ddz-glass-btn" onClick={() => send({ type: 'bid', want: false })}>
                {t(table.rob ? 'ddz.bid.norob' : 'ddz.bid.pass')}
              </button>
              <button className="btn btn-gold" onClick={() => send({ type: 'bid', want: true })}>
                {t(table.rob ? 'ddz.bid.rob' : 'ddz.bid.call')}
              </button>
            </>
          )}
          {playing && (
            <>
              <button className="btn ddz-glass-btn" disabled={leading} onClick={pass}>
                {t('ddz.pass')}
                <kbd>P</kbd>
              </button>
              <button className="btn ddz-glass-btn" onClick={hint}>
                {t('ddz.hint')}
                <kbd>H</kbd>
              </button>
              <button className="btn btn-gold" disabled={verdict.verdict !== 'ok'} onClick={play}>
                {t('ddz.play')}
                <kbd>␣</kbd>
              </button>
            </>
          )}
          {!myTurn && table.phase !== 'over' && <span className="ddz-dim">{waitingLine(table, t)}</span>}
        </div>

        <div className="ddz-status">{status && <span className={`ddz-verdict ${status.tone}`}>{status.text}</span>}</div>
      </div>

      <div
        ref={row}
        className="ddz-hand"
        style={{ '--step': `${step}px`, '--n': hand.length } as CSSProperties}
        onContextMenu={(e) => {
          e.preventDefault();
          setSel(new Set());
        }}
      >
        {hand.map((c, i) => (
          <PlayingCard
            key={c}
            card={c}
            size="lg"
            selected={sel.has(c)}
            fresh={table.bottom?.includes(c) && table.landlord === table.me}
            style={{ '--i': i } as CSSProperties}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const on = !sel.has(c);
              drag.current = on;
              set(c, on);
            }}
            onPointerEnter={() => drag.current !== null && set(c, drag.current)}
          />
        ))}
      </div>
    </div>
  );
}

function waitingLine(table: Table, t: T): string {
  const who = table.turn !== null ? (table.seats[table.turn]?.name ?? '') : '';
  if (table.phase === 'bid') return t(table.rob ? 'ddz.waitRob' : 'ddz.waitCall', { name: who });
  if (table.phase === 'play') return t('ddz.waitPlay', { name: who });
  return '';
}

// ---------------------------------------------------------------- result

function ResultSheet({ table, send }: { table: Table; send: (a: Action) => void }) {
  const { t } = useI18n();
  const r = table.result!;
  const me = table.me;
  const won = r.delta[me] > 0;
  const lordWon = r.winner === table.landlord;
  const d = r.doubles;
  const steps: { label: string; x: number }[] = [];
  if (d.rob) steps.push({ label: t('ddz.why.robShort'), x: 2 ** d.rob });
  if (d.bombs)
    steps.push({
      label: t('ddz.why.bombsShort', { n: d.bombs }),
      x: 2 ** d.bombs,
    });
  if (d.spring) steps.push({ label: t(lordWon ? 'ddz.spring' : 'ddz.antiSpring'), x: 2 });
  const order: Seat[] = [me, nextSeat(me), prevSeat(me)];
  return (
    <div className="ddz-result-wrap">
      <div className={`ddz-result ${won ? 'won' : 'lost'}`} role="dialog" aria-label={t(won ? 'ddz.won' : 'ddz.lost')}>
        <div className="ddz-result-head">
          <span className="ddz-result-badge">{t(lordWon ? 'ddz.lordWins' : 'ddz.farmersWin')}</span>
          <h2>{t(won ? 'ddz.won' : 'ddz.lost')}</h2>
          <b className="ddz-result-amount">{signed(r.delta[me])}</b>
        </div>

        <div className="ddz-formula">
          <span className="ddz-factor">
            <small>{t('ddz.base')}</small>
            {dollars(table.base)}
          </span>
          {steps.map((s) => (
            <span key={s.label} className="ddz-factor">
              <small>{s.label}</small>×{s.x}
            </span>
          ))}
          {table.landlord === me && (
            <span className="ddz-factor">
              <small>{t('ddz.landlordShare')}</small>×2
            </span>
          )}
          <span className="ddz-factor total">
            <small>{r.multiplier === 16 ? t('ddz.capped') : t('ddz.total')}</small>
            {signed(r.delta[me])}
          </span>
        </div>

        <ul className="ddz-result-rows">
          {order.map((s) => {
            const info = table.seats[s];
            return (
              <li key={s} className={s === me ? 'me' : ''}>
                <span className="ddz-result-who">
                  {table.landlord === s && <Icon name="crown" className="size-3.5" />}
                  {info?.name}
                  {info?.bot && <span className="ddz-tag">AI</span>}
                </span>
                <span className="ddz-result-left">
                  {r.hands[s].length ? <CardRow cards={byHand(r.hands[s])} size="xs" /> : <em>{t('ddz.playedOut')}</em>}
                </span>
                <b className={r.delta[s] >= 0 ? 'up' : 'down'}>{signed(r.delta[s])}</b>
              </li>
            );
          })}
        </ul>

        <p className="ddz-proof" title={t('ddz.proofHint')}>
          {t('ddz.proof', { commit: table.commit, seed: r.seed })}
        </p>

        <div className="ddz-result-actions">
          <button className="btn ddz-glass-btn" onClick={() => send({ type: 'leave' })}>
            {t('ddz.leave')}
          </button>
          <button className="btn btn-gold" autoFocus onClick={() => send({ type: 'ready' })}>
            {t('ddz.again')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- effects and clocks

/** A banner and sparks for big plays; the table shakes for bombs. */
function useTableFx(table: Table) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [banner, setBanner] = useState<{
    key: string;
    kind: string;
    label: MessageKey;
  } | null>(null);
  const [shake, setShake] = useState(false);
  const seen = useRef('');

  useEffect(() => {
    const m: Move | null = table.last;
    const key = m?.cards ? `${m.seat}:${m.cards.join()}` : '';
    if (!key || key === seen.current) return;
    const first = seen.current === '';
    seen.current = key;
    if (first || !m?.pattern) return;
    const label = SHOWY[m.pattern.kind];
    if (!label) return;
    setBanner({ key, kind: m.pattern.kind, label });
    const timer = setTimeout(() => setBanner(null), 1500);
    if ((m.pattern.kind === 'bomb' || m.pattern.kind === 'rocket') && !reducedMotion()) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      const c = canvas.current;
      if (c) {
        const { width, height } = c.getBoundingClientRect();
        burst(c, {
          x: width / 2,
          y: height * 0.42,
          colors: m.pattern.kind === 'rocket' ? ['#ffd36e', '#ff5d73', '#ffffff', '#ff9d3c'] : ['#ffd36e', '#ff9d3c', '#ffffff'],
          count: m.pattern.kind === 'rocket' ? 140 : 90,
          power: m.pattern.kind === 'rocket' ? 9 : 7,
        });
      }
    }
    return () => clearTimeout(timer);
  }, [table.last]);

  useEffect(() => {
    if (!table.result?.doubles.spring) return;
    setBanner({
      key: 'spring',
      kind: 'spring',
      label: table.result.winner === table.landlord ? 'ddz.spring' : 'ddz.antiSpring',
    });
    const timer = setTimeout(() => setBanner(null), 1600);
    return () => clearTimeout(timer);
  }, [table.result, table.landlord]);

  return { canvas, banner, shake };
}

function useNow(every: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

/** Whole seconds until deadline, or null without one. */
function useCountdown(deadline: number | null) {
  const now = useNow(250);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}
