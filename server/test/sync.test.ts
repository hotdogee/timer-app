import { evictDurableObject, listDurableObjectIds, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

import { createMergeableStore } from 'tinybase/mergeable-store'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'

import { route } from '../src/index'
import {
  SYNC_CLOSE_REASONS,
  SYNC_CLOSE_UNAUTHORIZED,
  SYNC_PING,
  SYNC_PONG,
  SYNC_REQUEST_TIMEOUT_SECONDS,
  SYNC_SUBPROTOCOL,
  syncSubprotocols,
  type ApiErrorResponse,
} from '../src/protocol'
import { STORE_TABLE, syncObjectName, type SocketSession } from '../src/sync-object'
import {
  addCard,
  call,
  connectClient,
  eventually,
  expectRefused,
  openSync,
  signIn,
  stubOf,
  syncRequest,
  type SyncClient,
  type SyncOptions,
} from './helpers'

const open: SyncClient[] = []

/** A synced client that is stopped after the test. */
async function client(options: SyncOptions): Promise<SyncClient> {
  const synced = await connectClient(options)
  open.push(synced)
  return synced
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((synced) => synced.stop()))
})

async function errorOf(response: Response): Promise<ApiErrorResponse> {
  return response.json()
}

describe('GET /api/sync: the gate', () => {
  it('answers 426 to a request that is not a WebSocket upgrade', async () => {
    const user = await signIn()
    for (const response of [
      await openSync({ noUpgrade: true }),
      await openSync({ noUpgrade: true, cookie: user.cookie }),
    ]) {
      expect(response.status).toBe(426)
      expect(response.headers.get('Upgrade')).toBe('websocket')
      expect(await errorOf(response)).toEqual({ error: 'upgrade-required' })
    }
  })

  it('closes an upgrade without valid credentials at once with 4401', async () => {
    const user = await signIn()
    for (const options of [
      {},
      { protocols: syncSubprotocols('not-a-token') },
      { protocols: syncSubprotocols(`${user.token}x`) },
      { headers: { Authorization: 'Bearer not-a-token' } },
      { cookie: 'timer.session_token=forged.value' },
      // A token in the URL is never read (Workers Logs record URLs).
      { query: `?token=${encodeURIComponent(user.token)}`, origin: null },
    ] satisfies SyncOptions[]) {
      await expectRefused(await openSync(options))
    }
  })

  it('names the sync subprotocol on a refusal too, so browsers see the close code', async () => {
    const response = await openSync({ protocols: syncSubprotocols() })
    expect(response.headers.get('Sec-WebSocket-Protocol')).toBe(SYNC_SUBPROTOCOL)
    await expectRefused(response)
  })

  it('only serves GET', async () => {
    const response = await route(
      new Request('http://localhost:8787/api/sync', { method: 'POST' }),
      env,
    )
    expect(response.status).toBe(405)
  })

  it('requires the timer-sync subprotocol whenever subprotocols are offered', async () => {
    const user = await signIn()
    for (const protocols of [['chat'], [`timer-auth.${user.token}`]]) {
      const response = await openSync({ cookie: user.cookie, protocols })
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toEqual({ error: 'bad-request' })
    }
  })

  it('accepts the session cookie and answers with the sync subprotocol', async () => {
    const user = await signIn()
    const offered = await openSync({ cookie: user.cookie, protocols: syncSubprotocols() })
    expect(offered.status).toBe(101)
    expect(offered.headers.get('Sec-WebSocket-Protocol')).toBe(SYNC_SUBPROTOCOL)
    const plain = await openSync({ cookie: user.cookie })
    expect(plain.status).toBe(101)
    expect(plain.headers.get('Sec-WebSocket-Protocol')).toBeNull()
    for (const response of [offered, plain]) {
      response.webSocket?.accept()
      response.webSocket?.close()
    }
  })

  it('accepts a bearer token in the subprotocol and never echoes the token', async () => {
    const user = await signIn()
    const response = await openSync({ protocols: syncSubprotocols(user.token), origin: null })
    expect(response.status).toBe(101)
    expect(response.headers.get('Sec-WebSocket-Protocol')).toBe(SYNC_SUBPROTOCOL)
    response.webSocket?.accept()
    response.webSocket?.close()
  })

  it('ignores the cookie on an upgrade from an untrusted origin (cross-site hijacking)', async () => {
    const user = await signIn()
    await expectRefused(await openSync({ cookie: user.cookie, origin: 'https://evil.example' }))

    const trusted = { ...env, TRUSTED_ORIGINS: 'https://timer.example, http://localhost:4173' }
    for (const origin of ['https://timer.example', 'http://localhost:4173', null]) {
      const response = await route(syncRequest({ cookie: user.cookie, origin }), trusted)
      expect(response.status).toBe(101)
      response.webSocket?.accept()
      response.webSocket?.close()
    }
  })
})

describe('GET /api/sync: the session behind a socket', () => {
  it('disconnects a device at once when its session signs out, and only that device', async () => {
    const user = await signIn()
    const other = await signIn(user.email)
    const signingOut = await client({ cookie: user.cookie })
    const staying = await client({ cookie: other.cookie })
    const out = await call('/api/auth/sign-out', { body: {}, headers: { Cookie: user.cookie } })
    expect(out.status).toBe(200)
    const closed = await signingOut.closed
    expect(closed.code).toBe(SYNC_CLOSE_UNAUTHORIZED)
    expect(closed.reason).toBe(SYNC_CLOSE_REASONS.signedOut)

    addCard(staying.store, 'c1', 'Tea')
    await eventually(async () => {
      const { tables } = await stubOf(user.userId).exportContent()
      expect(tables.cards?.c1?.name).toBe('Tea')
    })
  })

  it('disconnects every other device when the other sessions are revoked', async () => {
    const user = await signIn()
    const other = await signIn(user.email)
    const lost = await client({ cookie: other.cookie })
    const revoked = await call('/api/auth/revoke-other-sessions', {
      body: {},
      headers: { Cookie: user.cookie },
    })
    expect(revoked.status).toBe(200)
    expect((await lost.closed).code).toBe(SYNC_CLOSE_UNAUTHORIZED)
  })

  it('closes a socket whose session has expired at its next message', async () => {
    const user = await signIn()
    const device = await client({ cookie: user.cookie })
    await runInDurableObject(stubOf(user.userId), (_instance, state) => {
      for (const socket of state.getWebSockets()) {
        const session = socket.deserializeAttachment() as SocketSession
        socket.serializeAttachment({ ...session, expiresAt: Date.now() - 1 })
      }
    })
    addCard(device.store, 'c1', 'Tea')
    const closed = await device.closed
    expect(closed.code).toBe(SYNC_CLOSE_UNAUTHORIZED)
    expect(closed.reason).toBe(SYNC_CLOSE_REASONS.expired)
    const { tables } = await stubOf(user.userId).exportContent()
    expect(tables.cards?.c1).toBeUndefined()
  })

  it('answers the heartbeat', async () => {
    const user = await signIn()
    const response = await openSync({ cookie: user.cookie })
    const socket = response.webSocket
    if (!socket) throw new Error('no socket')
    const pong = new Promise<unknown>((resolve) => {
      socket.addEventListener('message', (event) => {
        if (event.data === SYNC_PONG) resolve(event.data)
      })
    })
    socket.accept()
    socket.send(SYNC_PING)
    expect(await pong).toBe(SYNC_PONG)
    socket.close()
  })
})

describe('GET /api/sync: syncing through the user’s Durable Object', () => {
  it('relays changes between two devices in both directions, merging field by field', async () => {
    const user = await signIn()
    const web = await client({ cookie: user.cookie, protocols: syncSubprotocols() })
    const desktop = await client({ protocols: syncSubprotocols(user.token), origin: null })

    addCard(web.store, 'c1', 'Tea')
    await eventually(() => {
      expect(desktop.store.getRow('cards', 'c1')).toMatchObject({ name: 'Tea', duration: 300_000 })
    })
    desktop.store.setPartialRow('cards', 'c1', { phase: 'running', endsAt: 1_700_000_300_000 })
    await eventually(() => {
      expect(web.store.getCell('cards', 'c1', 'phase')).toBe('running')
    })

    // Concurrent edits of different fields both survive.
    web.store.setCell('cards', 'c1', 'name', 'Green tea')
    desktop.store.setCell('cards', 'c1', 'muted', true)
    web.store.setValue('sound', 'bell')
    await eventually(() => {
      for (const device of [web, desktop]) {
        expect(device.store.getRow('cards', 'c1')).toMatchObject({
          name: 'Green tea',
          muted: true,
          phase: 'running',
        })
        expect(device.store.getValue('sound')).toBe('bell')
      }
    })
  })

  it('keeps the data in SQLite storage across a restart of the object', async () => {
    const user = await signIn()
    const first = await client({ cookie: user.cookie })
    addCard(first.store, 'c1', 'Tea')
    first.store.setValue('volume', 0.5)
    const stub = stubOf(user.userId)
    await eventually(async () => {
      const { tables } = await stub.exportContent()
      expect(tables.cards?.c1?.name).toBe('Tea')
    })
    await first.stop()

    // (On the running object: one started without a socket, by a call like this, waits out a
    // whole request timeout for peers before it takes in changes.)
    const rows = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((row) => row.name),
    )
    expect(rows).toContain(STORE_TABLE)

    await evictDurableObject(stub)
    const later = await client({ cookie: user.cookie })
    await eventually(() => {
      expect(later.store.getCell('cards', 'c1', 'name')).toBe('Tea')
      expect(later.store.getValue('volume')).toBe(0.5)
    })
  })

  it('keeps open sockets syncing when the object hibernates and wakes up', async () => {
    const user = await signIn()
    const a = await client({ cookie: user.cookie })
    const b = await client({ cookie: user.cookie })
    addCard(a.store, 'c1', 'Tea')
    await eventually(() => {
      expect(b.store.getCell('cards', 'c1', 'name')).toBe('Tea')
    })

    await evictDurableObject(stubOf(user.userId), { webSockets: 'hibernate' })

    a.store.setCell('cards', 'c1', 'name', 'Coffee')
    await eventually(() => {
      expect(b.store.getCell('cards', 'c1', 'name')).toBe('Coffee')
    })
    const c = await client({ cookie: user.cookie })
    await eventually(() => {
      expect(c.store.getCell('cards', 'c1', 'name')).toBe('Coffee')
    })
  })

  it('uploads a device’s offline changes although the device answers slowly', async () => {
    const user = await signIn()
    const response = await openSync({ cookie: user.cookie })
    const socket = response.webSocket
    if (!socket) throw new Error('no socket')
    socket.accept()
    // Every message from this device arrives 1.5 s late (a slow link, a busy device).
    const slow = new Proxy(socket, {
      get(target, property) {
        if (property === 'send') {
          return (data: string) => {
            setTimeout(() => {
              target.send(data)
            }, 1500)
          }
        }
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value
      },
    })
    const store = createMergeableStore()
    addCard(store, 'offline', 'Edited offline')
    const synchronizer = await createWsSynchronizer(store, slow, SYNC_REQUEST_TIMEOUT_SECONDS)
    await synchronizer.startSync()
    try {
      await eventually(async () => {
        const { tables } = await stubOf(user.userId).exportContent()
        expect(tables.cards?.offline?.name).toBe('Edited offline')
      }, 15_000)
    } finally {
      await synchronizer.destroy()
    }
  }, 20_000)

  it('keeps every user in their own object: one user never sees another’s data', async () => {
    const alice = await signIn()
    const bob = await signIn()
    const aliceId = env.SYNC.idFromName(syncObjectName(alice.userId))
    const bobId = env.SYNC.idFromName(syncObjectName(bob.userId))
    expect(aliceId.equals(bobId)).toBe(false)

    const aliceDevice = await client({ cookie: alice.cookie })
    addCard(aliceDevice.store, 'alice-card', 'Alice')
    await eventually(async () => {
      const { tables } = await stubOf(alice.userId).exportContent()
      expect(tables.cards?.['alice-card']).toBeDefined()
    })

    // Bob's devices sync with each other (proving their sync ran) and never get Alice's card,
    // even when the request names Alice's object in its query.
    const bobWeb = await client({ cookie: bob.cookie, query: `?path=/user/${alice.userId}` })
    const bobDesktop = await client({ protocols: syncSubprotocols(bob.token), origin: null })
    addCard(bobWeb.store, 'bob-card', 'Bob')
    await eventually(() => {
      expect(bobDesktop.store.getCell('cards', 'bob-card', 'name')).toBe('Bob')
    })
    for (const device of [bobWeb, bobDesktop]) {
      expect(device.store.hasRow('cards', 'alice-card')).toBe(false)
    }
    expect(aliceDevice.store.hasRow('cards', 'bob-card')).toBe(false)

    const aliceStored = await stubOf(alice.userId).exportContent()
    const bobStored = await stubOf(bob.userId).exportContent()
    expect(Object.keys(aliceStored.tables.cards ?? {})).toEqual(['alice-card'])
    expect(Object.keys(bobStored.tables.cards ?? {})).toEqual(['bob-card'])

    const ids = await listDurableObjectIds(env.SYNC)
    expect(ids.some((id) => id.equals(aliceId))).toBe(true)
    expect(ids.some((id) => id.equals(bobId))).toBe(true)
  })
})
