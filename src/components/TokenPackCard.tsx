import { useEffect, useState, type CSSProperties } from 'react';
import { api, type TokenPack } from '../api';
import { useI18n } from '../i18n';
import { packLeft, tokenCount, visiblePacks } from '../tokenPacks';
import { when } from './WinnerSheet';

/** Active time-limited token packs with a bar per pack. Hidden when none are active. `reload` refetches. */
export function TokenPackCard({ reload }: { reload: number }) {
  const { t } = useI18n();
  const [packs, setPacks] = useState<TokenPack[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .tokenPacks()
      .then((r) => alive && setPacks(Array.isArray(r) ? r : []))
      .catch(() => alive && setPacks([]));
    return () => {
      alive = false;
    };
  }, [reload]);

  const shown = visiblePacks(packs);
  if (shown.length === 0) return null;

  return (
    <section className="card redeem-card rise" style={{ '--i': 1.2 } as CSSProperties}>
      <h2>{t('packs.title')}</h2>
      <ul className="pack-list">
        {shown.map((p) => {
          const left = packLeft(p);
          return (
            <li key={p.id} className="pack-row">
              <div className="pack-head">
                <b>{p.group_name}</b>
                <span>{t('packs.expires', { time: when(p.expires_at) })}</span>
              </div>
              <div className="pack-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(left * 100)}>
                <i style={{ width: `${left * 100}%` }} />
              </div>
              <span className="pack-left">
                {t('packs.left', { left: tokenCount(p.tokens_total - p.tokens_used), total: tokenCount(p.tokens_total) })}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="redeem-note">{t('packs.hint')}</p>
    </section>
  );
}
