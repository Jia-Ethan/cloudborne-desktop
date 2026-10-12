import { useState, type FormEvent } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api, errorText, type User } from '../api';
import { Mark } from './Mark';

export function Login({ origin, onDone }: { origin: string; onDone: (u: User) => void }) {
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

  return (
    <div className="dawn flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-[380px] p-8 shadow-[0_24px_60px_-30px_rgb(80_40_20/0.35)]">
        <Mark className="h-8" />
        <h1 className="mt-6 text-[22px] font-semibold tracking-tight">
          {twoFactor === null ? '登录 Cloudborne' : '两步验证'}
        </h1>
        <p className="mt-1.5 text-sm text-ink-2">
          {twoFactor === null
            ? '使用中转站账号登录'
            : `输入 ${twoFactor || '你的账号'} 绑定的验证器里的 6 位数字`}
        </p>

        <div className="mt-7 space-y-3">
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

        {error && <p className="mt-3 text-sm text-[#c2410c]">{error}</p>}

        <button className="btn btn-primary mt-6 w-full" disabled={busy}>
          {busy ? '请稍候…' : twoFactor === null ? '登录' : '验证'}
        </button>

        <div className="mt-5 flex justify-between text-[13px] text-ink-3">
          {twoFactor === null ? (
            <>
              <button type="button" className="hover:text-ink" onClick={() => openUrl(`${origin}/register`)}>
                注册账号
              </button>
              <button type="button" className="hover:text-ink" onClick={() => openUrl(`${origin}/forgot-password`)}>
                忘记密码
              </button>
            </>
          ) : (
            <button
              type="button"
              className="hover:text-ink"
              onClick={() => {
                setTwoFactor(null);
                setCode('');
                setError('');
              }}
            >
              返回
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
