//! ZCode keeps providers in `~/.zcode/v2/config.json` (desktop app) and
//! `~/.zcode/cli/config.json` (CLI). We add one provider entry with our own id
//! to whichever of those files exist, and remove only that entry on disconnect.
//! The relay's domestic-model groups are reached over the OpenAI-compatible
//! endpoint.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use super::{no_models, Connection};
use crate::error::{Error, Result};
use crate::lang::tr;
use crate::tr_fmt;
use crate::fsx;

pub const PROVIDER_ID: &str = "cloudborne";

pub fn config_paths(home: &Path) -> [PathBuf; 2] {
    let z = home.join(".zcode");
    [z.join("v2").join("config.json"), z.join("cli").join("config.json")]
}

/// Files to write: the ones that already exist, or the desktop one if ZCode
/// has never written any.
fn targets(home: &Path) -> Vec<PathBuf> {
    let existing: Vec<_> = config_paths(home).into_iter().filter(|p| p.exists()).collect();
    if existing.is_empty() {
        vec![config_paths(home)[0].clone()]
    } else {
        existing
    }
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

fn provider(conn: &Connection) -> Value {
    let models: Map<String, Value> = conn
        .models
        .iter()
        .map(|id| {
            (
                id.clone(),
                json!({
                    "name": id,
                    "modalities": { "input": ["text"], "output": ["text"] },
                }),
            )
        })
        .collect();
    json!({
        "name": "Cloudborne",
        "kind": "openai-compatible",
        "options": {
            "apiKey": conn.api_key,
            "baseURL": conn.v1(),
            "apiKeyRequired": true,
        },
        "source": "custom",
        "models": models,
    })
}

pub fn is_connected(home: &Path) -> Result<bool> {
    for p in config_paths(home) {
        if p.exists() {
            let m = load(&p)?;
            if m.get("provider").and_then(|v| v.get(PROVIDER_ID)).is_some() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

pub fn connect(home: &Path, conn: &Connection) -> Result<Vec<PathBuf>> {
    if conn.models.is_empty() {
        return Err(Error::Other(no_models("ZCode")));
    }
    // Parse everything first so a broken second file does not leave the first half-done.
    let loaded: Vec<(PathBuf, String, Map<String, Value>)> = targets(home)
        .into_iter()
        .map(|p| {
            let raw = fsx::read_or_empty(&p)?;
            load(&p).map(|m| (p, raw, m))
        })
        .collect::<Result<_>>()?;
    let mut backups = vec![];
    for (path, raw, mut m) in loaded {
        if !m.get("provider").map_or(true, Value::is_object) {
            return Err(Error::Config(tr_fmt!("{}: provider 不是对象", "{}: provider is not an object", path.display())));
        }
        m.entry("provider")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .expect("checked above")
            .insert(PROVIDER_ID.into(), provider(conn));
        let bak = fsx::replace_verified(&path, &render(&m, &raw), |t| {
            let v: Value = serde_json::from_str(t).map_err(|e| Error::Config(e.to_string()))?;
            match v.pointer(&format!("/provider/{PROVIDER_ID}/options/baseURL")) {
                Some(_) => Ok(()),
                None => Err(Error::Config(tr("写入后校验失败：缺少 cloudborne provider", "Check after writing failed: the cloudborne provider is missing").into())),
            }
        })?;
        backups.extend(bak);
    }
    Ok(backups)
}

pub fn disconnect(home: &Path) -> Result<Vec<PathBuf>> {
    let mut backups = vec![];
    for path in config_paths(home) {
        if !path.exists() {
            continue;
        }
        let raw = fsx::read_or_empty(&path)?;
        let mut m = load(&path)?;
        let removed = m
            .get_mut("provider")
            .and_then(Value::as_object_mut)
            .and_then(|p| p.remove(PROVIDER_ID))
            .is_some();
        if !removed {
            continue;
        }
        let bak = fsx::replace_verified(&path, &render(&m, &raw), |t| {
            serde_json::from_str::<Value>(t).map(|_| ()).map_err(|e| Error::Config(e.to_string()))
        })?;
        backups.extend(bak);
    }
    Ok(backups)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::test_conn;
    use std::fs;

    const USER: &str = r#"{
  "provider": {
    "builtin:zai": { "name": "Z.ai", "kind": "anthropic", "options": { "baseURL": "https://api.z.ai/api/anthropic" } },
    "da6c-user": { "name": "LGW", "kind": "openai-compatible", "options": { "baseURL": "https://lgw.example/v1" } }
  }
}"#;

    fn read(p: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(p).unwrap()).unwrap()
    }

    #[test]
    fn writes_both_existing_files_and_removes_only_ours() {
        let h = tempfile::tempdir().unwrap();
        for p in config_paths(h.path()) {
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, USER).unwrap();
        }
        connect(h.path(), &test_conn()).unwrap();
        for p in config_paths(h.path()) {
            let v = read(&p);
            assert_eq!(v["provider"]["cloudborne"]["kind"], "openai-compatible");
            assert_eq!(v["provider"]["cloudborne"]["options"]["baseURL"], "https://relay.example/v1");
            assert!(v["provider"]["cloudborne"]["models"].get("model-a").is_some());
            assert_eq!(v["provider"]["da6c-user"]["name"], "LGW");
        }
        assert!(is_connected(h.path()).unwrap());
        disconnect(h.path()).unwrap();
        for p in config_paths(h.path()) {
            assert_eq!(read(&p), serde_json::from_str::<Value>(USER).unwrap());
        }
        assert!(!is_connected(h.path()).unwrap());
    }

    #[test]
    fn round_trip_is_byte_exact_without_trailing_newline() {
        let h = tempfile::tempdir().unwrap();
        let [desktop, _] = config_paths(h.path());
        fs::create_dir_all(desktop.parent().unwrap()).unwrap();
        let original = serde_json::to_string_pretty(&serde_json::from_str::<Value>(USER).unwrap()).unwrap();
        assert!(!original.ends_with('\n'));
        fs::write(&desktop, &original).unwrap();
        connect(h.path(), &test_conn()).unwrap();
        disconnect(h.path()).unwrap();
        assert_eq!(fs::read_to_string(&desktop).unwrap(), original);
    }

    #[test]
    fn creates_desktop_config_when_none_exists() {
        let h = tempfile::tempdir().unwrap();
        connect(h.path(), &test_conn()).unwrap();
        let [desktop, cli] = config_paths(h.path());
        assert!(desktop.exists());
        assert!(!cli.exists());
    }

    #[test]
    fn broken_second_file_leaves_first_untouched() {
        let h = tempfile::tempdir().unwrap();
        let [desktop, cli] = config_paths(h.path());
        for p in [&desktop, &cli] {
            fs::create_dir_all(p.parent().unwrap()).unwrap();
        }
        fs::write(&desktop, USER).unwrap();
        fs::write(&cli, "{ broken").unwrap();
        assert!(connect(h.path(), &test_conn()).is_err());
        assert_eq!(fs::read_to_string(&desktop).unwrap(), USER);
    }

    #[test]
    fn refuses_empty_model_list() {
        let h = tempfile::tempdir().unwrap();
        let mut c = test_conn();
        c.models.clear();
        assert!(connect(h.path(), &c).is_err());
    }
}
