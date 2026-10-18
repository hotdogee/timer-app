# Changelog

What changed in each release of Timer App. `pnpm release` writes each version's section (see
[docs/release.md](docs/release.md)): the notes under Unreleased move into it, followed by the
commits since the previous release, and the GitHub Release takes its notes from that section.
Write notes for the next release under Unreleased, one line per paragraph (GitHub shows the line
breaks of release notes as they are).

## Unreleased

**Timer engine (M1).** Timers and stopwatches whose time is derived from timestamps, never counted, so they stay right across sleep, throttled tabs, reloads and restarts. Typed digits shift in from the right (`13030` is 1:30:30), are shown as typed and normalized on Start (`90` seconds becomes 1:30). Times read compact (`4:53`) or fixed (`00:04:53`); countdowns round up, so the alarm starts the moment the display reaches `0:00`, and the stopwatch shows centiseconds.

**Cards and keyboard (M2).** Material 3 timer and stopwatch cards in a responsive grid, from phone to 4K: a progress ring, quick-add chips (`+0:30`, `+1:00`, `+5:00`), the end time, laps, fullscreen, edit mode with drag or `Ctrl+Arrow` reordering, and delete with a 6-second undo. Everything works from the keyboard: digits set the selected timer, `Space` and `Enter` start, arrows move the selection, `Ctrl+K` (`⌘K`) opens the command palette and `?` lists every shortcut. When time is up a synthesized chime, bell or beep loops, the card counts the overtime and a notification appears, also from a background tab. Reduced motion, high contrast and screen readers are supported.

**Settings, languages and offline (M3).** Cards, presets and settings are saved on the device and shared live between tabs. Settings (`Ctrl+,`, `⌘,` on macOS) covers the theme, seed color, font and sizes, time formats, sounds and alarms, rebinding every shortcut, presets (Tea, Pomodoro, Break, Eggs to start with), export and import of everything as JSON, and About. The app speaks English, 繁體中文 and 日本語, following the browser unless one is chosen, and switches without a reload. The web app installs as a PWA, works offline and offers new versions with "Update ready".

**Accounts and sync (M4).** An optional account, with an emailed code or Google, GitHub or Apple, syncs cards, presets and behavior settings across devices through the app's own server: changes appear on the other devices within about a second, work offline and merge field by field. A timer rings on every device and a dismiss on any of them stops all. Device clocks that are off are corrected against the server's. Settings › Account can stop syncing on one device, download the server's copy or delete the account with its data.

**Desktop apps (M5).** Windows, macOS and Linux apps: a tray icon, closing to the tray while a card runs so alarms still ring, a mini window that floats one card above other apps (Picture in Picture in Chrome and Edge), global hotkeys to start or pause the last card and to show or hide the app, launch at login, the system accent color as the theme's seed, system notifications, one instance, and sign-in through the browser with a short code. The app checks for updates once the release signing key is set up.

**Releases and installers (M6).** Installers for Windows (x64 and Arm64: a per-user setup and an MSI), macOS (Apple Silicon and Intel) and Linux (x64 and Arm64: AppImage, deb and rpm) on GitHub Releases, plus `winget install Hotdogee.TimerApp` and the Homebrew cask `hotdogee/tap/timer-app`; in-app updates from each release once its signing key exists. The desktop app now keeps its sign-in token in the OS credential store (Windows Credential Manager, the macOS Keychain, the Secret Service on Linux) instead of the webview's storage, and moves an existing one there once.
