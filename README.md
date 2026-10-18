# Timer App

A keyboard-first timer and stopwatch app. One TypeScript codebase ships as an installable web app
and as Tauri desktop apps for Windows, macOS and Linux. Accounts are optional: signed in, the cards
sync across devices through our own server, a Cloudflare Worker in `server/`.

- Product spec: [docs/spec.md](docs/spec.md)
- Stack and architecture: [docs/tech-stack.md](docs/tech-stack.md)
- The sync server: [server/README.md](server/README.md); deploying it: [docs/deploy.md](docs/deploy.md)
- Privacy policy (draft): [docs/privacy.md](docs/privacy.md)

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

`pnpm dev` alone runs the whole app signed out. Signing in and sync need the sync server as well;
see [Sync server](#sync-server). The desktop app is described in [Desktop](#desktop).

## Scripts

| Command               | What it does                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm dev`            | Vite dev server with hot reload; forwards `/api` and `/__dev` to the sync server on port 8787     |
| `pnpm build`          | Production web build into `dist/`, with the service worker and the web app manifest               |
| `pnpm preview`        | Serve the production build locally (Vite; forwards the API like `pnpm dev`)                       |
| `pnpm check`          | Compile the messages, then type-check everything: `svelte-check`, `tsc`, `wrangler types --check` |
| `pnpm lint`           | ESLint (type-aware, the server included) and Prettier check                                       |
| `pnpm format`         | Format every file with Prettier                                                                   |
| `pnpm test`           | Compile the messages, then run the app's unit tests once (Vitest)                                 |
| `pnpm test:watch`     | Compile the messages, then run the app's unit tests in watch mode                                 |
| `pnpm test:server`    | Run the sync server's tests in workerd (Vitest with `@cloudflare/vitest-plugin`)                  |
| `pnpm test:e2e`       | Run the end-to-end tests (Playwright, Chromium); starts the sync server and the app itself        |
| `pnpm test:e2e:ui`    | Run the end-to-end tests in Playwright's UI mode                                                  |
| `pnpm i18n:compile`   | Compile `messages/*.json` into `src/paraglide/` (generated, not committed)                        |
| `pnpm icons`          | Regenerate the PWA icons and `favicon.ico` in `public/` from `public/icon.svg`                    |
| `pnpm tauri <cmd>`    | Tauri CLI, e.g. `pnpm tauri dev`, `pnpm tauri build`                                              |
| `pnpm smoke:desktop`  | Windows: drive the real desktop app through `tauri dev` and report (see [Desktop](#desktop))      |
| `pnpm server:dev`     | The sync server: `wrangler dev` at `http://127.0.0.1:8787`                                        |
| `pnpm server:migrate` | Apply `server/migrations/` to the local D1 (`server:migrate:remote` for production)               |
| `pnpm server:types`   | Regenerate `server/worker-configuration.d.ts` after changing `server/wrangler.jsonc`              |
| `pnpm server:deploy`  | `wrangler deploy` (see [docs/deploy.md](docs/deploy.md))                                          |

Unit tests run in two Vitest projects: `unit` (Node; `*.test.ts`) and `client` (jsdom with Svelte's
browser runtime, where effects run; `*.client.test.ts`, or `*.client.test.svelte.ts` when the test
itself uses runes). The sync server's tests (`server/test/`) run inside workerd against a real
local D1 with the migrations applied, real Durable Objects and real Better Auth.

The end-to-end tests need Chromium once: `pnpm exec playwright install chromium`. Playwright starts
the sync server itself (`e2e/sync-server.ts`): `wrangler dev` on port 8787 in development mode, on
a fresh local D1 and Durable Object state (`server/.wrangler/e2e`) with the migrations applied, so
port 8787 must be free. Locally the tests run against the dev server (`pnpm dev`, reused when it
is already running), which forwards the API to it; with `E2E_SERVER=preview` wrangler serves the
production build and the API at one origin, `http://localhost:8787`, as production does (run
`pnpm build` first). The service worker and its offline test exist only in the production build.
Every test starts with empty storage, so the app opens on its first run; the browser locale is
`en-US` unless a spec sets another. Accounts: each test signs up with an address of its own, reads
its sign-in codes from the server's development endpoint (`/__dev/otp`), and sends a client IP of
its own, so the server's per-IP limits apply per test; a second browser context plays a second
device. Time-dependent tests drive the page with Playwright's fake clock, so they are exact and
fast. Screenshots of the grid in light and dark mode, and of startup with a saved dark theme, are
saved under `test-results/` for review; they are not compared pixel by pixel.

CI (`.github/workflows/ci.yml`) runs `check`, `lint`, `test`, `test:server`, `build` and the
end-to-end tests (against the production build) on every push to `main` and on pull requests, and
keeps `test-results/` (traces of failures and the screenshots) as a build artifact. A second job
checks the desktop shell on Windows: in `src-tauri`, `cargo fmt --check`, `cargo clippy` for the
debug and the release profile, `cargo test` and `cargo audit` (advisories accepted for now, each
with its reason, are in `src-tauri/.cargo/audit.toml`). Deploying is a
separate, manual workflow (`.github/workflows/deploy.yml`; see [docs/deploy.md](docs/deploy.md)).

## Layout

```
src/
  core/           Pure TypeScript engine: timer and stopwatch state machines, digit entry,
                  formatting, frame ticker, card list model, keymap, settings schema and
                  migrations, export file format. No DOM, no Svelte, no Tauri.
  platform/       Browser and OS services behind small interfaces (notifications, alarm audio,
                  background wake-up worker, fullscreen, ids, accent color, mini window, global
                  hotkeys, launch at login, updater, tray and close behavior, opener): web
                  implementations, and in tauri/ the desktop ones, loaded only in the desktop app
  sync/           TinyBase stores and their schemas, persistence (IndexedDB, localStorage), tab
                  sync over BroadcastChannel, the bridge between the card store and the store; the
                  sync-server connection, the server-time offset, the API's address and the
                  client's copy of the server protocol (protocol.ts)
  state/          Reactive app state (.svelte.ts): card store, settings, presets, app data startup,
                  alarm, keyboard controller, auth state (with the desktop's device sign-in), the
                  app clock (device clock plus the server-time offset), the desktop wiring
  i18n/           The active locale and reactive messages (`m`); compiled messages in src/paraglide/
  ui/
    theme/        Material 3 color scheme from a seed color, design tokens, fonts, appearance
    primitives/   Icon, Button, IconButton, Chip, Dialog, Menu, Snackbar, Switch, Select, Slider,
                  TextField, SegmentedButtons
    card/         The timer and stopwatch cards
    grid/         Card grid, action bar, "+ Timer" menu, drag reorder
    palette/      Command palette and the shortcut cheat sheet's data
    settings/     The settings dialog: appearance, behavior, keyboard, presets, data, account,
                  about
    account/      Sign-in form, the desktop's device sign-in, sync status button, delete-account
                  dialog, the /device page
    mini/         The mini window: one compact card, its /mini page (desktop) and its
                  Picture-in-Picture rendering (web)
  App.svelte      Wires the grid, keyboard layer, palette, cheat sheet, settings, alarm, snackbars,
                  sync status, and in the desktop app the shell, the tray and the global hotkeys
  main.ts         Entry point: starts the session check, loads the data, applies the appearance
                  (in the desktop app with the OS accent color) and the language, starts sync while
                  signed in, mounts the app, then registers the service worker (desktop: starts the
                  update checks); on /device it shows the device approval page alone, on /mini the
                  desktop's mini window page
  pwa.svelte.ts   Service worker registration and the "Update ready" state; the desktop updater's
                  state
messages/         Translations: en.json, zh-TW.json, ja.json
project.inlang/   Paraglide (inlang) project settings
public/           PWA icons and the favicon (generated from icon.svg by `pnpm icons`)
e2e/              Playwright end-to-end tests
server/           The sync server: Cloudflare Worker, Better Auth on D1, a Durable Object per user
src-tauri/        Tauri 2 desktop shell (Rust): plugins, tray, close behavior, mini window, accent
                  color, the smoke hook; capabilities/ says what each window may call
scripts/          The desktop smoke test (smoke-desktop.mjs)
docs/             Product spec, tech stack, deployment guide, privacy policy draft
```

Unit tests sit next to the module they test (`*.test.ts`).

## Data and offline

Everything is kept on the device first; an account adds sync on top (see
[Accounts and sync](#accounts-and-sync)).

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
  not registered under `pnpm dev` or inside Tauri, and it leaves `/api/*` to the network.

## Accounts and sync

Accounts are optional; the app works fully signed out. Settings › Account signs in with an emailed
6-digit code, or with Google, GitHub or Apple when the server has credentials for them (the other
buttons are hidden).

- **Sync**: while signed in, the synced store (cards, presets, behavior settings; not appearance)
  exchanges changes with the user's Durable Object over a WebSocket (`/api/sync`), beside the tab
  sync. The local copy stays the source of truth: every action applies locally first. TinyBase
  merges per field (the newest change wins), so the first sync after signing in merges the
  device's cards with the account's: that is how signing in uploads them. The first-run timer and
  presets are written as defaults, older than any change, so a fresh device that signs in never
  overwrites the account's edits with them. When the account deleted one of them but the fresh
  device used it (renamed or started it), the device's edits are newer, and the cells the row
  needs to read back (a card's kind, a built-in preset's duration) are written back after the
  merge, so it stays with those edits.
- **Sync this device**: a switch in Settings › Account turns sync off on one device while it
  stays signed in (no connection, no clock correction; the cloud says Not syncing). It is kept in
  localStorage (`timer-app-sync-off`), never synced, and turns back on after signing out.
- **Connection**: it starts once the first clock measurement is in, reconnects by itself,
  backing off from about 1 s to 30 s with jitter, and at once when the browser is back online;
  every reconnect exchanges everything that changed. A heartbeat (`ping`, every 30 s and when the
  page shows again) finds a connection that died without a close and reconnects. When the server
  closes the socket for want of a session (code 4401: signed out elsewhere, revoked, expired, the
  account deleted), the app checks its session past Better Auth's cookie cache and signs out
  when it is gone. The cloud left of ⚙ shows Synced, Connecting…, Offline or Not syncing and
  opens Settings › Account.
- **Clock skew**: device clocks can be off. On sign-in, on every reconnect and every 30 minutes the
  app measures its offset from the server's clock (`GET /api/time`, three samples, the shortest
  round trip counts) and, when it is 250 ms or more, adds it to the app clock
  (`src/state/app-clock.ts`), which timers, the frame loop and the merge stamps read. Signed out
  the offset is 0. TinyBase ignores changes stamped more than 5 minutes ahead of its clock, so a
  device whose clock ran that far fast has its earlier changes ignored by the server; once the
  offset is known, the app reconnects as soon as server time is close enough to those stamps.
- **Ringing**: a timer's ringing is synced state, so every device with the app open rings, and a
  dismiss on any of them stops all. A timer reaching its end is no action: each device turns it
  to ringing by itself and writes that with a merge stamp just after the running state's
  (`src/sync/stamps.ts`), so a device that was closed while the timer ended cannot bring back an
  alarm dismissed, paused or reset elsewhere meanwhile. Browsers only play sound after the page
  has had a click or a key press; a device that has had none shows the notification (when
  allowed) without sound.
- **Signing out** stops sync and keeps the cards on the device. **Delete account** (it asks for
  `DELETE` typed) deletes the account, its sessions and the server's copy, and keeps the cards on
  the device. **Download server copy** saves what the server holds as JSON.
- **Desktop sign-in**: Google refuses OAuth inside an app's webview, so the desktop app signs in
  with device authorization: Settings › Account shows a code and opens the `/device` page in the
  system browser, where a signed-in visitor approves or denies it; the app then receives a bearer
  token, keeps it in its device store (never synced, never exported) and sends it with every API
  request and as the sync socket's subprotocol. The emailed code works on desktop too; the
  provider buttons are hidden there. See [Desktop](#desktop).

## Sync server

The server (`server/`, its own pnpm workspace package `@timer-app/server`) is a Cloudflare Worker:
Better Auth on D1, and TinyBase sync relayed to one Durable Object per user. Locally `wrangler dev`
runs all of it, with local D1 and Durable Objects and no Cloudflare account. Its routes, settings
and tests are in [server/README.md](server/README.md); deploying is [docs/deploy.md](docs/deploy.md).

```sh
cp server/.dev.vars.example server/.dev.vars   # local settings (gitignored); the defaults work
pnpm build                                     # once: wrangler dev needs dist/ to exist
pnpm server:migrate                            # create the auth tables in the local D1
pnpm server:dev                                # the server at http://127.0.0.1:8787
pnpm dev                                       # the app at http://localhost:5173, forwarding /api
```

- `.dev.vars` sets `APP_ENV=development`; `wrangler.jsonc` says `production`, so a deployed Worker
  never has the development endpoint.
- Without a mailer (`RESEND_API_KEY` unset) no email is sent: in development the sign-in code is
  printed in the `pnpm server:dev` console and `GET /__dev/otp?email=<address>` returns it; in
  production code requests are refused (no code is ever logged there).
- OAuth providers stay off until their variables are set (see the comments in `.dev.vars.example`).
  Apple needs an HTTPS domain, so it cannot be tried locally.
- `BETTER_AUTH_URL` is the origin the browser uses: `http://localhost:5173` with `pnpm dev`. To open
  the app on another origin (`pnpm preview` on 4173, or wrangler's own 8787, which serves `dist/`),
  set it to that origin or add the origin to `TRUSTED_ORIGINS`; otherwise the server refuses the
  session there (account actions fail with 403, the sync socket closes with 4401).
- Local accounts and synced data live in `server/.wrangler/state`; delete it to start over.
- After changing `wrangler.jsonc` or the variable names in `.dev.vars.example`, run
  `pnpm server:types` (`pnpm check` fails until the generated types match). After changing Better
  Auth's options, regenerate its schema with `pnpm --filter @timer-app/server run auth:schema` (the
  Better Auth CLI, package `auth`) and add a migration; see server/README.md.
- `compatibility_date` in `wrangler.jsonc` is pinned to the newest date the installed workerd
  runtime supports; move it with wrangler upgrades.

## Desktop

The desktop app is the same web app in a Tauri 2 shell (`src-tauri/`). Everything desktop-only sits
behind `src/platform` and shows in the UI only where the platform supports it. A build the Tauri
CLI runs is a desktop build (`__DESKTOP__` in the code, from `TAURI_ENV_PLATFORM`); a web build
leaves the desktop-only code out entirely (the Tauri services in `src/platform/tauri/`, the shell
wiring, the update prompt, the device sign-in's requests), and `pnpm build` fails if any of it, or
any `@tauri-apps/*` module, lands in a chunk the page loads at startup. In the desktop app the
Tauri services load lazily on first use.

```sh
pnpm tauri dev                          # debug build, with Vite on 5173 (hot reload)
pnpm tauri dev -- -- --minimized        # start hidden in the tray, as launch at login does
TIMER_SERVER_ORIGIN=https://timer.example.com pnpm tauri dev   # another sync server
TIMER_SERVER_ORIGIN=https://timer.example.com pnpm tauri build # a release build needs https (M6)
```

- **Tray and closing**: the app lives in the tray (the Windows notification area, the macOS menu
  bar; Linux shows the menu but has no click events): a click shows the window, and the menu has
  Show, "Start or pause the last card" and Quit, in the app's language. Closing the window hides
  it to the tray while a card (timer or stopwatch) runs or rings, so alarms still sound (spec
  Q11), or while the mini window is open, so a floating card stays; otherwise it quits. Settings ›
  Desktop can make it always hide or always quit (then the mini window closes with it). Quitting
  closes the mini window too. One instance runs: starting the app again brings the first one's
  window back.
- **Mini window**: `T`, the card header's button or the palette open the card in a small
  frameless window that floats above other apps (the `/mini?card=<id>` page, with its own copy of
  the stores, kept in step with the main window like a browser tab). Its pin turns floating off;
  its position is remembered; its title (for Alt+Tab and screen readers) names the card. Its
  buttons are mouse-sized (at least 32 px, not the cards' 44 px), to fit a 240×150 window. On the
  web the same card opens in a Document Picture-in-Picture window (Chrome and Edge); elsewhere the
  button is hidden. The `/mini` page in a plain browser tab (as the end-to-end tests open it) has
  no pin.
- **Global hotkeys** (Settings › Desktop, none at first): "Start or pause the last card" acts on
  the card last started, resumed or paused (else the selected one) without bringing the app
  forward; "Show or hide Timer App" toggles the window. They need Ctrl, Alt or Meta and are saved
  only once the OS has registered them; a combo another app holds shows "Another app uses …". One
  another app took before Timer App started shows that as soon as Settings › Desktop opens, which
  tries it again then. Settings › Keyboard points there.
- **Launch at login** (off at first) starts the app with `--minimized`: Windows writes
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (the shell quotes the program's path,
  which the autostart plugin leaves bare, and repairs an unquoted entry at every start), macOS a
  LaunchAgent in `~/Library/LaunchAgents`, Linux a `.desktop` file in `~/.config/autostart`. A
  change the OS refuses springs back, with a note that is also announced.
- **Accent color**: while Settings › Appearance › seed follows the OS (the default), the theme
  uses the system accent color (Windows, also live when it changes; macOS and GNOME at start), and
  the Color picker shows it and says so ("Use the system accent" goes back to it).
- **Notifications** are system notifications; on Windows a click brings the app back while the
  toast is on screen, elsewhere it may not reach the app (the tray does).
- **Sign-in** goes to `VITE_API_ORIGIN`, which a build under the Tauri CLI takes from
  `TIMER_SERVER_ORIGIN` (default `http://localhost:8787`, the local `wrangler dev`; M6 sets the
  production origin). A release build (`tauri build` without `--debug`) refuses an origin that is
  not `https://` (`TIMER_ALLOW_INSECURE_ORIGIN=1` allows one for a local test build). The server
  answers the desktop origins with CORS (`tauri.localhost`, plus `BETTER_AUTH_URL` and
  `TRUSTED_ORIGINS`; under `tauri dev` the webview's origin is Vite's `http://localhost:5173`, the
  default `BETTER_AUTH_URL`). "Open the browser" opens the server's approval page, on its
  `BETTER_AUTH_URL` origin; the panel also shows that page's address, and says so when the browser
  did not open. Signing out while the server is out of reach still signs out on this device (the
  token is dropped; the server's session ends when it expires). The bearer token is kept in the
  webview's storage like the other device settings, unencrypted, so any program running as the
  user can read it (an accepted risk until M6 moves it to the OS credential store).
- **Updates**: the updater checks 10 s after launch and every 6 hours and offers "Update …
  available" with Install and restart; Settings › About has a Check for updates row. Until M6
  adds the signing key, `tauri.conf.json` carries `UPDATER_PUBKEY_PLACEHOLDER`, so this build says
  updates aren't set up and never checks. `bundle.createUpdaterArtifacts` is on, so
  `pnpm tauri build` needs `TAURI_SIGNING_PRIVATE_KEY` (M6). The content security policy is still
  `null` (M6).
- **Permissions**: `src-tauri/capabilities/default.json` (the `main` window) and `mini.json` (the
  mini window) list what each window's page may call, the app's own commands included (`build.rs`
  declares them as permissions, `allow-<command>`, so a command no capability grants is refused).
  The mini window may only listen to events, drag itself, read the accent color and close and pin
  itself. The browser opener may open `https://` pages and, over plain HTTP, only the local
  `/device` pages (`http://localhost:5173/device*`, `http://localhost:8787/device*`; M6 narrows
  `https://**` to the production origin and GitHub). The debug-only `smoke_mark` command and its
  grant (`capabilities/debug/`, which `build.rs` reads only for debug builds) are not in release
  builds.

Where a desktop install keeps its data (the bundle identifier is `com.timerapp.dev` until the
final name, spec Q13):

| What                                   | Windows                                     | macOS                                            | Linux                             |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| Cards, settings, sign-in (web storage) | `%LOCALAPPDATA%\com.timerapp.dev\EBWebView` | WebKit's store for the app (`~/Library/WebKit`)  | `~/.local/share/com.timerapp.dev` |
| Window places (`.window-state.json`)   | `%APPDATA%\com.timerapp.dev`                | `~/Library/Application Support/com.timerapp.dev` | `~/.config/com.timerapp.dev`      |

### Desktop smoke test

`pnpm smoke:desktop` (Windows) runs the real app and checks what the unit and end-to-end tests
cannot reach. It starts `tauri dev` itself, drives the webview over the Chrome DevTools Protocol
(WebView2 with `--remote-debugging-port`) and the windows and keys through Win32 from PowerShell,
and reads timings from the `[smoke]` lines the debug build prints (`smoke_mark`). It checks that:

1. the main window opens, the tray menu follows the language, and the OS accent color seeds the
   theme;
2. a 60 s timer started from the keyboard rings within 1 s of its end while the window is hidden
   to the tray, the notification call succeeds, the alarm sound plays, and the tray icon brings
   the window back;
3. the mini window opens on top, Space there starts and pauses the card while the main grid
   follows, and Esc closes it;
4. a global hotkey recorded in Settings › Desktop starts and pauses the last-used card while
   another window has the focus, which keeps it;
5. desktop sign-in works against `wrangler dev` (started as the end-to-end tests start it): the
   approval page's URL is one the opener's scope allows (checked against the capability, not
   clicked, which would open your browser) and its address shows, a signed-in user approves the
   code, the token is stored, the sync socket connects, a card made on the desktop reaches the
   server, and Sign out clears the token;
6. closing with nothing running quits and saves the window's place; started again with
   `--minimized`, the app stays hidden in the tray, an alarm in the never-shown window still
   sounds, and a second instance exits and brings the window back where it was.

It writes `report.md`, `report.json`, screenshots and logs to `test-results/smoke-desktop`
(`--out <dir>` for another folder, which it empties first, so it refuses one that is or holds the
repository, or one outside `test-results/` that is neither empty nor an earlier run's output;
`--skip-sign-in` leaves out the sync server). It needs ports
5173, 8787 and 9333 free (`--cdp-port` picks another for the DevTools) and no Timer App running.
It uses a fresh WebView2 data folder inside the output folder, so your own cards and settings are
untouched, and puts the window-state file back afterwards. Every process it starts is killed with
its tree at the end, also on failure or Ctrl+C. The first run builds the debug app (minutes); later runs
take about five minutes, most of it the 60 s timer. Leave the keyboard and mouse alone while it
runs: it moves windows and presses keys.

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
