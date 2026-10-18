//! The desktop sign-in's bearer token in the OS credential store (M6): the Windows Credential
//! Manager, the macOS Keychain, or the Secret Service on Linux (GNOME Keyring, KWallet), through
//! the `keyring` crate, as the entry of service [`SERVICE`] and account [`account`]. The webview
//! reads it once at startup and keeps it in memory (`src/platform/tauri/token-store.ts`); where
//! the store is unavailable or fails, the webview keeps the token in its own storage instead, as
//! before M6.
//!
//! The entry holds the token and its expiry as JSON text, `{"token":"…","expiresAt":…}`
//! ([`encode`], [`decode`]). Each command runs on a blocking thread, one at a time: the Keychain
//! or the Secret Service may wait for the user to unlock it, which must not stall the main thread.
//! A command rejects with a message that never contains the token.

use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};

/// The service the entry is filed under: the app's name.
pub const SERVICE: &str = "Timer App";

/// The entry's account in release builds.
pub const ACCOUNT: &str = "sync-token";

/// The entry's account in debug builds, which talk to a local server: their token must not
/// replace an installed release's, nor a release's be sent to a development server.
pub const DEBUG_ACCOUNT: &str = "sync-token-dev";

/// Debug builds only: an environment variable naming another account, so the desktop smoke test
/// (`scripts/smoke-desktop.mjs`) leaves a developer's own token alone. Release builds ignore it.
pub const ACCOUNT_ENV: &str = "TIMER_APP_TOKEN_ACCOUNT";

/// The longest token the store takes, as `settings.MAX_AUTH_TOKEN_LENGTH` in the webview.
pub const MAX_TOKEN_LENGTH: usize = 4096;

/// A stored bearer token: what the webview sends with `token_set` and gets from `token_get`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredToken {
    /// The session token: 1 to [`MAX_TOKEN_LENGTH`] visible ASCII characters.
    pub token: String,
    /// When the session expires, in epoch milliseconds: finite and positive.
    pub expires_at: f64,
}

impl StoredToken {
    /// Whether this is a token the webview could have sent (the rules of `migrateDeviceAuth` in
    /// `src/core/settings.ts`): the expiry is not compared with the clock here.
    pub fn is_valid(&self) -> bool {
        !self.token.is_empty()
            && self.token.len() <= MAX_TOKEN_LENGTH
            && self.token.bytes().all(|byte| byte.is_ascii_graphic())
            && self.expires_at.is_finite()
            && self.expires_at > 0.0
    }
}

/// The entry's text for `token`, or why it cannot be stored (an invalid token).
pub fn encode(token: &StoredToken) -> Result<String, String> {
    if !token.is_valid() {
        return Err("not a valid sign-in token".to_owned());
    }
    serde_json::to_string(token).map_err(|error| format!("could not encode the token: {error}"))
}

/// The token in an entry's text, or None when the text is not one (another program's entry, or a
/// damaged one): the webview then reads no token.
pub fn decode(text: &str) -> Option<StoredToken> {
    serde_json::from_str::<StoredToken>(text)
        .ok()
        .filter(StoredToken::is_valid)
}

/// The account of the entry this build uses: [`ACCOUNT`]; in debug builds [`DEBUG_ACCOUNT`], or
/// the one [`ACCOUNT_ENV`] names.
pub fn account() -> String {
    if cfg!(debug_assertions) {
        debug_account(std::env::var(ACCOUNT_ENV).ok().as_deref())
    } else {
        ACCOUNT.to_owned()
    }
}

/// A debug build's account: `name` (from [`ACCOUNT_ENV`]) when it is not blank, else
/// [`DEBUG_ACCOUNT`].
pub fn debug_account(name: Option<&str>) -> String {
    match name.map(str::trim) {
        Some(name) if !name.is_empty() => name.to_owned(),
        _ => DEBUG_ACCOUNT.to_owned(),
    }
}

/// One entry of a credential store: what the commands need of `keyring::Entry`, so their logic
/// can be tested with a stand-in.
pub trait Secret {
    /// The entry's text; `keyring::Error::NoEntry` when there is none.
    fn read(&self) -> keyring::Result<String>;
    /// Replaces the entry's text, creating the entry when there is none.
    fn write(&self, text: &str) -> keyring::Result<()>;
    /// Deletes the entry; `keyring::Error::NoEntry` when there is none.
    fn erase(&self) -> keyring::Result<()>;
}

impl Secret for keyring::Entry {
    fn read(&self) -> keyring::Result<String> {
        self.get_password()
    }

    fn write(&self, text: &str) -> keyring::Result<()> {
        self.set_password(text)
    }

    fn erase(&self) -> keyring::Result<()> {
        self.delete_credential()
    }
}

/// A store error as a rejection's message. `keyring::Error`'s texts carry no secret: the variants
/// that hold the entry's bytes (`BadEncoding`, `BadDataFormat`) print only what went wrong.
fn describe(error: &keyring::Error) -> String {
    format!("the credential store failed: {error}")
}

/// The stored token: None when there is no entry, or when its text is not a token (see
/// [`decode`]). Fails when the store cannot be read (unavailable, locked, refused).
pub fn load(secret: &impl Secret) -> Result<Option<StoredToken>, String> {
    match secret.read() {
        Ok(text) => Ok(decode(&text)),
        Err(
            keyring::Error::NoEntry
            | keyring::Error::BadEncoding(_)
            | keyring::Error::BadDataFormat(..),
        ) => Ok(None),
        Err(error) => Err(describe(&error)),
    }
}

/// Stores `token` in place of any stored one. Fails for an invalid token, or when the store
/// refuses it.
pub fn store(secret: &impl Secret, token: &StoredToken) -> Result<(), String> {
    let text = encode(token)?;
    secret.write(&text).map_err(|error| describe(&error))
}

/// Removes the stored token; nothing to remove is no failure.
pub fn clear(secret: &impl Secret) -> Result<(), String> {
    match secret.erase() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(describe(&error)),
    }
}

/// Held while a command uses the store, so the commands reach it one at a time (the `keyring`
/// crate does not order calls on one entry from several threads).
static STORE: Mutex<()> = Mutex::new(());

/// Runs `task` on this build's entry, on a blocking thread, one task at a time.
async fn on_entry<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&keyring::Entry) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let _turn = STORE.lock().unwrap_or_else(PoisonError::into_inner);
        let entry = keyring::Entry::new(SERVICE, &account()).map_err(|error| describe(&error))?;
        task(&entry)
    })
    .await
    .map_err(|error| format!("the credential store task failed: {error}"))?
}

/// Command `token_get`, no payload: the stored token, `{ token, expiresAt }`, or null when none is
/// stored (see [`load`]). Rejects when the store cannot be read.
#[tauri::command]
pub async fn token_get() -> Result<Option<StoredToken>, String> {
    on_entry(load).await
}

/// Command `token_set`, payload `{ auth: { token, expiresAt } }`: stores the token in place of any
/// stored one. Rejects for an invalid token or when the store refuses it.
#[tauri::command]
pub async fn token_set(auth: StoredToken) -> Result<(), String> {
    on_entry(move |entry| store(entry, &auth)).await
}

/// Command `token_clear`, no payload: removes the stored token (none stored is no failure).
/// Rejects when the store fails.
#[tauri::command]
pub async fn token_clear() -> Result<(), String> {
    on_entry(clear).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn token(text: &str, expires_at: f64) -> StoredToken {
        StoredToken {
            token: text.to_owned(),
            expires_at,
        }
    }

    const EXPIRES: f64 = 1_790_000_000_000.0;

    #[test]
    fn a_token_round_trips_through_the_entry_text() {
        let stored = token("Rk9vYmFy.x_y-z~1", EXPIRES);
        let text = encode(&stored).expect("encodes");
        assert_eq!(
            text,
            r#"{"token":"Rk9vYmFy.x_y-z~1","expiresAt":1790000000000.0}"#
        );
        assert_eq!(decode(&text), Some(stored));
        // The webview's numbers have no fraction.
        assert_eq!(
            decode(r#"{"token":"abc","expiresAt":1790000000000}"#),
            Some(token("abc", EXPIRES))
        );
    }

    #[test]
    fn invalid_tokens_are_neither_stored_nor_read() {
        let long = "a".repeat(MAX_TOKEN_LENGTH + 1);
        for invalid in [
            token("", EXPIRES),
            token(&long, EXPIRES),
            token("has space", EXPIRES),
            token("tab\there", EXPIRES),
            token("naïve", EXPIRES),
            token("abc", 0.0),
            token("abc", -1.0),
            token("abc", f64::NAN),
            token("abc", f64::INFINITY),
        ] {
            assert!(!invalid.is_valid(), "{invalid:?}");
            assert!(encode(&invalid).is_err(), "{invalid:?}");
        }
        assert!(token(&"a".repeat(MAX_TOKEN_LENGTH), EXPIRES).is_valid());
        for text in [
            "",
            "sync-token",
            "null",
            "[]",
            r#"{"token":"abc"}"#,
            r#"{"expiresAt":1}"#,
            r#"{"token":"","expiresAt":1}"#,
            r#"{"token":"abc","expiresAt":0}"#,
            r#"{"token":"abc","expiresAt":"1790000000000"}"#,
            r#"{"token":42,"expiresAt":1}"#,
            r#"{"token":"abc","expiresAt":1,"user":"x"}"#,
        ] {
            assert_eq!(decode(text), None, "{text}");
        }
    }

    #[test]
    fn the_payload_is_camel_case_and_refuses_extra_fields() {
        let parsed: StoredToken =
            serde_json::from_value(serde_json::json!({ "token": "abc", "expiresAt": 5 }))
                .expect("parses");
        assert_eq!(parsed, token("abc", 5.0));
        assert!(serde_json::from_value::<StoredToken>(
            serde_json::json!({ "token": "abc", "expires_at": 5 })
        )
        .is_err());
    }

    #[test]
    fn debug_builds_use_their_own_account_unless_told_another() {
        assert_eq!(debug_account(None), DEBUG_ACCOUNT);
        assert_eq!(debug_account(Some("")), DEBUG_ACCOUNT);
        assert_eq!(debug_account(Some("  ")), DEBUG_ACCOUNT);
        assert_eq!(debug_account(Some("sync-token-smoke")), "sync-token-smoke");
        assert_ne!(DEBUG_ACCOUNT, ACCOUNT);
        // Tests run as a debug build.
        if std::env::var_os(ACCOUNT_ENV).is_none() {
            assert_eq!(account(), DEBUG_ACCOUNT);
        }
    }

    /// What a stand-in entry answers for each operation.
    enum Answer {
        Ok,
        NoEntry,
        BadEncoding,
        Locked,
    }

    impl Answer {
        fn error(&self) -> Option<keyring::Error> {
            match self {
                Answer::Ok => None,
                Answer::NoEntry => Some(keyring::Error::NoEntry),
                Answer::BadEncoding => Some(keyring::Error::BadEncoding(vec![0x80])),
                Answer::Locked => Some(keyring::Error::NoStorageAccess(Box::new(
                    std::io::Error::other("locked"),
                ))),
            }
        }
    }

    /// An entry in memory that answers `answer` (its text when `Ok`) and records what it was asked.
    struct FakeEntry {
        text: RefCell<Option<String>>,
        answer: Answer,
        calls: RefCell<Vec<String>>,
    }

    impl FakeEntry {
        fn new(text: Option<&str>, answer: Answer) -> Self {
            Self {
                text: RefCell::new(text.map(str::to_owned)),
                answer,
                calls: RefCell::new(Vec::new()),
            }
        }
    }

    impl Secret for FakeEntry {
        fn read(&self) -> keyring::Result<String> {
            self.calls.borrow_mut().push("read".to_owned());
            if let Some(error) = self.answer.error() {
                return Err(error);
            }
            self.text.borrow().clone().ok_or(keyring::Error::NoEntry)
        }

        fn write(&self, text: &str) -> keyring::Result<()> {
            self.calls.borrow_mut().push(format!("write {text}"));
            if let Some(error) = self.answer.error() {
                return Err(error);
            }
            *self.text.borrow_mut() = Some(text.to_owned());
            Ok(())
        }

        fn erase(&self) -> keyring::Result<()> {
            self.calls.borrow_mut().push("erase".to_owned());
            if let Some(error) = self.answer.error() {
                return Err(error);
            }
            self.text
                .borrow_mut()
                .take()
                .map(|_| ())
                .ok_or(keyring::Error::NoEntry)
        }
    }

    #[test]
    fn load_reads_the_token_and_treats_anything_else_as_none() {
        let entry = FakeEntry::new(Some(r#"{"token":"abc","expiresAt":5}"#), Answer::Ok);
        assert_eq!(load(&entry), Ok(Some(token("abc", 5.0))));
        assert_eq!(load(&FakeEntry::new(None, Answer::Ok)), Ok(None));
        assert_eq!(load(&FakeEntry::new(Some("hunter2"), Answer::Ok)), Ok(None));
        assert_eq!(load(&FakeEntry::new(None, Answer::NoEntry)), Ok(None));
        assert_eq!(load(&FakeEntry::new(None, Answer::BadEncoding)), Ok(None));
    }

    #[test]
    fn a_store_that_cannot_be_read_fails_without_naming_the_token() {
        let entry = FakeEntry::new(Some(r#"{"token":"secret","expiresAt":5}"#), Answer::Locked);
        let error = load(&entry).expect_err("fails");
        assert!(error.starts_with("the credential store failed"), "{error}");
        assert!(!error.contains("secret"), "{error}");
        let error = store(&entry, &token("secret", 5.0)).expect_err("fails");
        assert!(!error.contains("secret"), "{error}");
        assert!(clear(&entry).is_err());
    }

    #[test]
    fn store_writes_the_encoded_token_and_refuses_an_invalid_one() {
        let entry = FakeEntry::new(Some("old"), Answer::Ok);
        store(&entry, &token("abc", 5.0)).expect("stores");
        assert_eq!(
            entry.text.borrow().as_deref(),
            Some(r#"{"token":"abc","expiresAt":5.0}"#)
        );
        assert!(store(&entry, &token("", 5.0)).is_err());
        // The invalid token never reached the store.
        assert_eq!(entry.calls.borrow().len(), 1);
    }

    #[test]
    fn clear_removes_the_entry_and_nothing_to_remove_is_fine() {
        let entry = FakeEntry::new(Some("text"), Answer::Ok);
        assert_eq!(clear(&entry), Ok(()));
        assert_eq!(entry.text.borrow().as_deref(), None);
        assert_eq!(clear(&entry), Ok(()));
        assert_eq!(*entry.calls.borrow(), vec!["erase", "erase"]);
    }

    /// The real store of this machine, on an account of its own (run with
    /// `cargo test -- --ignored`): a token stored is read back, replaced, and cleared.
    #[test]
    #[ignore = "uses the OS credential store"]
    fn the_os_store_keeps_and_forgets_a_token() {
        let entry = keyring::Entry::new(SERVICE, "sync-token-test").expect("a credential store");
        clear(&entry).expect("clears");
        assert_eq!(load(&entry), Ok(None));
        store(&entry, &token("first", EXPIRES)).expect("stores");
        assert_eq!(load(&entry), Ok(Some(token("first", EXPIRES))));
        store(&entry, &token("second", EXPIRES + 1.0)).expect("replaces");
        assert_eq!(load(&entry), Ok(Some(token("second", EXPIRES + 1.0))));
        clear(&entry).expect("clears");
        assert_eq!(load(&entry), Ok(None));
        assert_eq!(clear(&entry), Ok(()));
    }
}
