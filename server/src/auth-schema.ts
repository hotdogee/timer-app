/**
 * Config file for the Better Auth CLI only (`pnpm --filter @timer-app/server auth:schema`): the
 * same options as the Worker's `createAuth`, on an empty in-memory SQLite database, so `auth
 * generate` writes the full schema to `migrations/0001_auth.sql`. The Worker never imports this.
 *
 * Runs in Node, so it must not import `cloudflare:*` modules. Values here are placeholders: the
 * schema does not depend on them (social providers add no tables).
 */
import { betterAuth } from 'better-auth'
import { DatabaseSync } from 'node:sqlite'

import { authOptions } from './auth-options'

export const auth = betterAuth({
  ...authOptions({
    baseURL: 'http://localhost:8787',
    secret: 'schema-generation-placeholder-secret-0123456789',
    trustedOrigins: ['http://localhost:8787'],
    socialProviders: {},
    sendCode: () => Promise.resolve(),
    allowCodeEmail: () => Promise.resolve(),
    endSession: () => Promise.resolve(),
    wipeUser: () => Promise.resolve(),
    purgeUser: () => Promise.resolve(),
    runInBackground: () => undefined,
  }),
  database: new DatabaseSync(':memory:'),
})
