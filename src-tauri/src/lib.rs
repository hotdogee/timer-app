//! Tauri shell for Timer App. The web UI in `src/` does all the work; platform
//! features (tray, notifications, global hotkeys) arrive as plugins in later
//! milestones. See docs/tech-stack.md.

/// Builds and runs the Tauri application. Shared entry point for the desktop
/// binary (`main.rs`) and, later, the mobile targets.
///
/// Panics if the Tauri runtime fails to start, since there is nothing to fall back to.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
