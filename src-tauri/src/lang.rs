//! UI language for messages produced on the Rust side (errors, installer
//! banners). The UI owns the choice and tells us via `set_language`.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn set(code: &str) {
    ENGLISH.store(!code.starts_with("zh"), Ordering::Relaxed);
}

pub fn english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// Picks the Chinese or English form of a message.
pub fn tr(zh: &'static str, en: &'static str) -> &'static str {
    if english() {
        en
    } else {
        zh
    }
}

/// Like [`tr`] for messages with arguments: `tr_fmt!("下载失败：{e}", "Download failed: {e}")`.
#[macro_export]
macro_rules! tr_fmt {
    ($zh:literal, $en:literal $(, $arg:expr)* $(,)?) => {
        if $crate::lang::english() { format!($en $(, $arg)*) } else { format!($zh $(, $arg)*) }
    };
}
