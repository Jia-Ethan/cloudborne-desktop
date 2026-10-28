//! Client for the relay's user API (`/api/v1/...`) and model list (`/v1/models`).
//! Responses use the envelope `{ code, message, data }`; `code == 0` is success.

use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{Error, Result};
use crate::lang::tr;
use crate::tr_fmt;

pub const DEFAULT_ORIGIN: &str = "https://api.cloudborne.cn";
/// The public origin answers 404 for `/api/v1/admin/...`; admin calls go here.
pub const ADMIN_ORIGIN: &str = "https://ops.cloudborne.cn";

/// Where admin calls go: the override origin when one is set (a test relay
/// serves both), otherwise the ops origin.
pub fn admin_origin(override_origin: Option<&str>) -> String {
    match override_origin.map(str::trim).filter(|o| !o.is_empty()) {
        Some(o) => o.trim_end_matches('/').to_string(),
        None => ADMIN_ORIGIN.to_string(),
    }
}

/// `CloudborneDesktop/<ver> (<os>; device=<id>)`. The relay binds desktop
/// sessions to the device ID rather than IP + User-Agent, so switching networks
/// or updating the app keeps the user signed in.
fn user_agent(device_id: &str) -> String {
    format!(
        "CloudborneDesktop/{} ({}; device={device_id})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub email: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub balance: f64,
    #[serde(default)]
    pub status: String,
    /// `admin` or `user`.
    #[serde(default)]
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: i64,
    pub name: String,
    pub platform: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub rate_multiplier: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub id: i64,
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub group_id: Option<i64>,
    #[serde(default)]
    pub status: String,
}

/// Days of spend shown per key; matches the web console.
pub const KEY_COST_DAYS: u32 = 7;

fn key_costs_body(ids: &[i64]) -> Value {
    json!({ "api_key_ids": ids, "days": KEY_COST_DAYS })
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct KeyCost {
    #[serde(default)]
    pub today_actual_cost: f64,
    /// Last `KEY_COST_DAYS` days.
    #[serde(default)]
    pub total_actual_cost: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageKind {
    Stats,
    Snapshot,
    Records,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LoginOutcome {
    Done { user: User },
    TwoFactor { temp_token: String, email_masked: String },
}

enum RawErr {
    /// HTTP 401, with the relay's error body when it sent one.
    Unauth401(Option<Envelope>),
    Other(Error),
}
use RawErr::{Other, Unauth401};

pub fn bad_credentials() -> &'static str {
    tr("邮箱或密码不正确", "Wrong email or password")
}

/// Localized wording for the relay's common auth errors; anything else is shown as sent.
fn friendly(env: &Envelope) -> String {
    match env.reason.as_deref() {
        Some("INVALID_CREDENTIALS") => bad_credentials().into(),
        Some("USER_NOT_ACTIVE") | Some("USER_DISABLED") => tr("这个账号已被停用", "This account has been disabled").into(),
        Some("INVALID_TOTP_CODE") | Some("TOTP_INVALID") => tr("验证码不正确", "That code is not correct").into(),
        Some("REDEEM_CODE_NOT_FOUND") => tr("兑换码不存在，请检查后重试", "That code does not exist. Check it and try again.").into(),
        Some("REDEEM_CODE_USED") => tr("这个兑换码已经用过了", "That code has already been used").into(),
        Some("REDEEM_CODE_EXPIRED") => tr("这个兑换码已过期", "That code has expired").into(),
        Some("REDEEM_RATE_LIMITED") => tr("尝试次数太多，请稍后再试", "Too many attempts. Try again later.").into(),
        Some("REDEEM_CODE_LOCKED") => tr("这个兑换码正在处理，请稍后再试", "That code is being processed. Try again in a moment.").into(),
        Some("REDEEM_CODE_UNSUPPORTED_TYPE") => tr("这个兑换码不能在这里使用", "That code cannot be used here").into(),
        Some("LOTTERY_DISABLED") => tr("宝箱活动未开启", "The chest event is off").into(),
        Some("LOTTERY_NOT_ACTIVE") => tr("不在活动时间内", "The chest event is not running right now").into(),
        Some("LOTTERY_NO_CHESTS") | Some("LOTTERY_NO_DRAWS") => tr("没有可开启的宝箱", "You have no chests to open").into(),
        Some("LOTTERY_BUY_DISABLED") => tr("现在不能购买宝箱", "Chests cannot be bought right now").into(),
        Some("LOTTERY_BUY_LIMIT") => tr("已达到今日购买上限", "You have reached today's purchase limit").into(),
        Some("LOTTERY_INSUFFICIENT_BALANCE") => tr("余额不足，无法购买", "Not enough balance to buy").into(),
        Some("LOTTERY_BUY_SOLD_OUT") => match env.message.chars().filter(char::is_ascii_digit).collect::<String>() {
            n if n.is_empty() || n == "0" => tr("今日宝箱已售罄", "Chests are sold out for today").into(),
            n => tr_fmt!("今日仅剩 {n} 个可购买", "Only {n} left to buy today"),
        },
        Some("LOTTERY_CHEST_FULL") => tr("宝箱已满，先开启一些再购买", "Your chests are full. Open some before buying more.").into(),
        Some("LOTTERY_INVALID_COUNT") => tr("宝箱数量不正确", "That number of chests is not allowed").into(),
        Some("TRANSFER_INVALID_AMOUNT") => tr("转账金额至少 $10，最多两位小数", "Transfer at least $10, with at most two decimals").into(),
        Some("TRANSFER_PASSWORD_REQUIRED") => tr("请输入登录密码", "Enter your password").into(),
        Some("TRANSFER_PASSWORD_INCORRECT") => tr("登录密码不正确", "That password is not correct").into(),
        Some("TRANSFER_RECIPIENT_REQUIRED") => tr("请输入收款人的邮箱或用户名", "Enter the recipient's email or username").into(),
        Some("TRANSFER_RECIPIENT_NOT_FOUND") => tr("没有找到这个用户", "No account matches that").into(),
        Some("TRANSFER_RECIPIENT_AMBIGUOUS") => tr("有多个用户使用这个用户名，请改用邮箱", "Several accounts use that username. Use their email instead.").into(),
        Some("TRANSFER_RECIPIENT_UNAVAILABLE") => tr("收款账号已停用", "That account is disabled").into(),
        Some("TRANSFER_SELF") => tr("不能转给自己", "You cannot transfer to yourself").into(),
        Some("TRANSFER_INSUFFICIENT_BALANCE") => tr("余额不足", "Not enough balance").into(),
        Some("INVITE_NOT_ALLOWED") => tr("你的账号还不能生成邀请链接", "Your account cannot create invite links yet").into(),
        Some("INVITE_LIMIT") => tr("可用的邀请链接已达上限，先撤回或等它过期", "You have reached the limit of open invite links. Revoke one or wait for it to expire.").into(),
        Some("INVITE_NOT_FOUND") => tr("邀请链接不存在或已失效", "That invite link no longer exists").into(),
        Some("RATE_LIMITED") => tr("操作太频繁，请稍后再试", "Too many attempts. Try again later.").into(),
        _ => env.message.clone(),
    }
}

#[derive(Deserialize)]
struct Envelope {
    // Numeric on success; some middleware errors send a string code instead.
    #[serde(default, deserialize_with = "code_any")]
    code: i64,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    message: String,
    #[serde(default)]
    data: Option<Value>,
}

fn code_any<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<i64, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Number(n) => n.as_i64().unwrap_or(-1),
        _ => -1,
    })
}

pub struct Client {
    http: reqwest::Client,
    origin: String,
    admin_origin: String,
    user_agent: String,
}

/// HTTP verbs the admin pages use.
#[derive(Debug, Clone, Copy)]
pub enum Method {
    Get,
    Post,
    Put,
}

impl Client {
    pub fn new(origin: &str, admin_origin: &str, device_id: &str) -> Result<Self> {
        let ua = user_agent(device_id);
        let http = reqwest::Client::builder()
            .user_agent(ua.clone())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| Error::Network(e.to_string()))?;
        Ok(Self {
            http,
            origin: origin.trim_end_matches('/').to_string(),
            admin_origin: admin_origin.trim_end_matches('/').to_string(),
            user_agent: ua,
        })
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }

    /// The User-Agent every request carries; the relay ties the session to
    /// the device ID in it, so a WebSocket handshake must send it too.
    pub fn user_agent(&self) -> &str {
        &self.user_agent
    }

    /// Sends an authenticated request. Any 401 (expired, revoked, missing
    /// token) means the access token is no longer good.
    async fn send<T: DeserializeOwned>(&self, req: reqwest::RequestBuilder) -> Result<T> {
        match self.send_raw(req).await {
            Err(Unauth401(_)) => Err(Error::Unauthorized),
            Err(Other(e)) => Err(e),
            Ok(v) => Ok(v),
        }
    }

    /// Sends a login-type request, where a 401 carries a message for the user
    /// (wrong password, bad 2FA code) rather than meaning "session expired".
    async fn send_public<T: DeserializeOwned>(&self, req: reqwest::RequestBuilder) -> Result<T> {
        match self.send_raw(req).await {
            Err(Unauth401(Some(env))) => Err(Error::Api(friendly(&env))),
            Err(Unauth401(None)) => Err(Error::Api(bad_credentials().into())),
            Err(Other(e)) => Err(e),
            Ok(v) => Ok(v),
        }
    }

    async fn send_raw<T: DeserializeOwned>(&self, req: reqwest::RequestBuilder) -> std::result::Result<T, RawErr> {
        let resp = req.send().await.map_err(|e| Other(Error::Network(e.to_string())))?;
        let status = resp.status();
        let body = resp.text().await.map_err(|e| Other(Error::Network(e.to_string())))?;
        let parsed = serde_json::from_str::<Envelope>(&body);
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(Unauth401(parsed.ok().filter(|e| !e.message.is_empty())));
        }
        let env: Envelope = parsed.map_err(|_| {
            Other(if status == reqwest::StatusCode::FORBIDDEN {
                // The relay serves an HTML page to blocked regions.
                Error::Api(
                    tr(
                        "中转站拒绝了这次请求（403），可能是所在地区受限",
                        "The relay refused this request (403); your region may be restricted",
                    )
                    .into(),
                )
            } else {
                Error::Api(tr_fmt!(
                    "中转站返回了无法识别的响应（HTTP {status}）",
                    "The relay sent a response we could not read (HTTP {status})"
                ))
            })
        })?;
        if env.code != 0 {
            return Err(Other(Error::Api(if env.message.is_empty() {
                format!("HTTP {status}")
            } else {
                friendly(&env)
            })));
        }
        serde_json::from_value(env.data.unwrap_or(Value::Null))
            .map_err(|e| Other(Error::Api(tr_fmt!("响应格式不符：{e}", "Unexpected response format: {e}"))))
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.origin, path)
    }

    fn admin_url(&self, path: &str) -> String {
        format!("{}/api/v1/admin{}", self.admin_origin, path)
    }

    /// An admin API call on the ops origin with the same bearer token and
    /// device-bound User-Agent. `path` is relative to `/api/v1/admin`.
    /// Writes carry an `Idempotency-Key`, which some admin routes require.
    pub async fn admin(
        &self,
        access: &str,
        method: Method,
        path: &str,
        query: &[(String, String)],
        body: Option<&Value>,
    ) -> Result<Value> {
        let url = self.admin_url(path);
        let req = match method {
            Method::Get => self.http.get(url),
            Method::Post => self.http.post(url),
            Method::Put => self.http.put(url),
        };
        let mut req = req.query(query).bearer_auth(access);
        if !matches!(method, Method::Get) {
            req = req.header("Idempotency-Key", uuid::Uuid::new_v4().to_string());
        }
        if let Some(b) = body {
            req = req.json(b);
        }
        self.send(req).await
    }

    /// The lucky draw as this account sees it today.
    pub async fn lottery(&self, access: &str) -> Result<Value> {
        self.send(self.http.get(self.url("/api/v1/lottery")).bearer_auth(access)).await
    }

    /// Opens up to `count` chests (1..10), today's low-spend ones first; the relay picks the prizes.
    pub async fn lottery_open(&self, access: &str, count: u32) -> Result<Value> {
        self.send(self.http.post(self.url("/api/v1/lottery/open")).bearer_auth(access).json(&json!({ "count": count }))).await
    }

    /// Buys chests with balance.
    pub async fn lottery_buy(&self, access: &str, count: u32) -> Result<Value> {
        self.send(self.http.post(self.url("/api/v1/lottery/buy")).bearer_auth(access).json(&json!({ "count": count }))).await
    }

    /// 小丑斗地主 lobby: `{ enabled, stakes, min_balance_times }`.
    pub async fn ddz(&self, access: &str) -> Result<Value> {
        self.send(self.http.get(self.url("/api/v1/ddz")).bearer_auth(access)).await
    }

    /// My running tally against the player or AI in `seat` at my current table.
    pub async fn ddz_versus(&self, access: &str, seat: u8) -> Result<Value> {
        self.send(self.http.get(self.url("/api/v1/ddz/versus")).query(&[("seat", seat)]).bearer_auth(access)).await
    }

    pub async fn redeem(&self, access: &str, code: &str) -> Result<Value> {
        self.send(self.http.post(self.url("/api/v1/redeem")).bearer_auth(access).json(&json!({ "code": code }))).await
    }

    /// Paged: `{ items, total, page, page_size }`.
    pub async fn redeem_history(&self, access: &str, page: u32, page_size: u32) -> Result<Value> {
        let q = [("page", page.max(1)), ("page_size", page_size.clamp(1, 100))];
        self.send(self.http.get(self.url("/api/v1/redeem/history")).query(&q).bearer_auth(access)).await
    }

    /// Time-limited token packs, newest first: `[{ group_name, tokens_total, tokens_used, expires_at, status }]`.
    pub async fn token_packs(&self, access: &str) -> Result<Value> {
        self.send(self.http.get(self.url("/api/v1/redeem/token-packs")).bearer_auth(access)).await
    }

    /// Moves balance to another account found by email or username; the password confirms it.
    pub async fn transfer(&self, access: &str, recipient: &str, amount: f64, password: &str) -> Result<Value> {
        let body = json!({ "recipient": recipient, "amount": amount, "password": password });
        self.send(self.http.post(self.url("/api/v1/transfer")).bearer_auth(access).json(&body)).await
    }

    /// `{ allowed, limit, open, ttl_days, items }`; `allowed` is false unless the admin turned invites on.
    pub async fn invites(&self, access: &str) -> Result<Value> {
        self.send(self.http.get(self.url("/api/v1/invites")).bearer_auth(access)).await
    }

    pub async fn invite_create(&self, access: &str) -> Result<Value> {
        self.send(self.http.post(self.url("/api/v1/invites")).bearer_auth(access)).await
    }

    pub async fn invite_revoke(&self, access: &str, id: i64) -> Result<Value> {
        self.send(self.http.delete(self.url(&format!("/api/v1/invites/{id}"))).bearer_auth(access)).await
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<(LoginOutcome, Option<Tokens>)> {
        let v: Value = self
            .send_public(self.http.post(self.url("/api/v1/auth/login")).json(&json!({
                "email": email,
                "password": password,
            })))
            .await?;
        Self::finish_login(v)
    }

    pub async fn login_2fa(&self, temp_token: &str, code: &str) -> Result<(LoginOutcome, Option<Tokens>)> {
        let v: Value = self
            .send_public(self.http.post(self.url("/api/v1/auth/login/2fa")).json(&json!({
                "temp_token": temp_token,
                "totp_code": code,
            })))
            .await?;
        Self::finish_login(v)
    }

    fn finish_login(v: Value) -> Result<(LoginOutcome, Option<Tokens>)> {
        if v.get("requires_2fa").and_then(Value::as_bool) == Some(true) {
            let temp_token = v["temp_token"].as_str().unwrap_or_default().to_string();
            let email_masked = v["user_email_masked"].as_str().unwrap_or_default().to_string();
            return Ok((LoginOutcome::TwoFactor { temp_token, email_masked }, None));
        }
        let tokens: Tokens =
            serde_json::from_value(v.clone()).map_err(|e| Error::Api(tr_fmt!("登录响应缺少令牌：{e}", "The sign-in response had no token: {e}")))?;
        let user: User = serde_json::from_value(v["user"].clone())
            .map_err(|e| Error::Api(tr_fmt!("登录响应缺少用户信息：{e}", "The sign-in response had no user: {e}")))?;
        Ok((LoginOutcome::Done { user }, Some(tokens)))
    }

    pub async fn refresh(&self, refresh_token: &str) -> Result<Tokens> {
        self.send(
            self.http
                .post(self.url("/api/v1/auth/refresh"))
                .json(&json!({ "refresh_token": refresh_token })),
        )
        .await
    }

    pub async fn logout(&self, refresh_token: Option<&str>) {
        let body = json!({ "refresh_token": refresh_token.unwrap_or_default() });
        let _ = self.http.post(self.url("/api/v1/auth/logout")).json(&body).send().await;
    }

    pub async fn profile(&self, access: &str) -> Result<User> {
        self.send(self.http.get(self.url("/api/v1/user/profile")).bearer_auth(access)).await
    }

    pub async fn groups(&self, access: &str) -> Result<Vec<Group>> {
        self.send(self.http.get(self.url("/api/v1/groups/available")).bearer_auth(access)).await
    }

    /// The account's own multipliers by group id, where an admin set one.
    pub async fn group_rates(&self, access: &str) -> Result<std::collections::HashMap<i64, f64>> {
        let m: Option<std::collections::HashMap<String, f64>> =
            self.send(self.http.get(self.url("/api/v1/groups/rates")).bearer_auth(access)).await?;
        Ok(m.unwrap_or_default().into_iter().filter_map(|(k, v)| Some((k.parse().ok()?, v))).collect())
    }

    /// Yuan per US dollar as set in the relay admin (the subscription
    /// exchange rate); 0 when unset.
    pub async fn cny_per_usd(&self, access: &str) -> Result<f64> {
        let v: Value = self.send(self.http.get(self.url("/api/v1/payment/config")).bearer_auth(access)).await?;
        Ok(v.get("subscription_usd_to_cny_rate").and_then(Value::as_f64).unwrap_or(0.0))
    }

    pub async fn keys(&self, access: &str) -> Result<Vec<ApiKey>> {
        self.key_page(access).await
    }

    /// Every key with all the fields the relay sends, for the keys page.
    pub async fn keys_full(&self, access: &str) -> Result<Vec<serde_json::Map<String, Value>>> {
        self.key_page(access).await
    }

    async fn key_page<T: DeserializeOwned>(&self, access: &str) -> Result<Vec<T>> {
        #[derive(Deserialize)]
        struct Page<T> {
            items: Vec<T>,
        }
        let p: Page<T> = self
            .send(
                self.http
                    .get(self.url("/api/v1/keys"))
                    .query(&[("page", "1"), ("page_size", "1000")])
                    .bearer_auth(access),
            )
            .await?;
        Ok(p.items)
    }

    /// Creates a key from the relay's create body (name, group_id, quota, ...).
    pub async fn create_key_with(&self, access: &str, body: &Value) -> Result<Value> {
        self.send(self.http.post(self.url("/api/v1/keys")).bearer_auth(access).json(body)).await
    }

    /// Changes only the fields present in `body`.
    pub async fn update_key(&self, access: &str, id: i64, body: &Value) -> Result<Value> {
        self.send(self.http.put(self.url(&format!("/api/v1/keys/{id}"))).bearer_auth(access).json(body)).await
    }

    /// Today's and the last 7 days' spend per key id. The relay takes at most
    /// 100 ids per call; relays before `.66` ignore `days` and send 30 days.
    pub async fn key_costs(&self, access: &str, ids: &[i64]) -> Result<std::collections::HashMap<i64, KeyCost>> {
        #[derive(Deserialize)]
        struct Out {
            #[serde(default)]
            stats: std::collections::HashMap<String, KeyCost>,
        }
        let mut all = std::collections::HashMap::new();
        for chunk in ids.chunks(100) {
            let o: Out = self
                .send(
                    self.http
                        .post(self.url("/api/v1/usage/dashboard/api-keys-usage"))
                        .bearer_auth(access)
                        .json(&key_costs_body(chunk)),
                )
                .await?;
            all.extend(o.stats.into_iter().filter_map(|(k, v)| Some((k.parse().ok()?, v))));
        }
        Ok(all)
    }

    /// The service status probes, one per monitored provider route.
    pub async fn monitors(&self, access: &str) -> Result<Value> {
        self.send(self.http.get(self.url("/api/v1/channel-monitors")).bearer_auth(access)).await
    }

    pub async fn create_key(&self, access: &str, name: &str, group_id: i64) -> Result<ApiKey> {
        self.send(
            self.http
                .post(self.url("/api/v1/keys"))
                .bearer_auth(access)
                .json(&json!({ "name": name, "group_id": group_id })),
        )
        .await
    }

    pub async fn delete_key(&self, access: &str, id: i64) -> Result<()> {
        let _: Value = self
            .send(self.http.delete(self.url(&format!("/api/v1/keys/{id}"))).bearer_auth(access))
            .await?;
        Ok(())
    }

    /// Usage dashboard data passed through as the relay returns it: `stats`
    /// for the totals, `snapshot` for the trend and per-model breakdown.
    /// `query` holds `start_date`, `end_date`, `timezone` and, optionally,
    /// `api_key_id` and `granularity`.
    pub async fn usage(&self, access: &str, kind: UsageKind, query: &[(String, String)]) -> Result<Value> {
        let path = match kind {
            UsageKind::Stats => "/api/v1/usage/stats",
            UsageKind::Snapshot => "/api/v1/usage/dashboard/snapshot-v2",
            UsageKind::Records => "/api/v1/usage",
        };
        self.send(self.http.get(self.url(path)).query(query).bearer_auth(access)).await
    }

    /// Model ids the key's group serves. All relay platforms answer with a
    /// `data: [{ id }]` list, whatever else they include.
    pub async fn models(&self, api_key: &str) -> Result<Vec<String>> {
        let resp = self
            .http
            .get(self.url("/v1/models"))
            .bearer_auth(api_key)
            .header("x-api-key", api_key)
            .send()
            .await
            .map_err(|e| Error::Network(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(Error::Api(tr_fmt!(
                "获取模型列表失败（HTTP {}）",
                "Could not load the model list (HTTP {})",
                resp.status()
            )));
        }
        let v: Value = resp.json().await.map_err(|e| Error::Api(e.to_string()))?;
        Ok(parse_model_ids(&v))
    }
}

pub fn parse_model_ids(v: &Value) -> Vec<String> {
    let mut ids: Vec<String> = v
        .get("data")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|m| m.get("id")?.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    ids.dedup();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    // Must match desktopDeviceID in the relay's internal/service/session_binding.go.
    #[test]
    fn user_agent_carries_the_device_id() {
        let ua = user_agent("3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f");
        assert!(ua.starts_with("CloudborneDesktop/"));
        assert!(ua.ends_with("; device=3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f)"));
    }

    #[test]
    fn parses_model_ids_from_any_platform_shape() {
        let anthropic = json!({ "data": [{ "id": "claude-a", "type": "model" }], "has_more": false });
        let openai = json!({ "object": "list", "data": [{ "id": "gpt-x", "object": "model" }, { "id": "gpt-y" }] });
        assert_eq!(parse_model_ids(&anthropic), ["claude-a"]);
        assert_eq!(parse_model_ids(&openai), ["gpt-x", "gpt-y"]);
        assert!(parse_model_ids(&json!({})).is_empty());
    }

    #[test]
    fn envelope_accepts_string_codes() {
        let e: Envelope = serde_json::from_str(r#"{"code":"UNAUTHORIZED","message":"x"}"#).unwrap();
        assert_eq!(e.code, -1);
        let e: Envelope =
            serde_json::from_str(r#"{"code":401,"message":"invalid email or password","reason":"INVALID_CREDENTIALS"}"#)
                .unwrap();
        assert_eq!(friendly(&e), "邮箱或密码不正确");
    }

    #[test]
    fn admin_calls_go_to_ops_unless_overridden() {
        assert_eq!(admin_origin(None), "https://ops.cloudborne.cn");
        assert_eq!(admin_origin(Some("  ")), "https://ops.cloudborne.cn");
        assert_eq!(admin_origin(Some("http://127.0.0.1:8080/")), "http://127.0.0.1:8080");
        let c = Client::new("https://api.cloudborne.cn", "https://ops.cloudborne.cn", "d").unwrap();
        assert_eq!(c.admin_url("/users/3/balance"), "https://ops.cloudborne.cn/api/v1/admin/users/3/balance");
    }

    #[test]
    fn lottery_errors_are_worded() {
        let e: Envelope =
            serde_json::from_str(r#"{"code":409,"message":"x","reason":"LOTTERY_NO_CHESTS"}"#).unwrap();
        assert_eq!(friendly(&e), "没有可开启的宝箱");
        let e: Envelope =
            serde_json::from_str(r#"{"code":409,"message":"x","reason":"LOTTERY_INSUFFICIENT_BALANCE"}"#).unwrap();
        assert_eq!(friendly(&e), "余额不足，无法购买");
        let e: Envelope =
            serde_json::from_str(r#"{"code":409,"message":"今日仅剩 3 个可购买","reason":"LOTTERY_BUY_SOLD_OUT"}"#).unwrap();
        assert_eq!(friendly(&e), "今日仅剩 3 个可购买");
        let e: Envelope =
            serde_json::from_str(r#"{"code":409,"message":"今日宝箱已售罄","reason":"LOTTERY_BUY_SOLD_OUT"}"#).unwrap();
        assert_eq!(friendly(&e), "今日宝箱已售罄");
    }

    #[test]
    fn redeem_errors_are_worded() {
        let e: Envelope =
            serde_json::from_str(r#"{"code":409,"message":"redeem code already used","reason":"REDEEM_CODE_USED"}"#).unwrap();
        assert_eq!(friendly(&e), "这个兑换码已经用过了");
        let e: Envelope =
            serde_json::from_str(r#"{"code":404,"message":"redeem code not found","reason":"REDEEM_CODE_NOT_FOUND"}"#).unwrap();
        assert_eq!(friendly(&e), "兑换码不存在，请检查后重试");
    }

    #[test]
    fn key_costs_ask_for_seven_days() {
        assert_eq!(key_costs_body(&[3, 4]), json!({ "api_key_ids": [3, 4], "days": 7 }));
    }

    #[test]
    fn profile_role_defaults_to_empty() {
        let u: User = serde_json::from_value(json!({ "id": 1, "email": "a@b.c" })).unwrap();
        assert_eq!(u.role, "");
        let u: User = serde_json::from_value(json!({ "id": 1, "email": "a@b.c", "role": "admin" })).unwrap();
        assert_eq!(u.role, "admin");
    }

    #[test]
    fn login_needing_2fa() {
        let (o, t) = Client::finish_login(json!({
            "requires_2fa": true, "temp_token": "tmp", "user_email_masked": "a***@b.c"
        }))
        .unwrap();
        assert!(t.is_none());
        assert!(matches!(o, LoginOutcome::TwoFactor { ref temp_token, .. } if temp_token == "tmp"));
    }

    #[test]
    fn login_success() {
        let (o, t) = Client::finish_login(json!({
            "access_token": "acc", "refresh_token": "ref", "expires_in": 900, "token_type": "Bearer",
            "user": { "id": 7, "email": "a@b.c", "username": "a", "balance": 12.5, "status": "active" }
        }))
        .unwrap();
        assert_eq!(t.unwrap().refresh_token.as_deref(), Some("ref"));
        assert!(matches!(o, LoginOutcome::Done { ref user } if user.balance == 12.5));
    }
}
