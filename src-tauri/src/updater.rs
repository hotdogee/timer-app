//! Whether this build can update itself. The updater plugin is always registered, but a build
//! whose `tauri.conf.json` still has the placeholder public key (every build until the owner adds
//! the updater key, docs/release.md › Updater key) cannot verify an update, so the webview does
//! not offer one.

use serde_json::Value;
use tauri::{AppHandle, Runtime};

/// The public key `tauri.conf.json` carries until the owner adds the real one.
pub const PUBKEY_PLACEHOLDER: &str = "UPDATER_PUBKEY_PLACEHOLDER";

/// Whether the updater plugin's configuration (`plugins.updater` in `tauri.conf.json`) can find
/// and verify updates: a public key that is neither blank nor [`PUBKEY_PLACEHOLDER`], and at least
/// one endpoint.
pub fn is_configured(updater: Option<&Value>) -> bool {
    let Some(updater) = updater else {
        return false;
    };
    let has_key = updater
        .get("pubkey")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|key| !key.is_empty() && key != PUBKEY_PLACEHOLDER);
    let has_endpoint = updater
        .get("endpoints")
        .and_then(Value::as_array)
        .is_some_and(|endpoints| !endpoints.is_empty());
    has_key && has_endpoint
}

/// Command `updater_configured`, no payload: whether this build can check for updates (see
/// [`is_configured`]); always false on mobile, which has no updater. Never rejects.
#[tauri::command]
pub fn updater_configured<R: Runtime>(app: AppHandle<R>) -> bool {
    cfg!(desktop) && is_configured(app.config().plugins.0.get("updater"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ENDPOINT: &str =
        "https://github.com/hotdogee/timer-app/releases/latest/download/latest.json";

    #[test]
    fn a_real_key_and_an_endpoint_are_configured() {
        let config =
            json!({ "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWdu", "endpoints": [ENDPOINT] });
        assert!(is_configured(Some(&config)));
    }

    #[test]
    fn the_placeholder_or_a_blank_key_is_not() {
        for key in [
            PUBKEY_PLACEHOLDER,
            "",
            "   ",
            " UPDATER_PUBKEY_PLACEHOLDER ",
        ] {
            let config = json!({ "pubkey": key, "endpoints": [ENDPOINT] });
            assert!(!is_configured(Some(&config)), "{key:?}");
        }
    }

    #[test]
    fn missing_or_malformed_parts_are_not() {
        assert!(!is_configured(None));
        assert!(!is_configured(Some(&json!(null))));
        assert!(!is_configured(Some(&json!({ "endpoints": [ENDPOINT] }))));
        assert!(!is_configured(Some(
            &json!({ "pubkey": 42, "endpoints": [ENDPOINT] })
        )));
        assert!(!is_configured(Some(&json!({ "pubkey": "key" }))));
        assert!(!is_configured(Some(
            &json!({ "pubkey": "key", "endpoints": [] })
        )));
        assert!(!is_configured(Some(
            &json!({ "pubkey": "key", "endpoints": ENDPOINT })
        )));
    }

    #[test]
    fn this_repository_config_has_an_updater_key() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json is valid JSON");
        let updater = config.pointer("/plugins/updater");
        assert!(updater.is_some(), "tauri.conf.json configures the updater");
        assert!(
            is_configured(updater),
            "plugins.updater.pubkey holds the release key (docs/release.md › Updater key)"
        );
    }
}
