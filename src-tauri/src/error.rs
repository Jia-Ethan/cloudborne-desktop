use std::path::Path;

use serde::Serialize;

use crate::tr_fmt;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{}", tr_fmt!("配置文件无法解析：{}", "Config file could not be read: {}", .0))]
    Config(String),
    #[error("{0}")]
    Api(String),
    #[error("{}", crate::lang::tr("登录已失效，请重新登录", "Your session has expired. Please sign in again."))]
    Unauthorized,
    #[error("{}", tr_fmt!("网络错误：{}", "Network error: {}", .0))]
    Network(String),
    /// The OS credential store failed (Windows and Linux; macOS uses a file).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    #[error("{}", tr_fmt!("钥匙串错误：{}", "Keychain error: {}", .0))]
    Keychain(String),
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn io(path: &Path, source: std::io::Error) -> Self {
        Error::Io { path: path.display().to_string(), source }
    }
}

// Commands return errors to the UI as plain strings.
impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
