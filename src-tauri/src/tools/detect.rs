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
        home.join("Library")
            .join("Application Support")
            .join("fnm")
            .join("node-versions"),
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
            .map(|l| {
                vec![PathBuf::from(l)
                    .join("Programs")
                    .join("ZCode")
                    .join("ZCode.exe")]
            })
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
    candidates
        .into_iter()
        .find(|p| p.exists())
        // The Windows installer allows a user-selected directory.  Do not
        // assume it is on C: or under %LOCALAPPDATA%; the uninstaller entry
        // records the actual path (including paths on another drive).
        .or_else(|| zcode_registry_app())
}

#[cfg(windows)]
fn zcode_registry_app() -> Option<PathBuf> {
    use winreg::enums::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
    };
    use winreg::RegKey;

    const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    const APP_PATHS: &str = r"Software\Microsoft\Windows\CurrentVersion\App Paths";

    // Electron-builder's NSIS package writes an uninstall entry.  Check both
    // registry views because 32-bit and 64-bit installers use different
    // views, and check both per-user and machine-wide installs.
    let roots = [
        RegKey::predef(HKEY_CURRENT_USER),
        RegKey::predef(HKEY_LOCAL_MACHINE),
    ];
    let views = [KEY_WOW64_64KEY, KEY_WOW64_32KEY];

    for root in &roots {
        for view in views {
            if let Ok(uninstall) = root.open_subkey_with_flags(UNINSTALL, KEY_READ | view) {
                for name in uninstall.enum_keys().flatten() {
                    let Ok(entry) = uninstall.open_subkey_with_flags(&name, KEY_READ | view) else {
                        continue;
                    };
                    let display_name = entry
                        .get_value::<String, _>("DisplayName")
                        .unwrap_or_default();
                    if !display_name.to_ascii_lowercase().contains("zcode") {
                        continue;
                    }
                    for value_name in [
                        "InstallLocation",
                        "DisplayIcon",
                        "ExecutablePath",
                        "UninstallString",
                    ] {
                        if let Ok(raw) = entry.get_value::<String, _>(value_name) {
                            if let Some(path) = existing_zcode_executable(&raw) {
                                return Some(path);
                            }
                        }
                    }
                }
            }

            // Some installers also register an App Paths entry.  It directly
            // contains the executable and is useful when the uninstall entry
            // is absent or stale.
            if let Ok(app_paths) = root.open_subkey_with_flags(APP_PATHS, KEY_READ | view) {
                for name in ["ZCode.exe", "zcode.exe"] {
                    if let Ok(entry) = app_paths.open_subkey_with_flags(name, KEY_READ | view) {
                        if let Ok(raw) = entry.get_value::<String, _>("") {
                            if let Some(path) = existing_zcode_executable(&raw) {
                                return Some(path);
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn zcode_registry_app() -> Option<PathBuf> {
    None
}

/// Turn an installer registry value into an existing ZCode executable. Values
/// may be an install directory, a quoted executable, or an executable followed
/// by an icon index/arguments (for example `"D:\\zcode\\ZCode.exe",0`).
fn existing_zcode_executable(raw: &str) -> Option<PathBuf> {
    let value = raw.trim();
    let path_text = if let Some(quoted) = value.strip_prefix('"') {
        quoted.split('"').next().unwrap_or(quoted)
    } else {
        value.split(',').next().unwrap_or(value).trim()
    };
    if path_text.is_empty() {
        return None;
    }
    let path = PathBuf::from(path_text);
    if path.is_file() {
        let is_zcode = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| name.eq_ignore_ascii_case("ZCode.exe"))
            .is_some();
        return is_zcode.then_some(path);
    }
    let executable = if path.extension().is_some() {
        path.parent().unwrap_or(&path).join("ZCode.exe")
    } else {
        path.join("ZCode.exe")
    };
    executable.is_file().then_some(executable)
}

/// Where the tool is installed, if anywhere.
pub fn locate(tool: ToolId, home: &Path) -> Option<PathBuf> {
    match tool {
        ToolId::Codex => find_binary(home, "codex").or_else(codex_desktop),
        ToolId::Claude => find_binary(home, "claude"),
        ToolId::Grok => find_binary(home, "grok"),
        ToolId::Pi => find_binary(home, "pi"),
        ToolId::Dsh => find_binary(home, "dsh"),
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
        assert_eq!(
            find_binary(h.path(), "cb-fake-tool"),
            Some(bin.join(exe("cb-fake-tool")))
        );
    }

    #[test]
    fn missing_binary_is_none() {
        let h = tempfile::tempdir().unwrap();
        assert_eq!(find_binary(h.path(), "cb-definitely-not-installed"), None);
    }

    #[test]
    fn registry_value_parser_accepts_install_directory_and_quoted_icon() {
        let h = tempfile::tempdir().unwrap();
        let dir = h.path().join("zcode");
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("ZCode.exe");
        std::fs::write(&exe, "").unwrap();
        assert_eq!(
            existing_zcode_executable(dir.to_str().unwrap()),
            Some(exe.clone())
        );
        assert_eq!(
            existing_zcode_executable(&format!(r#""{}",0"#, exe.display())),
            Some(exe)
        );
        assert_eq!(
            existing_zcode_executable(r#""C:\missing\ZCode.exe",0"#),
            None
        );
    }
}
