//! One module per supported tool. Each knows where the tool keeps its config,
//! how to tell whether we are connected, and how to add or remove exactly the
//! part we own without disturbing anything else in the file.

pub mod claude;
pub mod codex;
pub mod detect;
pub mod dsh;
pub mod grok;
pub mod pi;
pub mod zcode;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::tr_fmt;

/// Error text for a group that offers no models to generate a config from.
pub fn no_models(tool: &str) -> String {
    tr_fmt!(
        "这个分组没有可用模型，无法为 {tool} 生成配置",
        "This group has no models, so no {tool} config can be generated"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolId {
    Codex,
    Claude,
    Zcode,
    Grok,
    Pi,
    Dsh,
}

impl ToolId {
    pub const ALL: [ToolId; 6] = [ToolId::Codex, ToolId::Claude, ToolId::Zcode, ToolId::Grok, ToolId::Pi, ToolId::Dsh];

    pub fn display_name(self) -> &'static str {
        match self {
            ToolId::Codex => "Codex",
            ToolId::Claude => "Claude Code",
            ToolId::Zcode => "ZCode",
            ToolId::Grok => "Grok Build",
            ToolId::Pi => "Pi",
            ToolId::Dsh => "DSH",
        }
    }

    /// Relay group platforms whose keys this tool can use, in preference order.
    pub fn platforms(self) -> &'static [&'static str] {
        match self {
            ToolId::Codex => &["openai"],
            ToolId::Claude => &["anthropic"],
            // Domestic models over the OpenAI-compatible endpoint.
            ToolId::Zcode => &["zhipu", "deepseek", "kimi", "minimax"],
            ToolId::Grok => &["grok"],
            // Pi speaks every protocol the relay does.
            ToolId::Pi => &["openai", "anthropic", "grok", "zhipu", "deepseek", "kimi", "minimax"],
            // DeepSeek's own harness; other domestic groups also speak Chat Completions.
            ToolId::Dsh => &["deepseek", "zhipu", "kimi", "minimax"],
        }
    }
}

/// What a tool needs to talk to the relay.
#[derive(Debug, Clone)]
pub struct Connection {
    /// Relay origin without a trailing slash, e.g. `https://api.cloudborne.cn`.
    pub origin: String,
    pub api_key: String,
    /// Model ids the key's group serves, as returned by `/v1/models`.
    pub models: Vec<String>,
    /// The key's group platform (`openai`, `anthropic`, …).
    pub platform: String,
}

impl Connection {
    pub fn v1(&self) -> String {
        format!("{}/v1", self.origin.trim_end_matches('/'))
    }
}

/// Files a tool adapter reads and writes, rooted at a home directory so tests
/// can point everything at a temp dir.
/// `CLOUDBORNE_HOME` redirects every config read and write, for testing
/// against a sandbox instead of the real home directory.
pub fn home_dir() -> PathBuf {
    if let Some(h) = std::env::var_os("CLOUDBORNE_HOME") {
        return PathBuf::from(h);
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn is_connected(tool: ToolId, home: &Path) -> Result<bool> {
    match tool {
        ToolId::Codex => codex::is_connected(home),
        ToolId::Claude => claude::is_connected(home),
        ToolId::Zcode => zcode::is_connected(home),
        ToolId::Grok => grok::is_connected(home),
        ToolId::Pi => pi::is_connected(home),
        ToolId::Dsh => dsh::is_connected(home),
    }
}

pub fn connect(tool: ToolId, home: &Path, conn: &Connection) -> Result<Vec<PathBuf>> {
    match tool {
        ToolId::Codex => codex::connect(home, conn),
        ToolId::Claude => claude::connect(home, conn),
        ToolId::Zcode => zcode::connect(home, conn),
        ToolId::Grok => grok::connect(home, conn),
        ToolId::Pi => pi::connect(home, conn),
        ToolId::Dsh => dsh::connect(home, conn),
    }
}

pub fn disconnect(tool: ToolId, home: &Path) -> Result<Vec<PathBuf>> {
    match tool {
        ToolId::Codex => codex::disconnect(home),
        ToolId::Claude => claude::disconnect(home),
        ToolId::Zcode => zcode::disconnect(home),
        ToolId::Grok => grok::disconnect(home),
        ToolId::Pi => pi::disconnect(home),
        ToolId::Dsh => dsh::disconnect(home),
    }
}

#[cfg(test)]
pub(crate) fn test_conn() -> Connection {
    Connection {
        origin: "https://relay.example".into(),
        api_key: "sk-test-123".into(),
        models: vec!["model-a".into(), "model-b".into()],
        platform: "openai".into(),
    }
}
