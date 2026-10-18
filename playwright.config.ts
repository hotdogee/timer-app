import { defineConfig, devices } from '@playwright/test'

const ci = Boolean(process.env.CI)

/**
 * Which servers the tests run against. Every run starts the sync server: `wrangler dev` on port
 * 8787 in development mode, on a fresh local D1 and Durable Object state with the migrations
 * applied (e2e/sync-server.ts). A wrangler already listening on 8787 fails the run rather than
 * being reused, since its state and settings are unknown.
 *
 * - `dev` (the local default): Vite's dev server on 5173 serves the source and proxies `/api` and
 *   `/__dev` to wrangler (vite.config.ts); a Vite dev server that is already running is reused.
 * - `preview` (the CI default): the production build as production serves it, with wrangler
 *   serving `dist/` and the API at one origin on 8787. Run `pnpm build` first.
 *
 * Override with `E2E_SERVER=dev|preview`.
 */
const server = process.env.E2E_SERVER ?? (ci ? 'preview' : 'dev')
const preview = server === 'preview'
const syncPort = 8787
const baseURL = preview ? `http://localhost:${String(syncPort)}` : 'http://localhost:5173'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    // The app follows the browser's language; the specs read English unless they choose another.
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'sync server',
      command: `node e2e/sync-server.ts ${baseURL}${preview ? ' --serve-build' : ''}`,
      // wrangler listens on IPv4 only.
      url: `http://127.0.0.1:${String(syncPort)}/api/time`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    ...(preview
      ? []
      : [
          {
            name: 'vite',
            command: 'pnpm dev',
            url: baseURL,
            reuseExistingServer: !ci,
            timeout: 120_000,
          },
        ]),
  ],
})
