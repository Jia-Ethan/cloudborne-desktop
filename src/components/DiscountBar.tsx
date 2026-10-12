import { useEffect, useState } from 'react';
import type { Rates } from '../api';
import { useI18n } from '../i18n';
import { Logo, type LogoId } from './Logo';

const BRANDS: { platform: string; name: string; logo: LogoId }[] = [
  { platform: 'openai', name: 'GPT', logo: 'openai' },
  { platform: 'anthropic', name: 'Claude', logo: 'claude' },
  { platform: 'grok', name: 'Grok', logo: 'grok' },
];

/**
 * Balance is topped up at ¥1 = $1, so one official dollar (¥cnyPerUsd) costs
 * ¥rate: rate / cnyPerUsd of list, shown in 折 (tenths). Rounded up so we
 * never claim more than the real discount.
 */
export function discount(rate: number, cnyPerUsd: number): number {
  return Math.ceil((rate / cnyPerUsd) * 100 - 1e-9) / 10;
}

export function DiscountBar({ rates }: { rates: Rates | null }) {
  const { t } = useI18n();
  const items = BRANDS.flatMap((b) => {
    const r = rates?.rates.find((x) => x.platform === b.platform);
    const value = r && rates ? discount(r.rate, rates.cny_per_usd) : 10;
    return value < 10 ? [{ ...b, value }] : [];
  });
  const [i, setI] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => setI((n) => n + 1), 3200);
    return () => clearInterval(id);
  }, [items.length]);

  if (items.length === 0) return null;
  const cur = items[i % items.length];
  return (
    <div className="discount">
      <span key={cur.platform} className="discount-text">
        {t('home.discount', { name: cur.name, value: cur.value, pct: Math.round(cur.value * 10) })}
      </span>
      <div className="discount-logos">
        {items.map((b, n) => (
          <span key={b.platform} className={`discount-logo ${n === i % items.length ? 'on' : ''}`} title={b.name}>
            <Logo id={b.logo} className="size-[17px]" />
          </span>
        ))}
      </div>
    </div>
  );
}
