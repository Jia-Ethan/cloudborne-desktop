//! DeepSeek Harness (`dsh`) composes each profile from bundle layers plus the
//! profile's own `~/.dsh/profiles/<name>/cordis.patch.yml` (under `DSH_HOME`
//! when that is set). We append a marked block of patch rows to every profile
//! built on `dsh-base`: one `llm-pi-ai` row that adds a `cloudborne` provider
//! and one `agent-default-model` row that points new agents at it. The key
//! goes into a marked block of `~/.dsh/.env`, the one credential source every
//! profile reads, including `headless`, which turns the credential store off.
//!
//! A patch row replaces the whole config of the row it targets, so our
//! `llm-pi-ai` row carries over the providers of the user's own row. DSH's
//! settings page writes into the last row with a given id, which can be ours,
//! and appends new rows at the end of the file, inside our block. Disconnect
//! and reconnect therefore keep every row in the block that is not exactly
//! what we wrote, minus the `cloudborne` provider.

use std::path::{Path, PathBuf};

use serde_yaml::{Mapping, Value};

use super::{no_models, Connection};
use crate::error::{Error, Result};
use crate::lang::tr;
use crate::{fsx, tr_fmt};

pub const PROVIDER_ID: &str = "cloudborne";
/// Not `CLOUDBORNE_API_KEY`: a variable of that name in the user's shell would
/// outrank the `.env` file and send another group's key.
pub const KEY_ENV: &str = "CLOUDBORNE_DSH_API_KEY";
const PI_ROW: &str = "llm-pi-ai";
const PI_PLUGIN: &str = "@deepseek-ai/dsh-llm-pi-ai";
const DEFAULT_ROW: &str = "agent-default-model";
const DEFAULT_PLUGIN: &str = "@deepseek-ai/dsh-agent-default-model";
const BASE_BUNDLE: &str = "@deepseek-ai/dsh-base";
/// Shipped profiles DSH creates on first launch; we prepare them in advance.
const TEMPLATES: [&str; 2] = ["web", "headless"];
/// What DSH writes into a new profile patch: an empty list.
const EMPTY_LIST: &str = "[]";

pub fn dsh_home(home: &Path) -> PathBuf {
    match std::env::var_os("DSH_HOME").filter(|d| !d.is_empty()) {
        // Tests point everything at a temp home; ignore the user's override there.
        Some(d) if std::env::var_os("CLOUDBORNE_HOME").is_none() && !cfg!(test) => PathBuf::from(d),
        _ => home.join(".dsh"),
    }
}

pub fn env_path(home: &Path) -> PathBuf {
    dsh_home(home).join(".env")
}

fn profiles_dir(home: &Path) -> PathBuf {
    dsh_home(home).join("profiles")
}

fn patch_path(profile: &Path) -> PathBuf {
    profile.join("cordis.patch.yml")
}

/// Whether a profile's `package.json` stacks its layers on `dsh-base`, which
/// owns the two rows we patch. `None` when there is no manifest yet.
fn uses_base(profile: &Path) -> Option<bool> {
    let text = std::fs::read_to_string(profile.join("package.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let bundles = v.pointer("/dsh/profile/bundles").and_then(|b| b.as_array());
    Some(bundles.is_some_and(|b| b.iter().any(|x| x.as_str() == Some(BASE_BUNDLE))))
}

fn profile_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(profiles_dir(home))
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default();
    dirs.sort();
    dirs
}

/// Profiles to connect: every existing one built on `dsh-base`, plus the
/// shipped templates DSH has not created yet.
fn targets(home: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = profile_dirs(home).into_iter().filter(|p| uses_base(p) == Some(true)).collect();
    for name in TEMPLATES {
        let dir = profiles_dir(home).join(name);
        if uses_base(&dir).is_none() && !out.contains(&dir) {
            out.push(dir);
        }
    }
    out
}

fn parse(path: &Path, text: &str) -> Result<Vec<Value>> {
    match serde_yaml::from_str::<Value>(text) {
        Ok(Value::Null) => Ok(vec![]),
        Ok(Value::Sequence(rows)) => Ok(rows),
        Ok(_) => Err(Error::Config(tr_fmt!("{}: 顶层不是列表", "{}: not a YAML list", path.display()))),
        Err(e) => Err(Error::Config(format!("{}: {e}", path.display()))),
    }
}

fn key(s: &str) -> Value {
    Value::String(s.into())
}

/// A patch row's id when it targets a row rather than inserting new ones.
fn row_id(row: &Value) -> Option<&str> {
    let m = row.as_mapping()?;
    if m.contains_key("insert") {
        return None;
    }
    m.get("id")?.as_str()
}

fn config(row: &Value) -> Mapping {
    row.get("config").and_then(Value::as_mapping).cloned().unwrap_or_default()
}

/// `config` with our provider removed and an emptied `providers` dropped.
fn without_ours(mut cfg: Mapping) -> Mapping {
    if let Some(p) = cfg.get_mut("providers").and_then(Value::as_mapping_mut) {
        p.remove(PROVIDER_ID);
        if p.is_empty() {
            cfg.remove("providers");
        }
    }
    cfg
}

fn is_deepseek(id: &str) -> bool {
    id.starts_with("deepseek")
}

/// Pi-ai treats a hand-declared model as 128k, text-only and non-reasoning.
/// DeepSeek V4 serves a 1M context and DSH's off/high/max thinking levels;
/// other models in the group are declared plainly.
fn model(id: &str) -> Value {
    let mut m = Mapping::new();
    m.insert(key("id"), key(id));
    m.insert(key("name"), key(&format!("{id} (Cloudborne)")));
    if is_deepseek(id) {
        m.insert(key("contextWindow"), Value::from(1_000_000));
        let mut efforts = Mapping::new();
        efforts.insert(key("off"), Value::Null);
        efforts.insert(key("high"), key("high"));
        efforts.insert(key("max"), key("max"));
        m.insert(key("reasoningEfforts"), Value::Mapping(efforts));
        let mut compat = Mapping::new();
        compat.insert(key("thinkingFormat"), key("deepseek"));
        compat.insert(key("requiresReasoningContentOnAssistantMessages"), Value::Bool(true));
        m.insert(key("compat"), Value::Mapping(compat));
    } else {
        m.insert(key("contextWindow"), Value::from(200_000));
    }
    Value::Mapping(m)
}

fn provider(conn: &Connection) -> Value {
    // pi-ai recognises DeepSeek by its official host; behind the relay these
    // switches have to be stated.
    let mut compat = Mapping::new();
    compat.insert(key("supportsStore"), Value::Bool(false));
    compat.insert(key("supportsDeveloperRole"), Value::Bool(false));
    compat.insert(key("maxTokensField"), key("max_tokens"));
    let mut p = Mapping::new();
    p.insert(key("displayName"), key("Cloudborne"));
    p.insert(key("apiKeyEnv"), key(KEY_ENV));
    p.insert(key("api"), key("openai-completions"));
    p.insert(key("baseURL"), key(&conn.v1()));
    p.insert(key("compat"), Value::Mapping(compat));
    p.insert(key("models"), Value::Sequence(conn.models.iter().map(|id| model(id)).collect()));
    Value::Mapping(p)
}

/// DSH's own default is DeepSeek V4.1 Flash; keep that cost profile.
fn default_model(models: &[String]) -> &str {
    models
        .iter()
        .find(|m| m.as_str() == "deepseek-flash")
        .or_else(|| models.iter().find(|m| is_deepseek(m) && m.contains("flash")))
        .or_else(|| models.iter().find(|m| is_deepseek(m)))
        .or(models.first())
        .map(String::as_str)
        .unwrap_or_default()
}

/// Whether `text` uses DSH's `!!js` tag outside comments. serde_yaml drops
/// the tag and keeps the expression as a plain string.
fn has_js(text: &str) -> bool {
    text.lines().any(|l| !l.trim_start().starts_with('#') && l.contains("!!js"))
}

fn row(id: &str, name: &str, cfg: Mapping) -> Value {
    let mut m = Mapping::new();
    m.insert(key("id"), key(id));
    m.insert(key("name"), key(name));
    m.insert(key("config"), Value::Mapping(cfg));
    Value::Mapping(m)
}

/// The config of the last `llm-pi-ai` row outside our block.
fn user_pi_config(path: &Path, outside: &str, rows: &[Value]) -> Result<Mapping> {
    let Some(r) = rows.iter().rev().find(|r| row_id(r) == Some(PI_ROW)) else {
        return Ok(Mapping::new());
    };
    // We copy this row into ours; a `!!js` expression would come out as a string.
    if has_js(outside) && r.get("config").is_some() {
        return Err(Error::Config(tr_fmt!(
            "{}: 含 !!js 表达式，无法安全合并 llm-pi-ai 配置，请手动添加 cloudborne provider",
            "{}: contains !!js expressions, so the llm-pi-ai config cannot be merged safely; add the cloudborne provider by hand",
            path.display()
        )));
    }
    Ok(without_ours(config(r)))
}

/// What our block holds besides what we wrote: rows the user or DSH's
/// settings page added or changed, and the Cloudborne model they picked.
struct Kept {
    rows: Vec<Value>,
    model: Option<(String, Option<Value>)>,
}

fn salvage(path: &Path, body: &str, user_pi: &Mapping) -> Result<Kept> {
    if has_js(body) {
        return Err(Error::Config(tr_fmt!(
            "{}: cloudborne-desktop 标记段里有 !!js 表达式，请先手动移出标记段",
            "{}: the cloudborne-desktop section contains !!js expressions; move them out of the marked section first",
            path.display()
        )));
    }
    let mut kept = Kept { rows: vec![], model: None };
    for r in parse(path, body)? {
        match row_id(&r) {
            Some(PI_ROW) => {
                let cfg = without_ours(config(&r));
                if cfg != *user_pi {
                    kept.rows.push(row(PI_ROW, PI_PLUGIN, cfg));
                }
            }
            Some(DEFAULT_ROW) => {
                let cfg = config(&r);
                if cfg.get("provider").and_then(Value::as_str) == Some(PROVIDER_ID) {
                    let model = cfg.get("model").and_then(Value::as_str).unwrap_or_default().to_string();
                    kept.model = Some((model, cfg.get("reasoningEffort").cloned()));
                } else {
                    kept.rows.push(r);
                }
            }
            _ => kept.rows.push(r),
        }
    }
    Ok(kept)
}

/// The file without our block, and what in the block has to be kept.
fn split(path: &Path, text: &str) -> Result<(String, Mapping, Kept)> {
    let outside = fsx::strip_block(text)?;
    let rows = parse(path, &outside)?;
    let user_pi = user_pi_config(path, &outside, &rows)?;
    let kept = match fsx::block_body(text)? {
        Some(body) => salvage(path, &body, &user_pi)?,
        None => Kept { rows: vec![], model: None },
    };
    Ok((outside, user_pi, kept))
}

fn yaml_rows(rows: &[Value]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    serde_yaml::to_string(rows).unwrap_or_default()
}

/// `text` with a lone `[]` line removed, so block-style rows can follow it.
fn drop_empty_list(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        if line.trim() != EMPTY_LIST {
            out.push_str(line);
        }
    }
    out
}

/// A file that is only comments plus `[]` has to lose the `[]` before
/// block-style rows can follow.
fn drop_empty_list_if_bare(text: &str) -> String {
    match serde_yaml::from_str::<Value>(text) {
        Ok(Value::Sequence(rows)) if rows.is_empty() => drop_empty_list(text),
        _ => text.to_string(),
    }
}

/// `text` followed by `rows`, written so the file stays a valid patch list.
fn with_rows(text: &str, rows: &[Value]) -> String {
    if rows.is_empty() {
        return text.to_string();
    }
    let mut out = drop_empty_list_if_bare(text);
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&yaml_rows(rows));
    out
}

/// DSH refuses a patch file that is not a list.
fn ensure_list(mut text: String) -> String {
    if matches!(serde_yaml::from_str::<Value>(&text), Ok(Value::Null)) {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(EMPTY_LIST);
        text.push('\n');
    }
    text
}

fn verify_list(path: &Path) -> impl Fn(&str) -> Result<()> + '_ {
    move |t| parse(path, t).map(|_| ())
}

pub fn is_connected(home: &Path) -> Result<bool> {
    for dir in profile_dirs(home) {
        if fsx::has_block(&fsx::read_or_empty(&patch_path(&dir))?)? {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn connect(home: &Path, conn: &Connection) -> Result<Vec<PathBuf>> {
    if conn.models.is_empty() {
        return Err(Error::Other(no_models("DSH")));
    }
    let env = env_path(home);
    let env_raw = fsx::read_or_empty(&env)?;
    // Parse everything first so a broken file does not leave the others half-done.
    let mut plans = vec![];
    for dir in targets(home) {
        let path = patch_path(&dir);
        let raw = fsx::read_or_empty(&path)?;
        let (outside, user_pi, kept) = split(&path, &raw)?;

        // A provider added through DSH's settings while we were connected
        // lives in a kept row, which ours replaces; carry it over too.
        let mut pi = match kept.rows.iter().rev().find(|r| row_id(r) == Some(PI_ROW)) {
            Some(r) => config(r),
            None => user_pi,
        };
        let providers = pi.entry(key("providers")).or_insert_with(|| Value::Mapping(Mapping::new()));
        let Some(providers) = providers.as_mapping_mut() else {
            return Err(Error::Config(tr_fmt!("{}: llm-pi-ai 的 providers 不是对象", "{}: providers of llm-pi-ai is not a mapping", path.display())));
        };
        providers.insert(key(PROVIDER_ID), provider(conn));

        // Keep the Cloudborne model the user picked while it is still offered.
        let mut default = Mapping::new();
        default.insert(key("provider"), key(PROVIDER_ID));
        match kept.model.filter(|(m, _)| conn.models.contains(m)) {
            Some((m, effort)) => {
                default.insert(key("model"), key(&m));
                if let Some(e) = effort {
                    default.insert(key("reasoningEffort"), e);
                }
            }
            None => {
                let m = default_model(&conn.models);
                default.insert(key("model"), key(m));
                if is_deepseek(m) {
                    default.insert(key("reasoningEffort"), key("high"));
                }
            }
        }

        // The user's rows from the old block go back outside it, before ours,
        // so ours still win.
        let base = with_rows(&outside, &kept.rows);
        let ours = [row(PI_ROW, PI_PLUGIN, pi), row(DEFAULT_ROW, DEFAULT_PLUGIN, default)];
        let new = fsx::append_block(&drop_empty_list_if_bare(&base), &yaml_rows(&ours))?;
        verify_list(&path)(&new)?;
        plans.push((path, new));
    }

    let mut backups = vec![];
    let env_new = fsx::append_block(&env_raw, &format!("{KEY_ENV}={}", conn.api_key))?;
    backups.extend(fsx::replace_verified(&env, &env_new, |t| {
        match fsx::block_body(t)? {
            Some(b) if b.contains(KEY_ENV) => Ok(()),
            _ => Err(Error::Config(tr("写入后校验失败：缺少 Cloudborne 密钥", "Check after writing failed: the Cloudborne key is missing").into())),
        }
    })?);
    for (path, new) in plans {
        backups.extend(fsx::replace_verified(&path, &new, |t| {
            let rows = parse(&path, t)?;
            let last = rows.iter().rev().find(|r| row_id(r) == Some(PI_ROW));
            match last.and_then(|r| r.get("config")?.get("providers")?.get(PROVIDER_ID)?.get("baseURL")) {
                Some(_) => Ok(()),
                None => Err(Error::Config(tr("写入后校验失败：缺少 cloudborne provider", "Check after writing failed: the cloudborne provider is missing").into())),
            }
        })?);
    }
    Ok(backups)
}

pub fn disconnect(home: &Path) -> Result<Vec<PathBuf>> {
    let mut plans = vec![];
    for dir in profile_dirs(home) {
        let path = patch_path(&dir);
        let raw = fsx::read_or_empty(&path)?;
        if !fsx::has_block(&raw)? {
            continue;
        }
        let (outside, _, kept) = split(&path, &raw)?;
        plans.push((path, ensure_list(with_rows(&outside, &kept.rows))));
    }
    let mut backups = vec![];
    for (path, new) in plans {
        backups.extend(fsx::replace_verified(&path, &new, verify_list(&path))?);
    }
    let env = env_path(home);
    let raw = fsx::read_or_empty(&env)?;
    if fsx::has_block(&raw)? {
        backups.extend(fsx::replace_verified(&env, &fsx::strip_block(&raw)?, |_| Ok(()))?);
    }
    Ok(backups)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::test_conn;
    use std::fs;

    // What DSH writes into a new profile.
    const TEMPLATE: &str = "# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n";
    const USER: &str = r#"# mine
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      lgw:
        apiKeyEnv: LGW_API_KEY
        api: openai-completions
        baseURL: https://lgw.example/v1
        models:
          - id: x
- id: agent-default-model
  config:
    provider: lgw
    model: x
"#;
    const MANIFEST: &str = r#"{ "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }"#;

    fn profile(h: &Path, name: &str, patch: Option<&str>, manifest: &str) -> PathBuf {
        let dir = profiles_dir(h).join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("package.json"), manifest).unwrap();
        if let Some(p) = patch {
            fs::write(patch_path(&dir), p).unwrap();
        }
        patch_path(&dir)
    }

    fn conn() -> Connection {
        let mut c = test_conn();
        c.models = vec!["deepseek-v4-pro".into(), "deepseek-flash".into(), "glm-5.3".into()];
        c
    }

    fn rows(p: &Path) -> Vec<Value> {
        parse(p, &fs::read_to_string(p).unwrap()).unwrap()
    }

    fn last<'a>(rows: &'a [Value], id: &str) -> &'a Value {
        rows.iter().rev().find(|r| row_id(r) == Some(id)).unwrap()
    }

    #[test]
    fn merges_providers_sets_default_and_restores_exactly() {
        let h = tempfile::tempdir().unwrap();
        let web = profile(h.path(), "web", Some(USER), MANIFEST);
        let env = env_path(h.path());
        fs::write(&env, "DEEPSEEK_API_KEY=sk-user\n").unwrap();

        connect(h.path(), &conn()).unwrap();
        let r = rows(&web);
        let providers = &last(&r, PI_ROW)["config"]["providers"];
        let p = &providers[PROVIDER_ID];
        assert_eq!(p["baseURL"].as_str(), Some("https://relay.example/v1"));
        assert_eq!(p["apiKeyEnv"].as_str(), Some(KEY_ENV));
        assert_eq!(p["models"][0]["compat"]["thinkingFormat"].as_str(), Some("deepseek"));
        assert!(p["models"][2].get("reasoningEfforts").is_none());
        assert_eq!(providers["lgw"]["apiKeyEnv"].as_str(), Some("LGW_API_KEY"));
        let d = &last(&r, DEFAULT_ROW)["config"];
        assert_eq!(d["provider"].as_str(), Some(PROVIDER_ID));
        assert_eq!(d["model"].as_str(), Some("deepseek-flash"));
        assert_eq!(d["reasoningEffort"].as_str(), Some("high"));
        let e = fs::read_to_string(&env).unwrap();
        assert!(e.starts_with("DEEPSEEK_API_KEY=sk-user\n") && e.contains("CLOUDBORNE_DSH_API_KEY=sk-test-123\n"));
        assert!(is_connected(h.path()).unwrap());

        connect(h.path(), &conn()).unwrap(); // reconnect replaces, never stacks
        assert_eq!(fs::read_to_string(&web).unwrap().matches(fsx::BLOCK_BEGIN).count(), 1);
        disconnect(h.path()).unwrap();
        assert_eq!(fs::read_to_string(&web).unwrap(), USER);
        assert_eq!(fs::read_to_string(&env).unwrap(), "DEEPSEEK_API_KEY=sk-user\n");
        assert!(!is_connected(h.path()).unwrap());
    }

    #[test]
    fn template_files_round_trip_and_missing_templates_are_prepared() {
        let h = tempfile::tempdir().unwrap();
        let web = profile(h.path(), "web", Some(TEMPLATE), MANIFEST);
        connect(h.path(), &conn()).unwrap();
        // DSH creates `headless` on first launch and keeps a patch file it finds.
        let headless = patch_path(&profiles_dir(h.path()).join("headless"));
        assert_eq!(last(&rows(&headless), DEFAULT_ROW)["config"]["provider"].as_str(), Some(PROVIDER_ID));
        assert!(!fs::read_to_string(&web).unwrap().contains("\n[]\n"));
        disconnect(h.path()).unwrap();
        assert_eq!(fs::read_to_string(&web).unwrap(), TEMPLATE);
        assert!(rows(&headless).is_empty());
    }

    #[test]
    fn skips_profiles_not_built_on_base() {
        let h = tempfile::tempdir().unwrap();
        let minimal = profile(h.path(), "sdk-minimal", Some("[]\n"), r#"{ "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-sdk-minimal"] } } }"#);
        connect(h.path(), &conn()).unwrap();
        assert_eq!(fs::read_to_string(&minimal).unwrap(), "[]\n");
    }

    #[test]
    fn keeps_what_dsh_settings_wrote_into_our_block() {
        let h = tempfile::tempdir().unwrap();
        let web = profile(h.path(), "web", Some(TEMPLATE), MANIFEST);
        connect(h.path(), &conn()).unwrap();
        // DSH's settings page edits the last row with an id and appends new rows at the end.
        let text = fs::read_to_string(&web).unwrap();
        let text = text
            .replace("model: deepseek-flash\n    reasoningEffort: high", "model: deepseek-v4-pro\n    reasoningEffort: max")
            .replace(fsx::BLOCK_END, "- id: ui-settings\n  config:\n    theme: dark\n# <<< cloudborne-desktop");
        fs::write(&web, text).unwrap();

        connect(h.path(), &conn()).unwrap();
        let r = rows(&web);
        let d = &last(&r, DEFAULT_ROW)["config"];
        assert_eq!(d["model"].as_str(), Some("deepseek-v4-pro"));
        assert_eq!(d["reasoningEffort"].as_str(), Some("max"));

        disconnect(h.path()).unwrap();
        let r = rows(&web);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0]["config"]["theme"].as_str(), Some("dark"));
    }

    #[test]
    fn keeps_providers_and_defaults_the_user_added_while_connected() {
        let h = tempfile::tempdir().unwrap();
        let web = profile(h.path(), "web", Some(TEMPLATE), MANIFEST);
        connect(h.path(), &conn()).unwrap();
        let text = fs::read_to_string(&web).unwrap().replace(
            "    providers:\n",
            "    providers:\n      mine:\n        apiKeyEnv: MINE\n        api: openai-completions\n        baseURL: https://mine.example/v1\n        models:\n        - id: m\n",
        );
        let text = text.replace("provider: cloudborne\n    model: deepseek-flash", "provider: mine\n    model: m");
        fs::write(&web, text).unwrap();
        connect(h.path(), &conn()).unwrap();
        let r = rows(&web);
        let providers = last(&r, PI_ROW)["config"]["providers"].as_mapping().unwrap();
        assert!(providers.contains_key("mine") && providers.contains_key(PROVIDER_ID));

        disconnect(h.path()).unwrap();
        let r = rows(&web);
        let providers = last(&r, PI_ROW)["config"]["providers"].as_mapping().unwrap();
        assert!(providers.contains_key("mine") && !providers.contains_key(PROVIDER_ID));
        assert_eq!(last(&r, DEFAULT_ROW)["config"]["provider"].as_str(), Some("mine"));
    }

    #[test]
    fn refuses_to_copy_a_js_expression() {
        let h = tempfile::tempdir().unwrap();
        let js = "- id: llm-pi-ai\n  config:\n    providers: !!js ctx.providers\n";
        let web = profile(h.path(), "web", Some(js), MANIFEST);
        assert!(connect(h.path(), &conn()).is_err());
        assert_eq!(fs::read_to_string(&web).unwrap(), js);
        assert!(!has_js(TEMPLATE));
    }

    #[test]
    fn refuses_broken_files_without_writing() {
        let h = tempfile::tempdir().unwrap();
        let web = profile(h.path(), "web", Some("- id: [broken\n"), MANIFEST);
        assert!(connect(h.path(), &conn()).is_err());
        assert_eq!(fs::read_to_string(&web).unwrap(), "- id: [broken\n");
        assert!(!env_path(h.path()).exists());
    }

    #[test]
    fn no_models_is_an_error() {
        let h = tempfile::tempdir().unwrap();
        let mut c = conn();
        c.models.clear();
        assert!(connect(h.path(), &c).is_err());
    }

    #[test]
    fn default_follows_dsh_flash() {
        let m = |v: &[&str]| default_model(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>()).to_string();
        assert_eq!(m(&["deepseek-v4-pro", "deepseek-flash"]), "deepseek-flash");
        assert_eq!(m(&["glm-5.3", "deepseek-v4-pro", "deepseek-v4.1-flash"]), "deepseek-v4.1-flash");
        assert_eq!(m(&["glm-5.3", "deepseek-v4-pro"]), "deepseek-v4-pro");
        assert_eq!(m(&["glm-5.3"]), "glm-5.3");
    }
}
