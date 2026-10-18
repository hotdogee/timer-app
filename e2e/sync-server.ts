/**
 * The sync server for the end-to-end tests, started by Playwright (`webServer` in
 * playwright.config.ts): `wrangler dev` on port 8787 in development mode, so `/__dev/otp` hands
 * the tests the sign-in codes, on a fresh local D1 and Durable Object state with the migrations
 * applied.
 *
 * Usage: `node e2e/sync-server.ts <public origin> [--serve-build]`
 *
 * - `<public origin>` is the origin the browser uses (Better Auth's `BETTER_AUTH_URL`): Vite's
 *   `http://localhost:5173` on the dev path, which proxies `/api` and `/__dev` to 8787, or
 *   `http://localhost:8787` on the preview path, where wrangler serves `dist/` itself.
 * - `--serve-build` (the preview path) requires the production build in `dist/`. Otherwise an
 *   empty `dist/` is enough (wrangler refuses to start without the folder) and is created if
 *   missing.
 *
 * The settings come from `server/.dev.vars.example` (development mode, a placeholder secret, no
 * mailer, no OAuth providers) rather than a developer's `server/.dev.vars`, which wrangler does
 * not read when `--env-file` is given: no real email is ever sent and no provider is configured.
 * The state lives in `server/.wrangler/e2e`, apart from `pnpm server:dev`'s `.wrangler/state`, so
 * a test run never wipes a developer's local accounts.
 *
 * Playwright stops the server by killing its process tree (`taskkill /T /F` on Windows), which
 * takes wrangler and workerd with it: wrangler is started directly with Node, so no intermediate
 * process exits and leaves it orphaned.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

/** The port Vite's proxy forwards to (vite.config.ts) and playwright.config.ts waits on. */
const SYNC_SERVER_PORT = 8787

const root = path.resolve(import.meta.dirname, '..')
const serverDir = path.join(root, 'server')
const distDir = path.join(root, 'dist')
/** Relative to `server/`, where wrangler runs. */
const persistTo = path.join('.wrangler', 'e2e')
const wrangler = path.join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

function fail(message: string): never {
  console.error(`[sync-server] ${message}`)
  process.exit(1)
}

function main(args: string[]): void {
  const publicOrigin = args.find((arg) => !arg.startsWith('--'))
  if (publicOrigin === undefined || !URL.canParse(publicOrigin)) {
    fail('usage: node e2e/sync-server.ts <public origin> [--serve-build]')
  }
  if (!existsSync(wrangler)) fail(`wrangler is not installed (${wrangler}); run pnpm install`)

  if (args.includes('--serve-build')) {
    if (!existsSync(path.join(distDir, 'index.html'))) {
      fail('dist/index.html is missing: run `pnpm build` before E2E_SERVER=preview')
    }
  } else if (!existsSync(distDir)) {
    // The dev path serves the app through Vite; wrangler only needs the folder to exist.
    mkdirSync(distDir)
  }

  // A fresh D1 and fresh Durable Objects for every run.
  rmSync(path.join(serverDir, persistTo), { recursive: true, force: true })
  const migrate = spawnSync(
    process.execPath,
    [wrangler, 'd1', 'migrations', 'apply', 'timer-app-auth', '--local', '--persist-to', persistTo],
    { cwd: serverDir, stdio: 'inherit' },
  )
  if (migrate.status !== 0)
    fail(`applying the D1 migrations failed (exit ${String(migrate.status)})`)

  const dev = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      '--port',
      String(SYNC_SERVER_PORT),
      '--persist-to',
      persistTo,
      '--env-file',
      '.dev.vars.example',
      '--var',
      'APP_ENV:development',
      '--var',
      `BETTER_AUTH_URL:${new URL(publicOrigin).origin}`,
      '--show-interactive-dev-session=false',
      // Errors only: the code the mailer logs for every sign-in would drown the test output.
      '--log-level',
      'error',
    ],
    { cwd: serverDir, stdio: 'inherit' },
  )
  const stop = (): void => {
    dev.kill()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  dev.on('exit', (code, signal) => {
    process.exit(code ?? (signal === null ? 0 : 1))
  })
}

main(process.argv.slice(2))
