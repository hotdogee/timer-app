import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cardToRow, presetToRow } from './schema'
import { openSyncedPersister, SYNCED_DB_NAME } from './persist'
import { createSyncedStore, type SyncedStore } from './stores'
import { cards } from '../core'

/** A fresh database name per test, so tests never see each other's data. */
let dbName = ''
let n = 0
beforeEach(() => {
  dbName = `test-${String(++n)}-${String(Math.random())}`
})

const realIndexedDb = globalThis.indexedDB
afterEach(() => {
  globalThis.indexedDB = realIndexedDb
  vi.restoreAllMocks()
})

/** A store with a card, a preset and a few values. */
function filled(): SyncedStore {
  const store = createSyncedStore()
  store.setRow('cards', 'a', cardToRow(cards.createTimerCard('a', 'Tea', 1000, 180_000), 0))
  store.setRow('presets', 'tea', presetToRow({ id: 'tea', name: 'Tea', duration: 180_000 }, 0))
  store.setValues({ schemaVersion: 1, seededAt: 1000, loop: false, keymap: '{}' })
  return store
}

/** Loads database `name` into a new store and detaches again. */
async function loaded(name: string = dbName): Promise<SyncedStore> {
  const store = createSyncedStore()
  const handle = await openSyncedPersister(store, name)
  await handle.stop()
  return store
}

/** An IndexedDB factory whose `open` fails (the next `failures` times, or always). */
function failingOpen(real: IDBFactory, failures = Infinity): IDBFactory {
  let left = failures
  return {
    ...real,
    open(...args: Parameters<IDBFactory['open']>) {
      if (left-- <= 0) return real.open(...args)
      const request = {} as IDBOpenDBRequest
      setTimeout(() => {
        request.onerror?.call(request, new Event('error'))
      })
      return request
    },
  }
}

describe('openSyncedPersister', () => {
  it('uses the app database by default', () => {
    expect(SYNCED_DB_NAME).toBe('timer-app')
  })

  it('saves the store and loads it back into a new one, merge stamps included', async () => {
    const store = filled()
    const handle = await openSyncedPersister(store, dbName)
    expect(handle.saving).toBe(true)
    await handle.stop()
    const back = await loaded()
    expect(back.getTables()).toEqual(store.getTables())
    expect(back.getValues()).toEqual(store.getValues())
    expect(back.getMergeableContent()).toEqual(store.getMergeableContent())
  })

  it('loads what is saved instead of overwriting it with the empty store', async () => {
    await (await openSyncedPersister(filled(), dbName)).stop()
    const store = createSyncedStore()
    const handle = await openSyncedPersister(store, dbName)
    expect(store.getRow('cards', 'a').name).toBe('Tea')
    await handle.stop()
  })

  it('saves every change after loading', async () => {
    const store = createSyncedStore()
    const handle = await openSyncedPersister(store, dbName)
    store.setCell('cards', 'a', 'name', 'First')
    store.setCell('cards', 'a', 'name', 'Second')
    store.delValue('loop')
    store.setValue('volume', 0.25)
    await handle.stop()
    const back = await loaded()
    expect(back.getTables()).toEqual({ cards: { a: { name: 'Second' } } })
    expect(back.getValues()).toEqual({ volume: 0.25 })
  })

  it('treats the first run (nothing saved yet) as normal: no warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = createSyncedStore()
    const handle = await openSyncedPersister(store, dbName)
    expect(handle.saving).toBe(true)
    expect(store.getTables()).toEqual({})
    await handle.stop()
    expect(warn).not.toHaveBeenCalled()
  })

  it('runs in memory with one warning when IndexedDB is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // @ts-expect-error -- simulate a browser without IndexedDB
    delete globalThis.indexedDB
    const store = filled()
    const handle = await openSyncedPersister(store, dbName)
    expect(handle.saving).toBe(false)
    store.setValue('loop', true)
    await handle.stop()
    expect(store.getValue('loop')).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/IndexedDB is unavailable/)
  })

  it('never writes when the saved data could not be read, so it cannot be lost', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await (await openSyncedPersister(filled(), dbName)).stop()
    globalThis.indexedDB = failingOpen(realIndexedDb, 1)
    const store = createSyncedStore()
    const handle = await openSyncedPersister(store, dbName)
    expect(handle.saving).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/could not read/)
    // A fresh seed in memory must not reach the database.
    store.setRow('cards', 'b', { kind: 'timer', name: 'Seed' })
    await handle.stop()
    globalThis.indexedDB = realIndexedDb
    const back = await loaded()
    expect(back.getRowIds('cards')).toEqual(['a'])
  })

  it('keeps running with one warning when saving starts to fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = createSyncedStore()
    const handle = await openSyncedPersister(store, dbName)
    globalThis.indexedDB = failingOpen(realIndexedDb)
    store.setValue('loop', false)
    store.setValue('loop', true)
    await handle.stop()
    expect(store.getValue('loop')).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/could not save/)
  })

  it('runs in memory with one warning when reading indexedDB itself throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Sandboxed and opaque origins throw a SecurityError from the getter.
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied', 'SecurityError')
      },
    })
    try {
      const handle = await openSyncedPersister(filled(), dbName)
      expect(handle.saving).toBe(false)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/IndexedDB is unavailable/)
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        writable: true,
        value: realIndexedDb,
      })
    }
  })

  it('gives up with one warning when opening the database never finishes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    globalThis.indexedDB = { ...realIndexedDb, open: () => ({}) as IDBOpenDBRequest }
    const store = createSyncedStore()
    const handle = await openSyncedPersister(store, dbName, 20)
    expect(handle.saving).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/did not answer/)
    await handle.stop()
  })

  it('never lets a read that finishes after the timeout change the store', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await (await openSyncedPersister(filled(), dbName)).stop()
    // Opening answers, but only after the caller stopped waiting.
    globalThis.indexedDB = {
      ...realIndexedDb,
      open(...args: Parameters<IDBFactory['open']>) {
        const late = {} as IDBOpenDBRequest
        setTimeout(() => {
          const request = realIndexedDb.open(...args)
          request.onupgradeneeded = (event) => {
            late.onupgradeneeded?.call(request, event)
          }
          request.onsuccess = (event) => {
            late.onsuccess?.call(request, event)
          }
          request.onerror = (event) => {
            late.onerror?.call(request, event)
          }
          request.onblocked = (event) => {
            late.onblocked?.call(request, event)
          }
          Object.defineProperty(late, 'result', { get: () => request.result })
        }, 60)
        return late
      },
    }
    const store = createSyncedStore()
    const handle = await openSyncedPersister(store, dbName, 20)
    expect(handle.saving).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(store.getTables()).toEqual({})
    expect(store.getValues()).toEqual({})
  })
})
