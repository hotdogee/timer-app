import { defineConfig, devices } from '@playwright/test'

const ci = Boolean(process.env.CI)

/**
 * Which server the tests run against. `dev` (the local default) serves the source through Vite and
 * reuses a dev server that is already running. `preview` (the CI default) serves the production
 * build, so run `pnpm build` first. Override with `E2E_SERVER=dev|preview`.
 */
const server = process.env.E2E_SERVER ?? (ci ? 'preview' : 'dev')
const port = server === 'preview' ? 4173 : 5173
const baseURL = `http://localhost:${port}`

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
  webServer: {
    command: server === 'preview' ? `pnpm preview --port ${port} --strictPort` : 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
})
