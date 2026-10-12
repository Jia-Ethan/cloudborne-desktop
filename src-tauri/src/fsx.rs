//! File helpers shared by every tool adapter: timestamped backups, atomic
//! writes, and the marked block we own inside other programs' text configs.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

pub const BLOCK_BEGIN: &str = "# >>> cloudborne-desktop (managed; edits inside are overwritten)";
pub const BLOCK_END: &str = "# <<< cloudborne-desktop";

/// Copies `path` next to itself as `<name>.cloudborne-backup-<UTC stamp>`.
/// Returns `None` when there is nothing to back up yet.
pub fn backup(path: &Path) -> Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ");
    let name = path
        .file_name()
        .ok_or_else(|| Error::Config(format!("not a file: {}", path.display())))?
        .to_string_lossy();
    let dest = path.with_file_name(format!("{name}.cloudborne-backup-{stamp}"));
    fs::copy(path, &dest).map_err(|e| Error::io(&dest, e))?;
    Ok(Some(dest))
}

/// Writes through a sibling temp file and renames it over `path`, so readers
/// never observe a half-written config. Keeps the original file's permissions.
pub fn write_atomic(path: &Path, contents: &str) -> Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| Error::Config(format!("no parent dir: {}", path.display())))?;
    fs::create_dir_all(dir).map_err(|e| Error::io(dir, e))?;
    let tmp = dir.join(format!(
        ".{}.cloudborne-tmp",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| Error::io(&tmp, e))?;
        f.write_all(contents.as_bytes()).map_err(|e| Error::io(&tmp, e))?;
        f.sync_all().map_err(|e| Error::io(&tmp, e))?;
    }
    if let Ok(meta) = fs::metadata(path) {
        let _ = fs::set_permissions(&tmp, meta.permissions());
    } else {
        restrict_new_file(&tmp);
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        Error::io(path, e)
    })
}

// Newly created configs hold an API key, so keep them owner-only.
#[cfg(unix)]
fn restrict_new_file(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_new_file(_path: &Path) {}

pub fn read_or_empty(path: &Path) -> Result<String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(Error::io(path, e)),
    }
}

/// Pretty-prints JSON the way the tools write it (two-space indent), keeping
/// the original file's trailing-newline choice so a round trip is byte-exact.
pub fn render_json_like(value: &serde_json::Value, original: &str) -> String {
    let mut s = serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into());
    if original.is_empty() || original.ends_with('\n') {
        s.push('\n');
    }
    s
}

/// Byte range of our marked block (including the trailing newline), if present.
fn block_range(text: &str) -> Result<Option<(usize, usize)>> {
    let Some(start) = text.find(BLOCK_BEGIN) else {
        if text.contains(BLOCK_END) {
            return Err(Error::Config("found an end marker without a begin marker".into()));
        }
        return Ok(None);
    };
    let after = start + BLOCK_BEGIN.len();
    let end_rel = text[after..]
        .find(BLOCK_END)
        .ok_or_else(|| Error::Config("found a begin marker without an end marker".into()))?;
    let mut end = after + end_rel + BLOCK_END.len();
    if text[end..].starts_with("\r\n") {
        end += 2;
    } else if text[end..].starts_with('\n') {
        end += 1;
    }
    Ok(Some((start, end)))
}

pub fn has_block(text: &str) -> Result<bool> {
    Ok(block_range(text)?.is_some())
}

/// Returns `text` with our block removed; everything else is byte-for-byte untouched.
pub fn strip_block(text: &str) -> Result<String> {
    Ok(match block_range(text)? {
        Some((s, e)) => {
            let mut out = String::with_capacity(text.len());
            out.push_str(&text[..s]);
            out.push_str(&text[e..]);
            out
        }
        None => text.to_string(),
    })
}

/// Inner text of our block (between the marker lines), if present.
pub fn block_body(text: &str) -> Result<Option<String>> {
    Ok(block_range(text)?.map(|(s, e)| {
        let inner = &text[s + BLOCK_BEGIN.len()..e];
        let inner = inner.trim_start_matches(['\r', '\n']);
        let cut = inner.rfind(BLOCK_END).unwrap_or(inner.len());
        inner[..cut].to_string()
    }))
}

/// Puts `body` inside our block at the end of `text`, replacing any previous block.
pub fn append_block(text: &str, body: &str) -> Result<String> {
    let mut out = strip_block(text)?;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(BLOCK_BEGIN);
    out.push('\n');
    out.push_str(body.trim_end_matches('\n'));
    out.push('\n');
    out.push_str(BLOCK_END);
    out.push('\n');
    Ok(out)
}

/// Writes `new` to `path` after backing up the old file, then calls `verify` on
/// what landed on disk; if verification fails the backup is restored.
pub fn replace_verified(
    path: &Path,
    new: &str,
    verify: impl Fn(&str) -> Result<()>,
) -> Result<Option<PathBuf>> {
    verify(new)?;
    let existed = path.exists();
    let bak = backup(path)?;
    write_atomic(path, new)?;
    let landed = read_or_empty(path)?;
    if let Err(e) = verify(&landed) {
        match &bak {
            Some(b) => {
                let _ = fs::copy(b, path);
            }
            None if !existed => {
                let _ = fs::remove_file(path);
            }
            None => {}
        }
        return Err(e);
    }
    Ok(bak)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_then_strip_round_trips() {
        let original = "a = 1\n\n[x]\nb = 2\n";
        let with = append_block(original, "c = 3").unwrap();
        assert!(with.starts_with(original));
        assert!(has_block(&with).unwrap());
        assert_eq!(block_body(&with).unwrap().unwrap(), "c = 3\n");
        assert_eq!(strip_block(&with).unwrap(), original);
    }

    #[test]
    fn append_replaces_previous_block() {
        let once = append_block("a = 1\n", "c = 3").unwrap();
        let twice = append_block(&once, "c = 4").unwrap();
        assert_eq!(twice.matches(BLOCK_BEGIN).count(), 1);
        assert!(twice.contains("c = 4") && !twice.contains("c = 3"));
    }

    #[test]
    fn handles_missing_trailing_newline_and_crlf() {
        let with = append_block("a = 1", "c = 3").unwrap();
        assert!(with.starts_with("a = 1\n# >>>"));
        let crlf = with.replace('\n', "\r\n");
        assert_eq!(strip_block(&crlf).unwrap(), "a = 1\r\n");
    }

    #[test]
    fn rejects_unbalanced_markers() {
        assert!(strip_block(&format!("{BLOCK_BEGIN}\nx\n")).is_err());
        assert!(strip_block(&format!("x\n{BLOCK_END}\n")).is_err());
    }

    #[test]
    fn replace_verified_restores_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c.toml");
        fs::write(&p, "old").unwrap();
        let calls = std::cell::Cell::new(0);
        let r = replace_verified(&p, "new", |_| {
            calls.set(calls.get() + 1);
            if calls.get() == 2 {
                Err(Error::Config("boom".into()))
            } else {
                Ok(())
            }
        });
        assert!(r.is_err());
        assert_eq!(fs::read_to_string(&p).unwrap(), "old");
    }

    #[test]
    fn replace_verified_removes_file_it_created_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub").join("c.toml");
        let calls = std::cell::Cell::new(0);
        let _ = replace_verified(&p, "new", |_| {
            calls.set(calls.get() + 1);
            if calls.get() == 2 {
                Err(Error::Config("boom".into()))
            } else {
                Ok(())
            }
        });
        assert!(!p.exists());
    }

    #[cfg(unix)]
    #[test]
    fn new_files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c.json");
        write_atomic(&p, "{}").unwrap();
        assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
    }
}
