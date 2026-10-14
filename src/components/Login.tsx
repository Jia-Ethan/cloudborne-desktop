import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { api, displayName, errorText, type SavedAccount, type User } from '../api';
import { useI18n } from '../i18n';
import { Avatar } from './AccountMenu';
import { Hero } from './Hero';
import { Icon } from './Icon';
import { LanguagePicker } from './LanguagePicker';

/** True when clicking the account signs it in without typing anything. */
const oneClick = (a: SavedAccount) => a.signed_in || a.has_password;

/**
 * Sign-in page. With saved accounts it opens on a picker: one click signs a
 * signed-in account (or one with a remembered password) straight in. The form
 * offers the saved accounts under the email field the way a browser does, and
 * can remember the password on this computer. `onBack` is set when an account
 * is already signed in (adding another one).
 */
export function Login({
  onDone,
  update,
  accounts = [],
  prefill = '',
  form = false,
  twoFactorFor = null,
  notice = '',
  onSwitch,
  onRemove,
  onBack,
}: {
  onDone: (u: User) => void;
  update?: ReactNode;
  accounts?: SavedAccount[];
  prefill?: string;
  /** Open on the form even when there are saved accounts (adding a new one). */
  form?: boolean;
  /** Masked email when a remembered password just needed a 2FA code. */
  twoFactorFor?: string | null;
  notice?: string;
  onSwitch?: (a: SavedAccount) => Promise<void>;
  onRemove?: (a: SavedAccount) => void;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const [picking, setPicking] = useState(accounts.length > 0 && !prefill && !form && twoFactorFor === null);
  const [email, setEmail] = useState(prefill);
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(true);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [hover, setHover] = useState(0);
  const [switching, setSwitching] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [twoFactor, setTwoFactor] = useState<string | null>(twoFactorFor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice);

  const suggestions = useMemo(() => {
    const q = email.trim().toLowerCase();
    return accounts
      .filter((a) => a.email.toLowerCase() !== q && (!q || a.email.toLowerCase().includes(q) || a.username.toLowerCase().includes(q)))
      .slice(0, 5);
  }, [accounts, email]);
  const showSuggest = suggesting && suggestions.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = twoFactor === null ? await api.login(email, password, remember) : await api.login2fa(code);
      if (r.kind === 'done') onDone(r.user);
      else setTwoFactor(r.email_masked);
    } catch (err) {
      setError(errorText(err, t('common.genericError')));
    } finally {
      setBusy(false);
    }
  }

  /** One click for a signed-in account or one with a password; otherwise fill its email in. */
  async function choose(a: SavedAccount) {
    setError('');
    setSuggesting(false);
    if (oneClick(a) && onSwitch) {
      setSwitching(a.user_id);
      try {
        await onSwitch(a);
      } catch (err) {
        setError(errorText(err, t('common.genericError')));
      } finally {
        setSwitching(null);
      }
      return;
    }
    setPicking(false);
    setEmail(a.email);
    setPassword('');
    requestAnimationFrame(() => passwordRef.current?.focus());
  }

  function onEmailKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!showSuggest) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = suggestions.length;
      setHover((h) => (h + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(suggestions[Math.min(hover, suggestions.length - 1)]);
    } else if (e.key === 'Escape') {
      setSuggesting(false);
    }
  }

  function trackPointer(e: MouseEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  }

  const status = (a: SavedAccount) =>
    switching === a.user_id ? (
      <span className="acct-state wait">
        <Icon name="refresh" className="size-3 animate-spin" />
        {t('common.wait')}
      </span>
    ) : a.signed_in ? (
      <span className="acct-state on">{t('login.signedIn')}</span>
    ) : a.has_password ? (
      <span className="acct-state on">{t('login.oneClick')}</span>
    ) : (
      <span className="acct-state">{t('login.needsPassword')}</span>
    );

  const heading =
    twoFactor !== null
      ? t('login.twoFactor')
      : picking
        ? t('login.pickTitle')
        : onBack && !prefill
          ? t('login.addTitle')
          : t('login.title');

  return (
    <div className="login-shell h-full">
      <aside className="brand-panel" data-tauri-drag-region="deep">
        <Hero />
      </aside>

      <section className="dot-field flex min-h-0 flex-col px-8" onMouseMove={trackPointer} data-tauri-drag-region>
        <div className="flex h-14 shrink-0 items-center justify-end gap-2 pt-3">
          {update}
          <LanguagePicker />
        </div>

        {picking && accounts.length > 0 && twoFactor === null ? (
          <div key="pick" className="login-form">
            <div>
              <h1 className="text-[28px] font-extrabold leading-9 tracking-tight">{heading}</h1>
              {accounts.some(oneClick) && <p className="mt-1.5 text-sm text-ink-2">{t('login.pickHint')}</p>}
            </div>
            <div className="acct-cards">
              {accounts.map((a) => (
                <div key={a.user_id} className="acct-card">
                  <button type="button" className="acct-card-open" disabled={switching !== null} onClick={() => choose(a)}>
                    <Avatar name={displayName(a)} seed={a.user_id} size="lg" />
                    <span className="acct-card-text">
                      <b className="truncate">{displayName(a)}</b>
                      <span className="truncate">{a.email}</span>
                    </span>
                    {status(a)}
                    <Icon name="chevronRight" className="acct-card-go size-4" />
                  </button>
                  {onRemove && (
                    <button
                      type="button"
                      className="acct-card-remove"
                      aria-label={t('menu.removeAccount', { email: a.email })}
                      title={t('menu.removeAccount', { email: a.email })}
                      onClick={() => onRemove(a)}
                    >
                      <Icon name="close" className="size-3" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="acct-card-other"
                disabled={switching !== null}
                onClick={() => {
                  setError('');
                  setEmail('');
                  setPicking(false);
                }}
              >
                <span className="acct-card-plus">
                  <Icon name="plus" className="size-4" />
                </span>
                {t('login.otherAccount')}
              </button>
            </div>
            {error && <p className="text-sm text-[#c2410c]">{error}</p>}
            {onBack && (
              <button type="button" className="self-start text-[13px] text-ink-3 hover:text-ink" onClick={onBack}>
                {t('login.back')}
              </button>
            )}
          </div>
        ) : (
          <form key={twoFactor === null ? 'password' : 'totp'} onSubmit={submit} className="login-form" method="post">
            <h1 className="text-[28px] font-extrabold leading-9 tracking-tight">{heading}</h1>
            {twoFactor !== null && (
              <p className="text-sm text-ink-2">{t('login.twoFactorHint', { email: twoFactor || t('login.yourAccount') })}</p>
            )}

            <div className="mt-3 space-y-3">
              {twoFactor === null ? (
                <>
                  <div className="relative">
                    <input
                      className="field"
                      type="email"
                      name="email"
                      autoComplete="username"
                      placeholder={t('login.email')}
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setHover(0);
                        setSuggesting(true);
                      }}
                      onFocus={() => setSuggesting(true)}
                      onBlur={() => setSuggesting(false)}
                      onKeyDown={onEmailKey}
                      role="combobox"
                      aria-expanded={showSuggest}
                      aria-autocomplete="list"
                      required
                      autoFocus={!prefill}
                    />
                    {showSuggest && (
                      <div className="menu login-suggest" role="listbox" aria-label={t('login.saved')}>
                        <span className="login-suggest-head">
                          <Icon name="key" className="size-3.5" />
                          {t('login.saved')}
                        </span>
                        {suggestions.map((a, i) => (
                          <button
                            key={a.user_id}
                            type="button"
                            role="option"
                            aria-selected={i === hover}
                            className={`login-suggest-item ${i === hover ? 'on' : ''}`}
                            // Keep focus in the field so blur does not close the list before the click lands.
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setHover(i)}
                            onClick={() => choose(a)}
                          >
                            <Avatar name={displayName(a)} seed={a.user_id} />
                            <span className="min-w-0 flex-1">
                              <b className="block truncate">{a.email}</b>
                              <span className="block truncate">{displayName(a)}</span>
                            </span>
                            {oneClick(a) && <em>{switching === a.user_id ? t('common.wait') : t('login.oneClick')}</em>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="field-wrap">
                    <input
                      ref={passwordRef}
                      className="field pr-11"
                      type={reveal ? 'text' : 'password'}
                      name="password"
                      autoComplete="current-password"
                      placeholder={t('login.password')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus={!!prefill}
                    />
                    <button
                      type="button"
                      className="field-eye"
                      aria-label={reveal ? t('login.hidePassword') : t('login.showPassword')}
                      title={reveal ? t('login.hidePassword') : t('login.showPassword')}
                      onClick={() => setReveal((r) => !r)}
                    >
                      <Icon name={reveal ? 'eyeOff' : 'eye'} className="size-[17px]" />
                    </button>
                  </div>
                  <label className="remember" title={t('login.rememberHint')}>
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    <i aria-hidden>
                      <Icon name="check" className="size-3" />
                    </i>
                    <span>{t('login.remember')}</span>
                    <em>{t('login.rememberHint')}</em>
                  </label>
                </>
              ) : (
                <input
                  className="field text-center font-mono text-lg tracking-[0.4em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                />
              )}
            </div>

            {error && <p className="text-sm text-[#c2410c]">{error}</p>}

            <button className="btn btn-primary mt-3 h-11 w-full" disabled={busy}>
              {busy ? t('common.wait') : twoFactor === null ? t('login.submit') : t('login.verify')}
            </button>

            <div className="flex items-center justify-between">
              {twoFactor !== null ? (
                <button
                  type="button"
                  className="text-[13px] text-ink-3 hover:text-ink"
                  onClick={() => {
                    setTwoFactor(null);
                    setCode('');
                    setError('');
                  }}
                >
                  {t('login.back')}
                </button>
              ) : accounts.length > 0 ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink"
                  onClick={() => {
                    setError('');
                    setPicking(true);
                  }}
                >
                  <Icon name="chevronLeft" className="size-3.5" />
                  {t('login.pickTitle')}
                </button>
              ) : (
                <span />
              )}
              {twoFactor === null && onBack && (
                <button type="button" className="text-[13px] text-ink-3 hover:text-ink" onClick={onBack}>
                  {t('common.cancel')}
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
