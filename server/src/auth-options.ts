/**
 * The Better Auth configuration, without the database. `auth.ts` adds D1 and the Worker's
 * dependencies; `auth-schema.ts` adds an in-memory SQLite database so the Better Auth CLI can
 * generate the migration from exactly the same options (plugins decide the tables).
 *
 * Kept free of `cloudflare:*` imports so the CLI can load it in Node.
 */
import type { BetterAuthOptions, SocialProviders } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { bearer } from 'better-auth/plugins/bearer'
import { deviceAuthorization } from 'better-auth/plugins/device-authorization'
import { emailOTP } from 'better-auth/plugins/email-otp'

import {
  API_PATHS,
  DESKTOP_CLIENT_ID,
  DEVICE_VERIFICATION_PATH,
  OTP_EXPIRES_IN_SECONDS,
  OTP_LENGTH,
} from './protocol'

/** Sessions last 30 days and are extended once a day while used. */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24

/** Wrong codes allowed per emailed code; the next attempt locks that code out. */
export const OTP_ALLOWED_ATTEMPTS = 5

/** The endpoint that makes and mails a sign-in code. */
export const SEND_CODE_PATH = '/email-otp/send-verification-otp'

/**
 * Per-IP rate limits (Better Auth's, on D1 so every isolate shares them), in requests per window
 * of seconds. The default covers every endpoint without a rule of its own. Each allowed request
 * costs one D1 write, so the default stays modest; docs/deploy.md adds a Cloudflare rate-limiting
 * rule in front for the free plan's write budget.
 */
export const RATE_LIMITS = {
  default: { window: 60, max: 60 },
  rules: {
    [SEND_CODE_PATH]: { window: 60, max: 3 },
    '/sign-in/email-otp': { window: 60, max: 10 },
    // The device plugin's own rule would allow 5 per 15 minutes; the approval page claims the code
    // (`GET /device`) before every Approve or Deny, so a few tries from one household would lock
    // everyone there out for a quarter of an hour.
    '/device': { window: 60, max: 10 },
    // Unauthenticated, and each call adds a row: the desktop app asks once per sign-in.
    '/device/code': { window: 60, max: 5 },
  },
} as const

/** Prefix of every auth cookie (`timer.session_token`, `timer.session_data`, …). */
export const COOKIE_PREFIX = 'timer'

/**
 * Better Auth endpoints we turn off: the email-code password reset and email change flows. The app
 * has no passwords (`emailAndPassword` is off) and does not let users change their email yet.
 */
export const DISABLED_AUTH_PATHS = [
  '/email-otp/request-password-reset',
  '/forget-password/email-otp',
  '/email-otp/reset-password',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
]

/** What the options need from the environment. */
export interface AuthSetup {
  /** `BETTER_AUTH_URL`: the public origin the browser talks to. */
  readonly baseURL: string
  readonly secret: string
  readonly trustedOrigins: string[]
  /** The configured OAuth providers only. */
  readonly socialProviders: SocialProviders
  /** Delivers a sign-in code (the mailer). */
  readonly sendCode: (email: string, otp: string) => Promise<void>
  /**
   * Runs before a sign-in code for `email` is made and mailed; throws an `APIError` to refuse
   * (the per-address and daily limits, no mailer), so a refused request never replaces the code
   * the address is waiting for.
   */
  readonly allowCodeEmail: (email: string) => Promise<void>
  /**
   * A session was deleted (signed out, revoked, cleaned up after expiry): disconnects the sync
   * sockets opened with it. Not called while the account itself is deleted (`wipeUser` does).
   */
  readonly endSession: (session: { id: string; userId: string }) => Promise<void>
  /** Deletes the user's synced data; runs before Better Auth deletes the user's rows. */
  readonly wipeUser: (userId: string) => Promise<void>
  /** Deletes what Better Auth leaves behind (device codes, pending codes); runs after it. */
  readonly purgeUser: (user: { id: string; email: string }) => Promise<void>
  /** Keeps background work (sending mail) alive after the response, e.g. `waitUntil`. */
  readonly runInBackground: (promise: Promise<unknown>) => void
}

export function authOptions(setup: AuthSetup) {
  return {
    appName: 'Timer App',
    baseURL: setup.baseURL,
    // OAuth failures Better Auth cannot send back to the app's own callback URL (a callback with
    // an expired or unknown state, say) go to the app instead of Better Auth's English error page;
    // the app reads `?error=` and shows Settings › Account with a localized message.
    onAPIError: { errorURL: new URL('/', setup.baseURL).href },
    secret: setup.secret,
    basePath: API_PATHS.auth,
    trustedOrigins: setup.trustedOrigins,
    emailAndPassword: { enabled: false },
    socialProviders: setup.socialProviders,
    disabledPaths: DISABLED_AUTH_PATHS,
    plugins: [
      emailOTP({
        // Only sign-in codes are ever mailed (no passwords, no email verification links).
        sendVerificationOTP: ({ email, otp, type }) =>
          type === 'sign-in' ? setup.sendCode(email, otp) : Promise.resolve(),
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: OTP_ALLOWED_ATTEMPTS,
        // D1 keeps each code encrypted with the auth secret, so a resend can mail the same code
        // again: asking for another code (or someone else asking for this address) never kills
        // the one already in the inbox, and its wrong-attempt count carries over.
        storeOTP: 'encrypted',
        resendStrategy: 'reuse',
      }),
      bearer(),
      deviceAuthorization({
        verificationUri: DEVICE_VERIFICATION_PATH,
        expiresIn: '15m',
        interval: '5s',
        validateClient: (clientId) => clientId === DESKTOP_CLIENT_ID,
      }),
    ],
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: {
      enabled: true,
      // Shared by every isolate (memory storage would be per isolate).
      storage: 'database',
      window: RATE_LIMITS.default.window,
      max: RATE_LIMITS.default.max,
      // Custom rules win over the plugins' own (Better Auth resolves them last).
      customRules: RATE_LIMITS.rules,
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SEND_CODE_PATH) return
        const body: unknown = ctx.body
        if (typeof body !== 'object' || body === null) return
        const { email, type } = body as { email?: unknown; type?: unknown }
        // Only sign-in codes are ever mailed (see sendVerificationOTP).
        if (type === 'sign-in' && typeof email === 'string') await setup.allowCodeEmail(email)
      }),
    },
    databaseHooks: {
      session: {
        delete: {
          after: async (session, context) => {
            // Deleting the account wipes the user's object and closes its sockets itself.
            if (context?.path.startsWith('/delete-user') === true) return
            await setup.endSession(session)
          },
        },
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        // Wipe first: if that fails the account stays, so no synced data is ever orphaned.
        beforeDelete: (user) => setup.wipeUser(user.id),
        // Better Auth deletes the user, sessions and accounts; this removes the rest.
        afterDelete: (user) => setup.purgeUser(user),
      },
    },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      database: {
        generateId: 'uuid',
        // The migrations own the schema. Better Auth's runtime check would also cache a promise
        // doing D1 I/O across requests, which a Worker cancels when the first request ends, so
        // every later auth request would wait on it forever.
        validateSchema: false,
      },
      // Cloudflare sets CF-Connecting-IP and clients cannot spoof it; rate limits key on it.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      backgroundTasks: { handler: setup.runInBackground },
      // Explicit, so no NODE_ENV=test in any environment can switch the CSRF and origin checks off.
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions
}
