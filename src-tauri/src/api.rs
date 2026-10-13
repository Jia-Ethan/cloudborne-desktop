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

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct KeyCost {
    #[serde(default)]
    pub today_actual_cost: f64,
    /// Last 30 days.
    #[serde(default)]
    pub total_actual_cost: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageKind {
    Stats,
    Snapshot,
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

fn bad_credentials() -> &'static str {
    tr("邮箱或密码不正确", "Wrong email or password")
}

/// Localized wording for the relay's common auth errors; anything else is shown as sent.
fn friendly(env: &Envelope) -> String {
    match env.reason.as_deref() {
        Some("INVALID_CREDENTIALS") => bad_credentials().into(),
        Some("USER_NOT_ACTIVE") | Some("USER_DISABLED") => tr("这个账号已被停用", "This account has been disabled").into(),
        Some("INVALID_TOTP_CODE") | Some("TOTP_INVALID") => tr("验证码不正确", "That code is not correct").into(),
        Some("LOTTERY_DISABLED") => tr("抽奖活动未开启", "The lucky draw is not running").into(),
        Some("LOTTERY_NO_DRAWS") => tr("今天的抽奖次数已用完", "No draws left today").into(),
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
        let http = reqwest::Client::builder()
            .user_agent(user_agent(device_id))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| Error::Network(e.to_string()))?;
        Ok(Self {
            http,
            origin: origin.trim_end_matches('/').to_string(),
            admin_origin: admin_origin.trim_end_matches('/').to_string(),
        })
    }

    pub fn origin(&self) -> &str {
        &self.origin
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

    /// Draws once; the relay picks the prize.
    pub async fn lottery_draw(&self, access: &str) -> Result<Value> {
        self.send(self.http.post(self.url("/api/v1/lottery/draw")).bearer_auth(access).json(&json!({}))).await
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

    /// Today's and the last 30 days' spend per key id. The relay takes at most
    /// 100 ids per call.
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
                        .json(&json!({ "api_key_ids": chunk })),
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
            serde_json::from_str(r#"{"code":409,"message":"x","reason":"LOTTERY_NO_DRAWS"}"#).unwrap();
        assert_eq!(friendly(&e), "今天的抽奖次数已用完");
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
