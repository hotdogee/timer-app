//! The always-on-top mini window (spec › Card, Mini window): one card in a small undecorated
//! window that floats above other apps.
//!
//! It is the same web app at `/mini?card=<id>`, which renders the card by itself and stays in step
//! with the main window through the shared store. At most one is open: opening it for another card
//! sends that card to the open window ([`MINI_CARD`]) instead. The window-state plugin remembers its
//! place by its label; it opens at [`MINI_SIZE`] each time (see [`MINI_RESTORED`] for why). Hiding
//! the main window to the tray leaves it open; quitting closes it. When it closes, however that
//! happened, the main window hears [`MINI_CLOSED`].

use std::fmt;

use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, WebviewUrl, WebviewWindow};
use tauri_plugin_window_state::{StateFlags, WindowExt};

use crate::MAIN_WINDOW;

/// The label of the mini window (`capabilities/mini.json` grants it its permissions).
pub const MINI_WINDOW: &str = "mini";

/// The event sent to the mini window when it is asked to show another card. Payload: the card's
/// id, a string.
pub const MINI_CARD: &str = "mini-card";

/// The event sent to the main window when the mini window has closed. No payload (`null`).
pub const MINI_CLOSED: &str = "mini-closed";

/// The longest card id accepted, as in the export file format (`core/export.ts`).
pub const MAX_CARD_ID_CHARS: usize = 256;

/// The mini window's size whenever it opens, in logical pixels (the user may resize it).
pub const MINI_SIZE: (f64, f64) = (320.0, 200.0);

/// The smallest size the mini window can be resized to, in logical pixels.
pub const MINI_MIN_SIZE: (f64, f64) = (240.0, 150.0);

/// What the mini window takes back from the window-state plugin when it opens: its position only.
/// Restoring the size of an undecorated window with a shadow before it is first shown makes it
/// one caption height taller each time (tao 0.37 measures the frame offsets of the hidden window
/// as if it had a caption), so it opens at [`MINI_SIZE`] instead.
pub const MINI_RESTORED: StateFlags = StateFlags::POSITION;

/// Why a card id cannot be shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardIdError {
    /// The id is empty.
    Empty,
    /// The id is longer than [`MAX_CARD_ID_CHARS`].
    TooLong,
}

impl fmt::Display for CardIdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CardIdError::Empty => f.write_str("the card id is empty"),
            CardIdError::TooLong => {
                write!(
                    f,
                    "the card id is longer than {MAX_CARD_ID_CHARS} characters"
                )
            }
        }
    }
}

impl std::error::Error for CardIdError {}

/// Checks that `card` can be a card id: 1 to [`MAX_CARD_ID_CHARS`] characters.
pub fn check_card_id(card: &str) -> Result<(), CardIdError> {
    if card.is_empty() {
        Err(CardIdError::Empty)
    } else if card.chars().count() > MAX_CARD_ID_CHARS {
        Err(CardIdError::TooLong)
    } else {
        Ok(())
    }
}

/// Percent-encodes `value` for a URL query component: every byte of its UTF-8 form except the
/// unreserved characters (`A-Z a-z 0-9 - . _ ~`) becomes `%XX`. `URLSearchParams` decodes it back.
pub fn encode_query_value(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// The app path the mini window opens for card `card`: `/mini?card=<id>`, the id percent-encoded.
pub fn mini_path(card: &str) -> Result<String, CardIdError> {
    check_card_id(card)?;
    Ok(format!("/mini?card={}", encode_query_value(card)))
}

/// Switches the open mini window to `card`, applies `always_on_top` and brings it to the front.
fn switch<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    card: String,
    always_on_top: bool,
) -> Result<(), String> {
    app.emit_to(EventTarget::webview_window(MINI_WINDOW), MINI_CARD, card)
        .map_err(|error| format!("could not switch the mini window's card: {error}"))?;
    // Best effort: the card has switched, which is what matters.
    let _ = window.set_always_on_top(always_on_top);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// Command `open_mini`, payload `{ card: string, alwaysOnTop: boolean }`: opens the mini window on
/// card `card`, floating above other apps when `alwaysOnTop`; if it is open already, switches it
/// to that card ([`MINI_CARD`]), applies `alwaysOnTop` and focuses it. Rejects with a message (a
/// string) for an empty or overlong id, or when the window cannot be created.
///
/// Async because creating a window from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn open_mini<R: Runtime>(
    app: AppHandle<R>,
    card: String,
    always_on_top: bool,
) -> Result<(), String> {
    let path = mini_path(&card).map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window(MINI_WINDOW) {
        return switch(&app, &window, card, always_on_top);
    }
    // Created hidden, so that it moves to its saved place before it first appears. The plugin
    // skips its own restore for this window (`skip_initial_state` in `run`); see `MINI_RESTORED`.
    let built = tauri::WebviewWindowBuilder::new(&app, MINI_WINDOW, WebviewUrl::App(path.into()))
        .title("Timer App")
        // The page titles itself after its card, in the app language ("Tea – Mini window"); the
        // native title is what Alt+Tab and screen readers announce.
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .inner_size(MINI_SIZE.0, MINI_SIZE.1)
        .min_inner_size(MINI_MIN_SIZE.0, MINI_MIN_SIZE.1)
        .resizable(true)
        .decorations(false)
        .always_on_top(always_on_top)
        .skip_taskbar(true)
        .visible(false)
        .focused(true)
        .build();
    match built {
        Ok(window) => {
            // On the main thread: restoring holds the plugin's cache lock while it asks the main
            // thread for the monitors, and the main thread takes that lock when it reports the
            // new window to the plugin, so restoring from this thread can deadlock.
            let shown = window.clone();
            window
                .run_on_main_thread(move || {
                    let _ = shown.restore_state(MINI_RESTORED);
                    let _ = shown.show();
                    let _ = shown.set_focus();
                })
                .map_err(|error| format!("could not show the mini window: {error}"))
        }
        // Another call may have opened it meanwhile.
        Err(error) => match app.get_webview_window(MINI_WINDOW) {
            Some(window) => switch(&app, &window, card, always_on_top),
            None => Err(format!("could not open the mini window: {error}")),
        },
    }
}

/// Command `close_mini`, no payload: closes the mini window if it is open. Rejects with a message
/// (a string) when closing fails.
#[tauri::command]
pub fn close_mini<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    match app.get_webview_window(MINI_WINDOW) {
        Some(window) => window
            .close()
            .map_err(|error| format!("could not close the mini window: {error}")),
        None => Ok(()),
    }
}

/// Command `set_mini_always_on_top`, payload `{ flag: boolean }`: makes the open mini window float
/// above other apps or not; does nothing when it is closed. Rejects with a message (a string) when
/// the OS refuses.
#[tauri::command]
pub fn set_mini_always_on_top<R: Runtime>(app: AppHandle<R>, flag: bool) -> Result<(), String> {
    match app.get_webview_window(MINI_WINDOW) {
        Some(window) => window
            .set_always_on_top(flag)
            .map_err(|error| format!("could not change the mini window: {error}")),
        None => Ok(()),
    }
}

/// Tells the main window that the mini window has closed (window event `Destroyed`).
pub fn on_destroyed<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit_to(EventTarget::webview_window(MAIN_WINDOW), MINI_CLOSED, ());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_mini_path_for_a_uuid_unchanged() {
        assert_eq!(
            mini_path("0f8fad5b-d9cb-469f-a165-70867728950e"),
            Ok("/mini?card=0f8fad5b-d9cb-469f-a165-70867728950e".into())
        );
    }

    #[test]
    fn percent_encodes_everything_but_unreserved_characters() {
        assert_eq!(encode_query_value("AZaz09-._~"), "AZaz09-._~");
        assert_eq!(encode_query_value("a b&c=d"), "a%20b%26c%3Dd");
        assert_eq!(encode_query_value("#?/%+"), "%23%3F%2F%25%2B");
        assert_eq!(encode_query_value("é"), "%C3%A9");
        assert_eq!(encode_query_value("茶"), "%E8%8C%B6");
        assert_eq!(encode_query_value("\n"), "%0A");
        assert_eq!(encode_query_value(""), "");
    }

    #[test]
    fn rejects_empty_and_overlong_ids() {
        assert_eq!(mini_path(""), Err(CardIdError::Empty));
        let longest = "x".repeat(MAX_CARD_ID_CHARS);
        assert!(mini_path(&longest).is_ok());
        assert_eq!(mini_path(&format!("{longest}x")), Err(CardIdError::TooLong));
        // Characters, not bytes, count.
        assert!(check_card_id(&"茶".repeat(MAX_CARD_ID_CHARS)).is_ok());
    }

    #[test]
    fn accepts_any_other_id_the_export_format_allows() {
        assert_eq!(mini_path(" "), Ok("/mini?card=%20".into()));
        assert_eq!(
            mini_path("card?x=1#y"),
            Ok("/mini?card=card%3Fx%3D1%23y".into())
        );
    }

    #[test]
    fn explains_rejected_ids() {
        assert_eq!(CardIdError::Empty.to_string(), "the card id is empty");
        assert_eq!(
            CardIdError::TooLong.to_string(),
            "the card id is longer than 256 characters"
        );
    }
}
