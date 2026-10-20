import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api, errorText, type Invite, type Invites } from '../api';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { when } from './WinnerSheet';

/** Invite links, for accounts the admin allowed; nothing at all for everyone else. */
export function InviteCard({ onToast }: { onToast: (m: string) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<Invites | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.invites().then(setState, () => setState(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!state?.allowed) return null;

  async function copy(inv: Invite) {
    await navigator.clipboard.writeText(inv.url).catch(() => {});
    onToast(t('invite.copied'));
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const inv = await api.inviteCreate();
      await copy(inv);
      load();
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(inv: Invite) {
    setError('');
    try {
      await api.inviteRevoke(inv.id);
      onToast(t('invite.revoked'));
      load();
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    }
  }

  const full = state.open >= state.limit;

  return (
    <section className="card redeem-card rise" style={{ '--i': 1.75 } as CSSProperties}>
      <div className="usage-card-head">
        <h2>{t('invite.title')}</h2>
        <button className="btn btn-primary h-8 px-3 text-[13px]" disabled={busy || full} onClick={create}>
          {busy ? t('invite.busy') : t('invite.create')}
        </button>
      </div>
      <p className={`redeem-note ${error ? 'bad' : ''}`}>{error || t('invite.hint', { days: state.ttl_days, limit: state.limit })}</p>
      {state.items.length === 0 ? (
        <p className="usage-empty">{t('invite.empty')}</p>
      ) : (
        <ul className="redeem-list">
          {state.items.map((inv) => {
            const open = inv.status === 'unused';
            return (
              <li key={inv.id} className={`redeem-row invite-row ${open ? 'd-in' : ''}`}>
                <i aria-hidden>
                  <Icon name={inv.status === 'used' ? 'check' : open ? 'users' : 'close'} className="size-3.5" />
                </i>
                <div className="min-w-0 flex-1">
                  <b className="invite-code">{inv.code}</b>
                  <span className="truncate">
                    {open
                      ? t('invite.open', { time: inv.expires_at ? when(inv.expires_at) : '—' })
                      : inv.status === 'used'
                        ? inv.used_by
                          ? t('invite.used', { name: inv.used_by })
                          : t('invite.usedPlain')
                        : t('invite.expired')}
                  </span>
                </div>
                {open && (
                  <div className="row-actions">
                    <button className="icon-button" title={t('invite.copy')} aria-label={t('invite.copy')} onClick={() => copy(inv)}>
                      <Icon name="copy" className="size-4" />
                    </button>
                    <button className="icon-button danger" title={t('invite.revoke')} aria-label={t('invite.revoke')} onClick={() => revoke(inv)}>
                      <Icon name="trash" className="size-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
