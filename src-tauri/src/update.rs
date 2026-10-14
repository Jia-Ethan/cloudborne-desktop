//! In-app update install on macOS.
//!
//! The updater plugin installs by swapping the whole `Cloudborne.app` for the
//! new one. The Dock keeps pinned apps by file identity, not by path, so after
//! that swap it no longer recognises the running app as the pinned one and
//! shows it a second time until the Dock restarts. Here the bundle directory
//! stays put and only its `Contents` is exchanged, so the Dock entry, Finder
//! aliases and Login Items all keep pointing at the same `Cloudborne.app`.
//!
//! The plugin still finds, downloads and signature-checks the update; only the
//! last step is ours. Elsewhere (Windows) its own install is used unchanged.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::error::{Error, Result};

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdateEvent {
    Started { content_length: Option<u64> },
    Progress { chunk_length: usize },
    Finished,
}

/// Downloads the pending update, verifies its signature, and installs it.
/// The UI relaunches afterwards.
#[tauri::command]
pub async fn update_install(app: AppHandle, on_event: Channel<UpdateEvent>) -> Result<()> {
    let update = app
        .updater()
        .map_err(|e| Error::Other(e.to_string()))?
        .check()
        .await
        .map_err(|e| Error::Network(e.to_string()))?
        .ok_or_else(|| Error::Other(crate::lang::tr("已经是最新版本", "Already up to date").into()))?;

    let mut started = false;
    let bytes = update
        .download(
            |chunk, total| {
                if !started {
                    started = true;
                    let _ = on_event.send(UpdateEvent::Started { content_length: total });
                }
                let _ = on_event.send(UpdateEvent::Progress { chunk_length: chunk });
            },
            || {
                let _ = on_event.send(UpdateEvent::Finished);
            },
        )
        .await
        .map_err(|e| Error::Network(e.to_string()))?;

    install(&update, &bytes)
}

#[cfg(not(target_os = "macos"))]
fn install(update: &tauri_plugin_updater::Update, bytes: &[u8]) -> Result<()> {
    update.install(bytes).map_err(|e| Error::Other(e.to_string()))
}

#[cfg(target_os = "macos")]
fn install(update: &tauri_plugin_updater::Update, bytes: &[u8]) -> Result<()> {
    let bundle = macos::running_bundle()?;
    match macos::install_contents(&bundle, bytes) {
        Ok(()) => Ok(()),
        // Not ours to fix in place (another volume, no write access): the
        // plugin's install handles those, including the admin prompt.
        Err(macos::Failure::Unsupported(why)) => {
            log_fallback(&why);
            update.install(bytes).map_err(|e| Error::Other(e.to_string()))
        }
        Err(macos::Failure::Failed(e)) => Err(e),
    }
}

#[cfg(target_os = "macos")]
fn log_fallback(why: &str) {
    eprintln!("cloudborne update: replacing the whole bundle instead ({why})");
}

#[cfg(target_os = "macos")]
pub(crate) mod macos {
    use std::ffi::CString;
    use std::fs;
    use std::io::Cursor;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;
    use std::path::{Component, Path, PathBuf};

    use flate2::read::GzDecoder;

    use crate::error::Error;

    pub enum Failure {
        /// This way cannot work here; the caller may try another.
        Unsupported(String),
        /// It was tried and failed; the installed app is as it was.
        Failed(Error),
    }

    /// The `.app` the running binary lives in (`…/X.app/Contents/MacOS/bin`).
    pub fn running_bundle() -> crate::error::Result<PathBuf> {
        let exe = std::env::current_exe().map_err(|e| Error::Other(e.to_string()))?;
        bundle_of(&exe).ok_or_else(|| Error::Other(format!("not inside an app bundle: {}", exe.display())))
    }

    pub fn bundle_of(exe: &Path) -> Option<PathBuf> {
        let macos = exe.parent()?;
        let contents = macos.parent()?;
        let bundle = contents.parent()?;
        let named = |p: &Path, n: &str| p.components().next_back() == Some(Component::Normal(n.as_ref()));
        (named(macos, "MacOS") && named(contents, "Contents") && bundle.extension().is_some_and(|e| e == "app"))
            .then(|| bundle.to_path_buf())
    }

    /// Unpacks the update archive (`X.app/…`, as the bundler writes it) into a
    /// staging bundle next to `bundle`, then exchanges the two `Contents`
    /// directories. The old `Contents` ends up in the staging bundle, which is
    /// removed. `bundle` itself is never moved.
    pub fn install_contents(bundle: &Path, archive: &[u8]) -> Result<(), Failure> {
        let parent = bundle.parent().ok_or_else(|| Failure::Unsupported("bundle has no parent".into()))?;
        let dev = fs::symlink_metadata(bundle).map_err(|e| Failure::Unsupported(e.to_string()))?.dev();
        // The exchange is a rename, so staging has to be on the same volume;
        // next to the bundle always is, if we may write there.
        let stage = tempfile::Builder::new()
            .prefix(".cloudborne-update-")
            .tempdir_in(parent)
            .map_err(|e| Failure::Unsupported(format!("cannot stage next to {}: {e}", bundle.display())))?;
        if fs::metadata(stage.path()).map(|m| m.dev()).ok() != Some(dev) {
            return Err(Failure::Unsupported("staging is on another volume".into()));
        }

        let new_contents = unpack(archive, stage.path()).map_err(Failure::Failed)?;
        let old_contents = bundle.join("Contents");
        if fs::symlink_metadata(&old_contents).is_err() {
            return Err(Failure::Unsupported("installed bundle has no Contents".into()));
        }

        match swap(&new_contents, &old_contents) {
            Ok(()) => {}
            Err(e) if e.raw_os_error() == Some(libc::EACCES) || e.raw_os_error() == Some(libc::EPERM) => {
                return Err(Failure::Unsupported(format!("no permission: {e}")));
            }
            // File systems without the atomic swap (not APFS): two renames,
            // undoing the first if the second fails.
            Err(_) => {
                let aside = stage.path().join("previous-Contents");
                fs::rename(&old_contents, &aside).map_err(|e| Failure::Unsupported(e.to_string()))?;
                if let Err(e) = fs::rename(&new_contents, &old_contents) {
                    let _ = fs::rename(&aside, &old_contents);
                    return Err(Failure::Failed(Error::io(&old_contents, e)));
                }
            }
        }

        // Tell Launch Services and the Dock the bundle changed, so they reread
        // its Info.plist and icon. Failure here is cosmetic.
        let _ = std::process::Command::new("touch").arg(bundle).status();
        let _ = std::process::Command::new(
            "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
        )
        .args(["-f".as_ref(), bundle.as_os_str()])
        .status();
        Ok(())
    }

    /// Unpacks into `dir/X.app/…` and returns the `Contents` inside it.
    pub fn unpack(archive: &[u8], dir: &Path) -> crate::error::Result<PathBuf> {
        let mut tar = tar::Archive::new(GzDecoder::new(Cursor::new(archive)));
        tar.set_preserve_permissions(true);
        tar.set_overwrite(false);
        // `unpack_in` refuses entries that would land outside `dir`.
        for entry in tar.entries().map_err(|e| Error::io(dir, e))? {
            let mut entry = entry.map_err(|e| Error::io(dir, e))?;
            entry.unpack_in(dir).map_err(|e| Error::io(dir, e))?;
        }
        let mut apps = fs::read_dir(dir)
            .map_err(|e| Error::io(dir, e))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|e| e == "app"));
        let app = apps.next().ok_or_else(|| Error::Other("update archive holds no .app".into()))?;
        if apps.next().is_some() {
            return Err(Error::Other("update archive holds more than one .app".into()));
        }
        let contents = app.join("Contents");
        if !contents.join("Info.plist").is_file() {
            return Err(Error::Other("update archive's app has no Contents/Info.plist".into()));
        }
        Ok(contents)
    }

    /// Exchanges `a` and `b` in one step (APFS `RENAME_SWAP`).
    pub fn swap(a: &Path, b: &Path) -> std::io::Result<()> {
        let a = CString::new(a.as_os_str().as_bytes())?;
        let b = CString::new(b.as_os_str().as_bytes())?;
        // SAFETY: both are valid NUL-terminated strings that outlive the call.
        if unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_SWAP) } == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::macos::*;
    use std::fs;
    use std::os::unix::fs::MetadataExt;
    use std::path::Path;

    fn archive(version: &str) -> Vec<u8> {
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        let mut add = |path: &str, body: &[u8], mode: u32| {
            let mut h = tar::Header::new_gnu();
            h.set_size(body.len() as u64);
            h.set_mode(mode);
            h.set_cksum();
            tar.append_data(&mut h, path, body).unwrap();
        };
        add("Cloudborne.app/Contents/Info.plist", format!("<plist>{version}</plist>").as_bytes(), 0o644);
        add("Cloudborne.app/Contents/MacOS/cloudborne-desktop", version.as_bytes(), 0o755);
        tar.into_inner().unwrap().finish().unwrap()
    }

    fn installed(dir: &Path, version: &str) -> std::path::PathBuf {
        let app = dir.join("Cloudborne.app");
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        fs::write(app.join("Contents/Info.plist"), format!("<plist>{version}</plist>")).unwrap();
        fs::write(app.join("Contents/MacOS/cloudborne-desktop"), version).unwrap();
        app
    }

    #[test]
    fn keeps_the_bundle_and_replaces_its_contents() {
        let dir = tempfile::tempdir().unwrap();
        let app = installed(dir.path(), "0.9.3");
        let ino = fs::metadata(&app).unwrap().ino();

        assert!(install_contents(&app, &archive("0.9.4")).is_ok());

        // Same directory, so the Dock still recognises it; new files inside.
        assert_eq!(fs::metadata(&app).unwrap().ino(), ino);
        assert_eq!(fs::read_to_string(app.join("Contents/Info.plist")).unwrap(), "<plist>0.9.4</plist>");
        let bin = app.join("Contents/MacOS/cloudborne-desktop");
        assert_eq!(fs::read_to_string(&bin).unwrap(), "0.9.4");
        assert_eq!(fs::metadata(&bin).unwrap().mode() & 0o777, 0o755);
        // The staging bundle and the old Contents are gone.
        let left: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left, vec![std::ffi::OsString::from("Cloudborne.app")]);
    }

    #[test]
    fn leaves_the_app_alone_when_the_archive_is_bad() {
        let dir = tempfile::tempdir().unwrap();
        let app = installed(dir.path(), "0.9.3");
        assert!(matches!(install_contents(&app, b"not a tarball"), Err(Failure::Failed(_))));
        assert_eq!(fs::read_to_string(app.join("Contents/Info.plist")).unwrap(), "<plist>0.9.3</plist>");

        // An archive without Info.plist is refused before anything moves.
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        let mut h = tar::Header::new_gnu();
        h.set_size(1);
        h.set_mode(0o644);
        h.set_cksum();
        tar.append_data(&mut h, "Cloudborne.app/Contents/x", &b"x"[..]).unwrap();
        let bad = tar.into_inner().unwrap().finish().unwrap();
        assert!(matches!(install_contents(&app, &bad), Err(Failure::Failed(_))));
        assert_eq!(fs::read_to_string(app.join("Contents/Info.plist")).unwrap(), "<plist>0.9.3</plist>");
    }

    #[test]
    fn finds_the_bundle_of_the_running_binary() {
        assert_eq!(
            bundle_of(Path::new("/Applications/Cloudborne.app/Contents/MacOS/cloudborne-desktop")),
            Some("/Applications/Cloudborne.app".into())
        );
        assert_eq!(bundle_of(Path::new("/usr/local/bin/cloudborne-desktop")), None);
        assert_eq!(bundle_of(Path::new("/x/target/debug/cloudborne-desktop")), None);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod real_archive {
    /// Runs the install against a real `Cloudborne.app.tar.gz` next to a copy of
    /// the app: `CB_UPDATE_DIR=<dir> cargo test real_archive -- --ignored`.
    #[test]
    #[ignore]
    fn installs_a_real_update() {
        use std::os::unix::fs::MetadataExt;
        let dir = std::path::PathBuf::from(std::env::var("CB_UPDATE_DIR").unwrap());
        let app = dir.join("Cloudborne.app");
        let ino = std::fs::metadata(&app).unwrap().ino();
        let bytes = std::fs::read(dir.join("Cloudborne.app.tar.gz")).unwrap();
        assert!(super::macos::install_contents(&app, &bytes).is_ok());
        assert_eq!(std::fs::metadata(&app).unwrap().ino(), ino);
    }
}
