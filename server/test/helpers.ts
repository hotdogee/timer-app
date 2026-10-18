/**
 * Helpers for the Worker tests: requests shaped like a same-origin browser's, sign-in through the
 * emailed code (read back from the development endpoint), and TinyBase clients on the sync socket.
 */
import { env, exports } from 'cloudflare:workers'
import type { MergeableStore } from 'tinybase/mergeable-store'
import { createMergeableStore } from 'tinybase/mergeable-store'
import type { WsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { expect, vi } from 'vitest'

import {
  API_PATHS,
  SYNC_CLOSE_REASONS,
  SYNC_CLOSE_UNAUTHORIZED,
  type DevOtpResponse,
} from '../src/protocol'
import { userSyncStub } from '../src/sync-object'

/** BETTER_AUTH_URL in the tests; requests carry it as their `Origin`, as the web app's would. */
export const ORIGIN = 'http://localhost:8787'

let lastIp = 0

/** A client IP no other test used, so each test has its own rate-limit buckets. */
export function freshIp(): string {
  lastIp += 1
  return `10.${String((lastIp >> 16) & 255)}.${String((lastIp >> 8) & 255)}.${String(lastIp & 255)}`
}

let lastEmail = 0

/** An address no other test used. */
export function freshEmail(label = 'user'): string {
  lastEmail += 1
  return `${label}-${String(lastEmail)}-${crypto.randomUUID().slice(0, 8)}@example.com`
}

export interface CallOptions {
  readonly method?: string
  /** Sent as JSON; makes the default method POST. */
  readonly body?: unknown
  readonly headers?: HeadersInit
  /** `CF-Connecting-IP`; a fresh one when omitted. */
  readonly ip?: string
  /** `Origin`; {@link ORIGIN} when omitted, none when null. */
  readonly origin?: string | null
}

/** Builds a request to the Worker (see {@link CallOptions}). */
export function request(path: string, options: CallOptions = {}): Request {
  const headers = new Headers(options.headers)
  if (options.origin !== null) headers.set('Origin', options.origin ?? ORIGIN)
  if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', options.ip ?? freshIp())
  let body: string | null = null
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }
  const method = options.method ?? (body === null ? 'GET' : 'POST')
  return new Request(ORIGIN + path, { method, headers, body })
}

/** Calls the Worker through its default export, as the platform would. */
export function call(path: string, options: CallOptions = {}): Promise<Response> {
  return exports.default.fetch(request(path, options))
}

/** Asks for a sign-in code for `email`. */
export function requestCode(email: string, ip: string = freshIp()): Promise<Response> {
  return call(`${API_PATHS.auth}/email-otp/send-verification-otp`, {
    body: { email, type: 'sign-in' },
    ip,
  })
}

/** Submits a sign-in code. */
export function submitCode(email: string, otp: string, ip: string = freshIp()): Promise<Response> {
  return call(`${API_PATHS.auth}/sign-in/email-otp`, { body: { email, otp }, ip })
}

/** The last code mailed to `email`, from the development endpoint. */
export async function devCode(email: string): Promise<string> {
  const response = await call(`${API_PATHS.devOtp}?email=${encodeURIComponent(email)}`)
  expect(response.status).toBe(200)
  const body: DevOtpResponse = await response.json()
  return body.otp
}

/** A `Cookie` header made of the cookies a response sets (cleared ones left out). */
export function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .filter((cookie) => !/;\s*max-age=0\b/i.test(cookie))
    .map((cookie) => {
      const end = cookie.indexOf(';')
      return end === -1 ? cookie : cookie.slice(0, end)
    })
    .join('; ')
}

export interface SignedIn {
  readonly email: string
  readonly userId: string
  /** The session cookies, as a `Cookie` header. */
  readonly cookie: string
  /** The bearer token from `set-auth-token`. */
  readonly token: string
  readonly ip: string
}

interface SignInBody {
  readonly token: string
  readonly user: { readonly id: string; readonly email: string }
}

/** Signs in with the emailed code, end to end, and returns the credentials. */
export async function signIn(
  email: string = freshEmail(),
  ip: string = freshIp(),
): Promise<SignedIn> {
  const sent = await requestCode(email, ip)
  expect(sent.status).toBe(200)
  const otp = await devCode(email)
  const response = await submitCode(email, otp, ip)
  expect(response.status).toBe(200)
  const body: SignInBody = await response.json()
  const token = response.headers.get('set-auth-token')
  expect(token).toBeTruthy()
  return { email, ip, userId: body.user.id, cookie: cookiesOf(response), token: token ?? '' }
}

export interface SyncOptions {
  readonly cookie?: string
  /** `Sec-WebSocket-Protocol` entries. */
  readonly protocols?: readonly string[]
  /** Appended to the path, e.g. `?path=…`. */
  readonly query?: string
  /** `Origin`; {@link ORIGIN} when omitted, none when null. */
  readonly origin?: string | null
  readonly headers?: HeadersInit
  /** Leave out `Upgrade: websocket`. */
  readonly noUpgrade?: boolean
}

/** A random `Sec-WebSocket-Key` (TinyBase uses it as the client id, so each must differ). */
function webSocketKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

/** A request for the sync socket like a browser (or the desktop app) would send. */
export function syncRequest(options: SyncOptions = {}): Request {
  const headers = new Headers(options.headers)
  if (!options.noUpgrade) {
    headers.set('Upgrade', 'websocket')
    headers.set('Connection', 'Upgrade')
    headers.set('Sec-WebSocket-Key', webSocketKey())
    headers.set('Sec-WebSocket-Version', '13')
  }
  if (options.cookie) headers.set('Cookie', options.cookie)
  if (options.protocols) headers.set('Sec-WebSocket-Protocol', options.protocols.join(', '))
  if (options.origin !== null) headers.set('Origin', options.origin ?? ORIGIN)
  return new Request(`${ORIGIN}${API_PATHS.sync}${options.query ?? ''}`, { headers })
}

/** Requests the sync socket through the Worker. */
export function openSync(options: SyncOptions = {}): Promise<Response> {
  return exports.default.fetch(syncRequest(options))
}

/**
 * Asserts that `response` is the server refusing a sync socket for want of a session: an upgrade
 * whose socket closes at once with `SYNC_CLOSE_UNAUTHORIZED` (browsers would not show a 401).
 */
export async function expectRefused(response: Response): Promise<void> {
  expect(response.status).toBe(101)
  const socket = response.webSocket
  if (!socket) throw new Error('The upgrade response has no WebSocket')
  const closed = new Promise<CloseEvent>((resolve) => {
    socket.addEventListener('close', resolve)
  })
  socket.accept()
  const event = await closed
  expect(event.code).toBe(SYNC_CLOSE_UNAUTHORIZED)
  expect(event.reason).toBe(SYNC_CLOSE_REASONS.unauthorized)
}

export interface SyncClient {
  readonly store: MergeableStore
  readonly socket: WebSocket
  /** Resolves with the close event when the server (or the client) closes the socket. */
  readonly closed: Promise<CloseEvent>
  /** Stops syncing and closes the socket. */
  stop(): Promise<void>
}

/** Opens the sync socket and syncs a fresh TinyBase store over it, like the app does. */
export async function connectClient(options: SyncOptions): Promise<SyncClient> {
  const response = await openSync(options)
  expect(response.status).toBe(101)
  const socket = response.webSocket
  if (!socket) throw new Error('The upgrade response has no WebSocket')
  const closed = new Promise<CloseEvent>((resolve) => {
    socket.addEventListener('close', resolve)
  })
  socket.accept()
  const store = createMergeableStore()
  const synchronizer: WsSynchronizer<WebSocket> = await createWsSynchronizer(store, socket, 1)
  await synchronizer.startSync()
  return {
    store,
    socket,
    closed,
    stop: async () => {
      await synchronizer.destroy()
    },
  }
}

/** Retries `assertion` until it passes (sync is asynchronous). */
export function eventually(assertion: () => void | Promise<void>, timeout = 5000): Promise<void> {
  return vi.waitFor(assertion, { timeout, interval: 20 })
}

/** The Durable Object stub of a user's store. */
export function stubOf(userId: string) {
  return userSyncStub(env, userId)
}

/** Adds a timer card row the way the app's schema stores it (one cell per field). */
export function addCard(store: MergeableStore, id: string, name: string): void {
  store.setRow('cards', id, {
    kind: 'timer',
    name,
    createdAt: 1_700_000_000_000,
    muted: false,
    position: 0,
    phase: 'idle',
    duration: 300_000,
  })
}
