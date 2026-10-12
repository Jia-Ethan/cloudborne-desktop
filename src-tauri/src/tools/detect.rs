//! Finds installed tools. Apps launched from Finder or the Start menu do not
//! inherit the user's shell PATH, so besides PATH we look in the places the
//! usual installers and Node version managers put binaries.

use std::path::{Path, PathBuf};

use super::ToolId;

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Directories that commonly hold CLI binaries but are often missing from a
/// GUI app's PATH.
pub fn extra_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![
        home.join(".local").join("bin"),
        home.join(".grok").join("bin"),
        home.join(".pi").join("agent").join("bin"),
        home.join(".claude").join("local"),
        home.join(".volta").join("bin"),
        home.join(".asdf").join("shims"),
        home.join(".bun").join("bin"),
        home.join(".npm-global").join("bin"),
    ];
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(&local).join("Programs").join("nodejs"));
        }
    } else {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    // nvm / fnm keep one bin dir per installed Node version.
    for root in [
        home.join(".nvm").join("versions").join("node"),
        home.join(".fnm").join("node-versions"),
        home.join("Library").join("Application Support").join("fnm").join("node-versions"),
    ] {
        if let Ok(rd) = std::fs::read_dir(&root) {
            for v in rd.flatten() {
                dirs.push(v.path().join("bin"));
                dirs.push(v.path().join("installation").join("bin"));
            }
        }
    }
    dirs
}

pub fn search_path(home: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in extra_bin_dirs(home) {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

pub fn find_binary(home: &Path, name: &str) -> Option<PathBuf> {
    let file = exe(name);
    let mut names = vec![file];
    if cfg!(windows) {
        // npm installs .cmd shims on Windows.
        names.push(format!("{name}.cmd"));
    }
    search_path(home)
        .into_iter()
        .flat_map(|d| names.iter().map(move |n| d.join(n)))
        .find(|p| p.is_file())
}

fn zcode_app(home: &Path) -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = if cfg!(target_os = "macos") {
        vec![
            PathBuf::from("/Applications/ZCode.app"),
            home.join("Applications").join("ZCode.app"),
        ]
    } else if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(|l| vec![PathBuf::from(l).join("Programs").join("ZCode").join("ZCode.exe")])
            .unwrap_or_default()
            .into_iter()
            .chain(
                std::env::var_os("ProgramFiles")
                    .map(|p| PathBuf::from(p).join("ZCode").join("ZCode.exe")),
            )
            .collect()
    } else {
        vec![]
    };
    candidates.into_iter().find(|p| p.exists())
}

/// Where the tool is installed, if anywhere.
pub fn locate(tool: ToolId, home: &Path) -> Option<PathBuf> {
    match tool {
        ToolId::Codex => find_binary(home, "codex").or_else(codex_desktop),
        ToolId::Claude => find_binary(home, "claude"),
        ToolId::Grok => find_binary(home, "grok"),
        ToolId::Pi => find_binary(home, "pi"),
        ToolId::Zcode => zcode_app(home),
    }
}

fn codex_desktop() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        ["/Applications/Codex.app", "/Applications/ChatGPT.app"]
            .into_iter()
            .map(PathBuf::from)
            .find(|p| p.exists())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_binary_in_version_manager_dir() {
        let h = tempfile::tempdir().unwrap();
        let bin = h.path().join(".nvm/versions/node/v22.1.0/bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(exe("cb-fake-tool")), "").unwrap();
        assert_eq!(find_binary(h.path(), "cb-fake-tool"), Some(bin.join(exe("cb-fake-tool"))));
    }

    #[test]
    fn missing_binary_is_none() {
        let h = tempfile::tempdir().unwrap();
        assert_eq!(find_binary(h.path(), "cb-definitely-not-installed"), None);
    }
}
