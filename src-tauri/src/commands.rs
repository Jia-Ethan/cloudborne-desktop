//! Commands the UI calls. All config reads and writes happen here on the Rust
//! side; the UI only renders what comes back.

use serde::Serialize;
use tauri::State;

use crate::api::{ApiKey, Group, LoginOutcome, User};
use crate::error::{Error, Result};
use crate::install::{self, InstallStarted};
use crate::lang::tr;
use crate::session::Session;
use crate::tools::{self, detect, Connection, ToolId};

fn key_name(tool: ToolId) -> String {
    format!("Cloudborne Desktop · {}", tool.display_name())
}

#[tauri::command]
pub async fn login(s: State<'_, Session>, email: String, password: String) -> Result<LoginOutcome> {
    let (outcome, tokens) = s.client.login(email.trim(), &password).await?;
    match (&outcome, tokens) {
        (LoginOutcome::TwoFactor { temp_token, .. }, _) => {
            *s.pending_2fa.lock().await = Some(temp_token.clone());
        }
        (LoginOutcome::Done { .. }, Some(t)) => s.set_tokens(t).await?,
        (LoginOutcome::Done { .. }, None) => return Err(Error::Api(tr("登录响应缺少令牌", "The sign-in response had no token").into())),
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn login_2fa(s: State<'_, Session>, code: String) -> Result<LoginOutcome> {
    let temp = s
        .pending_2fa
        .lock()
        .await
        .clone()
        .ok_or_else(|| Error::Other(tr("两步验证已过期，请重新登录", "Two-step verification expired. Please sign in again.").into()))?;
    let (outcome, tokens) = s.client.login_2fa(&temp, code.trim()).await?;
    if let Some(t) = tokens {
        s.set_tokens(t).await?;
        *s.pending_2fa.lock().await = None;
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn logout(s: State<'_, Session>) -> Result<()> {
    s.logout().await
}

#[tauri::command]
pub async fn me(s: State<'_, Session>) -> Result<Option<User>> {
    if !s.is_logged_in().await {
        return Ok(None);
    }
    let c = &s.client;
    match s.authed(|a| async move { c.profile(&a).await }).await {
        Ok(u) => Ok(Some(u)),
        Err(Error::Unauthorized) => Ok(None),
        Err(e) => Err(e),
    }
}

#[derive(Serialize)]
pub struct ToolStatus {
    id: ToolId,
    name: &'static str,
    installed: bool,
    location: Option<String>,
    connected: bool,
    /// Set when the config file exists but cannot be parsed.
    error: Option<String>,
}

#[tauri::command]
pub async fn tools_status() -> Result<Vec<ToolStatus>> {
    let home = tools::home_dir();
    Ok(ToolId::ALL
        .into_iter()
        .map(|id| {
            let location = detect::locate(id, &home);
            let (connected, error) = match tools::is_connected(id, &home) {
                Ok(c) => (c, None),
                Err(e) => (false, Some(e.to_string())),
            };
            ToolStatus {
                id,
                name: id.display_name(),
                installed: location.is_some(),
                location: location.map(|p| p.display().to_string()),
                connected,
                error,
            }
        })
        .collect())
}

#[derive(Serialize)]
pub struct GroupChoice {
    #[serde(flatten)]
    group: Group,
}

/// Groups this account can use for `tool`, preferred platform first.
#[tauri::command]
pub async fn groups_for(s: State<'_, Session>, tool: ToolId) -> Result<Vec<GroupChoice>> {
    let c = &s.client;
    let all = s.authed(|a| async move { c.groups(&a).await }).await?;
    let mut out: Vec<Group> = all
        .into_iter()
        .filter(|g| g.status.is_empty() || g.status == "active")
        .filter(|g| tool.platforms().contains(&g.platform.as_str()))
        .collect();
    out.sort_by_key(|g| tool.platforms().iter().position(|p| *p == g.platform).unwrap_or(usize::MAX));
    Ok(out.into_iter().map(|group| GroupChoice { group }).collect())
}

async fn ensure_key(s: &Session, tool: ToolId, group_id: i64) -> Result<ApiKey> {
    let name = key_name(tool);
    let c = &s.client;
    let keys = s.authed(|a| async move { c.keys(&a).await }).await?;
    if let Some(k) = keys
        .into_iter()
        .find(|k| k.name == name && k.group_id == Some(group_id) && k.status == "active")
    {
        return Ok(k);
    }
    let name = &name;
    s.authed(|a| async move { c.create_key(&a, name, group_id).await }).await
}

#[derive(Serialize)]
pub struct ConnectResult {
    backups: Vec<String>,
    models: usize,
}

#[tauri::command]
pub async fn connect_tool(s: State<'_, Session>, tool: ToolId, group_id: i64) -> Result<ConnectResult> {
    let key = ensure_key(s.inner(), tool, group_id).await?;
    let models = match tool {
        // Codex and Claude Code choose models themselves.
        ToolId::Codex | ToolId::Claude => vec![],
        ToolId::Zcode | ToolId::Grok => s.client.models(&key.key).await?,
    };
    let conn = Connection { origin: s.client.origin().to_string(), api_key: key.key, models };
    let home = tools::home_dir();
    let backups = tools::connect(tool, &home, &conn)?;
    Ok(ConnectResult {
        backups: backups.iter().map(|p| p.display().to_string()).collect(),
        models: conn.models.len(),
    })
}

#[tauri::command]
pub async fn disconnect_tool(s: State<'_, Session>, tool: ToolId, delete_key: bool) -> Result<Vec<String>> {
    let home = tools::home_dir();
    let backups = tools::disconnect(tool, &home)?;
    if delete_key && s.is_logged_in().await {
        let name = key_name(tool);
        let c = &s.client;
        let keys = s.authed(|a| async move { c.keys(&a).await }).await?;
        for k in keys.into_iter().filter(|k| k.name == name) {
            s.authed(|a| async move { c.delete_key(&a, k.id).await }).await?;
        }
    }
    Ok(backups.iter().map(|p| p.display().to_string()).collect())
}

#[tauri::command]
pub async fn install_tool(tool: ToolId) -> Result<InstallStarted> {
    install::install(tool, &tools::home_dir()).await
}

#[tauri::command]
pub fn relay_origin(s: State<'_, Session>) -> String {
    s.client.origin().to_string()
}

/// The UI's language, for messages produced here.
#[tauri::command]
pub fn set_language(code: String) {
    crate::lang::set(&code);
}
