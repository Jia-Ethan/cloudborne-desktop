//! Login session. Tokens and the device ID live in the OS keychain (macOS
//! Keychain, Windows Credential Manager); nothing secret is written to plain
//! files. Requests that come back 401 refresh the access token once and retry.

use std::future::Future;

use tokio::sync::Mutex;

use crate::api::{Client, Tokens, DEFAULT_ORIGIN};
use crate::error::{Error, Result};

const SERVICE: &str = "cn.cloudborne.desktop";
const ACCOUNT: &str = "session";
const DEVICE: &str = "device";

fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| Error::Keychain(e.to_string()))
}

/// Random per-install ID, kept in the keychain next to the session. If the
/// keychain is unavailable a fresh ID is used, which only costs a re-login.
fn device_id() -> String {
    let fresh = || uuid::Uuid::new_v4().to_string();
    let Ok(e) = keyring::Entry::new(SERVICE, DEVICE) else { return fresh() };
    match e.get_password() {
        Ok(id) if uuid::Uuid::parse_str(&id).is_ok() => id,
        _ => {
            let id = fresh();
            let _ = e.set_password(&id);
            id
        }
    }
}

fn load_tokens() -> Result<Option<Tokens>> {
    match entry()?.get_password() {
        Ok(s) => Ok(serde_json::from_str(&s).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(Error::Keychain(e.to_string())),
    }
}

fn store_tokens(t: &Tokens) -> Result<()> {
    let s = serde_json::to_string(t).map_err(|e| Error::Other(e.to_string()))?;
    entry()?.set_password(&s).map_err(|e| Error::Keychain(e.to_string()))
}

fn clear_tokens() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Keychain(e.to_string())),
    }
}

pub struct Session {
    pub client: Client,
    tokens: Mutex<Option<Tokens>>,
    /// Pending 2FA login token between the two login steps.
    pub pending_2fa: Mutex<Option<String>>,
}

impl Session {
    pub fn new() -> Result<Self> {
        let origin = std::env::var("CLOUDBORNE_ORIGIN").unwrap_or_else(|_| DEFAULT_ORIGIN.to_string());
        Ok(Self {
            client: Client::new(&origin, &device_id())?,
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

    async fn refresh(&self) -> Result<String> {
        let mut guard = self.tokens.lock().await;
        let rt = guard
            .as_ref()
            .and_then(|t| t.refresh_token.clone())
            .ok_or(Error::Unauthorized)?;
        match self.client.refresh(&rt).await {
            Ok(mut t) => {
                if t.refresh_token.is_none() {
                    t.refresh_token = Some(rt);
                }
                store_tokens(&t)?;
                let a = t.access_token.clone();
                *guard = Some(t);
                Ok(a)
            }
            // A rejected refresh token ends the session; a network error does not.
            Err(Error::Unauthorized) => {
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
        match f(a).await {
            Err(Error::Unauthorized) => {
                let a = self.refresh().await?;
                f(a).await
            }
            other => other,
        }
    }
}
