use std::path::Path;

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("配置文件无法解析：{0}")]
    Config(String),
    #[error("{0}")]
    Api(String),
    #[error("登录已失效，请重新登录")]
    Unauthorized,
    #[error("网络错误：{0}")]
    Network(String),
    #[error("钥匙串错误：{0}")]
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
