import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, errorText, type ApiKey, type Group } from '../api';
import { useI18n } from '../i18n';
import { maskKey } from '../keys';
import { money } from '../usage';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';
import { KeyForm } from './KeyForm';
import { KeyUse } from './KeyUse';
import { ToolGlyph } from './ToolGlyph';

type Sheet = { kind: 'create' } | { kind: 'edit'; key: ApiKey } | { kind: 'use'; key: ApiKey } | null;

export function KeysView({ onToast }: { onToast: (msg: string) => void }) {
  const { t } = useI18n();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [working, setWorking] = useState<number | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [ks, gs] = await Promise.all([api.keys(), api.keyGroups()]);
      setKeys(ks);
      setGroups(gs);
      setError('');
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // The available list carries this account's own rates; the key's copy only the group's.
  const groupOf = useCallback((k: ApiKey) => groups.find((g) => g.id === k.group_id) ?? k.group ?? null, [groups]);

  async function act(k: ApiKey, fn: () => Promise<unknown>, done: string) {
    setWorking(k.id);
    try {
      await fn();
      onToast(done);
      await load();
    } catch (e) {
      onToast(errorText(e, t('common.genericError')));
    } finally {
      setWorking(null);
      setConfirm(null);
    }
  }

  const statusLabel = (s: string) =>
    s === 'inactive' || s === 'expired' || s === 'quota_exhausted' ? t(`keys.status.${s}`) : s;

  const sorted = useMemo(
    () => [...(keys ?? [])].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.id - a.id),
    [keys],
  );

  return (
    <div className="main-scroll">
      <div className="main-column">
        <div className="usage-head rise" style={{ '--i': 0 } as CSSProperties}>
          <button className="btn btn-primary" onClick={() => setSheet({ kind: 'create' })}>
            <Icon name="plus" className="size-4" />
            {t('keys.create')}
          </button>
          <button className="usage-refresh" title={t('keys.refresh')} aria-label={t('keys.refresh')} disabled={busy} onClick={load}>
            <Icon name="refresh" className={`size-[15px] ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && <div className="usage-error rise">{error}</div>}

        {keys && keys.length === 0 && <p className="usage-empty rise">{t('keys.none')}</p>}

        <div className="grid gap-2.5">
          {sorted.map((k, i) => {
            const g = groupOf(k);
            const on = k.status === 'active';
            return (
              <div key={k.id} className={`card key-card rise ${on ? '' : 'off'}`} style={{ '--i': i + 1 } as CSSProperties}>
                <div className="key-main">
                  <div className="key-id">
                    {k.tool ? <ToolGlyph id={k.tool} size="sm" /> : <BrandMark platform={g?.platform} />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate">{k.name}</h3>
                        {!on && <span className="key-status">{statusLabel(k.status)}</span>}
                      </div>
                      <div className="key-sub">
                        <CopyKey value={k.key} />
                        {g && (
                          <span className="key-group">
                            {k.tool && <BrandMark platform={g.platform} />}
                            {g.name}
                            {g.rate_multiplier > 0 && g.rate_multiplier !== 1 && <em>×{g.rate_multiplier}</em>}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="key-spend">
                    <span>
                      <i>{t('keys.today')}</i>
                      {money(k.today_cost)}
                    </span>
                    <span>
                      <i>{t('keys.month')}</i>
                      {money(k.month_cost)}
                    </span>
                  </div>

                  <div className="key-actions">
                    <button className="icon-button" title={t('keys.use')} aria-label={t('keys.use')} onClick={() => setSheet({ kind: 'use', key: k })}>
                      <Icon name="code" className="size-4" />
                    </button>
                    <button className="icon-button" title={t('keys.edit')} aria-label={t('keys.edit')} onClick={() => setSheet({ kind: 'edit', key: k })}>
                      <Icon name="edit" className="size-4" />
                    </button>
                    {(k.status === 'active' || k.status === 'inactive') && (
                      <button
                        className="icon-button"
                        disabled={working === k.id}
                        title={on ? t('keys.disable') : t('keys.enable')}
                        aria-label={on ? t('keys.disable') : t('keys.enable')}
                        onClick={() =>
                          act(
                            k,
                            () => api.updateKey(k.id, { status: on ? 'inactive' : 'active' }),
                            t(on ? 'keys.disabled' : 'keys.enabled', { name: k.name }),
                          )
                        }
                      >
                        <Icon name={on ? 'pause' : 'play'} className="size-4" />
                      </button>
                    )}
                    <button className="icon-button danger" title={t('keys.delete')} aria-label={t('keys.delete')} onClick={() => setConfirm(k.id)}>
                      <Icon name="trash" className="size-4" />
                    </button>
                  </div>
                </div>

                <Limits k={k} />

                {confirm === k.id && (
                  <div className="slide-in mt-3.5 flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
                    <p className="mr-auto text-[13px] text-ink-2">{t(k.tool ? 'keys.deleteToolAsk' : 'keys.deleteAsk', { name: k.name })}</p>
                    <button
                      className="btn btn-danger"
                      disabled={working === k.id}
                      onClick={() => act(k, () => api.deleteKey(k.id), t('keys.deleted', { name: k.name }))}
                    >
                      {t('keys.delete')}
                    </button>
                    <button className="btn text-ink-3" onClick={() => setConfirm(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {sheet?.kind === 'create' && (
        <KeyForm
          groups={groups}
          onClose={() => setSheet(null)}
          onSaved={(k) => {
            onToast(t('keys.created', { name: k.name }));
            load();
            setSheet({ kind: 'use', key: { ...k, group: groups.find((g) => g.id === k.group_id) ?? k.group } });
          }}
        />
      )}
      {sheet?.kind === 'edit' && (
        <KeyForm
          groups={groups}
          editing={sheet.key}
          onClose={() => setSheet(null)}
          onSaved={(k) => {
            onToast(t('keys.saved', { name: k.name }));
            setSheet(null);
            load();
          }}
        />
      )}
      {sheet?.kind === 'use' && <KeyUse apiKey={sheet.key} group={groupOf(sheet.key)} onClose={() => setSheet(null)} onToast={onToast} />}
    </div>
  );
}

function CopyKey({ value }: { value: string }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <span className="key-secret">
      <code>{shown ? value : maskKey(value)}</code>
      <button title={shown ? t('keys.hide') : t('keys.show')} aria-label={shown ? t('keys.hide') : t('keys.show')} onClick={() => setShown((s) => !s)}>
        <Icon name={shown ? 'eyeOff' : 'eye'} className="size-3.5" />
      </button>
      <button
        className={copied ? 'copied' : ''}
        title={t('keys.copy')}
        aria-label={t('keys.copy')}
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => {});
          setCopied(true);
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} className="size-3.5" />
      </button>
    </span>
  );
}

/** Quota, spend windows and expiry, only the ones this key has. */
function Limits({ k }: { k: ApiKey }) {
  const { t } = useI18n();
  const bars: { label: string; used: number; cap: number }[] = [];
  if (k.quota > 0) bars.push({ label: t('keys.quota'), used: k.quota_used, cap: k.quota });
  if (k.rate_limit_5h > 0) bars.push({ label: t('keys.limit5h'), used: k.usage_5h, cap: k.rate_limit_5h });
  if (k.rate_limit_1d > 0) bars.push({ label: t('keys.limit1d'), used: k.usage_1d, cap: k.rate_limit_1d });
  if (k.rate_limit_7d > 0) bars.push({ label: t('keys.limit7d'), used: k.usage_7d, cap: k.rate_limit_7d });
  const expires = k.expires_at ? new Date(k.expires_at) : null;
  if (bars.length === 0 && !expires) return null;
  return (
    <div className="key-limits">
      {bars.map((b) => (
        <div key={b.label} className="key-limit">
          <span>{b.label}</span>
          <div className="key-meter">
            <i style={{ width: `${Math.min(100, (b.used / b.cap) * 100)}%` }} className={b.used >= b.cap ? 'full' : ''} />
          </div>
          <b>
            {money(b.used)} / {money(b.cap)}
          </b>
        </div>
      ))}
      {expires && (
        <div className="key-limit plain">
          <span>{t('keys.expires')}</span>
          <b>{expires.toLocaleDateString()}</b>
        </div>
      )}
    </div>
  );
}
