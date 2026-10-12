import { useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { api, errorText, type User } from '../api';
import { Hero } from './Hero';

export function Login({ onDone, update }: { onDone: (u: User) => void; update?: ReactNode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      setError(errorText(err));
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
      <aside className="brand-panel">
        <Hero />
      </aside>

      <section className="dot-field flex min-h-0 flex-col px-8" onMouseMove={trackPointer}>
        <div className="flex h-12 shrink-0 items-center justify-end pt-2">{update}</div>
        <form key={twoFactor === null ? 'password' : 'totp'} onSubmit={submit} className="login-form">
          <h1 className="text-[28px] font-extrabold leading-9 tracking-tight">
            {twoFactor === null ? '登录 Cloudborne' : '两步验证'}
          </h1>
          {twoFactor !== null && (
            <p className="text-sm text-ink-2">输入 {twoFactor || '你的账号'} 绑定的验证器里的 6 位数字</p>
          )}

          <div className="mt-3 space-y-3">
            {twoFactor === null ? (
              <>
                <input
                  className="field"
                  type="email"
                  autoComplete="username"
                  placeholder="邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
                <input
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
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
            {busy ? '请稍候…' : twoFactor === null ? '登录' : '验证'}
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
              返回
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
