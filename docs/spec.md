# Product spec

Draft, last updated 2026-10-17. Open items are tagged **(Qn)** and listed under [Open questions](#open-questions). Stack and architecture: [tech-stack.md](tech-stack.md).

Design references in [design/](design/):

| File | Source |
|---|---|
| `card-timer-stopped.png`, `card-timer-running.png`, `card-stopwatch-stopped.png`, `card-stopwatch-running.png` | Google Search timer widget (card design) |
| `layout.png` | Windows 11 Clock app (layout) |

## Goals

- **Snappy**: instant startup, smooth animation, no input lag.
- **Responsive**: phones, tablets, laptops, 4K.
- **Cross platform**: web, Windows, macOS, Linux. Phones get the responsive web app (installable PWA) in v1; App Store / Play Store apps come in phase 2.
- **Synced**: cards follow you across devices.
- **Keyboard first**: every action works without a mouse.
- **Dark and light** themes, following the OS by default.
- **Multi-language**.
- **Customizable**: colors, fonts, sizes, behavior.

## Layout

- Responsive grid of cards, as in Windows Clock. Column count follows available width; cards size themselves with container queries.
- Each card is either a timer or a stopwatch, fixed when it's created.
- Floating action bar, bottom right: edit (✎), + Timer, + Stopwatch.
- Edit mode: rename, delete, reorder by drag or keyboard.

## Card

Visuals follow the Google (Material 3) card, except the Timer/Stopwatch toggle is replaced by the card's type icon (⧗ timer, ◷ stopwatch) and name.

Header: icon and name, mute, fullscreen, always-on-top mini window.

Mini window: a compact card floating above other apps. Desktop uses a Tauri always-on-top window; web uses Document Picture-in-Picture (Chrome and Edge; the button is hidden elsewhere).

### Timer

| State | Display | Controls |
|---|---|---|
| Idle | Set duration (`5:00`), editable; quick-add chips `+0:30` `+1:00` `+5:00` | Full-width Start |
| Running | Remaining time; ring fills with elapsed progress; end-time label ("🔔 2:47 PM") | Pause, Reset |
| Paused | Remaining time; ring frozen | Resume, Reset |
| Time's up | Overtime counting up (`-0:12`); sound loops | Dismiss, Restart |

### Stopwatch

| State | Display | Controls |
|---|---|---|
| Idle | `0.00` | Full-width Start |
| Running | Elapsed with centiseconds; dot travels the ring | Pause, Reset |
| Paused | Elapsed; frozen | Resume, Reset |

Laps: a Lap button appears while running; lap and split times list below the ring.

### Presets

Named durations (e.g. "Tea 3:00"). Picking one from the + Timer menu or the command palette creates a timer card. Presets sync with the account.

### Time format

- Default: compact, Google style (`4:53`, `1:30:30`). Fixed `HH:MM:SS` (`00:04:53`) is a setting.
- Countdowns round up: the display reads `0:01` until the exact end and `0:00` the moment the alarm starts. Elapsed time and overtime round down.
- Under a minute a countdown still shows minutes (`0:05`). The stopwatch shows seconds and centiseconds (`0.00`, `59.99`), then `1:05.43`, then `1:00:05.43`.
- Digits use tabular figures so they don't shift sideways.
- Clock times (end-time label) follow the locale's 12/24-hour convention, overridable in settings.

## Keyboard

### Digit entry

- Up to 6 digits shift in from the right into `HH:MM:SS`: `1` → `00:00:01`, `13030` → `01:30:30`.
- `Backspace` removes the last digit. `Enter` starts. `Esc` cancels and restores the previous duration.
- While typing, the display shows exactly what was typed (`00:00:90`). On Start, overflow normalizes: `90` seconds → `1:30`, `75` minutes → `1:15:00`.
- Leading zeros and a seventh digit are ignored, so the buffer holds at most six significant digits.
- One card is always selected (highlighted); arrow keys move the selection. Digits edit the selected timer when it isn't running; on a paused timer they replace the duration and reset it; on a ringing timer they dismiss it and set the new duration. On a stopwatch or a running timer, digits do nothing.
- `Enter` with nothing typed starts the selected timer, or dismisses it when ringing.

### Shortcuts (proposed, all rebindable)

| Key | Action |
|---|---|
| `Space` | Start / pause |
| `Enter` | Start (while editing) / dismiss alarm |
| `R` | Reset |
| Arrow keys | Move between cards |
| `N` | New card |
| `Delete` | Delete card (with undo) |
| `F` | Fullscreen card |
| `M` | Mute card |
| `L` | Lap (stopwatch) |
| `T` | Always-on-top mini window |
| `P` | Presets |
| `Ctrl/Cmd+K` | Command palette |
| `?` | Shortcut cheat sheet |

Global hotkeys (desktop, opt-in): start/pause the last-used card without focusing the app.

## Time's up

Default: the sound loops and the card counts up in overtime (`-0:12`) until dismissed, with a system notification. Each of these is a setting:

- Sound (bundled set or custom file), volume, loop or play once.
- Auto-stop after N minutes.
- Overtime counter (`-0:12`).
- System notification; taskbar flash / dock bounce.
- Snooze / restart. Snooze runs the timer for the snooze length and keeps the original duration, so Reset still returns to it.

Quick-add chips pressed while a timer runs extend both the remaining time and the total, so the ring rescales.

## Persistence and instances

- Cards and their state survive reloads, closing the window and reboots. Running timers keep running.
- Desktop: closing the window hides the app to the tray / menu bar while any timer runs, so alarms still ring; otherwise it quits.
- Multiple browser tabs stay in sync (`BroadcastChannel`). Desktop runs as a single instance.
- Cross-device sync: see [Sync](#sync).

## Sync

v1 syncs cards and their live state across devices.

- **Offline first**: the local copy is the source of truth. Every action works offline and syncs when the connection returns.
- **Realtime**: starting a timer on one device shows it running on the others within about a second.
- **Conflicts**: last-writer-wins per card field; enough for this data.
- **Clock skew**: device clocks can differ by seconds. Timestamps are corrected with a server-time offset so every device shows the same remaining time.
- **What syncs**: cards and behavior settings. Appearance settings (font size, density) stay per device by default, since a phone and a 4K screen want different sizes.
- **Desktop sign-in**: Google blocks OAuth inside embedded webviews, so the desktop app signs in through the system browser and a deep link, or with an emailed code.
- **Obligations**: privacy policy, account deletion, data export.
- **Accounts are optional.** The app works fully signed out; signing in turns on sync and uploads the local cards.
- **Sign-in**: email code, Google, Apple, GitHub.
- **Ringing**: every device with the app open rings; dismissing on any device stops them all.
- **Backend**: our own sync server on Cloudflare Workers; see [tech-stack.md › Server](tech-stack.md#server).

## Accessibility

- Full keyboard operation with a visible focus ring.
- Respects `prefers-reduced-motion`, `prefers-color-scheme` and Windows high contrast (`forced-colors`).
- User-chosen colors are contrast-checked.
- Screen readers: digits use `role="timer"`; announcements on start, pause and time's up, never every second.
- Text scales with OS font-size settings.

## Internationalization

- Launch languages: English (`en`), 繁體中文 (`zh-TW`), 日本語 (`ja`).
- Right-to-left languages mirror the layout; digits stay left-to-right.
- Plurals, numbers and times go through ICU messages and `Intl`.

## Settings

| Group | Settings |
|---|---|
| Appearance | Theme (system / light / dark), seed color, font, font weight, digit size, ring thickness, card density, time format, 12/24-hour |
| Behavior | Quick-add chip values, default sound, volume, auto-stop, overtime, notifications, confirm before delete |
| Keyboard | Rebind any shortcut; global hotkeys (desktop) |
| Desktop | Launch at login, close behavior, always-on-top |
| Data | Export / import settings and cards |
| Account | Sign in / out, sync on / off, delete account and data |

## Milestones

| # | Scope | Status |
|---|---|---|
| M1 | Project scaffold; core engine (timer, stopwatch, digit entry, formatting, frame ticker) with tests; Tauri scaffold; dev harness | Done 2026-10-17 |
| M2 | Designed Material 3 card, card grid, edit mode, keyboard layer, command palette | Planned |
| M3 | TinyBase stores on IndexedDB, settings and themes, i18n (en, zh-TW, ja), PWA | Planned |
| M4 | Sync server on Cloudflare Workers, Better Auth, sign-in flows | Planned |
| M5 | Desktop: tray, background alarms, mini window, global hotkeys, updater, autostart | Planned |
| M6 | Release: signing, CI builds, GitHub Releases, winget, Homebrew, Microsoft Store | Planned |

## Open questions

None right now. New questions continue from Q19.

## Decisions

| Date | ID | Decision |
|---|---|---|
| 2026-10-17 | — | Card visuals follow Google's Material 3 card; layout follows the Windows Clock grid. |
| 2026-10-17 | Q1 | Phones: responsive web / PWA in v1; Tauri iOS and Android store apps in phase 2. |
| 2026-10-17 | Q2 | Each card has a fixed type (timer or stopwatch) chosen at creation. |
| 2026-10-17 | Q3 | UI framework: Svelte 5. |
| 2026-10-17 | Q4 | Cross-device sync ships in v1, on our own server. |
| 2026-10-17 | Q5 | Typed digits go to the selected card (always one selected). |
| 2026-10-17 | Q6 | Overflow is shown as typed and normalized on Start. |
| 2026-10-17 | Q7 | Time's up default: loop sound + overtime until dismissed, plus notification. |
| 2026-10-17 | Q8 | Default time format: compact (`4:53`). |
| 2026-10-17 | Q9 | v1 includes command palette, stopwatch laps, always-on-top mini window, global hotkeys, presets. |
| 2026-10-17 | Q10 | Launch languages: English, 繁體中文, 日本語. |
| 2026-10-17 | Q11 | Desktop close: hide to tray while timers run, otherwise quit. |
| 2026-10-17 | Q12 | License: MIT. Channels: GitHub Releases, winget, Homebrew, Microsoft Store. |
| 2026-10-17 | Q13 | Working name: Timer App (`timer-app`). Set the final name, domain and bundle ID before the first public release; changing the bundle ID after release breaks updates and app data paths. |
| 2026-10-17 | Q14 | Sync: TinyBase on Cloudflare Workers + Durable Objects (SQLite); Better Auth on D1. |
| 2026-10-17 | Q15 | Accounts are optional; sign in only to sync. |
| 2026-10-17 | Q16 | Sign-in: email code, Google, Apple, GitHub. |
| 2026-10-17 | Q17 | All devices ring; dismissing on one stops all. |
| 2026-10-17 | Q18 | Sign-in emails via Resend. |
| 2026-10-17 | — | Digit entry: six significant digits; leading zeros and a seventh digit are ignored. Enter with nothing typed starts (or dismisses). Typing on a ringing timer sets a new duration. |
| 2026-10-17 | — | Rounding: countdowns round up to the second, elapsed time and overtime round down. Compact countdown always shows minutes (`0:05`); the stopwatch shows centiseconds. |
| 2026-10-17 | — | Quick-add while running extends remaining time and total. Snooze keeps the original duration for Reset. |
