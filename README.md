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
see [Sync server](#sync-server).

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
keeps `test-results/` (traces of failures and the screenshots) as a build artifact. Deploying is a
separate, manual workflow (`.github/workflows/deploy.yml`; see [docs/deploy.md](docs/deploy.md)).

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
                  sync over BroadcastChannel, the bridge between the card store and the store; the
                  sync-server connection, the server-time offset, the API's address and the
                  client's copy of the server protocol (protocol.ts)
  state/          Reactive app state (.svelte.ts): card store, settings, presets, app data startup,
                  alarm, keyboard controller, auth state, the app clock (device clock plus the
                  server-time offset)
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
    account/      Sign-in form, sync status button, delete-account dialog, the /device page
  App.svelte      Wires the grid, keyboard layer, palette, cheat sheet, settings, alarm, snackbars,
                  sync status
  main.ts         Web entry point: starts the session check, loads the data, applies the
                  appearance and the language, starts sync while signed in, mounts the app, then
                  registers the service worker; on /device it shows the device approval page alone
  pwa.svelte.ts   Service worker registration and the "Update ready" state
messages/         Translations: en.json, zh-TW.json, ja.json
project.inlang/   Paraglide (inlang) project settings
public/           PWA icons and the favicon (generated from icon.svg by `pnpm icons`)
e2e/              Playwright end-to-end tests
server/           The sync server: Cloudflare Worker, Better Auth on D1, a Durable Object per user
src-tauri/        Tauri 2 desktop shell (Rust)
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
- **Desktop sign-in** (M5): the desktop app shows a code and opens `/device`, where a signed-in
  visitor approves or denies it.

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
