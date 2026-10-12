import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api, errorText, type ToolStatus, type User } from './api';
import { About } from './components/About';
import { AccountMenu } from './components/AccountMenu';
import { Icon } from './components/Icon';
import { Login } from './components/Login';
import { Mark } from './components/Mark';
import { TaskView } from './components/TaskView';
import { ToolCard } from './components/ToolCard';
import { UpdateButton } from './components/UpdateButton';
import { useI18n } from './i18n';
import { useUpdater } from './update';
import { useAgent } from './useAgent';

const usd = (n: number) => `$${n.toFixed(2)}`;

type View = 'home' | 'task';

export function App() {
  const { t, lang } = useI18n();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [toast, setToast] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [about, setAbout] = useState(false);
  const [view, setView] = useState<View>('home');
  const updater = useUpdater();
  const agent = useAgent(lang, !!user);

  const loadTools = useCallback(async () => {
    setTools(await api.toolsStatus());
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [u] = await Promise.all([api.me(), loadTools()]);
      setUser(u);
    } catch (e) {
      setToast(errorText(e, t('common.genericError')));
    } finally {
      setRefreshing(false);
    }
  }, [loadTools, t]);

  useEffect(() => {
    // Once on launch; switching language must not refetch.
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  if (user === undefined) return <div className="h-full" data-tauri-drag-region />;
  if (user === null)
    return (
      <Login
        update={<UpdateButton updater={updater} />}
        onDone={(u) => {
          setUser(u);
          loadTools();
        }}
      />
    );

  return (
    <div className="workspace">
      <div className="drag-strip" data-tauri-drag-region />

      <aside className="sidebar">
        <div className="sidebar-brand" data-tauri-drag-region>
          <Mark className="h-[18px]" />
          <span>Cloudborne</span>
        </div>
        <nav className="grid gap-0.5" aria-label={t('nav.main')}>
          <button
            className={`nav-item ${view === 'task' && !agent.currentId ? 'selected' : ''}`}
            onClick={() => {
              agent.select(null);
              setView('task');
            }}
          >
            <Icon name="newTask" className="size-[17px]" />
            {t('nav.newTask')}
          </button>
          <button className={`nav-item ${view === 'home' ? 'selected' : ''}`} onClick={() => setView('home')}>
            <Icon name="home" className="size-[17px]" />
            {t('nav.home')}
          </button>
        </nav>
        {agent.summaries.length > 0 && (
          <div className="recent">
            <b>{t('nav.recent')}</b>
            {agent.summaries.map((s) => (
              <div key={s.id} className={`recent-item ${view === 'task' && agent.currentId === s.id ? 'selected' : ''}`}>
                <button
                  className="recent-open"
                  onClick={() => {
                    agent.select(s.id);
                    setView('task');
                  }}
                >
                  {agent.isRunning(s.id) && <span className="recent-live" />}
                  <span className="truncate">{s.title || t('agent.untitled')}</span>
                </button>
                <button className="recent-delete" aria-label={t('agent.delete')} title={t('agent.delete')} onClick={() => agent.remove(s.id)}>
                  <Icon name="trash" className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="sidebar-footer">
          <AccountMenu
            user={user}
            updater={updater}
            onAbout={() => setAbout(true)}
            onLogout={async () => {
              await api.logout();
              setUser(null);
            }}
          />
        </div>
      </aside>

      <main className={`main-pane ${view === 'task' && agent.current?.turns.length ? 'in-session' : ''}`}>
        <div className="aurora-header" aria-hidden />
        {view === 'task' ? (
          <TaskView
            key={agent.currentId ?? 'new'}
            agent={agent}
            onSignIn={async () => {
              await api.logout();
              setUser(null);
            }}
          />
        ) : (
          <div className="main-scroll">
            <div className="main-column">
              <div className="balance-row rise" style={{ '--i': 0 } as CSSProperties}>
                <div className="wallet">
                  <span className="wallet-label">{t('home.balance')}</span>
                  <span className="wallet-amount">{usd(user.balance)}</span>
                  <button
                    className="wallet-refresh"
                    title={t('home.refresh')}
                    aria-label={t('home.refresh')}
                    disabled={refreshing}
                    onClick={refresh}
                  >
                    <Icon name="refresh" className={`size-[15px] ${refreshing ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <UpdateButton updater={updater} />
              </div>

              <div className="rise mb-2.5 mt-7 flex items-baseline justify-between px-1" style={{ '--i': 1 } as CSSProperties}>
                <h2 className="text-[15px] font-semibold">{t('home.connect')}</h2>
                <button className="text-[13px] text-ink-3 transition-colors hover:text-ink" onClick={loadTools}>
                  {t('home.recheck')}
                </button>
              </div>
              <div className="grid gap-2.5">
                {tools.map((tool, i) => (
                  <ToolCard
                    key={tool.id}
                    index={i + 2}
                    tool={tool}
                    onChanged={(msg) => {
                      setToast(msg);
                      loadTools();
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
          <div key={toast} className="toast toast-in">
            {toast}
          </div>
        </div>
      )}

      {about && <About version={updater.current} onClose={() => setAbout(false)} />}
    </div>
  );
}
