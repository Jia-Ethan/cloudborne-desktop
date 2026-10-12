//! One-click installs. Script installers run in a visible terminal window so
//! the user can watch every step; nothing runs silently in the background.
//! ZCode ships as an installer package that we download and open.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{Error, Result};
use crate::tools::ToolId;

// Kept in one place so a moved installer only needs a one-line change.
const CLAUDE_SH: &str = "curl -fsSL https://claude.ai/install.sh | bash";
const CLAUDE_PS: &str = "irm https://claude.ai/install.ps1 | iex";
const GROK_SH: &str = "curl -fsSL https://x.ai/cli/install.sh | bash";
const GROK_PS: &str = "irm https://x.ai/cli/install.ps1 | iex";
const CODEX_NPM: &str = "npm install -g @openai/codex --registry=https://registry.npmmirror.com";
const NODE_DOWNLOAD: &str = "https://nodejs.org/zh-cn/download";
const ZCODE_PAGE: &str = "https://zcode.z.ai/cn";
const ZCODE_CDN: &str = "https://cdn-zcode.z.ai/zcode/electron/releases";
// Used when the version cannot be read from the download page.
const ZCODE_FALLBACK_VERSION: &str = "3.14.5";

#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InstallStarted {
    /// A terminal window is running the installer.
    Terminal,
    /// The installer package was downloaded and opened.
    Package { path: String },
    /// A prerequisite is missing; the user was sent to its download page.
    NeedsNode,
}

fn script_for(tool: ToolId) -> Option<&'static str> {
    match (tool, cfg!(windows)) {
        (ToolId::Claude, false) => Some(CLAUDE_SH),
        (ToolId::Claude, true) => Some(CLAUDE_PS),
        (ToolId::Grok, false) => Some(GROK_SH),
        (ToolId::Grok, true) => Some(GROK_PS),
        (ToolId::Codex, _) => Some(CODEX_NPM),
        (ToolId::Zcode, _) => None,
    }
}

pub async fn install(tool: ToolId, home: &Path) -> Result<InstallStarted> {
    if tool == ToolId::Zcode {
        let path = download_zcode().await?;
        open_path(&path)?;
        return Ok(InstallStarted::Package { path: path.display().to_string() });
    }
    if tool == ToolId::Codex && crate::tools::detect::find_binary(home, "npm").is_none() {
        open_url(NODE_DOWNLOAD)?;
        return Ok(InstallStarted::NeedsNode);
    }
    let script = script_for(tool).expect("non-zcode tools have scripts");
    run_in_terminal(tool, script)?;
    Ok(InstallStarted::Terminal)
}

#[cfg(target_os = "macos")]
fn run_in_terminal(tool: ToolId, script: &str) -> Result<()> {
    // Terminal starts a login shell, so the user's PATH (npm, nvm) applies.
    let banner = format!("echo '正在安装 {}…'; ", tool.display_name());
    let done = "; echo; echo '安装结束，可以关闭这个窗口，回到 Cloudborne 点「重新检测」。'";
    let cmd = format!("{banner}{script}{done}");
    let osa = format!(
        "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
        cmd.replace('\\', "\\\\").replace('"', "\\\"")
    );
    Command::new("osascript")
        .arg("-e")
        .arg(osa)
        .spawn()
        .map_err(|e| Error::Other(format!("无法打开终端：{e}")))?;
    Ok(())
}

#[cfg(windows)]
fn run_in_terminal(tool: ToolId, script: &str) -> Result<()> {
    let cmd = format!(
        "Write-Host '正在安装 {}…'; {script}; Write-Host ''; Write-Host '安装结束，可以关闭这个窗口，回到 Cloudborne 点「重新检测」。'",
        tool.display_name()
    );
    // `start` opens a new console window that stays open after the script.
    Command::new("cmd")
        .args(["/C", "start", "", "powershell", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", &cmd])
        .spawn()
        .map_err(|e| Error::Other(format!("无法打开 PowerShell：{e}")))?;
    Ok(())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn run_in_terminal(_tool: ToolId, _script: &str) -> Result<()> {
    Err(Error::Other("当前系统不支持一键安装".into()))
}

fn zcode_platform() -> Result<(&'static str, &'static str, &'static str)> {
    // (CDN dir, file suffix, extension)
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok(("macos-arm64", "mac-arm64", "dmg")),
        ("macos", _) => Ok(("macos-x64", "mac-x64", "dmg")),
        ("windows", "aarch64") => Ok(("windows-arm64", "win-arm64", "exe")),
        ("windows", _) => Ok(("windows-x64", "win-x64", "exe")),
        _ => Err(Error::Other("ZCode 没有这个系统的安装包".into())),
    }
}

pub fn zcode_url(version: &str) -> Result<String> {
    let (dir, suffix, ext) = zcode_platform()?;
    Ok(format!("{ZCODE_CDN}/{version}/{dir}/ZCode-{version}-{suffix}.{ext}"))
}

/// Highest version referenced by the download page, if it can be read.
pub fn parse_zcode_version(html: &str) -> Option<String> {
    let marker = "/zcode/electron/releases/";
    let mut best: Option<(Vec<u32>, String)> = None;
    for (i, _) in html.match_indices(marker) {
        let rest = &html[i + marker.len()..];
        let v: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        let parts: Vec<u32> = v.split('.').filter_map(|p| p.parse().ok()).collect();
        if parts.len() >= 3 && best.as_ref().map_or(true, |(b, _)| parts > *b) {
            best = Some((parts, v));
        }
    }
    best.map(|(_, v)| v)
}

async fn download_zcode() -> Result<PathBuf> {
    let http = reqwest::Client::new();
    let version = match http.get(ZCODE_PAGE).send().await {
        Ok(r) => r.text().await.ok().and_then(|h| parse_zcode_version(&h)),
        Err(_) => None,
    }
    .unwrap_or_else(|| ZCODE_FALLBACK_VERSION.to_string());
    let url = zcode_url(&version)?;
    let name = url.rsplit('/').next().unwrap_or("ZCode-installer").to_string();
    let dest = dirs::download_dir().unwrap_or_else(std::env::temp_dir).join(&name);
    if !dest.exists() {
        let resp = http
            .get(&url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| Error::Network(format!("下载 ZCode 失败：{e}")))?;
        let bytes = resp.bytes().await.map_err(|e| Error::Network(e.to_string()))?;
        let part = dest.with_extension("part");
        tokio::fs::write(&part, &bytes).await.map_err(|e| Error::io(&part, e))?;
        tokio::fs::rename(&part, &dest).await.map_err(|e| Error::io(&dest, e))?;
    }
    Ok(dest)
}

fn open_path(p: &Path) -> Result<()> {
    tauri_plugin_opener::open_path(p, None::<&str>).map_err(|e| Error::Other(e.to_string()))
}

fn open_url(u: &str) -> Result<()> {
    tauri_plugin_opener::open_url(u, None::<&str>).map_err(|e| Error::Other(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_highest_zcode_version() {
        let html = r#"href="https://cdn-zcode.z.ai/zcode/electron/releases/3.10.1/macos-arm64/x.dmg"
            href="https://cdn-zcode.z.ai/zcode/electron/releases/3.14.5/windows-x64/y.exe"
            href="https://cdn-zcode.z.ai/zcode/electron/releases/3.9.0/linux-x64/z""#;
        assert_eq!(parse_zcode_version(html).as_deref(), Some("3.14.5"));
        assert_eq!(parse_zcode_version("nothing here"), None);
    }

    #[test]
    fn zcode_url_matches_cdn_layout() {
        let u = zcode_url("3.14.5").unwrap();
        assert!(u.starts_with("https://cdn-zcode.z.ai/zcode/electron/releases/3.14.5/"));
        assert!(u.ends_with(".dmg") || u.ends_with(".exe"));
    }
}
