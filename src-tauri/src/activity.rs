//! What closing the main window does (spec › Persistence and instances › Desktop, Q11).
//!
//! The shell cannot see the cards, so the webview reports two facts: whether any card is running
//! or ringing (`set_running`, on every change) and the Settings › Desktop close behavior
//! (`set_close_behavior`, at startup and on every change). When the main window is asked to close,
//! [`AppState::hides_on_close`] decides between hiding it to the tray, where alarms keep ringing,
//! and quitting the app. An open mini window counts as something going on: closing the main window
//! never takes a floating card away with it (only quitting does). Until the webview reports,
//! nothing runs and the default behavior applies.

use std::fmt;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::State;

/// The Settings › Desktop close behavior, as the webview names it (`core/settings.ts`
/// `CloseBehavior`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CloseBehavior {
    /// `tray-while-running` (the default, Q11): hide to the tray while a card runs or rings, or
    /// the mini window is open; else quit.
    #[default]
    TrayWhileRunning,
    /// `tray`: always hide to the tray; the tray menu's Quit quits.
    Tray,
    /// `quit`: always quit.
    Quit,
}

impl CloseBehavior {
    /// Every behavior, in the settings' display order.
    pub const ALL: [CloseBehavior; 3] = [
        CloseBehavior::TrayWhileRunning,
        CloseBehavior::Tray,
        CloseBehavior::Quit,
    ];

    /// The name the webview uses for this behavior.
    pub fn as_str(self) -> &'static str {
        match self {
            CloseBehavior::TrayWhileRunning => "tray-while-running",
            CloseBehavior::Tray => "tray",
            CloseBehavior::Quit => "quit",
        }
    }
}

impl fmt::Display for CloseBehavior {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The error for a close behavior name that [`CloseBehavior`] does not know.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownCloseBehavior(pub String);

impl fmt::Display for UnknownCloseBehavior {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown close behavior {:?}", self.0)
    }
}

impl std::error::Error for UnknownCloseBehavior {}

impl FromStr for CloseBehavior {
    type Err = UnknownCloseBehavior;

    /// Parses the webview's name for a behavior, exactly (no trimming, case-sensitive).
    fn from_str(name: &str) -> Result<Self, Self::Err> {
        CloseBehavior::ALL
            .into_iter()
            .find(|behavior| behavior.as_str() == name)
            .ok_or_else(|| UnknownCloseBehavior(name.to_owned()))
    }
}

/// Whether closing the main window hides it to the tray (true) or quits the app (false), given
/// the close behavior, whether any card is running or ringing, and whether the mini window is open
/// (quitting would close it).
pub fn should_hide(behavior: CloseBehavior, running: bool, mini_open: bool) -> bool {
    match behavior {
        CloseBehavior::TrayWhileRunning => running || mini_open,
        CloseBehavior::Tray => true,
        CloseBehavior::Quit => false,
    }
}

/// What the shell knows about the app, shared by the commands and the window events
/// (`app.manage`d once at startup).
#[derive(Debug, Default)]
pub struct AppState {
    running: AtomicBool,
    close_behavior: Mutex<CloseBehavior>,
    tray_ready: AtomicBool,
}

impl AppState {
    /// Records whether any card is running or ringing.
    pub fn set_running(&self, running: bool) {
        self.running.store(running, Ordering::Relaxed);
    }

    /// Whether any card is running or ringing, as last reported.
    pub fn running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Records the close behavior setting.
    pub fn set_close_behavior(&self, behavior: CloseBehavior) {
        // A poisoned lock still holds a valid value: a `CloseBehavior` is replaced whole.
        *self
            .close_behavior
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = behavior;
    }

    /// The close behavior setting, as last reported (the default until then).
    pub fn close_behavior(&self) -> CloseBehavior {
        *self
            .close_behavior
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Records whether the tray icon exists, the only way back to a hidden window.
    pub fn set_tray_ready(&self, ready: bool) {
        self.tray_ready.store(ready, Ordering::Relaxed);
    }

    /// Whether the tray icon exists.
    pub fn tray_ready(&self) -> bool {
        self.tray_ready.load(Ordering::Relaxed)
    }

    /// Whether closing the main window should hide it rather than quit: [`should_hide`] for the
    /// reported state and `mini_open` (whether the mini window is open), and never without a tray
    /// icon, which would leave the app running with no way to bring the window back.
    pub fn hides_on_close(&self, mini_open: bool) -> bool {
        self.tray_ready() && should_hide(self.close_behavior(), self.running(), mini_open)
    }
}

/// Command `set_running`, payload `{ running: boolean }`: the webview reports whether any card is
/// running or ringing. Call it from the main window on every change.
#[tauri::command]
pub fn set_running(state: State<'_, AppState>, running: bool) {
    state.set_running(running);
}

/// Command `set_close_behavior`, payload `{ behavior: 'tray-while-running' | 'tray' | 'quit' }`:
/// the webview reports the close behavior setting. Rejects with a message (a string) for any
/// other name and keeps the previous behavior.
#[tauri::command]
pub fn set_close_behavior(state: State<'_, AppState>, behavior: String) -> Result<(), String> {
    let behavior = behavior
        .parse::<CloseBehavior>()
        .map_err(|error| error.to_string())?;
    state.set_close_behavior(behavior);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_while_running_hides_only_while_something_runs() {
        assert!(should_hide(CloseBehavior::TrayWhileRunning, true, false));
        assert!(!should_hide(CloseBehavior::TrayWhileRunning, false, false));
    }

    #[test]
    fn tray_while_running_keeps_an_open_mini_window() {
        assert!(should_hide(CloseBehavior::TrayWhileRunning, false, true));
        assert!(should_hide(CloseBehavior::TrayWhileRunning, true, true));
    }

    #[test]
    fn tray_always_hides() {
        for (running, mini_open) in [(true, false), (false, false), (false, true), (true, true)] {
            assert!(should_hide(CloseBehavior::Tray, running, mini_open));
        }
    }

    #[test]
    fn quit_never_hides() {
        for (running, mini_open) in [(true, false), (false, false), (false, true), (true, true)] {
            assert!(!should_hide(CloseBehavior::Quit, running, mini_open));
        }
    }

    #[test]
    fn the_default_is_tray_while_running() {
        assert_eq!(CloseBehavior::default(), CloseBehavior::TrayWhileRunning);
    }

    #[test]
    fn parses_every_webview_name_and_round_trips() {
        assert_eq!(
            "tray-while-running".parse(),
            Ok(CloseBehavior::TrayWhileRunning)
        );
        assert_eq!("tray".parse(), Ok(CloseBehavior::Tray));
        assert_eq!("quit".parse(), Ok(CloseBehavior::Quit));
        for behavior in CloseBehavior::ALL {
            assert_eq!(behavior.as_str().parse(), Ok(behavior));
            assert_eq!(behavior.to_string(), behavior.as_str());
        }
    }

    #[test]
    fn rejects_unknown_names_exactly() {
        for name in ["", "Tray", " tray", "tray ", "hide", "tray_while_running"] {
            assert_eq!(
                name.parse::<CloseBehavior>(),
                Err(UnknownCloseBehavior(name.to_owned()))
            );
        }
        assert_eq!(
            UnknownCloseBehavior("hide".into()).to_string(),
            "unknown close behavior \"hide\""
        );
    }

    #[test]
    fn a_fresh_state_reports_nothing_running_and_the_default_behavior() {
        let state = AppState::default();
        assert!(!state.running());
        assert_eq!(state.close_behavior(), CloseBehavior::TrayWhileRunning);
        assert!(!state.tray_ready());
    }

    #[test]
    fn the_state_follows_the_reports() {
        let state = AppState::default();
        state.set_tray_ready(true);
        assert!(!state.hides_on_close(false));
        assert!(state.hides_on_close(true));

        state.set_running(true);
        assert!(state.running());
        assert!(state.hides_on_close(false));

        state.set_close_behavior(CloseBehavior::Quit);
        assert_eq!(state.close_behavior(), CloseBehavior::Quit);
        assert!(!state.hides_on_close(false));
        assert!(!state.hides_on_close(true));

        state.set_close_behavior(CloseBehavior::Tray);
        state.set_running(false);
        assert!(state.hides_on_close(false));
    }

    #[test]
    fn never_hides_without_a_tray_icon() {
        let state = AppState::default();
        state.set_close_behavior(CloseBehavior::Tray);
        state.set_running(true);
        assert!(!state.hides_on_close(true));
        state.set_tray_ready(true);
        assert!(state.hides_on_close(true));
    }
}
