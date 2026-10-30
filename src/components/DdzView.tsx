import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import {
  BIG_JOKER,
  HEROES,
  HERO_NAMES, FREE_POLICY, seatName, type FeePolicy,
  MAX_WILD,
  MIN_WILD,
  SKILL_AIM,
  STAKES,
  byHand,
  hints,
  judge,
  nextSeat,
  prevSeat,
  rankLabel,
  rankOf,
  wildPattern,
  type Action,
  type Card,
  type Field,
  type Hero,
  type Joker,
  type Kind,
  type Move,
  type Seat,
  type SeatInfo,
  type SkillArgs,
  type Step,
  type Table,
} from '../ddz';
import { useI18n, type MessageKey, type T } from '../i18n';
import type { DdzConn } from '../useDdz';
import { dollars } from '../lottery';
import { api, errorText, type DdzStatus } from '../api';
import { HeroInfo, PlayHistory, PlayCards } from './DdzDetails';
import { Dialog } from './Dialog';
import { burst } from './fx';
import { climbTick, cue, playSound, setSoundOn, useSoundOn } from '../ddzSound';
import { Icon } from './Icon';
import { Logo, type LogoId } from './Logo';
import { CardBack, CardRow, PlayingCard } from './PlayingCard';

/** Bump when the rules text changes so everyone reads it again. */
const RULES_VERSION = '3';
const RULES_KEY = 'cloudborne.ddz.rules';

/** Turn clocks; the relay enforces them, these only draw the ring. */
const BID_MS = 20000;
const PLAY_MS = 30000;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const DDZ_QUALITY_KEY = 'cloudborne.ddz.quality';

type DdzQuality = 'standard' | 'high';

function readDdzQuality(): DdzQuality {
  if (reducedMotion()) return 'standard';
  try {
    return localStorage.getItem(DDZ_QUALITY_KEY) === 'high' ? 'high' : 'standard';
  } catch {
    return 'standard';
  }
}

const LOGO: Record<Hero, LogoId> = {
  gpt: 'openai',
  claude: 'claude',
  gemini: 'gemini',
  grok: 'grok',
  deepseek: 'deepseek',
  kimi: 'kimi',
  glm: 'zhipu',
  minimax: 'minimax',
  qwen: 'qwen',
};
const NAME = HERO_NAMES;
/** Brand tint for the ring around each hero. */
const TINT: Record<Hero, string> = {
  gpt: '#10a37f',
  claude: '#d97757',
  gemini: '#3186ff',
  grok: '#9aa0a6',
  deepseek: '#4d6bfe',
  kimi: '#2d6bff',
  glm: '#3859ff',
  minimax: '#fe603c',
  qwen: '#6f69f7',
};

/** Plays worth a banner across the table. */
const SHOWY: Partial<Record<Kind, MessageKey>> = {
  trio: 'ddz.kind.trio',
  trio_single: 'ddz.kind.trio_single',
  trio_pair: 'ddz.kind.trio_pair',
  bomb: 'ddz.kind.bomb',
  rocket: 'ddz.kind.rocket',
  plane: 'ddz.kind.plane',
  plane_singles: 'ddz.kind.plane',
  plane_pairs: 'ddz.kind.plane',
  straight: 'ddz.kind.straight',
  pair_straight: 'ddz.kind.pair_straight',
  four_singles: 'ddz.kind.four_singles',
  four_pairs: 'ddz.kind.four_pairs',
};

const signed = (n: number) => (n > 0 ? `+${dollars(n)}` : n < 0 ? `−${dollars(-n)}` : dollars(0));
const fmtX = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(n * 10 === Math.round(n * 10) ? 1 : 2));

/**
 * 小丑斗地主: a lobby (quick match or a room by number) and the table. The relay
 * runs the game and sends a snapshot of the table on every change; this view
 * only draws it and sends the player's actions back.
 */
export function DdzView({ balance, table, conn, send, userId = 0, previewStatus }: { balance: number; table: Table | null; conn: DdzConn; send: (a: Action) => void; userId?: number; previewStatus?: DdzStatus | null }) {
  const { t } = useI18n();
  const [rulesFor, setRulesFor] = useState<Action | 'read' | null>(null);
  const [status, setStatus] = useState<DdzStatus | null>(previewStatus ?? null);
  const [policy, setPolicy] = useState<FeePolicy>(FREE_POLICY);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const acceptanceKey = (p: FeePolicy) => `${RULES_KEY}.${userId}.${RULES_VERSION}.${p.version}`;
  useEffect(() => {
    // The app-level prefetch only paints the lobby without a wait; the view
    // still polls so a fee policy or switch changed later reaches this page.
    // `null` means the prefetch has not answered yet, so ask now.
    if (previewStatus != null) setStatus(previewStatus);
    let gone = false;
    const refresh = () => api.ddzStatus().then(s => { if (!gone) setStatus(s); }).catch(() => {});
    if (previewStatus == null) void refresh();
    const timer = setInterval(refresh, 15000);
    return () => { gone=true;clearInterval(timer); };
  }, [previewStatus]);
  const enter = async (a: Action) => {
    if (!['match','create','join','ready','bots'].includes(a.type)) { send(a);return; }
    if (busy.current) return;
    busy.current=true;setError('');
    try {
      // Always ask at the door: the relay refuses a seat under an old fee policy version.
      const st = await api.ddzStatus();setStatus(st);
      if (!st.enabled) { setError(t('ddz.unavailable'));return; }
      const p=st.fee_policy ?? FREE_POLICY;setPolicy(p);
      const action={...a,fee_policy:p.version};
      if (localStorage.getItem(acceptanceKey(p)) === 'yes') send(action);
      else setRulesFor(action);
    } catch(e) { setError(errorText(e,t('common.genericError'))); }
    finally {busy.current=false;}
  };
  let body: ReactNode;
  if (!table) body=<Lobby balance={balance} conn={conn} onEnter={a=>void enter(a)} onRules={()=>{setPolicy(status?.fee_policy ?? FREE_POLICY);setRulesFor('read');}} policy={status?.fee_policy} minBalanceTimes={status?.min_balance_times} />;
  else if (table.phase === 'waiting' && !table.code) body=<Matching send={send} />;
  else body=<TableScene table={table} conn={conn} send={a=>void enter(a)} />;
  return <>{error && <div className="ddz-entry-error" role="alert">{error}</div>}{body}{rulesFor && <RulesDialog policy={policy} agree={rulesFor!=='read'} onClose={()=>setRulesFor(null)} onAgree={()=>{
    localStorage.setItem(acceptanceKey(policy),'yes');
    if(rulesFor!=='read') void enter(rulesFor);
    setRulesFor(null);
  }}/>}</>;
}

// ---------------------------------------------------------------- lobby

function Lobby({ balance, conn, onEnter, onRules, policy, minBalanceTimes }: { balance: number; conn: DdzConn; onEnter: (a: Action) => void; onRules: () => void; policy?: FeePolicy; minBalanceTimes?: number }) {
  const { t } = useI18n();
  const quality = useMemo(readDdzQuality, []);
  const times = Number.isFinite(minBalanceTimes) && (minBalanceTimes ?? 0) > 0 ? minBalanceTimes! : 20;
  const affordable = (b: number) => balance >= b * times;
  const [base, setBase] = useState(STAKES[0]);
  const [code, setCode] = useState('');
  const canPlay = affordable(base) && conn === 'open';

  return (
    <div className="main-scroll">
      <div className={`main-column ddz-lobby ddz-${quality}`}>
        <section className="card ddz-intro rise" style={{ '--i': 0 } as CSSProperties}>
          <div className="ddz-intro-text">
            <h1>{t('ddz.title')}</h1>
            <p>{t('ddz.tagline')}</p>
            <button className="text-link ddz-rules-link" onClick={onRules}>
              {t('ddz.rulesRead')}
              <Icon name="chevronRight" className="size-3.5" />
            </button>
          </div>
          <div className="ddz-intro-fan" aria-hidden>
            {FAN.map((c, i) => (
              <PlayingCard key={c} card={c} size="md" style={{ '--i': i } as CSSProperties} />
            ))}
          </div>
        </section>

        <section className="card ddz-roster rise" style={{ '--i': 1 } as CSSProperties}>
          <div className="ddz-section-head">
            <h2>{t('ddz.guide.heroes')}</h2>
            <span>{t('ddz.avatarHint')}</span>
          </div>
          <div className="ddz-roster-row">
            {HEROES.map((h) => (
              <div key={h} className="ddz-roster-item">
                <HeroInfo hero={h}><HeroBadge hero={h} /></HeroInfo>
                <span>{NAME[h]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card ddz-play rise" style={{ '--i': 2 } as CSSProperties}>
          <div className="ddz-section-head">
            <h2>{t('ddz.base')}</h2>
            <span>{policy ? t(policy.bps > 0 ? 'ddz.feeNotice' : 'ddz.feeFree', { rate: policy.bps / 100 }) : t('common.wait')}</span>
          </div>
          <div className="ddz-stake-row" role="radiogroup" aria-label={t('ddz.base')}>
            {STAKES.map((b) => (
              <button
                key={b}
                role="radio"
                aria-checked={base === b}
                className={`ddz-stake ${base === b ? 'on' : ''}`}
                disabled={!affordable(b)}
                title={affordable(b) ? undefined : t('ddz.needBalance', { amount: dollars(b * times) })}
                onClick={() => setBase(b)}
              >
                <b>{dollars(b)}</b>
                <small>{t('ddz.needBalance', { amount: dollars(b * times) })}</small>
              </button>
            ))}
          </div>
          <div className="ddz-entries">
            <button className="btn btn-primary ddz-go" disabled={!canPlay} onClick={() => onEnter({ type: 'match', base })}>
              <Icon name="bolt" className="size-4" />
              {t('ddz.quick')}
            </button>
            <button className="btn btn-quiet ddz-go" disabled={!canPlay} onClick={() => onEnter({ type: 'create', base })}>
              <Icon name="plus" className="size-4" />
              {t('ddz.create')}
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
              <button className="btn btn-quiet" disabled={code.length !== 6 || conn !== 'open'}>
                {t('ddz.join')}
              </button>
            </form>
          </div>
        </section>
        {conn !== 'open' && conn !== 'idle' && (
          <p className="ddz-lobby-note" role="status">
            {t(conn === 'auth' ? 'ddz.signedOut' : conn === 'unavailable' ? 'ddz.unavailable' : 'ddz.reconnecting')}
          </p>
        )}
      </div>
    </div>
  );
}

/** The lobby's fanned cards: a joker over the top of a hand. */
const FAN: Card[] = [51, 41, 44, BIG_JOKER];

function RulesDialog({ agree, onClose, onAgree, policy }: { agree: boolean; onClose: () => void; onAgree: () => void; policy: FeePolicy }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'rules' | 'heroes' | 'jokers'>('rules');
  return (
    <Dialog
      title={t('ddz.rulesTitle')}
      onClose={onClose}
      wide={tab !== 'rules'}
      className="ddz-sheet"
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
        <li className="warn">{t('ddz.rules.money')}</li>
        <li>{t('ddz.rules.score')}</li>
        <li>{t('ddz.rules.auto')}</li>
        <li className="warn">{t(policy.bps>0?'ddz.feeNotice':'ddz.feeFree',{rate:policy.bps/100})}</li>
        {policy.bps>0 && <li>{t('ddz.feeExample',{fee:dollars(2*policy.bps/10000),net:dollars(2-2*policy.bps/10000)})}</li>}
      </ol>
      <div className="ddz-guide-tabs" role="tablist">
        {(['rules', 'heroes', 'jokers'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t(`ddz.guide.${k}` as MessageKey)}
          </button>
        ))}
      </div>
      {tab === 'rules' && <p className="ddz-guide-text">{t('ddz.guide.flow')}</p>}
      {tab === 'heroes' && (
        <ul className="ddz-guide-list">
          {HEROES.map((h) => (
            <li key={h}>
              <HeroInfo hero={h}><HeroBadge hero={h} size="sm" /></HeroInfo>
              <span>
                <b>
                  {NAME[h]} · {t(`ddz.skill.${h}` as MessageKey)}
                </b>
                {t(`ddz.skill.${h}.desc` as MessageKey)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {tab === 'jokers' && (
        <ul className="ddz-guide-list jokers">
          {JOKER_LIST.map((j) => (
            <li key={j}>
              <JokerCard joker={j} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

const JOKER_LIST: Joker[] = [
  'straight',
  'chain',
  'pilot',
  'trio',
  'pair',
  'demo',
  'shield',
  'last_stand',
  'closer',
  'snatch',
  'clutch',
  'control',
  'first',
  'speed',
  'dragon',
  'lowkey',
  'raise',
  'ledger',
];

function Matching({ send }: { send: (a: Action) => void }) {
  const { t } = useI18n();
  return (
    <div className="ddz-felt ddz-matching">
      <div className="ddz-shuffle" aria-hidden>
        {[0, 1, 2].map((i) => (
          <CardBack key={i} size="md" style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <h2>{t('ddz.matching')}</h2>
      <button className="btn btn-quiet" onClick={() => send({ type: 'cancel' })}>
        {t('common.cancel')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

export function HeroBadge({ hero, size = 'md', style }: { hero: Hero; size?: 'sm' | 'md' | 'lg'; style?: CSSProperties }) {
  return (
    <span className={`ddz-herob ${size} h-${hero}`} style={{ '--tint': TINT[hero], ...style } as CSSProperties} title={NAME[hero]}>
      <span className="ddz-herob-face">
        <Logo id={LOGO[hero]} className="ddz-herob-logo" />
      </span>
    </span>
  );
}

/** A joker as a little card: name on top, what it does below. */
function JokerCard({ joker, size = 'md', onClick, picked }: { joker: Joker; size?: 'sm' | 'md'; onClick?: () => void; picked?: boolean }) {
  const { t } = useI18n();
  const body = (
    <>
      <span className="ddz-joker-glyph" aria-hidden />
      <b>{t(`ddz.joker.${joker}` as MessageKey)}</b>
      <span>{t(`ddz.joker.${joker}.desc` as MessageKey)}</span>
    </>
  );
  if (onClick) {
    return (
      <button className={`ddz-joker ${size} ${picked ? 'picked' : ''}`} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={`ddz-joker ${size}`}>{body}</div>;
}

// ---------------------------------------------------------------- table

function TableScene({ table, conn, send }: { table: Table; conn: DdzConn; send: (a: Action) => void }) {
  const { t } = useI18n();
  const me = table.me;
  const showdown = table.phase === 'showdown';
  const myTurn = table.turn === me && (table.phase === 'bid' || table.phase === 'play');
  const mine = table.seats[me];
  const [leaving, setLeaving] = useState(false);
  const felt = useRef<HTMLDivElement>(null);
  const [cardScale, setCardScale] = useState(1);
  const [compact, setCompact] = useState(false);
  const [short, setShort] = useState(false);
  const quality = useMemo(readDdzQuality, []);
  const fx = useTableFx(table, quality);

  // Cards are drawn in CSS pixels, so a larger table used to leave the hand
  // at the same size while only the empty felt grew around it. Keep the
  // reference proportions but follow the actual table viewport in both
  // directions. The bounds preserve a usable hand in compact windows and
  // prevent oversized cards from crowding the controls on very wide ones.
  useLayoutEffect(() => {
    const el = felt.current;
    if (!el) return;
    const fit = () => {
      const rect = el.getBoundingClientRect();
      setCompact(rect.width < 760);
      setShort(rect.height < 640);
      const widthScale = rect.width / 1100;
      // The hand, controls and top bar use roughly 560px at the reference
      // size; using that usable height lets a wider desktop grow the cards
      // without waiting for the window to become proportionally taller.
      const heightScale = rect.height / 560;
      const next = Math.max(0.72, Math.min(1.55, Math.min(widthScale, heightScale)));
      setCardScale((current) => (Math.abs(current - next) < 0.01 ? current : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const leave = () => {
    if (table.phase === 'bid' || table.phase === 'joker' || table.phase === 'play' || showdown) setLeaving(true);
    else send({ type: 'leave' });
  };

  return (
    <div
      ref={felt}
      style={{
        '--ddz-card-scale': cardScale,
        '--ddz-lg-w': `${74 * cardScale}px`,
        '--ddz-lg-h': `${104 * cardScale}px`,
        '--ddz-lg-fs': `${24 * cardScale}px`,
        '--ddz-sm-w': `${40 * cardScale}px`,
        '--ddz-sm-h': `${56 * cardScale}px`,
        '--ddz-sm-fs': `${15 * cardScale}px`,
      } as CSSProperties}
      className={`ddz-felt ddz-table ddz-${quality} ${compact ? 'ddz-compact' : ''} ${short ? 'ddz-short' : ''} phase-${table.phase} ${fx.shake} ${fx.impact ? `hit-${fx.impact.kind} hit-from-${fx.impact.from}` : ''}`}
    >
      <canvas ref={fx.canvas} className="ddz-sparks" aria-hidden />
      {fx.impact && <ImpactLayer fx={fx.impact} quality={quality} />}
      <TopBar table={table} onLeave={leave} send={send} />
      {conn !== 'open' && (
        <div className="ddz-conn" role="status">
          {t(conn === 'auth' ? 'ddz.signedOut' : conn === 'unavailable' ? 'ddz.unavailable' : 'ddz.reconnecting')}
        </div>
      )}

      <Opponent table={table} seat={prevSeat(me)} side="left" />
      <Opponent table={table} seat={nextSeat(me)} side="right" />

      <div className="ddz-center">
        {table.phase === 'play' && <div className="ddz-target">{table.last?.cards?.length ? <><span>{t('ddz.target')}</span><PlayCards move={table.last} compact /></> : <span>{t('ddz.newLead')}</span>}</div>}
        {showdown && table.last?.cards?.length ? (
          <div className="ddz-showdown" role="status" aria-live="polite">
            <span className="ddz-showdown-title">{t('ddz.showdown')}</span>
            <PlayCards move={table.last} />
          </div>
        ) : (
          <>
            <MoveBubble table={table} seat={prevSeat(me)} side="left" />
            <MoveBubble table={table} seat={nextSeat(me)} side="right" />
            <div className="ddz-center-me">
              {table.phase === 'waiting' ? (
                <WaitingRoom table={table} send={send} />
              ) : table.phase === 'joker' ? (
                <JokerPick table={table} send={send} />
              ) : (
                !myTurn && <MoveBubble table={table} seat={me} side="me" />
              )}
            </div>
          </>
        )}
        {fx.banner && (
          <div key={fx.banner.key} className={`ddz-banner k-${fx.banner.kind}`}>
            {fx.banner.hero && <HeroBadge hero={fx.banner.hero} size="lg" />}
            <span className="ddz-banner-text">{fx.banner.text}</span>
          </div>
        )}
        {table.tracker && <Tracker counts={table.tracker} />}
      </div>

      {table.phase !== 'waiting' && <MyHand key={table.commit} table={table} myTurn={myTurn} send={send} cardScale={cardScale} />}
      {mine?.auto && table.phase === 'play' && (
        <div className="ddz-auto">
          {t('ddz.autoOn')}
          <button className="btn btn-primary" onClick={() => send({ type: 'auto', on: false })}>
            {t('ddz.autoOff')}
          </button>
        </div>
      )}
      {table.phase === 'over' && table.result && <ResultSheet table={table} send={send} />}

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
  const playing = table.phase === 'bid' || table.phase === 'joker' || table.phase === 'play';
  const auto = table.seats[table.me]?.auto ?? false;
  return (
    <header className="ddz-top">
      <div className="ddz-top-start">
        <button className="ddz-chip ddz-chip-btn" onClick={onLeave} aria-label={t('ddz.leave')}>
          <Icon name="chevronLeft" className="size-4" />
        </button>
        <span className="ddz-chip">
          {t('ddz.base')} <b>{dollars(table.base)}</b>
          {table.fee_policy && <small>{t('ddz.feeRate',{rate:table.fee_policy.bps/100})}</small>}
        </span>
        {table.field && <FieldCard field={table.field} />}
      </div>

      <div className="ddz-top-mid">
        {table.phase !== 'waiting' && (
          <div className="ddz-bottom-cards" aria-label={t('ddz.bottom')}>
            {(table.bottom ?? [null, null, null]).map((c, i) =>
              c === null ? <CardBack key={i} size="sm" /> : <PlayingCard key={c} card={c} size="sm" fresh style={{ '--i': i } as CSSProperties} />,
            )}
          </div>
        )}
        {table.phase !== 'waiting' && (
          <span className={`ddz-mult ${table.mult >= 8 ? 'hot' : ''}`} aria-label={`×${fmtX(table.mult)}`}>
            <b key={table.mult}>×{fmtX(table.mult)}</b>
          </span>
        )}
      </div>

      <div className="ddz-top-end">
        <SoundToggle />
        <PlayHistory table={table} />
        {table.code && <RoomCode code={table.code} base={table.base} compact />}
        {playing && (
          <button className={`ddz-chip ddz-chip-btn ${auto ? 'on' : ''}`} onClick={() => send({ type: 'auto', on: !auto })}>
            {t('ddz.auto')}
          </button>
        )}
      </div>
    </header>
  );
}

function SoundToggle() {
  const { t } = useI18n();
  const on = useSoundOn();
  return (
    <button
      className={`ddz-chip ddz-chip-btn ddz-sound ${on ? '' : 'off'}`}
      onClick={() => setSoundOn(!on)}
      aria-pressed={on}
      aria-label={t(on ? 'ddz.soundOff' : 'ddz.soundOn')}
      title={t(on ? 'ddz.soundOff' : 'ddz.soundOn')}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
        {on ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="m16 9.5 5 5M21 9.5l-5 5" />}
      </svg>
    </button>
  );
}

function FieldCard({ field }: { field: Field }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
    <button type="button" className={`ddz-field ddz-field-button f-${field}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
      <b>{t(`ddz.field.${field}` as MessageKey)}</b>
      <Icon name="info" className="size-3.5" />
    </button>
    {open && <Dialog title={t(`ddz.field.${field}` as MessageKey)} onClose={() => setOpen(false)} className="ddz-sheet">
      <p className="ddz-field-detail">{t(`ddz.field.${field}.desc` as MessageKey)}</p>
      <p className="ddz-field-detail muted">{t('ddz.field.tapHint')}</p>
    </Dialog>}
    </>
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
        <Icon name={copied ? 'check' : 'hash'} className="size-4" />
        <b className="ddz-code-sm">{code}</b>
      </button>
    );
  }
  return (
    <div className="ddz-code">
      <div className="ddz-code-digits">
        {code.split('').map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <button className="btn btn-quiet" onClick={copy}>
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
      <div className="ddz-room-actions">
        {owner && empty > 0 && (
          <button className="btn btn-quiet" onClick={() => send({ type: 'bots' })}>
            <Icon name="sparkle" className="size-4" />
            {t('ddz.fillBots')}
          </button>
        )}
        <button className={`btn ${me?.ready ? 'btn-quiet' : 'btn-primary'}`} onClick={() => send({ type: 'ready' })}>
          {me?.ready ? t('ddz.unready') : t('ddz.ready')}
        </button>
      </div>
    </div>
  );
}

/** The three jokers on offer after bidding; a pick is final. */
function JokerPick({ table, send }: { table: Table; send: (a: Action) => void }) {
  const { t } = useI18n();
  const mine = table.seats[table.me]?.joker;
  if (!table.offers || mine) {
    return <div className="ddz-joker-wait">{mine ? <JokerCard joker={mine} /> : null}</div>;
  }
  return (
    <div className="ddz-joker-pick">
      <h3>{t('ddz.pickJoker')}</h3>
      <div className="ddz-joker-row">
        {table.offers.map((j, i) => (
          <JokerCard key={j} joker={j} onClick={() => send({ type: 'joker', index: i })} />
        ))}
      </div>
    </div>
  );
}

/** 记牌器: how many of each rank are still out, from big jokers down. */
function Tracker({ counts }: { counts: number[] }) {
  const { t } = useI18n();
  const labels = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', t('ddz.smallJoker'), t('ddz.bigJoker')];
  return (
    <div className="ddz-tracker" aria-label={t('ddz.tracker')}>
      {counts
        .map((n, r) => ({ n, r }))
        .reverse()
        .map(({ n, r }) => (
          <span key={r} className={n === 0 ? 'gone' : ''}>
            <i>{labels[r]}</i>
            <b>{n}</b>
          </span>
        ))}
    </div>
  );
}

function Avatar({ info, seat, table, size = 'md', versus = false }: { info: SeatInfo | null; seat: Seat; table: Table; size?: 'md' | 'lg'; versus?: boolean }) {
  const { t } = useI18n();
  const turn = table.turn === seat && (table.phase === 'bid' || table.phase === 'play');
  const lord = table.landlord === seat;
  const left = useCountdown(turn ? table.deadline : null, turn);
  const low = !!info && info.left > 0 && info.left <= 2 && (table.phase === 'play' || table.phase === 'showdown');
  return (
    <div className={`ddz-avatar ${size} ${turn ? 'ddz-turn' : ''} ${lord ? 'lord' : ''} ${low ? 'ddz-low' : ''} ${info ? '' : 'empty'}`}>
      {info ? <HeroInfo hero={info.hero} info={info} table={table} versusSeat={versus ? seat : undefined}><HeroBadge hero={info.hero} size={size === 'lg' ? 'lg' : 'md'} /></HeroInfo> : <span className="ddz-avatar-empty">?</span>}
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
        r="20.5"
        pathLength="100"
        style={{ animationDuration: `${total}ms`, animationDelay: `${left - total}ms` }}
      />
    </svg>
  );
}

/** Name, then the small marks that matter: AI, auto, offline, the joker. */
function SeatMeta({ info, table, seat }: { info: SeatInfo; table: Table; seat: Seat }) {
  const { t } = useI18n();
  return (
    <div className="ddz-meta">
      <b className="truncate" title={seatName(info)}>{seatName(info)}</b>
      <span className="ddz-tags">
        {info.bot && <span className="ddz-tag">AI</span>}
        {info.auto && <span className="ddz-tag">{t('ddz.auto')}</span>}
        {!info.online && <span className="ddz-tag warn">{t('ddz.offline')}</span>}
        {table.phase === 'waiting' && info.ready && <span className="ddz-tag ok">{t('ddz.isReady')}</span>}
        {info.joker && (
          <span className="ddz-tag joker" title={t(`ddz.joker.${info.joker}.desc` as MessageKey)}>
            ★ {t(`ddz.joker.${info.joker}` as MessageKey)}
          </span>
        )}
        {table.phase === 'play' && info.skills === 0 && seat !== table.me && (
          <span className="ddz-tag spent">{t(`ddz.skill.${info.hero}` as MessageKey)}</span>
        )}
      </span>
    </div>
  );
}

function Opponent({ table, seat, side }: { table: Table; seat: Seat; side: 'left' | 'right' }) {
  const { t } = useI18n();
  const info = table.seats[seat];
  const left = info?.left ?? 0;
  const dealt = table.phase === 'bid' || table.phase === 'joker' || table.phase === 'play' || table.phase === 'showdown';
  return (
    <aside className={`ddz-opp ${side}`}>
      <Avatar info={info} seat={seat} table={table} size="lg" versus />
      {info ? <SeatMeta info={info} table={table} seat={seat} /> : <span className="ddz-dim">{t('ddz.emptySeat')}</span>}
      <span className="ddz-thinking-label">{table.turn === seat && table.phase === 'play' ? t('ddz.thinking') : null}</span>
      {dealt && !info?.shown && !info?.peeked && (
        <div className={`ddz-stack ${left > 0 && left <= 2 ? 'alarm' : ''}`}>
          <CardBack size="sm" />
          <b>{left}</b>
        </div>
      )}
      {info?.shown && <CardRow cards={byHand(info.shown)} size="xs" className="ddz-shown" />}
      {info?.peeked && (
        <div className="ddz-peeked" title={t('ddz.peeked')}>
          <small>{t('ddz.peeked')}</small>
          <CardRow cards={byHand(info.peeked)} size="xs" className="ddz-shown" />
        </div>
      )}
    </aside>
  );
}

function MoveBubble({ table, seat, side }: { table: Table; seat: Seat; side: 'left' | 'right' | 'me' }) {
  const { t } = useI18n();
  const move = table.moves[seat];
  if (!move) return <div className={`ddz-move ${side} none`} />;
  if (move.cards?.length) {
    return (
      <div className={`ddz-move ${side} cards k-${move.pattern?.kind ?? 'single'}`} key={move.cards.join()}>
        {move.trick !== undefined && table.trick !== undefined && move.trick < table.trick && <small>{t('ddz.previousTrick')}</small>}
        <PlayCards move={move} />
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

function MyHand({ table, myTurn, send, cardScale = 1 }: { table: Table; myTurn: boolean; send: (a: Action) => void; cardScale?: number }) {
  const { t } = useI18n();
  const hand = useMemo(() => byHand(table.hand), [table.hand]);
  const [sel, setSel] = useState<Set<Card>>(() => new Set());
  const [hintAt, setHintAt] = useState(0);
  const [nudge, setNudge] = useState<string | null>(null);
  const [aiming, setAiming] = useState<Hero | null>(null);
  const drag = useRef<boolean | null>(null);
  const prev = table.phase === 'play' ? (table.last?.pattern ?? null) : null;
  const lastKey = table.last?.cards?.join() ?? '';
  const mine = table.seats[table.me];

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
  const useSkill = (args: SkillArgs) => {
    send({ type: 'skill', args });
    setAiming(null);
    setSel(new Set());
  };

  useEffect(() => {
    if (!playing && !bidding) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[data-ddz-info], [aria-modal="true"]') || (e.target instanceof HTMLElement && (e.target.closest('button,input,textarea,select') || e.target.isContentEditable)) || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (playing && (k === ' ' || k === 'enter')) {
        e.preventDefault();
        play();
      } else if (playing && k === 'p') pass();
      else if (playing && k === 'h') hint();
      else if (k === 'escape') {
        setSel(new Set());
        setAiming(null);
      }
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
      const w = el.clientWidth - 56;
      const card = el.querySelector<HTMLElement>('.pc')?.getBoundingClientRect().width || 74;
      const scale = card / 74;
      setStep(Math.max(18 * scale, Math.min(44 * scale, (w - card) / Math.max(1, hand.length - 1))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hand.length, cardScale]);

  const status = (() => {
    if (nudge) return { text: nudge, tone: 'warn' };
    if (!playing) return null;
    if (verdict.verdict === 'bad') return { text: t('ddz.notAPlay'), tone: 'warn' };
    if (verdict.verdict === 'small') return { text: t('ddz.tooSmall'), tone: 'warn' };
    if (verdict.verdict === 'ok' && verdict.pattern) return { text: t(`ddz.kind.${verdict.pattern.kind}` as MessageKey), tone: 'ok' };
    return null;
  })();

  return (
    // Keep game state names scoped: the chat .turn class adds a 14px gap.
    <div className={`ddz-me ${myTurn ? 'ddz-my-turn' : ''}`}>
      <div className="ddz-bar">
        <div className="ddz-me-who">
          <Avatar info={mine} seat={table.me} table={table} />
          {mine && <SeatMeta info={mine} table={table} seat={table.me} />}
          {mine && table.phase === 'play' && (
            <SkillButton
              table={table}
              hero={mine.hero}
              ready={playing && mine.skills > 0}
              onUse={(h) => {
                // 百变 needs the selected hero in the wire payload even when
                // that hero has no additional targeting step (Claude/GPT/etc.).
                // SkillAim already carries `copy` for skills that do need one.
                if (SKILL_AIM[h] === 'none') useSkill(mine.hero === 'qwen' ? { copy: h } : {});
                else setAiming(h);
              }}
            />
          )}
        </div>

        <div className="ddz-actions">
          {bidding && (
            <>
              <button className="btn btn-quiet" onClick={() => send({ type: 'bid', want: false })}>
                {t(table.rob ? 'ddz.bid.norob' : 'ddz.bid.pass')}
              </button>
              <button className="btn btn-primary" onClick={() => send({ type: 'bid', want: true })}>
                {t(table.rob ? 'ddz.bid.rob' : 'ddz.bid.call')}
              </button>
            </>
          )}
          {playing && (
            <>
              <button className="btn btn-quiet" disabled={leading} onClick={pass}>
                {t('ddz.pass')}
              </button>
              <button className="btn btn-quiet" onClick={hint}>
                {t('ddz.hint')}
              </button>
              <button className="btn btn-primary" disabled={verdict.verdict !== 'ok'} onClick={play}>
                {t('ddz.play')}
              </button>
            </>
          )}
          {!myTurn && (table.phase === 'bid' || table.phase === 'play') && <span className="ddz-dim">{waitingLine(table, t)}</span>}
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

      {aiming && <SkillAim table={table} hero={aiming} picked={picked} onUse={useSkill} onCancel={() => setAiming(null)} />}
    </div>
  );
}

/** My hero's one skill: glows when it can be used, greys out once spent. */
function SkillButton({ table, hero, ready, onUse }: { table: Table; hero: Hero; ready: boolean; onUse: (h: Hero) => void }) {
  const { t } = useI18n();
  const left = table.seats[table.me]?.skills ?? 0;
  const [copying, setCopying] = useState(false);
  const others = table.seats.filter((s, i) => s && i !== table.me).map((s) => s!.hero);
  return (
    <div className="ddz-skill-wrap">
      <button
        className={`ddz-skill ${ready ? 'ready' : ''} ${left === 0 ? 'spent' : ''}`}
        disabled={!ready}
        style={{ '--tint': TINT[hero] } as CSSProperties}
        onClick={() => (hero === 'qwen' ? setCopying((v) => !v) : onUse(hero))}
        title={t(`ddz.skill.${hero}.desc` as MessageKey)}
      >
        <b>{t(`ddz.skill.${hero}` as MessageKey)}</b>
        {left > 1 && <i>×{left}</i>}
      </button>
      {copying && ready && (
        <div className="ddz-skill-pop">
          {others.map((h) => (
            <button
              key={h}
              onClick={() => {
                setCopying(false);
                onUse(h);
              }}
              title={t(`ddz.skill.${h}.desc` as MessageKey)}
            >
              <HeroBadge hero={h} size="sm" />
              {t(`ddz.skill.${h}` as MessageKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The extra step some skills need: whom to ask, which cards. */
function SkillAim({
  table,
  hero,
  picked,
  onUse,
  onCancel,
}: {
  table: Table;
  hero: Hero;
  picked: Card[];
  onUse: (a: SkillArgs) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const copy = table.seats[table.me]?.hero === 'qwen' ? hero : undefined;
  const [target, setTarget] = useState<Seat | null>(null);
  const enemies = ([0, 1, 2] as Seat[]).filter(
    (s) => s !== table.me && (table.landlord === null || s === table.landlord || table.me === table.landlord),
  );
  const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
  const aim = SKILL_AIM[hero];
  const maxCards = hero === 'gemini' ? 3 : table.me === table.landlord ? 4 : 3;
  return (
    <div className="ddz-aim" role="dialog">
      <div className="ddz-aim-head">
        <b>{t(`ddz.skill.${hero}` as MessageKey)}</b>
        <span>{t(`ddz.aim.${aim}` as MessageKey, { n: maxCards })}</span>
        <button className="ddz-aim-x" onClick={onCancel} aria-label={t('common.cancel')}>
          <Icon name="close" className="size-4" />
        </button>
      </div>
      {aim === 'opponent-rank' && (
        <>
          <div className="ddz-aim-row">
            {enemies.map((s) => (
              <button key={s} className={target === s ? 'on' : ''} onClick={() => setTarget(s)}>
                {table.seats[s] && <HeroBadge hero={table.seats[s]!.hero} size="sm" />}
                {table.seats[s] ? seatName(table.seats[s]!) : ''}
              </button>
            ))}
          </div>
          <div className="ddz-aim-ranks">
            {ranks.map((r) => (
              <button key={r} disabled={target === null} onClick={() => target !== null && onUse({ target, rank: r, copy })}>
                {r >= 13 ? t(r === 14 ? 'ddz.bigJoker' : 'ddz.smallJoker') : rankLabel(r * 4)}
              </button>
            ))}
          </div>
        </>
      )}
      {aim === 'cards-hand' && (
        <button className="btn btn-primary" disabled={picked.length === 0 || picked.length > maxCards} onClick={() => onUse({ cards: picked, copy })}>
          {t('ddz.aim.drop', { n: picked.length })}
        </button>
      )}
      {aim === 'cards-played' && <GeminiAim table={table} give={picked} max={maxCards} onUse={(cards) => onUse({ cards, give: picked, copy })} />}
      {aim === 'opponent' && (
        <>
          <div className="ddz-aim-row">
            {enemies.map((s) => (
              <button
                key={s}
                disabled={picked.length > 1 || (picked.length === 1 && picked.length >= table.hand.length)}
                onClick={() => onUse({ target: s, give: picked.slice(0, 1), copy })}
              >
                {table.seats[s] && <HeroBadge hero={table.seats[s]!.hero} size="sm" />}
                {table.seats[s] ? seatName(table.seats[s]!) : ''}
              </button>
            ))}
          </div>
          <p className="ddz-aim-note">{t(picked.length === 1 ? 'ddz.aim.swapOne' : picked.length > 1 ? 'ddz.aim.swapTooMany' : 'ddz.aim.swapNone')}</p>
        </>
      )}
      {aim === 'wild' && <WildAim table={table} picked={picked} onUse={(a) => onUse({ ...a, copy })} />}
    </div>
  );
}

/**
 * 混合专家: select the play in hand, tap the card to stand in, then the rank
 * it counts as. Only readings the relay would take are offered.
 */
function WildAim({ table, picked, onUse }: { table: Table; picked: Card[]; onUse: (a: SkillArgs) => void }) {
  const { t } = useI18n();
  const [wild, setWild] = useState<Card | null>(null);
  const cards = useMemo(() => byHand(picked).filter((c) => rankOf(c) < 13), [picked]);
  const w = wild !== null && picked.includes(wild) ? wild : null;
  const ranks = Array.from({ length: MAX_WILD + 1 }, (_, r) => MAX_WILD - r);
  if (table.last) return <p className="ddz-aim-note">{t('ddz.aim.wildLead')}</p>;
  if (picked.length < MIN_WILD) return <p className="ddz-aim-note">{t('ddz.aim.wildPick', { n: MIN_WILD })}</p>;
  return (
    <>
      <div className="ddz-aim-pool">
        {cards.map((c) => (
          <button key={c} className={w === c ? 'on' : ''} onClick={() => setWild(c)}>
            <PlayingCard card={c} size="sm" />
          </button>
        ))}
      </div>
      <div className="ddz-aim-ranks">
        {ranks.map((r) => {
          const p = w !== null ? wildPattern(picked, w, r) : null;
          return (
            <button key={r} disabled={!p} title={p ? t(`ddz.kind.${p.kind}` as MessageKey) : undefined} onClick={() => p && w !== null && onUse({ cards: picked, wild: w, rank: r })}>
              {rankLabel(r * 4)}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** 长记忆: pick up to n cards from finished tricks, given up the same number selected in hand. */
function GeminiAim({ table, give, max, onUse }: { table: Table; give: Card[]; max: number; onUse: (cards: Card[]) => void }) {
  const { t } = useI18n();
  const [take, setTake] = useState<Card[]>([]);
  const pool = useMemo(() => [...table.played].sort((a, b) => b - a), [table.played]);
  return (
    <>
      <div className="ddz-aim-pool">
        {pool.map((c) => (
          <button
            key={c}
            className={take.includes(c) ? 'on' : ''}
            onClick={() => setTake((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : xs.length < max ? [...xs, c] : xs))}
          >
            <PlayingCard card={c} size="sm" />
          </button>
        ))}
      </div>
      <button className="btn btn-primary" disabled={take.length === 0 || take.length !== give.length} onClick={() => onUse(take)}>
        {t('ddz.aim.swap', { n: take.length })}
      </button>
    </>
  );
}

function waitingLine(table: Table, t: T): string {
  const who = table.turn !== null ? (table.seats[table.turn] ? seatName(table.seats[table.turn]!) : '') : '';
  if (table.phase === 'bid') return t(table.rob ? 'ddz.waitRob' : 'ddz.waitCall', { name: who });
  if (table.phase === 'play') return t('ddz.waitPlay', { name: who });
  return '';
}

// ---------------------------------------------------------------- result

/** Names each step of the multiplier the way the table shows it. */
function stepLabel(st: Step, table: Table, t: T): { label: string; hero?: Hero } {
  const who = st.seat !== null ? table.seats[st.seat] : null;
  if (st.source.startsWith('field_')) return { label: t(`ddz.field.${st.source.slice(6)}` as MessageKey) };
  if (HEROES.includes(st.source as Hero)) return { label: t(`ddz.skill.${st.source}` as MessageKey), hero: who?.hero };
  if (JOKER_LIST.includes(st.source as Joker)) return { label: `★ ${t(`ddz.joker.${st.source}` as MessageKey)}` };
  const k = `ddz.step.${st.source}` as MessageKey;
  return { label: t(k) };
}

/**
 * The deal's result, counted up the way Balatro scores a hand: each step of my
 * share pops in and the multiplier climbs, then the money lands.
 */
function ResultSheet({ table, send }: { table: Table; send: (a: Action) => void }) {
  const { t } = useI18n();
  const r = table.result!;
  const me = table.me;
  const won = (r.winner === table.landlord) === (me === table.landlord);
  const lordWon = r.winner === table.landlord;
  // My share: a farmer has one, the landlord sees the larger of its two.
  const share = me === table.landlord ? [...r.shares].sort((a, b) => b.mult - a.mult)[0] : r.shares.find((s) => s.farmer === me)!;
  const steps = share.steps;
  const order: Seat[] = [me, nextSeat(me), prevSeat(me)];

  return (
    <div className="ddz-result-wrap">
      <div className={`ddz-result ${won ? 'won' : 'lost'}`} role="dialog" aria-modal="true" aria-label={t(won ? 'ddz.won' : 'ddz.lost')}>
        <div className="ddz-result-body">
          <div className="ddz-result-head">
            <span className="ddz-result-badge">{t(lordWon ? 'ddz.lordWins' : 'ddz.farmersWin')}</span>
            <b className="ddz-result-amount">{signed(r.delta[me])}</b>
            <span className="ddz-result-caption">{t('ddz.net')}</span>
            <ResultClimb key={table.commit} table={table} steps={steps} mult={share.mult} won={won} />
          </div>
          {r.gross_delta && (
            <dl className="ddz-fee-breakdown">
              <div><dt>{t('ddz.gross')}</dt><dd>{signed(r.gross_delta[me])}</dd></div>
              <div><dt>{t('ddz.feeRate', { rate: (r.fee_policy?.bps ?? 0) / 100 })}</dt><dd>−{dollars(r.fee?.[me] ?? 0)}</dd></div>
              <div><dt>{t('ddz.net')}</dt><dd>{signed(r.delta[me])}</dd></div>
            </dl>
          )}
          {steps.length > 0 && (
            <details className="ddz-result-details">
              <summary>{t('ddz.resultDetails')}</summary>
              <ul className="ddz-steps">
                {steps.map((st, i) => {
                  const { label, hero } = stepLabel(st, table, t);
                  return (
                    <li key={i} className={st.add ? 'add' : 'times'}>
                      {hero && <HeroBadge hero={hero} size="sm" />}
                      <span>{label}</span>
                      <b>{st.add ? `+${fmtX(st.add)}` : `×${fmtX(st.times ?? 1)}`}</b>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
          <ul className="ddz-result-rows">
            {order.map((s) => {
              const info = table.seats[s];
              return (
                <li key={s} className={s === me ? 'me' : ''}>
                  <span className="ddz-result-who">
                    {info && <HeroBadge hero={info.hero} size="sm" />}
                    <span className="truncate" title={info ? seatName(info) : ''}>{info ? seatName(info) : ''}</span>
                    {table.landlord === s && <Icon name="crown" className="size-3.5" />}
                  </span>
                  <span className="ddz-result-left" tabIndex={r.hands[s].length > 0 ? 0 : undefined} role={r.hands[s].length > 0 ? 'region' : undefined} aria-label={t('ddz.remainingCards')}>
                    {r.hands[s].length > 0 && <CardRow cards={byHand(r.hands[s])} size="xs" />}
                  </span>
                  <b className={r.delta[s] >= 0 ? 'up' : 'down'}>{signed(r.delta[s])}</b>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="ddz-result-actions">
          <button className="btn btn-quiet" onClick={() => send({ type: 'leave' })}>{t('ddz.leave')}</button>
          <button className="btn btn-primary" autoFocus onClick={() => send({ type: 'ready' })}>{t('ddz.again')}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Base × multiplier, the multiplier climbing one step at a time with a tick
 * that rises in pitch, the step that moved it named underneath.
 */
function ResultClimb({ table, steps, mult, won }: { table: Table; steps: Step[]; mult: number; won: boolean }) {
  const { t } = useI18n();
  const still = reducedMotion();
  const [at, setAt] = useState(still ? steps.length : 0);
  useEffect(() => {
    cue(won ? 'win' : 'lose');
    if (still || steps.length === 0) return;
    let i = 0;
    const id = setInterval(() => {
      climbTick(i, !steps[i].add);
      i++;
      setAt(i);
      if (i >= steps.length) clearInterval(id);
    }, Math.max(140, Math.min(320, 1800 / steps.length)));
    return () => clearInterval(id);
  }, []);
  let m = 1;
  for (const st of steps.slice(0, at)) m = st.add ? m + st.add : m * (st.times ?? 1);
  const value = at >= steps.length ? mult : Math.round(m * 100) / 100;
  const cur = at > 0 && at <= steps.length ? steps[at - 1] : null;
  const label = cur ? stepLabel(cur, table, t).label : '';
  return (
    <div className="ddz-climb-wrap">
      <div className="ddz-climb">
        <span className="ddz-climb-base">{dollars(table.base)}</span>
        <span className="ddz-climb-x">×</span>
        <b className="ddz-climb-mult" key={at}>{fmtX(value)}</b>
      </div>
      <span className="ddz-climb-step" key={`s${at}`} aria-hidden>
        {cur ? `${label} ${cur.add ? `+${fmtX(cur.add)}` : `×${fmtX(cur.times ?? 1)}`}` : '\u00a0'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- effects and clocks

type Banner = { key: string; kind: string; text: string; hero?: Hero };

/** How hard a play lands: drives the table's class, the overlay and the sound. */
type Impact = { key: string; kind: 'bomb' | 'rocket' | 'plane'; from: 'left' | 'right' | 'me'; times: number };

const PLANES: Kind[] = ['plane', 'plane_singles', 'plane_pairs'];

/** Tiered play feedback; the relay remains the source of truth for every trigger. */
function useTableFx(table: Table, quality: DdzQuality) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [shake, setShake] = useState<'' | 'shake' | 'shake-hard'>('');
  const seen = useRef('');
  const seenFinish = useRef('');
  const seenSkill = useRef<string | null>(null);
  const seenPass = useRef('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = useCallback((ms: number, f: () => void) => {
    timers.current.push(setTimeout(f, ms));
  }, []);

  const show = useCallback((b: Banner, ms = 1500) => {
    setBanner(b);
    later(ms, () => setBanner((cur) => (cur?.key === b.key ? null : cur)));
  }, [later]);

  useEffect(() => {
    const m: Move | null = table.last;
    const key = m?.cards ? `${m.seat}:${m.cards.join()}` : '';
    if (!key || key === seen.current) return;
    const first = seen.current === '';
    seen.current = key;
    if (first || !m?.pattern) return;
    const kind = m.pattern.kind;
    playSound(kind, m.cards!.length);
    const from = m.seat === table.me ? 'me' : m.seat === prevSeat(table.me) ? 'left' : 'right';
    const label = SHOWY[kind];
    const still = reducedMotion();
    const heavy = kind === 'bomb' || kind === 'rocket';
    if (heavy || PLANES.includes(kind)) {
      const times = table.field === 'blast' ? (kind === 'rocket' ? 4 : 3) : 2;
      const fx: Impact = { key, kind: heavy ? (kind as 'bomb' | 'rocket') : 'plane', from, times };
      setImpact(fx);
      later(kind === 'rocket' ? 1300 : 1000, () => setImpact((cur) => (cur?.key === key ? null : cur)));
    }
    // A bomb holds the frame for a beat before it lands: banner, shake and
    // sparks all start after the hitstop.
    const hold = heavy && !still ? (kind === 'rocket' ? 420 : 90) : 0;
    later(hold, () => {
      if (label) show({ key, kind, text: t(label), hero: table.seats[m.seat]?.hero });
      if (!heavy || still) return;
      setShake(kind === 'rocket' ? 'shake-hard' : 'shake');
      later(kind === 'rocket' ? 620 : 480, () => setShake(''));
      const c = canvas.current;
      if (quality === 'high' && c) {
        const { width, height } = c.getBoundingClientRect();
        burst(c, {
          x: width / 2,
          y: height * 0.42,
          colors: kind === 'rocket' ? ['#ffd36e', '#ff5d73', '#ffffff', '#ff9d3c'] : ['#ffd36e', '#ff9d3c', '#ffffff'],
          count: kind === 'rocket' ? 160 : 100,
          power: kind === 'rocket' ? 10 : 7.5,
        });
      }
    });
  }, [quality, table.last, table.me, table.seats, table.field, show, later, t]);

  // A pass is quiet but still heard.
  useEffect(() => {
    if (table.phase !== 'play') return;
    const passes = table.moves.map((m, s) => (m && !m.cards?.length && !m.bid ? `${s}:${m.trick ?? ''}` : '')).join('|');
    if (passes === seenPass.current) return;
    const before = seenPass.current;
    seenPass.current = passes;
    if (before && passes.split('|').some((p, i) => p && p !== before.split('|')[i])) cue('pass');
  }, [table.moves, table.phase]);

  // My turn: a soft ping.
  const myTurn = table.turn === table.me && (table.phase === 'play' || table.phase === 'bid');
  useEffect(() => {
    if (myTurn) cue('turn');
  }, [myTurn, table.version]);

  useEffect(() => {
    const m = table.last;
    if (table.phase !== 'showdown' || !m?.cards?.length) return;
    const key = `finish:${table.commit}:${m.seat}:${m.cards.join(',')}`;
    if (seenFinish.current === key) return;
    seenFinish.current = key;
    show({ key, kind: 'finish', text: t('ddz.finish'), hero: table.seats[m.seat]?.hero }, 1800);
  }, [table.commit, table.last, table.phase, table.seats, show, t]);

  useEffect(() => {
    const u = table.skill;
    const key = u ? `${table.commit}:${u.n ?? table.moves.map((m) => m?.cards?.join() ?? '').join('|')}:${u.seat}:${u.skill}` : null;
    if (!u || key === seenSkill.current) return;
    seenSkill.current = key;
    cue('skill');
    show({ key: `skill-${key}`, kind: 'skill', text: t(`ddz.skill.${u.skill}` as MessageKey), hero: u.hero }, 1700);
  }, [table.skill, table.moves, show, t]);

  return { canvas, banner, shake, impact };
}

/**
 * The overlay a big play draws over the felt: a bomb's shockwave and a ×2
 * flying up to the multiplier, a rocket's dim, flash and trail, a plane's
 * contrail across the table. Pure CSS; the table removes it when it is done.
 */
function ImpactLayer({ fx, quality }: { fx: Impact; quality: DdzQuality }) {
  if (reducedMotion()) return null;
  return (
    <div key={fx.key} className={`ddz-impact ddz-impact-${fx.kind} from-${fx.from} q-${quality}`} aria-hidden>
      {fx.kind === 'plane' ? (
        <span className="ddz-contrail" />
      ) : (
        <>
          {fx.kind === 'rocket' && <span className="ddz-flash" />}
          {fx.kind === 'rocket' && <span className="ddz-trail" />}
          <span className="ddz-wave" />
          {quality === 'high' && <span className="ddz-wave ddz-wave-2" />}
          <b className="ddz-x2">×{fx.times}</b>
        </>
      )}
    </div>
  );
}

let clockNow = Date.now();
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();
const noopSubscribe = () => () => {};
const readClock = () => clockNow;

/** Keep one low-frequency clock for the active seat instead of one timer per avatar. */
function subscribeClock(listener: () => void) {
  clockNow = Date.now();
  clockListeners.add(listener);
  if (clockListeners.size === 1) {
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const notify of clockListeners) notify();
    }, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** Whole seconds until deadline, or null without an active turn. */
function useCountdown(deadline: number | null, active: boolean) {
  const now = useSyncExternalStore(active ? subscribeClock : noopSubscribe, readClock, readClock);
  return active && deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}
