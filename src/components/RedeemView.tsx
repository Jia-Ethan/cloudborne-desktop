import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { api, errorText, type RedeemItem } from '../api';
import { useI18n } from '../i18n';
import { dollars } from '../lottery';
import { direction, historyTitle, historyValue, redeemedText } from '../redeem';
import { Icon } from './Icon';
import { when } from './WinnerSheet';

const PAGE = 20;

/** Redeem codes: balance on top, the code field, then every balance change, newest first. */
export function RedeemView({ balance, onRedeemed }: { balance: number; onRedeemed: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ text: string; key: number } | null>(null);
  const [items, setItems] = useState<RedeemItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  const load = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        const r = await api.redeemHistory(page, PAGE);
        if (!alive.current) return;
        // A change that lands between pages shifts the list by one; skip what is already shown.
        setItems((prev) => {
          if (page === 1 || !prev) return r.items;
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...r.items.filter((x) => !seen.has(x.id))];
        });
        setTotal(r.total);
        setListError('');
      } catch (e) {
        if (alive.current) setListError(errorText(e, t('common.genericError')));
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    alive.current = true;
    load(1);
    return () => {
      alive.current = false;
    };
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    setDone(null);
    try {
      const r = await api.redeem(code);
      setDone({ text: redeemedText(r, t), key: Date.now() });
      setCode('');
      onRedeemed();
      load(1);
    } catch (err) {
      setError(errorText(err, t('common.genericError')));
      input.current?.select();
    } finally {
      setBusy(false);
    }
  }

  async function paste() {
    const text = await navigator.clipboard.readText().catch(() => '');
    if (text.trim()) {
      setCode(text.trim());
      setError('');
    }
    input.current?.focus();
  }

  return (
    <div className="main-scroll">
      <div className="main-column redeem-column">
        <section className="redeem-hero rise" style={{ '--i': 0 } as CSSProperties}>
          <span className="redeem-hero-label">{t('redeem.balance')}</span>
          <span className="redeem-hero-amount">{dollars(balance)}</span>
          <Icon name="ticket" className="redeem-hero-glyph" />
        </section>

        <form className="card redeem-card rise" style={{ '--i': 1 } as CSSProperties} onSubmit={submit}>
          <h2>{t('redeem.title')}</h2>
          <div className={`redeem-field ${error ? 'bad' : ''}`}>
            <Icon name="ticket" className="size-[18px] text-ink-3" />
            <input
              ref={input}
              value={code}
              placeholder={t('redeem.placeholder')}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              autoFocus
              onChange={(e) => {
                setCode(e.target.value);
                setError('');
              }}
            />
            {!code && (
              <button type="button" className="redeem-paste" onClick={paste}>
                {t('redeem.paste')}
              </button>
            )}
          </div>
          <button className="btn btn-primary h-11 w-full" disabled={busy || !code.trim()}>
            {busy ? t('redeem.busy') : t('redeem.submit')}
          </button>
          {error ? (
            <p className="redeem-note bad">{error}</p>
          ) : done ? (
            <p key={done.key} className="redeem-note ok">
              <Icon name="check" className="size-4" />
              {done.text}
            </p>
          ) : (
            <p className="redeem-note">{t('redeem.hint')}</p>
          )}
        </form>

        <section className="card usage-card rise" style={{ '--i': 2 } as CSSProperties}>
          <div className="usage-card-head">
            <h2>{t('redeem.history')}</h2>
            <button className="usage-refresh" title={t('redeem.refresh')} aria-label={t('redeem.refresh')} disabled={loading} onClick={() => load(1)}>
              <Icon name="refresh" className={`size-[15px] ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {listError && <div className="usage-error">{listError}</div>}
          {items === null ? (
            !listError && <p className="usage-empty">{t('common.wait')}</p>
          ) : items.length === 0 ? (
            <p className="usage-empty">{t('redeem.empty')}</p>
          ) : (
            <ul className="redeem-list">
              {items.map((it) => (
                <li key={it.id} className={`redeem-row d-${direction(it)}`}>
                  <i aria-hidden>
                    <Icon name={it.type === 'lottery' ? 'gift' : direction(it) === 'out' ? 'minus' : 'plus'} className="size-3.5" />
                  </i>
                  <div className="min-w-0 flex-1">
                    <b>{historyTitle(it, t)}</b>
                    <span className="truncate">{it.notes || it.code}</span>
                  </div>
                  <div className="redeem-row-end">
                    <b>{historyValue(it, t)}</b>
                    <time>{when(it.used_at || it.created_at)}</time>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {items !== null && items.length < total && (
            <button className="btn btn-quiet mt-2 h-9 w-full" disabled={loading} onClick={() => load(Math.floor(items.length / PAGE) + 1)}>
              {loading ? t('common.wait') : t('redeem.more')}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
