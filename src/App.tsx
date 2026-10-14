import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, errorText, isAdmin, type LotteryStatus, type Rates, type SavedAccount, type ToolStatus, type User } from './api';
import { About } from './components/About';
import { AccountMenu } from './components/AccountMenu';
import { DiscountBar } from './components/DiscountBar';
import { Icon } from './components/Icon';
import { Login } from './components/Login';
import { Mark } from './components/Mark';
import { TaskView } from './components/TaskView';
import { ToolCard } from './components/ToolCard';
import { UpdateButton } from './components/UpdateButton';
import { UsageView } from './components/UsageView';
import { KeysView } from './components/KeysView';
import { StatusView } from './components/StatusView';
import { LotteryView } from './components/LotteryView';
import { DdzView } from './components/DdzView';
import { RedeemView } from './components/RedeemView';
import { AdminOverview } from './components/AdminOverview';
import { AdminUsers } from './components/AdminUsers';
import { AdminLottery } from './components/AdminLottery';
import { AdminDdz } from './components/AdminDdz';
import { useI18n } from './i18n';
import { useUpdater } from './update';
import { useAgent } from './useAgent';
import { useDdz } from './useDdz';

const usd = (n: number) => `$${n.toFixed(2)}`;

type View = 'home' | 'task' | 'usage' | 'lottery' | 'ddz' | 'redeem' | 'keys' | 'status' | 'admin' | 'adminUsers' | 'adminLottery' | 'adminDdz';

export function App() {
  const { t, lang } = useI18n();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [rates, setRates] = useState<Rates | null>(null);
  const [toast, setToast] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [about, setAbout] = useState(false);
  const [view, setView] = useState<View>('home');
  // Shown only once the relay says the chest event is on.
  const [lotteryOn, setLotteryOn] = useState(false);
  const [chests, setChests] = useState(0);
  // Shown only once the relay says the tables are open.
  const [ddzOn, setDdzOn] = useState(false);
  const [userFocus, setUserFocus] = useState<{ id: number; email: string } | null>(null);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  // The login page over a signed-in account (adding one, or one that needs its password again).
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState('');
  // How the login page opens: straight on the form, on a 2FA code, with a message.
  const [loginOpts, setLoginOpts] = useState<{ form?: boolean; twoFactor?: string; notice?: string }>({});
  const updater = useUpdater();
  const agent = useAgent(lang, user?.id ?? null);

  const loadTools = useCallback(async () => {
    setTools(await api.toolsStatus());
  }, []);

  const loadRates = useCallback(() => {
    api.rates().then(setRates, () => {});
  }, []);

  const loadAccounts = useCallback(() => {
    api.accounts().then(setAccounts, () => {});
  }, []);

  const lotteryStatus = useCallback((s: LotteryStatus) => {
    setLotteryOn(s.enabled);
    setChests(s.enabled ? s.chests : 0);
    if (!s.enabled) setView((v) => (v === 'lottery' ? 'home' : v));
  }, []);
  // Bumped on every account change, so a reply for the previous account is dropped.
  const gen = useRef(0);
  const checkLottery = useCallback(() => {
    const g = gen.current;
    api.lottery().then(
      (s) => g === gen.current && lotteryStatus(s),
      () => g === gen.current && setLotteryOn(false),
    );
  }, [lotteryStatus]);
  const checkDdz = useCallback(() => {
    const g = gen.current;
    api.ddzStatus().then(
      (s) => g === gen.current && setDdzOn(s.enabled),
      () => g === gen.current && setDdzOn(false),
    );
  }, []);

  /** Shows `u` (or the login page) with nothing left over from the previous account. */
  const enter = useCallback(
    (u: User | null) => {
      gen.current++;
      setUser(u);
      setView('home');
      setUserFocus(null);
      setLotteryOn(false);
      setChests(0);
      setDdzOn(false);
      setRates(null);
      setAdding(false);
      setPrefill('');
      setLoginOpts({});
      if (u) {
        loadTools().catch(() => {});
        loadRates();
        checkLottery();
        checkDdz();
      }
      loadAccounts();
    },
    [loadTools, loadRates, loadAccounts, checkLottery, checkDdz],
  );

  /** Rejects on network and relay errors; the caller shows them where the user is looking. */
  const switchTo = useCallback(
    async (a: SavedAccount) => {
      if (!a.signed_in && !a.has_password) {
        setPrefill(a.email);
        setLoginOpts({});
        setAdding(true);
        return;
      }
      // A signed-out account with a remembered password signs in with it on the Rust side.
      const r = await api.switchAccount(a.user_id);
      if (r.kind === 'done') enter(r.user);
      else if (r.kind === 'two_factor') {
        setPrefill(a.email);
        setLoginOpts({ twoFactor: r.email_masked });
        setAdding(true);
      } else {
        // Its session ended (or its remembered password was changed); sign in again with the email filled in.
        setPrefill(r.email);
        setLoginOpts(a.has_password ? { notice: t('login.passwordChanged', { email: r.email }) } : {});
        setAdding(true);
        loadAccounts();
      }
    },
    [enter, loadAccounts, t],
  );

  const removeAccount = useCallback(
    async (a: SavedAccount) => {
      try {
        const next = await api.removeAccount(a.user_id);
        // Removing someone else leaves the current account as it is.
        if (a.active) enter(next);
        else loadAccounts();
      } catch (e) {
        setToast(errorText(e, t('common.genericError')));
      }
    },
    [enter, loadAccounts, t],
  );

  const addAccount = useCallback(() => {
    api.addAccountBegin().then(setAccounts, () => {});
    setPrefill('');
    setLoginOpts({ form: true });
    setAdding(true);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [u] = await Promise.all([api.me(), loadTools()]);
      if (u?.id !== user?.id) {
        // The session ended (or changed) underneath us.
        enter(u);
        return;
      }
      setUser(u);
      if (u) {
        loadRates();
        checkLottery();
      }
    } catch (e) {
      setToast(errorText(e, t('common.genericError')));
    } finally {
      setRefreshing(false);
    }
  }, [loadTools, loadRates, checkLottery, enter, user?.id, t]);

  useEffect(() => {
    // Once on launch; switching language must not refetch. Right after an
    // update restarts the app the network can be briefly down; a failed check
    // is retried rather than shown as signed out.
    let stop = false;
    (async () => {
      for (let wait = 1000; !stop; wait = Math.min(wait * 2, 15000)) {
        try {
          const u = await api.me();
          // After me(): a v0.8 session is named by then. Read before the login
          // page mounts, so it opens on the account picker.
          const list = await api.accounts().catch(() => [] as SavedAccount[]);
          if (stop) return;
          setAccounts(list);
          // An active account that was signed out (and has no remembered
          // password) gets its email filled in on the login page.
          const lapsed = !u && list.find((a) => a.active && !a.signed_in && !a.has_password);
          if (lapsed) setPrefill(lapsed.email);
          setUser(u);
          if (u) {
            loadRates();
            checkLottery();
          }
          return;
        } catch {
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    })();
    loadTools().catch(() => {});
    return () => {
      stop = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const uid = user?.id;

  // Opening or buying chests changes the balance; the rest of the app reads it from `user`.
  const refetchMe = useCallback(() => {
    api.me().then((u) => u && u.id === uid && setUser(u), () => {});
  }, [uid]);
  const ddz = useDdz(uid ?? null, view === 'ddz', setToast, refetchMe);
  const openUser = useCallback((u: { id: number; email: string }) => {
    setUserFocus(u);
    setView('adminUsers');
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  if (user === undefined) return <div className="h-full" data-tauri-drag-region />;
  if (user === null || adding)
    return (
      <Login
        key={`${prefill}|${loginOpts.twoFactor ?? ''}|${loginOpts.notice ?? ''}|${loginOpts.form ? 1 : 0}`}
        update={<UpdateButton updater={updater} />}
        // While adding, the current account is not offered; it is what 返回 goes back to.
        accounts={accounts.filter((a) => !(user && a.user_id === user.id))}
        prefill={prefill}
        form={loginOpts.form}
        twoFactorFor={loginOpts.twoFactor ?? null}
        notice={loginOpts.notice}
        onSwitch={switchTo}
        onRemove={removeAccount}
        onBack={
          user
            ? () => {
                setAdding(false);
                setPrefill('');
                setLoginOpts({});
              }
            : undefined
        }
        onDone={enter}
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
          <button className={`nav-item ${view === 'usage' ? 'selected' : ''}`} onClick={() => setView('usage')}>
            <Icon name="chart" className="size-[17px]" />
            {t('nav.usage')}
          </button>
          {lotteryOn && (
            <button className={`nav-item ${view === 'lottery' ? 'selected' : ''}`} onClick={() => setView('lottery')}>
              <Icon name="gift" className="size-[17px]" />
              {t('nav.lottery')}
              {chests > 0 && (
                <span className="nav-badge" aria-label={t('lottery.myChests', { n: chests })}>
                  {chests > 99 ? '99+' : chests}
                </span>
              )}
            </button>
          )}
          {(ddzOn || ddz.table) && (
            <button className={`nav-item ${view === 'ddz' ? 'selected' : ''}`} onClick={() => setView('ddz')}>
              <Icon name="spade" className="size-[17px]" />
              {t('nav.ddz')}
              {ddz.table && view !== 'ddz' && <span className="nav-badge nav-badge-dot" aria-label={t('ddz.inGame')} />}
            </button>
          )}
          <button className={`nav-item ${view === 'redeem' ? 'selected' : ''}`} onClick={() => setView('redeem')}>
            <Icon name="ticket" className="size-[17px]" />
            {t('nav.redeem')}
          </button>
          <button className={`nav-item ${view === 'keys' ? 'selected' : ''}`} onClick={() => setView('keys')}>
            <Icon name="key" className="size-[17px]" />
            {t('nav.keys')}
          </button>
          <button className={`nav-item ${view === 'status' ? 'selected' : ''}`} onClick={() => setView('status')}>
            <Icon name="pulse" className="size-[17px]" />
            {t('nav.status')}
          </button>
        </nav>
        {isAdmin(user) && (
          <nav className="nav-group" aria-label={t('nav.admin')}>
            <b>{t('nav.admin')}</b>
            <button className={`nav-item ${view === 'admin' ? 'selected' : ''}`} onClick={() => setView('admin')}>
              <Icon name="gauge" className="size-[17px]" />
              {t('nav.adminOverview')}
            </button>
            <button
              className={`nav-item ${view === 'adminUsers' ? 'selected' : ''}`}
              onClick={() => {
                setUserFocus(null);
                setView('adminUsers');
              }}
            >
              <Icon name="users" className="size-[17px]" />
              {t('nav.adminUsers')}
            </button>
            <button className={`nav-item ${view === 'adminLottery' ? 'selected' : ''}`} onClick={() => setView('adminLottery')}>
              <Icon name="dice" className="size-[17px]" />
              {t('nav.adminLottery')}
            </button>
            <button className={`nav-item ${view === 'adminDdz' ? 'selected' : ''}`} onClick={() => setView('adminDdz')}>
              <Icon name="spade" className="size-[17px]" />
              {t('nav.adminDdz')}
            </button>
          </nav>
        )}
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
            accounts={accounts}
            updater={updater}
            onAbout={() => setAbout(true)}
            onSwitch={(a) => switchTo(a).catch((e) => setToast(errorText(e, t('common.genericError'))))}
            onRemove={removeAccount}
            onAdd={addAccount}
            onLogout={async () => {
              // The account stays saved. The next signed-in account takes over; none left means the login page.
              const next = await api.logout().catch(() => null);
              setAccounts(await api.accounts().catch(() => accounts));
              enter(next);
            }}
          />
        </div>
      </aside>

      {/* Keyed by account so every page's state and caches start fresh after a switch. */}
      <main key={user.id} className={`main-pane ${view === 'task' && agent.current?.turns.length ? 'in-session' : ''}`}>
        <div className="aurora-header" aria-hidden />
        {view === 'task' ? (
          <TaskView
            key={agent.currentId ?? 'new'}
            agent={agent}
            onSignIn={() => {
              // Sign this account in again; it stays in the list.
              setPrefill(user.email);
              setLoginOpts({});
              setAdding(true);
            }}
          />
        ) : view === 'usage' ? (
          <UsageView />
        ) : view === 'keys' ? (
          <KeysView onToast={setToast} />
        ) : view === 'status' ? (
          <StatusView />
        ) : view === 'redeem' ? (
          <RedeemView balance={user.balance} onRedeemed={refetchMe} />
        ) : view === 'lottery' ? (
          <LotteryView balance={user.balance} onBalance={refetchMe} onStatus={lotteryStatus} />
        ) : view === 'ddz' ? (
          <DdzView balance={user.balance} table={ddz.table} conn={ddz.conn} send={ddz.send} />
        ) : view === 'admin' && isAdmin(user) ? (
          <AdminOverview onOpenUser={openUser} onOpenLottery={() => setView('adminLottery')} />
        ) : view === 'adminUsers' && isAdmin(user) ? (
          <AdminUsers key={userFocus?.id ?? 'all'} focus={userFocus} onToast={setToast} />
        ) : view === 'adminLottery' && isAdmin(user) ? (
          <AdminLottery onOpenUser={openUser} onToast={setToast} />
        ) : view === 'adminDdz' && isAdmin(user) ? (
          <AdminDdz onOpenUser={openUser} onToast={setToast} />
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
                <div className="flex items-center gap-3">
                  <UpdateButton updater={updater} />
                  <DiscountBar rates={rates} />
                </div>
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
