# Product spec

Draft, last updated 2026-10-18. Open items are tagged **(Qn)** and listed under [Open questions](#open-questions). Stack and architecture: [tech-stack.md](tech-stack.md).

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

- Responsive grid of cards, as in Windows Clock. Column count follows available width; cards size themselves with container queries. Cards are at least 22rem and at most 48rem wide; a lone card sits centered. Cards keep a 3:2 shape and grow taller only to show laps.
- Each card is either a timer or a stopwatch, fixed when it's created. New cards are named "Timer", "Timer 2", … (smallest unused number); the default timer is 5:00.
- Clicking a card selects it; the selected card has a 2px outline in the primary color.
- Floating action bar, bottom right: edit (✎), + Timer (a menu: 5:00 and the presets), + Stopwatch. Labels collapse to icons on narrow screens.
- Edit mode (✎ or `E`): the name becomes a text field, delete and drag handles appear; reorder by drag or `Ctrl+Arrow` (which also works outside edit mode). Cards keep running.
- Delete (`Delete`, any mode) shows a 6-second snackbar with Undo; `Ctrl/Cmd+Z` undoes while it is visible. A restored card is renumbered if its name was taken meanwhile.

## Card

Visuals follow the Google (Material 3) card, except the Timer/Stopwatch toggle is replaced by the card's type icon (⧗ timer, ◷ stopwatch) and name. Card colors come from the seed's Material palettes: in dark mode the card is secondary tone 20 on a neutral-variant tone 14 page, and chips, tonal buttons and the ring track are secondary tone 27; in light mode the card is white on neutral-variant tone 94, with secondary tone 90 for the tonal parts. Material's `surface-container` roles looked too dark and grey beside the reference card. Hero digits are 17% of the ring diameter.

Header: icon and name, mute, fullscreen, always-on-top mini window (hidden until the desktop milestone).

Fullscreen uses the browser Fullscreen API; where it is unavailable (iOS Safari) the card expands into an overlay. `Esc` leaves either. The fullscreen card follows the selection, so arrow keys switch which card fills the screen.

Mini window: a compact card floating above other apps. Desktop uses a Tauri always-on-top window; web uses Document Picture-in-Picture (Chrome and Edge; the button is hidden elsewhere).

### Timer

| State | Display | Controls |
|---|---|---|
| Idle | Set duration (`5:00`) with an underline; quick-add chips `+0:30` `+1:00` `+5:00` (very short cards drop `+0:30`, then `+5:00`) | Full-width Start |
| Running | Remaining time inside the ring; the arc grows clockwise from 12 o'clock with elapsed progress; end-time chip ("🔔 2:47 PM"); chips stay available (stacked beside the ring on short cards) | Pause, Reset |
| Paused | Remaining time; ring frozen; chips stay available | Resume, Reset |
| Time's up | Ring full; label "Time's up"; overtime counting up (`-0:12`); the ring pulses gently (off with reduced motion) while the label stays steady for contrast; sound loops | Dismiss, Restart |

### Stopwatch

| State | Display | Controls |
|---|---|---|
| Idle | `0.00` | Full-width Start |
| Running | Elapsed with centiseconds; a dot travels the ring once per minute | Pause, Lap, Reset |
| Paused | Elapsed; frozen | Resume, Reset |

Laps: lap and split times list below the controls, newest first with the current lap on top; the card grows to fit a few rows and scrolls beyond that.

### Presets

Named durations (e.g. "Tea 3:00"). Picking one from the + Timer menu or the command palette creates a timer card. Presets sync with the account. Built in until user presets arrive with settings: Tea 3:00, Pomodoro 25:00, Break 5:00, Eggs 7:00.

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

### Shortcuts

Digits and `Backspace` are fixed; everything else is rebindable. `Mod` is `Cmd` on macOS and `Ctrl` elsewhere. Shortcuts are ignored while typing in a text field.

| Key | Action |
|---|---|
| `Space` | Start / pause (applies typed digits first) |
| `Enter` | Start (while editing) / dismiss alarm |
| `R` | Reset (discards typed digits) |
| `Esc` | Cancel typing, close dialogs, leave edit mode |
| Arrow keys | Move the selection between cards |
| `Ctrl+Arrow` | Move the selected card |
| `N` / `Shift+N` | New timer / new stopwatch |
| `Delete` | Delete card (with undo) |
| `Mod+Z` | Undo delete |
| `E` | Edit mode |
| `F2` | Rename |
| `F` | Fullscreen card |
| `M` | Mute card |
| `L` | Lap (stopwatch) |
| `T` | Always-on-top mini window |
| `P` | Presets |
| `Mod+K` | Command palette |
| `?` | Shortcut cheat sheet |

### Command palette

`Mod+K` opens a searchable list of every command (new cards, presets, actions on the selected card, edit mode, help), each with its shortcut. Matching is a case-insensitive subsequence match. Typing 1–6 digits offers "New timer HH:MM:SS" first; `Enter` creates and starts it.

Global hotkeys (desktop, opt-in): start/pause the last-used card without focusing the app.

## Time's up

Default: the sound loops and the card counts up in overtime (`-0:12`) until dismissed, with a system notification. Each of these is a setting:

- Sound (built-in synthesized set: chime, bell, beep; or a custom file), volume, loop or play once.
- Auto-stop after N minutes.
- Overtime counter (`-0:12`).
- System notification; taskbar flash / dock bounce.
- Snooze / restart. Snooze runs the timer for the snooze length and keeps the original duration, so Reset still returns to it.

Quick-add chips pressed while a timer runs extend both the remaining time and the total, so the ring rescales.

One sound plays at a time: it runs while any unmuted card is ringing and stops when none is. Audio is unlocked on the first click or key press and again on every Start, as browsers require. Notification permission is requested the first time a timer starts; clicking a notification focuses the app and dismisses that card. A Web Worker holds the next deadline so a hidden browser tab still rings on time.

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
- Screen readers: digits use `role="timer"`; the selected card carries `aria-selected`; one polite live region announces start, pause and resume (with the time), time's up, dismiss, reset, card add, move, delete (naming the undo shortcut) and restore, never every second.
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
| M2 | Designed Material 3 card, card grid, edit mode, keyboard layer, command palette | Done 2026-10-18 |
| M3 | TinyBase stores on IndexedDB, settings and themes, i18n (en, zh-TW, ja), PWA | Planned |
| M4 | Sync server on Cloudflare Workers, Better Auth, sign-in flows | Planned |
| M5 | Desktop: tray, background alarms, mini window, global hotkeys, updater, autostart | Planned |
| M6 | Release: signing, CI builds, GitHub Releases, winget, Homebrew, Microsoft Store | Planned |

## Open questions

None right now. New questions continue from Q22.

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
| 2026-10-17 | Q19 | Fonts: Roboto Flex (default) and Inter are both bundled, self-hosted. |
| 2026-10-17 | Q20 | Default seed color follows the OS accent color (Windows, macOS, GNOME on desktop; the browser's accent where exposed), falling back to Google blue `#0B57D0`. |
| 2026-10-17 | Q21 | Alarm sounds are synthesized with Web Audio (built-in chime, bell, beep); custom sound files come with settings. |
| 2026-10-17 | — | M2 layout: cards 22–48rem wide, 3:2, centered when few; click selects; names auto-number; Delete anywhere with a 6-second Undo; `Ctrl+Arrow` reorders. |
| 2026-10-17 | — | M2 shortcuts added: `Shift+N`, `E`, `F2`, `Mod+Z`, `Esc`, `Ctrl+Arrow`. Palette turns typed digits into a new timer. Stopwatch dot: one revolution per minute. |
| 2026-10-17 | — | Fullscreen via the Fullscreen API with an overlay fallback. Mini window hidden until M5. Built-in presets until M3. |
| 2026-10-18 | — | M2 card colors: card = secondary tone 20 (dark) / white (light), page = neutral-variant tone 14 / 94, tonal parts = secondary tone 27 / 90; Material's `surface-container` looked too dark and grey beside the reference. Hero digits are 17% of the ring diameter. |
| 2026-10-18 | — | Time's up: only the ring pulses; the label stays steady for 4.5:1 contrast. Short cards stack the chips beside the ring and drop `+0:30`, then `+5:00`. Fullscreen follows the selection. Restored cards are renumbered when their name was taken. Announcements carry the time; deletes name the undo shortcut. |
