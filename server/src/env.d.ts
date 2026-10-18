/**
 * Optional settings, read from `.dev.vars` locally and from Worker secrets in production (see
 * `.dev.vars.example`). `wrangler types` only types the names that are uncommented in the example,
 * so the optional ones are declared here. Each must be declared on both `Env` interfaces:
 * `Cloudflare.Env` types `env` from `cloudflare:workers`, the global `Env` types
 * `ExportedHandler<Env>` and `DurableObject<Env>`. A missing or blank value means "not configured".
 */

declare namespace Cloudflare {
  interface Env {
    TRUSTED_ORIGINS?: string
    RESEND_API_KEY?: string
    EMAIL_FROM?: string
    EMAIL_DAILY_LIMIT?: string
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    GITHUB_CLIENT_ID?: string
    GITHUB_CLIENT_SECRET?: string
    APPLE_CLIENT_ID?: string
    APPLE_TEAM_ID?: string
    APPLE_KEY_ID?: string
    APPLE_PRIVATE_KEY?: string
  }
}

interface Env {
  TRUSTED_ORIGINS?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  EMAIL_DAILY_LIMIT?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  APPLE_CLIENT_ID?: string
  APPLE_TEAM_ID?: string
  APPLE_KEY_ID?: string
  APPLE_PRIVATE_KEY?: string
}
