import { useId, type CSSProperties, type PointerEventHandler } from 'react';
import { BIG_JOKER, SUITS, isRed, rankLabel, rankOf, suitOf, type Card } from '../ddz';

export type CardSize = 'lg' | 'md' | 'sm' | 'xs';

/**
 * One playing card drawn in CSS: the corner index (rank over suit) is what
 * shows when cards overlap in a hand; the big pip fills the face when it
 * does not. Jokers read JOKER down the side with a crown in the corner.
 */
export function PlayingCard({
  card,
  size = 'md',
  selected,
  fresh,
  dim,
  wildAs,
  className = '',
  style,
  onPointerDown,
  onPointerEnter,
}: {
  card: Card;
  size?: CardSize;
  selected?: boolean;
  fresh?: boolean;
  dim?: boolean;
  /** 混合专家: the rank this card was played as. */
  wildAs?: string;
  className?: string;
  style?: CSSProperties;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
}) {
  const joker = suitOf(card) < 0;
  const faceRank = !joker && rankOf(card) >= 8 && rankOf(card) <= 10;
  const cls = [
    'pc',
    `pc-${size}`,
    isRed(card) ? 'red' : 'black',
    joker ? (card === BIG_JOKER ? 'joker big' : 'joker') : '',
    selected ? 'selected' : '',
    fresh ? 'fresh' : '',
    dim ? 'dim' : '',
    wildAs ? 'ddz-wild' : '',
    faceRank ? `face face-${rankLabel(card).toLowerCase()}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={style} onPointerDown={onPointerDown} onPointerEnter={onPointerEnter} data-card={card}>
      <span className="pc-frame" aria-hidden />
      {wildAs && <span className="ddz-wild-as">{wildAs}</span>}
      {joker ? (
        <>
          <span className="pc-joker">JOKER</span>
          <span className="pc-star" aria-hidden>
            ♛
          </span>
        </>
      ) : (
        <>
          <span className="pc-idx">
            <b>{rankLabel(card)}</b>
            <i>{SUITS[suitOf(card)]}</i>
          </span>
          {faceRank && <CourtFace card={card} />}
          {!faceRank && (
            <span className="pc-pip" aria-hidden>
              {SUITS[suitOf(card)]}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * J, Q and K in the card back's dawn: a tall panel washed sky to apricot, a
 * figure built from a head and a white shoulder arc, and one mark per rank —
 * a cap and feather for J, a halo for Q, a crown for K.
 */
function CourtFace({ card }: { card: Card }) {
  const id = useId().replace(/:/g, '');
  const r = rankLabel(card);
  const ink = isRed(card) ? '#c63a4e' : '#2a2d36';
  const gear =
    r === 'K' ? (
      <path className="pc-court-gear" d="M36 41 38 29 42 36 48 26 54 36 58 29 60 41Z" />
    ) : r === 'Q' ? (
      <>
        <circle className="pc-court-halo" cx="48" cy="52" r="13" />
        <circle className="pc-court-gear" cx="48" cy="38.5" r="2.4" />
      </>
    ) : (
      <>
        <path className="pc-court-gear" d="M36 46 59 37 61 42.5 38 51.5Z" />
        <path className="pc-court-plume" d="M57 38Q63 28 67 29" />
      </>
    );
  return (
    <svg className="pc-portrait" viewBox="0 0 74 104" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#dbe2ff" />
          <stop offset=".6" stopColor="#ffd0df" />
          <stop offset="1" stopColor="#ffd8c2" />
        </linearGradient>
        <clipPath id={`${id}c`}>
          <rect x="29" y="8" width="38" height="88" rx="6" />
        </clipPath>
      </defs>
      <rect x="29" y="8" width="38" height="88" rx="6" fill={`url(#${id}g)`} />
      <g clipPath={`url(#${id}c)`}>
        <path className="pc-court-arc" d="M27 98V78Q48 58 69 78V98Z" />
        <circle cx="48" cy="52" r="8.5" fill={ink} />
        {gear}
        <text className="pc-court-rank" x="48" y="91" textAnchor="middle" fill={ink}>
          {r}
        </text>
      </g>
      <text className="pc-court-suit" x="61" y="17" textAnchor="middle" fill={ink}>
        {SUITS[suitOf(card)]}
      </text>
    </svg>
  );
}

/** The back of a card: a gold lattice with a lozenge in the middle. */
export function CardBack({ size = 'sm', className = '', style }: { size?: CardSize; className?: string; style?: CSSProperties }) {
  return (
    <div className={`pc pc-${size} pc-back ${className}`} style={style} aria-hidden>
      <span />
    </div>
  );
}

/** A row of cards as played on the table, overlapping a little. */
export function CardRow({ cards, size = 'sm', className = '' }: { cards: Card[]; size?: CardSize; className?: string }) {
  return (
    <div className={`pc-row pc-row-${size} ${className}`}>
      {cards.map((c, i) => (
        <PlayingCard key={c} card={c} size={size} style={{ '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}
