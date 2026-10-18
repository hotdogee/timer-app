/** Vitest setup file: applies the D1 migrations (idempotent) before each test file runs. */
import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
