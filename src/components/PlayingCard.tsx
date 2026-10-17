import type { CSSProperties, PointerEventHandler } from 'react';
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
    faceRank ? `face face-${rankLabel(card).toLowerCase()}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={style} onPointerDown={onPointerDown} onPointerEnter={onPointerEnter} data-card={card}>
      <span className="pc-frame" aria-hidden />
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
          {faceRank && (
            <svg className="pc-portrait" viewBox="0 0 56 64" aria-hidden="true">
              <path className="portrait-hair" d="M11 26c-2-12 5-21 17-21s19 9 17 21l-4 9H15z" />
              <path className="portrait-face" d="M17 22c0-9 4-14 11-14s11 5 11 14v8c0 9-6 15-11 15s-11-6-11-15z" />
              <path className="portrait-ear" d="M16 25c-5-3-7 1-4 7l6 3m22-10c5-3 7 1 4 7l-6 3" />
              <path className="portrait-feature" d="M22 27h1m10 0h1m-7 7 1 2 1-2m-6 6c3 2 7 2 10 0" />
              <path className="portrait-neck" d="M23 42v7h10v-7" />
              <path className="portrait-cloak" d="M7 64c1-12 8-17 16-19l5 7 5-7c8 2 15 7 16 19z" />
              <path className="portrait-collar" d="m19 46 9 12 9-12-4-2-5 7-5-7z" />
              <path className="portrait-ornament" d="M12 17 7 9l8 3m29 5 5-8-8 3M21 8l2-5 5 4 5-4 3 5" />
              <path className="portrait-beard" d="M18 36c2 8 5 12 10 13 5-1 8-5 10-13-3 3-6 4-10 4s-7-1-10-4" />
            </svg>
          )}
          <span className="pc-pip" aria-hidden>
            {SUITS[suitOf(card)]}
          </span>
        </>
      )}
    </div>
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
