//! Commands the UI calls. All config reads and writes happen here on the Rust
//! side; the UI only renders what comes back.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::agent;
use crate::ddz;

use crate::api::{ApiKey, Group, LoginOutcome, Method, UsageKind, User};
use crate::error::{Error, Result};
use crate::install::{self, InstallStarted};
use crate::lang::tr;
use crate::accounts::AccountInfo;
use crate::session::{Pending2fa, Session, SwitchOutcome};
use crate::tools::{self, detect, Connection, ToolId};

fn key_name(tool: ToolId) -> String {
    format!("Cloudborne Desktop · {}", tool.display_name())
}

/// Signs in with email and password. `remember` keeps the password (in the
/// same store as the tokens) so the account signs back in with one click.
async fn sign_in(s: &Session, email: &str, password: &str, remember: bool) -> Result<LoginOutcome> {
    let (outcome, tokens) = s.client.login(email.trim(), password).await?;
    let remember = remember.then(|| password.to_string());
    match (&outcome, tokens) {
        (LoginOutcome::TwoFactor { temp_token, .. }, _) => {
            *s.pending_2fa.lock().await = Some(Pending2fa { temp_token: temp_token.clone(), remember });
        }
        (LoginOutcome::Done { user }, Some(t)) => s.add(user, t, remember.as_deref()).await?,
        (LoginOutcome::Done { .. }, None) => return Err(Error::Api(tr("登录响应缺少令牌", "The sign-in response had no token").into())),
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn login(s: State<'_, Session>, email: String, password: String, remember: Option<bool>) -> Result<LoginOutcome> {
    sign_in(&s, &email, &password, remember.unwrap_or(false)).await
}

#[tauri::command]
pub async fn login_2fa(s: State<'_, Session>, code: String) -> Result<LoginOutcome> {
    let (temp, remember) = {
        let p = s.pending_2fa.lock().await;
        let p = p
            .as_ref()
            .ok_or_else(|| Error::Other(tr("两步验证已过期，请重新登录", "Two-step verification expired. Please sign in again.").into()))?;
        (p.temp_token.clone(), p.remember.clone())
    };
    let (outcome, tokens) = s.client.login_2fa(&temp, code.trim()).await?;
    if let (LoginOutcome::Done { user }, Some(t)) = (&outcome, tokens) {
        s.add(user, t, remember.as_deref()).await?;
        *s.pending_2fa.lock().await = None;
    }
    Ok(outcome)
}

/// Signs the current account out; it stays in the saved list. Returns the
/// account that took over, or null when none is signed in (the UI shows the
/// login page).
#[tauri::command]
pub async fn logout(s: State<'_, Session>) -> Result<Option<User>> {
    s.logout().await?;
    me(s).await
}

#[tauri::command]
pub async fn me(s: State<'_, Session>) -> Result<Option<User>> {
    let Some(id) = s.active().await else { return Ok(None) };
    match s.profile(id).await {
        Ok(u) => Ok(Some(u)),
        Err(Error::Unauthorized) => Ok(None),
        Err(e) => Err(e),
    }
}

// ---- Accounts ----

#[tauri::command]
pub async fn accounts_list(s: State<'_, Session>) -> Result<Vec<AccountInfo>> {
    Ok(s.list().await)
}

/// Makes a saved account active: `{ kind: "done", user }`. A signed-out
/// account with a remembered password signs in with it, which may need a 2FA
/// code next (`{ kind: "two_factor" }`). Otherwise `{ kind: "signed_out",
/// email }`: it needs its password typed again.
#[tauri::command]
pub async fn account_switch(s: State<'_, Session>, user_id: i64) -> Result<SwitchOutcome> {
    let out = s.switch(user_id).await?;
    let SwitchOutcome::SignedOut { .. } = out else { return Ok(out) };
    let Some((email, password)) = s.saved_login(user_id).await else { return Ok(out) };
    *s.pending_2fa.lock().await = None;
    match sign_in(&s, &email, &password, true).await {
        Ok(LoginOutcome::Done { user }) => Ok(SwitchOutcome::Done { user }),
        Ok(LoginOutcome::TwoFactor { email_masked, .. }) => Ok(SwitchOutcome::TwoFactor { email_masked }),
        // The password was changed since it was remembered.
        Err(Error::Api(m)) if m == crate::api::bad_credentials() => {
            s.forget_password(user_id).await;
            Ok(SwitchOutcome::SignedOut { email })
        }
        Err(e) => Err(e),
    }
}

/// The UI is about to show the login page to add an account; the current one
/// stays active until a login finishes. Drops a half-done 2FA step.
#[tauri::command]
pub async fn account_add_begin(s: State<'_, Session>) -> Result<Vec<AccountInfo>> {
    *s.pending_2fa.lock().await = None;
    Ok(s.list().await)
}

/// Signs a saved account out on the relay and forgets it, with its remembered
/// password. Returns the active account afterwards, null when none is signed in.
#[tauri::command]
pub async fn account_remove(s: State<'_, Session>, user_id: i64) -> Result<Option<User>> {
    s.remove(user_id).await?;
    me(s).await
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

async fn group_platform(s: &Session, group_id: i64) -> Result<String> {
    let c = &s.client;
    let groups = s.authed(|a| async move { c.groups(&a).await }).await?;
    groups
        .into_iter()
        .find(|g| g.id == group_id)
        .map(|g| g.platform)
        .ok_or_else(|| Error::Other(tr("找不到这个分组", "Group not found").into()))
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
        ToolId::Zcode | ToolId::Grok | ToolId::Pi => s.client.models(&key.key).await?,
    };
    let platform = if tool == ToolId::Pi { group_platform(s.inner(), group_id).await? } else { String::new() };
    let conn = Connection { origin: s.client.origin().to_string(), api_key: key.key, models, platform };
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

#[derive(Serialize, Debug, PartialEq)]
pub struct PlatformRate {
    platform: String,
    rate: f64,
}

/// The lowest multiplier this account pays on each platform, its own rate
/// taking precedence over the group's.
pub fn best_rates(groups: &[Group], own: &std::collections::HashMap<i64, f64>) -> Vec<PlatformRate> {
    let mut best: Vec<PlatformRate> = vec![];
    for g in groups.iter().filter(|g| g.status.is_empty() || g.status == "active") {
        let rate = own.get(&g.id).copied().unwrap_or(g.rate_multiplier);
        if rate <= 0.0 {
            continue;
        }
        match best.iter_mut().find(|b| b.platform == g.platform) {
            Some(b) if rate < b.rate => b.rate = rate,
            Some(_) => {}
            None => best.push(PlatformRate { platform: g.platform.clone(), rate }),
        }
    }
    best
}

/// Used when the relay admin has not set an exchange rate.
const DEFAULT_CNY_PER_USD: f64 = 7.2;

#[derive(Serialize)]
pub struct Rates {
    cny_per_usd: f64,
    rates: Vec<PlatformRate>,
}

#[tauri::command]
pub async fn rates(s: State<'_, Session>) -> Result<Rates> {
    let c = &s.client;
    let groups = s.authed(|a| async move { c.groups(&a).await }).await?;
    // Older relays have no per-user rates; the group's own then applies.
    let own = s.authed(|a| async move { c.group_rates(&a).await }).await.unwrap_or_default();
    let cny = s.authed(|a| async move { c.cny_per_usd(&a).await }).await.unwrap_or(0.0);
    Ok(Rates {
        cny_per_usd: if cny > 0.0 { cny } else { DEFAULT_CNY_PER_USD },
        rates: best_rates(&groups, &own),
    })
}

/// Reads the account's usage from the relay: totals, or the trend and
/// per-model breakdown.
#[tauri::command]
pub async fn usage(s: State<'_, Session>, kind: UsageKind, query: Vec<(String, String)>) -> Result<serde_json::Value> {
    let c = &s.client;
    s.authed(|a| {
        let q = query.clone();
        async move { c.usage(&a, kind, &q).await }
    })
    .await
}

/// The account's API keys as id → name, so the usage page can name the tool
/// behind each request.
#[tauri::command]
pub async fn usage_keys(s: State<'_, Session>) -> Result<Vec<UsageKey>> {
    let c = &s.client;
    let keys = s.authed(|a| async move { c.keys(&a).await }).await?;
    Ok(keys.into_iter().map(|k| UsageKey { tool: tool_of_key(&k.name), id: k.id, name: k.name }).collect())
}

#[derive(Serialize)]
pub struct UsageKey {
    id: i64,
    name: String,
    /// Set when the desktop client created this key for one of its tools.
    tool: Option<ToolId>,
}

fn tool_of_key(name: &str) -> Option<ToolId> {
    ToolId::ALL.into_iter().find(|t| key_name(*t) == name)
}

// ---- API keys ----

/// Every key on the account as the relay sends it, plus `today_cost`,
/// `month_cost` (last 30 days) and `tool` when this client made it for a tool.
#[tauri::command]
pub async fn keys_list(s: State<'_, Session>) -> Result<Vec<serde_json::Value>> {
    let c = &s.client;
    let keys = s.authed(|a| async move { c.keys_full(&a).await }).await?;
    let ids: Vec<i64> = keys.iter().filter_map(|k| k.get("id")?.as_i64()).collect();
    let ids = &ids;
    // Spend is extra; the list still shows if it fails.
    let costs = s.authed(|a| async move { c.key_costs(&a, ids).await }).await.unwrap_or_default();
    Ok(keys
        .into_iter()
        .map(|mut k| {
            let cost = k.get("id").and_then(|v| v.as_i64()).and_then(|id| costs.get(&id)).copied().unwrap_or_default();
            let tool = k.get("name").and_then(|v| v.as_str()).and_then(tool_of_key);
            k.insert("today_cost".into(), cost.today_actual_cost.into());
            k.insert("month_cost".into(), cost.total_actual_cost.into());
            k.insert("tool".into(), serde_json::to_value(tool).unwrap_or_default());
            serde_json::Value::Object(k)
        })
        .collect())
}

/// Groups a new key can use, each with this account's own rate where it has one.
#[tauri::command]
pub async fn key_groups(s: State<'_, Session>) -> Result<Vec<Group>> {
    let c = &s.client;
    let groups = s.authed(|a| async move { c.groups(&a).await }).await?;
    let own = s.authed(|a| async move { c.group_rates(&a).await }).await.unwrap_or_default();
    Ok(groups
        .into_iter()
        .filter(|g| g.status.is_empty() || g.status == "active")
        .map(|mut g| {
            if let Some(r) = own.get(&g.id) {
                g.rate_multiplier = *r;
            }
            g
        })
        .collect())
}

#[tauri::command]
pub async fn key_create(s: State<'_, Session>, body: serde_json::Value) -> Result<serde_json::Value> {
    let c = &s.client;
    let body = &body;
    s.authed(|a| async move { c.create_key_with(&a, body).await }).await
}

#[tauri::command]
pub async fn key_update(s: State<'_, Session>, id: i64, body: serde_json::Value) -> Result<serde_json::Value> {
    let c = &s.client;
    let body = &body;
    s.authed(|a| async move { c.update_key(&a, id, body).await }).await
}

#[tauri::command]
pub async fn key_delete(s: State<'_, Session>, id: i64) -> Result<()> {
    let c = &s.client;
    s.authed(|a| async move { c.delete_key(&a, id).await }).await
}

/// Model ids a key can call, for the usage examples.
#[tauri::command]
pub async fn key_models(s: State<'_, Session>, key: String) -> Result<Vec<String>> {
    s.client.models(&key).await
}

/// Hands a key to CC Switch through its import link.
#[tauri::command]
pub fn open_ccswitch(url: String) -> Result<()> {
    if !url.starts_with("ccswitch://v1/import?") {
        return Err(Error::Other("not a CC Switch import link".into()));
    }
    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|_| Error::Other(tr("没有找到 CC Switch，请先安装", "CC Switch was not found. Install it first.").into()))
}

// ---- Service status ----

/// The relay's status probes as it sends them: `{ items: [...] }`.
#[tauri::command]
pub async fn service_status(s: State<'_, Session>) -> Result<serde_json::Value> {
    let c = &s.client;
    s.authed(|a| async move { c.monitors(&a).await }).await
}

// ---- Lucky draw ----

/// The chest activity as this account sees it: window, chests owned, earn
/// progress, buying, prize names, today's results and running perks.
#[tauri::command]
pub async fn lottery_status(s: State<'_, Session>) -> Result<serde_json::Value> {
    let c = &s.client;
    s.authed(|a| async move { c.lottery(&a).await }).await
}

/// Opens `count` chests (1..10, default 1). The relay picks the prizes;
/// returns `{ draws, draw, status }`.
#[tauri::command]
pub async fn lottery_open(s: State<'_, Session>, count: Option<u32>) -> Result<serde_json::Value> {
    let count = count.unwrap_or(1).clamp(1, 10);
    let c = &s.client;
    s.authed(|a| async move { c.lottery_open(&a, count).await }).await
}

/// Buys `count` chests with balance; returns `{ bought, status }`.
#[tauri::command]
pub async fn lottery_buy(s: State<'_, Session>, count: u32) -> Result<serde_json::Value> {
    let c = &s.client;
    s.authed(|a| async move { c.lottery_buy(&a, count).await }).await
}

// ---- 小丑斗地主 ----

/// Whether the tables are open and at which stakes.
#[tauri::command]
pub async fn ddz_status(s: State<'_, Session>) -> Result<serde_json::Value> {
    let c = &s.client;
    s.authed(|a| async move { c.ddz(&a).await }).await
}

/// Opens the table line (replacing any open one); snapshots arrive on `channel`.
#[tauri::command]
pub async fn ddz_connect(app: tauri::AppHandle, line: State<'_, ddz::SharedLine>, channel: Channel<ddz::Event>) -> Result<()> {
    ddz::connect(app, &line, channel).await;
    Ok(())
}

/// Sends one action to the table.
#[tauri::command]
pub async fn ddz_send(line: State<'_, ddz::SharedLine>, action: serde_json::Value) -> Result<()> {
    ddz::send(&line, &action).await
}

#[tauri::command]
pub async fn ddz_close(line: State<'_, ddz::SharedLine>) -> Result<()> {
    ddz::close(&line).await;
    Ok(())
}

// ---- Redeem codes ----

/// Redeems a code for balance, concurrency or a subscription; returns the
/// relay's record of the code (`type`, `value`, ...).
#[tauri::command]
pub async fn redeem(s: State<'_, Session>, code: String) -> Result<serde_json::Value> {
    let code = code.trim().to_string();
    if code.is_empty() {
        return Err(Error::Api(tr("请输入兑换码", "Enter a code").into()));
    }
    let c = &s.client;
    let code = &code;
    s.authed(|a| async move { c.redeem(&a, code).await }).await
}

/// This account's redeemed codes and balance changes, newest first.
#[tauri::command]
pub async fn redeem_history(s: State<'_, Session>, page: u32, page_size: u32) -> Result<serde_json::Value> {
    let c = &s.client;
    s.authed(|a| async move { c.redeem_history(&a, page, page_size).await }).await
}

// ---- Transfers and invites ----

/// Sends `amount` of this account's balance to another account; returns
/// `{ amount, balance, recipient }` with the recipient masked.
#[tauri::command]
pub async fn transfer(s: State<'_, Session>, recipient: String, amount: f64, password: String) -> Result<serde_json::Value> {
    let recipient = recipient.trim().to_string();
    if recipient.is_empty() {
        return Err(Error::Api(tr("请输入收款人的邮箱或用户名", "Enter the recipient's email or username").into()));
    }
    if !(amount.is_finite() && amount >= 1.0) {
        return Err(Error::Api(tr("转账金额至少 $1", "Transfer at least $1").into()));
    }
    if password.is_empty() {
        return Err(Error::Api(tr("请输入登录密码", "Enter your password").into()));
    }
    let c = &s.client;
    let (recipient, password) = (&recipient, &password);
    s.authed(|a| async move { c.transfer(&a, recipient, amount, password).await }).await
}

#[tauri::command]
pub async fn invites(s: State<'_, Session>) -> Result<serde_json::Value> {
    let c = &s.client;
    s.authed(|a| async move { c.invites(&a).await }).await
}

#[tauri::command]
pub async fn invite_create(s: State<'_, Session>) -> Result<serde_json::Value> {
    let c = &s.client;
    s.authed(|a| async move { c.invite_create(&a).await }).await
}

#[tauri::command]
pub async fn invite_revoke(s: State<'_, Session>, id: i64) -> Result<serde_json::Value> {
    let c = &s.client;
    s.authed(|a| async move { c.invite_revoke(&a, id).await }).await
}

// ---- Admin (ops origin) ----

type Query = Vec<(String, String)>;

async fn admin_call(s: &Session, method: Method, path: &str, query: Query, body: Option<serde_json::Value>) -> Result<serde_json::Value> {
    let c = &s.client;
    let (query, body) = (&query, body.as_ref());
    s.authed(|a| async move { c.admin(&a, method, path, query, body).await }).await
}

fn q(pairs: &[(&str, &str)]) -> Query {
    pairs.iter().filter(|(_, v)| !v.is_empty()).map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

/// Today's totals, today's per-model split and the trend over `start..=end`,
/// all in `timezone`.
#[tauri::command]
pub async fn admin_overview(s: State<'_, Session>, today: String, start: String, timezone: String) -> Result<serde_json::Value> {
    let s = s.inner();
    let trend_q = q(&[("start_date", &start), ("end_date", &today), ("timezone", &timezone), ("granularity", "day")]);
    let models_q = q(&[("start_date", &today), ("end_date", &today), ("timezone", &timezone)]);
    let (stats, trend, models) = tokio::try_join!(
        admin_call(s, Method::Get, "/dashboard/stats", vec![], None),
        admin_call(s, Method::Get, "/dashboard/trend", trend_q, None),
        admin_call(s, Method::Get, "/dashboard/models", models_q, None),
    )?;
    Ok(serde_json::json!({
        "stats": stats,
        "trend": trend.get("trend").cloned().unwrap_or_default(),
        "models": models.get("models").cloned().unwrap_or_default(),
    }))
}

/// One page of users, each with `today_cost` and `month_cost` (last 30 days)
/// added from the batch usage endpoint.
#[tauri::command]
pub async fn admin_users(
    s: State<'_, Session>,
    page: u32,
    page_size: u32,
    search: String,
    sort_by: String,
    sort_order: String,
) -> Result<serde_json::Value> {
    let s = s.inner();
    let (page, size) = (page.max(1).to_string(), page_size.clamp(1, 100).to_string());
    let query = q(&[
        ("page", &page),
        ("page_size", &size),
        ("search", search.trim()),
        ("sort_by", sort_by.trim()),
        ("sort_order", sort_order.trim()),
    ]);
    let mut list = admin_call(s, Method::Get, "/users", query, None).await?;
    let ids: Vec<i64> = list
        .get("items")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|u| u.get("id")?.as_i64()).collect())
        .unwrap_or_default();
    if ids.is_empty() {
        return Ok(list);
    }
    // Spend is extra; the list still shows if it fails.
    let usage = admin_call(s, Method::Post, "/dashboard/users-usage", vec![], Some(serde_json::json!({ "user_ids": ids })))
        .await
        .unwrap_or_default();
    merge_user_costs(&mut list, &usage);
    Ok(list)
}

/// Copies `today_actual_cost` / `total_actual_cost` from the users-usage
/// response (`{ stats: { "<id>": {...} } }`) onto each listed user.
pub fn merge_user_costs(list: &mut serde_json::Value, usage: &serde_json::Value) {
    let Some(items) = list.get_mut("items").and_then(|v| v.as_array_mut()) else { return };
    for u in items {
        let id = u.get("id").and_then(|v| v.as_i64()).unwrap_or_default();
        let st = usage.get("stats").and_then(|m| m.get(id.to_string()));
        let get = |k: &str| st.and_then(|x| x.get(k)).and_then(|v| v.as_f64()).unwrap_or(0.0);
        if let Some(o) = u.as_object_mut() {
            o.insert("today_cost".into(), get("today_actual_cost").into());
            o.insert("month_cost".into(), get("total_actual_cost").into());
        }
    }
}

#[tauri::command]
pub async fn admin_user(s: State<'_, Session>, id: i64) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Get, &format!("/users/{id}"), vec![], None).await
}

#[tauri::command]
pub async fn admin_usage(s: State<'_, Session>, query: Query) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Get, "/usage", query, None).await
}

#[tauri::command]
pub async fn admin_user_concurrency(s: State<'_, Session>) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Get, "/ops/user-concurrency", vec![], None).await
}

/// One user's requests in flight, split by the group of the API key they came through.
#[tauri::command]
pub async fn admin_user_groups(s: State<'_, Session>, id: i64) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Get, &format!("/users/{id}/group-concurrency"), vec![], None).await
}

#[tauri::command]
pub async fn admin_user_inviter(s: State<'_, Session>, id: i64) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Get, &format!("/users/{id}/inviter"), vec![], None).await
}

/// Lets a user create invite links, or stops it and expires their unused links.
#[tauri::command]
pub async fn admin_user_set_inviter(s: State<'_, Session>, id: i64, allowed: bool) -> Result<serde_json::Value> {
    let body = serde_json::json!({ "allowed": allowed });
    admin_call(s.inner(), Method::Put, &format!("/users/{id}/inviter"), vec![], Some(body)).await
}

/// Adds to or takes from a user's balance; `amount` must be above 0.
#[tauri::command]
pub async fn admin_user_balance(s: State<'_, Session>, id: i64, amount: f64, add: bool, notes: String) -> Result<serde_json::Value> {
    if !(amount > 0.0 && amount.is_finite()) {
        return Err(Error::Other(tr("金额需要大于 0", "The amount must be above 0").into()));
    }
    let body = serde_json::json!({ "balance": amount, "operation": if add { "add" } else { "subtract" }, "notes": notes.trim() });
    admin_call(s.inner(), Method::Post, &format!("/users/{id}/balance"), vec![], Some(body)).await
}

#[tauri::command]
pub async fn admin_user_status(s: State<'_, Session>, id: i64, active: bool) -> Result<serde_json::Value> {
    let body = serde_json::json!({ "status": if active { "active" } else { "disabled" } });
    admin_call(s.inner(), Method::Put, &format!("/users/{id}"), vec![], Some(body)).await
}

#[tauri::command]
pub async fn admin_lottery_settings(s: State<'_, Session>) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Get, "/lottery/settings", vec![], None).await
}

#[tauri::command]
pub async fn admin_lottery_save(s: State<'_, Session>, settings: serde_json::Value) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Put, "/lottery/settings", vec![], Some(settings)).await
}

#[tauri::command]
pub async fn admin_ddz_settings(s: State<'_, Session>) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Get, "/ddz/settings", vec![], None).await
}

#[tauri::command]
pub async fn admin_ddz_save(s: State<'_, Session>, settings: serde_json::Value) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Put, "/ddz/settings", vec![], Some(settings)).await
}

/// 小丑斗地主 games, players and money over the last `days` days.
#[tauri::command]
pub async fn admin_ddz_summary(s: State<'_, Session>, days: u32) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Get, "/ddz/summary", q(&[("days", &days.to_string())]), None).await
}

/// The recommended settings, for the form only; nothing is saved.
#[tauri::command]
pub async fn admin_lottery_defaults(s: State<'_, Session>) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Get, "/lottery/settings/defaults", vec![], None).await
}

/// One day's totals and big wins; `date` is `YYYY-MM-DD`, empty for today.
#[tauri::command]
pub async fn admin_lottery_summary(s: State<'_, Session>, date: String) -> Result<serde_json::Value> {
    admin_call(s.inner(), Method::Get, "/lottery/summary", q(&[("date", &date)]), None).await
}

/// Draw records. Empty filters are left out; `rarity` may be a comma list.
#[tauri::command]
pub async fn admin_lottery_draws(
    s: State<'_, Session>,
    date: String,
    rarity: String,
    user_id: Option<i64>,
    page: u32,
    page_size: u32,
) -> Result<serde_json::Value> {
    let user = user_id.map(|u| u.to_string()).unwrap_or_default();
    let (page, size) = (page.max(1).to_string(), page_size.clamp(1, 200).to_string());
    let query = q(&[("date", &date), ("rarity", &rarity), ("user_id", &user), ("page", &page), ("page_size", &size)]);
    admin_call(s.inner(), Method::Get, "/lottery/draws", query, None).await
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

    fn group(id: i64, platform: &str, rate: f64, status: &str) -> Group {
        Group { id, name: String::new(), platform: platform.into(), status: status.into(), rate_multiplier: rate }
    }

    #[test]
    fn best_rate_per_platform_prefers_the_accounts_own() {
        let groups = [
            group(1, "openai", 0.37, "active"),
            group(2, "openai", 0.7, "active"),
            group(3, "anthropic", 2.85, "active"),
            group(4, "anthropic", 1.2, "active"),
            group(5, "anthropic", 0.1, "disabled"),
        ];
        let own = [(2, 0.25)].into_iter().collect();
        let r = best_rates(&groups, &own);
        assert_eq!(
            r,
            [
                PlatformRate { platform: "openai".into(), rate: 0.25 },
                PlatformRate { platform: "anthropic".into(), rate: 1.2 },
            ]
        );
    }

    #[test]
    fn user_costs_are_merged_by_id() {
        let mut list = serde_json::json!({ "items": [{ "id": 3 }, { "id": 4 }], "total": 2 });
        let usage = serde_json::json!({ "stats": { "3": { "today_actual_cost": 1.5, "total_actual_cost": 20.25 } } });
        merge_user_costs(&mut list, &usage);
        assert_eq!(list["items"][0]["today_cost"], 1.5);
        assert_eq!(list["items"][0]["month_cost"], 20.25);
        assert_eq!(list["items"][1]["today_cost"], 0.0);
    }

    #[test]
    fn empty_query_values_are_dropped() {
        assert_eq!(q(&[("date", ""), ("page", "2")]), vec![("page".to_string(), "2".to_string())]);
    }

    #[test]
    fn agent_models_newest_first_without_codex_variants() {
        let ids = ["gpt-5.4-mini", "gpt-5.5", "gpt-5.3-codex", "gpt-5.6-terra", "gpt-image-2", "gpt-5.4", "gpt-5.6-sol", "claude-x"];
        let m = agent_model_list(ids.iter().map(|s| s.to_string()).collect());
        assert_eq!(m.models, ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]);
        assert_eq!(m.default.as_deref(), Some("gpt-5.6-sol"));
    }
}
