import { useEffect, useState, type CSSProperties } from 'react';
import { api, type TokenPack } from '../api';
import { useI18n } from '../i18n';
import { packLeft, tokenCount, visiblePacks } from '../tokenPacks';
import { when } from './WinnerSheet';

/** Time-limited token packs with a bar per pack. Hidden when the account has none. `reload` refetches. */
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
          const active = p.status === 'active';
          return (
            <li key={p.id} className={`pack-row ${active ? '' : 'done'}`}>
              <div className="pack-head">
                <b>{p.group_name}</b>
                <span>{active ? t('packs.expires', { time: when(p.expires_at) }) : t(p.status === 'used_up' ? 'packs.usedUp' : 'packs.expired')}</span>
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
