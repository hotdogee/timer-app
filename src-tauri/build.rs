//! Runs Tauri's build helpers: the app context, and the app's own permissions (one
//! `allow-<command>` per command in [`COMMANDS`], with `_` as `-`), which the capabilities grant
//! window by window (`capabilities/*.json`). A command no capability grants is refused.

/// Every command `src/lib.rs` registers (`generate_handler!`).
const COMMANDS: &[&str] = &[
    "accent_color",
    "set_running",
    "set_close_behavior",
    "open_mini",
    "close_mini",
    "set_mini_always_on_top",
    "set_tray_labels",
    "quote_launch_entry",
    "updater_configured",
    "smoke_mark",
];

fn main() {
    // Debug builds also read `capabilities/debug/`, which grants the smoke test's hook (release
    // builds have neither the command nor the grant).
    let debug = std::env::var_os("CARGO_CFG_DEBUG_ASSERTIONS").is_some();
    let capabilities = if debug {
        "./capabilities/**/*.json"
    } else {
        "./capabilities/*.json"
    };
    println!("cargo:rerun-if-changed=capabilities");
    let attributes = tauri_build::Attributes::new()
        .capabilities_path_pattern(capabilities)
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(error) = tauri_build::try_build(attributes) {
        panic!("tauri-build failed: {error:#}");
    }
}
