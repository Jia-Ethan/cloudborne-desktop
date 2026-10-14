import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  HEROES,
  SKILL_AIM,
  STAKES,
  byHand,
  byPlay,
  hints,
  judge,
  minBalance,
  nextSeat,
  prevSeat,
  rankLabel,
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
import { dollars } from '../lottery';
import { Dialog } from './Dialog';
import { burst } from './fx';
import { Icon } from './Icon';
import { Logo, type LogoId } from './Logo';
import { CardBack, CardRow, PlayingCard } from './PlayingCard';

/** Bump when the rules text changes so everyone reads it again. */
const RULES_VERSION = '2';
const RULES_KEY = 'cloudborne.ddz.rules';

/** Turn clocks; the relay enforces them, these only draw the ring. */
const BID_MS = 15000;
const PLAY_MS = 20000;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

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
const NAME: Record<Hero, string> = {
  gpt: 'GPT',
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  glm: 'GLM',
  minimax: 'MiniMax',
  qwen: 'Qwen',
};
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
  bomb: 'ddz.kind.bomb',
  rocket: 'ddz.kind.rocket',
  plane: 'ddz.kind.plane',
  plane_singles: 'ddz.kind.plane',
  plane_pairs: 'ddz.kind.plane',
  straight: 'ddz.kind.straight',
  pair_straight: 'ddz.kind.pair_straight',
};

const signed = (n: number) => (n > 0 ? `+${dollars(n)}` : n < 0 ? `−${dollars(-n)}` : dollars(0));
const fmtX = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(n * 10 === Math.round(n * 10) ? 1 : 2));

/**
 * 小丑斗地主: a lobby (quick match or a room by number) and the table. The relay
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
  else if (table.phase === 'waiting' && !table.code) body = <Matching send={send} />;
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
  const affordable = (b: number) => balance >= minBalance(b);
  const [base, setBase] = useState(STAKES[0]);
  const [code, setCode] = useState('');
  const canPlay = affordable(base);

  return (
    <div className="main-scroll">
      <div className="main-column ddz-lobby ddz-salon rise" style={{ '--i': 0 } as CSSProperties}>
        <Ornaments />
        <section className="ddz-hero">
          <div className="ddz-hero-text">
            <h1>{t('ddz.title')}</h1>
            <p>{t('ddz.tagline')}</p>
            <button className="ddz-hero-rules" onClick={onRules}>
              {t('ddz.rulesRead')}
              <Icon name="chevronRight" className="size-3.5" />
            </button>
          </div>
          <div className="ddz-hero-heroes" aria-hidden>
            {HEROES.map((h, i) => (
              <HeroBadge key={h} hero={h} style={{ '--i': i } as CSSProperties} />
            ))}
          </div>
        </section>

        <div className="ddz-rule-line" aria-hidden>
          <i />
        </div>

        <section className="ddz-stake-row" role="radiogroup" aria-label={t('ddz.base')}>
          {STAKES.map((b) => (
            <button
              key={b}
              role="radio"
              aria-checked={base === b}
              className={`ddz-stake ${base === b ? 'on' : ''}`}
              disabled={!affordable(b)}
              title={affordable(b) ? undefined : t('ddz.needBalance', { amount: dollars(minBalance(b)) })}
              onClick={() => setBase(b)}
            >
              <small>{t('ddz.base')}</small>
              <b>{dollars(b)}</b>
            </button>
          ))}
        </section>

        <div className="ddz-entries">
          <button className="ddz-go" disabled={!canPlay} onClick={() => onEnter({ type: 'match', base })}>
            <Icon name="bolt" className="size-5" />
            {t('ddz.quick')}
          </button>
          <button className="ddz-go quiet" disabled={!canPlay} onClick={() => onEnter({ type: 'create', base })}>
            <Icon name="plus" className="size-5" />
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
            <button className="btn ddz-glass-btn" disabled={code.length !== 6}>
              {t('ddz.join')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function RulesDialog({ agree, onClose, onAgree }: { agree: boolean; onClose: () => void; onAgree: () => void }) {
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
            <button className="btn ddz-glass-btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-gold" autoFocus onClick={onAgree}>
              {t('ddz.rulesAgree')}
            </button>
          </>
        ) : (
          <button className="btn btn-gold" autoFocus onClick={onClose}>
            {t('common.close')}
          </button>
        )
      }
    >
      <ol className="ddz-rules">
        <li className="warn">{t('ddz.rules.money')}</li>
        <li>{t('ddz.rules.score')}</li>
        <li>{t('ddz.rules.auto')}</li>
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
              <HeroBadge hero={h} size="sm" />
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
      <Ornaments />
      <div className="ddz-shuffle" aria-hidden>
        {[0, 1, 2].map((i) => (
          <CardBack key={i} size="md" style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <h2>{t('ddz.matching')}</h2>
      <button className="btn ddz-glass-btn" onClick={() => send({ type: 'cancel' })}>
        {t('common.cancel')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

/** The table's dress: a double gold rule, fans in the corners, a sunburst behind the play. */
function Ornaments() {
  return (
    <div className="ddz-orn" aria-hidden>
      <span className="ddz-orn-sun" />
      <i className="tl" />
      <i className="tr" />
      <i className="bl" />
      <i className="br" />
    </div>
  );
}

function HeroBadge({ hero, size = 'md', style }: { hero: Hero; size?: 'sm' | 'md' | 'lg'; style?: CSSProperties }) {
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

function TableScene({ table, send }: { table: Table; send: (a: Action) => void }) {
  const { t } = useI18n();
  const me = table.me;
  const myTurn = table.turn === me && (table.phase === 'bid' || table.phase === 'play');
  const mine = table.seats[me];
  const [leaving, setLeaving] = useState(false);
  const fx = useTableFx(table);

  const leave = () => {
    if (table.phase === 'bid' || table.phase === 'joker' || table.phase === 'play') setLeaving(true);
    else send({ type: 'leave' });
  };

  return (
    <div className={`ddz-felt ddz-table phase-${table.phase} ${fx.shake ? 'shake' : ''}`}>
      <Ornaments />
      <canvas ref={fx.canvas} className="ddz-sparks" aria-hidden />
      <TopBar table={table} onLeave={leave} send={send} />

      <Opponent table={table} seat={prevSeat(me)} side="left" />
      <Opponent table={table} seat={nextSeat(me)} side="right" />

      <div className="ddz-center">
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
        {fx.banner && (
          <div key={fx.banner.key} className={`ddz-banner k-${fx.banner.kind}`}>
            {fx.banner.hero && <HeroBadge hero={fx.banner.hero} size="lg" />}
            <span>{fx.banner.text}</span>
          </div>
        )}
        {table.tracker && <Tracker counts={table.tracker} />}
      </div>

      {table.phase !== 'waiting' && <MyHand key={table.commit} table={table} myTurn={myTurn} send={send} />}
      {mine?.auto && table.phase === 'play' && (
        <div className="ddz-auto">
          {t('ddz.autoOn')}
          <button className="btn btn-gold" onClick={() => send({ type: 'auto', on: false })}>
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
  const playing = table.phase === 'bid' || table.phase === 'joker' || table.phase === 'play';
  const auto = table.seats[table.me]?.auto ?? false;
  return (
    <header className="ddz-top">
      <button className="ddz-chip ddz-chip-btn" onClick={onLeave} aria-label={t('ddz.leave')}>
        <Icon name="chevronLeft" className="size-4" />
      </button>
      <span className="ddz-chip">
        {t('ddz.base')} <b>{dollars(table.base)}</b>
      </span>
      {table.field && <FieldCard field={table.field} />}

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

function FieldCard({ field }: { field: Field }) {
  const { t } = useI18n();
  return (
    <span className={`ddz-field f-${field}`} title={t(`ddz.field.${field}.desc` as MessageKey)}>
      <b>{t(`ddz.field.${field}` as MessageKey)}</b>
      <span>{t(`ddz.field.${field}.desc` as MessageKey)}</span>
    </span>
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
      <div className="ddz-room-actions">
        {owner && empty > 0 && (
          <button className="btn ddz-glass-btn" onClick={() => send({ type: 'bots' })}>
            <Icon name="sparkle" className="size-4" />
            {t('ddz.fillBots')}
          </button>
        )}
        <button className={`btn ${me?.ready ? 'ddz-glass-btn' : 'btn-gold'}`} onClick={() => send({ type: 'ready' })}>
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

function Avatar({ info, seat, table, size = 'md' }: { info: SeatInfo | null; seat: Seat; table: Table; size?: 'md' | 'lg' }) {
  const { t } = useI18n();
  const turn = table.turn === seat && (table.phase === 'bid' || table.phase === 'play');
  const lord = table.landlord === seat;
  const left = useCountdown(turn ? table.deadline : null);
  return (
    <div className={`ddz-avatar ${size} ${turn ? 'turn' : ''} ${lord ? 'lord' : ''} ${info ? '' : 'empty'}`}>
      {info ? <HeroBadge hero={info.hero} size={size === 'lg' ? 'lg' : 'md'} /> : <span className="ddz-avatar-empty">?</span>}
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
      <polygon
        points="13.8,1.5 30.2,1.5 42.5,13.8 42.5,30.2 30.2,42.5 13.8,42.5 1.5,30.2 1.5,13.8"
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
      <b className="truncate">{info.name}</b>
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
  const dealt = table.phase === 'bid' || table.phase === 'joker' || table.phase === 'play';
  return (
    <aside className={`ddz-opp ${side}`}>
      <Avatar info={info} seat={seat} table={table} size="lg" />
      {info ? <SeatMeta info={info} table={table} seat={seat} /> : <span className="ddz-dim">{t('ddz.emptySeat')}</span>}
      {dealt && !info?.shown && (
        <div className={`ddz-stack ${left > 0 && left <= 2 ? 'alarm' : ''}`}>
          <CardBack size="sm" />
          <b>{left}</b>
        </div>
      )}
      {info?.shown && <CardRow cards={byHand(info.shown)} size="xs" className="ddz-shown" />}
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
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
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
    if (verdict.verdict === 'ok' && verdict.pattern) return { text: t(`ddz.kind.${verdict.pattern.kind}` as MessageKey), tone: 'ok' };
    return null;
  })();

  return (
    <div className={`ddz-me ${myTurn ? 'turn' : ''}`}>
      <div className="ddz-bar">
        <div className="ddz-me-who">
          <Avatar info={mine} seat={table.me} table={table} />
          {mine && <SeatMeta info={mine} table={table} seat={table.me} />}
          {mine && table.phase === 'play' && (
            <SkillButton
              table={table}
              hero={mine.hero}
              ready={playing && mine.skills > 0}
              onUse={(h) => (SKILL_AIM[h] === 'none' ? useSkill({}) : setAiming(h))}
            />
          )}
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
              </button>
              <button className="btn ddz-glass-btn" onClick={hint}>
                {t('ddz.hint')}
              </button>
              <button className="btn btn-gold" disabled={verdict.verdict !== 'ok'} onClick={play}>
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
                {table.seats[s]?.name}
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
        <button className="btn btn-gold" disabled={picked.length === 0 || picked.length > maxCards} onClick={() => onUse({ cards: picked, copy })}>
          {t('ddz.aim.drop', { n: picked.length })}
        </button>
      )}
      {aim === 'cards-played' && <GeminiAim table={table} give={picked} max={maxCards} onUse={(cards) => onUse({ cards, give: picked, copy })} />}
    </div>
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
      <button className="btn btn-gold" disabled={take.length === 0 || take.length !== give.length} onClick={() => onUse(take)}>
        {t('ddz.aim.swap', { n: take.length })}
      </button>
    </>
  );
}

function waitingLine(table: Table, t: T): string {
  const who = table.turn !== null ? (table.seats[table.turn]?.name ?? '') : '';
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
  const won = r.delta[me] > 0;
  const lordWon = r.winner === table.landlord;
  // My share: a farmer has one, the landlord sees the larger of its two.
  const share = me === table.landlord ? [...r.shares].sort((a, b) => b.mult - a.mult)[0] : r.shares.find((s) => s.farmer === me)!;
  const steps = share.steps;
  const [shown, setShown] = useState(reducedMotion() ? steps.length : 0);
  useEffect(() => {
    if (shown >= steps.length) return;
    const id = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 450 : 380);
    return () => clearTimeout(id);
  }, [shown, steps.length]);
  let running = 1;
  for (const st of steps.slice(0, shown)) running = st.add ? running + st.add : running * (st.times ?? 1);
  const done = shown >= steps.length;
  const order: Seat[] = [me, nextSeat(me), prevSeat(me)];

  return (
    <div className="ddz-result-wrap">
      <div className={`ddz-result ${won ? 'won' : 'lost'} ${done ? 'done' : ''}`} role="dialog" aria-label={t(won ? 'ddz.won' : 'ddz.lost')}>
        <div className="ddz-result-head">
          <span className="ddz-result-badge">{t(lordWon ? 'ddz.lordWins' : 'ddz.farmersWin')}</span>
          <div className="ddz-climb">
            <span className="ddz-climb-base">{dollars(table.base)}</span>
            <span className="ddz-climb-x">×</span>
            <b key={running} className="ddz-climb-mult">
              {fmtX(running)}
            </b>
          </div>
          <ul className="ddz-steps">
            {steps.slice(0, shown).map((st, i) => {
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
          <b className="ddz-result-amount">{done ? signed(r.delta[me]) : ' '}</b>
        </div>

        {done && (
          <>
            <ul className="ddz-result-rows">
              {order.map((s) => {
                const info = table.seats[s];
                return (
                  <li key={s} className={s === me ? 'me' : ''}>
                    <span className="ddz-result-who">
                      {info && <HeroBadge hero={info.hero} size="sm" />}
                      {info?.name}
                      {table.landlord === s && <Icon name="crown" className="size-3.5" />}
                    </span>
                    <span className="ddz-result-left">{r.hands[s].length > 0 && <CardRow cards={byHand(r.hands[s])} size="xs" />}</span>
                    <b className={r.delta[s] >= 0 ? 'up' : 'down'}>{signed(r.delta[s])}</b>
                  </li>
                );
              })}
            </ul>
            <div className="ddz-result-actions">
              <button className="btn ddz-glass-btn" onClick={() => send({ type: 'leave' })}>
                {t('ddz.leave')}
              </button>
              <button className="btn btn-gold" autoFocus onClick={() => send({ type: 'ready' })}>
                {t('ddz.again')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- effects and clocks

type Banner = { key: string; kind: string; text: string; hero?: Hero };

/** A banner for big plays and skills; sparks and a shake for bombs. */
function useTableFx(table: Table) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [shake, setShake] = useState(false);
  const seen = useRef('');
  const seenSkill = useRef<string | null>(null);

  const show = useCallback((b: Banner, ms = 1500) => {
    setBanner(b);
    setTimeout(() => setBanner((cur) => (cur?.key === b.key ? null : cur)), ms);
  }, []);

  useEffect(() => {
    const m: Move | null = table.last;
    const key = m?.cards ? `${m.seat}:${m.cards.join()}` : '';
    if (!key || key === seen.current) return;
    const first = seen.current === '';
    seen.current = key;
    if (first || !m?.pattern) return;
    const label = SHOWY[m.pattern.kind];
    if (!label) return;
    show({ key, kind: m.pattern.kind, text: t(label) });
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
  }, [table.last, show, t]);

  useEffect(() => {
    const u = table.skill;
    const key = u ? `${u.seat}:${u.skill}:${table.moves.map((m) => m?.cards?.join() ?? '').join('|')}` : null;
    if (!u || key === seenSkill.current) return;
    seenSkill.current = key;
    show({ key: `skill-${key}`, kind: 'skill', text: t(`ddz.skill.${u.skill}` as MessageKey), hero: u.hero }, 1700);
  }, [table.skill, table.moves, show, t]);

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
