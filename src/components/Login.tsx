import { useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { api, errorText, type SavedAccount, type User } from '../api';
import { useI18n } from '../i18n';
import { Avatar } from './AccountMenu';
import { Hero } from './Hero';
import { Icon } from './Icon';
import { LanguagePicker } from './LanguagePicker';

/**
 * Sign-in page. Saved accounts are offered above the form: a signed-in one
 * switches straight away, a signed-out one fills in its email. `onBack` is set
 * when an account is already signed in (adding another one).
 */
export function Login({
  onDone,
  update,
  accounts = [],
  prefill = '',
  onSwitch,
  onRemove,
  onBack,
}: {
  onDone: (u: User) => void;
  update?: ReactNode;
  accounts?: SavedAccount[];
  prefill?: string;
  onSwitch?: (a: SavedAccount) => Promise<void>;
  onRemove?: (a: SavedAccount) => void;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState(prefill);
  const [password, setPassword] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);
  const [switching, setSwitching] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [twoFactor, setTwoFactor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = twoFactor === null ? await api.login(email, password) : await api.login2fa(code);
      if (r.kind === 'done') onDone(r.user);
      else setTwoFactor(r.email_masked);
    } catch (err) {
      setError(errorText(err, t('common.genericError')));
    } finally {
      setBusy(false);
    }
  }

  function trackPointer(e: MouseEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  }

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
        <form key={twoFactor === null ? 'password' : 'totp'} onSubmit={submit} className="login-form">
          <h1 className="text-[28px] font-extrabold leading-9 tracking-tight">
            {twoFactor !== null ? t('login.twoFactor') : onBack && !prefill ? t('login.addTitle') : t('login.title')}
          </h1>
          {twoFactor === null && accounts.length > 0 && (
            <div className="login-accounts">
              <span>{t('login.pick')}</span>
              {accounts.map((a) => (
                <div key={a.user_id} className={`login-account ${a.email === email ? 'on' : ''}`}>
                  <button
                    type="button"
                    className="login-account-open"
                    disabled={switching !== null}
                    onClick={async () => {
                      setError('');
                      if (a.signed_in && onSwitch) {
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
                      setEmail(a.email);
                      setPassword('');
                      passwordRef.current?.focus();
                    }}
                  >
                    <Avatar email={a.email} />
                    <span className="min-w-0 flex-1 truncate">{a.email}</span>
                    <em>{switching === a.user_id ? t('common.wait') : a.signed_in ? t('login.signedIn') : t('login.needsPassword')}</em>
                  </button>
                  {onRemove && (
                    <button
                      type="button"
                      className="login-account-remove"
                      aria-label={t('menu.removeAccount', { email: a.email })}
                      title={t('menu.removeAccount', { email: a.email })}
                      onClick={() => onRemove(a)}
                    >
                      <Icon name="close" className="size-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {twoFactor !== null && (
            <p className="text-sm text-ink-2">{t('login.twoFactorHint', { email: twoFactor || t('login.yourAccount') })}</p>
          )}

          <div className="mt-3 space-y-3">
            {twoFactor === null ? (
              <>
                <input
                  className="field"
                  type="email"
                  autoComplete="username"
                  placeholder={t('login.email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus={!prefill}
                />
                <input
                  ref={passwordRef}
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  placeholder={t('login.password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus={!!prefill}
                />
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

          {twoFactor !== null && (
            <button
              type="button"
              className="self-start text-[13px] text-ink-3 hover:text-ink"
              onClick={() => {
                setTwoFactor(null);
                setCode('');
                setError('');
              }}
            >
              {t('login.back')}
            </button>
          )}
          {twoFactor === null && onBack && (
            <button type="button" className="self-start text-[13px] text-ink-3 hover:text-ink" onClick={onBack}>
              {t('login.back')}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
