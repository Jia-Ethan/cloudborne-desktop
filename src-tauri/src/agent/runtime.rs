//! Our own copy of the Codex CLI, so tasks work whether or not the user has
//! Codex installed and never depend on their version of it. The platform
//! package comes from npm (the China mirror first), pinned to one version and
//! checked against its published sha512 before anything is unpacked.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;
use futures_util::StreamExt;
use sha2::{Digest, Sha512};

use crate::error::{Error, Result};
use crate::lang::tr;

pub const VERSION: &str = "0.162.1";

const REGISTRIES: [&str; 2] = ["https://registry.npmmirror.com", "https://registry.npmjs.org"];

struct Platform {
    /// npm dist-tag suffix, e.g. `darwin-arm64`.
    npm: &'static str,
    /// Rust target triple the package keeps its files under.
    triple: &'static str,
    /// sha512 from the registry's `dist.integrity`, base64.
    integrity: &'static str,
}

fn platform() -> Option<Platform> {
    let p = |npm, triple, integrity| Some(Platform { npm, triple, integrity });
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => p(
            "darwin-arm64",
            "aarch64-apple-darwin",
            "YVXpg57itBuQxjofay3KDF5UbnZF4Y1ZmNFzUCz0ZQiQN+DndxOjN5V87rnXvPaC4qCPO2El74DzewoBP8JyPQ==",
        ),
        ("macos", "x86_64") => p(
            "darwin-x64",
            "x86_64-apple-darwin",
            "0/WHRhbUnM1wAjfyCO54Q8s4vQRxLVBbqW6XuQf7rZTEMTYPKRIQU9aPeRgjG653ZCSjtBrslWQ+G9urY9CksQ==",
        ),
        ("windows", "x86_64") => p(
            "win32-x64",
            "x86_64-pc-windows-msvc",
            "dfl4MhHuEi0ARKyNmrTxk+RQmsWNCQAoVLUtrYq+yrW1C8P2sg5ziwgHUUACHjYLKuACV7ARH5Nq5pnCz3GlaQ==",
        ),
        ("windows", "aarch64") => p(
            "win32-arm64",
            "aarch64-pc-windows-msvc",
            "teVVACnEcupkR6XSmUQKwlGg/oA15d1DQDPVSoAfilHgctPEpTi5y11jYS6JhJO+AFnYM84gyo5SOS5vlnCQSg==",
        ),
        _ => None,
    }
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn dir(root: &Path) -> PathBuf {
    root.join("codex").join(VERSION)
}

/// The vendor directory inside the unpacked package: `bin/`, `codex-path/`, ….
pub fn vendor(root: &Path) -> Option<PathBuf> {
    let p = platform()?;
    Some(dir(root).join("package").join("vendor").join(p.triple))
}

/// The Codex binary, if this version is already unpacked.
pub fn installed(root: &Path) -> Option<PathBuf> {
    let bin = vendor(root)?.join("bin").join(exe("codex"));
    // The marker is written last, so a half-finished unpack doesn't count.
    dir(root).join(".complete").is_file().then_some(bin).filter(|b| b.is_file())
}

/// Downloads and unpacks the pinned Codex unless it is already there.
/// `progress` gets whole percentages while downloading.
pub async fn ensure(root: &Path, mut progress: impl FnMut(u8)) -> Result<PathBuf> {
    if let Some(bin) = installed(root) {
        return Ok(bin);
    }
    let p = platform().ok_or_else(|| Error::Other(tr("这台电脑的系统暂不支持", "This system is not supported yet").into()))?;
    let http = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| Error::Network(e.to_string()))?;

    let codex_dir = root.join("codex");
    fs::create_dir_all(&codex_dir).map_err(|e| Error::io(&codex_dir, e))?;
    let tgz = codex_dir.join(format!(".download-{}.tgz", uuid::Uuid::new_v4()));
    let mut last = None;
    for reg in REGISTRIES {
        let url = format!("{reg}/@openai/codex/-/codex-{VERSION}-{}.tgz", p.npm);
        match download(&http, &url, &tgz, p.integrity, &mut progress).await {
            Ok(()) => {
                let (src, target) = (tgz.clone(), dir(root));
                let r = tokio::task::spawn_blocking(move || unpack(&src, &target))
                    .await
                    .map_err(|e| Error::Other(e.to_string()));
                let _ = fs::remove_file(&tgz);
                r??;
                prune_old(root);
                return installed(root).ok_or_else(|| Error::Other(tr("运行环境不完整", "The runtime is incomplete").into()));
            }
            Err(e) => last = Some(e),
        }
    }
    let _ = fs::remove_file(&tgz);
    Err(last.unwrap_or_else(|| Error::Other(String::new())))
}

/// Streams `url` into `dest`, hashing as it goes.
async fn download(http: &reqwest::Client, url: &str, dest: &Path, integrity: &str, progress: &mut impl FnMut(u8)) -> Result<()> {
    let resp = http.get(url).send().await.map_err(|e| Error::Network(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(Error::Network(format!("HTTP {}", resp.status())));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = fs::File::create(dest).map_err(|e| Error::io(dest, e))?;
    let mut written = 0u64;
    let mut hasher = Sha512::new();
    let mut stream = resp.bytes_stream();
    let mut shown = 0u8;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| Error::Network(e.to_string()))?;
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| Error::io(dest, e))?;
        written += chunk.len() as u64;
        if let Some(pct) = (written * 100).checked_div(total) {
            let pct = pct.min(100) as u8;
            if pct != shown {
                shown = pct;
                progress(pct);
            }
        }
    }
    let got = base64::engine::general_purpose::STANDARD.encode(hasher.finalize());
    if got != integrity {
        return Err(Error::Other(tr("下载的文件校验失败", "The download failed its integrity check").into()));
    }
    Ok(())
}

/// Unpacks into a temp dir beside the target, then renames it into place.
fn unpack(tgz: &Path, target: &Path) -> Result<()> {
    let parent = target.parent().ok_or_else(|| Error::Other("bad runtime dir".into()))?;
    fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    let tmp = parent.join(format!(".{VERSION}-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let file = fs::File::open(tgz).map_err(|e| Error::io(tgz, e))?;
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(std::io::BufReader::new(file)));
        archive.set_preserve_permissions(true);
        // `unpack` refuses entries that would land outside `tmp`.
        archive.unpack(&tmp).map_err(|e| Error::io(&tmp, e))?;
        fs::write(tmp.join(".complete"), VERSION).map_err(|e| Error::io(&tmp, e))?;
        if target.exists() {
            fs::remove_dir_all(target).map_err(|e| Error::io(target, e))?;
        }
        fs::rename(&tmp, target).map_err(|e| Error::io(target, e))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&tmp);
    }
    result
}

/// Older versions are a few hundred MB each; keep only the current one.
fn prune_old(root: &Path) {
    let Ok(rd) = fs::read_dir(root.join("codex")) else { return };
    for e in rd.flatten() {
        if e.file_name() != VERSION && e.path().is_dir() {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_platform_is_pinned() {
        if cfg!(any(target_os = "macos", windows)) {
            let p = platform().expect("platform");
            assert_eq!(base64::engine::general_purpose::STANDARD.decode(p.integrity).unwrap().len(), 64);
        }
    }

    /// Downloads the real package (~140 MB): `cargo test -- --ignored downloads`.
    #[tokio::test]
    #[ignore]
    async fn downloads_verifies_and_runs() {
        let root = tempfile::tempdir().unwrap();
        let mut seen = 0;
        let bin = ensure(root.path(), |p| seen = p).await.unwrap();
        assert_eq!(seen, 100);
        let out = std::process::Command::new(bin).arg("--version").output().unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).contains(VERSION));
    }

    #[test]
    fn half_unpacked_runtime_is_not_installed() {
        let root = tempfile::tempdir().unwrap();
        let Some(v) = vendor(root.path()) else { return };
        fs::create_dir_all(v.join("bin")).unwrap();
        fs::write(v.join("bin").join(exe("codex")), "").unwrap();
        assert!(installed(root.path()).is_none());
        fs::write(dir(root.path()).join(".complete"), VERSION).unwrap();
        assert!(installed(root.path()).is_some());
    }
}
