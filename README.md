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
| `pnpm tauri <cmd>` | Tauri CLI, e.g. `pnpm tauri dev`, `pnpm tauri build`                   |

CI (`.github/workflows/ci.yml`) runs `check`, `lint`, `test` and `build` on every push to `main`
and on pull requests.

## Layout

```
src/
  core/       Pure TypeScript engine: timer and stopwatch state machines, digit entry,
              formatting, frame ticker. No DOM, no Svelte, no Tauri. Tests sit next to each module.
  ui/         Svelte components
  main.ts     Web entry point
src-tauri/    Tauri 2 desktop shell (Rust)
docs/         Product spec and tech stack
```

Design rules that the code relies on are in
[docs/tech-stack.md › Architecture](docs/tech-stack.md#architecture). The most important one:
time is derived, never counted. State stores timestamps and the display is computed from the
current time, so timers stay correct across sleep, throttled tabs and reloads.

## License

MIT
