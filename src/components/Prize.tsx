import type { Draw, Rarity } from '../api';
import { useI18n } from '../i18n';
import { headline, dollars, zheVars } from '../lottery';

export function RarityTag({ rarity }: { rarity: Rarity }) {
  const { t } = useI18n();
  return <span className={`rarity-tag r-${rarity}`}>{t(`rarity.${rarity}`)}</span>;
}

/** 保底 / 连开保底 / 首开加成, when one of them decided or boosted the draw. */
export function GuaranteeTag({ draw }: { draw: Pick<Draw, 'detail'> }) {
  const { t } = useI18n();
  const g = draw.detail?.guarantee;
  if (g === 'pity' || g === 'batch') return <em className={`lot-guarantee g-${g}`}>{t(`lottery.guarantee.${g}`)}</em>;
  if (draw.detail?.boost) return <em className="lot-guarantee g-boost">{t('lottery.guarantee.boost')}</em>;
  return null;
}

/** What a draw gave, in one short line: $3.20, 8 折 · 24 小时, 再来一次 … */
export function PrizeText({ draw }: { draw: Pick<Draw, 'kind' | 'amount' | 'detail'> }) {
  const { t } = useI18n();
  const h = headline(draw);
  switch (h.kind) {
    case 'money':
      return <>{dollars(h.value)}</>;
    case 'credit':
      return (
        <>
          {dollars(h.value)} · {t('lottery.hours', { n: h.hours })}
        </>
      );
    case 'discount':
      return (
        <>
          {t('lottery.zhe', zheVars(h.zhe))} · {t('lottery.hours', { n: h.hours })}
        </>
      );
    case 'again':
      return <>{t('lottery.again')}</>;
    case 'none':
      return <>{t('lottery.thanks')}</>;
  }
}
