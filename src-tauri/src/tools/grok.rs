//! Grok Build reads `~/.grok/config.toml`. We append a marked block of
//! `[model."cloudborne/<id>"]` tables, one per relay model, each with its own
//! `base_url` and `api_key`.
//!
//! The table names must never equal a built-in model name: Grok merges a
//! same-named table into the built-in definition and would then send the
//! user's xAI session token to our `base_url`. The `cloudborne/` prefix keeps
//! them separate, and a per-model `api_key` wins over the session token.

use std::path::{Path, PathBuf};

use toml_edit::DocumentMut;

use super::Connection;
use super::no_models;
use crate::error::{Error, Result};
use crate::lang::tr;
use crate::fsx;

pub const PREFIX: &str = "cloudborne/";

pub fn config_path(home: &Path) -> PathBuf {
    home.join(".grok").join("config.toml")
}

fn parse(text: &str) -> Result<DocumentMut> {
    text.parse::<DocumentMut>()
        .map_err(|e| Error::Config(format!("~/.grok/config.toml: {e}")))
}

fn toml_str(s: &str) -> String {
    toml_edit::Value::from(s).to_string().trim().to_string()
}

fn block(conn: &Connection) -> String {
    let base = toml_str(&conn.v1());
    let key = toml_str(&conn.api_key);
    conn.models
        .iter()
        .map(|id| {
            let header = toml_str(&format!("{PREFIX}{id}"));
            format!(
                "[model.{header}]\nmodel = {model}\nname = {name}\nbase_url = {base}\napi_key = {key}\napi_backend = \"responses\"\n",
                model = toml_str(id),
                name = toml_str(&format!("{id} (Cloudborne)")),
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn is_connected(home: &Path) -> Result<bool> {
    fsx::has_block(&fsx::read_or_empty(&config_path(home))?)
}

pub fn connect(home: &Path, conn: &Connection) -> Result<Vec<PathBuf>> {
    if conn.models.is_empty() {
        return Err(Error::Other(no_models("Grok Build")));
    }
    let path = config_path(home);
    let original = fsx::read_or_empty(&path)?;
    parse(&original)?;
    let new = fsx::append_block(&original, &block(conn))?;
    let bak = fsx::replace_verified(&path, &new, |t| {
        let doc = parse(t)?;
        let ours = doc
            .get("model")
            .and_then(|m| m.as_table_like())
            .map(|m| m.iter().filter(|(k, _)| k.starts_with(PREFIX)).count())
            .unwrap_or(0);
        if ours == conn.models.len() {
            Ok(())
        } else {
            Err(Error::Config(tr("写入后校验失败：cloudborne 模型条目数不对", "Check after writing failed: wrong number of cloudborne models").into()))
        }
    })?;
    Ok(bak.into_iter().collect())
}

pub fn disconnect(home: &Path) -> Result<Vec<PathBuf>> {
    let path = config_path(home);
    let original = fsx::read_or_empty(&path)?;
    if !fsx::has_block(&original)? {
        return Ok(vec![]);
    }
    let new = fsx::strip_block(&original)?;
    let bak = fsx::replace_verified(&path, &new, |t| parse(t).map(|_| ()))?;
    Ok(bak.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::test_conn;
    use std::fs;

    // Mirrors a real file: user tables plus another tool's marked section.
    const USER: &str = r#"[models]
default = "grok-4.6"

[model."grok-4.7-api"]
model = "lgw/grok-4.7"
base_url = "https://lgw.example/v1"
# === keysmith-switch input rewrite begin ===
[model."grok-4.6"]
base_url = "http://127.0.0.1:1/t/x"
# === keysmith-switch input rewrite end ===
"#;

    fn home_with(text: &str) -> tempfile::TempDir {
        let h = tempfile::tempdir().unwrap();
        fs::create_dir_all(h.path().join(".grok")).unwrap();
        fs::write(config_path(h.path()), text).unwrap();
        h
    }

    fn read(h: &tempfile::TempDir) -> String {
        fs::read_to_string(config_path(h.path())).unwrap()
    }

    #[test]
    fn adds_prefixed_models_and_strips_back_to_original() {
        let mut c = test_conn();
        c.models = vec!["grok-4.6".into(), "grok-4.7".into()];
        let h = home_with(USER);
        connect(h.path(), &c).unwrap();
        let t = read(&h);
        assert!(t.starts_with(USER));
        let doc = parse(&t).unwrap();
        let m = &doc["model"]["cloudborne/grok-4.6"];
        assert_eq!(m["model"].as_str(), Some("grok-4.6"));
        assert_eq!(m["base_url"].as_str(), Some("https://relay.example/v1"));
        assert_eq!(m["api_key"].as_str(), Some("sk-test-123"));
        assert_eq!(m["api_backend"].as_str(), Some("responses"));
        // the user's same-named built-in override is untouched
        assert_eq!(doc["model"]["grok-4.6"]["base_url"].as_str(), Some("http://127.0.0.1:1/t/x"));
        assert!(is_connected(h.path()).unwrap());

        disconnect(h.path()).unwrap();
        assert_eq!(read(&h), USER);
        assert!(!is_connected(h.path()).unwrap());
    }

    #[test]
    fn never_shadows_builtin_names() {
        let mut c = test_conn();
        c.models = vec!["grok-4.7".into()];
        let h = home_with("");
        connect(h.path(), &c).unwrap();
        let doc = parse(&read(&h)).unwrap();
        let names: Vec<_> = doc["model"].as_table_like().unwrap().iter().map(|(k, _)| k.to_string()).collect();
        assert_eq!(names, ["cloudborne/grok-4.7"]);
    }

    #[test]
    fn reconnect_replaces_block() {
        let h = home_with(USER);
        connect(h.path(), &test_conn()).unwrap();
        let mut c = test_conn();
        c.models = vec!["only".into()];
        connect(h.path(), &c).unwrap();
        let t = read(&h);
        assert_eq!(t.matches(fsx::BLOCK_BEGIN).count(), 1);
        assert!(t.contains("cloudborne/only") && !t.contains("cloudborne/model-a"));
    }

    #[test]
    fn refuses_broken_file() {
        let h = home_with("[model\n");
        assert!(connect(h.path(), &test_conn()).is_err());
        assert_eq!(read(&h), "[model\n");
    }
}
