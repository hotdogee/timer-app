import { flushSync } from 'svelte'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client/with-schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SYNC_CLOSE_UNAUTHORIZED, SYNC_PING, SYNC_PONG } from './protocol'
import {
  CONNECT_TIMEOUT_MS,
  FIRST_MEASURE_WAIT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_FUTURE_STAMP_MS,
  RECONNECT_BACKOFF,
  createRemoteSync,
  followAccount,
  reconnectDelay,
  remoteSync,
  type NetworkEvents,
  type RemoteSync,
  type RemoteSyncOptions,
  type SynchronizerFactory,
  type SynchronizerLike,
  type VisibilityEvents,
  type WebSocketFactory,
} from './remote.svelte'
import { createSyncedStore, type SyncedStore } from './stores'

/** 14:47 UTC on 2026-10-18. */
const BASE = Date.UTC(2026, 9, 18, 14, 47, 0)

// ── A fake WebSocket and a relay that plays the server ───────────────────────────────────────

/** Every socket created, in order. */
let sockets: FakeWebSocket[] = []
/** Where new sockets connect; null leaves opening to the test. */
let relay: Relay | null = null

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readyState = 0
  bufferedAmount = 0
  protocol = ''
  readonly sent: string[] = []
  closedByClient = false
  onSend: ((data: string) => void) | null = null
  onClosed: (() => void) | null = null

  readonly url: string
  readonly protocols: string | string[] | undefined

  constructor(url: string, protocols?: string | string[]) {
    super()
    this.url = url
    this.protocols = protocols
    sockets.push(this)
    relay?.attach(this)
  }

  send(data: string): void {
    if (this.readyState !== this.OPEN) throw new DOMException('not open', 'InvalidStateError')
    this.sent.push(data)
    this.onSend?.(data)
  }

  /** The client closes: the close event follows asynchronously, as in browsers. */
  close(): void {
    if (this.readyState >= this.CLOSING) return
    this.closedByClient = true
    this.readyState = this.CLOSING
    queueMicrotask(() => {
      this.finish(1000)
    })
  }

  /** The server accepts the upgrade. */
  accept(): void {
    if (this.readyState !== this.CONNECTING) return
    this.readyState = this.OPEN
    this.protocol = 'timer-sync'
    this.dispatchEvent(new Event('open'))
  }

  /** A message from the server. */
  receive(data: string): void {
    if (this.readyState !== this.OPEN) return
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  /** The upgrade fails (a 401, a refused connection): an error, then the close. */
  refuse(): void {
    if (this.readyState === this.CLOSED) return
    this.dispatchEvent(new Event('error'))
    this.finish(1006)
  }

  /** The connection drops (the server closed it, the network went away). */
  drop(): void {
    this.finish(1006)
  }

  /** The server closes the socket with `code`. */
  serverClose(code: number): void {
    this.finish(code)
  }

  private finish(code: number): void {
    if (this.readyState === this.CLOSED) return
    this.readyState = this.CLOSED
    this.onClosed?.()
    this.dispatchEvent(new CloseEvent('close', { code, wasClean: code === 1000 }))
  }
}

const FakeSocketClass = FakeWebSocket as unknown as WebSocketFactory

/** Whether {@link Throwing} throws. */
let throws = false

/** A socket whose constructor throws while {@link throws} is set (a malformed URL). */
class Throwing extends FakeWebSocket {
  constructor(url: string, protocols?: string | string[]) {
    super(url, protocols)
    if (throws) throw new SyntaxError('bad url')
  }
}

/**
 * Plays the Durable Object's relaying (TinyBase's `WsServerDurableObject`): accepts every socket
 * and forwards each payload (`to\nmessage`) from its sender, as `from\nmessage`, to the addressed
 * client or, when the address is empty, to every other one. The server's own store joins as one
 * more client (see `startServer`).
 */
class Relay {
  private readonly clients = new Map<FakeWebSocket, string>()
  private count = 0

  attach(socket: FakeWebSocket): void {
    const id = `client${++this.count}`
    this.clients.set(socket, id)
    socket.onSend = (data) => {
      this.route(socket, id, data)
    }
    socket.onClosed = () => {
      this.clients.delete(socket)
    }
    queueMicrotask(() => {
      socket.accept()
    })
  }

  private route(from: FakeWebSocket, fromId: string, payload: string): void {
    // The heartbeat, answered by the runtime itself.
    if (payload === SYNC_PING) {
      queueMicrotask(() => {
        from.receive(SYNC_PONG)
      })
      return
    }
    const split = payload.indexOf('\n')
    const to = payload.slice(0, split)
    const forwarded = `${fromId}\n${payload.slice(split + 1)}`
    for (const [socket, id] of this.clients) {
      if (socket === from || (to !== '' && to !== id)) continue
      queueMicrotask(() => {
        socket.receive(forwarded)
      })
    }
  }
}

// ── A fake synchronizer and network ─────────────────────────────────────────────────────────

interface FakeSynchronizer extends SynchronizerLike {
  readonly socket: FakeWebSocket
  readonly onMessage: () => void
  started: number
  destroyed: number
}

/** Synchronizers that resolve when their socket opens and reject when it closes first. */
function fakeSynchronizers() {
  const made: FakeSynchronizer[] = []
  const factory: SynchronizerFactory = (_store, socket, onMessage) =>
    new Promise((resolve, reject) => {
      const fake = socket as unknown as FakeWebSocket
      const synchronizer: FakeSynchronizer = {
        socket: fake,
        onMessage,
        started: 0,
        destroyed: 0,
        startSync() {
          this.started++
          return Promise.resolve()
        },
        destroy() {
          this.destroyed++
          fake.close()
          return Promise.resolve()
        },
      }
      made.push(synchronizer)
      fake.addEventListener('open', () => {
        resolve(synchronizer)
      })
      fake.addEventListener('close', () => {
        reject(new Error('closed before open'))
      })
    })
  return { factory, made }
}

class FakeNetwork extends EventTarget implements NetworkEvents {
  onLine = true
  goOnline(): void {
    this.onLine = true
    this.dispatchEvent(new Event('online'))
  }
  goOffline(): void {
    this.onLine = false
    this.dispatchEvent(new Event('offline'))
  }
}

class FakeVisibility extends EventTarget implements VisibilityEvents {
  hidden = false
  show(): void {
    this.hidden = false
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

/** The last socket created. */
function lastSocket(): FakeWebSocket {
  const socket = sockets.at(-1)
  if (!socket) throw new Error('no socket')
  return socket
}

/** A heartbeat interval longer than any test runs. */
const NO_HEARTBEAT = 2 ** 31 - 1

/** Lets queued microtasks and zero-delay timers run. */
async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers({ now: BASE })
  sockets = []
  relay = null
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Tests ───────────────────────────────────────────────────────────────────────────────────

describe('reconnectDelay', () => {
  it('doubles from 1 s to a 30 s cap before jitter', () => {
    const full = (failures: number): number => reconnectDelay(failures, () => 1)
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(full)).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ])
  })

  it('keeps a random 50–100 % of the base delay', () => {
    expect(reconnectDelay(1, () => 0)).toBe(500)
    expect(reconnectDelay(1, () => 0.5)).toBe(750)
    expect(reconnectDelay(6, () => 0)).toBe(15_000)
    for (let i = 0; i < 200; i++) {
      const delay = reconnectDelay(3)
      expect(delay).toBeGreaterThanOrEqual(2000)
      expect(delay).toBeLessThanOrEqual(4000)
    }
  })

  it('treats fewer than one failure as one and clamps a bad random number', () => {
    expect(reconnectDelay(0, () => 1)).toBe(1000)
    expect(reconnectDelay(-3, () => 1)).toBe(1000)
    expect(reconnectDelay(1, () => 7)).toBe(1000)
    expect(reconnectDelay(1, () => -1)).toBe(500)
  })

  it('follows another schedule', () => {
    const backoff = { minMs: 100, maxMs: 250, factor: 3 }
    expect([1, 2, 3].map((n) => reconnectDelay(n, () => 1, backoff))).toEqual([100, 250, 250])
    expect(RECONNECT_BACKOFF).toEqual({ minMs: 1000, maxMs: 30_000, factor: 2 })
  })
})

describe('createRemoteSync', () => {
  function setup(options: RemoteSyncOptions = {}) {
    const store = createSyncedStore()
    const synchronizers = fakeSynchronizers()
    const network = new FakeNetwork()
    let now = BASE + 5000
    const visibility = new FakeVisibility()
    const remote = createRemoteSync(store, {
      WebSocket: FakeSocketClass,
      createSynchronizer: synchronizers.factory,
      network,
      visibility,
      offset: null,
      random: () => 0.5,
      clock: () => now,
      // No heartbeat unless a test asks for one (nothing answers it here).
      heartbeatIntervalMs: NO_HEARTBEAT,
      ...options,
    })
    return {
      remote,
      network,
      visibility,
      made: synchronizers.made,
      setNow: (at: number) => {
        now = at
      },
    }
  }

  /** Fails the current attempt and returns how long until the next socket appears. */
  async function failAndMeasure(fail: () => void, limit = 60_000): Promise<number> {
    const before = sockets.length
    fail()
    let waited = 0
    while (sockets.length === before && waited < limit) {
      await settle(50)
      waited += 50
    }
    return waited
  }

  it('starts off and opens a socket at /api/sync with the sync subprotocol on start', () => {
    const { remote } = setup()
    expect(remote.status).toBe('off')
    expect(remote.lastSyncAt).toBeNull()
    expect(sockets).toHaveLength(0)
    remote.start()
    expect(remote.status).toBe('connecting')
    expect(sockets).toHaveLength(1)
    // jsdom serves the page from http://localhost:3000.
    expect(lastSocket().url).toBe(`ws://${location.host}/api/sync`)
    expect(lastSocket().protocols).toEqual(['timer-sync'])
  })

  it('offers a bearer token as a second subprotocol, read for every attempt', async () => {
    let token: string | null = 'first'
    const { remote } = setup({ token: () => token, url: () => 'wss://timer.example.com/api/sync' })
    remote.start()
    expect(lastSocket().url).toBe('wss://timer.example.com/api/sync')
    expect(lastSocket().protocols).toEqual(['timer-sync', 'timer-auth.first'])
    token = null
    lastSocket().refuse()
    await settle(1000)
    expect(sockets).toHaveLength(2)
    expect(lastSocket().protocols).toEqual(['timer-sync'])
    await remote.stop()
  })

  it('goes online when the socket opens, then runs the first exchange and records it', async () => {
    const onOpen = vi.fn()
    const { remote, made, setNow } = setup({ onOpen })
    remote.start()
    expect(made).toHaveLength(1)
    lastSocket().accept()
    expect(remote.status).toBe('online')
    expect(onOpen).toHaveBeenCalledTimes(1)
    await settle()
    expect(made[0]?.started).toBe(1)
    expect(remote.lastSyncAt).toBe(BASE + 5000)
    setNow(BASE + 9000)
    made[0]?.onMessage()
    expect(remote.lastSyncAt).toBe(BASE + 9000)
    await remote.stop()
  })

  it('retries with exponentially growing, jittered delays while attempts fail', async () => {
    const { remote } = setup()
    remote.start()
    const waits: number[] = []
    for (let i = 0; i < 7; i++) {
      expect(remote.status).toBe('connecting')
      waits.push(await failAndMeasure(() => lastSocket().refuse()))
    }
    // 75 % of 1, 2, 4, 8, 16, 30, 30 s (random() is 0.5), measured in 50 ms steps.
    const expected = [750, 1500, 3000, 6000, 12_000, 22_500, 22_500]
    waits.forEach((wait, index) => {
      expect(wait).toBeGreaterThanOrEqual(expected[index] ?? 0)
      expect(wait).toBeLessThan((expected[index] ?? 0) + 50)
    })
    await remote.stop()
  })

  it('is offline while it waits to try again', async () => {
    const { remote } = setup()
    remote.start()
    lastSocket().refuse()
    expect(remote.status).toBe('offline')
    await settle(749)
    expect(sockets).toHaveLength(1)
    await settle(1)
    expect(sockets).toHaveLength(2)
    expect(remote.status).toBe('connecting')
    await remote.stop()
  })

  it('starts the backoff over once a socket opens', async () => {
    const { remote } = setup()
    remote.start()
    for (let i = 0; i < 4; i++) await failAndMeasure(() => lastSocket().refuse())
    lastSocket().accept()
    await settle()
    expect(remote.status).toBe('online')
    // The connection drops: the first delay again, not the fifth.
    expect(await failAndMeasure(() => lastSocket().drop())).toBeLessThan(800)
    await remote.stop()
  })

  it('reconnects at once when the browser comes back online', async () => {
    const { remote, network } = setup()
    remote.start()
    for (let i = 0; i < 5; i++) await failAndMeasure(() => lastSocket().refuse())
    lastSocket().refuse()
    expect(remote.status).toBe('offline')
    const count = sockets.length
    network.goOnline()
    expect(sockets).toHaveLength(count + 1)
    expect(remote.status).toBe('connecting')
    lastSocket().accept()
    await settle()
    // The cancelled retry never opens a second socket.
    await settle(60_000)
    expect(sockets).toHaveLength(count + 1)
    expect(remote.status).toBe('online')
    await remote.stop()
  })

  it('ignores "online" while a socket is open or connecting', async () => {
    const { remote, network } = setup()
    remote.start()
    network.goOnline()
    expect(sockets).toHaveLength(1)
    lastSocket().accept()
    network.goOnline()
    expect(sockets).toHaveLength(1)
    await remote.stop()
  })

  it('drops the socket when the browser goes offline, and tries again later', async () => {
    const { remote, network, made } = setup()
    remote.start()
    lastSocket().accept()
    await settle()
    const socket = lastSocket()
    network.goOffline()
    expect(remote.status).toBe('offline')
    expect(made[0]?.destroyed).toBe(1)
    await settle()
    expect(socket.readyState).toBe(socket.CLOSED)
    await settle(750)
    expect(sockets).toHaveLength(2)
    await remote.stop()
  })

  it('gives up on a socket that does not open in time', async () => {
    const { remote } = setup()
    remote.start()
    const socket = lastSocket()
    await settle(CONNECT_TIMEOUT_MS - 1)
    expect(remote.status).toBe('connecting')
    await settle(1)
    expect(remote.status).toBe('offline')
    expect(socket.closedByClient).toBe(true)
    await settle(750)
    expect(sockets).toHaveLength(2)
    // A socket that opened in time is not timed out.
    lastSocket().accept()
    await settle(CONNECT_TIMEOUT_MS * 2)
    expect(remote.status).toBe('online')
    await remote.stop()
  })

  it('stops: closes the socket, destroys its synchronizer, never reconnects', async () => {
    const { remote, network, made } = setup()
    remote.start()
    lastSocket().accept()
    await settle()
    const stopping = remote.stop()
    expect(remote.status).toBe('off')
    await stopping
    expect(made[0]?.destroyed).toBe(1)
    await settle()
    expect(lastSocket().readyState).toBe(FakeWebSocket.CLOSED)
    network.goOnline()
    await settle(120_000)
    expect(sockets).toHaveLength(1)
    expect(remote.status).toBe('off')
  })

  it('stops while connecting, and destroys a synchronizer that arrives late', async () => {
    let arrive: (synchronizer: SynchronizerLike) => void = () => undefined
    const startSync = vi.fn(() => Promise.resolve())
    const destroy = vi.fn(() => Promise.resolve())
    const late: SynchronizerLike = { startSync, destroy }
    const { remote } = setup({
      createSynchronizer: () =>
        new Promise((resolve) => {
          arrive = resolve
        }),
    })
    remote.start()
    await remote.stop()
    expect(lastSocket().closedByClient).toBe(true)
    arrive(late)
    await settle()
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(startSync).not.toHaveBeenCalled()
  })

  it('stops while waiting to retry', async () => {
    const { remote } = setup()
    remote.start()
    lastSocket().refuse()
    await remote.stop()
    await settle(60_000)
    expect(sockets).toHaveLength(1)
  })

  it('starts again after a stop, with lastSyncAt cleared', async () => {
    const { remote } = setup()
    remote.start()
    lastSocket().accept()
    await settle()
    expect(remote.lastSyncAt).not.toBeNull()
    await remote.stop()
    remote.start()
    expect(remote.lastSyncAt).toBeNull()
    expect(sockets).toHaveLength(2)
    expect(remote.status).toBe('connecting')
    await remote.stop()
  })

  it('is idempotent: one socket however often it starts, stops more than once', async () => {
    const { remote } = setup()
    remote.start()
    remote.start()
    expect(sockets).toHaveLength(1)
    await remote.stop()
    await remote.stop()
    expect(remote.status).toBe('off')
  })

  it('counts a socket that cannot be created as a failed attempt', async () => {
    throws = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { remote } = setup({ WebSocket: Throwing as unknown as WebSocketFactory })
    remote.start()
    expect(remote.status).toBe('offline')
    expect(warn).toHaveBeenCalledTimes(1)
    throws = false
    await settle(750)
    expect(remote.status).toBe('connecting')
    warn.mockRestore()
    await remote.stop()
  })

  it('asks for a session check when the server refuses the socket, and keeps trying', async () => {
    const checkSession = vi.fn()
    const { remote } = setup({ checkSession })
    remote.start()
    const first = lastSocket()
    first.accept()
    first.serverClose(SYNC_CLOSE_UNAUTHORIZED)
    expect(checkSession).toHaveBeenCalledOnce()
    expect(remote.status).toBe('offline')
    // Still signed in (the session was only renewed, say): the next attempt follows the backoff.
    await settle(reconnectDelay(1, () => 0.5))
    expect(sockets).toHaveLength(2)
    await remote.stop()
  })

  it('asks for a session check every third attempt in a row that never opens while online', async () => {
    const checkSession = vi.fn()
    const { remote, network } = setup({ checkSession })
    remote.start()
    for (let failure = 1; failure <= 6; failure++) {
      lastSocket().refuse()
      await settle(reconnectDelay(failure, () => 0.5))
    }
    expect(checkSession).toHaveBeenCalledTimes(2)
    // Not while offline: those attempts say nothing about the session.
    network.goOffline()
    for (let failure = 7; failure <= 9; failure++) {
      lastSocket().refuse()
      await settle(reconnectDelay(failure, () => 0.5))
    }
    expect(checkSession).toHaveBeenCalledTimes(2)
    await remote.stop()
  })

  it('does not count a socket that opened toward the session check', async () => {
    const checkSession = vi.fn()
    const { remote } = setup({ checkSession })
    remote.start()
    for (let failure = 1; failure <= 3; failure++) {
      lastSocket().accept()
      lastSocket().drop()
      await settle(reconnectDelay(1, () => 0.5))
    }
    expect(checkSession).not.toHaveBeenCalled()
    await remote.stop()
  })

  it('sends a heartbeat every 30 s and reconnects when it gets no answer', async () => {
    const { remote } = setup({ heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS })
    remote.start()
    const first = lastSocket()
    first.accept()
    await settle(HEARTBEAT_INTERVAL_MS)
    expect(first.sent).toEqual([SYNC_PING])
    first.receive(SYNC_PONG)
    await settle(HEARTBEAT_TIMEOUT_MS)
    expect(remote.status).toBe('online')
    expect(sockets).toHaveLength(1)

    // The next one goes unanswered: the connection is dead although the socket reads open.
    await settle(HEARTBEAT_INTERVAL_MS - HEARTBEAT_TIMEOUT_MS)
    expect(first.sent).toEqual([SYNC_PING, SYNC_PING])
    await settle(HEARTBEAT_TIMEOUT_MS)
    expect(remote.status).toBe('offline')
    expect(first.closedByClient).toBe(true)
    await settle(reconnectDelay(1, () => 0.5))
    expect(sockets).toHaveLength(2)
    await remote.stop()
  })

  it('checks the connection when the page becomes visible or the browser says it is online', async () => {
    const { remote, visibility, network } = setup()
    remote.start()
    const socket = lastSocket()
    socket.accept()
    visibility.show()
    expect(socket.sent).toEqual([SYNC_PING])
    // One check at a time.
    network.goOnline()
    expect(socket.sent).toEqual([SYNC_PING])
    socket.receive(SYNC_PONG)
    network.goOnline()
    expect(socket.sent).toEqual([SYNC_PING, SYNC_PING])
    await remote.stop()
    visibility.show()
    expect(socket.sent).toHaveLength(2)
  })

  it('reconnects at once on request, for a full exchange', async () => {
    const { remote } = setup()
    remote.reconnect()
    expect(sockets).toHaveLength(0)
    remote.start()
    const first = lastSocket()
    first.accept()
    remote.reconnect()
    expect(sockets).toHaveLength(2)
    expect(first.closedByClient).toBe(true)
    expect(remote.status).toBe('connecting')
    await remote.stop()
  })

  it('reconnects once server time reaches changes stamped by a clock that ran fast', async () => {
    // Changes stamped while this device's clock read ten minutes ahead.
    const fast = 10 * 60_000
    const store = createSyncedStore('fast', () => Date.now() + fast)
    store.setCell('cards', 'c1', 'name', 'Kitchen')
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a fake, never read reactively
    const listeners = new Set<() => void>()
    let offset = 0
    const remote = createRemoteSync(store, {
      WebSocket: FakeSocketClass,
      createSynchronizer: fakeSynchronizers().factory,
      network: null,
      visibility: null,
      random: () => 0.5,
      heartbeatIntervalMs: NO_HEARTBEAT,
      offset: {
        current: () => offset,
        onChange: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    })
    remote.start()
    lastSocket().accept()
    // The measurement finds the clock fast (the app clock follows the server from now on).
    offset = -fast
    for (const listener of listeners) listener()
    // The server takes the changes once they are at most five minutes ahead of its clock.
    await settle(fast - MAX_FUTURE_STAMP_MS)
    expect(sockets).toHaveLength(1)
    await settle(1000)
    expect(sockets).toHaveLength(2)
    await remote.stop()
    expect(listeners.size).toBe(0)
  })

  it('ignores events from a socket it has given up on', async () => {
    const onOpen = vi.fn()
    const { remote } = setup({ onOpen })
    remote.start()
    const first = lastSocket()
    await settle(CONNECT_TIMEOUT_MS)
    // The timed-out socket opens after all: nothing changes.
    first.readyState = first.CONNECTING
    first.accept()
    expect(onOpen).not.toHaveBeenCalled()
    expect(remote.status).toBe('offline')
    await remote.stop()
  })
})

describe('createRemoteSync status', () => {
  it('is reactive through every transition', async () => {
    const network = new FakeNetwork()
    const remote = createRemoteSync(createSyncedStore(), {
      WebSocket: FakeSocketClass,
      createSynchronizer: fakeSynchronizers().factory,
      network,
      random: () => 0.5,
    })
    const seen: string[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(remote.status)
      })
    })
    flushSync()
    remote.start()
    flushSync()
    lastSocket().accept()
    flushSync()
    lastSocket().drop()
    flushSync()
    await settle(750)
    flushSync()
    network.goOffline()
    flushSync()
    network.goOnline()
    flushSync()
    await remote.stop()
    flushSync()
    expect(seen).toEqual([
      'off',
      'connecting',
      'online',
      'offline',
      'connecting',
      'offline',
      'connecting',
      'off',
    ])
    stop()
  })
})

describe('followAccount', () => {
  function fakes() {
    const calls: string[] = []
    const remote: RemoteSync = {
      status: 'off',
      lastSyncAt: null,
      start: () => {
        calls.push('remote.start')
      },
      stop: () => {
        calls.push('remote.stop')
        return Promise.resolve()
      },
      reconnect: () => {
        calls.push('remote.reconnect')
      },
    }
    /** Resolves the measurement under way. */
    let measured: () => void = () => undefined
    const clock = {
      start: () => {
        calls.push('clock.start')
      },
      stop: () => {
        calls.push('clock.stop')
      },
      measure: () =>
        new Promise<void>((resolve) => {
          calls.push('clock.measure')
          measured = resolve
        }),
    }
    return { remote, clock, calls, measured: () => measured() }
  }

  it('runs sync and the clock while someone is signed in, sync once the clock is measured', async () => {
    const { remote, clock, calls, measured } = fakes()
    let account = $state<{ id: string; name: string } | null>(null)
    const stop = followAccount(() => account?.id ?? null, remote, clock)
    flushSync()
    expect(calls).toEqual([])
    account = { id: 'u1', name: 'Ann' }
    flushSync()
    expect(calls).toEqual(['clock.start', 'clock.measure'])
    measured()
    await settle()
    expect(calls).toEqual(['clock.start', 'clock.measure', 'remote.start'])
    // A new user object for the same account changes nothing.
    account = { id: 'u1', name: 'Ann B.' }
    flushSync()
    await settle()
    expect(calls).toEqual(['clock.start', 'clock.measure', 'remote.start'])
    account = null
    flushSync()
    expect(calls).toEqual([
      'clock.start',
      'clock.measure',
      'remote.start',
      'remote.stop',
      'clock.stop',
    ])
    stop()
  })

  it('starts sync anyway when the clock measurement takes too long', async () => {
    const { remote, clock, calls } = fakes()
    const stop = followAccount(() => 'u1', remote, clock)
    flushSync()
    await settle(FIRST_MEASURE_WAIT_MS - 1)
    expect(calls).toEqual(['clock.start', 'clock.measure'])
    await settle(1)
    expect(calls).toEqual(['clock.start', 'clock.measure', 'remote.start'])
    stop()
  })

  it('never starts sync for an account that signed out before the clock was measured', async () => {
    const { remote, clock, calls, measured } = fakes()
    let id = $state<string | null>('u1')
    const stop = followAccount(() => id, remote, clock)
    flushSync()
    id = null
    flushSync()
    measured()
    await settle(FIRST_MEASURE_WAIT_MS)
    expect(calls).not.toContain('remote.start')
    stop()
  })

  it('restarts for another account, and stops everything when it stops following', async () => {
    const { remote, clock, calls, measured } = fakes()
    let id = $state<string | null>('u1')
    const stop = followAccount(() => id, remote, clock)
    flushSync()
    measured()
    await settle()
    id = 'u2'
    flushSync()
    measured()
    await settle()
    expect(calls).toEqual([
      'clock.start',
      'clock.measure',
      'remote.start',
      'remote.stop',
      'clock.stop',
      'clock.start',
      'clock.measure',
      'remote.start',
    ])
    calls.length = 0
    stop()
    expect(calls).toEqual(['remote.stop', 'clock.stop'])
  })
})

describe('remoteSync', () => {
  it('is the app connection, created stopped', () => {
    expect(remoteSync.status).toBe('off')
    expect(remoteSync.lastSyncAt).toBeNull()
  })
})

describe('createRemoteSync with TinyBase', () => {
  /**
   * The relay and the server's own store on it, as the Durable Object keeps one: it answers every
   * client's first request, so no client waits for a request timeout when it is alone.
   */
  async function startServer() {
    relay = new Relay()
    const store = createSyncedStore('server')
    const socket = new FakeWebSocket('relay://server')
    const synchronizer = await createWsSynchronizer(store, socket as unknown as WebSocket, 0.1)
    const starting = synchronizer.startSync()
    // Alone, its first request times out.
    await settle(200)
    await starting
    return { store, stop: () => synchronizer.destroy() }
  }

  /** Stops every connection, letting TinyBase's pending work finish. */
  async function stopAll(...remotes: RemoteSync[]): Promise<void> {
    const stopping = Promise.all(remotes.map((remote) => remote.stop()))
    await settle(100)
    await stopping
  }

  function device(store: SyncedStore): RemoteSync {
    return createRemoteSync(store, {
      WebSocket: FakeSocketClass,
      network: null,
      random: () => 0.5,
    })
  }

  function cardName(store: SyncedStore, id: string): unknown {
    return store.getCell('cards', id, 'name')
  }

  const card = (name: string, position: number) =>
    ({
      kind: 'timer',
      name,
      createdAt: BASE,
      muted: false,
      position,
      phase: 'idle',
      duration: 300_000,
    }) as const

  it('merges both stores on connect and keeps them in step live', async () => {
    const server = await startServer()
    const a = createSyncedStore('a')
    const b = createSyncedStore('b')
    a.setRow('cards', 'tea', card('Tea', 0))
    b.setRow('cards', 'eggs', card('Eggs', 0))
    const remoteA = device(a)
    const remoteB = device(b)
    remoteA.start()
    await settle(100)
    remoteB.start()
    await settle(100)
    expect(remoteA.status).toBe('online')
    expect(remoteB.status).toBe('online')
    // The first exchange went both ways: each side has both cards.
    expect(cardName(b, 'tea')).toBe('Tea')
    expect(cardName(a, 'eggs')).toBe('Eggs')
    b.setCell('cards', 'tea', 'name', 'Green tea')
    await settle(100)
    expect(cardName(a, 'tea')).toBe('Green tea')
    expect(cardName(server.store, 'tea')).toBe('Green tea')
    expect(remoteA.lastSyncAt).not.toBeNull()
    await stopAll(remoteA, remoteB)
    await server.stop()
  })

  it('keeps the connection through heartbeats: the answer never reaches TinyBase', async () => {
    const server = await startServer()
    const a = createSyncedStore('a')
    const b = createSyncedStore('b')
    const beating = (store: SyncedStore): RemoteSync =>
      createRemoteSync(store, {
        WebSocket: FakeSocketClass,
        network: null,
        random: () => 0.5,
        heartbeatIntervalMs: 1000,
        heartbeatTimeoutMs: 500,
      })
    const remoteA = beating(a)
    const remoteB = beating(b)
    remoteA.start()
    remoteB.start()
    await settle(100)
    const opened = sockets.length
    await settle(5000)
    expect(lastSocket().sent.filter((data) => data === SYNC_PING).length).toBeGreaterThan(3)
    expect(sockets).toHaveLength(opened)
    expect(remoteA.status).toBe('online')
    a.setRow('cards', 'tea', card('Tea', 0))
    await settle(100)
    expect(cardName(b, 'tea')).toBe('Tea')
    await stopAll(remoteA, remoteB)
    await server.stop()
  })

  it('catches up both ways after a dropped connection comes back', async () => {
    const server = await startServer()
    const a = createSyncedStore('a')
    const b = createSyncedStore('b')
    a.setRow('cards', 'tea', card('Tea', 0))
    const remoteA = device(a)
    const remoteB = device(b)
    remoteA.start()
    remoteB.start()
    await settle(100)
    expect(cardName(b, 'tea')).toBe('Tea')

    const bSocket = lastSocket()
    bSocket.drop()
    expect(remoteB.status).toBe('offline')
    // Changes on both sides while apart.
    a.setCell('cards', 'tea', 'name', 'Oolong')
    a.setRow('cards', 'rice', card('Rice', 1))
    b.setRow('cards', 'eggs', card('Eggs', 2))
    await settle(100)
    expect(cardName(b, 'tea')).toBe('Tea')
    expect(a.hasRow('cards', 'eggs')).toBe(false)

    // The retry opens a new socket with a new synchronizer, which exchanges everything.
    await settle(1000)
    expect(remoteB.status).toBe('online')
    expect(lastSocket()).not.toBe(bSocket)
    await settle(100)
    expect(cardName(b, 'tea')).toBe('Oolong')
    expect(cardName(b, 'rice')).toBe('Rice')
    expect(cardName(a, 'eggs')).toBe('Eggs')

    // And live again afterwards.
    a.setCell('cards', 'rice', 'name', 'Brown rice')
    await settle(100)
    expect(cardName(b, 'rice')).toBe('Brown rice')
    await stopAll(remoteA, remoteB)
    await server.stop()
  })

  it('brings a device that joins later up to date from the server alone', async () => {
    const server = await startServer()
    const a = createSyncedStore('a')
    a.setRow('cards', 'tea', card('Tea', 0))
    const remoteA = device(a)
    remoteA.start()
    await settle(100)
    // A leaves; B joins later and finds A's cards on the server.
    await stopAll(remoteA)
    const b = createSyncedStore('b')
    const remoteB = device(b)
    remoteB.start()
    await settle(100)
    expect(cardName(b, 'tea')).toBe('Tea')
    await stopAll(remoteB)
    await server.stop()
  })

  it('leaves the local store as it is when stopped', async () => {
    const server = await startServer()
    const a = createSyncedStore('a')
    const b = createSyncedStore('b')
    a.setRow('cards', 'tea', card('Tea', 0))
    const remoteA = device(a)
    const remoteB = device(b)
    remoteA.start()
    remoteB.start()
    await settle(100)
    await stopAll(remoteB)
    expect(cardName(b, 'tea')).toBe('Tea')
    a.setCell('cards', 'tea', 'name', 'Mint')
    await settle(100)
    expect(cardName(b, 'tea')).toBe('Tea')
    expect(cardName(server.store, 'tea')).toBe('Mint')
    await stopAll(remoteA)
    await server.stop()
  })
})
