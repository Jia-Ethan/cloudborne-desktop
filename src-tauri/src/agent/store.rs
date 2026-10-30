//! Task history: one JSON file per session under the app's data directory.
//! The UI's view of a session (prompts, items, outcome) lives here; Codex keeps
//! its own transcript in its home so a follow-up can resume the thread.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, Result};
use crate::fsx;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Failure {
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Turn {
    pub prompt: String,
    /// Data URLs of the attached screenshots.
    #[serde(default)]
    pub images: Vec<String>,
    /// Codex items as `codex exec --json` reported them, latest version of each.
    #[serde(default)]
    pub items: Vec<Value>,
    /// running | done | stopped | failed
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<Failure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    /// Codex's thread id, once the first turn has started one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub turns: Vec<Turn>,
    /// Sidebar marks: pinned tasks sit on top, archived ones are folded away.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub archived: bool,
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub pinned: bool,
    pub archived: bool,
}

impl Summary {
    fn of(s: &Session) -> Self {
        Summary { id: s.id.clone(), title: s.title.clone(), updated_at: s.updated_at, pinned: s.pinned, archived: s.archived }
    }
}

/// A change from the sidebar; `None` leaves that field alone.
#[derive(Debug, Default, Deserialize)]
pub struct Patch {
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
}

const TITLE_MAX: usize = 80;

fn dir(root: &Path) -> PathBuf {
    root.join("sessions")
}

/// Session ids come from the UI; only accept the UUIDs it generates.
fn path(root: &Path, id: &str) -> Result<PathBuf> {
    uuid::Uuid::parse_str(id).map_err(|_| Error::Other(format!("bad session id: {id}")))?;
    Ok(dir(root).join(format!("{id}.json")))
}

pub fn load(root: &Path, id: &str) -> Result<Option<Session>> {
    let p = path(root, id)?;
    let text = fsx::read_or_empty(&p)?;
    if text.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str(&text).map(Some).map_err(|e| Error::Config(format!("{}: {e}", p.display())))
}

pub fn save(root: &Path, s: &Session) -> Result<()> {
    let text = serde_json::to_string(s).map_err(|e| Error::Other(e.to_string()))?;
    fsx::write_atomic(&path(root, &s.id)?, &text)
}

/// Saves unless the session was deleted meanwhile (a running task whose
/// session is deleted must not bring the file back). The title, pin and
/// archive marks belong to the sidebar, so a rename during a run outlives
/// the run's own saves.
pub fn save_if_present(root: &Path, s: &Session) -> Result<()> {
    if !path(root, &s.id)?.is_file() {
        return Ok(());
    }
    match load(root, &s.id) {
        Ok(Some(disk)) => {
            let mut s = s.clone();
            s.title = disk.title;
            s.pinned = disk.pinned;
            s.archived = disk.archived;
            save(root, &s)
        }
        _ => save(root, s),
    }
}

/// Applies a sidebar change. `updated_at` stays, so a rename or pin does not
/// move the task in the list.
pub fn update(root: &Path, id: &str, patch: Patch) -> Result<Summary> {
    let mut s = load(root, id)?.ok_or_else(|| Error::Other(format!("no such task: {id}")))?;
    if let Some(t) = patch.title {
        let t = t.trim();
        if !t.is_empty() {
            s.title = t.chars().take(TITLE_MAX).collect();
        }
    }
    if let Some(p) = patch.pinned {
        s.pinned = p;
    }
    if let Some(a) = patch.archived {
        s.archived = a;
    }
    save(root, &s)?;
    Ok(Summary::of(&s))
}

pub fn delete(root: &Path, id: &str) -> Result<()> {
    let p = path(root, id)?;
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(Error::io(&p, e)),
    }
}

/// Every readable session; unreadable files are skipped rather than failing.
fn read_all(root: &Path) -> Vec<Session> {
    let Ok(rd) = fs::read_dir(dir(root)) else { return vec![] };
    rd.flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_str::<Session>(&fs::read_to_string(e.path()).ok()?).ok())
        .collect()
}

/// Newest first.
pub fn list(root: &Path) -> Vec<Summary> {
    let mut out: Vec<Summary> = read_all(root).iter().map(Summary::of).collect();
    out.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    out
}

#[derive(Debug, Serialize)]
pub struct Hit {
    #[serde(flatten)]
    pub task: Summary,
    /// The words around the first match in the conversation, when the title does not match.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

/// Tasks whose title, prompts or replies contain `query` (ignoring case):
/// title matches first, then newest first. Archived tasks are included.
pub fn search(root: &Path, query: &str, limit: usize) -> Vec<Hit> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return vec![];
    }
    let mut hits: Vec<(bool, Hit)> = read_all(root)
        .into_iter()
        .filter_map(|s| {
            if s.title.to_lowercase().contains(&q) {
                return Some((true, Hit { task: Summary::of(&s), snippet: None }));
            }
            let snippet = s.turns.iter().find_map(|t| {
                snippet(&t.prompt, &q).or_else(|| {
                    t.items
                        .iter()
                        .filter(|i| i.get("type").and_then(Value::as_str) == Some("agent_message"))
                        .find_map(|i| snippet(i.get("text").and_then(Value::as_str)?, &q))
                })
            })?;
            Some((false, Hit { task: Summary::of(&s), snippet: Some(snippet) }))
        })
        .collect();
    hits.sort_by_key(|(title, h)| (std::cmp::Reverse(*title), std::cmp::Reverse(h.task.updated_at)));
    hits.into_iter().take(limit).map(|(_, h)| h).collect()
}

/// One line of `text` around the first match of the lowercase `q`.
fn snippet(text: &str, q: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let at = lower.find(q)?;
    let chars: Vec<char> = text.chars().collect();
    // Lowercasing can change the length of a few characters; then start from the top.
    let start = if lower.chars().count() == chars.len() { lower[..at].chars().count() } else { 0 };
    let from = start.saturating_sub(20);
    let to = (start + q.chars().count() + 60).min(chars.len());
    let mut out = chars[from..to].iter().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    if from > 0 {
        out.insert(0, '…');
    }
    if to < chars.len() {
        out.push('…');
    }
    Some(out)
}

/// A turn left `running` means the app quit mid-task.
pub fn settle_interrupted(s: &mut Session) {
    for t in &mut s.turns {
        if t.status == "running" {
            t.status = "stopped".into();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str, at: i64) -> Session {
        Session { id: id.into(), title: "t".into(), updated_at: at, thread_id: None, turns: vec![], pinned: false, archived: false }
    }

    #[test]
    fn sidebar_marks_survive_a_running_turns_saves() {
        let root = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let running = session(&id, 5);
        save(root.path(), &running).unwrap();
        let sum = update(root.path(), &id, Patch { title: Some("  Fix Codex  ".into()), pinned: Some(true), archived: None }).unwrap();
        assert_eq!((sum.title.as_str(), sum.pinned, sum.archived, sum.updated_at), ("Fix Codex", true, false, 5));
        // The turn still holds its stale copy and saves it when it ends.
        save_if_present(root.path(), &running).unwrap();
        let back = load(root.path(), &id).unwrap().unwrap();
        assert_eq!((back.title.as_str(), back.pinned), ("Fix Codex", true));
        update(root.path(), &id, Patch { archived: Some(true), title: Some("   ".into()), ..Default::default() }).unwrap();
        let listed = &list(root.path())[0];
        assert_eq!((listed.title.as_str(), listed.archived), ("Fix Codex", true));
    }

    #[test]
    fn searches_titles_then_conversations() {
        let root = tempfile::tempdir().unwrap();
        let mut a = session(&uuid::Uuid::new_v4().to_string(), 1);
        a.title = "Fix Codex config".into();
        let mut b = session(&uuid::Uuid::new_v4().to_string(), 2);
        b.title = "Claude Code".into();
        b.turns.push(Turn {
            prompt: "it fails".into(),
            images: vec![],
            items: vec![serde_json::json!({"type": "agent_message", "text": format!("{} The CODEX provider block was missing.", "x ".repeat(40))})],
            status: "done".into(),
            failure: None,
        });
        let c = session(&uuid::Uuid::new_v4().to_string(), 3);
        for s in [&a, &b, &c] {
            save(root.path(), s).unwrap();
        }
        let hits = search(root.path(), "  codex ", 10);
        assert_eq!(hits.iter().map(|h| h.task.id.as_str()).collect::<Vec<_>>(), vec![a.id.as_str(), b.id.as_str()]);
        assert!(hits[0].snippet.is_none());
        let snip = hits[1].snippet.as_deref().unwrap();
        assert!(snip.starts_with('…') && snip.contains("CODEX provider"), "{snip}");
        assert!(search(root.path(), "   ", 10).is_empty());
    }

    #[test]
    fn old_files_without_marks_still_load() {
        let root = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::create_dir_all(dir(root.path())).unwrap();
        std::fs::write(path(root.path(), &id).unwrap(), format!(r#"{{"id":"{id}","title":"t","updated_at":1,"turns":[]}}"#)).unwrap();
        let s = &list(root.path())[0];
        assert!(!s.pinned && !s.archived);
    }

    #[test]
    fn saves_lists_newest_first_and_deletes() {
        let root = tempfile::tempdir().unwrap();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        save(root.path(), &session(&a, 1)).unwrap();
        save(root.path(), &session(&b, 2)).unwrap();
        let ids: Vec<_> = list(root.path()).into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![b.clone(), a.clone()]);
        delete(root.path(), &b).unwrap();
        assert_eq!(list(root.path()).len(), 1);
        assert!(load(root.path(), &b).unwrap().is_none());
    }

    #[test]
    fn rejects_ids_that_are_not_uuids() {
        let root = tempfile::tempdir().unwrap();
        assert!(load(root.path(), "../../etc/passwd").is_err());
    }
}
