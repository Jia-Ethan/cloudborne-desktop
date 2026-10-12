//! Our own bookkeeping under `~/.cloudborne-desktop/state.json`: for JSON
//! configs that cannot hold a marker comment, the values we overwrote, so
//! disconnect can restore them exactly.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, Result};
use crate::fsx;

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct State {
    /// tool id -> key -> previous value (`null` means the key did not exist).
    #[serde(default)]
    pub previous: BTreeMap<String, BTreeMap<String, Value>>,
}

pub fn path(home: &Path) -> PathBuf {
    home.join(".cloudborne-desktop").join("state.json")
}

pub fn load(home: &Path) -> Result<State> {
    let text = fsx::read_or_empty(&path(home))?;
    if text.trim().is_empty() {
        return Ok(State::default());
    }
    serde_json::from_str(&text).map_err(|e| Error::Config(format!("state.json: {e}")))
}

pub fn save(home: &Path, state: &State) -> Result<()> {
    let text = serde_json::to_string_pretty(state).map_err(|e| Error::Other(e.to_string()))?;
    fsx::write_atomic(&path(home), &text)
}
