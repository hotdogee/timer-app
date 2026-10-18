# Tech stack

Proposed, last updated 2026-10-18. Open items are tagged **(Qn)**; see [spec.md › Open questions](spec.md#open-questions).

## Summary

One TypeScript web codebase, shipped two ways:

- **Web**: installable PWA that works offline.
- **Desktop**: Tauri 2 apps for Windows, macOS and Linux.
- **Mobile**: the responsive web app in v1; Tauri 2 iOS/Android apps in phase 2.
- **Sync**: cards sync across devices in v1 through our own sync server on Cloudflare Workers, using TinyBase.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | Tauri 2 | Small installers (~5–10 MB), low memory, fast startup. First-party plugins for tray, global shortcuts, notifications, single instance, updater. Can target iOS/Android later. |
| UI framework | Svelte 5 | Fine-grained reactivity: a ticking digit updates one text node, not a component tree. Built-in transitions and `animate:flip` for adding, removing and reordering cards. |
| Language / build | TypeScript 6.0 (strict), Vite 8 | TypeScript stays on 6.x until typescript-eslint supports the native TypeScript 7 compiler. |
| Package manager | pnpm 12 | Pinned through `packageManager` in `package.json`. |
| Lint / format | ESLint 10 (flat config, typescript-eslint, eslint-plugin-svelte), Prettier | |
| Styling | Plain CSS, custom properties as design tokens, container queries | Runtime theming is a variable swap with no re-render. Each card scales from its own container size, phone to 4K. |
| Color | `@material/material-color-utilities` | Builds Material 3 light and dark palettes from one seed color, with valid contrast. The default seed is the OS accent color (read through the platform interface), falling back to Google blue `#0B57D0`. Browsers return a fixed value for the CSS `AccentColor` keyword to prevent fingerprinting, so the web always uses the fallback; desktop reads the real accent through Tauri. The default seed's theme is precomputed into `src/ui/theme/default-theme.css` (a Vitest file snapshot; regenerate with `pnpm test -u`), so the color library (about 20 kB gzip) loads lazily and only for another seed. |
| Icons | Material Symbols (SVG, Apache 2.0) | Matches the card design. |
| Fonts | Roboto Flex (default) and Inter, variable, self-hosted via `@fontsource-variable` | Variable weight makes a font-weight setting cheap. Digits use `tabular-nums`. A per-language CJK fallback stack (`--font-cjk`) sits before `system-ui`, so Japanese never falls into a Chinese font. |
| Sound | Web Audio, synthesized | Built-in chime, bell and beep are generated in code: no audio assets, no licensing. Custom files are decoded with the same API. |
| i18n | Paraglide JS + `Intl` | Compiled, type-safe, tree-shaken messages. `Intl` handles times, numbers and plurals per locale. Messages live in `messages/{locale}.json` and compile to `src/paraglide/` (generated, not committed; `pnpm i18n:compile` runs before `check` and `test`). |
| Keyboard | Own keymap layer (may use `tinykeys`) | Every shortcut is rebindable and stored in settings. |
| Data store | TinyBase | Two stores: a synced `MergeableStore` (cards, presets, behavior settings) persisted to IndexedDB, and a device-only `Store` (appearance, language) persisted to localStorage, which is readable synchronously before the first paint. Both work in the browser and in the Tauri webview. Browser tabs stay in step through TinyBase's BroadcastChannel synchronizer. |
| Schemas | Valibot with versioned migrations | Validates settings and imported data. |
| Sync | TinyBase `MergeableStore` over WebSocket | Per-field newest-wins merge with hybrid logical clocks. The local store stays the source of truth. |
| Server | Cloudflare Workers + Durable Objects | One Durable Object per user holds their store in its built-in SQLite. Idle connections hibernate and cost nothing. See [Server](#server). |
| Auth | Better Auth 1.7 on D1 (built-in Kysely adapter) | Runs in our Worker with the `emailOTP`, `bearer` and `deviceAuthorization` plugins: email code, Google, Apple, GitHub (providers appear only when configured); rate limits and send limits in D1; sessions last 30 days. |
| Email | Resend | Sends sign-in codes; called from the Worker with `fetch`, English only for now. Without a key, production refuses to send; development logs the code and serves it on a dev-only endpoint for tests. |
| Offline / install | `vite-plugin-pwa` (Workbox `generateSW`, prompt mode) | Precaches the app, fonts and icons (about 610 KB); an update shows the "Update ready" snackbar. Not registered inside Tauri. |
| Unit tests | Vitest with fake timers; a `client` project (jsdom, fake-indexeddb, browser conditions) for rune-based modules | Timer engine, digit-entry parser, migrations, stores and persisters, settings dialog, auth state, sync controller with a fake WebSocket. |
| Server tests | Vitest with `@cloudflare/vitest-plugin` (workerd, real D1 with the migrations applied, real Durable Objects) | Auth flows and limits, the sync gate and the Durable Object, export, deletion, dev endpoint off in production. |
| E2E tests | Playwright (Chromium) | Keyboard flows, alarm orchestration, focus, responsive breakpoints, frame-loop checks; the page clock is faked, so timing tests are exact. Locally they run against the dev server, in CI against the production build. Light/dark screenshots are saved as artifacts, not pixel-asserted, because CI runs Linux and development runs Windows. Since M4 Playwright also starts `wrangler dev` (local D1 and Durable Objects, fresh state per run) and covers sign-in, two-device sync, the device page and clock offsets. |
| CI / release | GitHub Actions + `tauri-action` | Builds and signs for all three desktop OSes. |

## Alternatives considered

| Option | Verdict |
|---|---|
| Electron | Same Chromium on every OS, but ~100 MB+ installers and high memory for a timer. Fallback if Linux WebKitGTK performance becomes a blocker. |
| Flutter | Strong animation and native mobile, but its web build renders to a canvas: slow first load, weaker text input and accessibility. Web is a primary target. |
| React | Works, but per-frame updates must bypass React through refs. |
| SolidJS | Same performance model as Svelte with JSX syntax; smaller ecosystem. |
| PWA only | Simplest, but no tray, global hotkeys, reliable background alarms, or always-on-top outside Chromium. |

## Sync engine options

Researched 2026-10-17 for a self-hosted server. Needs: offline writes, realtime, per-field last-writer-wins, a tiny dataset, a TypeScript client.

How local-first sync works: each device keeps the full data locally and the UI only touches that copy. Every change gets a hybrid logical clock stamp. Devices exchange changes through a sync server over a WebSocket, and for each field the newest stamp wins, so every device converges on the same result in any arrival order. The server is needed because devices are rarely online at the same time; it stores and relays.

| Engine | Server we'd run | License | Offline writes | Auth | Notes |
|---|---|---|---|---|---|
| TinyBase | Node process + SQLite or Postgres | MIT | Yes | No | **Chosen.** MergeableStore is per-cell last-writer-wins with HLC stamps. Tiny client. Has a Cloudflare Durable Object server and SQLite persister. |
| Jazz | `jazz-run sync` (Node) + SQLite | MIT | Yes | Built in | Own CRDT data model. Identity is a local secret that needs backup. |
| InstantDB | JVM server + Postgres + email provider | Apache 2.0 | Yes | Built in | Heavy for our data; their VPS guide estimates ~$30/month. |
| Triplit | Node server | AGPL-3.0 | Yes | No | Last release July 2025. |
| Zero | Postgres + zero-cache + API server | not checked | **No** | No | Ruled out: no offline writes. |
| PowerSync Open Edition | Service + Postgres/MongoDB/MySQL + API | FSL server, Apache 2.0 clients | Yes | No | Ships SQLite (wasm) to the browser. |
| ElectricSQL | Elixir service + Postgres | Apache 2.0 | Build it ourselves | No | Read path only. |
| Yjs / Automerge | y-websocket, Hocuspocus or automerge-repo server | MIT | Yes | No | Built for collaborative text; overkill. |
| Replicache | Our own push/pull endpoints | Free, needs a license key | Yes | No | Superseded by Zero. |
| Hand-rolled | Our WebSocket server + SQLite or Postgres | Ours | Yes | No | Smallest; we own correctness. |

Sources: [TinyBase synchronizers](https://tinybase.org/guides/synchronization/using-a-synchronizer/), [Jazz sync and storage](https://jazz.tools/docs/sync-and-storage), [InstantDB self-hosting](https://instantdb.com/docs/self-hosting), [Triplit repo](https://github.com/aspen-cloud/triplit), [Zero: when to use](https://zero.rocicorp.dev/docs/when-to-use), [PowerSync self-hosting](https://docs.powersync.com/self-hosting), [PowerSync licensing](https://powersync.com/legal/overview), [Electric writes guide](https://electric-sql.com/docs/guides/writes), [Replicache options](https://doc.replicache.dev/api/interfaces/ReplicacheOptions), [TinyBase Durable Object SQL persister](https://tinybase.org/api/persister-durable-object-sql-storage/interfaces/persister/durableobjectsqlstoragepersister/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing), [Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## Architecture

```
src/
  core/       Pure TS, no DOM, no framework: timer and stopwatch engines, digit-entry parser, formatting, frame ticker, card model, keymap, settings schema
  platform/   One interface, two implementations (web, tauri): accent color, notifications, audio, wake timer, fullscreen, ids, windows, hotkeys
  state/      Reactive app state (.svelte.ts): card store, alarm orchestration, keyboard controller, shared timer actions (apply typed digits, then act), presets
  sync/       TinyBase stores (synced and device-only), IndexedDB and localStorage persisters, tab sync, first-run seed (stamped at time zero), cards bridge with stamped settles, reconnecting WebSocket synchronizer with heartbeat, server-time offset, protocol copy
  ui/         Components: theme (tokens, generated M3 scheme), primitives, card, grid, command palette, cheat sheet, settings dialog
  i18n/       Locale state and reactive messages (compiled messages in src/paraglide, generated)
  pwa/        Service worker registration and the update prompt (web only)
messages/     Translations: en.json, zh-TW.json, ja.json
public/       PWA icons and the favicon
e2e/          Playwright tests
src-tauri/    Rust shell and plugins
server/       Cloudflare Worker: routing, Better Auth, mailer and send limits, per-user SyncObject Durable Object, D1 migrations, workerd tests
```

Status after M4 (2026-10-18): `src/core`, `src/platform` (web implementations only), `src/state` (including auth and the sync preference), `src/sync` (stores, persisters, tab sync, seed, cards bridge, remote sync, clock offset), `src/i18n`, `src/pwa`, `src/ui` (theme, primitives, card, grid, palette, cheat sheet, announcer, settings, account), `server/` (its own workspace package), `messages/`, `public/`, `e2e/` and `src-tauri` exist, with tests next to each module. The Tauri side of `platform/` comes in M5.

Principles:

1. **Time is derived, never counted.** Store timestamps (`startedAt`, `endsAt`) and accumulated elapsed time; compute the display from the current time. Stays correct across sleep, throttled tabs, reloads and restarts.
2. **The timer engine is a pure state machine**: `idle → running ⇄ paused → ringing → idle`. Unit-tested with a fake clock.
3. **One render loop.** A single `requestAnimationFrame` loop drives every running card. Text is written only when the shown value changes. The loop stops when nothing is running.
4. **Platform features sit behind interfaces.** `core` and `ui` never import Tauri; the web build works on its own.
5. **Animate on the compositor where possible** (`transform`, `opacity`), and respect `prefers-reduced-motion`.
6. **Local first.** Every action applies locally and instantly. Sync runs in the background and never blocks the UI.

Core API notes from M1, for the UI work in M2:

- Engine functions return the input state by reference when nothing changes, so `===` detects no-ops. States are plain JSON data; store them in `$state.raw` and replace them whole.
- Read the frame clock once per user action (`bump()`), then pass that `now` to the transition, so state and display agree.
- Core exports `timer` and `stopwatch` as namespaces; the UI's state variables need other names.
- Done in M2: `isDigitKey` lives in the keymap, `stopwatch.lapRows` gives `{ split, duration }` rows, and `src/state/timer-actions.ts` holds the one "apply typed digits, then act" rule shared by keys, buttons and the palette.
- `formatClockTime` falls back to the runtime locale; pass the app locale once i18n exists.
- `formatOvertime` shows `0:00` for the first second of ringing, then `-0:01`. The hyphen-minus is not a tabular glyph; the designed card may prefer U+2212.
- Server-time offsets are rounded to whole milliseconds in `offsetClock`, so the ceil-based countdown never reads a second high.

Build and runtime notes from M2:

- Build target: Chrome 105, Edge 105, Firefox 110, Safari 16 (Windows Tauri builds: Chrome 105). The CSS needs container queries, `:has()` and logical properties; a lower JS target would down-level Svelte's private class fields into WeakMap helpers that run on every state write.
- Theme: a `<style id="theme">` block carries `:root`, `:root[data-theme="dark"]` and a `prefers-color-scheme` section with `--md-sys-color-*` roles plus the app surfaces (`--app-background`, `--card-surface`, `--card-tonal`); `applyTheme(seed)` replaces it and updates the `theme-color` metas.
- Fonts: own `@font-face` rules for the latin subset, so only two woff2 files ship (Roboto Flex 84 kB, Inter 48 kB); Inter is fetched only when selected. Icons: Material Symbols SVGs imported with `?raw`, path data rendered inline.
- Audio: one `AudioContext`, unlocked by the first gesture and suspended 2 s after the last sound, so an app left open all day keeps no audio thread; a ringing timer resumes it through sticky activation.
- Wake: `platform.wake` posts the next deadline to a module Worker (`wake.worker.ts`) because hidden tabs throttle timers; on `visibilitychange` every card is settled.
- Bundle after M2: main chunk about 52 kB gzip, lazy color chunk 20 kB, CSS 6 kB.

## Server

```
Client ──HTTPS──▶ Worker ── /api/auth/* ──▶ Better Auth ──▶ D1 (users, sessions)
       │                 └─ /time ────────▶ server clock, for skew correction
       └──WSS /sync──▶ Worker checks the session
                         └──▶ Durable Object, id = user id
                                TinyBase WsServerDurableObject
                                DurableObjectSqlStoragePersister (the user's cards)
```

- The same Worker serves the web app as static assets (`public/_headers` adds the page security headers).
- Auth gate: the browser uses the session cookie; desktop (M5) sends a bearer token in `Sec-WebSocket-Protocol: timer-auth.<token>`. The Worker forwards the upgrade to the user's Durable Object with the session id and expiry in internal headers; the object checks them on every message and closes sockets (4401) on sign-out, revocation or deletion. Heartbeat: client ping every 30 s, `setWebSocketAutoResponse` pong.
- Routes: `/api/auth/*`, `/api/time` (clock offset), `/api/config` (configured providers), `/api/sync` (WebSocket), `/api/export` (the user's store as JSON), `/__dev/otp` (development only).
- Durable Objects use the WebSocket Hibernation API, so idle devices cost nothing. The store is persisted in JSON mode (one row per user; our data is far below the 2 MB row limit).
- Free plan: 100,000 requests/day, and WebSocket messages count toward it. Fine for personal use; the Workers Paid plan ($5/month) once the app is public.
- Local development: `pnpm server:dev` runs `wrangler dev` on port 8787 with local D1 and Durable Objects, and Vite proxies `/api` and `/__dev` to it, so the session cookie is first-party. End-to-end runs use their own state directory. Deployment: [deploy.md](deploy.md) and the manual `deploy.yml` workflow (secrets only on the migrate and deploy steps). The Worker bundle is minified with source maps uploaded (about 263 kB gzip).
- Exit path: TinyBase also ships a Node `WsServer`, and Better Auth runs on Node, so the server can move to a VPS later.

## Platform notes

### Tauri webviews

| OS | Engine | Note |
|---|---|---|
| Windows | WebView2 (Chromium) | Best behaved. |
| macOS | WKWebView (Safari's WebKit) | Test Safari-specific CSS. |
| Linux | WebKitGTK | Weakest animation performance; test early. |

### Background alarms

- **Web**: Chrome delays timers in hidden tabs (up to 1 minute after 5 minutes hidden). Track alarm deadlines in a Web Worker, show a `Notification`, and unlock audio during the Start click.
- **Desktop**: schedule alarms in Rust, fire native notifications, keep running in the tray when the window closes.
- **Mobile web**: cannot ring reliably while the phone is locked. Store apps would need native scheduled notifications.

### Tauri plugins planned

`notification`, `global-shortcut`, `single-instance`, `window-state`, `updater`, `autostart` (opt-in), `deep-link` (sign-in redirect from the system browser), plus the core `tray-icon` feature. No `store` plugin: TinyBase on IndexedDB holds all app data.

Bundle identifier: `com.timerapp.dev` is a placeholder until the final name is chosen (spec Q13). The content security policy in `tauri.conf.json` is still `null`; set a real one before release.

## Shipping

- **Windows**: Authenticode code signing, otherwise SmartScreen warns on install.
- **macOS**: Developer ID signing and notarization (Apple Developer Program, $99/year).
- **Linux**: AppImage, `.deb`, `.rpm`.
- **Auto-update**: `tauri-plugin-updater` with signed update manifests.
- **Web**: served by the same Cloudflare Worker as the sync server; a service worker precaches the app.
- **License**: MIT.
- **Channels**: GitHub Releases (installers and auto-update feed), winget, Homebrew, Microsoft Store.
- **Microsoft Store**: Tauri builds EXE/MSI, not MSIX, so the listing points at our own signed offline installer. Requirements: WebView2 offline install mode (`tauri.microsoftstore.conf.json`), silent install (`/S` or `/quiet`), publisher name different from product name. Our Windows signing is still required, and updates still come from our updater. See [Tauri: Microsoft Store](https://v2.tauri.app/distribute/microsoft-store/).

## Changelog

- 2026-10-17: Initial proposal.
- 2026-10-17: Chose Svelte 5. Added cross-device sync to v1. Store apps moved to phase 2.
- 2026-10-17: Sync runs on our own server. Added sync engine comparison. Proposed Better Auth.
- 2026-10-17: Chose TinyBase on Cloudflare Workers + Durable Objects (SQLite), Better Auth on D1. TinyBase replaces the separate storage adapter.
- 2026-10-17: MIT license. Channels: GitHub Releases, winget, Homebrew, Microsoft Store. Email: Resend.
- 2026-10-17: M1 done. Scaffolded pnpm 12, Vite 8, Svelte 5.57, TypeScript 6.0, Vitest 5, ESLint 10, Prettier, GitHub Actions CI. Implemented `src/core` (timer, stopwatch, digit entry, format, ticker; 641 tests), Tauri 2.12 scaffold (`cargo check` clean), dev harness. Removed the `store` plugin from the plan; TinyBase holds all data.
- 2026-10-18: M2 done. Material 3 timer and stopwatch cards, responsive grid with edit mode and drag or keyboard reorder, rebindable keymap and keyboard controller, command palette, cheat sheet, alarm orchestration (synthesized sounds, notifications, wake worker), fullscreen with overlay fallback, Playwright e2e (50 tests) in CI; 1371 unit tests. Card colors use palette tones instead of `surface-container`; the default theme is precomputed; build target raised to Chrome 105 / Safari 16.
- 2026-10-18: M3 planned. The device-only store moves from IndexedDB to localStorage (synchronous read before the first paint). Vitest gains a `client` project (jsdom, browser conditions) for rune-based modules. Placeholder PWA icon (spec Q22).
- 2026-10-18: M3 done. TinyBase 10 synced `MergeableStore` on IndexedDB (3 s open timeout, memory fallback, never seeds over another tab) and a device store on localStorage, tabs in step over BroadcastChannel; Valibot settings and export schemas with migrations; settings dialog (appearance, behavior, keyboard rebinding, presets editor, data export/import, about) in a lazy chunk; Paraglide JS 2 messages for en, zh-TW and ja with live switching and per-language CJK font stacks; `vite-plugin-pwa` with a placeholder icon set; Vitest `client` project; 1903 unit tests, 79 Playwright tests. Bundle: main 89 kB gzip, settings 22 kB lazy, color library 20 kB lazy; rolldown `manualPureFunctions` drops unused TinyBase modules.
- 2026-10-18: M4 done. `server/` workspace package: Cloudflare Worker with Better Auth 1.7 on D1 (email code, Google, GitHub, Apple; bearer and device-authorization plugins), one `SyncObject` Durable Object per user (TinyBase `WsServerDurableObject`, SQLite JSON persister), `/api/time`, `/api/config`, `/api/export`; `@cloudflare/vitest-plugin` tests on workerd (99). Client: auth state on the Better Auth client, reconnecting WebSocket synchronizer with heartbeat and session re-checks, clock offset through `appClock`, Account section, `/device` approval page, sync status button. Playwright starts `wrangler dev` beside Vite (103 e2e tests); 2131 unit tests. Deviations: `APP_ENV` defaults to production in `wrangler.jsonc`; the `?token=` fallback was dropped (subprotocol only); seed rows stamped at time zero; `partysocket` replaced by a small reconnecting socket. Bundle: startup JS 116 kB gzip (entry 68 kB plus a shared 48 kB chunk holding the Svelte runtime, Valibot and the 11 kB Better Auth client), total 177 kB; precache 728 KB. Docs: deploy.md, privacy.md (draft, Q23).
