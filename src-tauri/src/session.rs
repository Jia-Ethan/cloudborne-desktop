//! Login session. Requests that come back 401 refresh the access token once
//! and retry.
//!
//! Where the tokens and the device ID are kept:
//! - macOS: an owner-only file in the app's data folder. The app is signed
//!   ad hoc, so every update has a new code hash, and Keychain asks for the
//!   login password before it lets the new build read items the old build
//!   wrote. Users saw that prompt after every update.
//! - Windows and Linux: the OS credential store, which never prompts.

use std::future::Future;

use tokio::sync::Mutex;

use crate::api::{admin_origin, Client, Tokens, DEFAULT_ORIGIN};
use crate::error::{Error, Result};

const ACCOUNT: &str = "session";
const DEVICE: &str = "device";

#[cfg(target_os = "macos")]
mod store {
    use std::path::PathBuf;

    use crate::error::{Error, Result};
    use crate::fsx;

    fn path(name: &str) -> PathBuf {
        let base = dirs::data_dir().unwrap_or_else(|| crate::tools::home_dir().join(".cloudborne-desktop"));
        // Debug builds keep their own files so they never sign the installed app out.
        let app = if cfg!(debug_assertions) { "cn.cloudborne.desktop.dev" } else { "cn.cloudborne.desktop" };
        base.join(app).join(format!("{name}.secret"))
    }

    pub fn get(name: &str) -> Result<Option<String>> {
        let p = path(name);
        let s = fsx::read_or_empty(&p)?;
        Ok((!s.is_empty()).then_some(s))
    }

    pub fn set(name: &str, value: &str) -> Result<()> {
        fsx::write_private(&path(name), value)
    }

    pub fn delete(name: &str) -> Result<()> {
        let p = path(name);
        match std::fs::remove_file(&p) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(Error::io(&p, e)),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod store {
    use crate::error::{Error, Result};

    // Debug builds keep their own entries so they never touch the installed app's session.
    const SERVICE: &str = if cfg!(debug_assertions) { "cn.cloudborne.desktop.dev" } else { "cn.cloudborne.desktop" };

    fn entry(name: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, name).map_err(|e| Error::Keychain(e.to_string()))
    }

    pub fn get(name: &str) -> Result<Option<String>> {
        match entry(name)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Error::Keychain(e.to_string())),
        }
    }

    pub fn set(name: &str, value: &str) -> Result<()> {
        entry(name)?.set_password(value).map_err(|e| Error::Keychain(e.to_string()))
    }

    pub fn delete(name: &str) -> Result<()> {
        match entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Error::Keychain(e.to_string())),
        }
    }
}

/// Random per-install ID, stored next to the session. The relay binds the
/// session to it, so a changed ID signs the user out. If it cannot be read, a
/// one-off ID is used for this run and the stored one is left alone.
fn device_id() -> String {
    match store::get(DEVICE) {
        Ok(Some(id)) if uuid::Uuid::parse_str(&id).is_ok() => id,
        Ok(_) => {
            let id = uuid::Uuid::new_v4().to_string();
            let _ = store::set(DEVICE, &id);
            id
        }
        Err(_) => uuid::Uuid::new_v4().to_string(),
    }
}

fn load_tokens() -> Result<Option<Tokens>> {
    Ok(store::get(ACCOUNT)?.and_then(|s| serde_json::from_str(&s).ok()))
}

fn store_tokens(t: &Tokens) -> Result<()> {
    let s = serde_json::to_string(t).map_err(|e| Error::Other(e.to_string()))?;
    store::set(ACCOUNT, &s)
}

fn clear_tokens() -> Result<()> {
    store::delete(ACCOUNT)
}

pub struct Session {
    pub client: Client,
    tokens: Mutex<Option<Tokens>>,
    /// Pending 2FA login token between the two login steps.
    pub pending_2fa: Mutex<Option<String>>,
}

impl Session {
    pub fn new() -> Result<Self> {
        let custom = std::env::var("CLOUDBORNE_ORIGIN").ok();
        let origin = custom.clone().unwrap_or_else(|| DEFAULT_ORIGIN.to_string());
        let admin = admin_origin(custom.as_deref());
        Ok(Self {
            client: Client::new(&origin, &admin, &device_id())?,
            tokens: Mutex::new(load_tokens().unwrap_or(None)),
            pending_2fa: Mutex::new(None),
        })
    }

    pub async fn is_logged_in(&self) -> bool {
        self.tokens.lock().await.is_some()
    }

    pub async fn set_tokens(&self, t: Tokens) -> Result<()> {
        store_tokens(&t)?;
        *self.tokens.lock().await = Some(t);
        Ok(())
    }

    pub async fn logout(&self) -> Result<()> {
        let t = self.tokens.lock().await.take();
        if let Some(t) = &t {
            self.client.logout(t.refresh_token.as_deref()).await;
        }
        clear_tokens()
    }

    async fn access(&self) -> Result<String> {
        self.tokens
            .lock()
            .await
            .as_ref()
            .map(|t| t.access_token.clone())
            .ok_or(Error::Unauthorized)
    }

    /// Exchanges the refresh token for a new pair. `stale` is the access
    /// token that just got a 401: if another request has already replaced it,
    /// that one's result is used rather than rotating again.
    async fn refresh(&self, stale: &str) -> Result<String> {
        let mut guard = self.tokens.lock().await;
        if let Some(t) = guard.as_ref().filter(|t| t.access_token != stale) {
            return Ok(t.access_token.clone());
        }
        let rt = guard
            .as_ref()
            .and_then(|t| t.refresh_token.clone())
            .ok_or(Error::Unauthorized)?;
        match self.client.refresh(&rt).await {
            Ok(mut t) => {
                if t.refresh_token.is_none() {
                    t.refresh_token = Some(rt);
                }
                // The relay has already retired the old token, so the new pair
                // is kept in memory even if saving it fails.
                let a = t.access_token.clone();
                let saved = store_tokens(&t);
                *guard = Some(t);
                saved.map(|()| a)
            }
            // A rejected refresh token ends the session; a network error does not.
            Err(Error::Unauthorized) => {
                // Another copy of the app may have rotated the token and saved
                // the new pair; pick that up instead of signing out.
                if let Ok(Some(t)) = load_tokens() {
                    if t.refresh_token.as_deref() != Some(rt.as_str()) {
                        let a = t.access_token.clone();
                        *guard = Some(t);
                        return Ok(a);
                    }
                }
                *guard = None;
                let _ = clear_tokens();
                Err(Error::Unauthorized)
            }
            Err(e) => Err(e),
        }
    }

    /// Runs `f` with an access token, refreshing once on 401.
    pub async fn authed<T, F, Fut>(&self, f: F) -> Result<T>
    where
        F: Fn(String) -> Fut,
        Fut: Future<Output = Result<T>>,
    {
        let a = self.access().await?;
        match f(a.clone()).await {
            Err(Error::Unauthorized) => {
                let a = self.refresh(&a).await?;
                f(a).await
            }
            other => other,
        }
    }
}
