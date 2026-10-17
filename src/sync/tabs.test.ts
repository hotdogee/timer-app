import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSyncedStore } from './stores'
import { startTabSync, TAB_CHANNEL, TAB_REQUEST_TIMEOUT_SECONDS, type Connection } from './tabs'

const connections: Connection[] = []
let n = 0
/** A fresh channel per test, so tests never hear each other. */
const freshChannel = (): string => `test-tabs-${String(++n)}-${String(Math.random())}`

afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.stop()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function tab(channel: string, store = createSyncedStore()) {
  const connection = startTabSync(store, channel)
  connections.push(connection)
  return { store, connection }
}

describe('startTabSync', () => {
  it('uses the app channel by default', () => {
    expect(TAB_CHANNEL).toBe('timer-app')
  })

  it('brings a new tab the content of a tab already open', async () => {
    const channel = freshChannel()
    const a = tab(channel)
    a.store.setRow('cards', 'x', { kind: 'timer', name: 'Tea', phase: 'idle', duration: 180_000 })
    a.store.setValue('loop', false)
    const b = tab(channel)
    await b.connection.ready
    expect(b.store.getContent()).toEqual(a.store.getContent())
  })

  it('still brings it when the new tab is busy right after joining (startup, mount)', async () => {
    const channel = freshChannel()
    const a = tab(channel)
    a.store.setRow('cards', 'x', { kind: 'timer', name: 'Tea' })
    const b = tab(channel)
    // The stock BroadcastChannel synchronizer gives up after 10 ms; a page that mounts right
    // after joining keeps its thread busy longer than that.
    const end = Date.now() + 60
    while (Date.now() < end) void b.store.getTables()
    await b.connection.ready
    expect(b.store.getTables()).toEqual(a.store.getTables())
  })

  it('lets a lone tab finish its first exchange after the request timeout, silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(TAB_REQUEST_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(0.25)
    const store = createSyncedStore()
    const connection = startTabSync(store, freshChannel(), 0.02)
    connections.push(connection)
    const started = Date.now()
    await connection.ready
    expect(Date.now() - started).toBeGreaterThanOrEqual(15)
    expect(warn).not.toHaveBeenCalled()
  })

  it('stops at once, even during the first exchange', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const connection = startTabSync(createSyncedStore(), freshChannel(), 30)
    const started = Date.now()
    await connection.stop()
    await connection.ready
    expect(Date.now() - started).toBeLessThan(1000)
    expect(warn).not.toHaveBeenCalled()
  })

  it('carries every later change both ways, cell by cell', async () => {
    const channel = freshChannel()
    const a = tab(channel)
    const b = tab(channel)
    await Promise.all([a.connection.ready, b.connection.ready])
    a.store.setRow('cards', 'x', { kind: 'timer', name: 'Tea', phase: 'idle', duration: 1 })
    await vi.waitFor(() => {
      expect(b.store.getCell('cards', 'x', 'name')).toBe('Tea')
    })
    // A rename in one tab and a start in the other merge instead of clobbering each other.
    a.store.setCell('cards', 'x', 'name', 'Green tea')
    b.store.setPartialRow('cards', 'x', { phase: 'running', endsAt: 5000 })
    b.store.setValue('loop', false)
    const merged = { kind: 'timer', name: 'Green tea', phase: 'running', duration: 1, endsAt: 5000 }
    await vi.waitFor(() => {
      expect(a.store.getRow('cards', 'x')).toEqual(merged)
      expect(b.store.getRow('cards', 'x')).toEqual(merged)
      expect(a.store.getValue('loop')).toBe(false)
    })
  })

  it('stops exchanging changes once stopped', async () => {
    const channel = freshChannel()
    const a = tab(channel)
    const b = tab(channel)
    await Promise.all([a.connection.ready, b.connection.ready])
    await b.connection.stop()
    a.store.setValue('loop', false)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(b.store.getValue('loop')).toBeUndefined()
  })

  it('does nothing where BroadcastChannel is missing', async () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const store = createSyncedStore()
    const connection = startTabSync(store, freshChannel())
    await expect(connection.ready).resolves.toBeUndefined()
    await expect(connection.stop()).resolves.toBeUndefined()
  })
})
