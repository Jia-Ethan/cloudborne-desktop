import { useEffect, useState } from 'react';
import type { Rates } from '../api';
import { useI18n } from '../i18n';
import { Logo, type LogoId } from './Logo';

/** `cny`: the relay lists this vendor's models at its yuan prices, read as dollars. */
const BRANDS: { platform: string; name: string; logo: LogoId; cny?: boolean }[] = [
  { platform: 'openai', name: 'GPT', logo: 'openai' },
  { platform: 'anthropic', name: 'Claude', logo: 'claude' },
  { platform: 'gemini', name: 'Gemini', logo: 'gemini' },
  { platform: 'grok', name: 'Grok', logo: 'grok' },
  { platform: 'deepseek', name: 'DeepSeek', logo: 'deepseek', cny: true },
  { platform: 'zhipu', name: 'GLM', logo: 'zhipu', cny: true },
  { platform: 'kimi', name: 'Kimi', logo: 'kimi', cny: true },
];

/**
 * Share of the official price, 0–1. Balance is topped up at ¥1 = $1. A model
 * listed at its official dollar price costs ¥rate per official dollar
 * (¥cnyPerUsd), so the share is rate / cnyPerUsd. A model listed at its
 * official yuan price costs ¥rate per official yuan, so the share is the rate.
 */
export function share(rate: number, cnyPerUsd: number, cny = false): number {
  return cny ? rate : rate / cnyPerUsd;
}

/**
 * The share in 折 (tenths), rounded up so we never claim more than the real
 * discount. Below 1折 a second decimal keeps account-specific rates apart
 * (0.25 and 0.3 on GPT are 0.35折 and 0.42折, not both 0.5折).
 */
export function zhe(s: number): number {
  const digits = s < 0.1 ? 100 : 10;
  return Math.ceil(s * 10 * digits - 1e-6) / digits;
}

/** The same share as a percentage of the official price, one decimal, rounded up. */
export function percent(s: number): number {
  return Math.ceil(s * 1000 - 1e-6) / 10;
}

export function DiscountBar({ rates }: { rates: Rates | null }) {
  const { t } = useI18n();
  const items = BRANDS.flatMap((b) => {
    const r = rates?.rates.find((x) => x.platform === b.platform);
    const s = r && rates ? share(r.rate, rates.cny_per_usd, b.cny) : 1;
    return s < 1 ? [{ ...b, value: zhe(s), pct: percent(s) }] : [];
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
        {t('home.discount', { name: cur.name, value: cur.value, pct: cur.pct })}
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
