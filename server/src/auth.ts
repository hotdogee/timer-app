/**
 * Better Auth on D1 for the Worker: email codes, Google, GitHub and Apple, bearer tokens (desktop)
 * and the device authorization flow (desktop sign-in through the browser).
 *
 * `createAuth(env)` builds one instance per `env` object (in practice one per isolate) and caches
 * it, including the configured provider list and the Apple client secret, which is signed once.
 * `authenticate(request, env)` resolves the signed-in user of a request for our own endpoints.
 */
import { betterAuth, type SocialProviders } from 'better-auth'
import { waitUntil } from 'cloudflare:workers'

import { APPLE_ORIGIN, createAppleClientSecret } from './apple'
import { authOptions } from './auth-options'
import { originOf, setting, trustedOrigins, type OptionalSetting } from './config'
import { DESKTOP_ORIGINS } from './cors'
import { isWebSocketUpgrade } from './http'
import { createMailer } from './mail'
import { PROVIDERS, tokenFromSubprotocols, type Provider } from './protocol'
import { addressKey, createCodeEmailGate } from './send-limit'
import { userSyncStub } from './sync-object'

/** Email-code types Better Auth may have pending rows for (`<type>-otp-<email>`). */
const OTP_TYPES = ['sign-in', 'email-verification', 'forget-password', 'change-email']

/** Deletes a deleted user's leftover device codes and pending email codes. */
async function purgeUser(db: D1Database, user: { id: string; email: string }): Promise<void> {
  const email = user.email.toLowerCase()
  await db.batch([
    db.prepare('DELETE FROM "deviceCode" WHERE "userId" = ?').bind(user.id),
    ...OTP_TYPES.map((type) =>
      db.prepare('DELETE FROM "verification" WHERE "identifier" = ?').bind(`${type}-otp-${email}`),
    ),
    db.prepare('DELETE FROM "sendLimit" WHERE "key" = ?').bind(await addressKey(email)),
  ])
}

/**
 * Better Auth for `env`. `origins` are the origins trusted with cookies (`BETTER_AUTH_URL`'s and
 * `TRUSTED_ORIGINS`). Better Auth also trusts the desktop app's origins, whose sign-in requests
 * (an emailed code, the device flow) carry their `Origin` but no cookies, and Apple's for its
 * form_post callback when Apple is configured.
 */
function buildAuth(env: Env, socialProviders: SocialProviders, origins: readonly string[]) {
  const mailer = createMailer(env)
  return betterAuth({
    ...authOptions({
      baseURL: env.BETTER_AUTH_URL,
      secret: env.BETTER_AUTH_SECRET,
      trustedOrigins: [
        ...origins,
        ...DESKTOP_ORIGINS,
        // Apple posts the OAuth result back to the callback (form_post) from its own origin.
        ...(socialProviders.apple ? [APPLE_ORIGIN] : []),
      ],
      socialProviders,
      sendCode: (email, otp) => mailer.sendCode(email, otp),
      allowCodeEmail: createCodeEmailGate(env),
      endSession: (session) => userSyncStub(env, session.userId).closeSession(session.id),
      wipeUser: (userId) => userSyncStub(env, userId).wipe(),
      purgeUser: (user) => purgeUser(env.DB, user),
      runInBackground: (promise) => {
        waitUntil(promise)
      },
    }),
    database: env.DB,
  })
}

/** The Better Auth instance of this Worker. */
export type Auth = ReturnType<typeof buildAuth>

/** A signed-in user and their session, as `getSession` returns them. */
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

export interface AuthContext {
  readonly auth: Auth
  /** The OAuth providers that are configured and usable, in {@link PROVIDERS} order. */
  readonly providers: readonly Provider[]
  /**
   * The origins whose cookies count on a sync upgrade: `BETTER_AUTH_URL`'s and `TRUSTED_ORIGINS`
   * (not Apple's, which only posts the OAuth callback). Read once per isolate.
   */
  readonly cookieOrigins: readonly string[]
}

/** The client id and secret of a provider, or undefined (with a warning when only one is set). */
function credentials(
  env: Env,
  label: string,
  idName: OptionalSetting,
  secretName: OptionalSetting,
): { clientId: string; clientSecret: string } | undefined {
  const clientId = setting(env, idName)
  const clientSecret = setting(env, secretName)
  if (clientId && clientSecret) return { clientId, clientSecret }
  if (clientId ?? clientSecret) {
    console.warn(`[auth] ${label} sign-in is off: set both ${idName} and ${secretName}.`)
  }
  return undefined
}

/** Apple's options, signing the client secret; undefined when Apple is not (fully) configured. */
async function appleOptions(
  env: Env,
): Promise<{ clientId: string; clientSecret: string } | undefined> {
  const clientId = setting(env, 'APPLE_CLIENT_ID')
  const teamId = setting(env, 'APPLE_TEAM_ID')
  const keyId = setting(env, 'APPLE_KEY_ID')
  const privateKey = setting(env, 'APPLE_PRIVATE_KEY')
  if (!clientId || !teamId || !keyId || !privateKey) {
    if (clientId ?? teamId ?? keyId ?? privateKey) {
      console.warn(
        '[auth] Apple sign-in is off: set APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY.',
      )
    }
    return undefined
  }
  try {
    const clientSecret = await createAppleClientSecret({ clientId, teamId, keyId, privateKey })
    return { clientId, clientSecret }
  } catch (error) {
    // Never log the key itself.
    const reason = error instanceof Error ? error.name : 'unknown error'
    console.error(
      `[auth] Apple sign-in is off: APPLE_PRIVATE_KEY is not a valid ES256 PKCS #8 key (${reason}).`,
    )
    return undefined
  }
}

/** Shortest `BETTER_AUTH_SECRET` accepted. */
export const MIN_SECRET_LENGTH = 32

/**
 * Fails closed on a missing or short secret (Better Auth would fall back to a public default) or a
 * `BETTER_AUTH_URL` that is not a URL. The messages name the setting, never its value.
 */
function assertAuthSettings(env: Env): void {
  const secret: unknown = env.BETTER_AUTH_SECRET
  if (typeof secret !== 'string' || secret.trim().length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be set to ${String(MIN_SECRET_LENGTH)} or more random characters.`,
    )
  }
  const url: unknown = env.BETTER_AUTH_URL
  if (typeof url !== 'string' || !originOf(url)) {
    throw new Error('BETTER_AUTH_URL must be the public origin, for example https://timer.example.')
  }
}

async function buildAuthContext(env: Env): Promise<AuthContext> {
  assertAuthSettings(env)
  const socialProviders: SocialProviders = {}
  const google = credentials(env, 'Google', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')
  if (google) socialProviders.google = { ...google, prompt: 'select_account' }
  const github = credentials(env, 'GitHub', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET')
  if (github) socialProviders.github = github
  const apple = await appleOptions(env)
  if (apple) socialProviders.apple = apple
  const providers = PROVIDERS.filter((id) => socialProviders[id] !== undefined)
  const cookieOrigins = trustedOrigins(env)
  const auth = buildAuth(env, socialProviders, cookieOrigins)
  // Finish Better Auth's lazy init inside the request that builds it: a Worker must not leave
  // I/O pending for a later request to await.
  await auth.$context
  return { auth, providers, cookieOrigins }
}

const contexts = new WeakMap<Env, Promise<AuthContext>>()

/** The cached auth instance and provider list for `env`; a failed build is retried next time. */
export function createAuth(env: Env): Promise<AuthContext> {
  let context = contexts.get(env)
  if (!context) {
    context = buildAuthContext(env)
    contexts.set(env, context)
    context.catch(() => contexts.delete(env))
  }
  return context
}

/**
 * The signed-in user of `request`, or null. Accepts the session cookie (the web app) or a bearer
 * token (`Authorization: Bearer <token>`, the desktop app). Browsers cannot set headers on a
 * WebSocket, so an upgrade may carry the token in a `timer-auth.<token>` subprotocol instead,
 * which takes precedence over a cookie. Never in the URL: Workers Logs record every URL.
 *
 * On upgrades a cookie only counts when the `Origin` (if any) is trusted, which blocks cross-site
 * WebSocket hijacking from sibling subdomains that SameSite=Lax would let through.
 *
 * The session is always read from D1 (no cookie cache, no refresh), so a signed-out or deleted
 * account is refused at once.
 */
export async function authenticate(request: Request, env: Env): Promise<AuthSession | null> {
  const { auth, cookieOrigins } = await createAuth(env)
  const headers = new Headers(request.headers)
  if (isWebSocketUpgrade(request)) {
    const origin = headers.get('Origin')
    if (origin !== null && !cookieOrigins.includes(originOf(origin) ?? origin)) {
      headers.delete('Cookie')
    }
    if (!headers.has('Authorization')) {
      const token = tokenFromSubprotocols(headers.get('Sec-WebSocket-Protocol'))
      if (token) headers.set('Authorization', `Bearer ${token}`)
    }
  }
  return auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } })
}
