//! Runs a turn through `codex app-server` (JSON lines over stdio). Unlike
//! `codex exec --json` it streams the reply and the thinking summary as they
//! are written, and lets the model stop mid-turn to ask the user a question
//! (`request_user_input`). One process per turn: handshake, start or resume
//! the thread, start the turn, then follow it until `turn/completed`.
//!
//! Items are converted to the shape `codex exec --json` used, so the UI and
//! the sessions saved by older versions keep working.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Map, Value};
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{sleep_until, timeout, Instant};

use super::{classify, instructions, store, upsert, Event, Outcome, Prepared, SendOptions};
use crate::error::{Error, Result};

/// The user's answer to a question: the request it answers, and the chosen
/// labels (or typed text) by question id.
pub type Answer = (String, BTreeMap<String, Vec<String>>);

/// How long a stopped turn gets to wind down before the process is killed.
const STOP_GRACE: Duration = Duration::from_secs(3);
/// Handshake calls answer at once; this only guards against a hung process.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------- requests

pub fn initialize_params() -> Value {
    json!({
        "clientInfo": { "name": "cloudborne_desktop", "title": "Cloudborne", "version": env!("CARGO_PKG_VERSION") },
        // request_user_input is still marked experimental.
        "capabilities": { "experimentalApi": true },
    })
}

/// `thread/start` for a new task, `thread/resume` to continue one.
pub fn thread_request(thread: Option<&str>, model: &str, cwd: &Path, instructions: &str) -> (&'static str, Value) {
    let mut p = json!({
        "model": model,
        "cwd": cwd,
        "approvalPolicy": "never",
        "sandbox": "danger-full-access",
        "developerInstructions": instructions,
    });
    match thread {
        Some(id) => {
            p["threadId"] = id.into();
            ("thread/resume", p)
        }
        None => ("thread/start", p),
    }
}

/// Codex's model catalog asks for no reasoning summary by default, so the
/// turn has to ask for one or no thinking ever arrives.
pub fn turn_params(thread: &str, prompt: &str, images: &[PathBuf], model: &str, effort: &str) -> Value {
    let mut input = vec![json!({ "type": "text", "text": prompt, "text_elements": [] })];
    input.extend(images.iter().map(|p| json!({ "type": "localImage", "path": p })));
    json!({ "threadId": thread, "input": input, "model": model, "effort": effort, "summary": "auto" })
}

pub fn answer_result(answers: &BTreeMap<String, Vec<String>>) -> Value {
    let map: Map<String, Value> = answers.iter().map(|(k, v)| (k.clone(), json!({ "answers": v }))).collect();
    json!({ "answers": map })
}

// ---------------------------------------------------------------- items

fn status(item: &Value, done: bool) -> &str {
    match item.get("status").and_then(Value::as_str) {
        Some("inProgress") => "in_progress",
        Some(s) => s,
        None if done => "completed",
        None => "in_progress",
    }
}

/// An app-server item in the shape `codex exec --json` used. `done` says
/// whether it has finished; `ms` is how long it took, when known. Items the
/// UI does not show (the user's own message, sub-agents, …) give `None`.
pub fn convert(item: &Value, done: bool, ms: Option<i64>) -> Option<Value> {
    let id = item.get("id")?.as_str()?;
    let s = |k: &str| item.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Some(match item.get("type")?.as_str()? {
        "agentMessage" => json!({ "id": id, "type": "agent_message", "text": s("text"), "status": if done { "completed" } else { "in_progress" } }),
        "reasoning" => {
            let parts: Vec<&str> = item.get("summary").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
            let mut v = json!({ "id": id, "type": "reasoning", "text": parts.join("\n\n"), "status": if done { "completed" } else { "in_progress" } });
            if let Some(ms) = ms {
                v["duration_ms"] = ms.into();
            }
            v
        }
        "commandExecution" => json!({
            "id": id,
            "type": "command_execution",
            "command": s("command"),
            "aggregated_output": s("aggregatedOutput"),
            "exit_code": item.get("exitCode").cloned().unwrap_or(Value::Null),
            "status": status(item, done),
        }),
        "fileChange" => {
            let changes: Vec<Value> = item
                .get("changes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|c| json!({ "path": c.get("path").cloned().unwrap_or_default(), "kind": c.pointer("/kind/type").cloned().unwrap_or_else(|| "update".into()) }))
                .collect();
            json!({ "id": id, "type": "file_change", "changes": changes, "status": status(item, done) })
        }
        "mcpToolCall" => json!({ "id": id, "type": "mcp_tool_call", "server": s("server"), "tool": s("tool"), "status": status(item, done) }),
        "webSearch" => json!({ "id": id, "type": "web_search", "query": s("query") }),
        _ => return None,
    })
}

/// The turn's plan (`turn/plan/updated`) as the checklist item exec used.
pub fn plan_item(turn: &str, plan: &Value) -> Value {
    let items: Vec<Value> = plan
        .as_array()
        .into_iter()
        .flatten()
        .map(|s| json!({ "text": s.get("step").cloned().unwrap_or_default(), "completed": s.get("status").and_then(Value::as_str) == Some("completed") }))
        .collect();
    json!({ "id": format!("plan-{turn}"), "type": "todo_list", "items": items })
}

/// A `request_user_input` call as a transcript item the UI draws as a card.
pub fn question_item(request: &str, params: &Value) -> Value {
    json!({
        "id": params.get("itemId").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("ask-{request}")),
        "type": "question",
        "request": request,
        "questions": params.get("questions").cloned().unwrap_or_else(|| json!([])),
        "status": "pending",
    })
}

/// Records the answers on the question; answers to secret questions are
/// sent to the model but never written to the transcript.
pub fn mark_answered(item: &mut Value, answers: &BTreeMap<String, Vec<String>>) {
    let secret: Vec<&str> = item["questions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|q| q.get("isSecret").and_then(Value::as_bool) == Some(true))
        .filter_map(|q| q.get("id").and_then(Value::as_str))
        .collect();
    let shown: Map<String, Value> = answers
        .iter()
        .map(|(k, v)| (k.clone(), if secret.contains(&k.as_str()) { json!(["••••••"]) } else { json!(v) }))
        .collect();
    item["answers"] = Value::Object(shown);
    item["status"] = "answered".into();
}

// ---------------------------------------------------------------- the turn

/// The app-server's stdio, with the messages that arrived while waiting for
/// a response kept for the main loop.
struct Conn {
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    next_id: i64,
    backlog: VecDeque<Value>,
}

impl Conn {
    async fn write(&mut self, v: &Value) -> Result<()> {
        let mut line = v.to_string();
        line.push('\n');
        let io = |e: std::io::Error| Error::Other(format!("codex app-server: {e}"));
        self.stdin.write_all(line.as_bytes()).await.map_err(io)?;
        self.stdin.flush().await.map_err(io)
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<i64> {
        self.next_id += 1;
        let id = self.next_id;
        self.write(&json!({ "id": id, "method": method, "params": params })).await?;
        Ok(id)
    }

    /// Sends a request and waits for its response.
    async fn call(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.request(method, params).await?;
        let wait = async {
            loop {
                let Some(line) = self.lines.next_line().await.ok().flatten() else {
                    return Err(Error::Other(format!("codex app-server exited during {method}")));
                };
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                if v.get("method").is_none() && v.get("id") == Some(&json!(id)) {
                    return match v.get("error") {
                        Some(e) => Err(Error::Other(e.get("message").and_then(Value::as_str).unwrap_or("request failed").to_string())),
                        None => Ok(v.get("result").cloned().unwrap_or(Value::Null)),
                    };
                }
                self.backlog.push_back(v);
            }
        };
        timeout(CALL_TIMEOUT, wait).await.map_err(|_| Error::Other(format!("codex app-server did not answer {method}")))?
    }
}

/// Adds streamed text to an item, creating it if the stream got there first.
fn append(session: &mut store::Session, ch: &Channel<Event>, id: &str, item_type: &'static str, field: &'static str, text: &str) {
    let items = &mut session.turns.last_mut().expect("turn").items;
    let i = match items.iter().position(|x| x.get("id").and_then(Value::as_str) == Some(id)) {
        Some(i) => i,
        None => {
            items.push(json!({ "id": id, "type": item_type, field: "", "status": "in_progress" }));
            items.len() - 1
        }
    };
    let cur = items[i].get(field).and_then(Value::as_str).unwrap_or("").to_string();
    items[i][field] = format!("{cur}{text}").into();
    let _ = ch.send(Event::Delta { id: id.to_string(), item_type, field, text: text.to_string() });
}

fn emit(session: &mut store::Session, ch: &Channel<Event>, item: Value) {
    upsert(&mut session.turns.last_mut().expect("turn").items, item.clone());
    let _ = ch.send(Event::Item { item });
}

enum Next {
    Stop,
    Answer(Answer),
    Kill,
    Line(Option<String>),
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn drive(
    root: &Path,
    bin: &Path,
    opts: &SendOptions,
    prep: &Prepared,
    session: &mut store::Session,
    ch: &Channel<Event>,
    mut stop_rx: oneshot::Receiver<()>,
    mut answer_rx: mpsc::UnboundedReceiver<Answer>,
) -> Result<Outcome> {
    let work = crate::tools::home_dir();
    let tmp = root.join("tmp").join(&opts.session);
    let images = super::save_images(&tmp, &opts.images)?;

    let mut cmd = super::codex_command(root, bin, prep, &work)?;
    cmd.arg("app-server");
    let mut child = cmd.spawn().map_err(|e| Error::io(bin, e))?;
    let stderr = child.stderr.take().expect("piped stderr");
    let stderr_tail = tokio::spawn(super::tail(stderr));
    let mut conn = Conn {
        stdin: child.stdin.take().expect("piped stdin"),
        lines: BufReader::new(child.stdout.take().expect("piped stdout")).lines(),
        next_id: 0,
        backlog: VecDeque::new(),
    };

    let outcome = follow(&mut conn, root, opts, prep, &work, &images, session, ch, &mut stop_rx, &mut answer_rx, &mut child).await;

    // Questions nobody answered can no longer be answered.
    let expired: Vec<Value> = session
        .turns
        .last_mut()
        .expect("turn")
        .items
        .iter_mut()
        .filter(|x| x["type"] == "question" && x["status"] == "pending")
        .map(|x| {
            x["status"] = "expired".into();
            x.clone()
        })
        .collect();
    for item in expired {
        let _ = ch.send(Event::Item { item });
    }

    // Closing stdin ends the server; give it a moment to finish its files.
    drop(conn);
    if timeout(Duration::from_secs(2), child.wait()).await.is_err() {
        let _ = child.kill().await;
    }
    let stderr = stderr_tail.await.unwrap_or_default();
    let _ = std::fs::remove_dir_all(&tmp);

    match outcome {
        Ok(Some(o)) => Ok(o),
        Ok(None) => {
            let message = if stderr.trim().is_empty() { "codex app-server exited".to_string() } else { stderr };
            Ok(Outcome::Failed(classify(&message), message))
        }
        Err(e) => Err(e),
    }
}

/// The turn itself. `Ok(None)` means the server went away before the turn
/// finished.
#[allow(clippy::too_many_arguments)]
async fn follow(
    conn: &mut Conn,
    root: &Path,
    opts: &SendOptions,
    prep: &Prepared,
    work: &Path,
    images: &[PathBuf],
    session: &mut store::Session,
    ch: &Channel<Event>,
    stop_rx: &mut oneshot::Receiver<()>,
    answer_rx: &mut mpsc::UnboundedReceiver<Answer>,
    child: &mut tokio::process::Child,
) -> Result<Option<Outcome>> {
    conn.call("initialize", initialize_params()).await?;
    conn.write(&json!({ "method": "initialized" })).await?;

    let text = instructions::text(&opts.lang, work, &prep.origin);
    let (method, params) = thread_request(session.thread_id.as_deref(), &opts.model, work, &text);
    let started = conn.call(method, params).await?;
    let thread = started.pointer("/thread/id").and_then(Value::as_str).ok_or_else(|| Error::Other(format!("{method}: no thread id")))?.to_string();
    if session.thread_id.as_deref() != Some(thread.as_str()) {
        session.thread_id = Some(thread.clone());
        store::save_if_present(root, session)?;
    }

    let turn = conn.call("turn/start", turn_params(&thread, &opts.prompt, images, &opts.model, &opts.effort)).await?;
    let mut turn_id = turn.pointer("/turn/id").and_then(Value::as_str).unwrap_or("").to_string();

    let mut began: HashMap<String, i64> = HashMap::new();
    // When the previous step finished (or the turn began). A reasoning item only
    // starts once its summary does, so thinking is timed from here instead.
    let mut mark = chrono::Utc::now().timestamp_millis();
    // Open questions: request id as the UI knows it -> the JSON-RPC id to answer.
    let mut asking: HashMap<String, Value> = HashMap::new();
    let mut last_error: Option<String> = None;
    let mut kill_at: Option<Instant> = None;
    let mut stopped = false;

    loop {
        let next = match conn.backlog.pop_front() {
            Some(v) => Next::Line(Some(v.to_string())),
            None => tokio::select! {
                _ = &mut *stop_rx, if !stopped => Next::Stop,
                Some(a) = answer_rx.recv() => Next::Answer(a),
                _ = sleep_until(kill_at.unwrap_or_else(Instant::now)), if kill_at.is_some() => Next::Kill,
                line = conn.lines.next_line() => Next::Line(line.ok().flatten()),
            },
        };
        let msg: Value = match next {
            Next::Stop => {
                stopped = true;
                if turn_id.is_empty() {
                    let _ = child.start_kill();
                    return Ok(Some(Outcome::Stopped));
                }
                let _ = conn.request("turn/interrupt", json!({ "threadId": thread, "turnId": turn_id })).await;
                kill_at = Some(Instant::now() + STOP_GRACE);
                continue;
            }
            Next::Kill => {
                let _ = child.start_kill();
                return Ok(Some(Outcome::Stopped));
            }
            Next::Answer((request, answers)) => {
                if let Some(rpc_id) = asking.remove(&request) {
                    conn.write(&json!({ "id": rpc_id, "result": answer_result(&answers) })).await?;
                    let items = &mut session.turns.last_mut().expect("turn").items;
                    if let Some(item) = items.iter_mut().find(|x| x["type"] == "question" && x["request"] == request.as_str()) {
                        mark_answered(item, &answers);
                        let _ = ch.send(Event::Item { item: item.clone() });
                    }
                    store::save_if_present(root, session)?;
                    mark = chrono::Utc::now().timestamp_millis();
                }
                continue;
            }
            Next::Line(None) => return Ok(if stopped { Some(Outcome::Stopped) } else { None }),
            Next::Line(Some(line)) => match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            },
        };

        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let p = msg.get("params").cloned().unwrap_or(Value::Null);
        if let Some(rpc_id) = msg.get("id").cloned() {
            if method.is_empty() {
                continue; // a response, e.g. to turn/interrupt
            }
            if method == "item/tool/requestUserInput" {
                let request = match &rpc_id {
                    Value::String(s) => s.clone(),
                    v => v.to_string(),
                };
                emit(session, ch, question_item(&request, &p));
                asking.insert(request, rpc_id);
                store::save_if_present(root, session)?;
            } else {
                // Approvals cannot come up with approvalPolicy "never"; anything else is not ours to answer.
                conn.write(&json!({ "id": rpc_id, "error": { "code": -32601, "message": format!("{method} is not supported by Cloudborne") } })).await?;
            }
            continue;
        }

        match method {
            "turn/started" => {
                if let Some(id) = p.pointer("/turn/id").and_then(Value::as_str) {
                    turn_id = id.to_string();
                }
            }
            "item/started" => {
                let item = &p["item"];
                if let (Some(id), Some(at)) = (item.get("id").and_then(Value::as_str), p.get("startedAtMs").and_then(Value::as_i64)) {
                    began.insert(id.to_string(), at);
                }
                // A streamed item may already exist from its first delta; keep that text.
                let exists = session.turns.last().expect("turn").items.iter().any(|x| x.get("id") == item.get("id"));
                if !exists {
                    if let Some(v) = convert(item, false, None) {
                        emit(session, ch, v);
                    }
                }
            }
            "item/completed" => {
                let item = &p["item"];
                let done = p.get("completedAtMs").and_then(Value::as_i64);
                let start = item.get("id").and_then(Value::as_str).and_then(|id| began.get(id).copied());
                let start = if item["type"] == "reasoning" { Some(start.map_or(mark, |s| s.min(mark))) } else { start };
                let ms = start.zip(done).map(|(a, b)| (b - a).max(0));
                if let Some(v) = convert(item, true, ms) {
                    emit(session, ch, v);
                }
                if let Some(done) = done {
                    mark = done;
                }
            }
            "item/agentMessage/delta" => {
                append(session, ch, p["itemId"].as_str().unwrap_or(""), "agent_message", "text", p["delta"].as_str().unwrap_or(""));
            }
            "item/reasoning/summaryPartAdded" => {
                if p["summaryIndex"].as_i64().unwrap_or(0) > 0 {
                    append(session, ch, p["itemId"].as_str().unwrap_or(""), "reasoning", "text", "\n\n");
                }
            }
            "item/reasoning/summaryTextDelta" => {
                append(session, ch, p["itemId"].as_str().unwrap_or(""), "reasoning", "text", p["delta"].as_str().unwrap_or(""));
            }
            "item/commandExecution/outputDelta" => {
                append(session, ch, p["itemId"].as_str().unwrap_or(""), "command_execution", "aggregated_output", p["delta"].as_str().unwrap_or(""));
            }
            "turn/plan/updated" => {
                let turn = p["turnId"].as_str().unwrap_or(&turn_id).to_string();
                emit(session, ch, plan_item(&turn, &p["plan"]));
            }
            "error" => {
                if p["willRetry"].as_bool() != Some(true) {
                    if let Some(m) = p.pointer("/error/message").and_then(Value::as_str) {
                        last_error = Some(m.to_string());
                    }
                }
            }
            "turn/completed" => {
                let t = &p["turn"];
                return Ok(Some(match t["status"].as_str().unwrap_or("") {
                    "completed" => Outcome::Done,
                    "interrupted" => Outcome::Stopped,
                    _ if stopped => Outcome::Stopped,
                    _ => {
                        let m = t.pointer("/error/message").and_then(Value::as_str).map(str::to_string).or(last_error).unwrap_or_else(|| "turn failed".into());
                        Outcome::Failed(classify(&m), m)
                    }
                }));
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_items_to_the_exec_shape() {
        let msg = convert(&json!({"type": "agentMessage", "id": "m1", "text": "hi", "phase": null}), true, None).unwrap();
        assert_eq!(msg, json!({"id": "m1", "type": "agent_message", "text": "hi", "status": "completed"}));

        let r = convert(&json!({"type": "reasoning", "id": "r1", "summary": ["**One**", "Two"], "content": []}), true, Some(1400)).unwrap();
        assert_eq!(r, json!({"id": "r1", "type": "reasoning", "text": "**One**\n\nTwo", "status": "completed", "duration_ms": 1400}));
        let live = convert(&json!({"type": "reasoning", "id": "r2"}), false, None).unwrap();
        assert_eq!(live["status"], "in_progress");
        assert_eq!(live["text"], "");

        let c = convert(
            &json!({"type": "commandExecution", "id": "c1", "command": "ls", "cwd": "/", "commandActions": [], "status": "inProgress", "aggregatedOutput": null, "exitCode": null}),
            false,
            None,
        )
        .unwrap();
        assert_eq!(c, json!({"id": "c1", "type": "command_execution", "command": "ls", "aggregated_output": "", "exit_code": null, "status": "in_progress"}));

        let f = convert(
            &json!({"type": "fileChange", "id": "f1", "status": "completed", "changes": [{"path": "/a", "diff": "+x", "kind": {"type": "add"}}, {"path": "/b", "diff": "", "kind": {"type": "update", "move_path": null}}]}),
            true,
            None,
        )
        .unwrap();
        assert_eq!(f["changes"], json!([{"path": "/a", "kind": "add"}, {"path": "/b", "kind": "update"}]));
        assert_eq!(f["status"], "completed");

        assert_eq!(convert(&json!({"type": "webSearch", "id": "w", "query": "q"}), true, None).unwrap()["query"], "q");
        assert_eq!(convert(&json!({"type": "mcpToolCall", "id": "t", "server": "s", "tool": "x", "status": "failed", "arguments": {}}), true, None).unwrap()["status"], "failed");
        assert!(convert(&json!({"type": "userMessage", "id": "u", "content": []}), true, None).is_none());
    }

    #[test]
    fn plan_becomes_a_checklist() {
        let v = plan_item("t1", &json!([{"step": "Read", "status": "completed"}, {"step": "Fix", "status": "inProgress"}]));
        assert_eq!(v, json!({"id": "plan-t1", "type": "todo_list", "items": [{"text": "Read", "completed": true}, {"text": "Fix", "completed": false}]}));
    }

    #[test]
    fn questions_hide_secret_answers() {
        let params = json!({"itemId": "call_1", "threadId": "t", "turnId": "u", "isBlocking": true, "questions": [
            {"id": "dir", "header": "Project", "question": "Which one?", "options": [{"label": "A (Recommended)", "description": "a"}]},
            {"id": "pin", "header": "PIN", "question": "Code?", "isSecret": true, "options": null}
        ]});
        let mut item = question_item("7", &params);
        assert_eq!(item["id"], "call_1");
        assert_eq!(item["request"], "7");
        assert_eq!(item["status"], "pending");
        let answers = BTreeMap::from([("dir".to_string(), vec!["A (Recommended)".to_string()]), ("pin".to_string(), vec!["1234".to_string()])]);
        mark_answered(&mut item, &answers);
        assert_eq!(item["status"], "answered");
        assert_eq!(item["answers"]["dir"], json!(["A (Recommended)"]));
        assert_ne!(item["answers"]["pin"], json!(["1234"]));
        // The model still gets the real answer.
        assert_eq!(answer_result(&answers), json!({"answers": {"dir": {"answers": ["A (Recommended)"]}, "pin": {"answers": ["1234"]}}}));
    }

    /// End to end against a fake upstream: `CLOUDBORNE_TEST_CODEX` is the
    /// Codex binary, `CLOUDBORNE_TEST_UPSTREAM` the origin of a mock that
    /// streams reasoning, asks one question when it can, then answers, and
    /// stalls on a prompt containing SLOW. The first turn runs through exec so
    /// the test also shows exec threads resume under app-server.
    #[test]
    #[ignore]
    fn drives_turns_against_a_mock_upstream() {
        use std::sync::{Arc, Mutex};
        let bin = PathBuf::from(std::env::var("CLOUDBORNE_TEST_CODEX").expect("CLOUDBORNE_TEST_CODEX"));
        let origin = std::env::var("CLOUDBORNE_TEST_UPSTREAM").expect("CLOUDBORNE_TEST_UPSTREAM");
        let root = tempfile::tempdir().unwrap();
        let prep = Prepared { api_key: "sk-mock".into(), origin };
        let id = uuid::Uuid::new_v4().to_string();
        let mut session = store::Session { id: id.clone(), title: "t".into(), updated_at: 0, thread_id: None, turns: vec![], pinned: false, archived: false };
        store::save(root.path(), &session).unwrap();
        let opts = |prompt: &str| SendOptions {
            session: id.clone(),
            prompt: prompt.into(),
            images: vec![],
            model: "gpt-5.6-sol".into(),
            effort: "low".into(),
            lang: "zh-CN".into(),
        };
        let push = |s: &mut store::Session, prompt: &str| {
            s.turns.push(store::Turn { prompt: prompt.into(), images: vec![], items: vec![], status: "running".into(), failure: None })
        };
        let events: Arc<Mutex<Vec<Value>>> = Arc::default();

        tauri::async_runtime::block_on(async {
            // Turn 1 through exec, which starts the thread.
            push(&mut session, "hello");
            let (_stop, stop_rx) = oneshot::channel();
            let ch = Channel::new(|_| Ok(()));
            let o = super::super::drive_exec(root.path(), &bin, &opts("hello"), &prep, &mut session, &ch, stop_rx).await.unwrap();
            assert!(matches!(o, Outcome::Done));
            let thread = session.thread_id.clone().expect("exec started a thread");

            // Turn 2 resumes it through app-server; the mock asks, the test answers.
            push(&mut session, "fix it");
            let (answer_tx, answer_rx) = mpsc::unbounded_channel::<Answer>();
            let seen = events.clone();
            let ch = Channel::new(move |body| {
                let tauri::ipc::InvokeResponseBody::Json(s) = body else { return Ok(()) };
                let v: Value = serde_json::from_str(&s).unwrap();
                if v.pointer("/item/type") == Some(&json!("question")) && v.pointer("/item/status") == Some(&json!("pending")) {
                    let request = v.pointer("/item/request").and_then(Value::as_str).unwrap().to_string();
                    let qid = v.pointer("/item/questions/0/id").and_then(Value::as_str).unwrap().to_string();
                    answer_tx.send((request, BTreeMap::from([(qid, vec!["B".to_string()])]))).unwrap();
                }
                seen.lock().unwrap().push(v);
                Ok(())
            });
            let (_stop, stop_rx) = oneshot::channel();
            let o = drive(root.path(), &bin, &opts("fix it"), &prep, &mut session, &ch, stop_rx, answer_rx).await.unwrap();
            assert!(matches!(o, Outcome::Done), "turn 2 did not finish");
            assert_eq!(session.thread_id.as_deref(), Some(thread.as_str()), "app-server resumed the exec thread");

            let items = &session.turns[1].items;
            let kind = |t: &str| items.iter().filter(|x| x["type"] == t).cloned().collect::<Vec<_>>();
            let q = &kind("question")[0];
            assert_eq!(q["status"], "answered");
            assert_eq!(q["answers"], json!({ q["questions"][0]["id"].as_str().unwrap(): ["B"] }));
            let r = kind("reasoning");
            assert!(r.iter().all(|x| x["status"] == "completed" && x["duration_ms"].is_i64()), "{r:?}");
            assert!(r[0]["text"].as_str().unwrap().contains("Checking the setup"));
            let m = kind("agent_message");
            assert_eq!(m.last().unwrap()["text"], "Answer received, carrying on.");
            let ev = events.lock().unwrap().clone();
            let deltas = |t: &str| ev.iter().filter(|e| e["type"] == "delta" && e["item_type"] == t).count();
            assert!(deltas("reasoning") >= 3 && deltas("agent_message") >= 3, "deltas streamed");

            // Turn 3: Stop while the reply stalls ends the turn as stopped.
            push(&mut session, "SLOW please");
            let (_answer_tx, answer_rx) = mpsc::unbounded_channel::<Answer>();
            let (stop_tx, stop_rx) = oneshot::channel();
            let stop_tx = Mutex::new(Some(stop_tx));
            let ch = Channel::new(move |body| {
                let tauri::ipc::InvokeResponseBody::Json(s) = body else { return Ok(()) };
                if s.contains("\"agent_message\"") && s.contains("\"delta\"") {
                    if let Some(tx) = stop_tx.lock().unwrap().take() {
                        let _ = tx.send(());
                    }
                }
                Ok(())
            });
            let started = std::time::Instant::now();
            let o = drive(root.path(), &bin, &opts("SLOW please"), &prep, &mut session, &ch, stop_rx, answer_rx).await.unwrap();
            assert!(matches!(o, Outcome::Stopped));
            assert!(started.elapsed() < Duration::from_secs(10), "stop took {:?}", started.elapsed());
        });
    }

    /// One real turn through the relay, for live checks with a capped
    /// temporary key: `CLOUDBORNE_TEST_CODEX`, `CLOUDBORNE_TEST_UPSTREAM`,
    /// `CLOUDBORNE_TEST_KEY`, `CLOUDBORNE_TEST_MODEL`. The prompt asks the
    /// agent to ask one question and to touch nothing; the test answers with
    /// the first option and prints what came back (never the key).
    #[test]
    #[ignore]
    fn live_turn_through_the_relay() {
        use std::sync::{Arc, Mutex};
        let env = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("{k}"));
        let bin = PathBuf::from(env("CLOUDBORNE_TEST_CODEX"));
        let prep = Prepared { api_key: env("CLOUDBORNE_TEST_KEY"), origin: env("CLOUDBORNE_TEST_UPSTREAM") };
        let root = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        // Built from JSON so the test does not depend on every field Session has.
        let mut session: store::Session = serde_json::from_value(json!({ "id": id, "title": "t", "updated_at": 0 })).unwrap();
        store::save(root.path(), &session).unwrap();
        let prompt = "我想把 Claude Code 接到 Cloudborne。不要读取或修改任何文件，也不要运行任何命令。\
                      请先用提问工具问我一个问题，确认我想用哪种方式接入（例如桌面客户端一键连接，或手动改配置），\
                      等我回答后，再用两三句话告诉我下一步怎么做。";
        let opts = SendOptions {
            session: id,
            prompt: prompt.into(),
            images: vec![],
            model: env("CLOUDBORNE_TEST_MODEL"),
            effort: "medium".into(),
            lang: "zh-CN".into(),
        };
        session.turns.push(store::Turn { prompt: prompt.into(), images: vec![], items: vec![], status: "running".into(), failure: None });
        let events: Arc<Mutex<Vec<Value>>> = Arc::default();
        let (answer_tx, answer_rx) = mpsc::unbounded_channel::<Answer>();
        let seen = events.clone();
        let ch = Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Json(s) = body else { return Ok(()) };
            let v: Value = serde_json::from_str(&s).unwrap();
            if v.pointer("/item/type") == Some(&json!("question")) && v.pointer("/item/status") == Some(&json!("pending")) {
                let request = v.pointer("/item/request").and_then(Value::as_str).unwrap().to_string();
                let answers = v.pointer("/item/questions").and_then(Value::as_array).unwrap().iter().map(|q| {
                    let pick = q.pointer("/options/0/label").and_then(Value::as_str).unwrap_or("桌面客户端一键连接");
                    (q["id"].as_str().unwrap().to_string(), vec![pick.to_string()])
                });
                answer_tx.send((request, answers.collect())).unwrap();
            }
            seen.lock().unwrap().push(v);
            Ok(())
        });
        let (_stop, stop_rx) = oneshot::channel();
        let started = std::time::Instant::now();
        let outcome = tauri::async_runtime::block_on(drive(root.path(), &bin, &opts, &prep, &mut session, &ch, stop_rx, answer_rx)).unwrap();
        let ev = events.lock().unwrap().clone();
        let deltas = |t: &str| ev.iter().filter(|e| e["type"] == "delta" && e["item_type"] == t).count();
        let items = &session.turns[0].items;
        let summary = json!({
            "outcome": match &outcome { Outcome::Done => "done".to_string(), Outcome::Stopped => "stopped".into(), Outcome::Failed(k, m) => format!("failed {k}: {}", m.chars().take(300).collect::<String>()) },
            "seconds": started.elapsed().as_secs(),
            "items": items.iter().map(|x| x["type"].clone()).collect::<Vec<_>>(),
            "reasoning": items.iter().filter(|x| x["type"] == "reasoning").map(|x| json!({ "chars": x["text"].as_str().map(|s| s.chars().count()), "status": x["status"], "duration_ms": x["duration_ms"], "head": x["text"].as_str().map(|s| s.chars().take(120).collect::<String>()) })).collect::<Vec<_>>(),
            "questions": items.iter().filter(|x| x["type"] == "question").map(|x| json!({ "status": x["status"], "questions": x["questions"], "answers": x["answers"] })).collect::<Vec<_>>(),
            "commands": items.iter().filter(|x| x["type"] == "command_execution").map(|x| x["command"].clone()).collect::<Vec<_>>(),
            "reply": items.iter().filter(|x| x["type"] == "agent_message").map(|x| x["text"].clone()).collect::<Vec<_>>(),
            "deltas": { "reasoning": deltas("reasoning"), "agent_message": deltas("agent_message") },
        });
        println!("LIVE_RESULT {}", serde_json::to_string(&summary).unwrap());
    }

    #[test]
    fn requests_have_the_shapes_app_server_expects() {
        let (m, p) = thread_request(None, "gpt-x", Path::new("/home/u"), "be nice");
        assert_eq!(m, "thread/start");
        assert_eq!(p, json!({"model": "gpt-x", "cwd": "/home/u", "approvalPolicy": "never", "sandbox": "danger-full-access", "developerInstructions": "be nice"}));
        let (m, p) = thread_request(Some("th"), "gpt-x", Path::new("/home/u"), "be nice");
        assert_eq!(m, "thread/resume");
        assert_eq!(p["threadId"], "th");

        let t = turn_params("th", "hello", &[PathBuf::from("/tmp/0.png")], "gpt-x", "high");
        assert_eq!(t["summary"], "auto");
        assert_eq!(t["effort"], "high");
        assert_eq!(t["input"], json!([{"type": "text", "text": "hello", "text_elements": []}, {"type": "localImage", "path": "/tmp/0.png"}]));
        assert_eq!(initialize_params()["capabilities"]["experimentalApi"], true);
    }
}
