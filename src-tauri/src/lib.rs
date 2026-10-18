//! Tauri shell for Timer App. The web UI in `src/` does all the work; the shell adds what a
//! browser cannot: one instance, a remembered window, a tray icon that keeps the app (and its
//! alarms) running with the window closed, system notifications, global hotkeys, launch at login,
//! self-update, the OS accent color, an always-on-top mini window, opening the system browser and
//! keeping the sign-in token in the OS credential store. See docs/tech-stack.md.
//!
//! The webview talks to the shell through these commands (payload keys are camelCase):
//!
//! | Command | Payload | Result |
//! |---|---|---|
//! | `accent_color` | none | `#rrggbb` or `null` ([`accent`]) |
//! | `set_running` | `{ running }` | none ([`activity`]) |
//! | `set_close_behavior` | `{ behavior }` | rejects for an unknown name ([`activity`]) |
//! | `open_mini` | `{ card, alwaysOnTop }` | rejects when it cannot open ([`mini`]) |
//! | `close_mini` | none | ([`mini`]) |
//! | `set_mini_always_on_top` | `{ flag }` | ([`mini`]) |
//! | `set_tray_labels` | `{ labels: { show, toggleLast, quit } }` | ([`tray`]) |
//! | `quote_launch_entry` | none | boolean ([`autostart`]) |
//! | `updater_configured` | none | boolean ([`updater`]) |
//! | `token_get` | none | `{ token, expiresAt }` or `null`; rejects when the store fails ([`token_store`]) |
//! | `token_set` | `{ auth: { token, expiresAt } }` | rejects when the store fails ([`token_store`]) |
//! | `token_clear` | none | rejects when the store fails ([`token_store`]) |
//! | `smoke_mark` | `{ message }` | none; debug builds only ([`smoke`]) |
//!
//! and these events: `accent-changed` (to every window), `tray-toggle-last` and `mini-closed`
//! (to the main window), `mini-card` (to the mini window).
//!
//! Each window may call only the commands its capability grants (`build.rs` declares them as the
//! app's permissions, `allow-<command>`): the main window all of them, the mini window
//! `accent_color`, `close_mini` and `set_mini_always_on_top`. The grant of `smoke_mark` sits in
//! `capabilities/debug/`, which only debug builds read.

pub mod accent;
pub mod activity;
#[cfg(desktop)]
pub mod autostart;
#[cfg(desktop)]
pub mod mini;
#[cfg(debug_assertions)]
pub mod smoke;
#[cfg(desktop)]
pub mod token_store;
#[cfg(desktop)]
pub mod tray;
pub mod updater;

use tauri::{AppHandle, Manager, RunEvent, Runtime};

use activity::AppState;

/// The label of the main window, as `tauri.conf.json` names it.
pub const MAIN_WINDOW: &str = "main";

/// The argument that starts the app hidden to the tray. Launch at login passes it.
pub const MINIMIZED_ARG: &str = "--minimized";

/// Shows the main window, restores it if it is minimized and gives it the
/// focus. Does nothing if the window does not exist (yet).
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        // Each step is best effort: a window that cannot be unminimized or
        // focused is still better shown than not.
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Whether the process arguments `args` (the program path first, as `std::env::args` gives them)
/// ask to start hidden to the tray: one of them is exactly [`MINIMIZED_ARG`].
pub fn starts_minimized(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == MINIMIZED_ARG)
}

/// What closing the main window does, and what the mini window's closing tells the main one.
#[cfg(desktop)]
fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    match (window.label(), event) {
        (MAIN_WINDOW, tauri::WindowEvent::CloseRequested { api, .. }) => {
            // Quitting would close the mini window too, so an open one keeps the app running.
            let mini_open = window
                .app_handle()
                .get_webview_window(mini::MINI_WINDOW)
                .is_some();
            if window.state::<AppState>().hides_on_close(mini_open) {
                api.prevent_close();
                if window.hide().is_err() {
                    // A window that cannot hide must not stay open with the app pretending it
                    // is in the tray: quit as the close asked.
                    window.app_handle().exit(0);
                }
            } else {
                // Quit rather than only close: nothing is left to keep the app running.
                window.app_handle().exit(0);
            }
        }
        (mini::MINI_WINDOW, tauri::WindowEvent::Destroyed) => {
            mini::on_destroyed(window.app_handle())
        }
        _ => {}
    }
}

/// Runs once the main window exists (hidden, and already moved to its saved place by the
/// window-state plugin): creates the tray icon, starts following the accent color, quotes a
/// launch-at-login entry an earlier build left unquoted, and shows the main window unless the app
/// was started with [`MINIMIZED_ARG`] (and has a tray to be in).
fn setup<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(desktop)]
    match tray::create(app) {
        Ok(()) => app.state::<AppState>().set_tray_ready(true),
        Err(error) => eprintln!("timer-app: no tray icon, so closing the window quits: {error}"),
    }
    accent::watch(app);
    #[cfg(desktop)]
    autostart::repair(app);

    let args: Vec<String> = std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let in_tray = app.state::<AppState>().tray_ready();
    if !(in_tray && starts_minimized(&args)) {
        show_main_window(app);
    }
}

/// Handles app-level events: on macOS, clicking the Dock icon while the window is hidden shows it.
fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: RunEvent) {
    #[cfg(target_os = "macos")]
    if let RunEvent::Reopen {
        has_visible_windows: false,
        ..
    } = event
    {
        show_main_window(app);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

/// Builds and runs the Tauri application. Shared entry point for the desktop
/// binary (`main.rs`) and, later, the mobile targets.
///
/// The main window is created hidden (`visible: false` in `tauri.conf.json`)
/// so that the window-state plugin can move it to its saved place before it
/// first appears; `setup` then shows it.
///
/// Panics if the Tauri runtime fails to start, since there is nothing to fall back to.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Single instance must come first: a second launch hands over to the
    // running app before any other plugin starts.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // Position, size, maximized and so on, but not visibility: the
                // app decides whether the window shows (it starts hidden to
                // the tray when launched at login).
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                // The mini window restores its position itself (see `mini::open_mini`).
                .skip_initial_state(mini::MINI_WINDOW)
                .build(),
        );

    let builder = builder.plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![MINIMIZED_ARG]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build());

    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default());

    #[cfg(desktop)]
    let builder = builder.on_window_event(on_window_event);

    let app = builder
        .invoke_handler(tauri::generate_handler![
            accent::accent_color,
            activity::set_running,
            activity::set_close_behavior,
            #[cfg(desktop)]
            mini::open_mini,
            #[cfg(desktop)]
            mini::close_mini,
            #[cfg(desktop)]
            mini::set_mini_always_on_top,
            #[cfg(desktop)]
            tray::set_tray_labels,
            #[cfg(desktop)]
            autostart::quote_launch_entry,
            updater::updater_configured,
            #[cfg(desktop)]
            token_store::token_get,
            #[cfg(desktop)]
            token_store::token_set,
            #[cfg(desktop)]
            token_store::token_clear,
            #[cfg(debug_assertions)]
            smoke::smoke_mark,
        ])
        .setup(|app| {
            setup(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(on_run_event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| (*arg).to_owned()).collect()
    }

    #[test]
    fn starts_minimized_only_when_asked() {
        assert!(!starts_minimized(&args(&[])));
        assert!(!starts_minimized(&args(&["timer-app.exe"])));
        assert!(starts_minimized(&args(&["timer-app.exe", "--minimized"])));
        assert!(starts_minimized(&args(&[
            "timer-app",
            "--flag",
            "--minimized",
            "x"
        ])));
    }

    #[test]
    fn the_program_path_and_near_misses_do_not_count() {
        assert!(!starts_minimized(&args(&["--minimized"])));
        for near in [
            "--minimized=1",
            "--MINIMIZED",
            "-minimized",
            "minimized",
            " --minimized",
        ] {
            assert!(!starts_minimized(&args(&["timer-app", near])), "{near}");
        }
    }

    fn json(text: &str) -> Value {
        serde_json::from_str(text).expect("valid JSON")
    }

    #[test]
    fn the_config_names_the_main_window_and_starts_it_hidden() {
        let config = json(include_str!("../tauri.conf.json"));
        let window = config.pointer("/app/windows/0").expect("a window");
        assert_eq!(window["label"], MAIN_WINDOW);
        assert_eq!(window["visible"], false);
    }

    const MAIN_CAPABILITY: &str = include_str!("../capabilities/default.json");
    const MINI_CAPABILITY: &str = include_str!("../capabilities/mini.json");
    const SMOKE_CAPABILITY: &str = include_str!("../capabilities/debug/smoke.json");

    /// The permission identifiers a capability grants.
    fn granted(capability: &str) -> Vec<String> {
        let capability = json(capability);
        capability["permissions"]
            .as_array()
            .expect("permissions")
            .iter()
            .map(|permission| {
                permission
                    .as_str()
                    .or_else(|| permission["identifier"].as_str())
                    .expect("a permission identifier")
                    .to_owned()
            })
            .collect()
    }

    /// The app permission that allows `command` (as `build.rs` declares them).
    fn allow(command: &str) -> String {
        format!("allow-{}", command.replace('_', "-"))
    }

    #[test]
    fn each_capability_applies_to_its_own_window() {
        let main = json(MAIN_CAPABILITY);
        assert_eq!(main["windows"], serde_json::json!([MAIN_WINDOW]));
        let mini = json(MINI_CAPABILITY);
        assert_eq!(mini["windows"], serde_json::json!([mini::MINI_WINDOW]));
        let smoke = json(SMOKE_CAPABILITY);
        assert_eq!(smoke["windows"], serde_json::json!([MAIN_WINDOW]));
    }

    #[test]
    fn no_capability_grants_a_wildcard_permission() {
        for capability in [MAIN_CAPABILITY, MINI_CAPABILITY, SMOKE_CAPABILITY] {
            for id in granted(capability) {
                assert!(!id.contains('*'), "{id}");
                assert!(!id.ends_with(":allow-all"), "{id}");
            }
        }
    }

    #[test]
    fn the_main_window_may_call_every_command_but_the_smoke_hook() {
        let main = granted(MAIN_CAPABILITY);
        for command in [
            "accent_color",
            "set_running",
            "set_close_behavior",
            "open_mini",
            "close_mini",
            "set_mini_always_on_top",
            "set_tray_labels",
            "quote_launch_entry",
            "updater_configured",
            "token_get",
            "token_set",
            "token_clear",
        ] {
            assert!(main.contains(&allow(command)), "{command}");
        }
        assert!(!main.contains(&allow("smoke_mark")));
        assert_eq!(granted(SMOKE_CAPABILITY), vec![allow("smoke_mark")]);
    }

    #[test]
    fn the_mini_window_may_only_theme_close_pin_drag_and_listen() {
        let expected: Vec<String> = [
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "core:window:allow-start-dragging",
        ]
        .into_iter()
        .map(str::to_owned)
        .chain(
            ["accent_color", "close_mini", "set_mini_always_on_top"]
                .into_iter()
                .map(allow),
        )
        .collect();
        assert_eq!(granted(MINI_CAPABILITY), expected);
    }

    /// Whether `url` matches the opener scope `pattern` as the opener plugin matches it
    /// (`glob::Pattern::matches`, where `*` and `**` match any run of characters, `/` included).
    /// The scopes here use no other glob syntax, which this checks.
    fn scope_matches(pattern: &str, url: &str) -> bool {
        assert!(
            !pattern.contains(['?', '[', ']', '{', '}', '!']),
            "{pattern}"
        );
        let parts: Vec<&str> = pattern.split('*').collect();
        let (first, rest) = parts.split_first().expect("a pattern");
        let Some(mut remaining) = url.strip_prefix(first) else {
            return false;
        };
        let Some((last, middle)) = rest.split_last() else {
            return remaining.is_empty();
        };
        for part in middle.iter().filter(|part| !part.is_empty()) {
            match remaining.find(part) {
                Some(at) => remaining = &remaining[at + part.len()..],
                None => return false,
            }
        }
        remaining.ends_with(last)
    }

    /// The URL patterns the main window's opener scope allows.
    fn opener_scope() -> Vec<String> {
        let main = json(MAIN_CAPABILITY);
        let entry = main["permissions"]
            .as_array()
            .expect("permissions")
            .iter()
            .find(|permission| permission["identifier"] == "opener:allow-open-url")
            .cloned()
            .expect("the opener's scope");
        entry["allow"]
            .as_array()
            .expect("allowed URLs")
            .iter()
            .map(|allowed| allowed["url"].as_str().expect("a URL").to_owned())
            .collect()
    }

    fn opens(url: &str) -> bool {
        opener_scope()
            .iter()
            .any(|pattern| scope_matches(pattern, url))
    }

    #[test]
    fn the_scope_matcher_matches_like_glob() {
        assert!(scope_matches("https://**", "https://example.com/a/b?c=d"));
        assert!(scope_matches(
            "http://x/device*",
            "http://x/device?user_code=AB"
        ));
        assert!(scope_matches("http://x/device*", "http://x/device"));
        assert!(!scope_matches("http://x/device*", "http://x/"));
        assert!(!scope_matches("http://x/device*", "https://x/device"));
        assert!(scope_matches("a*b*c", "a-b-c"));
        assert!(!scope_matches("a*b*c", "a-c-b"));
    }

    #[test]
    fn the_browser_opens_the_device_pages_and_the_links() {
        // `tauri dev`: the server's BETTER_AUTH_URL is Vite's origin (server/.dev.vars.example).
        assert!(opens("http://localhost:5173/device?user_code=WDJBMJHT"));
        // The API's own origin, when the server names no page (`verificationUrlFor`).
        assert!(opens("http://localhost:8787/device?user_code=WDJBMJHT"));
        // Production, and the privacy policy and source links in Settings.
        assert!(opens("https://timer.hanlin.uk/device?user_code=WDJBMJHT"));
        assert!(opens(
            "https://github.com/hotdogee/timer-app/blob/main/docs/privacy.md"
        ));
        assert!(opens("https://github.com/hotdogee/timer-app"));
    }

    #[test]
    fn the_browser_opens_nothing_else_over_plain_http() {
        for url in [
            "http://localhost:5173/",
            "http://localhost:8787/api/export",
            "http://example.com/device?user_code=WDJBMJHT",
            "file:///C:/Windows/System32/calc.exe",
        ] {
            assert!(!opens(url), "{url}");
        }
    }

    #[test]
    fn the_browser_opens_no_other_https_page() {
        // Only the production server's device page (a placeholder origin until the final domain,
        // spec Q13) and the project's GitHub pages.
        for url in [
            "https://example.com/",
            "https://timer.hanlin.uk/",
            "https://timer.hanlin.uk/api/export",
            "https://timer.hanlin.uk.evil.example/device?user_code=WDJBMJHT",
            "https://evil.example/?https://timer.hanlin.uk/device",
            "https://github.com/hotdogee",
            "https://github.com/hotdogee/timer-app-fork",
            "https://gist.github.com/hotdogee/timer-app",
        ] {
            assert!(!opens(url), "{url}");
        }
    }
}
