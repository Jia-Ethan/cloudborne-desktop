//! Client for the relay's user API (`/api/v1/...`) and model list (`/v1/models`).
//! Responses use the envelope `{ code, message, data }`; `code == 0` is success.

use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{Error, Result};

pub const DEFAULT_ORIGIN: &str = "https://api.cloudborne.cn";
const UA: &str = concat!("CloudborneDesktop/", env!("CARGO_PKG_VERSION"));

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

/// Chinese wording for the relay's common auth errors; anything else is shown as sent.
fn friendly(env: &Envelope) -> String {
    match env.reason.as_deref() {
        Some("INVALID_CREDENTIALS") => "邮箱或密码不正确".into(),
        Some("USER_NOT_ACTIVE") | Some("USER_DISABLED") => "这个账号已被停用".into(),
        Some("INVALID_TOTP_CODE") | Some("TOTP_INVALID") => "验证码不正确".into(),
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
}

impl Client {
    pub fn new(origin: &str) -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(UA)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| Error::Network(e.to_string()))?;
        Ok(Self { http, origin: origin.trim_end_matches('/').to_string() })
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
            Err(Unauth401(None)) => Err(Error::Api("邮箱或密码不正确".into())),
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
                Error::Api("中转站拒绝了这次请求（403），可能是所在地区受限".into())
            } else {
                Error::Api(format!("中转站返回了无法识别的响应（HTTP {status}）"))
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
            .map_err(|e| Other(Error::Api(format!("响应格式不符：{e}"))))
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.origin, path)
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
            serde_json::from_value(v.clone()).map_err(|e| Error::Api(format!("登录响应缺少令牌：{e}")))?;
        let user: User = serde_json::from_value(v["user"].clone())
            .map_err(|e| Error::Api(format!("登录响应缺少用户信息：{e}")))?;
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

    pub async fn keys(&self, access: &str) -> Result<Vec<ApiKey>> {
        #[derive(Deserialize)]
        struct Page {
            items: Vec<ApiKey>,
        }
        let p: Page = self
            .send(
                self.http
                    .get(self.url("/api/v1/keys"))
                    .query(&[("page", "1"), ("page_size", "1000")])
                    .bearer_auth(access),
            )
            .await?;
        Ok(p.items)
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
            return Err(Error::Api(format!("获取模型列表失败（HTTP {}）", resp.status())));
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
