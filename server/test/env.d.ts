/** Bindings that only the tests have (see vitest.config.ts). */
declare namespace Cloudflare {
  interface Env {
    /** The D1 migrations, read from `migrations/` by the Vitest config. */
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}
