import path from 'node:path'

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

/**
 * Worker tests run inside workerd through the Cloudflare Vitest integration, with the bindings
 * from wrangler.jsonc (local D1, the SYNC Durable Object, ASSETS). Storage is isolated per test
 * file; `test/apply-migrations.ts` applies `migrations/` to each file's D1.
 *
 * The variables below stand in for `.dev.vars`: tests never depend on a developer's local file, so
 * every optional setting is pinned to "not configured" (blank) and tests that need one pass it in.
 * The secret is a placeholder.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            APP_ENV: 'development',
            BETTER_AUTH_URL: 'http://localhost:8787',
            BETTER_AUTH_SECRET: 'test-only-placeholder-secret-0123456789abcdef',
            TRUSTED_ORIGINS: '',
            RESEND_API_KEY: '',
            EMAIL_FROM: '',
            GOOGLE_CLIENT_ID: '',
            GOOGLE_CLIENT_SECRET: '',
            GITHUB_CLIENT_ID: '',
            GITHUB_CLIENT_SECRET: '',
            APPLE_CLIENT_ID: '',
            APPLE_TEAM_ID: '',
            APPLE_KEY_ID: '',
            APPLE_PRIVATE_KEY: '',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/apply-migrations.ts'],
    },
  }
})
