//! Login session. Requests that come back 401 refresh the access token once
//! and retry. Several accounts can be saved; requests go out as the active
//! one, and each account refreshes and signs out on its own (`accounts.rs`).
//!
//! Where the tokens and the device ID are kept:
//! - macOS: an owner-only file in the app's data folder. The app is signed
//!   ad hoc, so every update has a new code hash, and Keychain asks for the
//!   login password before it lets the new build read items the old build
//!   wrote. Users saw that prompt after every update.
//! - Windows and Linux: the OS credential store, which never prompts.

use std::future::Future;
#[cfg(any(target_os = "macos", test))]
use std::path::PathBuf;

use serde::Serialize;
use tokio::sync::Mutex;

use crate::accounts::{self, AccountInfo, Accounts};
use crate::api::{admin_origin, Client, Tokens, User, DEFAULT_ORIGIN};
use crate::error::{Error, Result};

const DEVICE: &str = "device";

/// Named secrets: tokens, the account list and the device ID.
pub trait Store: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<String>>;
    fn set(&self, name: &str, value: &str) -> Result<()>;
    fn delete(&self, name: &str) -> Result<()>;
}

/// One owner-only file per name. The macOS store, and the one tests use.
#[cfg(any(target_os = "macos", test))]
pub struct FileStore {
    dir: PathBuf,
}

#[cfg(any(target_os = "macos", test))]
impl FileStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{name}.secret"))
    }
}

#[cfg(any(target_os = "macos", test))]
impl Store for FileStore {
    fn get(&self, name: &str) -> Result<Option<String>> {
        let s = crate::fsx::read_or_empty(&self.path(name))?;
        Ok((!s.is_empty()).then_some(s))
    }

    fn set(&self, name: &str, value: &str) -> Result<()> {
        crate::fsx::write_private(&self.path(name), value)
    }

    fn delete(&self, name: &str) -> Result<()> {
        let p = self.path(name);
        match std::fs::remove_file(&p) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(Error::io(&p, e)),
        }
    }
}

#[cfg(target_os = "macos")]
fn os_store() -> Box<dyn Store> {
    let base = dirs::data_dir().unwrap_or_else(|| crate::tools::home_dir().join(".cloudborne-desktop"));
    // Debug builds keep their own files so they never sign the installed app out.
    let app = if cfg!(debug_assertions) { "cn.cloudborne.desktop.dev" } else { "cn.cloudborne.desktop" };
    Box::new(FileStore::new(base.join(app)))
}

// Debug builds keep their own entries so they never touch the installed app's session.
#[cfg(not(target_os = "macos"))]
const SERVICE: &str = if cfg!(debug_assertions) { "cn.cloudborne.desktop.dev" } else { "cn.cloudborne.desktop" };

#[cfg(not(target_os = "macos"))]
struct KeyringStore;

#[cfg(not(target_os = "macos"))]
impl KeyringStore {
    fn entry(name: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, name).map_err(|e| Error::Keychain(e.to_string()))
    }
}

#[cfg(not(target_os = "macos"))]
impl Store for KeyringStore {
    fn get(&self, name: &str) -> Result<Option<String>> {
        match Self::entry(name)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Error::Keychain(e.to_string())),
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<()> {
        Self::entry(name)?.set_password(value).map_err(|e| Error::Keychain(e.to_string()))
    }

    fn delete(&self, name: &str) -> Result<()> {
        match Self::entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Error::Keychain(e.to_string())),
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn os_store() -> Box<dyn Store> {
    Box::new(KeyringStore)
}

/// Random per-install ID, stored next to the session. The relay binds
/// sessions to it, so a changed ID signs every account out. It is the same for
/// all accounts. If it cannot be read, a one-off ID is used for this run and
/// the stored one is left alone.
fn device_id(store: &dyn Store) -> String {
    match store.get(DEVICE) {
        Ok(Some(id)) if uuid::Uuid::parse_str(&id).is_ok() => id,
        Ok(_) => {
            let id = uuid::Uuid::new_v4().to_string();
            let _ = store.set(DEVICE, &id);
            id
        }
        Err(_) => uuid::Uuid::new_v4().to_string(),
    }
}

/// Where switching to a saved account ended up.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SwitchOutcome {
    Done { user: User },
    /// The account needs its password again; the previous one stays active.
    SignedOut { email: String },
}

pub struct Session {
    pub client: Client,
    store: Box<dyn Store>,
    accounts: Mutex<Accounts>,
    /// Pending 2FA login token between the two login steps.
    pub pending_2fa: Mutex<Option<String>>,
}

impl Session {
    pub fn new() -> Result<Self> {
        let custom = std::env::var("CLOUDBORNE_ORIGIN").ok();
        let origin = custom.clone().unwrap_or_else(|| DEFAULT_ORIGIN.to_string());
        let admin = admin_origin(custom.as_deref());
        let store = os_store();
        Ok(Self {
            client: Client::new(&origin, &admin, &device_id(store.as_ref()))?,
            accounts: Mutex::new(Accounts::load(store.as_ref())),
            store,
            pending_2fa: Mutex::new(None),
        })
    }

    fn save_index(&self, a: &Accounts) {
        // The tokens are what matter; a stale list only costs a re-login later.
        let _ = a.save_index(self.store.as_ref());
    }

    /// The active account's id, when it is signed in.
    pub async fn active(&self) -> Option<i64> {
        self.accounts.lock().await.active_signed_in()
    }

    pub async fn is_logged_in(&self) -> bool {
        self.active().await.is_some()
    }

    pub async fn list(&self) -> Vec<AccountInfo> {
        self.accounts.lock().await.list()
    }

    /// A finished login: saves the account and makes it active.
    pub async fn add(&self, user: &User, t: Tokens) -> Result<()> {
        accounts::save_tokens(self.store.as_ref(), user.id, &t)?;
        let mut a = self.accounts.lock().await;
        a.upsert(user.id, &user.email, t);
        self.save_index(&a);
        Ok(())
    }

    /// Fills in who account `id` is from its profile. A v0.8 session moves
    /// to its own entry here.
    async fn identify(&self, id: i64, user: &User) {
        let mut a = self.accounts.lock().await;
        if !a.identify(id, user.id, &user.email) {
            return;
        }
        if id != user.id {
            let Some(t) = a.tokens(user.id).cloned() else { return };
            if accounts::save_tokens(self.store.as_ref(), user.id, &t).is_err() {
                // Keep the old entry; the move is tried again next launch.
                return;
            }
            let _ = accounts::delete_tokens(self.store.as_ref(), id);
        }
        self.save_index(&a);
    }

    /// The account's profile, refreshing its token if needed.
    pub async fn profile(&self, id: i64) -> Result<User> {
        let c = &self.client;
        let u = self.authed_as(id, |a| async move { c.profile(&a).await }).await?;
        self.identify(id, &u).await;
        Ok(u)
    }

    /// Makes a saved account active. One whose token the relay turns down is
    /// marked signed out and the previous account stays active.
    pub async fn switch(&self, user_id: i64) -> Result<SwitchOutcome> {
        let prev = {
            let mut a = self.accounts.lock().await;
            let acc = a.get(user_id).ok_or_else(|| Error::Other(crate::lang::tr("找不到这个账号", "Account not found").into()))?;
            if acc.tokens.is_none() {
                return Ok(SwitchOutcome::SignedOut { email: acc.email.clone() });
            }
            let prev = a.active.replace(user_id);
            self.save_index(&a);
            prev
        };
        *self.pending_2fa.lock().await = None;
        match self.profile(user_id).await {
            Ok(user) => Ok(SwitchOutcome::Done { user }),
            Err(e) => {
                let mut a = self.accounts.lock().await;
                if a.active == Some(user_id) {
                    a.active = prev;
                    self.save_index(&a);
                }
                match e {
                    Error::Unauthorized => {
                        Ok(SwitchOutcome::SignedOut { email: a.get(user_id).map(|x| x.email.clone()).unwrap_or_default() })
                    }
                    e => Err(e),
                }
            }
        }
    }

    /// Signs an account out on the relay and forgets it. Removing the active
    /// account hands over to the next signed-in one; returns the new active id.
    pub async fn remove(&self, user_id: i64) -> Result<Option<i64>> {
        let gone = {
            let mut a = self.accounts.lock().await;
            let gone = a.remove(user_id);
            self.save_index(&a);
            gone
        };
        if let Some(t) = gone.and_then(|g| g.tokens) {
            self.client.logout(t.refresh_token.as_deref()).await;
        }
        accounts::delete_tokens(self.store.as_ref(), user_id)?;
        Ok(self.accounts.lock().await.active_signed_in())
    }

    /// Signs the active account out and forgets it.
    pub async fn logout(&self) -> Result<Option<i64>> {
        let id = self.accounts.lock().await.active;
        match id {
            Some(id) => self.remove(id).await,
            None => Ok(None),
        }
    }

    async fn access(&self, id: i64) -> Result<String> {
        self.accounts.lock().await.tokens(id).map(|t| t.access_token.clone()).ok_or(Error::Unauthorized)
    }

    /// Exchanges account `id`'s refresh token for a new pair. `stale` is the
    /// access token that just got a 401: if another request has already
    /// replaced it, that one's result is used rather than rotating again.
    async fn refresh(&self, id: i64, stale: &str) -> Result<String> {
        let mut guard = self.accounts.lock().await;
        let cur = guard.tokens(id).ok_or(Error::Unauthorized)?;
        if cur.access_token != stale {
            return Ok(cur.access_token.clone());
        }
        let rt = cur.refresh_token.clone().ok_or(Error::Unauthorized)?;
        match self.client.refresh(&rt).await {
            Ok(mut t) => {
                if t.refresh_token.is_none() {
                    t.refresh_token = Some(rt);
                }
                // The relay has already retired the old token, so the new pair
                // is kept in memory even if saving it fails.
                let a = t.access_token.clone();
                let saved = accounts::save_tokens(self.store.as_ref(), id, &t);
                guard.set_tokens(id, t);
                saved.map(|()| a)
            }
            // A rejected refresh token ends this account's session; a network error does not.
            Err(Error::Unauthorized) => {
                // Another copy of the app may have rotated the token and saved
                // the new pair; pick that up instead of signing out.
                if let Ok(Some(t)) = accounts::load_tokens(self.store.as_ref(), id) {
                    if t.refresh_token.as_deref() != Some(rt.as_str()) {
                        let a = t.access_token.clone();
                        guard.set_tokens(id, t);
                        return Ok(a);
                    }
                }
                guard.sign_out(id);
                let _ = accounts::delete_tokens(self.store.as_ref(), id);
                self.save_index(&guard);
                Err(Error::Unauthorized)
            }
            Err(e) => Err(e),
        }
    }

    /// Runs `f` with account `id`'s access token, refreshing once on 401.
    async fn authed_as<T, F, Fut>(&self, id: i64, f: F) -> Result<T>
    where
        F: Fn(String) -> Fut,
        Fut: Future<Output = Result<T>>,
    {
        let a = self.access(id).await?;
        match f(a.clone()).await {
            Err(Error::Unauthorized) => {
                let a = self.refresh(id, &a).await?;
                f(a).await
            }
            other => other,
        }
    }

    /// Runs `f` as the active account, refreshing once on 401.
    pub async fn authed<T, F, Fut>(&self, f: F) -> Result<T>
    where
        F: Fn(String) -> Fut,
        Fut: Future<Output = Result<T>>,
    {
        let id = self.active().await.ok_or(Error::Unauthorized)?;
        self.authed_as(id, f).await
    }
}
