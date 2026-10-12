//! Pi keeps custom endpoints in `~/.pi/agent/models.json` and its startup
//! model in `~/.pi/agent/settings.json` (both under `PI_CODING_AGENT_DIR` when
//! that is set). We add one provider with our own id to `models.json`, point
//! `defaultProvider`/`defaultModel` at it, record what those two keys held
//! before, and put them back on disconnect.
//!
//! The relay speaks every protocol on one origin, so the provider's `api`
//! follows the group's platform: Responses for GPT and Grok, Messages for
//! Claude, Chat Completions for the domestic models.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use super::{no_models, Connection};
use crate::error::{Error, Result};
use crate::lang::tr;
use crate::{fsx, state, tr_fmt};

pub const PROVIDER_ID: &str = "cloudborne";
const TOOL: &str = "pi";
const MANAGED: [&str; 2] = ["defaultProvider", "defaultModel"];

pub fn agent_dir(home: &Path) -> PathBuf {
    match std::env::var_os("PI_CODING_AGENT_DIR") {
        // Tests point everything at a temp home; ignore the user's override there.
        Some(d) if std::env::var_os("CLOUDBORNE_HOME").is_none() && !cfg!(test) => PathBuf::from(d),
        _ => home.join(".pi").join("agent"),
    }
}

pub fn models_path(home: &Path) -> PathBuf {
    agent_dir(home).join("models.json")
}

pub fn settings_path(home: &Path) -> PathBuf {
    agent_dir(home).join("settings.json")
}

fn load(path: &Path) -> Result<Map<String, Value>> {
    let text = fsx::read_or_empty(path)?;
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err(Error::Config(tr_fmt!("{}: 顶层不是对象", "{}: not a JSON object", path.display()))),
        Err(e) => Err(Error::Config(format!("{}: {e}", path.display()))),
    }
}

fn render(m: &Map<String, Value>, original: &str) -> String {
    fsx::render_json_like(&Value::Object(m.clone()), original)
}

/// Pi's API implementation and base URL for a relay group platform.
fn api_for(platform: &str, conn: &Connection) -> (&'static str, String) {
    match platform {
        // Pi's Anthropic client appends /v1/messages itself.
        "anthropic" => ("anthropic-messages", conn.origin.trim_end_matches('/').to_string()),
        "openai" | "grok" => ("openai-responses", conn.v1()),
        _ => ("openai-completions", conn.v1()),
    }
}

/// Per-model metadata Pi needs to budget context and offer thinking levels.
/// Pi's defaults (128k context, 16k output, no reasoning) undersell every
/// model the relay serves.
fn model(id: &str, platform: &str) -> Value {
    let (context, output, image) = match platform {
        "anthropic" => (1_000_000, 128_000, true),
        "openai" => (272_000, 128_000, true),
        "grok" => (500_000, 128_000, true),
        _ => (200_000, 32_000, false),
    };
    let mut m = json!({
        "id": id,
        "name": format!("{id} (Cloudborne)"),
        "reasoning": true,
        "input": if image { json!(["text", "image"]) } else { json!(["text"]) },
        "contextWindow": context,
        "maxTokens": output,
    });
    if platform == "anthropic" && adaptive_claude(id) {
        // Current Claude models only take an effort level; budget-style thinking is rejected.
        m["compat"] = json!({ "forceAdaptiveThinking": true });
        m["thinkingLevelMap"] = json!({ "xhigh": "xhigh", "max": "max" });
    } else if platform == "openai" {
        m["thinkingLevelMap"] = json!({ "minimal": null, "xhigh": "xhigh" });
    }
    m
}

/// Claude 4.6 and later use adaptive thinking.
fn adaptive_claude(id: &str) -> bool {
    let nums: Vec<u32> = id
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty() && s.len() < 4)
        .filter_map(|s| s.parse().ok())
        .collect();
    match nums.as_slice() {
        [] => true,
        [major, ..] if *major >= 5 => true,
        [4, minor, ..] => *minor >= 6,
        _ => false,
    }
}

fn provider(conn: &Connection) -> Value {
    let platform = conn.platform.as_str();
    let (api, base) = api_for(platform, conn);
    json!({
        "name": "Cloudborne",
        "baseUrl": base,
        "api": api,
        "apiKey": conn.api_key,
        "models": conn.models.iter().map(|id| model(id, platform)).collect::<Vec<_>>(),
    })
}

/// The model Pi should start with: the first that is not a small variant.
fn default_model(models: &[String]) -> &str {
    models
        .iter()
        .find(|m| !["mini", "nano", "flash", "haiku", "lite"].iter().any(|s| m.contains(s)))
        .or(models.first())
        .map(String::as_str)
        .unwrap_or_default()
}

pub fn is_connected(home: &Path) -> Result<bool> {
    let m = load(&models_path(home))?;
    Ok(m.get("providers").and_then(|p| p.get(PROVIDER_ID)).is_some())
}

pub fn connect(home: &Path, conn: &Connection) -> Result<Vec<PathBuf>> {
    if conn.models.is_empty() {
        return Err(Error::Other(no_models("Pi")));
    }
    let (mpath, spath) = (models_path(home), settings_path(home));
    let (mraw, sraw) = (fsx::read_or_empty(&mpath)?, fsx::read_or_empty(&spath)?);
    // Parse both before writing either.
    let (mut models, mut settings) = (load(&mpath)?, load(&spath)?);
    if !models.get("providers").map_or(true, Value::is_object) {
        return Err(Error::Config(tr("~/.pi/agent/models.json 里的 providers 不是对象", "providers in ~/.pi/agent/models.json is not an object").into()));
    }
    let mut st = state::load(home)?;

    models
        .entry("providers")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .expect("checked above")
        .insert(PROVIDER_ID.into(), provider(conn));

    // Record originals only on the first connect, so reconnecting does not
    // mistake our own values for the user's.
    if !st.previous.contains_key(TOOL) {
        let prev = MANAGED.iter().map(|k| (k.to_string(), settings.get(*k).cloned().unwrap_or(Value::Null))).collect();
        st.previous.insert(TOOL.into(), prev);
    }
    settings.insert("defaultProvider".into(), Value::String(PROVIDER_ID.into()));
    settings.insert("defaultModel".into(), Value::String(default_model(&conn.models).into()));

    let mut backups = vec![];
    backups.extend(fsx::replace_verified(&mpath, &render(&models, &mraw), |t| {
        let v: Value = serde_json::from_str(t).map_err(|e| Error::Config(e.to_string()))?;
        match v.pointer(&format!("/providers/{PROVIDER_ID}/baseUrl")) {
            Some(_) => Ok(()),
            None => Err(Error::Config(tr("写入后校验失败：缺少 cloudborne provider", "Check after writing failed: the cloudborne provider is missing").into())),
        }
    })?);
    state::save(home, &st)?;
    backups.extend(fsx::replace_verified(&spath, &render(&settings, &sraw), |t| {
        serde_json::from_str::<Value>(t).map(|_| ()).map_err(|e| Error::Config(e.to_string()))
    })?);
    Ok(backups)
}

pub fn disconnect(home: &Path) -> Result<Vec<PathBuf>> {
    let mut backups = vec![];
    let mpath = models_path(home);
    if mpath.exists() {
        let raw = fsx::read_or_empty(&mpath)?;
        let mut m = load(&mpath)?;
        let removed = m
            .get_mut("providers")
            .and_then(Value::as_object_mut)
            .and_then(|p| p.remove(PROVIDER_ID))
            .is_some();
        if removed {
            backups.extend(fsx::replace_verified(&mpath, &render(&m, &raw), |t| {
                serde_json::from_str::<Value>(t).map(|_| ()).map_err(|e| Error::Config(e.to_string()))
            })?);
        }
    }

    let mut st = state::load(home)?;
    let Some(prev) = st.previous.remove(TOOL) else {
        return Ok(backups);
    };
    let spath = settings_path(home);
    let raw = fsx::read_or_empty(&spath)?;
    let mut s = load(&spath)?;
    // Only undo our own choice; a default the user picked since stays.
    if s.get("defaultProvider").and_then(Value::as_str) == Some(PROVIDER_ID) {
        for k in MANAGED {
            match prev.get(k) {
                Some(Value::Null) | None => {
                    s.remove(k);
                }
                Some(v) => {
                    s.insert(k.into(), v.clone());
                }
            }
        }
        backups.extend(fsx::replace_verified(&spath, &render(&s, &raw), |t| {
            serde_json::from_str::<Value>(t).map(|_| ()).map_err(|e| Error::Config(e.to_string()))
        })?);
    }
    state::save(home, &st)?;
    Ok(backups)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::test_conn;
    use std::fs;

    const MODELS: &str = r#"{
  "providers": {
    "lgw": {
      "baseUrl": "https://lgw.example/v1",
      "api": "openai-completions",
      "apiKey": "sk-user",
      "models": [
        {
          "id": "x"
        }
      ]
    }
  }
}
"#;
    const SETTINGS: &str = r#"{
  "theme": "dark",
  "defaultProvider": "lgw",
  "defaultModel": "x",
  "defaultThinkingLevel": "max"
}
"#;

    fn home_with(models: Option<&str>, settings: Option<&str>) -> tempfile::TempDir {
        let h = tempfile::tempdir().unwrap();
        fs::create_dir_all(agent_dir(h.path())).unwrap();
        if let Some(t) = models {
            fs::write(models_path(h.path()), t).unwrap();
        }
        if let Some(t) = settings {
            fs::write(settings_path(h.path()), t).unwrap();
        }
        h
    }

    fn read(p: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(p).unwrap()).unwrap()
    }

    #[test]
    fn adds_provider_sets_default_and_restores_exactly() {
        let h = home_with(Some(MODELS), Some(SETTINGS));
        let mut c = test_conn();
        c.models = vec!["gpt-6-mini".into(), "gpt-6-luna".into()];
        connect(h.path(), &c).unwrap();
        let m = read(&models_path(h.path()));
        let p = &m["providers"]["cloudborne"];
        assert_eq!(p["api"], "openai-responses");
        assert_eq!(p["baseUrl"], "https://relay.example/v1");
        assert_eq!(p["apiKey"], "sk-test-123");
        assert_eq!(p["models"][1]["id"], "gpt-6-luna");
        assert_eq!(m["providers"]["lgw"]["apiKey"], "sk-user");
        let s = read(&settings_path(h.path()));
        assert_eq!(s["defaultProvider"], "cloudborne");
        assert_eq!(s["defaultModel"], "gpt-6-luna");
        assert!(is_connected(h.path()).unwrap());

        connect(h.path(), &c).unwrap(); // reconnect must not lose originals
        disconnect(h.path()).unwrap();
        assert_eq!(fs::read_to_string(models_path(h.path())).unwrap(), MODELS);
        assert_eq!(fs::read_to_string(settings_path(h.path())).unwrap(), SETTINGS);
        assert!(!is_connected(h.path()).unwrap());
    }

    #[test]
    fn claude_groups_use_messages_on_the_bare_origin() {
        let h = home_with(None, None);
        let mut c = test_conn();
        c.models = vec!["claude-opus-5-5".into(), "claude-haiku-4-5".into()];
        c.platform = "anthropic".into();
        connect(h.path(), &c).unwrap();
        let p = &read(&models_path(h.path()))["providers"]["cloudborne"];
        assert_eq!(p["api"], "anthropic-messages");
        assert_eq!(p["baseUrl"], "https://relay.example");
        assert_eq!(p["models"][0]["compat"]["forceAdaptiveThinking"], true);
        assert!(p["models"][1].get("compat").is_none());
        disconnect(h.path()).unwrap();
        assert_eq!(read(&settings_path(h.path())), json!({}));
    }

    #[test]
    fn domestic_groups_use_chat_completions() {
        let h = home_with(None, None);
        let mut c = test_conn();
        c.platform = "zhipu".into();
        connect(h.path(), &c).unwrap();
        assert_eq!(read(&models_path(h.path()))["providers"]["cloudborne"]["api"], "openai-completions");
    }

    #[test]
    fn a_default_the_user_changed_since_is_kept() {
        let h = home_with(Some(MODELS), Some(SETTINGS));
        connect(h.path(), &test_conn()).unwrap();
        let mut s = load(&settings_path(h.path())).unwrap();
        s.insert("defaultProvider".into(), json!("lgw"));
        s.insert("defaultModel".into(), json!("y"));
        fs::write(settings_path(h.path()), render(&s, "\n")).unwrap();
        disconnect(h.path()).unwrap();
        assert_eq!(read(&settings_path(h.path()))["defaultModel"], "y");
    }

    #[test]
    fn refuses_broken_files_without_writing() {
        let h = home_with(Some(MODELS), Some("{ broken"));
        assert!(connect(h.path(), &test_conn()).is_err());
        assert_eq!(fs::read_to_string(models_path(h.path())).unwrap(), MODELS);
    }

    #[test]
    fn adaptive_thinking_starts_at_claude_4_6() {
        assert!(adaptive_claude("claude-opus-5-5"));
        assert!(adaptive_claude("claude-sonnet-4-6"));
        assert!(adaptive_claude("claude-fable-5-1"));
        assert!(!adaptive_claude("claude-haiku-4-5-20251001"));
        assert!(!adaptive_claude("claude-opus-4-5"));
    }
}
