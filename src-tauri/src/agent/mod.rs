//! New task: the user describes a problem and an agent fixes it on this
//! computer. Each turn runs our own copy of the Codex CLI against the relay
//! with a dedicated key, in a Codex home of our own so the user's `~/.codex`
//! and its history are left alone. Turns go through `codex app-server`
//! (`appserver`), which streams text and lets the model ask questions;
//! `CLOUDBORNE_AGENT_RUNNER=exec` switches back to `codex exec --json`.
//! Events stream to the UI over a channel; the UI-facing transcript is saved
//! in `store`.

mod appserver;
mod instructions;
mod runtime;
pub mod store;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::error::{Error, Result};
use crate::lang::tr;
use crate::tools;

pub use store::{Session as StoredSession, Summary};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// The Codex runtime is being downloaded; `percent` is None before the size is known.
    Runtime { percent: Option<u8> },
    Item { item: Value },
    /// Streamed text for an item: `field` of the item with `id` grows by
    /// `text`, and the item is created with `item_type` if it isn't there yet.
    Delta { id: String, item_type: &'static str, field: &'static str, text: String },
    Done,
    Stopped,
    Failed { kind: &'static str, message: String },
}

#[derive(Debug, Deserialize)]
pub struct Attachment {
    /// `data:image/...;base64,...`
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct SendOptions {
    pub session: String,
    pub prompt: String,
    #[serde(default)]
    pub images: Vec<Attachment>,
    pub model: String,
    pub effort: String,
    pub lang: String,
}

/// Running turns by session id, so Stop and answers to questions can reach them.
#[derive(Default)]
pub struct Runs {
    stops: Mutex<HashMap<String, oneshot::Sender<()>>>,
    answers: Mutex<HashMap<String, mpsc::UnboundedSender<appserver::Answer>>>,
    /// Serialises runtime downloads.
    install: Mutex<()>,
}

pub type SharedRuns = Arc<Runs>;

/// `<app data>/agent`, holding the runtime, Codex's home and our sessions.
pub fn root() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| tools::home_dir().join(".cloudborne-desktop"));
    let name = if cfg!(debug_assertions) { "cn.cloudborne.desktop.dev" } else { "cn.cloudborne.desktop" };
    base.join(name).join("agent")
}

fn codex_home(root: &Path) -> PathBuf {
    root.join("codex-home")
}

const PROVIDER: &str = "cloudborne";
const KEY_ENV: &str = "CLOUDBORNE_AGENT_KEY";

/// Our Codex home's config: the relay as the only provider, nothing that
/// phones home or nags about updates. The model may ask the user questions
/// in any turn, not only in plan mode. Memories stay off: on startup they run
/// a hidden consolidation agent on another model, billed to the user's key.
///
/// Codex trusts the folder it runs in and then layers `<folder>/.codex/config.toml`
/// over this file. Run in the home folder, that is the user's own Codex config
/// (their MCP servers, memories, features), so `work` is marked untrusted.
fn write_config(home: &Path, origin: &str, work: &Path) -> Result<()> {
    let base = format!("{}/v1", origin.trim_end_matches('/'));
    let work = toml_string(&work.to_string_lossy());
    let text = format!(
        "model_provider = \"{PROVIDER}\"\n\
         check_for_update_on_startup = false\n\
         suppress_unstable_features_warning = true\n\
         \n\
         [model_providers.{PROVIDER}]\n\
         name = \"Cloudborne\"\n\
         base_url = {base:?}\n\
         wire_api = \"responses\"\n\
         env_key = \"{KEY_ENV}\"\n\
         \n\
         [analytics]\n\
         enabled = false\n\
         \n\
         [feedback]\n\
         enabled = false\n\
         \n\
         [features]\n\
         default_mode_request_user_input = true\n\
         memories = false\n\
         \n\
         [projects.{work}]\n\
         trust_level = \"untrusted\"\n"
    );
    crate::fsx::write_atomic(&home.join("config.toml"), &text)
}

/// Writes data-URL screenshots to temp files for `--image`.
fn save_images(dir: &Path, images: &[Attachment]) -> Result<Vec<PathBuf>> {
    std::fs::create_dir_all(dir).map_err(|e| Error::io(dir, e))?;
    images
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let (head, b64) = a.data.split_once(',').ok_or_else(|| Error::Other("bad image".into()))?;
            let ext = match head {
                h if h.contains("image/jpeg") => "jpg",
                h if h.contains("image/gif") => "gif",
                h if h.contains("image/webp") => "webp",
                _ => "png",
            };
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| Error::Other(e.to_string()))?;
            let p = dir.join(format!("{i}.{ext}"));
            std::fs::write(&p, bytes).map_err(|e| Error::io(&p, e))?;
            Ok(p)
        })
        .collect()
}

/// Sorts a Codex failure message into what the user can do about it.
pub fn classify(message: &str) -> &'static str {
    let m = message.to_ascii_lowercase();
    if m.contains(" 402") || m.contains("insufficient balance") || m.contains("quota exceeded") || m.contains("insufficient_quota") {
        "balance"
    } else if m.contains(" 401") || m.contains("unauthorized") || m.contains("invalid api key") {
        "auth"
    } else if m.contains(" 429") || m.contains("rate limit") || m.contains("too many requests") {
        "rate"
    } else if m.contains("connection failed") || m.contains("error sending request") || m.contains("timed out") || m.contains("dns") {
        "network"
    } else {
        "other"
    }
}

/// Codex reports transient retries as top-level `error` events; only the
/// last one before `turn.failed` matters, and that arrives inside it.
fn is_retry_notice(msg: &str) -> bool {
    msg.starts_with("Reconnecting...")
}

pub struct Prepared {
    pub api_key: String,
    pub origin: String,
}

/// Runs one turn to completion, streaming events to `ch` and recording the
/// result in the session file.
pub async fn run_turn(runs: SharedRuns, opts: SendOptions, prep: Prepared, ch: Channel<Event>) -> Result<()> {
    let root = root();
    let now = chrono::Utc::now().timestamp();
    let mut session = store::load(&root, &opts.session)?.unwrap_or_else(|| store::Session {
        id: opts.session.clone(),
        title: title_of(&opts.prompt),
        updated_at: now,
        thread_id: None,
        turns: vec![],
        pinned: false,
        archived: false,
    });
    store::settle_interrupted(&mut session);
    session.updated_at = now;
    session.turns.push(store::Turn {
        prompt: opts.prompt.clone(),
        images: opts.images.iter().map(|a| a.data.clone()).collect(),
        items: vec![],
        status: "running".into(),
        failure: None,
    });
    store::save(&root, &session)?;

    let (stop_tx, stop_rx) = oneshot::channel();
    let (answer_tx, answer_rx) = mpsc::unbounded_channel();
    runs.stops.lock().await.insert(opts.session.clone(), stop_tx);
    runs.answers.lock().await.insert(opts.session.clone(), answer_tx);
    let outcome = match runtime_bin(&runs, &root, &ch).await {
        Ok(bin) if std::env::var("CLOUDBORNE_AGENT_RUNNER").is_ok_and(|v| v == "exec") => {
            drive_exec(&root, &bin, &opts, &prep, &mut session, &ch, stop_rx).await
        }
        Ok(bin) => appserver::drive(&root, &bin, &opts, &prep, &mut session, &ch, stop_rx, answer_rx).await,
        Err(e) => Err(e),
    };
    runs.stops.lock().await.remove(&opts.session);
    runs.answers.lock().await.remove(&opts.session);

    let turn = session.turns.last_mut().expect("turn just pushed");
    let event = match outcome {
        Ok(Outcome::Done) => {
            turn.status = "done".into();
            Event::Done
        }
        Ok(Outcome::Stopped) => {
            turn.status = "stopped".into();
            Event::Stopped
        }
        Ok(Outcome::Failed(kind, message)) => {
            turn.status = "failed".into();
            turn.failure = Some(store::Failure { kind: kind.into(), message: message.clone() });
            Event::Failed { kind, message }
        }
        Err(e) => {
            let message = e.to_string();
            let kind = if turn.items.is_empty() && runtime::installed(&root).is_none() { "runtime" } else { classify(&message) };
            turn.status = "failed".into();
            turn.failure = Some(store::Failure { kind: kind.into(), message: message.clone() });
            Event::Failed { kind, message }
        }
    };
    session.updated_at = chrono::Utc::now().timestamp();
    store::save_if_present(&root, &session)?;
    let _ = ch.send(event);
    Ok(())
}

enum Outcome {
    Done,
    Stopped,
    Failed(&'static str, String),
}

/// Our Codex binary, downloading it first if this is the first task.
async fn runtime_bin(runs: &Runs, root: &Path, ch: &Channel<Event>) -> Result<PathBuf> {
    if let Some(b) = runtime::installed(root) {
        return Ok(b);
    }
    let _guard = runs.install.lock().await;
    let _ = ch.send(Event::Runtime { percent: None });
    let ch2 = ch.clone();
    runtime::ensure(root, move |pct| {
        let _ = ch2.send(Event::Runtime { percent: Some(pct) });
    })
    .await
}

/// The Codex process for one turn, before its subcommand: our Codex home
/// (config rewritten each time), the agent's key, the user's usual PATH and
/// piped stdio.
fn codex_command(root: &Path, bin: &Path, prep: &Prepared, work: &Path) -> Result<tokio::process::Command> {
    let home = codex_home(root);
    write_config(&home, &prep.origin, work)?;
    let mut cmd = tokio::process::Command::new(bin);
    // A GUI app's PATH is minimal; give the agent the user's usual tool dirs,
    // plus the ripgrep that ships with the runtime.
    let mut path: Vec<PathBuf> = tools::detect::search_path(work);
    if let Some(v) = runtime::vendor(root) {
        path.insert(0, v.join("codex-path"));
    }
    if let Ok(joined) = std::env::join_paths(path) {
        cmd.env("PATH", joined);
    }
    cmd.env("CODEX_HOME", &home)
        .env(KEY_ENV, &prep.api_key)
        .current_dir(work)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

/// The last 20 lines of a stream (Codex's stderr), for failure messages.
async fn tail(r: impl AsyncRead + Unpin) -> String {
    let mut lines = BufReader::new(r).lines();
    let mut tail: Vec<String> = Vec::new();
    while let Ok(Some(l)) = lines.next_line().await {
        tail.push(l);
        if tail.len() > 20 {
            tail.remove(0);
        }
    }
    tail.join("\n")
}

/// The older runner: one `codex exec --json` per turn, kept behind
/// `CLOUDBORNE_AGENT_RUNNER=exec`. It cannot stream text or ask questions.
async fn drive_exec(
    root: &Path,
    bin: &Path,
    opts: &SendOptions,
    prep: &Prepared,
    session: &mut store::Session,
    ch: &Channel<Event>,
    mut stop_rx: oneshot::Receiver<()>,
) -> Result<Outcome> {
    let work = tools::home_dir();
    let tmp = root.join("tmp").join(&opts.session);
    let images = save_images(&tmp, &opts.images)?;

    let mut cmd = codex_command(root, bin, prep, &work)?;
    cmd.arg("exec")
        .arg("--json")
        .arg("--skip-git-repo-check")
        .arg("--dangerously-bypass-approvals-and-sandbox")
        .arg("--cd")
        .arg(&work)
        .arg("--model")
        .arg(&opts.model)
        .arg("-c")
        .arg(format!("model_reasoning_effort={:?}", opts.effort))
        // Codex's catalog asks for no thinking summary unless told to.
        .arg("-c")
        .arg("model_reasoning_summary=\"auto\"")
        .arg("-c")
        .arg(format!(
            "developer_instructions={}",
            toml_string(&instructions::text(&opts.lang, &work, &prep.origin))
        ));
    if let Some(thread) = &session.thread_id {
        cmd.arg("resume");
        for p in &images {
            cmd.arg(format!("--image={}", p.display()));
        }
        cmd.arg(thread);
    } else {
        for p in &images {
            cmd.arg(format!("--image={}", p.display()));
        }
    }
    cmd.arg("-");

    let mut child = cmd.spawn().map_err(|e| Error::io(bin, e))?;
    {
        let mut stdin = child.stdin.take().expect("piped stdin");
        let prompt = opts.prompt.clone();
        tokio::spawn(async move {
            let _ = stdin.write_all(prompt.as_bytes()).await;
        });
    }
    let stderr = child.stderr.take().expect("piped stderr");
    let stderr_tail = tokio::spawn(tail(stderr));
    let mut lines = BufReader::new(child.stdout.take().expect("piped stdout")).lines();

    let mut failure: Option<String> = None;
    let mut last_error: Option<String> = None;
    let mut completed = false;
    let mut stopped = false;
    loop {
        tokio::select! {
            _ = &mut stop_rx => {
                stopped = true;
                let _ = child.start_kill();
                break;
            }
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { break };
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                match v.get("type").and_then(Value::as_str).unwrap_or("") {
                    "thread.started" => {
                        if let Some(id) = v.get("thread_id").and_then(Value::as_str) {
                            if session.thread_id.as_deref() != Some(id) {
                                session.thread_id = Some(id.to_string());
                                store::save_if_present(root, session)?;
                            }
                        }
                    }
                    "item.started" | "item.updated" | "item.completed" => {
                        if let Some(item) = v.get("item") {
                            // Codex's own notices (model metadata, resume hints) aren't for the user.
                            if item.get("type").and_then(Value::as_str) == Some("error") {
                                continue;
                            }
                            upsert(&mut session.turns.last_mut().expect("turn").items, item.clone());
                            let _ = ch.send(Event::Item { item: item.clone() });
                        }
                    }
                    "turn.completed" => completed = true,
                    "turn.failed" => {
                        failure = v.pointer("/error/message").and_then(Value::as_str).map(str::to_string);
                    }
                    "error" => {
                        if let Some(m) = v.get("message").and_then(Value::as_str) {
                            if !is_retry_notice(m) {
                                last_error = Some(m.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    let status = child.wait().await.ok();
    let stderr = stderr_tail.await.unwrap_or_default();
    let _ = std::fs::remove_dir_all(&tmp);

    if stopped {
        return Ok(Outcome::Stopped);
    }
    if let Some(m) = failure.or(last_error) {
        return Ok(Outcome::Failed(classify(&m), m));
    }
    if completed {
        return Ok(Outcome::Done);
    }
    let code = status.and_then(|s| s.code()).map(|c| c.to_string()).unwrap_or_else(|| "?".into());
    let message = if stderr.trim().is_empty() { format!("codex exited ({code})") } else { stderr };
    Ok(Outcome::Failed(classify(&message), message))
}

/// Codex re-sends an item as it changes; keep the latest by id.
fn upsert(items: &mut Vec<Value>, item: Value) {
    let id = item.get("id").cloned();
    match items.iter_mut().find(|x| id.is_some() && x.get("id") == id.as_ref()) {
        Some(slot) => *slot = item,
        None => items.push(item),
    }
}

fn toml_string(s: &str) -> String {
    toml_edit::value(s).to_string().trim().to_string()
}

pub fn title_of(prompt: &str) -> String {
    let line = prompt.trim().lines().next().unwrap_or("").trim();
    let mut t: String = line.chars().take(40).collect();
    if line.chars().count() > 40 {
        t.push('…');
    }
    t
}

pub async fn stop(runs: &Runs, id: &str) {
    if let Some(tx) = runs.stops.lock().await.remove(id) {
        let _ = tx.send(());
    }
}

/// Passes the user's answer to a question to the turn that asked it.
pub async fn answer(runs: &Runs, session: &str, request: String, answers: BTreeMap<String, Vec<String>>) -> Result<()> {
    match runs.answers.lock().await.get(session) {
        Some(tx) if tx.send((request, answers)).is_ok() => Ok(()),
        _ => Err(Error::Other(tr("这个问题已经失效", "This question is no longer open").into())),
    }
}

pub fn not_available() -> Error {
    Error::Other(tr("你的账号下没有可用的 GPT 分组", "Your account has no GPT group").into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_relay_failures() {
        assert_eq!(classify("unexpected status 402 Payment Required: Insufficient balance, url: x"), "balance");
        assert_eq!(classify("Quota exceeded. Check your plan and billing details."), "balance");
        assert_eq!(classify("unexpected status 401 Unauthorized: bad key"), "auth");
        assert_eq!(classify("unexpected status 429 Too Many Requests"), "rate");
        assert_eq!(classify("Connection failed: error sending request"), "network");
        assert_eq!(classify("something else"), "other");
    }

    #[test]
    fn upsert_replaces_by_id() {
        let mut items = vec![];
        upsert(&mut items, serde_json::json!({"id": "a", "status": "in_progress"}));
        upsert(&mut items, serde_json::json!({"id": "b"}));
        upsert(&mut items, serde_json::json!({"id": "a", "status": "completed"}));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["status"], "completed");
    }

    #[test]
    fn config_keeps_the_users_own_codex_config_out() {
        let dir = tempfile::tempdir().unwrap();
        write_config(dir.path(), "https://api.example.com/", Path::new("/Users/a \"b\"")).unwrap();
        let doc: toml_edit::DocumentMut = std::fs::read_to_string(dir.path().join("config.toml")).unwrap().parse().unwrap();
        assert_eq!(doc["model_providers"]["cloudborne"]["base_url"].as_str(), Some("https://api.example.com/v1"));
        assert_eq!(doc["projects"]["/Users/a \"b\""]["trust_level"].as_str(), Some("untrusted"));
        assert_eq!(doc["features"]["memories"].as_bool(), Some(false));
        assert_eq!(doc["features"]["default_mode_request_user_input"].as_bool(), Some(true));
    }

    #[test]
    fn instructions_are_a_valid_toml_string() {
        let s = toml_string("line one\n\"quoted\" \\ back");
        let doc: toml_edit::DocumentMut = format!("x = {s}").parse().unwrap();
        assert_eq!(doc["x"].as_str(), Some("line one\n\"quoted\" \\ back"));
    }

    #[test]
    fn titles_are_first_line_and_short() {
        assert_eq!(title_of("  fix it\nmore"), "fix it");
        assert_eq!(title_of(&"字".repeat(50)).chars().count(), 41);
    }
}
