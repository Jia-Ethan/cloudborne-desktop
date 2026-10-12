import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api, errorText, type ToolStatus, type User } from './api';
import { Login } from './components/Login';
import { Mark } from './components/Mark';
import { ToolCard } from './components/ToolCard';

const usd = (n: number) => `$${n.toFixed(2)}`;

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [toast, setToast] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadTools = useCallback(async () => {
    setTools(await api.toolsStatus());
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [u] = await Promise.all([api.me(), loadTools()]);
      setUser(u);
    } catch (e) {
      setToast(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }, [loadTools]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  if (user === undefined) return <div className="dawn h-full" />;
  if (user === null)
    return (
      <Login
        onDone={(u) => {
          setUser(u);
          loadTools();
        }}
      />
    );

  return (
    <div className="dawn flex h-full flex-col overflow-hidden">
      <header className="rise flex items-center gap-3 px-8 pt-7">
        <Mark className="h-7" />
        <span className="text-[17px] font-semibold tracking-tight">Cloudborne</span>
        <span className="text-[13px] text-ink-3">栖云</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="max-w-[220px] truncate text-[13px] text-ink-2">{user.email}</span>
          <button
            className="btn btn-quiet h-8 px-3 text-[13px]"
            onClick={async () => {
              await api.logout();
              setUser(null);
            }}
          >
            退出
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 pb-8 pt-6">
        <section className="card rise flex items-center gap-4 px-6 py-5" style={{ '--i': 1 } as CSSProperties}>
          <div>
            <p className="text-[13px] text-ink-3">钱包余额</p>
            <p className="mt-0.5 text-[28px] font-semibold tracking-tight tabular-nums">{usd(user.balance)}</p>
          </div>
          <button
            className="btn btn-quiet ml-2 size-9 p-0"
            title="刷新"
            disabled={refreshing}
            onClick={refresh}
            aria-label="刷新余额和工具状态"
          >
            <svg viewBox="0 0 20 20" className={`size-4 ${refreshing ? 'animate-spin' : ''}`} fill="none">
              <path
                d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 3.5v3.4h-3.4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </section>

        <div className="rise mb-3 mt-8 flex items-baseline justify-between" style={{ '--i': 2 } as CSSProperties}>
          <h2 className="text-[15px] font-semibold">一键接入</h2>
          <button className="text-[13px] text-ink-3 hover:text-ink" onClick={loadTools}>
            重新检测
          </button>
        </div>
        <div className="space-y-3">
          {tools.map((t, i) => (
            <ToolCard
              key={t.id}
              index={i + 3}
              tool={t}
              onChanged={(msg) => {
                setToast(msg);
                loadTools();
              }}
            />
          ))}
        </div>
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center px-6">
          <div key={toast} className="card toast-in max-w-[560px] px-4 py-2.5 text-[13px] shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
