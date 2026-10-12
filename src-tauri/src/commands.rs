//! Commands the UI calls. All config reads and writes happen here on the Rust
//! side; the UI only renders what comes back.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::agent;

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

// ---- New task (agent) ----

const AGENT_KEY_NAME: &str = "Cloudborne Desktop · Agent";

/// The account's first active OpenAI group and a key in it for the agent.
async fn agent_key(s: &Session) -> Result<ApiKey> {
    let c = &s.client;
    let groups = s.authed(|a| async move { c.groups(&a).await }).await?;
    let group = groups
        .into_iter()
        .find(|g| g.platform == "openai" && (g.status.is_empty() || g.status == "active"))
        .ok_or_else(agent::not_available)?;
    let keys = s.authed(|a| async move { c.keys(&a).await }).await?;
    if let Some(k) = keys
        .into_iter()
        .find(|k| k.name == AGENT_KEY_NAME && k.group_id == Some(group.id) && k.status == "active")
    {
        return Ok(k);
    }
    s.authed(|a| async move { c.create_key(&a, AGENT_KEY_NAME, group.id).await }).await
}

#[derive(Serialize)]
pub struct AgentModels {
    models: Vec<String>,
    default: Option<String>,
}

/// Models the agent can use, newest first; codex-specific and non-chat ids are left out.
pub fn agent_model_list(ids: Vec<String>) -> AgentModels {
    let mut models: Vec<String> = ids
        .into_iter()
        .filter(|m| m.starts_with("gpt-") && !m.contains("codex") && !m.contains("image") && !m.contains("audio"))
        .collect();
    models.sort_by(|a, b| version_key(b).cmp(&version_key(a)).then(a.len().cmp(&b.len())).then(a.cmp(b)));
    models.dedup();
    let default = models.iter().find(|m| !m.contains("mini") && !m.contains("nano")).or(models.first()).cloned();
    AgentModels { models, default }
}

fn version_key(id: &str) -> Vec<u32> {
    id.trim_start_matches("gpt-")
        .split(|c: char| !c.is_ascii_digit() && c != '.')
        .next()
        .unwrap_or("")
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect()
}

#[tauri::command]
pub async fn agent_models(s: State<'_, Session>) -> Result<AgentModels> {
    let key = agent_key(s.inner()).await?;
    Ok(agent_model_list(s.client.models(&key.key).await?))
}

#[tauri::command]
pub fn agent_sessions() -> Vec<agent::Summary> {
    agent::store::list(&agent::root())
}

#[tauri::command]
pub fn agent_session(id: String) -> Result<agent::StoredSession> {
    let mut s = agent::store::load(&agent::root(), &id)?
        .ok_or_else(|| Error::Other(tr("找不到这个任务", "Task not found").into()))?;
    agent::store::settle_interrupted(&mut s);
    Ok(s)
}

#[tauri::command]
pub async fn agent_delete_session(runs: State<'_, agent::SharedRuns>, id: String) -> Result<()> {
    agent::stop(&runs, &id).await;
    agent::store::delete(&agent::root(), &id)
}

#[tauri::command]
pub async fn agent_send(
    s: State<'_, Session>,
    runs: State<'_, agent::SharedRuns>,
    options: agent::SendOptions,
    channel: Channel<agent::Event>,
) -> Result<String> {
    let id = options.session.clone();
    let key = match agent_key(s.inner()).await {
        Ok(k) => k,
        Err(e) => {
            let kind = if matches!(e, Error::Unauthorized) { "auth" } else { agent::classify(&e.to_string()) };
            let _ = channel.send(agent::Event::Failed { kind, message: e.to_string() });
            return Ok(id);
        }
    };
    let prep = agent::Prepared { api_key: key.key, origin: s.client.origin().to_string() };
    let runs = runs.inner().clone();
    tauri::async_runtime::spawn(async move {
        let ch = channel.clone();
        if let Err(e) = agent::run_turn(runs, options, prep, channel).await {
            let _ = ch.send(agent::Event::Failed { kind: "other", message: e.to_string() });
        }
    });
    Ok(id)
}

#[tauri::command]
pub async fn agent_stop(runs: State<'_, agent::SharedRuns>, id: String) -> Result<()> {
    agent::stop(&runs, &id).await;
    Ok(())
}

#[cfg(test)]
mod agent_tests {
    use super::*;

    #[test]
    fn agent_models_newest_first_without_codex_variants() {
        let ids = ["gpt-5.4-mini", "gpt-5.5", "gpt-5.3-codex", "gpt-5.6-terra", "gpt-image-2", "gpt-5.4", "gpt-5.6-sol", "claude-x"];
        let m = agent_model_list(ids.iter().map(|s| s.to_string()).collect());
        assert_eq!(m.models, ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]);
        assert_eq!(m.default.as_deref(), Some("gpt-5.6-sol"));
    }
}
