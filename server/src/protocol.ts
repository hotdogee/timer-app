/**
 * The contract between the web client and the sync server: paths, auth transport, and the JSON
 * bodies of the server's own endpoints (Better Auth's routes are described by its client).
 *
 * This file exists twice, byte for byte: `server/src/protocol.ts` (the Worker) and
 * `src/sync/protocol.ts` (the client, which never imports server code). A unit test fails when they
 * differ, so change both. It has no imports and no side effects.
 */

/** Paths the Worker serves, relative to the API origin (the page's own origin on the web). */
export const API_PATHS = {
  /** Better Auth's `basePath`; every auth route lives below it. */
  auth: '/api/auth',
  /** `GET` → {@link TimeResponse}, never cached. */
  time: '/api/time',
  /** `GET` → {@link ConfigResponse}. */
  config: '/api/config',
  /** `GET` with `Upgrade: websocket` → the signed-in user's TinyBase sync socket. */
  sync: '/api/sync',
  /** `GET` → {@link ServerExport}, the signed-in user's synced data as stored on the server. */
  export: '/api/export',
  /** `GET ?email=` → {@link DevOtpResponse}; only when `APP_ENV` is `development`, else 404. */
  devOtp: '/__dev/otp',
} as const

/** The web page where a signed-in user approves a device sign-in (the desktop app's). */
export const DEVICE_VERIFICATION_PATH = '/device'

/** Query parameter of {@link DEVICE_VERIFICATION_PATH} that carries the code to approve. */
export const DEVICE_USER_CODE_PARAM = 'user_code'

/** The `client_id` the desktop app sends to the device authorization endpoints. */
export const DESKTOP_CLIENT_ID = 'timer-app-desktop'

/** Digits in an emailed sign-in code. */
export const OTP_LENGTH = 6

/** Seconds an emailed sign-in code stays valid. */
export const OTP_EXPIRES_IN_SECONDS = 600

/**
 * The WebSocket subprotocol of the sync socket. The server always answers with this one, so a
 * token offered through {@link authSubprotocol} is never echoed back.
 */
export const SYNC_SUBPROTOCOL = 'timer-sync'

/**
 * Prefix of the subprotocol that carries a bearer token (`timer-auth.<token>`): browsers cannot set
 * headers on a WebSocket, so a client without a session cookie (the desktop app) sends its token
 * here. The Worker turns it into `Authorization: Bearer <token>`.
 */
export const AUTH_SUBPROTOCOL_PREFIX = 'timer-auth.'

/**
 * Seconds either end of the sync socket waits for the other to answer one request (TinyBase's
 * synchronizers ask for each other's changes after connecting). Generous: a cold Durable Object, a
 * slow mobile link or a busy main thread at startup can each take a few seconds, and a request
 * that times out drops that part of the catch-up until the next reconnect.
 */
export const SYNC_REQUEST_TIMEOUT_SECONDS = 10

/**
 * Close code of a sync socket the server refuses or ends because there is no valid session: none
 * was sent, it was signed out or revoked, it expired, or the account was deleted. Browsers do not
 * expose an HTTP 401 on a WebSocket, so the server accepts such an upgrade and closes it at once
 * with this code. The client then checks its session again instead of retrying blindly.
 */
export const SYNC_CLOSE_UNAUTHORIZED = 4401

/** Close reasons that go with {@link SYNC_CLOSE_UNAUTHORIZED}, for logs and tests. */
export const SYNC_CLOSE_REASONS = {
  unauthorized: 'unauthorized',
  signedOut: 'signed out',
  expired: 'session expired',
  accountDeleted: 'account deleted',
} as const

/**
 * The heartbeat: the client sends {@link SYNC_PING} as a text message while connected, and the
 * server answers {@link SYNC_PONG} without waking the user's Durable Object. No answer in time
 * means the connection is dead even though the socket still reads open.
 */
export const SYNC_PING = 'ping'
export const SYNC_PONG = 'pong'

/**
 * Percent-encodes a token for a subprotocol name (RFC 3986 strict: only letters, digits, `-._~`
 * and `%` remain). A subprotocol must be an HTTP token, and session tokens can contain `/`, `+`
 * and `=`, which browsers refuse there (`new WebSocket` throws a SyntaxError).
 */
function encodeSubprotocolValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/**
 * The subprotocols a client offers when it opens the sync socket: {@link SYNC_SUBPROTOCOL}, plus
 * the token's {@link AUTH_SUBPROTOCOL_PREFIX} entry (the token percent-encoded) when there is a
 * non-empty token.
 */
export function syncSubprotocols(token?: string | null): string[] {
  return token
    ? [SYNC_SUBPROTOCOL, AUTH_SUBPROTOCOL_PREFIX + encodeSubprotocolValue(token)]
    : [SYNC_SUBPROTOCOL]
}

/**
 * Reads the bearer token from a `Sec-WebSocket-Protocol` request header (a comma-separated list):
 * the first non-empty `timer-auth.` entry, percent-decoded, or null when there is none, the header
 * is missing, or the entry does not decode.
 */
export function tokenFromSubprotocols(header: string | null | undefined): string | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const value = part.trim()
    if (
      value.startsWith(AUTH_SUBPROTOCOL_PREFIX) &&
      value.length > AUTH_SUBPROTOCOL_PREFIX.length
    ) {
      try {
        return decodeURIComponent(value.slice(AUTH_SUBPROTOCOL_PREFIX.length))
      } catch {
        return null
      }
    }
  }
  return null
}

/** OAuth providers the server knows, in the order the sign-in buttons appear. */
export const PROVIDERS = ['google', 'github', 'apple'] as const

/** An OAuth provider id, as Better Auth names it (`signIn.social({ provider })`). */
export type Provider = (typeof PROVIDERS)[number]

/** Whether `value` is one of {@link PROVIDERS}. */
export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value)
}

/** The server's mode (its `APP_ENV`); anything but `development` counts as `production`. */
export type AppEnv = 'development' | 'production'

/** Body of `GET /api/time`: the server's clock, in epoch milliseconds. */
export interface TimeResponse {
  readonly now: number
}

/** Body of `GET /api/config`. */
export interface ConfigResponse {
  /** The OAuth providers this server has credentials for, in {@link PROVIDERS} order. */
  readonly providers: readonly Provider[]
  readonly appEnv: AppEnv
}

/** Body of `GET /__dev/otp?email=` (development only): the last code sent to that address. */
export interface DevOtpResponse {
  readonly otp: string
}

/** Error codes in {@link ApiErrorResponse}. */
export type ApiErrorCode = 'unauthorized' | 'upgrade-required' | 'not-found' | 'bad-request'

/** Body of an error from the server's own endpoints (401, 426, 404, 400). */
export interface ApiErrorResponse {
  readonly error: ApiErrorCode
}

/** A TinyBase cell or value as JSON carries it. */
export type ExportCell = string | number | boolean

/** TinyBase tables: table id → row id → cell id → cell. */
export type ExportTables = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, ExportCell>>>>>
>

/** TinyBase values: value id → value. */
export type ExportValues = Readonly<Record<string, ExportCell>>

/** The start of a server copy's file name: `timer-app-server-copy-2026-10-18.json`. */
export const SERVER_COPY_FILE_PREFIX = 'timer-app-server-copy'

/** The layout version of {@link ServerExport}. */
export const SERVER_EXPORT_FORMAT = 1

/**
 * Body of `GET /api/export`: the synced store as the server holds it (`store.getContent()`), for
 * the user's data-export right. Shaped like the app's own export file (`app`, `format`,
 * `exportedAt`) but marked as the server copy.
 */
export interface ServerExport {
  readonly app: 'timer-app'
  readonly kind: 'server-copy'
  readonly format: typeof SERVER_EXPORT_FORMAT
  /** Server time of the export, in epoch milliseconds. */
  readonly exportedAt: number
  readonly tables: ExportTables
  readonly values: ExportValues
}
