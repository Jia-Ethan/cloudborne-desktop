//! Saved accounts: who each one is, which one is active, and its tokens.
//! Bookkeeping only; `session.rs` does the locking and the network.
//!
//! Layout in the store: `accounts` holds `{ active, accounts: [{ user_id,
//! email }] }`; each account's tokens sit in their own entry,
//! `session.<user id>`, because a Windows credential holds at most 2560 bytes.
//! v0.8 kept one account's tokens under `session`. That entry is adopted on
//! first launch as an account whose id is not known yet, and moved to its own
//! entry once the profile says whose it is.

use serde::{Deserialize, Serialize};

use crate::api::Tokens;
use crate::error::{Error, Result};
use crate::session::Store;

pub const INDEX: &str = "accounts";
pub const LEGACY: &str = "session";
/// Stands in for the user id of a v0.8 session until the profile names it.
pub const UNKNOWN: i64 = 0;

/// Where an account's tokens are kept. An account not yet identified keeps
/// them where v0.8 put them.
pub fn token_key(user_id: i64) -> String {
    if user_id == UNKNOWN {
        LEGACY.into()
    } else {
        format!("{LEGACY}.{user_id}")
    }
}

pub fn load_tokens(store: &dyn Store, user_id: i64) -> Result<Option<Tokens>> {
    Ok(store.get(&token_key(user_id))?.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn save_tokens(store: &dyn Store, user_id: i64, t: &Tokens) -> Result<()> {
    let s = serde_json::to_string(t).map_err(|e| Error::Other(e.to_string()))?;
    store.set(&token_key(user_id), &s)
}

pub fn delete_tokens(store: &dyn Store, user_id: i64) -> Result<()> {
    store.delete(&token_key(user_id))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub user_id: i64,
    #[serde(default)]
    pub email: String,
    /// None once signed out; the entry stays so the login page can offer the email.
    #[serde(skip)]
    pub tokens: Option<Tokens>,
}

/// What the UI gets for each saved account.
#[derive(Debug, Serialize, PartialEq)]
pub struct AccountInfo {
    pub user_id: i64,
    pub email: String,
    pub active: bool,
    pub signed_in: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Accounts {
    #[serde(default)]
    pub active: Option<i64>,
    #[serde(default)]
    pub accounts: Vec<Account>,
}

impl Accounts {
    /// Reads the index and each account's tokens. Without an index yet, adopts
    /// v0.8's session. A token entry that cannot be read counts as signed out
    /// for this run; nothing is deleted.
    pub fn load(store: &dyn Store) -> Self {
        match store.get(INDEX) {
            Ok(Some(text)) => {
                let mut a: Accounts = serde_json::from_str(&text).unwrap_or_default();
                for acc in &mut a.accounts {
                    acc.tokens = load_tokens(store, acc.user_id).unwrap_or(None);
                }
                a
            }
            Ok(None) => Self::adopt(load_tokens(store, UNKNOWN).unwrap_or(None)),
            Err(_) => Self::default(),
        }
    }

    /// The account list v0.8's single session becomes.
    pub fn adopt(legacy: Option<Tokens>) -> Self {
        match legacy {
            Some(t) => Self {
                active: Some(UNKNOWN),
                accounts: vec![Account { user_id: UNKNOWN, email: String::new(), tokens: Some(t) }],
            },
            None => Self::default(),
        }
    }

    pub fn save_index(&self, store: &dyn Store) -> Result<()> {
        let s = serde_json::to_string(self).map_err(|e| Error::Other(e.to_string()))?;
        store.set(INDEX, &s)
    }

    pub fn get(&self, user_id: i64) -> Option<&Account> {
        self.accounts.iter().find(|a| a.user_id == user_id)
    }

    pub fn tokens(&self, user_id: i64) -> Option<&Tokens> {
        self.get(user_id)?.tokens.as_ref()
    }

    pub fn set_tokens(&mut self, user_id: i64, t: Tokens) {
        if let Some(a) = self.accounts.iter_mut().find(|a| a.user_id == user_id) {
            a.tokens = Some(t);
        }
    }

    /// The active account's id when it is signed in.
    pub fn active_signed_in(&self) -> Option<i64> {
        self.active.filter(|id| self.tokens(*id).is_some())
    }

    /// A finished login: adds the account, or replaces the one with the same
    /// id, and makes it active.
    pub fn upsert(&mut self, user_id: i64, email: &str, tokens: Tokens) {
        let acc = Account { user_id, email: email.to_string(), tokens: Some(tokens) };
        match self.accounts.iter_mut().find(|a| a.user_id == user_id) {
            Some(a) => *a = acc,
            None => self.accounts.push(acc),
        }
        self.active = Some(user_id);
    }

    /// Records whose account `from` is, from its profile: a v0.8 session gets
    /// its real id, and a changed email is kept. Returns whether anything changed.
    pub fn identify(&mut self, from: i64, user_id: i64, email: &str) -> bool {
        if self.get(from).is_none() {
            return false;
        }
        let mut changed = false;
        if from != user_id {
            // The account just identified has the live tokens; an older entry for the same user goes.
            self.accounts.retain(|a| a.user_id != user_id);
            if let Some(a) = self.accounts.iter_mut().find(|a| a.user_id == from) {
                a.user_id = user_id;
            }
            if self.active == Some(from) {
                self.active = Some(user_id);
            }
            changed = true;
        }
        if let Some(a) = self.accounts.iter_mut().find(|a| a.user_id == user_id) {
            if a.email != email {
                a.email = email.to_string();
                changed = true;
            }
        }
        changed
    }

    /// The relay turned this account's refresh token down. Its email stays for
    /// the login page; an account never identified has nothing to show and goes.
    pub fn sign_out(&mut self, user_id: i64) {
        if user_id == UNKNOWN {
            self.accounts.retain(|a| a.user_id != UNKNOWN);
            if self.active == Some(UNKNOWN) {
                self.active = None;
            }
        } else if let Some(a) = self.accounts.iter_mut().find(|a| a.user_id == user_id) {
            a.tokens = None;
        }
    }

    /// Forgets an account. When it was the active one, the next signed-in
    /// account takes over (or none).
    pub fn remove(&mut self, user_id: i64) -> Option<Account> {
        let i = self.accounts.iter().position(|a| a.user_id == user_id)?;
        let gone = self.accounts.remove(i);
        if self.active == Some(user_id) {
            self.active = self.next_signed_in(user_id);
        }
        Some(gone)
    }

    pub fn next_signed_in(&self, except: i64) -> Option<i64> {
        self.accounts.iter().find(|a| a.user_id != except && a.tokens.is_some()).map(|a| a.user_id)
    }

    /// Identified accounts in the order they were added.
    pub fn list(&self) -> Vec<AccountInfo> {
        self.accounts
            .iter()
            .filter(|a| a.user_id != UNKNOWN)
            .map(|a| AccountInfo {
                user_id: a.user_id,
                email: a.email.clone(),
                active: self.active == Some(a.user_id),
                signed_in: a.tokens.is_some(),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::FileStore;

    fn tok(a: &str) -> Tokens {
        Tokens { access_token: a.into(), refresh_token: Some(format!("r-{a}")) }
    }

    fn store() -> (tempfile::TempDir, FileStore) {
        let dir = tempfile::tempdir().unwrap();
        let s = FileStore::new(dir.path().to_path_buf());
        (dir, s)
    }

    #[test]
    fn adopts_the_v08_session() {
        let (_d, s) = store();
        assert!(Accounts::load(&s).accounts.is_empty());
        s.set(LEGACY, r#"{"access_token":"a","refresh_token":"r"}"#).unwrap();
        let a = Accounts::load(&s);
        assert_eq!(a.active, Some(UNKNOWN));
        assert_eq!(a.active_signed_in(), Some(UNKNOWN));
        assert_eq!(a.tokens(UNKNOWN).unwrap().access_token, "a");
        // Not listed until the profile names it.
        assert!(a.list().is_empty());
    }

    #[test]
    fn identifying_moves_the_v08_session_to_its_own_entry() {
        let (_d, s) = store();
        s.set(LEGACY, r#"{"access_token":"a","refresh_token":"r"}"#).unwrap();
        let mut a = Accounts::load(&s);
        assert!(a.identify(UNKNOWN, 7, "a@b.c"));
        assert_eq!(a.active, Some(7));
        assert!(!a.identify(7, 7, "a@b.c"));
        // What session.rs does after identify.
        save_tokens(&s, 7, a.tokens(7).unwrap()).unwrap();
        a.save_index(&s).unwrap();
        delete_tokens(&s, UNKNOWN).unwrap();

        let b = Accounts::load(&s);
        assert_eq!(s.get(LEGACY).unwrap(), None);
        assert_eq!(b.list(), [AccountInfo { user_id: 7, email: "a@b.c".into(), active: true, signed_in: true }]);
        assert_eq!(b.tokens(7).unwrap().refresh_token.as_deref(), Some("r"));
    }

    #[test]
    fn upsert_replaces_the_same_user_and_activates() {
        let mut a = Accounts::default();
        a.upsert(1, "one@x", tok("1"));
        a.upsert(2, "two@x", tok("2"));
        assert_eq!(a.active, Some(2));
        a.sign_out(1);
        a.upsert(1, "one@new", tok("1b"));
        assert_eq!(a.accounts.len(), 2);
        assert_eq!(a.accounts[0].email, "one@new");
        assert_eq!(a.tokens(1).unwrap().access_token, "1b");
        assert_eq!(a.active, Some(1));
    }

    #[test]
    fn sign_out_keeps_the_email() {
        let mut a = Accounts::default();
        a.upsert(1, "one@x", tok("1"));
        a.upsert(2, "two@x", tok("2"));
        a.sign_out(2);
        assert_eq!(a.active, Some(2));
        assert_eq!(a.active_signed_in(), None);
        let l = a.list();
        assert_eq!(l[1], AccountInfo { user_id: 2, email: "two@x".into(), active: true, signed_in: false });
        assert!(l[0].signed_in);
        assert_eq!(a.next_signed_in(2), Some(1));
    }

    #[test]
    fn an_unidentified_session_that_signs_out_is_dropped() {
        let mut a = Accounts::adopt(Some(tok("a")));
        a.sign_out(UNKNOWN);
        assert!(a.accounts.is_empty());
        assert_eq!(a.active, None);
    }

    #[test]
    fn removing_the_active_account_hands_over_to_a_signed_in_one() {
        let mut a = Accounts::default();
        a.upsert(1, "one@x", tok("1"));
        a.upsert(2, "two@x", tok("2"));
        a.upsert(3, "three@x", tok("3"));
        a.sign_out(1);
        assert_eq!(a.remove(3).unwrap().email, "three@x");
        assert_eq!(a.active, Some(2));
        a.remove(1);
        assert_eq!(a.active, Some(2));
        a.remove(2);
        assert_eq!(a.active, None);
        assert!(a.remove(9).is_none());
    }

    #[test]
    fn index_and_tokens_round_trip_separately() {
        let (_d, s) = store();
        let mut a = Accounts::default();
        a.upsert(1, "one@x", tok("1"));
        a.upsert(2, "two@x", tok("2"));
        for acc in &a.accounts {
            save_tokens(&s, acc.user_id, acc.tokens.as_ref().unwrap()).unwrap();
        }
        a.save_index(&s).unwrap();
        // The index holds no tokens.
        assert!(!s.get(INDEX).unwrap().unwrap().contains("access_token"));
        delete_tokens(&s, 1).unwrap();
        let b = Accounts::load(&s);
        assert_eq!(b.active, Some(2));
        assert_eq!(b.list().iter().map(|x| x.signed_in).collect::<Vec<_>>(), [false, true]);
        // A present index wins over a stray v0.8 entry.
        s.set(LEGACY, r#"{"access_token":"old"}"#).unwrap();
        assert_eq!(Accounts::load(&s).accounts.len(), 2);
    }
}
