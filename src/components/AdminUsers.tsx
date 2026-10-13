import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, errorText, type AdminUser } from '../api';
import { useI18n } from '../i18n';
import { money } from '../usage';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

const PAGE = 20;

type Action = { kind: 'add' | 'subtract'; user: AdminUser } | { kind: 'status'; user: AdminUser } | null;

/** `focus` opens the page filtered to one user (from a big win). */
export function AdminUsers({ focus, onToast }: { focus: { id: number; email: string } | null; onToast: (m: string) => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState(focus?.email ?? '');
  const [query, setQuery] = useState(focus?.email ?? '');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState<Action>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!focus) return;
    setSearch(focus.email);
    setQuery(focus.email);
    setPage(1);
  }, [focus]);

  // Search as you type, a beat after the last key.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    const g = ++generation.current;
    setBusy(true);
    try {
      const p = await api.adminUsers(page, PAGE, query);
      if (g !== generation.current) return;
      setItems(p.items);
      setTotal(p.total);
      setError('');
    } catch (e) {
      if (g === generation.current) setError(errorText(e, t('common.genericError')));
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }, [page, query, t]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="main-scroll">
      <div className="main-column">
        <div className="usage-head rise" style={{ '--i': 0 } as CSSProperties}>
          <label className="search-field">
            <Icon name="search" className="size-4" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('admin.users.search')} spellCheck={false} />
            {search && (
              <button aria-label={t('common.clear')} onClick={() => setSearch('')}>
                <Icon name="close" className="size-3.5" />
              </button>
            )}
          </label>
          <button className="usage-refresh" title={t('usage.refresh')} aria-label={t('usage.refresh')} disabled={busy} onClick={load}>
            <Icon name="refresh" className={`size-[15px] ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && <div className="usage-error rise">{error}</div>}

        <section className="card usage-card rise" style={{ '--i': 1 } as CSSProperties}>
          {items && items.length === 0 ? (
            <p className="usage-empty">{t('admin.users.none')}</p>
          ) : (
            <table className="usage-table admin-users">
              <thead>
                <tr>
                  <th>{t('admin.win.email')}</th>
                  <th>{t('admin.users.balance')}</th>
                  <th>{t('keys.today')}</th>
                  <th>{t('keys.month')}</th>
                  <th>{t('admin.users.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((u) => {
                  const on = u.status === 'active';
                  return (
                    <tr key={u.id} className={`${on ? '' : 'off'} ${focus?.id === u.id ? 'focus' : ''}`}>
                      <td className="usage-model">
                        <span className="user-cell">
                          <span className="truncate" title={u.email}>
                            {u.email}
                          </span>
                          {u.role === 'admin' && <em className="user-role">{t('admin.users.admin')}</em>}
                        </span>
                      </td>
                      <td className="font-semibold">{money(u.balance)}</td>
                      <td>{money(u.today_cost ?? 0)}</td>
                      <td>{money(u.month_cost ?? 0)}</td>
                      <td>
                        <span className={`user-status ${on ? 'on' : ''}`}>{on ? t('admin.users.active') : t('admin.users.disabled')}</span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="icon-button" title={t('admin.users.add')} aria-label={t('admin.users.add')} onClick={() => setAction({ kind: 'add', user: u })}>
                            <Icon name="plus" className="size-4" />
                          </button>
                          <button
                            className="icon-button"
                            title={t('admin.users.subtract')}
                            aria-label={t('admin.users.subtract')}
                            onClick={() => setAction({ kind: 'subtract', user: u })}
                          >
                            <Icon name="minus" className="size-4" />
                          </button>
                          {u.role === 'admin' ? (
                            <span className="size-[30px]" aria-hidden />
                          ) : (
                            <button
                              className={`icon-button ${on ? 'danger' : ''}`}
                              title={on ? t('admin.users.disable') : t('admin.users.enable')}
                              aria-label={on ? t('admin.users.disable') : t('admin.users.enable')}
                              onClick={() => setAction({ kind: 'status', user: u })}
                            >
                              <Icon name={on ? 'ban' : 'play'} className="size-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {pages > 1 && <Pager page={page} pages={pages} onPage={setPage} />}
        </section>
      </div>

      {action && (action.kind === 'add' || action.kind === 'subtract') && (
        <BalanceDialog
          user={action.user}
          add={action.kind === 'add'}
          onClose={() => setAction(null)}
          onDone={(u, msg) => {
            setAction(null);
            setItems((xs) => xs?.map((x) => (x.id === u.id ? { ...x, balance: u.balance } : x)) ?? xs);
            onToast(msg);
          }}
        />
      )}
      {action?.kind === 'status' && (
        <StatusDialog
          user={action.user}
          onClose={() => setAction(null)}
          onDone={(u, msg) => {
            setAction(null);
            setItems((xs) => xs?.map((x) => (x.id === u.id ? { ...x, status: u.status } : x)) ?? xs);
            onToast(msg);
          }}
        />
      )}
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="pager">
      <button className="icon-button" aria-label={t('admin.prev')} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <Icon name="chevronLeft" className="size-4" />
      </button>
      <span>
        {page} / {pages}
      </span>
      <button className="icon-button" aria-label={t('admin.next')} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <Icon name="chevronRight" className="size-4" />
      </button>
    </div>
  );
}

function BalanceDialog({
  user,
  add,
  onClose,
  onDone,
}: {
  user: AdminUser;
  add: boolean;
  onClose: () => void;
  onDone: (u: AdminUser, msg: string) => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = parseFloat(amount);
  const ok = Number.isFinite(value) && value > 0;
  const after = ok ? user.balance + (add ? value : -value) : user.balance;

  async function save() {
    if (!ok || busy) return;
    setBusy(true);
    setError('');
    try {
      const u = await api.adminUserBalance(user.id, value, add, notes);
      onDone(u, t(add ? 'admin.users.added' : 'admin.users.subtracted', { email: user.email, amount: money(value) }));
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`${add ? t('admin.users.add') : t('admin.users.subtract')} · ${user.email}`}
      onClose={onClose}
      footer={
        <>
          {error && <p className="mr-auto text-[13px] text-[var(--danger)]">{error}</p>}
          <button className="btn btn-quiet" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className={`btn ${add ? 'btn-primary' : 'btn-danger'}`} disabled={!ok || busy} onClick={save}>
            {busy ? t('common.wait') : add ? t('admin.users.add') : t('admin.users.subtract')}
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="balance-preview">
          <div>
            <span>{t('admin.users.balance')}</span>
            <b>{money(user.balance)}</b>
          </div>
          <Icon name="chevronRight" className="size-4 text-ink-3" />
          <div>
            <span>{t('admin.users.after')}</span>
            <b className={after < 0 ? 'neg' : ''}>{money(after)}</b>
          </div>
        </div>
        <label className="form-row">
          <span>{t('admin.users.amount')}</span>
          <div className="field-money">
            <i>$</i>
            <input className="field" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
        </label>
        <label className="form-row">
          <span>{t('admin.users.note')}</span>
          <input className="field" value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function StatusDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (u: AdminUser, msg: string) => void }) {
  const { t } = useI18n();
  const on = user.status === 'active';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      const u = await api.adminUserStatus(user.id, !on);
      onDone(u, t(on ? 'admin.users.disabledToast' : 'admin.users.enabledToast', { email: user.email }));
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={on ? t('admin.users.disable') : t('admin.users.enable')}
      onClose={onClose}
      footer={
        <>
          {error && <p className="mr-auto text-[13px] text-[var(--danger)]">{error}</p>}
          <button className="btn btn-quiet" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className={`btn ${on ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={go}>
            {busy ? t('common.wait') : on ? t('admin.users.disable') : t('admin.users.enable')}
          </button>
        </>
      }
    >
      <p className="confirm-text">{t(on ? 'admin.users.disableAsk' : 'admin.users.enableAsk', { email: user.email })}</p>
    </Dialog>
  );
}
