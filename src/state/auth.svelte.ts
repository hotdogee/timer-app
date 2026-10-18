/**
 * Auth state (spec › Sync › Accounts are optional, Sign-in; Settings › Account): who is signed in,
 * which sign-in providers the server offers, and the account actions (email code, Google, GitHub,
 * Apple, sign out, delete account). Built on Better Auth's client against our Worker
 * (`/api/auth/*`, same origin on the web, so the session lives in an HTTP-only first-party cookie).
 *
 * The app works fully signed out, and an account is only for sync, so nothing here blocks: the
 * state starts from the account this device last saw (kept in localStorage, so a signed-in device
 * that starts offline still shows its account and keeps trying to sync) and follows Better Auth's
 * session, which is checked at start, when the page becomes visible again, when the browser comes
 * back online and after every sign-in or sign-out (Better Auth's client does this, and tells the
 * other tabs about sign-outs). A check that cannot reach the server changes nothing.
 *
 * Actions resolve to whether they worked and leave the reason for a failure in `error` (one of
 * {@link AuthError}); they never reject. `signInWith` leaves the page for the provider, which
 * returns to the same URL; when the provider reports a failure, `error` is `oauth` after `start`.
 *
 * The desktop app has no cookie (the API is on another origin): it signs in through the browser
 * with the device authorization flow (`startDeviceSignIn`: a code to approve on the `/device`
 * page, then polling for the token, RFC 8628) or with an emailed code, keeps the session token in
 * the device store (`settingsStore.auth`, through {@link TokenStore}) and sends it as a bearer
 * token with every request (`tokenProvider`; {@link bearerToken} for the sync socket). Signing
 * out, deleting the account, or the server no longer knowing the token removes it.
 */
import { createAuthClient } from 'better-auth/client'
import { deviceAuthorizationClient, emailOTPClient } from 'better-auth/client/plugins'
import { untrack } from 'svelte'

import type { Clock, EpochMs, settings } from '../core'
import { platform } from '../platform'
import { apiOrigin, apiUrl } from '../sync/api'
import {
  API_PATHS,
  DESKTOP_CLIENT_ID,
  DEVICE_USER_CODE_PARAM,
  DEVICE_VERIFICATION_PATH,
  PROVIDERS,
  type AppEnv,
  type Provider,
} from '../sync/protocol'
import { settingsStore } from './settings.svelte'

/** Whether someone is signed in; `unknown` until the server first answers (or a saved account). */
export type AuthStatus = 'unknown' | 'signed-out' | 'signed-in'

/** The signed-in user. Email-code accounts have no name or picture. */
export interface AccountUser {
  readonly id: string
  readonly email: string
  /** Display name, or null when there is none. */
  readonly name: string | null
  /** Picture URL (from the OAuth provider), or null. */
  readonly image: string | null
}

/**
 * Why the last action failed:
 * - `invalid-email`: the server rejected the address;
 * - `invalid-code`, `expired-code`: the emailed code is wrong or past its 10 minutes;
 * - `too-many-attempts`: five wrong codes; send a new one;
 * - `rate-limited`: too many requests from this device (three codes or ten tries a minute);
 * - `too-many-codes`: this address got its five codes this hour; try again later;
 * - `unavailable`: the server cannot email codes now (no mailer, or the day's quota is used up);
 * - `session-expired`: deleting the account needs a recent sign-in; sign in again first;
 * - `oauth`: the provider sign-in failed or was cancelled (seen after returning to the app);
 * - `network`: the server could not be reached (offline, or it answered with a server error);
 * - `unknown`: anything else.
 */
export type AuthError =
  | 'invalid-email'
  | 'invalid-code'
  | 'expired-code'
  | 'too-many-attempts'
  | 'rate-limited'
  | 'too-many-codes'
  | 'unavailable'
  | 'session-expired'
  | 'oauth'
  | 'network'
  | 'unknown'

/**
 * The desktop sign-in through the browser (device authorization), while it runs or once it ended
 * without signing in: asking for a code; waiting for the code to be approved on the `/device`
 * page (`retrying` while the server cannot be reached); or refused there, or expired unapproved.
 */
export type DeviceSignIn =
  | { readonly phase: 'requesting' }
  | {
      readonly phase: 'waiting'
      /** The code to show, as the server gave it (`ABCDEFGH`). */
      readonly userCode: string
      /** The approval page with the code filled in (`https://…/device?user_code=…`). */
      readonly verificationUrl: string
      /** When the code expires (device clock). */
      readonly expiresAt: EpochMs
      /** The last poll could not reach the server; polling goes on. */
      readonly retrying: boolean
    }
  | { readonly phase: 'denied' }
  | { readonly phase: 'expired' }

/** The auth state and actions. Every getter is reactive. */
export interface AuthStore {
  readonly status: AuthStatus
  /** The signed-in user; null unless `status` is `signed-in`. */
  readonly user: AccountUser | null
  /** The OAuth providers the server has credentials for, in button order; empty until known. */
  readonly providers: readonly Provider[]
  /** The server's mode, once known (`/__dev/otp` exists only in `development`). */
  readonly appEnv: AppEnv | null
  /** Why the last action failed, or null. Cleared when the next action starts. */
  readonly error: AuthError | null
  /** Whether an action is running (to disable its button). */
  readonly busy: boolean
  /**
   * Starts following the session and loads the server's configuration (call once at startup).
   * Picks up a failed provider sign-in from the URL. Returns a function that stops following.
   * Idempotent.
   */
  start(): () => void
  /**
   * Checks the session with the server now, past the session cookie cache (and loads the
   * configuration if it is missing). The sync connection calls it when the server refuses the
   * socket, so a device signed out elsewhere, or whose account was deleted, signs out here too.
   */
  refresh(): Promise<void>
  /** Emails a sign-in code to `email`. */
  sendCode(email: string): Promise<boolean>
  /** Signs in with the emailed code; `status` is `signed-in` once it resolves to true. */
  verifyCode(email: string, code: string): Promise<boolean>
  /** Leaves for the provider's sign-in page; it returns to the current URL. */
  signInWith(provider: Provider): Promise<boolean>
  /**
   * Signs out on the server; the local data stays. Resolves to true once signed out, or to false
   * (with `error`) when the server could not be told, which keeps the session. A client with a
   * bearer token (the desktop app) signs out on this device even then: it forgets its token and
   * resolves to `'device-only'`, and the server's session ends when it expires.
   */
  signOut(): Promise<boolean | 'device-only'>
  /** Deletes the account and the server's copy of the data; the local data stays. */
  deleteAccount(): Promise<boolean>
  /** Forgets `error`. */
  clearError(): void
  /** The desktop sign-in through the browser; null when none runs (or it signed in). */
  readonly device: DeviceSignIn | null
  /**
   * Starts the desktop sign-in through the browser (any earlier one stops): asks the server for a
   * code, then polls at the interval the server asks for (slowing down when told to) until the
   * code is approved, refused or expires, or {@link cancelDeviceSignIn}. Once approved, the token
   * is stored and the session checked, so `status` becomes `signed-in`. Resolves to whether a code
   * came (`device` is then `waiting`); otherwise `error` says why. Needs a token store (desktop).
   */
  startDeviceSignIn(): Promise<boolean>
  /** Stops the desktop sign-in, or forgets how it ended (`device` becomes null). */
  cancelDeviceSignIn(): void
}

/**
 * Where a client without the session cookie (the desktop app) keeps its bearer token: the device
 * store's `auth` group in the app. The token may have expired; see {@link usableToken}.
 */
export interface TokenStore {
  readonly current: settings.DeviceAuth | null
  /** Stores a token, or removes it (null). */
  set(auth: settings.DeviceAuth | null): void
}

/** A stored token's text while it has not expired at `now`, else null. */
export function usableToken(auth: settings.DeviceAuth | null, now: EpochMs): string | null {
  return auth !== null && auth.expiresAt > now ? auth.token : null
}

/**
 * How long a token from an emailed-code sign-in is taken to last until the session check reports
 * its real expiry: the server's session lifetime (30 days).
 */
export const DEFAULT_SESSION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * How long after a sign-in a "signed out" answer does not remove the new token: a session check
 * that was already under way (the window got the focus back) went without it.
 */
export const TOKEN_GRACE_MS = 30_000

/** A successful sign-in: the user, when the answer named one, and the session token it carried. */
export interface SignIn {
  readonly user: AccountUser | null
  /** The session token (for a bearer client), or null when the answer had none. */
  readonly token: string | null
}

/** A device code the server issued for the desktop sign-in (RFC 8628 § 3.2). */
export interface DeviceCode {
  /** The secret the app polls with; never shown. */
  readonly deviceCode: string
  /** The code the user compares on the approval page. */
  readonly userCode: string
  /** The approval page with the code filled in. */
  readonly verificationUrl: string
  /** Seconds until the codes expire. */
  readonly expiresIn: number
  /** Seconds to wait between polls. */
  readonly interval: number
}

/** What one poll for the device code's token found (RFC 8628 § 3.5). */
export type DevicePoll =
  | { readonly kind: 'pending' }
  /** Polling too often: wait 5 seconds longer from now on. */
  | { readonly kind: 'slow-down' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'granted'; readonly token: string; readonly expiresIn: number }
  | { readonly kind: 'failed'; readonly error: AuthError }

/** How a backend request ended. */
export type AuthResult<T = undefined> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AuthError }

/** What a session check found. */
export type SessionReport =
  | { readonly kind: 'pending' }
  /** `expiresAt`: when the session ends, when the answer said (the server extends it in use). */
  | { readonly kind: 'signed-in'; readonly user: AccountUser; readonly expiresAt?: EpochMs }
  | { readonly kind: 'signed-out' }
  /** The check failed: offline, or the server answered with an error other than 401. */
  | { readonly kind: 'unreachable' }

/** The server's `/api/config`, as far as the client trusts it. */
export interface AuthConfig {
  readonly providers: readonly Provider[]
  readonly appEnv: AppEnv
}

/** The server side of the auth state: Better Auth's client in the app, a fake in tests. */
export interface AuthBackend {
  /** Calls `listener` with the session now and on every change, until the returned function runs. */
  watchSession(listener: (report: SessionReport) => void): () => void
  /**
   * Checks the session again with the server's records (never Better Auth's five-minute session
   * cookie cache, which would still vouch for a session deleted meanwhile); the result reaches the
   * `watchSession` listeners.
   */
  refreshSession(): Promise<void>
  sendCode(email: string): Promise<AuthResult>
  verifyCode(email: string, code: string): Promise<AuthResult<SignIn>>
  signInSocial(provider: Provider, callbackURL: string): Promise<AuthResult>
  signOut(): Promise<AuthResult>
  deleteUser(): Promise<AuthResult>
  /** `/api/config`, or null when it cannot be read. */
  loadConfig(): Promise<AuthConfig | null>
  /** Asks for a device code for the desktop sign-in (`POST /device/code`). */
  requestDeviceCode?(): Promise<AuthResult<DeviceCode>>
  /** Asks once whether the device code was approved (`POST /device/token`). Never rejects. */
  pollDeviceToken?(deviceCode: string): Promise<DevicePoll>
}

/** Where the last seen account is kept between visits. */
export interface AccountCache {
  read(): AccountUser | null
  write(user: AccountUser | null): void
}

/** The page the store reads callback URLs from and cleans a failed OAuth return from. */
export interface AuthPage {
  readonly location: { readonly href: string }
  readonly history: {
    readonly state: unknown
    replaceState(state: unknown, unused: string, url: string): void
  }
}

/** The localStorage key of the last seen account. */
export const ACCOUNT_STORAGE_KEY = 'timer-app-account'

/** Query parameters Better Auth adds to the error callback URL after a failed OAuth sign-in. */
const OAUTH_ERROR_PARAMS = ['error', 'error_description'] as const

// ── Better Auth ────────────────────────────────────────────────────────────────────────────────

/** Dependencies of the Better Auth client; every field has a default. */
export interface AuthClientOptions {
  /** The API origin; `VITE_API_ORIGIN`, else the page's origin. */
  readonly baseURL?: string | undefined
  /** `fetch` for every request (tests). */
  readonly fetch?: typeof fetch | undefined
  /**
   * A bearer token for clients without the session cookie (the desktop app). With it, requests
   * go without credentials: the API's CORS answers to the desktop origin carry no credentials
   * flag, and there is no cookie to send.
   */
  readonly tokenProvider?: (() => string | null | undefined) | undefined
}

function pageOrigin(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.origin
}

/** Better Auth's client for our server: the email-code and device-authorization plugins. */
export function createAppAuthClient(options: AuthClientOptions = {}) {
  const baseURL = options.baseURL ?? (apiOrigin() || pageOrigin())
  const { fetch: fetchImpl, tokenProvider } = options
  return createAuthClient({
    ...(baseURL === undefined ? {} : { baseURL }),
    basePath: API_PATHS.auth,
    plugins: [emailOTPClient(), deviceAuthorizationClient()],
    fetchOptions: {
      ...(fetchImpl ? { customFetchImpl: fetchImpl } : {}),
      ...(tokenProvider
        ? {
            auth: { type: 'Bearer' as const, token: () => tokenProvider() ?? undefined },
            credentials: 'omit' as const,
          }
        : {}),
    },
  })
}

/** The app's Better Auth client (the device approval page calls its `device` endpoints). */
export type AppAuthClient = ReturnType<typeof createAppAuthClient>

/** What Better Auth's client resolves to: data, or an error with the server's body and status. */
interface ClientResponse<T> {
  readonly data: T | null
  readonly error: { readonly status: number; readonly code?: string | undefined } | null
}

/** The error codes Better Auth answers with, and what they mean here. */
const ERROR_CODES: Readonly<Record<string, AuthError>> = {
  INVALID_EMAIL: 'invalid-email',
  INVALID_OTP: 'invalid-code',
  OTP_EXPIRED: 'expired-code',
  TOO_MANY_ATTEMPTS: 'too-many-attempts',
  SESSION_EXPIRED: 'session-expired',
  // The server's own limits on code emails (server/src/send-limit.ts).
  TOO_MANY_CODE_EMAILS: 'too-many-codes',
  EMAIL_UNAVAILABLE: 'unavailable',
}

/** An {@link AuthError} for a failed response's status and Better Auth error code. */
export function authErrorFor(status: number, code?: string | null): AuthError {
  const known = code ? ERROR_CODES[code] : undefined
  if (known) return known
  if (status === 429) return 'rate-limited'
  if (status === 0 || status >= 500) return 'network'
  return 'unknown'
}

/** Runs a client call: its data, or why it failed; a rejection (offline) counts as `network`. */
async function call<T>(request: () => Promise<ClientResponse<T>>): Promise<AuthResult<T | null>> {
  try {
    const { data, error } = await request()
    return error
      ? { ok: false, error: authErrorFor(error.status, error.code) }
      : { ok: true, value: data }
  } catch {
    return { ok: false, error: 'network' }
  }
}

function withoutValue(result: AuthResult<unknown>): AuthResult {
  return result.ok ? { ok: true, value: undefined } : result
}

/** An {@link AccountUser} from Better Auth's user object, or null when it is not one. */
export function toAccountUser(value: unknown): AccountUser | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, email, name, image } = value as Record<string, unknown>
  if (typeof id !== 'string' || id === '' || typeof email !== 'string') return null
  return {
    id,
    email,
    name: typeof name === 'string' && name.trim() !== '' ? name : null,
    image: typeof image === 'string' && image !== '' ? image : null,
  }
}

/** The session atom's state, as far as the report needs it. */
interface SessionAtomState {
  readonly data: { readonly user?: unknown; readonly session?: unknown } | null
  readonly error: unknown
  readonly isPending: boolean
  readonly isRefetching?: boolean | undefined
}

/**
 * What Better Auth's session state says about who is signed in. While a check is under way
 * (`isRefetching`) the state still holds the last answer, which may be older than what this
 * device has done since (signing out), so it says nothing until the check answers.
 */
export function sessionReport(state: SessionAtomState): SessionReport {
  if (state.isRefetching === true) return { kind: 'pending' }
  const user = state.data ? toAccountUser(state.data.user) : null
  if (user) {
    const expiresAt = sessionExpiry(state.data?.session)
    return expiresAt === null ? { kind: 'signed-in', user } : { kind: 'signed-in', user, expiresAt }
  }
  if (state.isPending) return { kind: 'pending' }
  if (state.error !== null && state.error !== undefined) {
    const status =
      typeof state.error === 'object' && 'status' in state.error ? state.error.status : undefined
    // A 401 is the server saying "nobody"; anything else (offline, a 502) says nothing.
    return status === 401 ? { kind: 'signed-out' } : { kind: 'unreachable' }
  }
  return { kind: 'signed-out' }
}

/** When a Better Auth session object expires (a `Date` or ISO text), or null when it does not say. */
function sessionExpiry(session: unknown): EpochMs | null {
  if (typeof session !== 'object' || session === null) return null
  const value: unknown = (session as Record<string, unknown>).expiresAt
  const time =
    value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(time) && time > 0 ? time : null
}

/** The `grant_type` of the device token request (RFC 8628 § 3.4). */
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

/**
 * The approval page for `userCode`: the server's `verification_uri_complete` when it is an
 * `http(s)` URL (the public origin, where the web app runs), else `/device?user_code=` on
 * `origin` (the API's).
 */
export function verificationUrlFor(userCode: string, fromServer: unknown, origin: string): string {
  if (typeof fromServer === 'string') {
    try {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
      const url = new URL(fromServer)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
    } catch {
      // Not a URL: use our own.
    }
  }
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
  const query = new URLSearchParams({ [DEVICE_USER_CODE_PARAM]: userCode })
  return `${origin}${DEVICE_VERIFICATION_PATH}?${query.toString()}`
}

/** A device code from a `POST /device/code` body, or null when the body is not one. */
export function parseDeviceCode(body: unknown, origin: string): DeviceCode | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  const { device_code: deviceCode, user_code: userCode, expires_in: expiresIn } = record
  if (typeof deviceCode !== 'string' || deviceCode === '') return null
  if (typeof userCode !== 'string' || userCode === '') return null
  if (typeof expiresIn !== 'number' || !(expiresIn > 0)) return null
  const interval = typeof record.interval === 'number' && record.interval > 0 ? record.interval : 5
  return {
    deviceCode,
    userCode,
    verificationUrl: verificationUrlFor(userCode, record.verification_uri_complete, origin),
    expiresIn,
    interval,
  }
}

/** One device token poll's answer: the token, or what the error body (or status) says. */
export function devicePoll(data: unknown, error: unknown): DevicePoll {
  if (error !== null && error !== undefined) {
    const record = typeof error === 'object' ? (error as Record<string, unknown>) : {}
    const status = typeof record.status === 'number' ? record.status : 0
    switch (record.error) {
      case 'authorization_pending':
        return { kind: 'pending' }
      case 'slow_down':
        return { kind: 'slow-down' }
      case 'access_denied':
        return { kind: 'denied' }
      case 'expired_token':
        return { kind: 'expired' }
    }
    // The server's own rate limit: poll less often.
    if (status === 429) return { kind: 'slow-down' }
    return { kind: 'failed', error: authErrorFor(status) }
  }
  if (typeof data === 'object' && data !== null) {
    const { access_token: token, expires_in: expiresIn } = data as Record<string, unknown>
    if (typeof token === 'string' && token !== '' && typeof expiresIn === 'number') {
      return { kind: 'granted', token, expiresIn }
    }
  }
  return { kind: 'failed', error: 'unknown' }
}

/** The server's configuration from a `ConfigResponse` body, or null when it is not one. */
export function parseConfig(body: unknown): AuthConfig | null {
  if (typeof body !== 'object' || body === null) return null
  const { providers, appEnv } = body as Record<string, unknown>
  if (!Array.isArray(providers)) return null
  const known: unknown[] = providers
  return {
    // In button order, each once.
    providers: PROVIDERS.filter((id) => known.includes(id)),
    appEnv: appEnv === 'development' ? 'development' : 'production',
  }
}

/** Dependencies of {@link createBetterAuthBackend}. */
export interface BetterAuthBackendOptions {
  /** `fetch` for `/api/config` (the client has its own); the global one by default. */
  readonly fetch?: typeof fetch | undefined
  /** `/api/config` on the API origin by default. */
  readonly configUrl?: string | undefined
}

/** An {@link AuthBackend} with the device sign-in, as Better Auth's client has it. */
export type DeviceAuthBackend = AuthBackend &
  Required<Pick<AuthBackend, 'requestDeviceCode' | 'pollDeviceToken'>>

/** The {@link AuthBackend} over Better Auth's client. */
export function createBetterAuthBackend(
  client: AppAuthClient,
  options: BetterAuthBackendOptions = {},
): DeviceAuthBackend {
  const configUrl = options.configUrl ?? apiUrl(API_PATHS.config)
  const request = options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init))
  return {
    watchSession(listener) {
      return client.useSession.subscribe((state) => {
        listener(sessionReport(state))
      })
    },
    refreshSession: () => client.useSession.get().refetch({ query: { disableCookieCache: true } }),
    sendCode: async (email) =>
      withoutValue(
        await call(() => client.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })),
      ),
    async verifyCode(email, otp) {
      const result = await call(() => client.signIn.emailOtp({ email, otp }))
      if (!result.ok) return result
      const token = result.value?.token
      return {
        ok: true,
        value: {
          user: toAccountUser(result.value?.user),
          token: typeof token === 'string' && token !== '' ? token : null,
        },
      }
    },
    signInSocial: async (provider, callbackURL) =>
      withoutValue(
        await call(() =>
          client.signIn.social({ provider, callbackURL, errorCallbackURL: callbackURL }),
        ),
      ),
    signOut: async () => withoutValue(await call(() => client.signOut())),
    deleteUser: async () => withoutValue(await call(() => client.deleteUser())),
    // The desktop sign-in; a web build (`__DESKTOP__` false), which never starts it, leaves it out.
    requestDeviceCode: __DESKTOP__
      ? async () => {
          const result = await call(() => client.device.code({ client_id: DESKTOP_CLIENT_ID }))
          if (!result.ok) return result
          const code = parseDeviceCode(result.value, apiOrigin() || (pageOrigin() ?? ''))
          return code ? { ok: true, value: code } : { ok: false, error: 'unknown' }
        }
      : () => Promise.resolve({ ok: false, error: 'unknown' }),
    pollDeviceToken: __DESKTOP__
      ? async (deviceCode) => {
          try {
            const { data, error } = await client.device.token({
              grant_type: DEVICE_GRANT_TYPE,
              device_code: deviceCode,
              client_id: DESKTOP_CLIENT_ID,
            })
            return devicePoll(data, error)
          } catch {
            return { kind: 'failed', error: 'network' }
          }
        }
      : () => Promise.resolve({ kind: 'failed', error: 'unknown' }),
    async loadConfig() {
      try {
        const response = await request(configUrl, { headers: { Accept: 'application/json' } })
        return response.ok ? parseConfig(await response.json()) : null
      } catch {
        return null
      }
    },
  }
}

// ── The account cache ──────────────────────────────────────────────────────────────────────────

/** localStorage, or null where reading it throws (sandboxed origins) or it does not exist. */
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * The last seen account in `storage` (localStorage by default) under `key`, or null when there is
 * no storage. Unreadable or malformed entries read as no account; failed writes are ignored.
 */
export function createAccountCache(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = browserStorage(),
  key: string = ACCOUNT_STORAGE_KEY,
): AccountCache | null {
  if (!storage) return null
  return {
    read() {
      try {
        const text = storage.getItem(key)
        return text === null ? null : toAccountUser(JSON.parse(text))
      } catch {
        return null
      }
    },
    write(user) {
      try {
        if (user) storage.setItem(key, JSON.stringify(user))
        else storage.removeItem(key)
      } catch {
        // Full or blocked: the next visit starts as `unknown` instead.
      }
    },
  }
}

// ── The store ──────────────────────────────────────────────────────────────────────────────────

/** Dependencies of {@link createAuthStore}; every field has a default. */
export interface AuthStoreOptions {
  /** Better Auth's client against the API by default. */
  readonly backend?: AuthBackend | undefined
  /** The last seen account; localStorage by default, null for none. */
  readonly cache?: AccountCache | null | undefined
  /** The page; the window by default, null outside a browser. */
  readonly page?: AuthPage | null | undefined
  /**
   * Where the bearer token lives, for a client without the session cookie (the desktop app);
   * none by default (the web). Without it, sign-ins keep no token and the device sign-in fails.
   */
  readonly tokens?: TokenStore | null | undefined
  /** The device clock, for token and device code expiry; `Date.now` by default. */
  readonly clock?: Clock | undefined
}

function defaultPage(): AuthPage | null {
  return typeof window === 'undefined' ? null : window
}

function sameUser(a: AccountUser | null, b: AccountUser | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.id === b.id &&
      a.email === b.email &&
      a.name === b.name &&
      a.image === b.image)
  )
}

/** Creates the auth state. It starts from the cached account and talks to nobody until `start`. */
export function createAuthStore(options: AuthStoreOptions = {}): AuthStore {
  const backend = options.backend ?? createBetterAuthBackend(createAppAuthClient())
  const cache = options.cache === undefined ? createAccountCache() : options.cache
  const page = options.page === undefined ? defaultPage() : options.page
  const tokens = options.tokens ?? null
  const clock = options.clock ?? Date.now

  const cached = cache?.read() ?? null
  let status = $state<AuthStatus>(cached ? 'signed-in' : 'unknown')
  let user = $state.raw<AccountUser | null>(cached)
  let providers = $state.raw<readonly Provider[]>([])
  let appEnv = $state<AppEnv | null>(null)
  let error = $state<AuthError | null>(null)
  let running = $state(0)
  let stopWatching: (() => void) | null = null
  let configLoaded = false
  let configLoading: Promise<void> | null = null
  let device = $state.raw<DeviceSignIn | null>(null)
  /** Bumped by every start or cancel of the device sign-in, so a stale poll loop stops. */
  let deviceRun = 0

  /** When this store last kept a token; a check answered meanwhile may predate it. */
  let keptAt = Number.NEGATIVE_INFINITY

  /** Keeps the token a sign-in returned (a bearer client only). */
  function keepToken(token: string | null, expiresAt: EpochMs): void {
    if (tokens === null || token === null) return
    keptAt = clock()
    tokens.set({ token, expiresAt })
  }

  /** Forgets the token: signed out, deleted, or the server no longer knows it. */
  function dropToken(): void {
    if (tokens?.current != null) tokens.set(null)
  }

  function signedIn(next: AccountUser): void {
    if (!sameUser(user, next)) {
      user = next
      cache?.write(next)
    }
    status = 'signed-in'
  }

  function signedOut(): void {
    if (user !== null) {
      user = null
      cache?.write(null)
    }
    status = 'signed-out'
  }

  function follow(report: SessionReport): void {
    if (report.kind === 'signed-in') {
      signedIn(report.user)
      // The server extends a session in use: keep the stored token's expiry in step.
      const held = tokens?.current ?? null
      if (held !== null && report.expiresAt !== undefined && report.expiresAt !== held.expiresAt) {
        tokens?.set({ token: held.token, expiresAt: report.expiresAt })
      }
    } else if (report.kind === 'signed-out') {
      signedOut()
      // The check went with the token (if it was still usable): the server no longer knows it.
      // Not a token kept moments ago, though: a check that started before it went without it.
      if (clock() - keptAt > TOKEN_GRACE_MS) dropToken()
    }
    // `pending` and `unreachable` keep what is known: the cached account, or `unknown`.
  }

  /** Waits `ms`, then says whether device sign-in run `run` is still the current one. */
  function waitFor(run: number, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(run === deviceRun)
      }, ms)
    })
  }

  /** Polls for the device code's token until it is approved, refused, expired or cancelled. */
  async function pollDevice(run: number, code: DeviceCode, expiresAt: EpochMs): Promise<void> {
    const poll = backend.pollDeviceToken?.bind(backend)
    if (!poll) return
    let interval = code.interval * 1000
    for (;;) {
      if (!(await waitFor(run, interval))) return
      if (clock() >= expiresAt) {
        device = { phase: 'expired' }
        return
      }
      const answer = await poll(code.deviceCode)
      if (run !== deviceRun) return
      const waiting = untrack(() => device)
      const setRetrying = (retrying: boolean): void => {
        if (waiting?.phase === 'waiting' && waiting.retrying !== retrying) {
          device = { ...waiting, retrying }
        }
      }
      switch (answer.kind) {
        case 'pending':
          setRetrying(false)
          break
        case 'slow-down':
          // RFC 8628 § 3.5: five seconds more for this and every later poll.
          interval += 5000
          setRetrying(false)
          break
        case 'denied':
          device = { phase: 'denied' }
          return
        case 'expired':
          device = { phase: 'expired' }
          return
        case 'failed':
          if (answer.error === 'network') {
            setRetrying(true)
            break
          }
          error = answer.error
          device = null
          return
        case 'granted':
          keepToken(answer.token, clock() + answer.expiresIn * 1000)
          // The check with the new token signs in (`follow`).
          await backend.refreshSession().catch(() => undefined)
          if (run === deviceRun) device = null
          return
      }
    }
  }

  function loadConfig(): Promise<void> {
    if (configLoaded) return Promise.resolve()
    configLoading ??= backend.loadConfig().then((config) => {
      configLoading = null
      if (!config) return
      configLoaded = true
      providers = config.providers
      appEnv = config.appEnv
    })
    return configLoading
  }

  /** Takes the provider's error off the URL after a failed OAuth sign-in, so a reload is clean. */
  function takeOAuthError(): void {
    if (!page) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
    const url = new URL(page.location.href)
    if (!url.searchParams.has('error')) return
    error = 'oauth'
    for (const name of OAUTH_ERROR_PARAMS) url.searchParams.delete(name)
    page.history.replaceState(page.history.state, '', url.href)
  }

  async function run<T>(
    action: () => Promise<AuthResult<T>>,
    onSuccess?: (value: T) => void,
  ): Promise<boolean> {
    // Untracked: an action started from an effect must not make it follow `busy`.
    error = null
    running = untrack(() => running) + 1
    try {
      const result = await action()
      if (!result.ok) {
        error = result.error
        return false
      }
      onSuccess?.(result.value)
      return true
    } finally {
      running = untrack(() => running) - 1
    }
  }

  return {
    get status() {
      return status
    },
    get user() {
      return status === 'signed-in' ? user : null
    },
    get providers() {
      return providers
    },
    get appEnv() {
      return appEnv
    },
    get error() {
      return error
    },
    get busy() {
      return running > 0
    },

    start() {
      if (stopWatching) return stopWatching
      takeOAuthError()
      const unwatch = backend.watchSession(follow)
      void loadConfig()
      const stop = (): void => {
        if (stopWatching !== stop) return
        stopWatching = null
        unwatch()
      }
      stopWatching = stop
      return stop
    },

    async refresh() {
      await Promise.all([backend.refreshSession().catch(() => undefined), loadConfig()])
    },

    sendCode(email) {
      return run(() => backend.sendCode(email.trim()))
    },

    verifyCode(email, code) {
      return run(
        () => backend.verifyCode(email.trim(), code.replace(/\s+/g, '')),
        (next) => {
          // Until the session check reports the real expiry, the server's session lifetime.
          keepToken(next.token, clock() + DEFAULT_SESSION_MS)
          if (next.user) signedIn(next.user)
          // The session check that the sign-in triggers fills in the user otherwise.
          else void backend.refreshSession().catch(() => undefined)
        },
      )
    },

    signInWith(provider) {
      const callbackURL = page?.location.href ?? '/'
      return run(() => backend.signInSocial(provider, callbackURL))
    },

    async signOut() {
      if (tokens === null) {
        return run(
          () => backend.signOut(),
          () => {
            signedOut()
          },
        )
      }
      // The token goes whatever the server says: someone leaving a shared computer while the
      // server is out of reach must not stay signed in. The revoke (which needs the token) first.
      const revoked = await run(() => backend.signOut())
      error = null
      dropToken()
      signedOut()
      return revoked ? true : 'device-only'
    },

    deleteAccount() {
      return run(
        () => backend.deleteUser(),
        () => {
          dropToken()
          signedOut()
        },
      )
    },

    clearError() {
      error = null
    },

    get device() {
      return device
    },

    async startDeviceSignIn() {
      const current = ++deviceRun
      error = null
      const request = backend.requestDeviceCode?.bind(backend)
      if (tokens === null || !request || !backend.pollDeviceToken) {
        device = null
        error = 'unknown'
        return false
      }
      device = { phase: 'requesting' }
      const result = await request()
      if (current !== deviceRun) return false
      if (!result.ok) {
        device = null
        error = result.error
        return false
      }
      const code = result.value
      const expiresAt = clock() + code.expiresIn * 1000
      device = {
        phase: 'waiting',
        userCode: code.userCode,
        verificationUrl: code.verificationUrl,
        expiresAt,
        retrying: false,
      }
      void pollDevice(current, code, expiresAt)
      return true
    },

    cancelDeviceSignIn() {
      deviceRun++
      device = null
    },
  }
}

/**
 * The desktop app's token store: the device store's `auth` group (`settingsStore.auth`). None on
 * the web, which has the session cookie.
 */
const appTokens: TokenStore | null =
  __DESKTOP__ && platform.kind === 'tauri'
    ? {
        get current() {
          return settingsStore.auth
        },
        set(auth) {
          settingsStore.setAuth(auth)
        },
      }
    : null

/**
 * The bearer token the desktop app sends: the stored one while it has not expired, else null
 * (always null on the web). The sync socket offers it as its `timer-auth.<token>` subprotocol.
 */
export function bearerToken(): string | null {
  return usableToken(appTokens?.current ?? null, Date.now())
}

/** The app's Better Auth client, for the endpoints the store does not wrap (device approval). */
export const authClient: AppAuthClient = createAppAuthClient(
  appTokens === null ? {} : { tokenProvider: bearerToken },
)

/** The app's auth state. `main.ts` calls `start()`. */
export const authStore: AuthStore = createAuthStore({
  backend: createBetterAuthBackend(authClient),
  tokens: appTokens,
})
