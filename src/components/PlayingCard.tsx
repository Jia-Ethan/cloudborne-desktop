import type { CSSProperties, PointerEventHandler } from 'react';
import { BIG_JOKER, SUITS, isRed, rankLabel, suitOf, type Card } from '../ddz';

export type CardSize = 'lg' | 'md' | 'sm' | 'xs';

/**
 * One playing card drawn in CSS: the corner index (rank over suit) is what
 * shows when cards overlap in a hand; the big pip fills the face when it
 * does not. Jokers read JOKER down the side with a star in the middle.
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
  const cls = [
    'pc',
    `pc-${size}`,
    isRed(card) ? 'red' : 'black',
    joker ? (card === BIG_JOKER ? 'joker big' : 'joker') : '',
    selected ? 'selected' : '',
    fresh ? 'fresh' : '',
    dim ? 'dim' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={style} onPointerDown={onPointerDown} onPointerEnter={onPointerEnter} data-card={card}>
      {joker ? (
        <>
          <span className="pc-joker">JOKER</span>
          <span className="pc-star" aria-hidden>
            ★
          </span>
        </>
      ) : (
        <>
          <span className="pc-idx">
            <b>{rankLabel(card)}</b>
            <i>{SUITS[suitOf(card)]}</i>
          </span>
          <span className="pc-pip" aria-hidden>
            {SUITS[suitOf(card)]}
          </span>
        </>
      )}
    </div>
  );
}

/** The back of a card, in the app's dawn colours. */
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
