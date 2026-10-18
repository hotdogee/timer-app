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
 * The desktop app (M5) has no cookie: it will pass a bearer token through `tokenProvider`.
 */
import { createAuthClient } from 'better-auth/client'
import { deviceAuthorizationClient, emailOTPClient } from 'better-auth/client/plugins'
import { untrack } from 'svelte'

import { apiOrigin, apiUrl } from '../sync/api'
import { API_PATHS, PROVIDERS, type AppEnv, type Provider } from '../sync/protocol'

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
  /** Signs out on the server; the local data stays. */
  signOut(): Promise<boolean>
  /** Deletes the account and the server's copy of the data; the local data stays. */
  deleteAccount(): Promise<boolean>
  /** Forgets `error`. */
  clearError(): void
}

/** How a backend request ended. */
export type AuthResult<T = undefined> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AuthError }

/** What a session check found. */
export type SessionReport =
  | { readonly kind: 'pending' }
  | { readonly kind: 'signed-in'; readonly user: AccountUser }
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
  verifyCode(email: string, code: string): Promise<AuthResult<AccountUser | null>>
  signInSocial(provider: Provider, callbackURL: string): Promise<AuthResult>
  signOut(): Promise<AuthResult>
  deleteUser(): Promise<AuthResult>
  /** `/api/config`, or null when it cannot be read. */
  loadConfig(): Promise<AuthConfig | null>
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
  /** A bearer token for clients without the session cookie (the desktop app, M5). */
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
        ? { auth: { type: 'Bearer' as const, token: () => tokenProvider() ?? undefined } }
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
  readonly data: { readonly user?: unknown } | null
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
  if (user) return { kind: 'signed-in', user }
  if (state.isPending) return { kind: 'pending' }
  if (state.error !== null && state.error !== undefined) {
    const status =
      typeof state.error === 'object' && 'status' in state.error ? state.error.status : undefined
    // A 401 is the server saying "nobody"; anything else (offline, a 502) says nothing.
    return status === 401 ? { kind: 'signed-out' } : { kind: 'unreachable' }
  }
  return { kind: 'signed-out' }
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

/** The {@link AuthBackend} over Better Auth's client. */
export function createBetterAuthBackend(
  client: AppAuthClient,
  options: BetterAuthBackendOptions = {},
): AuthBackend {
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
      return result.ok ? { ok: true, value: toAccountUser(result.value?.user) } : result
    },
    signInSocial: async (provider, callbackURL) =>
      withoutValue(
        await call(() =>
          client.signIn.social({ provider, callbackURL, errorCallbackURL: callbackURL }),
        ),
      ),
    signOut: async () => withoutValue(await call(() => client.signOut())),
    deleteUser: async () => withoutValue(await call(() => client.deleteUser())),
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
    if (report.kind === 'signed-in') signedIn(report.user)
    else if (report.kind === 'signed-out') signedOut()
    // `pending` and `unreachable` keep what is known: the cached account, or `unknown`.
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
          if (next) signedIn(next)
          // The session check that the sign-in triggers fills in the user otherwise.
          else void backend.refreshSession().catch(() => undefined)
        },
      )
    },

    signInWith(provider) {
      const callbackURL = page?.location.href ?? '/'
      return run(() => backend.signInSocial(provider, callbackURL))
    },

    signOut() {
      return run(() => backend.signOut(), signedOut)
    },

    deleteAccount() {
      return run(() => backend.deleteUser(), signedOut)
    },

    clearError() {
      error = null
    },
  }
}

/** The app's Better Auth client, for the endpoints the store does not wrap (device approval). */
export const authClient: AppAuthClient = createAppAuthClient()

/** The app's auth state. `main.ts` calls `start()`. */
export const authStore: AuthStore = createAuthStore({
  backend: createBetterAuthBackend(authClient),
})
