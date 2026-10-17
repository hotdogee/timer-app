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

| Command            | What it does                                                           |
| ------------------ | ---------------------------------------------------------------------- |
| `pnpm dev`         | Vite dev server with hot reload                                        |
| `pnpm build`       | Production web build into `dist/`                                      |
| `pnpm preview`     | Serve the production build locally                                     |
| `pnpm check`       | Type-check: `svelte-check` for `src/`, `tsc` for the root config files |
| `pnpm lint`        | ESLint (type-aware) and Prettier check                                 |
| `pnpm format`      | Format every file with Prettier                                        |
| `pnpm test`        | Run the unit tests once (Vitest)                                       |
| `pnpm test:watch`  | Run the unit tests in watch mode                                       |
| `pnpm test:e2e`    | Run the end-to-end tests (Playwright, Chromium)                        |
| `pnpm test:e2e:ui` | Run the end-to-end tests in Playwright's UI mode                       |
| `pnpm tauri <cmd>` | Tauri CLI, e.g. `pnpm tauri dev`, `pnpm tauri build`                   |

The end-to-end tests need Chromium once: `pnpm exec playwright install chromium`. Locally they run
against the dev server (`pnpm dev`, reused when it is already running); set `E2E_SERVER=preview`
to test the production build instead (run `pnpm build` first). Time-dependent tests drive the
page with Playwright's fake clock, so they are exact and fast. Screenshots of the grid in light and
dark mode are saved under `test-results/` for review; they are not compared pixel by pixel.

CI (`.github/workflows/ci.yml`) runs `check`, `lint`, `test`, `build` and the end-to-end tests
(against the production build) on every push to `main` and on pull requests, and keeps
`test-results/` (traces of failures and the screenshots) as a build artifact.

## Layout

```
src/
  core/         Pure TypeScript engine: timer and stopwatch state machines, digit entry,
                formatting, frame ticker, card list model, keymap. No DOM, no Svelte, no Tauri.
  platform/     Browser and OS services behind small interfaces (notifications, alarm audio,
                background wake-up worker, fullscreen, ids, accent color); web implementations now,
                Tauri pieces later
  state/        Reactive app state (.svelte.ts): card store, alarm, keyboard controller, presets
  ui/
    theme/      Material 3 color scheme from a seed color, design tokens, fonts
    primitives/ Icon, Button, IconButton, Chip, Dialog, Menu, Snackbar
    card/       The timer and stopwatch cards
    grid/       Card grid, action bar, "+ Timer" menu, drag reorder
    palette/    Command palette and the shortcut cheat sheet's data
  App.svelte    Wires the grid, keyboard layer, palette, cheat sheet, alarm and undo snackbar
  main.ts       Web entry point: applies the theme, then mounts the app
e2e/            Playwright end-to-end tests
src-tauri/      Tauri 2 desktop shell (Rust)
docs/           Product spec and tech stack
```

Unit tests sit next to the module they test (`*.test.ts`).

The app is keyboard first: type digits to set the selected timer, `Enter` or `Space` to start,
arrows to move between cards, `Ctrl+K` (`⌘K` on macOS) for the command palette and `?` for every
shortcut. See [docs/spec.md › Keyboard](docs/spec.md#keyboard).

Design rules that the code relies on are in
[docs/tech-stack.md › Architecture](docs/tech-stack.md#architecture). The most important one:
time is derived, never counted. State stores timestamps and the display is computed from the
current time, so timers stay correct across sleep, throttled tabs and reloads.

## License

MIT
