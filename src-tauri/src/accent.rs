//! The OS accent color, the default theme seed (spec Q20).
//!
//! - **Windows**: `UISettings::GetColorValue(UIColorType::Accent)`; [`watch`] subscribes to
//!   `UISettings.ColorValuesChanged` and emits [`ACCENT_CHANGED`] when the accent changes.
//! - **macOS**: `NSColor.controlAccentColor` converted to sRGB. No change events.
//! - **Linux**: the Settings portal's `org.freedesktop.appearance` `accent-color` (portal v2,
//!   GNOME 47+, KDE Plasma 6), when there is one. No change events.
//! - Anywhere else, and whenever the OS does not answer: no accent (`None`), so the theme uses its
//!   default seed.

use std::sync::Mutex;

use tauri::{AppHandle, Runtime};

/// The event emitted to every window when the OS accent color changes. Payload: the new color as
/// `#rrggbb` (lowercase), a string. Windows only.
pub const ACCENT_CHANGED: &str = "accent-changed";

/// Formats an sRGB color as `#rrggbb`, lowercase.
pub fn rgb_to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Converts one color channel in 0–1 to 0–255, rounding to the nearest. `None` for a value
/// outside 0–1 (or NaN).
pub fn unit_to_u8(value: f64) -> Option<u8> {
    if (0.0..=1.0).contains(&value) {
        // In range, so the product is within 0..=255 and the cast cannot truncate.
        Some((value * 255.0).round() as u8)
    } else {
        None
    }
}

/// Formats an sRGB color whose channels are in 0–1 as `#rrggbb`. `None` when any channel is out
/// of range: the Settings portal uses that for "no accent color".
pub fn unit_rgb_to_hex(r: f64, g: f64, b: f64) -> Option<String> {
    Some(rgb_to_hex(unit_to_u8(r)?, unit_to_u8(g)?, unit_to_u8(b)?))
}

/// Remembers the last accent color reported, so that a change notification that changed nothing
/// (Windows sends one for every color setting, the light/dark switch included) emits nothing.
#[derive(Debug, Default)]
pub struct AccentTracker {
    last: Mutex<Option<String>>,
}

impl AccentTracker {
    /// A tracker whose last reported color is `initial`.
    pub fn new(initial: Option<String>) -> Self {
        Self {
            last: Mutex::new(initial),
        }
    }

    /// Records `next` and returns it when it differs from the last color, else `None`. A missing
    /// color (`None`) is recorded but never returned: the webview keeps the color it has.
    pub fn update(&self, next: Option<String>) -> Option<String> {
        let mut last = self
            .last
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *last == next {
            return None;
        }
        last.clone_from(&next);
        next
    }
}

/// Command `accent_color`, no payload: the OS accent color as `#rrggbb` (lowercase), or `null`
/// when the OS does not expose one. Never rejects.
#[tauri::command]
pub async fn accent_color() -> Option<String> {
    os::read().await
}

/// Starts following accent color changes, emitting [`ACCENT_CHANGED`] to every window. Windows
/// only; elsewhere it does nothing. A failure is logged and leaves the app without change events.
pub fn watch<R: Runtime>(app: &AppHandle<R>) {
    os::watch(app);
}

#[cfg(windows)]
mod os {
    use tauri::{AppHandle, Emitter, Manager, Runtime};
    use windows::core::{IInspectable, Ref};
    use windows::Foundation::TypedEventHandler;
    use windows::UI::ViewManagement::{UIColorType, UISettings};

    use super::{rgb_to_hex, AccentTracker, ACCENT_CHANGED};

    /// Keeps the `ColorValuesChanged` subscription alive for the app's lifetime (managed state).
    struct Watcher {
        settings: UISettings,
        token: i64,
    }

    impl Drop for Watcher {
        fn drop(&mut self) {
            let _ = self.settings.RemoveColorValuesChanged(self.token);
        }
    }

    fn accent_of(settings: &UISettings) -> Option<String> {
        let color = settings.GetColorValue(UIColorType::Accent).ok()?;
        Some(rgb_to_hex(color.R, color.G, color.B))
    }

    pub async fn read() -> Option<String> {
        accent_of(&UISettings::new().ok()?)
    }

    pub fn watch<R: Runtime>(app: &AppHandle<R>) {
        let subscribe = || -> windows::core::Result<Watcher> {
            let settings = UISettings::new()?;
            let tracker = AccentTracker::new(accent_of(&settings));
            let app = app.clone();
            // Called on a background thread, once for every color setting that changed.
            let handler =
                TypedEventHandler::new(move |sender: Ref<UISettings>, _: Ref<IInspectable>| {
                    let next = sender.as_ref().and_then(accent_of);
                    if let Some(color) = tracker.update(next) {
                        let _ = app.emit(ACCENT_CHANGED, color);
                    }
                    Ok(())
                });
            let token = settings.ColorValuesChanged(&handler)?;
            Ok(Watcher { settings, token })
        };
        match subscribe() {
            Ok(watcher) => {
                app.manage(watcher);
            }
            Err(error) => eprintln!("timer-app: not following accent color changes: {error}"),
        }
    }
}

#[cfg(target_os = "macos")]
mod os {
    use objc2_app_kit::{NSColor, NSColorSpace};
    use tauri::{AppHandle, Runtime};

    use super::unit_rgb_to_hex;

    pub async fn read() -> Option<String> {
        let accent = NSColor::controlAccentColor();
        let srgb = accent.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
        // sRGB components are 0–1; clamp what rounding may push just outside.
        let channel = |value: f64| value.clamp(0.0, 1.0);
        unit_rgb_to_hex(
            channel(srgb.redComponent()),
            channel(srgb.greenComponent()),
            channel(srgb.blueComponent()),
        )
    }

    pub fn watch<R: Runtime>(_app: &AppHandle<R>) {}
}

#[cfg(target_os = "linux")]
mod os {
    use ashpd::desktop::settings::Settings;
    use tauri::{AppHandle, Runtime};

    use super::unit_rgb_to_hex;

    pub async fn read() -> Option<String> {
        let settings = Settings::new().await.ok()?;
        let color = settings.accent_color().await.ok()?;
        unit_rgb_to_hex(color.red(), color.green(), color.blue())
    }

    pub fn watch<R: Runtime>(_app: &AppHandle<R>) {}
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
mod os {
    use tauri::{AppHandle, Runtime};

    pub async fn read() -> Option<String> {
        None
    }

    pub fn watch<R: Runtime>(_app: &AppHandle<R>) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_lowercase_hex_with_leading_zeros() {
        assert_eq!(rgb_to_hex(0, 0, 0), "#000000");
        assert_eq!(rgb_to_hex(255, 255, 255), "#ffffff");
        assert_eq!(rgb_to_hex(0x0b, 0x57, 0xd0), "#0b57d0");
        assert_eq!(rgb_to_hex(1, 2, 3), "#010203");
        assert_eq!(rgb_to_hex(0xab, 0xcd, 0xef), "#abcdef");
    }

    #[test]
    fn converts_unit_channels_rounding_to_the_nearest() {
        assert_eq!(unit_to_u8(0.0), Some(0));
        assert_eq!(unit_to_u8(1.0), Some(255));
        assert_eq!(unit_to_u8(0.5), Some(128));
        assert_eq!(unit_to_u8(0.2), Some(51));
        assert_eq!(unit_to_u8(0.001), Some(0));
        assert_eq!(unit_to_u8(0.999), Some(255));
    }

    #[test]
    fn treats_out_of_range_channels_as_no_color() {
        for value in [-0.001, 1.001, -1.0, 2.0, f64::NAN, f64::INFINITY] {
            assert_eq!(unit_to_u8(value), None, "{value}");
        }
        assert_eq!(unit_rgb_to_hex(0.0, 0.0, 0.0), Some("#000000".into()));
        assert_eq!(
            unit_rgb_to_hex(0.207_843, 0.517_647, 0.894_118),
            Some("#3584e4".into())
        );
        // The portal's "unset" value.
        assert_eq!(unit_rgb_to_hex(-1.0, -1.0, -1.0), None);
        assert_eq!(unit_rgb_to_hex(0.5, 1.5, 0.5), None);
        assert_eq!(unit_rgb_to_hex(0.5, 0.5, f64::NAN), None);
    }

    #[test]
    fn the_tracker_reports_only_real_changes() {
        let tracker = AccentTracker::new(Some("#0078d4".into()));
        assert_eq!(tracker.update(Some("#0078d4".into())), None);
        assert_eq!(
            tracker.update(Some("#e81123".into())),
            Some("#e81123".into())
        );
        assert_eq!(tracker.update(Some("#e81123".into())), None);
    }

    #[test]
    fn the_tracker_never_reports_a_missing_color_but_reports_its_return() {
        let tracker = AccentTracker::new(Some("#0078d4".into()));
        assert_eq!(tracker.update(None), None);
        assert_eq!(tracker.update(None), None);
        assert_eq!(
            tracker.update(Some("#0078d4".into())),
            Some("#0078d4".into())
        );
        let empty = AccentTracker::default();
        assert_eq!(empty.update(Some("#123456".into())), Some("#123456".into()));
    }
}
