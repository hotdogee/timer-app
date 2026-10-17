# Timer App

A keyboard-first timer and stopwatch app. One TypeScript codebase ships as an installable web app
and as Tauri desktop apps for Windows, macOS and Linux.

- Product spec: [docs/spec.md](docs/spec.md)
- Stack and architecture: [docs/tech-stack.md](docs/tech-stack.md)

## Requirements

- Node.js 24 (see `.node-version`)
- pnpm 12 (pinned in `package.json` › `packageManager`; `corepack enable` or `npm i -g pnpm`)
- For the desktop app: Rust (stable) and the
  [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

## Getting started

```sh
pnpm install     # install dependencies
pnpm dev         # web dev server at http://localhost:5173
pnpm tauri dev   # desktop app (starts the web dev server for you)
```

## Scripts

| Command             | What it does                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm dev`          | Vite dev server with hot reload                                                              |
| `pnpm build`        | Production web build into `dist/`, with the service worker and the web app manifest          |
| `pnpm preview`      | Serve the production build locally                                                           |
| `pnpm check`        | Compile the messages, then type-check: `svelte-check` for `src/`, `tsc` for the config files |
| `pnpm lint`         | ESLint (type-aware) and Prettier check                                                       |
| `pnpm format`       | Format every file with Prettier                                                              |
| `pnpm test`         | Compile the messages, then run the unit tests once (Vitest)                                  |
| `pnpm test:watch`   | Compile the messages, then run the unit tests in watch mode                                  |
| `pnpm test:e2e`     | Run the end-to-end tests (Playwright, Chromium)                                              |
| `pnpm test:e2e:ui`  | Run the end-to-end tests in Playwright's UI mode                                             |
| `pnpm i18n:compile` | Compile `messages/*.json` into `src/paraglide/` (generated, not committed)                   |
| `pnpm icons`        | Regenerate the PWA icons and `favicon.ico` in `public/` from `public/icon.svg`               |
| `pnpm tauri <cmd>`  | Tauri CLI, e.g. `pnpm tauri dev`, `pnpm tauri build`                                         |

Unit tests run in two Vitest projects: `unit` (Node; `*.test.ts`) and `client` (jsdom with Svelte's
browser runtime, where effects run; `*.client.test.ts`, or `*.client.test.svelte.ts` when the test
itself uses runes).

The end-to-end tests need Chromium once: `pnpm exec playwright install chromium`. Locally they run
against the dev server (`pnpm dev`, reused when it is already running); set `E2E_SERVER=preview`
to test the production build instead (run `pnpm build` first). The service worker and its offline
test exist only in the production build. Every test starts with empty storage, so the app opens
on its first run; the browser locale is `en-US` unless a spec sets another. Time-dependent tests
drive the page with Playwright's fake clock, so they are exact and fast. Screenshots of the grid in
light and dark mode, and of startup with a saved dark theme, are saved under `test-results/` for
review; they are not compared pixel by pixel.

CI (`.github/workflows/ci.yml`) runs `check`, `lint`, `test`, `build` and the end-to-end tests
(against the production build) on every push to `main` and on pull requests, and keeps
`test-results/` (traces of failures and the screenshots) as a build artifact.

## Layout

```
src/
  core/           Pure TypeScript engine: timer and stopwatch state machines, digit entry,
                  formatting, frame ticker, card list model, keymap, settings schema and
                  migrations, export file format. No DOM, no Svelte, no Tauri.
  platform/       Browser and OS services behind small interfaces (notifications, alarm audio,
                  background wake-up worker, fullscreen, ids, accent color); web implementations
                  now, Tauri pieces later
  sync/           TinyBase stores and their schemas, persistence (IndexedDB, localStorage), tab
                  sync over BroadcastChannel, the bridge between the card store and the store
  state/          Reactive app state (.svelte.ts): card store, settings, presets, app data startup,
                  alarm, keyboard controller
  i18n/           The active locale and reactive messages (`m`); compiled messages in src/paraglide/
  ui/
    theme/        Material 3 color scheme from a seed color, design tokens, fonts, appearance
    primitives/   Icon, Button, IconButton, Chip, Dialog, Menu, Snackbar, Switch, Select, Slider,
                  TextField, SegmentedButtons
    card/         The timer and stopwatch cards
    grid/         Card grid, action bar, "+ Timer" menu, drag reorder
    palette/      Command palette and the shortcut cheat sheet's data
    settings/     The settings dialog: appearance, behavior, keyboard, presets, data, about
  App.svelte      Wires the grid, keyboard layer, palette, cheat sheet, settings, alarm, snackbars
  main.ts         Web entry point: loads the data, applies the appearance and the language, mounts
                  the app, then registers the service worker
  pwa.svelte.ts   Service worker registration and the "Update ready" state
messages/         Translations: en.json, zh-TW.json, ja.json
project.inlang/   Paraglide (inlang) project settings
public/           PWA icons and the favicon (generated from icon.svg by `pnpm icons`)
e2e/              Playwright end-to-end tests
src-tauri/        Tauri 2 desktop shell (Rust)
docs/             Product spec and tech stack
```

Unit tests sit next to the module they test (`*.test.ts`).

## Data and offline

Everything stays on the device for now; cross-device sync comes in the next milestone.

- **Cards, presets and behavior settings** live in a synced TinyBase store (a `MergeableStore`
  with one cell per field) that is saved to IndexedDB (`timer-app`) after every change. Browser
  tabs share it live over a BroadcastChannel.
- **Appearance and language** live in a device-only store in localStorage (`timer-app-device`).
  It is read without waiting, so the saved theme and language are on the page before the first
  paint; `index.html` also applies a forced light or dark mode before the app's script runs.
- **Startup** (`main.ts`): the device settings, then the synced store (a fresh install gets one
  5:00 timer and the built-in presets, named in the UI language), then every card is settled, so a
  timer that ended while the app was closed is ringing. Then the app mounts.
- When storage is unavailable (private browsing, blocked site data), the app runs in memory and
  logs a warning.
- **Settings › Data** exports everything to `timer-app-YYYY-MM-DD.json` and imports such a file,
  replacing cards, presets and settings after asking.
- **PWA**: the production build precaches the whole app with a service worker (vite-plugin-pwa),
  so it installs and works offline. A new version shows "Update ready" with Reload. The worker is
  not registered under `pnpm dev` or inside Tauri.

## Translations

The UI speaks English, 繁體中文 and 日本語. It follows the browser's language (Traditional Chinese
variants → `zh-TW`, Japanese → `ja`, anything else → English) unless one is chosen in Settings ›
Appearance; switching applies at once, without a reload.

- Messages live in `messages/{locale}.json` (inlang message format). Paraglide JS compiles them
  into typed functions in `src/paraglide/`: the Vite plugin during `dev` and `build`, and
  `pnpm i18n:compile` (which `pnpm check` and `pnpm test` run first).
- Code reads messages through `m` from `src/i18n` (`m.card_start()`, `m.delete_snackbar({ name })`),
  never from `src/paraglide` directly; `m` follows the active locale. Components and state modules
  hard-code no user-facing text.
- To add or change a string, edit all three files: they must have the same keys and the same
  parameters per key (a unit test checks this). Plurals use the message format's `plural`
  selector (see `data_count_cards`). Keys are lower snake case, grouped by area (`card_*`,
  `settings_*`, …).
- Times and numbers are not translated: they come from `src/core/format.ts` and `Intl`.

The app is keyboard first: type digits to set the selected timer, `Enter` or `Space` to start,
arrows to move between cards, `Ctrl+K` (`⌘K` on macOS) for the command palette and `?` for every
shortcut. See [docs/spec.md › Keyboard](docs/spec.md#keyboard).

Design rules that the code relies on are in
[docs/tech-stack.md › Architecture](docs/tech-stack.md#architecture). The most important one:
time is derived, never counted. State stores timestamps and the display is computed from the
current time, so timers stay correct across sleep, throttled tabs and reloads.

## License

MIT
