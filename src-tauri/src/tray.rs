//! The tray icon (the menu bar on macOS), the way back to a main window hidden by closing it.
//!
//! A left click shows and focuses the main window; the menu (right click) has "Show Timer App",
//! "Start or pause the last card" ([`TRAY_TOGGLE_LAST`] to the main window, which runs the same
//! action as the global hotkey) and "Quit". Linux has no click events: the icon only opens the
//! menu there. The labels are English until the webview sends them in the app's language
//! (`set_tray_labels`).

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};

use crate::{show_main_window, MAIN_WINDOW};

/// The tray icon's id.
pub const TRAY_ID: &str = "main";

/// The tray icon's tooltip: the product name, never translated.
pub const TOOLTIP: &str = "Timer App";

/// The event sent to the main window when the menu's "Start or pause the last card" is chosen. No
/// payload (`null`).
pub const TRAY_TOGGLE_LAST: &str = "tray-toggle-last";

/// The longest menu label accepted from the webview, in characters.
pub const MAX_LABEL_CHARS: usize = 64;

/// What a tray menu item does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    /// Show and focus the main window.
    Show,
    /// Start or pause the last-used card (in the webview).
    ToggleLast,
    /// Quit the app.
    Quit,
}

impl TrayAction {
    /// Every action, in menu order.
    pub const ALL: [TrayAction; 3] = [TrayAction::Show, TrayAction::ToggleLast, TrayAction::Quit];

    /// The menu item id of this action.
    pub fn id(self) -> &'static str {
        match self {
            TrayAction::Show => "show",
            TrayAction::ToggleLast => "toggle-last",
            TrayAction::Quit => "quit",
        }
    }

    /// The action of menu item `id`, if it is one of the tray's.
    pub fn from_id(id: &str) -> Option<TrayAction> {
        TrayAction::ALL.into_iter().find(|action| action.id() == id)
    }
}

/// Whether a click on the tray icon shows the main window: a left click, on release.
pub fn shows_main_on(button: MouseButton, state: MouseButtonState) -> bool {
    button == MouseButton::Left && state == MouseButtonState::Up
}

/// The tray menu's labels, in the app's language (payload of `set_tray_labels`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    /// "Show Timer App".
    pub show: String,
    /// "Start or pause the last card".
    pub toggle_last: String,
    /// "Quit".
    pub quit: String,
}

impl Default for TrayLabels {
    /// The English labels, shown until the webview sends its own.
    fn default() -> Self {
        Self {
            show: "Show Timer App".into(),
            toggle_last: "Start or pause the last card".into(),
            quit: "Quit".into(),
        }
    }
}

impl TrayLabels {
    /// Checks every label: not blank, at most [`MAX_LABEL_CHARS`] characters, no control
    /// characters. The message names the first bad label.
    pub fn check(&self) -> Result<(), String> {
        for (name, label) in [
            ("show", &self.show),
            ("toggleLast", &self.toggle_last),
            ("quit", &self.quit),
        ] {
            if label.trim().is_empty() {
                return Err(format!("the {name} label is blank"));
            }
            if label.chars().count() > MAX_LABEL_CHARS {
                return Err(format!(
                    "the {name} label is longer than {MAX_LABEL_CHARS} characters"
                ));
            }
            if label.chars().any(char::is_control) {
                return Err(format!("the {name} label has a control character"));
            }
        }
        Ok(())
    }
}

/// A label as menu text: `&` marks a mnemonic in menu text, so a literal one is doubled.
pub fn menu_text(label: &str) -> String {
    label.replace('&', "&&")
}

/// The menu items whose labels `set_tray_labels` changes (managed state).
struct TrayMenu<R: Runtime> {
    show: MenuItem<R>,
    toggle_last: MenuItem<R>,
    quit: MenuItem<R>,
}

fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match TrayAction::from_id(id) {
        Some(TrayAction::Show) => show_main_window(app),
        Some(TrayAction::ToggleLast) => {
            let _ = app.emit_to(
                EventTarget::webview_window(MAIN_WINDOW),
                TRAY_TOGGLE_LAST,
                (),
            );
        }
        Some(TrayAction::Quit) => app.exit(0),
        None => {}
    }
}

/// Creates the tray icon with its menu. Call it once, in `setup`. On failure (a Linux desktop
/// without a tray, say) the app runs without one, and closing the main window quits.
pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let labels = TrayLabels::default();
    let item = |action: TrayAction, label: &str| {
        MenuItem::with_id(app, action.id(), menu_text(label), true, None::<&str>)
    };
    let show = item(TrayAction::Show, &labels.show)?;
    let toggle_last = item(TrayAction::ToggleLast, &labels.toggle_last)?;
    let quit = item(TrayAction::Quit, &labels.quit)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &toggle_last,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(TOOLTIP)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if shows_main_on(button, button_state) {
                    show_main_window(tray.app_handle());
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayMenu {
        show,
        toggle_last,
        quit,
    });
    Ok(())
}

/// Command `set_tray_labels`, payload `{ labels: { show: string, toggleLast: string, quit: string
/// } }`: the tray menu's labels in the app's language; send them at startup and whenever the
/// language changes. Rejects with a message (a string) for a blank, overlong or control-character
/// label and changes nothing then. Does nothing when there is no tray icon.
#[tauri::command]
pub fn set_tray_labels<R: Runtime>(app: AppHandle<R>, labels: TrayLabels) -> Result<(), String> {
    labels.check()?;
    let Some(menu) = app.try_state::<TrayMenu<R>>() else {
        return Ok(());
    };
    for (item, label) in [
        (&menu.show, &labels.show),
        (&menu.toggle_last, &labels.toggle_last),
        (&menu.quit, &labels.quit),
    ] {
        item.set_text(menu_text(label))
            .map_err(|error| format!("could not relabel the tray menu: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_every_menu_id_to_its_action_and_back() {
        assert_eq!(TrayAction::from_id("show"), Some(TrayAction::Show));
        assert_eq!(
            TrayAction::from_id("toggle-last"),
            Some(TrayAction::ToggleLast)
        );
        assert_eq!(TrayAction::from_id("quit"), Some(TrayAction::Quit));
        for action in TrayAction::ALL {
            assert_eq!(TrayAction::from_id(action.id()), Some(action));
        }
    }

    #[test]
    fn ignores_ids_that_are_not_the_trays() {
        for id in ["", "Show", "QUIT", "toggle_last", "about"] {
            assert_eq!(TrayAction::from_id(id), None, "{id}");
        }
    }

    #[test]
    fn only_a_released_left_click_shows_the_window() {
        assert!(shows_main_on(MouseButton::Left, MouseButtonState::Up));
        assert!(!shows_main_on(MouseButton::Left, MouseButtonState::Down));
        for button in [MouseButton::Right, MouseButton::Middle] {
            for state in [MouseButtonState::Up, MouseButtonState::Down] {
                assert!(!shows_main_on(button, state));
            }
        }
    }

    #[test]
    fn the_default_labels_are_english_and_valid() {
        let labels = TrayLabels::default();
        assert_eq!(labels.show, "Show Timer App");
        assert_eq!(labels.toggle_last, "Start or pause the last card");
        assert_eq!(labels.quit, "Quit");
        assert_eq!(labels.check(), Ok(()));
    }

    #[test]
    fn accepts_translated_labels() {
        let labels = TrayLabels {
            show: "顯示 Timer App".into(),
            toggle_last: "開始或暫停上一張卡片".into(),
            quit: "結束".into(),
        };
        assert_eq!(labels.check(), Ok(()));
    }

    #[test]
    fn rejects_blank_overlong_and_control_character_labels() {
        let with = |show: &str| TrayLabels {
            show: show.into(),
            ..TrayLabels::default()
        };
        assert_eq!(with("").check(), Err("the show label is blank".into()));
        assert_eq!(
            with("  \u{3000}").check(),
            Err("the show label is blank".into())
        );
        assert!(with(&"x".repeat(MAX_LABEL_CHARS)).check().is_ok());
        assert_eq!(
            with(&"x".repeat(MAX_LABEL_CHARS + 1)).check(),
            Err("the show label is longer than 64 characters".into())
        );
        assert_eq!(
            with("Show\nTimer").check(),
            Err("the show label has a control character".into())
        );
        let quit = TrayLabels {
            quit: String::new(),
            ..TrayLabels::default()
        };
        assert_eq!(quit.check(), Err("the quit label is blank".into()));
        let toggle = TrayLabels {
            toggle_last: "\t".into(),
            ..TrayLabels::default()
        };
        assert_eq!(toggle.check(), Err("the toggleLast label is blank".into()));
    }

    #[test]
    fn reads_the_webview_payload_in_camel_case() {
        let labels: TrayLabels = serde_json::from_str(
            r#"{ "show": "表示", "toggleLast": "開始/一時停止", "quit": "終了" }"#,
        )
        .expect("valid labels");
        assert_eq!(labels.toggle_last, "開始/一時停止");
        assert!(serde_json::from_str::<TrayLabels>(r#"{ "show": "x", "quit": "y" }"#).is_err());
    }

    #[test]
    fn doubles_ampersands_so_they_show() {
        assert_eq!(menu_text("Tom & Jerry"), "Tom && Jerry");
        assert_eq!(menu_text("Quit"), "Quit");
    }
}
