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
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
}

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
/// session is deleted must not bring the file back).
pub fn save_if_present(root: &Path, s: &Session) -> Result<()> {
    if path(root, &s.id)?.is_file() {
        save(root, s)?;
    }
    Ok(())
}

pub fn delete(root: &Path, id: &str) -> Result<()> {
    let p = path(root, id)?;
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(Error::io(&p, e)),
    }
}

/// Newest first. Unreadable files are skipped rather than failing the list.
pub fn list(root: &Path) -> Vec<Summary> {
    let Ok(rd) = fs::read_dir(dir(root)) else { return vec![] };
    let mut out: Vec<Summary> = rd
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_str::<Session>(&fs::read_to_string(e.path()).ok()?).ok())
        .map(|s| Summary { id: s.id, title: s.title, updated_at: s.updated_at })
        .collect();
    out.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    out
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
        Session { id: id.into(), title: "t".into(), updated_at: at, thread_id: None, turns: vec![] }
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
