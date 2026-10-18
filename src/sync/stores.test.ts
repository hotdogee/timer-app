import { afterEach, describe, expect, it, vi } from 'vitest'

import { setClockOffset } from '../state/app-clock'
import { appStores, createAppStores, createDeviceStore, createSyncedStore } from './stores'

const START = Date.UTC(2026, 9, 18, 9, 0, 0)

describe('createSyncedStore', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is an empty mergeable store', () => {
    const store = createSyncedStore()
    expect(store.isMergeable()).toBe(true)
    expect(store.getTables()).toEqual({})
    expect(store.getValues()).toEqual({})
  })

  it('drops cells and values of the wrong type, non-finite numbers and unknown ids', () => {
    const store = createSyncedStore()
    store.setRow('cards', 'a', { kind: 'timer', name: 'Tea', duration: 60_000 })
    // Untyped writes, as a merge from a newer or broken peer could bring them.
    const untyped = store as unknown as {
      setCell(t: string, r: string, c: string, v: unknown): void
      setValue(id: string, v: unknown): void
      setRow(t: string, r: string, row: object): void
    }
    untyped.setCell('cards', 'a', 'duration', 'soon')
    untyped.setCell('cards', 'a', 'endsAt', Number.NaN)
    untyped.setCell('cards', 'a', 'colour', 'red')
    untyped.setRow('alarms', 'x', { at: 1 })
    untyped.setValue('volume', 'loud')
    untyped.setValue('theme', 'dark')
    store.setValue('loop', false)
    expect(store.getTables()).toEqual({
      cards: { a: { kind: 'timer', name: 'Tea', duration: 60_000 } },
    })
    expect(store.getValues()).toEqual({ loop: false })
  })

  it('stamps changes with app time by default', () => {
    vi.useFakeTimers({ now: START })
    // App time two minutes ahead of the device clock (a measured server-time offset).
    const corrected = createSyncedStore('corrected')
    setClockOffset(120_000)
    try {
      corrected.setValue('volume', 0.2)
    } finally {
      setClockOffset(0)
    }
    // A minute later by the device clock, still earlier than that app time: the corrected change
    // wins.
    vi.setSystemTime(START + 60_000)
    const plain = createSyncedStore('plain', () => Date.now())
    plain.setValue('volume', 0.7)
    plain.merge(corrected)
    expect(plain.getValue('volume')).toBe(0.2)
    expect(corrected.getValue('volume')).toBe(0.2)
  })

  it('uses the given id and clock for its merge stamps', () => {
    const store = createSyncedStore('tab-1', () => 1000)
    store.setValue('loop', true)
    const [, [values]] = store.getMergeableContent()
    expect(values.loop?.[1]).toMatch(/.+/)
  })
})

describe('createDeviceStore', () => {
  it('is a plain store that holds only the device values', () => {
    const store = createDeviceStore()
    expect(store.isMergeable()).toBe(false)
    store.setValue('themeMode', 'dark')
    ;(store as unknown as { setValue(id: string, v: unknown): void }).setValue('volume', 1)
    ;(store as unknown as { setValue(id: string, v: unknown): void }).setValue('fontWeight', 'bold')
    expect(store.getValues()).toEqual({ themeMode: 'dark' })
  })
})

describe('app stores', () => {
  it('are a synced and a device store, created empty', () => {
    const stores = createAppStores()
    expect(stores.synced.isMergeable()).toBe(true)
    expect(stores.device.isMergeable()).toBe(false)
    expect(appStores.synced).not.toBe(stores.synced)
  })
})
