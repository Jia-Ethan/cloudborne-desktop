import { useEffect, useState } from 'react';
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
 * multi-layer holographic foil / glitter / studio-window glaze overlays,
 * a 3D floating `.pk-pop` emblem, slot-machine rolling digits, and a two-sided
 * 3D mystery foil back for unflipped Epic/Legendary batch hits (Option B).
 */
export function PrizeCard({
  draw,
  serial,
  faceDown,
  revealed,
  out,
  inspected,
  onClick,
}: {
  draw: Draw;
  /** 1-based serial number for the collector card footer. */
  serial: number;
  /** True while an Epic/Legendary card is waiting face-down to be flipped. */
  faceDown: boolean;
  /** True once face-up and settled (starts slot roll & floats the 3D emblem). */
  revealed: boolean;
  /** True once landed in the fan/gallery. */
  out: boolean;
  /** True when enlarged for close-up inspection in a large batch. */
  inspected?: boolean;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const h = headline(draw);
  const isNone = draw.kind === 'none';
  const serialText = `NO.${String(draw.id ? draw.id % 1000 : serial).padStart(3, '0')}`;
  const sourceLabel = draw.source ? t(`lottery.source.${draw.source}`) : '';
  const vendor = h.kind === 'pack' ? matchVendorLogo(h.group) : null;

  return (
    <div
      className={`pk-card-shell r-${draw.rarity} k-${draw.kind} ${isNone ? 'k-none' : ''} ${out ? 'out' : ''} ${
        faceDown ? 'is-back' : 'is-front'
      } ${revealed ? 'is-revealed' : ''} ${inspected ? 'is-inspected' : ''}`}
      onClick={onClick}
    >
      {/* Stacked cardstock slabs create genuine edge thickness when tilted in 3D. */}
      <i className="pk-slab" aria-hidden />
      <i className="pk-slab" aria-hidden />
      <i className="pk-slab" aria-hidden />

      <div className="pk-flip">
        {/* ---- Front face: collectible artwork + holographic optical stack ---- */}
        <div className="pk-face">
          <div className="pk-head">
            <span className="pk-head-tags">
              {!isNone ? <RarityTag rarity={draw.rarity} /> : <span className="pk-none-pill">{t('lottery.thanks')}</span>}
              <GuaranteeTag draw={draw} />
            </span>
            <span className="pk-serial">{serialText}</span>
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

          {/* Multi-layer physical finish: rainbow holo + glitter specks + glare + twin-window clear glaze */}
          <i className="pk-holo" aria-hidden />
          <i className="pk-glare" aria-hidden />
          <i className="pk-glaze" aria-hidden />
        </div>

        {/* ---- Reverse face: Option B shimmering mystery foil back for Epic/Legendary ---- */}
        <div className={`pk-back r-${draw.rarity}`}>
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
          <i className="pk-glare" aria-hidden />
          <i className="pk-glaze" aria-hidden />
        </div>
      </div>

      {/* 3D floating emblem outside overflow:hidden so it stands off the card face in Z-space. */}
      {!faceDown && (
        <div className="pk-pop" aria-hidden>
          <PrizeEmblem draw={draw} vendor={vendor} />
        </div>
      )}
    </div>
  );
}

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
    case 'none':
      return t('lottery.thanksSub');
  }
}

/** Sculptural 3D floating emblem per prize kind (with vendor logos for token packs). */
function PrizeEmblem({ draw, vendor }: { draw: Draw; vendor: ReturnType<typeof matchVendorLogo> }) {
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
    return (
      <div className="pk-emblem pk-emblem-discount">
        <span className="pk-emblem-halo" />
        <svg viewBox="0 0 64 64" className="pk-emblem-svg">
          <defs>
            <linearGradient id="pk-em-disc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.96" />
              <stop offset="55%" stopColor="#f5d0fe" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <path
            d="M10 18a4 4 0 0 1 4-4h36a4 4 0 0 1 4 4v9a5 5 0 0 0 0 10v9a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4v-9a5 5 0 0 0 0-10z"
            fill="url(#pk-em-disc)"
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
    return (
      <div className="pk-emblem pk-emblem-credit">
        <span className="pk-emblem-halo" />
        <svg viewBox="0 0 64 64" className="pk-emblem-svg">
          <defs>
            <linearGradient id="pk-em-bolt" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="50%" stopColor="#bae6fd" />
              <stop offset="100%" stopColor="#60a5fa" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="24" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" />
          <path d="M35 12 19 34h12l-3 18 17-23H33z" fill="url(#pk-em-bolt)" />
        </svg>
      </div>
    );
  }

  if (h.kind === 'again') {
    return (
      <div className="pk-emblem pk-emblem-again">
        <span className="pk-emblem-halo" />
        <svg viewBox="0 0 64 64" className="pk-emblem-svg">
          <defs>
            <linearGradient id="pk-em-pack" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#93c5fd" />
              <stop offset="50%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
          </defs>
          <rect x="16" y="10" width="32" height="44" rx="5" fill="url(#pk-em-pack)" stroke="#fff" strokeWidth="1.8" />
          <line x1="16" y1="18" x2="48" y2="18" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" />
          <line x1="16" y1="46" x2="48" y2="46" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
          <path d="M32 23c.7 3.8 2.1 5.2 5.9 5.9-3.8.7-5.2 2.1-5.9 5.9-.7-3.8-2.1-5.2-5.9-5.9 3.8-.7 5.2-2.1 5.9-5.9z" fill="#fff" />
        </svg>
      </div>
    );
  }

  // Default: balance / cashback / balance_percent sculpted coin medallion
  const isGold = draw.rarity === 'legendary';
  const isEpic = draw.rarity === 'epic';
  return (
    <div className="pk-emblem pk-emblem-coin">
      <span className="pk-emblem-halo" />
      <svg viewBox="0 0 64 64" className="pk-emblem-svg">
        <defs>
          <radialGradient id={`pk-coin-${draw.rarity}`} cx="34%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="35%" stopColor={isGold ? '#ffe896' : isEpic ? '#f3d5ff' : '#dbeafe'} />
            <stop offset="100%" stopColor={isGold ? '#c98a18' : isEpic ? '#9333ea' : '#3b82f6'} />
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="23" fill={`url(#pk-coin-${draw.rarity})`} stroke="rgba(255,255,255,0.85)" strokeWidth="1.8" />
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

function SlotDigits({ text, active, slow }: { text: string; active: boolean; slow?: boolean }) {
  const [spun, setSpun] = useState(() => reducedMotion());

  useEffect(() => {
    if (!active || spun) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setSpun(true));
    });
    return () => cancelAnimationFrame(id);
  }, [active, spun]);

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
        const ms = (slow ? 1250 : 780) + (order / Math.max(1, digits - 1)) * (slow ? 760 : 420);
        const turns = 1 + Math.min(2, order);
        return (
          <span key={i} className="slot-cell" aria-hidden>
            <span
              className="slot-reel"
              style={{
                transform: spun ? `translateY(-${(turns * 10 + Number(c)) * 1.1}em)` : 'translateY(0)',
                transitionDuration: `${ms}ms`,
                transitionDelay: '160ms',
              }}
            >
              {Array.from({ length: 40 }, (_, k) => (
                <span key={k}>{k % 10}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
