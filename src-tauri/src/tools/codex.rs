//! Codex reads `~/.codex/config.toml`. We append a marked block holding our
//! provider table and point the top-level `model_provider` at it. Top-level
//! keys have to sit before the first table, so that one key is edited in place
//! rather than inside the block; its previous value is recorded in the block
//! so disconnect can put it back.

use std::path::{Path, PathBuf};

use toml_edit::{DocumentMut, Item};

use super::Connection;
use crate::error::{Error, Result};
use crate::lang::tr;
use crate::fsx;

pub const PROVIDER_ID: &str = "cloudborne";
const PREV_KEY: &str = "# cloudborne-desktop previous model_provider: ";

pub fn config_path(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
}

fn parse(text: &str) -> Result<DocumentMut> {
    text.parse::<DocumentMut>()
        .map_err(|e| Error::Config(format!("~/.codex/config.toml: {e}")))
}

pub fn is_connected(home: &Path) -> Result<bool> {
    let text = fsx::read_or_empty(&config_path(home))?;
    if !fsx::has_block(&text)? {
        return Ok(false);
    }
    let doc = parse(&text)?;
    Ok(doc.get("model_provider").and_then(Item::as_str) == Some(PROVIDER_ID))
}

fn provider_block(conn: &Connection) -> String {
    let base = conn.v1();
    format!(
        "[model_providers.{PROVIDER_ID}]\nname = \"Cloudborne\"\nbase_url = {base}\nwire_api = \"responses\"\nrequires_openai_auth = false\nexperimental_bearer_token = {key}",
        base = toml_str(&base),
        key = toml_str(&conn.api_key),
    )
}

fn toml_str(s: &str) -> String {
    toml_edit::Value::from(s).to_string().trim().to_string()
}

/// Sets the top-level `model_provider` to ours, returning the previous value.
fn set_top_level_provider(text: &str) -> Result<(String, Option<String>)> {
    let mut doc = parse(text)?;
    let prev = doc.get("model_provider").and_then(Item::as_str).map(str::to_string);
    if prev.as_deref() == Some(PROVIDER_ID) {
        return Ok((text.to_string(), None));
    }
    doc["model_provider"] = toml_edit::value(PROVIDER_ID);
    // Make sure the key lands among the root keys, before any table header.
    if let Some((mut key, _)) = doc.as_table_mut().get_key_value_mut("model_provider") {
        key.leaf_decor_mut().clear();
    }
    Ok((doc.to_string(), prev))
}

pub fn connect(home: &Path, conn: &Connection) -> Result<Vec<PathBuf>> {
    let path = config_path(home);
    let original = fsx::read_or_empty(&path)?;
    // Reconnecting: keep the previous value recorded the first time.
    let recorded_prev = recorded_previous(&original)?;
    let without = fsx::strip_block(&original)?;
    let (with_provider, prev) = set_top_level_provider(&without)?;
    let prev = recorded_prev.or(prev);

    let mut body = String::new();
    if let Some(p) = &prev {
        body.push_str(PREV_KEY);
        body.push_str(p);
        body.push('\n');
    }
    body.push_str(&provider_block(conn));
    let new = fsx::append_block(&with_provider, &body)?;

    let bak = fsx::replace_verified(&path, &new, |t| {
        let doc = parse(t)?;
        let ok = doc.get("model_provider").and_then(Item::as_str) == Some(PROVIDER_ID)
            && doc
                .get("model_providers")
                .and_then(|p| p.get(PROVIDER_ID))
                .and_then(|p| p.get("base_url"))
                .is_some();
        if ok {
            Ok(())
        } else {
            Err(Error::Config(tr("写入后校验失败：model_provider 未指向 cloudborne", "Check after writing failed: model_provider does not point to cloudborne").into()))
        }
    })?;
    Ok(bak.into_iter().collect())
}

fn recorded_previous(text: &str) -> Result<Option<String>> {
    Ok(fsx::block_body(text)?.and_then(|b| {
        b.lines()
            .find_map(|l| l.strip_prefix(PREV_KEY))
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    }))
}

pub fn disconnect(home: &Path) -> Result<Vec<PathBuf>> {
    let path = config_path(home);
    let original = fsx::read_or_empty(&path)?;
    if !fsx::has_block(&original)? {
        return Ok(vec![]);
    }
    let prev = recorded_previous(&original)?;
    let without = fsx::strip_block(&original)?;
    let mut doc = parse(&without)?;
    if doc.get("model_provider").and_then(Item::as_str) == Some(PROVIDER_ID) {
        match prev {
            Some(p) => doc["model_provider"] = toml_edit::value(p),
            None => {
                doc.remove("model_provider");
            }
        }
    }
    let new = doc.to_string();
    let bak = fsx::replace_verified(&path, &new, |t| {
        let d = parse(t)?;
        if d.get("model_provider").and_then(Item::as_str) == Some(PROVIDER_ID) {
            return Err(Error::Config(tr("断开后 model_provider 仍指向 cloudborne", "model_provider still points to cloudborne after disconnecting").into()));
        }
        Ok(())
    })?;
    Ok(bak.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::test_conn;
    use std::fs;

    fn home_with(text: Option<&str>) -> tempfile::TempDir {
        let h = tempfile::tempdir().unwrap();
        if let Some(t) = text {
            fs::create_dir_all(h.path().join(".codex")).unwrap();
            fs::write(config_path(h.path()), t).unwrap();
        }
        h
    }

    fn read(h: &tempfile::TempDir) -> String {
        fs::read_to_string(config_path(h.path())).unwrap()
    }

    #[test]
    fn connects_from_nothing_and_disconnects_cleanly() {
        let h = home_with(None);
        connect(h.path(), &test_conn()).unwrap();
        let t = read(&h);
        let doc = parse(&t).unwrap();
        assert_eq!(doc["model_provider"].as_str(), Some("cloudborne"));
        assert_eq!(
            doc["model_providers"]["cloudborne"]["base_url"].as_str(),
            Some("https://relay.example/v1")
        );
        assert!(is_connected(h.path()).unwrap());
        disconnect(h.path()).unwrap();
        let after = parse(&read(&h)).unwrap();
        assert!(after.get("model_provider").is_none());
        assert!(after.get("model_providers").is_none());
        assert!(!is_connected(h.path()).unwrap());
    }

    #[test]
    fn preserves_user_config_and_restores_previous_provider() {
        let original = "# my settings\nmodel = \"gpt-6\"\nmodel_provider = \"keysmith-relay\"\n\n[model_providers.keysmith-relay]\nname = \"k\"\nbase_url = \"http://127.0.0.1:1/x\"\n\n[features]\nimage_generation = false\n";
        let h = home_with(Some(original));
        connect(h.path(), &test_conn()).unwrap();
        let t = read(&h);
        assert!(t.contains("# my settings"));
        assert!(t.contains("[model_providers.keysmith-relay]"));
        assert!(t.contains("image_generation = false"));
        assert_eq!(parse(&t).unwrap()["model_provider"].as_str(), Some("cloudborne"));
        // features table must not swallow our provider
        assert!(parse(&t).unwrap()["features"].get("model_providers").is_none());

        // reconnect keeps the first recorded previous value
        connect(h.path(), &test_conn()).unwrap();
        disconnect(h.path()).unwrap();
        assert_eq!(read(&h), original);
    }

    #[test]
    fn reconnect_updates_key_without_duplicating() {
        let h = home_with(Some("model = \"x\"\n"));
        connect(h.path(), &test_conn()).unwrap();
        let mut c = test_conn();
        c.api_key = "sk-new".into();
        connect(h.path(), &c).unwrap();
        let t = read(&h);
        assert_eq!(t.matches(fsx::BLOCK_BEGIN).count(), 1);
        assert!(t.contains("sk-new") && !t.contains("sk-test-123"));
    }

    #[test]
    fn refuses_to_touch_a_broken_file() {
        let h = home_with(Some("model = \n[[[\n"));
        assert!(connect(h.path(), &test_conn()).is_err());
        assert_eq!(read(&h), "model = \n[[[\n");
    }

    #[test]
    fn disconnect_without_block_is_noop() {
        let h = home_with(Some("model = \"x\"\n"));
        assert!(disconnect(h.path()).unwrap().is_empty());
        assert_eq!(read(&h), "model = \"x\"\n");
    }
}
