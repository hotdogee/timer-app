/**
 * Reading the Worker's settings (`Env` variables and secrets). Optional settings are "not
 * configured" when missing or blank, so an empty line in `.dev.vars` behaves like no line.
 */
import type { AppEnv } from './protocol'

/** Names of the optional string settings declared in `env.d.ts`. */
export type OptionalSetting =
  | 'TRUSTED_ORIGINS'
  | 'RESEND_API_KEY'
  | 'EMAIL_FROM'
  | 'EMAIL_DAILY_LIMIT'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'GITHUB_CLIENT_ID'
  | 'GITHUB_CLIENT_SECRET'
  | 'APPLE_CLIENT_ID'
  | 'APPLE_TEAM_ID'
  | 'APPLE_KEY_ID'
  | 'APPLE_PRIVATE_KEY'

/** The trimmed value of an optional setting, or undefined when it is missing or blank. */
export function setting(env: Env, name: OptionalSetting): string | undefined {
  const value = env[name]?.trim()
  if (!value) return undefined
  return value
}

/** The server's mode. Only the exact value `development` turns development behavior on. */
export function appEnv(env: Env): AppEnv {
  return env.APP_ENV === 'development' ? 'development' : 'production'
}

/** Whether development-only behavior (the `/__dev/otp` endpoint, the code log) is on. */
export function isDevelopment(env: Env): boolean {
  return appEnv(env) === 'development'
}

/** The origin (scheme, host, port) of a URL, or undefined when it does not parse. */
export function originOf(url: string): string | undefined {
  try {
    const { origin } = new URL(url)
    return origin === 'null' ? undefined : origin
  } catch {
    return undefined
  }
}

/**
 * Origins allowed to call the auth API with cookies: `BETTER_AUTH_URL`'s origin, then every valid
 * entry of the comma-separated `TRUSTED_ORIGINS`, without duplicates. Invalid entries are dropped
 * (with a warning) instead of widening the list.
 */
export function trustedOrigins(env: Env): string[] {
  const origins = new Set<string>()
  const base = originOf(env.BETTER_AUTH_URL)
  if (base) origins.add(base)
  for (const entry of (setting(env, 'TRUSTED_ORIGINS') ?? '').split(',')) {
    const value = entry.trim()
    if (!value) continue
    const origin = originOf(value)
    if (origin) origins.add(origin)
    else console.warn(`[config] Ignoring TRUSTED_ORIGINS entry that is not a URL: ${value}`)
  }
  return [...origins]
}
