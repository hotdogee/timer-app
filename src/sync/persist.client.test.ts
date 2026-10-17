import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEVICE_STORAGE_KEY, openDevicePersister, type StorageHandle } from './persist'
import { createDeviceStore } from './stores'

let key = ''
let n = 0
const handles: StorageHandle[] = []

beforeEach(() => {
  key = `test-device-${String(++n)}`
})

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop()
  localStorage.clear()
  vi.restoreAllMocks()
})

async function open(store = createDeviceStore()): Promise<StorageHandle> {
  const handle = await openDevicePersister(store, key)
  handles.push(handle)
  return handle
}

/** What another tab's save looks like to this one: the `storage` event. */
function otherTabSaves(value: string): void {
  const oldValue = localStorage.getItem(key)
  localStorage.setItem(key, value)
  window.dispatchEvent(
    new StorageEvent('storage', { key, oldValue, newValue: value, storageArea: localStorage }),
  )
}

describe('openDevicePersister', () => {
  it('uses the app key by default', () => {
    expect(DEVICE_STORAGE_KEY).toBe('timer-app-device')
  })

  it('saves the store and loads it back into a new one', async () => {
    const store = createDeviceStore()
    store.setValues({ schemaVersion: 1, themeMode: 'dark', locale: 'ja', digitScale: 1.25 })
    const handle = await openDevicePersister(store, key)
    expect(handle.saving).toBe(true)
    await handle.stop()
    const back = createDeviceStore()
    await open(back)
    expect(back.getValues()).toEqual(store.getValues())
  })

  it('loads what is saved within the same task: no timer or I/O wait before it resolves', async () => {
    localStorage.setItem(key, JSON.stringify([{}, { themeMode: 'light' }]))
    vi.useFakeTimers()
    try {
      const store = createDeviceStore()
      // With fake timers nothing timer-based can settle; only microtasks run.
      await open(store)
      expect(store.getValue('themeMode')).toBe('light')
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves every change', async () => {
    const store = createDeviceStore()
    await open(store)
    store.setValue('density', 'compact')
    await Promise.resolve()
    await vi.waitFor(() => {
      expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual([{}, { density: 'compact' }])
    })
  })

  it("follows another tab's saves", async () => {
    const store = createDeviceStore()
    await open(store)
    otherTabSaves(JSON.stringify([{}, { themeMode: 'dark', seed: '#8e24aa' }]))
    await vi.waitFor(() => {
      expect(store.getValues()).toEqual({ themeMode: 'dark', seed: '#8e24aa' })
    })
  })

  it('treats the first run (nothing saved yet) as normal: no warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = createDeviceStore()
    const handle = await open(store)
    expect(handle.saving).toBe(true)
    expect(store.getValues()).toEqual({})
    expect(warn).not.toHaveBeenCalled()
  })

  it('replaces unreadable saved data, with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    localStorage.setItem(key, 'not json{')
    const store = createDeviceStore()
    await open(store)
    store.setValue('themeMode', 'dark')
    await vi.waitFor(() => {
      expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual([{}, { themeMode: 'dark' }])
    })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('runs in memory with one warning when localStorage is blocked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      const store = createDeviceStore()
      const handle = await openDevicePersister(store, key)
      expect(handle.saving).toBe(false)
      store.setValue('themeMode', 'dark')
      await handle.stop()
      expect(store.getValue('themeMode')).toBe('dark')
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/localStorage is unavailable/)
  })
})
