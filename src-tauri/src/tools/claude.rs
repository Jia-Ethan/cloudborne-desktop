//! Claude Code reads `env` from `~/.claude/settings.json`. We set the base URL
//! and token there, record whatever those keys held before, and put it back on
//! disconnect. Every other key in the file is left as it was.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use super::Connection;
use crate::error::{Error, Result};
use crate::{fsx, state};

const TOOL: &str = "claude";
const BASE_URL: &str = "ANTHROPIC_BASE_URL";
const TOKEN: &str = "ANTHROPIC_AUTH_TOKEN";
// An API key set alongside the token makes Claude Code warn about conflicting
// credentials and pick one of them, so it is parked while we are connected.
const API_KEY: &str = "ANTHROPIC_API_KEY";
const MANAGED: [&str; 3] = [BASE_URL, TOKEN, API_KEY];

pub fn settings_path(home: &Path) -> PathBuf {
    home.join(".claude").join("settings.json")
}

fn load(path: &Path) -> Result<Map<String, Value>> {
    let text = fsx::read_or_empty(path)?;
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err(Error::Config("~/.claude/settings.json 顶层不是对象".into())),
        Err(e) => Err(Error::Config(format!("~/.claude/settings.json: {e}"))),
    }
}

fn render(m: &Map<String, Value>, original: &str) -> String {
    fsx::render_json_like(&Value::Object(m.clone()), original)
}

// Key under which the original order of `env` is recorded, so a key we parked
// goes back to the same position.
const ORDER: &str = "__env_order";

fn env_of(m: &Map<String, Value>) -> Option<&Map<String, Value>> {
    m.get("env").and_then(Value::as_object)
}

pub fn is_connected(home: &Path) -> Result<bool> {
    let st = state::load(home)?;
    if !st.previous.contains_key(TOOL) {
        return Ok(false);
    }
    let m = load(&settings_path(home))?;
    Ok(env_of(&m).and_then(|e| e.get(TOKEN)).is_some())
}

pub fn connect(home: &Path, conn: &Connection) -> Result<Vec<PathBuf>> {
    let path = settings_path(home);
    let raw = fsx::read_or_empty(&path)?;
    let mut m = load(&path)?;
    let mut st = state::load(home)?;

    if !m.get("env").map_or(true, Value::is_object) {
        return Err(Error::Config("~/.claude/settings.json 里的 env 不是对象".into()));
    }
    let env = m
        .entry("env")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .expect("checked above");

    // Record originals only on the first connect, so reconnecting does not
    // mistake our own values for the user's.
    if !st.previous.contains_key(TOOL) {
        let mut prev: std::collections::BTreeMap<String, Value> = MANAGED
            .iter()
            .map(|k| (k.to_string(), env.get(*k).cloned().unwrap_or(Value::Null)))
            .collect();
        prev.insert(ORDER.into(), Value::Array(env.keys().cloned().map(Value::String).collect()));
        st.previous.insert(TOOL.into(), prev);
    }

    // Claude Code appends /v1/messages itself, so it gets the bare origin.
    env.insert(BASE_URL.into(), Value::String(conn.origin.trim_end_matches('/').into()));
    env.insert(TOKEN.into(), Value::String(conn.api_key.clone()));
    env.remove(API_KEY);

    state::save(home, &st)?;
    let bak = fsx::replace_verified(&path, &render(&m, &raw), |t| {
        let v: Value = serde_json::from_str(t).map_err(|e| Error::Config(e.to_string()))?;
        if v.pointer("/env/ANTHROPIC_AUTH_TOKEN").is_none() {
            return Err(Error::Config("写入后校验失败：缺少 ANTHROPIC_AUTH_TOKEN".into()));
        }
        Ok(())
    })?;
    Ok(bak.into_iter().collect())
}

pub fn disconnect(home: &Path) -> Result<Vec<PathBuf>> {
    let mut st = state::load(home)?;
    let Some(prev) = st.previous.remove(TOOL) else {
        return Ok(vec![]);
    };
    let path = settings_path(home);
    let raw = fsx::read_or_empty(&path)?;
    let mut m = load(&path)?;
    if let Some(env) = m.get_mut("env").and_then(Value::as_object_mut) {
        for k in MANAGED {
            match prev.get(k) {
                Some(Value::Null) | None => {
                    env.remove(k);
                }
                Some(v) => {
                    env.insert(k.into(), v.clone());
                }
            }
        }
        if let Some(order) = prev.get(ORDER).and_then(Value::as_array) {
            *env = reorder(std::mem::take(env), order);
        }
        if env.is_empty() {
            m.remove("env");
        }
    }
    let bak = fsx::replace_verified(&path, &render(&m, &raw), |t| {
        serde_json::from_str::<Value>(t).map(|_| ()).map_err(|e| Error::Config(e.to_string()))
    })?;
    state::save(home, &st)?;
    Ok(bak.into_iter().collect())
}

/// Puts keys back in their recorded order; keys added since go after them.
fn reorder(mut env: Map<String, Value>, order: &[Value]) -> Map<String, Value> {
    let mut out = Map::new();
    for k in order.iter().filter_map(Value::as_str) {
        if let Some(v) = env.remove(k) {
            out.insert(k.into(), v);
        }
    }
    out.extend(env);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::test_conn;
    use std::fs;

    fn home_with(text: Option<&str>) -> tempfile::TempDir {
        let h = tempfile::tempdir().unwrap();
        if let Some(t) = text {
            fs::create_dir_all(h.path().join(".claude")).unwrap();
            fs::write(settings_path(h.path()), t).unwrap();
        }
        h
    }

    fn read(h: &tempfile::TempDir) -> Value {
        serde_json::from_str(&fs::read_to_string(settings_path(h.path())).unwrap()).unwrap()
    }

    #[test]
    fn connects_from_nothing_and_disconnects_to_empty() {
        let h = home_with(None);
        connect(h.path(), &test_conn()).unwrap();
        let v = read(&h);
        assert_eq!(v["env"]["ANTHROPIC_BASE_URL"], "https://relay.example");
        assert_eq!(v["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-test-123");
        assert!(is_connected(h.path()).unwrap());
        disconnect(h.path()).unwrap();
        assert_eq!(read(&h), serde_json::json!({}));
        assert!(!is_connected(h.path()).unwrap());
    }

    #[test]
    fn restores_user_values_and_keeps_order_of_other_keys() {
        let original = r#"{
  "model": "opus",
  "env": {
    "DISABLE_TELEMETRY": "1",
    "ANTHROPIC_BASE_URL": "https://other.example",
    "ANTHROPIC_API_KEY": "sk-user"
  },
  "permissions": { "allow": ["Bash(ls)"] }
}"#;
        let h = home_with(Some(original));
        connect(h.path(), &test_conn()).unwrap();
        let v = read(&h);
        assert!(v["env"].get("ANTHROPIC_API_KEY").is_none());
        assert_eq!(v["env"]["DISABLE_TELEMETRY"], "1");
        assert_eq!(v["permissions"]["allow"][0], "Bash(ls)");

        connect(h.path(), &test_conn()).unwrap(); // reconnect must not lose originals
        disconnect(h.path()).unwrap();
        let after: Value = read(&h);
        assert_eq!(after, serde_json::from_str::<Value>(original).unwrap());
        let env_keys: Vec<_> = after["env"].as_object().unwrap().keys().cloned().collect();
        assert_eq!(env_keys, ["DISABLE_TELEMETRY", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY"]);
        let keys: Vec<_> = after.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["model", "env", "permissions"]);
    }

    #[test]
    fn refuses_broken_json() {
        let h = home_with(Some("{ not json"));
        assert!(connect(h.path(), &test_conn()).is_err());
        assert_eq!(fs::read_to_string(settings_path(h.path())).unwrap(), "{ not json");
    }
}
