//! Main window chrome. macOS: the sidebar material blurs the desktop behind a
//! transparent page, and the title bar is hidden under the content with the
//! traffic lights inset. Windows 11: Mica behind the page, native title bar.
//! Older Windows: plain opaque window. The page reads which one it got from
//! `window.__CB_GLASS__` and styles itself to match.

use tauri::webview::WebviewWindowBuilder;
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{Manager, Runtime};

fn glass() -> &'static str {
    if cfg!(target_os = "macos") {
        "vibrancy"
    } else if cfg!(windows) && windows_11() {
        "mica"
    } else {
        "none"
    }
}

#[cfg(windows)]
fn windows_11() -> bool {
    windows_version::OsVersion::current().build >= 22000
}

#[cfg(not(windows))]
fn windows_11() -> bool {
    false
}

pub fn style<'a, R: Runtime, M: Manager<R>>(b: WebviewWindowBuilder<'a, R, M>) -> WebviewWindowBuilder<'a, R, M> {
    let glass = glass();
    let b = b.initialization_script(format!("window.__CB_GLASS__ = '{glass}';"));
    match glass {
        "vibrancy" => mac(b),
        "mica" => b.transparent(true).effects(EffectsBuilder::new().effect(Effect::Mica).build()),
        _ => b,
    }
}

#[cfg(target_os = "macos")]
fn mac<'a, R: Runtime, M: Manager<R>>(b: WebviewWindowBuilder<'a, R, M>) -> WebviewWindowBuilder<'a, R, M> {
    b.transparent(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(20.0, 24.0))
        .effects(
            EffectsBuilder::new()
                .effect(Effect::Sidebar)
                .state(EffectState::FollowsWindowActiveState)
                .build(),
        )
}

#[cfg(not(target_os = "macos"))]
fn mac<'a, R: Runtime, M: Manager<R>>(b: WebviewWindowBuilder<'a, R, M>) -> WebviewWindowBuilder<'a, R, M> {
    b
}
