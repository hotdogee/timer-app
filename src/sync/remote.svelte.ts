/**
 * The sync-server connection (spec › Sync): while signed in, the synced store exchanges changes
 * with the user's Durable Object over a WebSocket (`/api/sync`), beside the tab sync. The local
 * store stays the source of truth: the app never waits for the server, signing out leaves the
 * store as it is, and the first exchange after signing in merges local and server content by
 * TinyBase's rules (per cell, newest wins), which is how signing in uploads the local cards.
 *
 * TinyBase's WebSocket synchronizer lives for one socket: it stops listening when its socket
 * closes and closes the socket when destroyed. So the controller owns the reconnecting: every
 * attempt opens a new socket with a new synchronizer, and every open starts a full exchange (each
 * side asks for what the other has), so changes made on either side while apart arrive on
 * reconnect.
 *
 * Reconnecting backs off exponentially with jitter (about 1 s doubling to 30 s), starts over once a
 * socket opens, and tries at once when the browser comes back online. An `offline` event drops the
 * socket at once rather than waiting for it to time out. Idle sockets stay open: the server
 * hibernates them, so they cost nothing.
 *
 * A heartbeat finds connections that died without a close (sleep and wake, a network handover, a
 * NAT timeout): every 30 s while connected, and whenever the page becomes visible or the browser
 * says it is online, the client sends `ping`; without the server's `pong` (which the runtime sends
 * without waking the user's object) within 10 s, it drops the socket and reconnects.
 *
 * The session: the server closes a socket with 4401 when it has no valid session (none, signed
 * out, revoked, expired, or the account was deleted). Browsers hide a refused handshake's status,
 * so this code is how the app learns it; the controller then asks the app to check the session
 * again (`checkSession`), which signs the device out when the session is gone (and so stops this
 * connection), and keeps retrying otherwise. Attempts that keep failing without ever opening while
 * the browser is online ask for a check too, every third time.
 *
 * Clock skew: TinyBase ignores changes stamped more than five minutes ahead of its own clock. A
 * device whose clock ran fast stamped its changes ahead until the server-time offset was known, so
 * the server ignores them; once the offset is applied, the controller reconnects (a full exchange)
 * as soon as server time is close enough to those stamps.
 *
 * The browser sends the session cookie with the upgrade; a client without the cookie (the desktop
 * app) passes its bearer token, which travels as a `timer-auth.<token>` subprotocol
 * (`protocol.ts`).
 */
import { untrack } from 'svelte'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client/with-schemas'

import type { Clock, EpochMs, Ms } from '../core'
import { appClock, clockOffset, onClockOffsetChange } from '../state/app-clock'
import { bearerToken } from '../state/auth.svelte'
import { wsUrl } from './api'
import {
  API_PATHS,
  SYNC_CLOSE_UNAUTHORIZED,
  SYNC_PING,
  SYNC_PONG,
  SYNC_REQUEST_TIMEOUT_SECONDS,
  syncSubprotocols,
} from './protocol'
import { newestStamp, stampTime } from './stamps'
import { appStores, type SyncedStore } from './stores'
import { clockSync, type ClockSync } from './time'

/**
 * Where the connection stands: `off` (not started: signed out), `connecting` (an attempt is
 * under way), `online` (the socket is open), `offline` (no socket; waiting to try again).
 */
export type RemoteSyncStatus = 'off' | 'connecting' | 'online' | 'offline'

/** The connection to the sync server, for one store. */
export interface RemoteSync {
  /** Reactive. */
  readonly status: RemoteSyncStatus
  /**
   * When a message last went to or came from the server, or the last exchange after connecting
   * finished (app time, epoch ms); null since `start` until then. Reactive.
   */
  readonly lastSyncAt: EpochMs | null
  /** Connects and keeps reconnecting until stopped. Idempotent. */
  start(): void
  /** Closes the connection and stops reconnecting; `status` becomes `off` at once. Idempotent. */
  stop(): Promise<void>
  /** Drops the connection and connects again at once (a full exchange), when started. */
  reconnect(): void
}

/** The reconnect schedule: `minMs` after the first failure, times `factor` per failure, at most `maxMs`. */
export interface Backoff {
  readonly minMs: Ms
  readonly maxMs: Ms
  readonly factor: number
}

/** About 1 s, 2 s, 4 s, … up to 30 s, before jitter. */
export const RECONNECT_BACKOFF: Backoff = Object.freeze({ minMs: 1000, maxMs: 30_000, factor: 2 })

/** How long a socket may take to open before the attempt counts as failed. */
export const CONNECT_TIMEOUT_MS = 10_000

/** How long the synchronizer waits for the server to answer one request (`protocol.ts`). */
export { SYNC_REQUEST_TIMEOUT_SECONDS }

/** How often a connected client checks that the connection still works. */
export const HEARTBEAT_INTERVAL_MS = 30_000

/** How long the server's answer to a heartbeat may take before the connection counts as dead. */
export const HEARTBEAT_TIMEOUT_MS = 10_000

/** Every this many attempts in a row that never opened while online, the session is checked. */
export const SESSION_CHECK_EVERY_FAILURES = 3

/** TinyBase ignores changes stamped further ahead of its clock than this (`HLC_MAX_FUTURE_OFFSET`). */
export const MAX_FUTURE_STAMP_MS = 5 * 60_000

/**
 * The wait before the next attempt after `failures` failed ones in a row (at least 1): the
 * backoff's base delay for that many failures, `minMs × factor^(failures − 1)` capped at `maxMs`,
 * of which jitter keeps a random 50–100 %, so clients dropped together (a deploy closes every
 * socket) do not return together. `random` returns a number in [0, 1).
 */
export function reconnectDelay(
  failures: number,
  random: () => number = Math.random,
  backoff: Backoff = RECONNECT_BACKOFF,
): Ms {
  const exponent = Math.max(0, Math.floor(failures) - 1)
  const base = Math.min(backoff.maxMs, backoff.minMs * backoff.factor ** exponent)
  return Math.round(base * (0.5 + Math.min(Math.max(random(), 0), 1) / 2))
}

/** The parts of a synchronizer the controller drives. */
export interface SynchronizerLike {
  startSync(): Promise<unknown>
  destroy(): Promise<unknown>
}

/**
 * Creates a synchronizer for `store` over `socket` (not yet open). It must listen for messages
 * from the moment it is created, call `onMessage` for every message sent or received, resolve
 * once the socket is open and reject when it closes first.
 */
export type SynchronizerFactory = (
  store: SyncedStore,
  socket: WebSocket,
  onMessage: () => void,
) => Promise<SynchronizerLike>

/** TinyBase's WebSocket synchronizer, in the protocol the server's Durable Object speaks. */
export const createTinyBaseSynchronizer: SynchronizerFactory = (store, socket, onMessage) =>
  createWsSynchronizer(store, socket, SYNC_REQUEST_TIMEOUT_SECONDS, onMessage, onMessage)

/** The constructor of the sockets; the browser's `WebSocket` fits. */
export type WebSocketFactory = new (url: string, protocols?: string | string[]) => WebSocket

/** Where `online` and `offline` events come from: the window by default. */
export interface NetworkEvents {
  addEventListener(type: 'online' | 'offline', listener: () => void): void
  removeEventListener(type: 'online' | 'offline', listener: () => void): void
  /** Whether the browser thinks it is online; true when unknown. */
  readonly onLine?: boolean | undefined
}

/** Where `visibilitychange` comes from: the document by default. */
export interface VisibilityEvents {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

/** The server-time offset the controller watches for a fast device clock (`app-clock.ts`). */
export interface ClockOffsetSource {
  /** App time minus device time, in ms. */
  current(): Ms
  /** Calls `listener` after every change; returns a function that stops it. */
  onChange(listener: () => void): () => void
}

/** Dependencies of {@link createRemoteSync}; every field has a default. */
export interface RemoteSyncOptions {
  /** The socket URL, read for every attempt; `/api/sync` on the API origin by default. */
  readonly url?: (() => string) | undefined
  /**
   * A bearer token for clients without the session cookie, read for every attempt. None by
   * default: the browser's cookie authenticates the socket.
   */
  readonly token?: (() => string | null | undefined) | undefined
  /** Called whenever a socket opens (the first time and after every reconnect). */
  readonly onOpen?: (() => void) | undefined
  /**
   * Called when the server says the session is not valid (close code 4401), and every
   * {@link SESSION_CHECK_EVERY_FAILURES} attempts in a row that never opened while online: the
   * app checks the session (and signs out, stopping this connection, when it is gone).
   */
  readonly checkSession?: (() => void) | undefined
  /** The `WebSocket` constructor; the global one by default. */
  readonly WebSocket?: WebSocketFactory | undefined
  /** TinyBase's WebSocket synchronizer by default. */
  readonly createSynchronizer?: SynchronizerFactory | undefined
  /** The clock `lastSyncAt` and the clock-skew catch-up read; the app clock by default. */
  readonly clock?: Clock | undefined
  /** Jitter source in [0, 1); `Math.random` by default. */
  readonly random?: (() => number) | undefined
  /** Source of `online`/`offline` events, or null to ignore them; the window by default. */
  readonly network?: NetworkEvents | null | undefined
  /** Source of `visibilitychange`, or null to ignore it; the document by default. */
  readonly visibility?: VisibilityEvents | null | undefined
  /** The server-time offset, or null to ignore it; the app clock's by default. */
  readonly offset?: ClockOffsetSource | null | undefined
  readonly backoff?: Backoff | undefined
  readonly connectTimeoutMs?: Ms | undefined
  readonly heartbeatIntervalMs?: Ms | undefined
  readonly heartbeatTimeoutMs?: Ms | undefined
}

/** The app clock's offset, as {@link ClockOffsetSource}. */
const APP_CLOCK_OFFSET: ClockOffsetSource = { current: clockOffset, onChange: onClockOffsetChange }

/** One socket and the synchronizer on it. */
interface Attempt {
  readonly socket: WebSocket
  synchronizer: SynchronizerLike | null
  opened: boolean
  connectTimer: ReturnType<typeof setTimeout> | undefined
  /** Set while a heartbeat waits for its answer. */
  pongTimer: ReturnType<typeof setTimeout> | undefined
  detach: () => void
}

function noop(): void {
  // Nothing to do.
}

function defaultNetwork(): NetworkEvents | null {
  if (typeof window === 'undefined') return null
  return {
    addEventListener: (type, listener) => {
      window.addEventListener(type, listener)
    },
    removeEventListener: (type, listener) => {
      window.removeEventListener(type, listener)
    },
    get onLine() {
      return typeof navigator === 'undefined' ? true : navigator.onLine
    },
  }
}

function defaultVisibility(): VisibilityEvents | null {
  return typeof document === 'undefined' ? null : document
}

/** The logical time of the newest change in `store` (epoch ms, app time); 0 when empty. */
function newestStampTime(store: SyncedStore): number {
  return stampTime(newestStamp(store))
}

function defaultWebSocket(): WebSocketFactory | undefined {
  return (globalThis as { WebSocket?: WebSocketFactory }).WebSocket
}

/** Creates a stopped connection for `store`. Nothing touches the network until `start`. */
export function createRemoteSync(store: SyncedStore, options: RemoteSyncOptions = {}): RemoteSync {
  const url = options.url ?? (() => wsUrl(API_PATHS.sync))
  const createSynchronizer = options.createSynchronizer ?? createTinyBaseSynchronizer
  const clock = options.clock ?? appClock
  const random = options.random ?? Math.random
  const network = options.network === undefined ? defaultNetwork() : options.network
  const visibility = options.visibility === undefined ? defaultVisibility() : options.visibility
  const offset = options.offset === undefined ? APP_CLOCK_OFFSET : options.offset
  const backoff = options.backoff ?? RECONNECT_BACKOFF
  const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS

  let status = $state<RemoteSyncStatus>('off')
  let lastSyncAt = $state<EpochMs | null>(null)
  let started = false
  let attempt: Attempt | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  /** Failed attempts since the last socket that opened. */
  let failures = 0
  /** Attempts in a row that never opened while the browser was online. */
  let unopened = 0
  let heartbeat: ReturnType<typeof setInterval> | undefined
  /** The reconnect waiting for server time to reach this device's future stamps. */
  let catchUp: ReturnType<typeof setTimeout> | undefined
  let stopWatchingOffset: (() => void) | null = null

  function synced(): void {
    if (started) lastSyncAt = clock()
  }

  function cancelRetry(): void {
    if (retry === undefined) return
    clearTimeout(retry)
    retry = undefined
  }

  function online(): boolean {
    return network?.onLine !== false
  }

  /** Sends a heartbeat on the open socket, unless one is waiting for its answer. */
  function ping(): void {
    const current = attempt
    if (!current?.opened || current.pongTimer !== undefined) return
    try {
      current.socket.send(SYNC_PING)
    } catch {
      fail(current)
      return
    }
    current.pongTimer = setTimeout(() => {
      current.pongTimer = undefined
      // No answer: the connection is gone although the socket reads open.
      fail(current)
    }, heartbeatTimeoutMs)
  }

  /** Closes `current`'s socket and forgets it. Settles once its synchronizer is destroyed. */
  function discard(current: Attempt): Promise<void> {
    if (attempt === current) attempt = null
    clearTimeout(current.connectTimer)
    clearTimeout(current.pongTimer)
    current.pongTimer = undefined
    current.detach()
    // Destroying the synchronizer also closes the socket.
    if (current.synchronizer) return current.synchronizer.destroy().then(noop, noop)
    try {
      current.socket.close()
    } catch {
      // Already closed.
    }
    return Promise.resolve()
  }

  /**
   * The attempt ended (closed, failed, timed out, or the network went away): try again later.
   * `refused` is a close by the server for want of a session, which is an answer, not a failure
   * to connect.
   */
  function fail(current: Attempt | null, refused = false): void {
    if (current) {
      if (attempt !== current) return
      void discard(current)
      if (!current.opened && !refused && online()) {
        unopened++
        if (started && unopened % SESSION_CHECK_EVERY_FAILURES === 0) options.checkSession?.()
      }
    }
    if (!started) return
    failures++
    status = 'offline'
    cancelRetry()
    retry = setTimeout(connect, reconnectDelay(failures, random, backoff))
  }

  function connect(): void {
    retry = undefined
    if (!started || attempt) return
    const WebSocketClass = options.WebSocket ?? defaultWebSocket()
    let socket: WebSocket
    try {
      if (!WebSocketClass) throw new Error('no WebSocket')
      socket = new WebSocketClass(url(), syncSubprotocols(options.token?.()))
    } catch (error) {
      console.warn('Timer App: could not open the sync connection', error)
      fail(null)
      return
    }
    const current: Attempt = {
      socket,
      synchronizer: null,
      opened: false,
      connectTimer: undefined,
      pongTimer: undefined,
      detach: () => undefined,
    }
    attempt = current
    status = 'connecting'

    const onOpen = (): void => {
      if (attempt !== current) return
      current.opened = true
      clearTimeout(current.connectTimer)
      failures = 0
      unopened = 0
      status = 'online'
      options.onOpen?.()
    }
    const onClose = (event: CloseEvent): void => {
      if (attempt !== current) return
      const refused = event.code === SYNC_CLOSE_UNAUTHORIZED
      fail(current, refused)
      if (refused && started) options.checkSession?.()
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.data !== SYNC_PONG) return
      // Not a TinyBase message: TinyBase would close the socket over it (1007). This listener
      // comes before the synchronizer's, so it can keep the answer from reaching it.
      event.stopImmediatePropagation()
      if (attempt !== current) return
      clearTimeout(current.pongTimer)
      current.pongTimer = undefined
    }
    socket.addEventListener('open', onOpen)
    socket.addEventListener('close', onClose)
    socket.addEventListener('message', onMessage)
    current.detach = () => {
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('close', onClose)
      socket.removeEventListener('message', onMessage)
    }
    current.connectTimer = setTimeout(() => {
      if (!current.opened) fail(current)
    }, connectTimeoutMs)

    // Created at once, so it hears the server's first message; it resolves when the socket opens.
    // After the listeners above, so the heartbeat's answer never reaches it.
    let creating: Promise<SynchronizerLike>
    try {
      creating = createSynchronizer(store, socket, synced)
    } catch (error) {
      creating = Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    creating.then(
      (synchronizer) => {
        if (attempt !== current) {
          void synchronizer.destroy().then(noop, noop)
          return
        }
        current.synchronizer = synchronizer
        synchronizer.startSync().then(() => {
          if (attempt === current) synced()
        }, noop)
      },
      // The socket closed or failed before it opened; its close event schedules the retry.
      noop,
    )
  }

  function onOnline(): void {
    // Back online: try now instead of waiting out the backoff; an open socket may be stale.
    if (!started) return
    if (attempt) {
      ping()
      return
    }
    cancelRetry()
    connect()
  }

  function onVisibility(): void {
    if (started && visibility?.hidden === false) ping()
  }

  /**
   * After a change of the server-time offset: when the device clock was fast by more than TinyBase
   * accepts, the changes stamped before the offset was known are too far ahead for the server.
   * Reconnect (a full exchange) once server time is within reach of the newest of them.
   */
  function scheduleCatchUp(): void {
    clearTimeout(catchUp)
    catchUp = undefined
    if (!started || offset === null || offset.current() > -MAX_FUTURE_STAMP_MS) return
    const wait = newestStampTime(store) - MAX_FUTURE_STAMP_MS + 1000 - clock()
    if (wait <= 0) return
    catchUp = setTimeout(
      () => {
        catchUp = undefined
        if (!started) return
        if (newestStampTime(store) - MAX_FUTURE_STAMP_MS + 1000 - clock() > 0) {
          scheduleCatchUp()
          return
        }
        reconnectNow()
      },
      Math.min(wait, 2 ** 31 - 1),
    )
  }

  function reconnectNow(): void {
    if (!started) return
    cancelRetry()
    if (attempt) void discard(attempt)
    failures = 0
    connect()
  }

  function onOffline(): void {
    // The socket cannot work now; drop it instead of waiting for it to time out.
    if (started && attempt) fail(attempt)
  }

  return {
    get status() {
      return status
    },
    get lastSyncAt() {
      return lastSyncAt
    },
    start() {
      if (started) return
      started = true
      failures = 0
      lastSyncAt = null
      network?.addEventListener('online', onOnline)
      network?.addEventListener('offline', onOffline)
      visibility?.addEventListener('visibilitychange', onVisibility)
      heartbeat = setInterval(ping, heartbeatIntervalMs)
      stopWatchingOffset = offset?.onChange(scheduleCatchUp) ?? null
      connect()
      scheduleCatchUp()
    },
    async stop() {
      if (!started) return
      started = false
      cancelRetry()
      network?.removeEventListener('online', onOnline)
      network?.removeEventListener('offline', onOffline)
      visibility?.removeEventListener('visibilitychange', onVisibility)
      clearInterval(heartbeat)
      heartbeat = undefined
      clearTimeout(catchUp)
      catchUp = undefined
      stopWatchingOffset?.()
      stopWatchingOffset = null
      status = 'off'
      if (attempt) await discard(attempt)
    },
    reconnect: reconnectNow,
  }
}

/** What the app does when the connection doubts the session (`main.ts` sets it). */
let sessionCheck: (() => void) | null = null

/** Sets what {@link remoteSync} calls to have the session checked (the auth state's refresh). */
export function onSessionDoubt(check: (() => void) | null): void {
  sessionCheck = check
}

/**
 * The app's connection: the app's synced store, `/api/sync` on the API origin with the session
 * cookie (the desktop app: its stored bearer token), and the server-time offset measured again on
 * every open.
 */
export const remoteSync: RemoteSync = createRemoteSync(appStores.synced, {
  token: bearerToken,
  onOpen: () => {
    void clockSync.measure()
  },
  checkSession: () => {
    sessionCheck?.()
  },
})

/** How long sync waits for the first clock measurement after signing in. */
export const FIRST_MEASURE_WAIT_MS = 5000

/**
 * Keeps `remote` and the clock sync running while someone is signed in (and sync is on): starts
 * both when `accountId()` (the signed-in user's id, or null) becomes an id, stops both when it
 * becomes null, and restarts both when it changes to another account, so a socket never outlives
 * the session it was opened with. The connection starts once the first clock measurement is in
 * (at most {@link FIRST_MEASURE_WAIT_MS}), so a device whose clock is far off does not stamp or
 * judge the first exchange by it. Reads `accountId` in an effect, so pass a getter over reactive
 * state (`() => authStore.user?.id ?? null`). Call it once the local data is loaded (after
 * `startAppData`), so the first exchange merges the saved cards. Returns a function that stops
 * following and stops both.
 */
export function followAccount(
  accountId: () => string | null,
  remote: RemoteSync = remoteSync,
  clock: Pick<ClockSync, 'start' | 'stop' | 'measure'> = clockSync,
): () => void {
  return $effect.root(() => {
    // Through a derived, so a new user object for the same account does not restart anything.
    const account = $derived(accountId())
    $effect(() => {
      const id = account
      if (id === null) return
      let active = true
      let wait: ReturnType<typeof setTimeout> | undefined
      untrack(() => {
        clock.start()
        const begin = (): void => {
          clearTimeout(wait)
          if (active) remote.start()
        }
        wait = setTimeout(begin, FIRST_MEASURE_WAIT_MS)
        void clock.measure().then(begin, begin)
      })
      return () => {
        active = false
        clearTimeout(wait)
        void remote.stop()
        clock.stop()
      }
    })
  })
}
