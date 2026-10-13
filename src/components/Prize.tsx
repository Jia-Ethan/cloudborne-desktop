import type { Draw, Rarity } from '../api';
import { useI18n } from '../i18n';
import { headline, dollars, zheVars } from '../lottery';

export function RarityTag({ rarity }: { rarity: Rarity }) {
  const { t } = useI18n();
  return <span className={`rarity-tag r-${rarity}`}>{t(`rarity.${rarity}`)}</span>;
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
