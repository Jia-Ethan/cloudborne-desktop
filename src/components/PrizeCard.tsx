import { memo, useEffect, useId, useState } from 'react';
import type { Draw, Rarity } from '../api';
import { useI18n } from '../i18n';
import { dollars, headline, zheVars } from '../lottery';
import { matchVendorLogo } from '../lottery/packThemes';
import { Logo } from './Logo';
import { Mark } from './Mark';
import { GuaranteeTag, RarityTag } from './Prize';

const reducedMotion = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/**
 * 5:7 collectible prize card rendered with physical edge thickness (`.pk-slab`),
 * GPU-composited optical foil/glitter/glare/glaze layers (transform & opacity only,
 * zero per-frame CSS variable repaints or SVG feTurbulence filters), a 3D floating
 * `.pk-pop` emblem, self-collapsing slot-machine rolling digits, and an on-demand
 * 3D mystery foil back mounted only for unflipped Epic/Legendary batch hits.
 */
export const PrizeCard = memo(function PrizeCard({
  draw,
  index,
  isMystery,
  faceDown,
  revealed,
  out,
  inspected,
  slabCount = 1,
  onSelect,
}: {
  draw: Draw;
  /** 0-based card index in the current reveal batch. */
  index: number;
  /** True if this card started face-down as an Option B mystery hit. */
  isMystery: boolean;
  /** True while an Epic/Legendary card is waiting face-down to be flipped. */
  faceDown: boolean;
  /** True once face-up and settled (starts slot roll & floats the 3D emblem). */
  revealed: boolean;
  /** True once landed in the fan/gallery. */
  out: boolean;
  /** True when enlarged for close-up inspection in a large batch. */
  inspected?: boolean;
  /** Number of 3D thickness slabs (1 for multi-card batches, 2 for single close-up). */
  slabCount?: 1 | 2;
  onSelect?: (idx: number) => void;
}) {
  const { t } = useI18n();
  // Mount the reverse mystery face ONLY while face-down and during its 640ms 3D flip transition.
  const [mountBack, setMountBack] = useState(() => isMystery && faceDown);

  useEffect(() => {
    if (!isMystery) {
      setMountBack(false);
      return;
    }
    if (faceDown) {
      setMountBack(true);
      return;
    }
    const id = setTimeout(() => setMountBack(false), 700);
    return () => clearTimeout(id);
  }, [isMystery, faceDown]);

  const h = headline(draw);
  const isNone = draw.kind === 'none';
  const isLegendary = draw.rarity === 'legendary';
  const sourceLabel = draw.source ? t(`lottery.source.${draw.source}`) : '';
  const vendor = h.kind === 'pack' ? matchVendorLogo(h.group) : null;

  return (
    <div
      className={`pk-card-shell r-${draw.rarity} k-${draw.kind} ${isNone ? 'k-none' : ''} ${out ? 'out' : ''} ${
        faceDown ? 'is-back' : 'is-front'
      } ${revealed ? 'is-revealed' : ''} ${inspected ? 'is-inspected' : ''}`}
      onClick={onSelect ? () => onSelect(index) : undefined}
    >
      {/* Physical cardstock backing slab(s) for 3D edge thickness & cast shadow. */}
      {slabCount === 2 && <i className="pk-slab pk-slab-mid" aria-hidden />}
      <i className="pk-slab pk-slab-base" aria-hidden />

      <div className="pk-flip">
        {/* ---- Front face: collectible artwork + GPU-composited optical stack ---- */}
        <div className="pk-face">
          <div className="pk-head">
            <span className="pk-head-tags">
              {!isNone ? <RarityTag rarity={draw.rarity} /> : <span className="pk-none-pill">{t('lottery.thanks')}</span>}
              <GuaranteeTag draw={draw} />
            </span>
          </div>

          <div className="pk-win">
            <div className="pk-win-pattern" aria-hidden />
            <i className="pk-drop" aria-hidden />
            <div className="pk-value-overlay">
              <CardHeadline draw={draw} revealed={revealed} />
            </div>
          </div>

          <div className="pk-meta">
            <div className="pk-title-row">
              <b className="pk-name" title={draw.name}>
                {isNone ? draw.name || t('lottery.thanks') : draw.name}
              </b>
              {sourceLabel && <span className="pk-type">{sourceLabel}</span>}
            </div>
            <i className="pk-rule" aria-hidden />
            <div className="pk-foot">
              <span className="pk-sub">{cardSubtitle(draw, t)}</span>
              <span className="pk-rar-mark">
                {rarityMark(draw.rarity, isNone)} {isNone ? '' : t(`rarity.${draw.rarity}`)}
              </span>
            </div>
          </div>

          {/* Transform/opacity-only optical finish (zero CSS custom property repaints) */}
          {!isNone && (
            <>
              <i className="pk-holo" aria-hidden />
              {isLegendary && <i className="pk-holo-rays" aria-hidden />}
              <i className="pk-glitter" aria-hidden />
            </>
          )}
          <i className="pk-glare" aria-hidden />
          <i className="pk-glaze" aria-hidden>
            <i className="pk-glaze-band" />
          </i>
        </div>

        {/* ---- Reverse face: mounted ONLY for unflipped mystery Epic/Legendary hits ---- */}
        {mountBack && (
          <div className={`pk-back r-${draw.rarity} ${!faceDown ? 'is-flipping-out' : ''}`}>
            <div className="pk-back-frame">
              <div className="pk-back-rays" aria-hidden />
              <div className="pk-back-ring" aria-hidden />
              <div className="pk-back-crest">
                <Mark className="pk-back-mark" />
              </div>
              <span className="pk-back-rarity">{t(`rarity.${draw.rarity}`)}</span>
              <span className="pk-back-cta">{t('lottery.tapToFlip')}</span>
            </div>
            <i className="pk-holo" aria-hidden />
            {isLegendary && <i className="pk-holo-rays" aria-hidden />}
            <i className="pk-glitter" aria-hidden />
            <i className="pk-glare" aria-hidden />
            <i className="pk-glaze" aria-hidden>
              <i className="pk-glaze-band" />
            </i>
          </div>
        )}
      </div>

      {/* 3D floating emblem outside overflow:hidden so it stands off the card face in Z-space. */}
      {!faceDown && (
        <div className="pk-pop" aria-hidden>
          <PrizeEmblem draw={draw} vendor={vendor} />
        </div>
      )}
    </div>
  );
});

function rarityMark(r: Rarity, isNone: boolean): string {
  if (isNone) return '○';
  switch (r) {
    case 'common':
      return '●';
    case 'rare':
      return '◆';
    case 'epic':
      return '◆◆';
    case 'legendary':
      return '★';
  }
}

function cardSubtitle(draw: Draw, t: ReturnType<typeof useI18n>['t']): string {
  const h = headline(draw);
  switch (h.kind) {
    case 'money':
      return t('lottery.cardCredited');
    case 'credit':
      return t('lottery.validFor', { n: h.hours });
    case 'discount':
      return t('lottery.validFor', { n: h.hours });
    case 'pack':
      return h.group ? `${h.group} · ${t('lottery.hours', { n: h.hours })}` : t('lottery.validFor', { n: h.hours });
    case 'again':
      return t('lottery.againSub');
    case 'concurrency':
      return t('lottery.concurrencySub');
    case 'pity':
      return t('lottery.pitySub');
    case 'none':
      return t('lottery.thanksSub');
  }
}

/** Sculptural 3D floating emblem per prize kind (with vendor logos for token packs). */
function PrizeEmblem({ draw, vendor }: { draw: Draw; vendor: ReturnType<typeof matchVendorLogo> }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const h = headline(draw);

  if (h.kind === 'none') {
    return (
      <div className="pk-emblem pk-emblem-none">
        <Mark className="pk-emblem-mark" />
      </div>
    );
  }

  if (h.kind === 'pack') {
    return (
      <div className="pk-emblem pk-emblem-pack">
        <span className="pk-emblem-halo" />
        <span className="pk-emblem-disc">
          {vendor ? <Logo id={vendor} className="pk-emblem-vendor" /> : <Mark className="pk-emblem-mark" />}
        </span>
      </div>
    );
  }

  if (h.kind === 'discount') {
    const gid = `${uid}-disc`;
    return (
      <div className="pk-emblem pk-emblem-discount">
        <span className="pk-emblem-halo" />
        <svg viewBox="0 0 64 64" className="pk-emblem-svg pk-emblem-svg-shaped">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.96" />
              <stop offset="55%" stopColor="#f5d0fe" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <path
            d="M10 18a4 4 0 0 1 4-4h36a4 4 0 0 1 4 4v9a5 5 0 0 0 0 10v9a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4v-9a5 5 0 0 0 0-10z"
            fill={`url(#${gid})`}
            stroke="rgba(255,255,255,0.7)"
            strokeWidth="1.5"
          />
          <line x1="25" y1="16" x2="25" y2="48" stroke="rgba(88,28,135,0.28)" strokeWidth="1.8" strokeDasharray="3 3" />
          <circle cx="38" cy="26" r="3" fill="none" stroke="#581c87" strokeWidth="2.2" />
          <circle cx="45" cy="38" r="3" fill="none" stroke="#581c87" strokeWidth="2.2" />
          <line x1="46" y1="24" x2="37" y2="40" stroke="#581c87" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  if (h.kind === 'credit') {
    const gid = `${uid}-bolt`;
    return (
      <div className="pk-emblem pk-emblem-credit">
        <span className="pk-emblem-halo" />
        <span className="pk-emblem-round">
          <svg viewBox="0 0 64 64" className="pk-emblem-svg">
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="50%" stopColor="#bae6fd" />
                <stop offset="100%" stopColor="#60a5fa" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="24" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" />
            <path d="M35 12 19 34h12l-3 18 17-23H33z" fill={`url(#${gid})`} />
          </svg>
        </span>
      </div>
    );
  }

  if (h.kind === 'again') {
    const gid = `${uid}-pack`;
    return (
      <div className="pk-emblem pk-emblem-again">
        <span className="pk-emblem-halo" />
        <svg viewBox="0 0 64 64" className="pk-emblem-svg pk-emblem-svg-shaped">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#93c5fd" />
              <stop offset="50%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
          </defs>
          <rect x="16" y="10" width="32" height="44" rx="5" fill={`url(#${gid})`} stroke="#fff" strokeWidth="1.8" />
          <line x1="16" y1="18" x2="48" y2="18" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" />
          <line x1="16" y1="46" x2="48" y2="46" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
          <path d="M32 23c.7 3.8 2.1 5.2 5.9 5.9-3.8.7-5.2 2.1-5.9 5.9-.7-3.8-2.1-5.2-5.9-5.9 3.8-.7 5.2-2.1 5.9-5.9z" fill="#fff" />
        </svg>
      </div>
    );
  }

  if (h.kind === 'concurrency') {
    const gid = `${uid}-lanes`;
    return (
      <div className="pk-emblem pk-emblem-credit">
        <span className="pk-emblem-halo" />
        <span className="pk-emblem-round">
          <svg viewBox="0 0 64 64" className="pk-emblem-svg">
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="50%" stopColor="#f3d5ff" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="24" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" />
            <path d="M17 22h22l-4-4M17 32h26l-4-4M17 42h22l-4-4" fill="none" stroke={`url(#${gid})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M46 38v10M41 43h10" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
          </svg>
        </span>
      </div>
    );
  }

  if (h.kind === 'pity') {
    const gid = `${uid}-ff`;
    return (
      <div className="pk-emblem pk-emblem-credit">
        <span className="pk-emblem-halo" />
        <span className="pk-emblem-round">
          <svg viewBox="0 0 64 64" className="pk-emblem-svg">
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="50%" stopColor="#bae6fd" />
                <stop offset="100%" stopColor="#60a5fa" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="24" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" />
            <path d="M15 20l15 12-15 12zM31 20l15 12-15 12z" fill={`url(#${gid})`} stroke="rgba(255,255,255,0.8)" strokeWidth="1.2" strokeLinejoin="round" />
            <rect x="47" y="20" width="4" height="24" rx="2" fill="#fff" />
          </svg>
        </span>
      </div>
    );
  }

  // Default: balance / cashback / balance_percent sculpted coin medallion
  const isGold = draw.rarity === 'legendary';
  const isEpic = draw.rarity === 'epic';
  const gid = `${uid}-coin`;
  return (
    <div className="pk-emblem pk-emblem-coin">
      <span className="pk-emblem-halo" />
      <span className="pk-emblem-round">
        <svg viewBox="0 0 64 64" className="pk-emblem-svg">
          <defs>
            <radialGradient id={gid} cx="34%" cy="28%" r="72%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="35%" stopColor={isGold ? '#ffe896' : isEpic ? '#f3d5ff' : '#dbeafe'} />
              <stop offset="100%" stopColor={isGold ? '#c98a18' : isEpic ? '#9333ea' : '#3b82f6'} />
            </radialGradient>
          </defs>
          <circle cx="32" cy="32" r="23" fill={`url(#${gid})`} stroke="rgba(255,255,255,0.85)" strokeWidth="1.8" />
          <circle cx="32" cy="32" r="17.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
          <text
            x="32"
            y="39"
            textAnchor="middle"
            fill={isGold ? '#5c3800' : isEpic ? '#3b0764' : '#1e3a8a'}
            fontSize="23"
            fontWeight="800"
            fontFamily="-apple-system, 'SF Pro Rounded', sans-serif"
          >
            $
          </text>
        </svg>
      </span>
    </div>
  );
}

/** The prize value on the card face, rolling digits like a slot machine once revealed. */
function CardHeadline({ draw, revealed }: { draw: Draw; revealed: boolean }) {
  const { t } = useI18n();
  const h = headline(draw);
  const slow = draw.rarity === 'legendary';

  if (h.kind === 'none') {
    return <div className="pk-amount pk-amount-words">{t('lottery.thanks')}</div>;
  }
  if (h.kind === 'again') {
    return <div className="pk-amount pk-amount-words">+1 {t('lottery.packUnit')}</div>;
  }
  if (h.kind === 'concurrency') {
    return (
      <div className="pk-amount pk-amount-pack">
        <SlotDigits text={`+${h.n}`} active={revealed} slow={slow} />
        <small>{t('lottery.concurrencyUnit')}</small>
      </div>
    );
  }
  if (h.kind === 'pity') {
    return (
      <div className="pk-amount pk-amount-pack">
        <SlotDigits text={`−${h.n}`} active={revealed} slow={slow} />
        <small>{t('lottery.pityUnit')}</small>
      </div>
    );
  }
  if (h.kind === 'money') {
    return (
      <div className="pk-amount">
        <SlotDigits text={dollars(h.value)} active={revealed} slow={slow} />
      </div>
    );
  }
  if (h.kind === 'credit') {
    return (
      <div className="pk-amount">
        <SlotDigits text={dollars(h.value)} active={revealed} slow={slow} />
      </div>
    );
  }
  if (h.kind === 'discount') {
    return (
      <div className="pk-amount">
        <SlotDigits text={t('lottery.zhe', zheVars(h.zhe))} active={revealed} slow={slow} />
      </div>
    );
  }
  // token_pack
  return (
    <div className="pk-amount pk-amount-pack">
      <SlotDigits text={h.tokens} active={revealed} slow={slow} />
      <small>{t('lottery.tokensUnit')}</small>
    </div>
  );
}

/**
 * Rolling slot-machine digits that collapse back to a single plain text node
 * once settled — eliminating up to ~1,200 spans and 40 masked layers in a 10-pull.
 */
function SlotDigits({ text, active, slow }: { text: string; active: boolean; slow?: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'settled'>(() => (reducedMotion() ? 'settled' : 'idle'));

  useEffect(() => {
    if (!active || phase !== 'idle') return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPhase('spinning'));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [active, phase]);

  useEffect(() => {
    if (phase !== 'spinning') return;
    const maxMs = slow ? 1750 : 1150;
    const settleId = setTimeout(() => setPhase('settled'), maxMs + 240);
    return () => clearTimeout(settleId);
  }, [phase, slow]);

  // Once settled, collapse to a single crisp text span with zero masked reel layers.
  if (phase === 'settled') {
    return (
      <span className="slot" aria-label={text}>
        {text}
      </span>
    );
  }
  // Before landing, show the reels' resting zeros as plain text: the real amount must not
  // flash on the flying card and then snap back to $0.00 when the reels start.
  if (!active) {
    return (
      <span className="slot" aria-hidden>
        {text.replace(/\d/g, '0')}
      </span>
    );
  }

  const chars = [...text];
  const digits = chars.filter((c) => /\d/.test(c)).length;
  let orderIdx = 0;

  return (
    <span className="slot" aria-label={text}>
      {chars.map((c, i) => {
        if (!/\d/.test(c)) {
          return (
            <span key={i} className="slot-fixed" aria-hidden>
              {c === ' ' ? '\u00a0' : c}
            </span>
          );
        }
        const order = orderIdx++;
        const ms = (slow ? 1100 : 720) + (order / Math.max(1, digits - 1)) * (slow ? 620 : 380);
        const digit = Number(c);
        const stops = 10 + digit + 1; // 1 full turn + target digit (11..20 spans instead of 40)
        return (
          <span key={i} className="slot-cell" aria-hidden>
            <span
              className="slot-reel"
              style={{
                transform: phase === 'spinning' ? `translateY(-${(10 + digit) * 1.1}em)` : 'translateY(0)',
                transitionDuration: `${ms}ms`,
                transitionDelay: '120ms',
              }}
            >
              {Array.from({ length: stops }, (_, k) => (
                <span key={k}>{k % 10}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
