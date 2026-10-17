import { afterEach, describe, expect, it } from 'vitest'

import { keymap, settings } from '../core'
import { syncedSettingsToValues } from '../sync/schema'
import { appStores, createAppStores, type AppStores } from '../sync/stores'
import { createSettingsStore, settingsStore, type BoundSettingsStore } from './settings.svelte'

const destroyers: (() => void)[] = []
afterEach(() => {
  for (const destroy of destroyers.splice(0)) destroy()
})

function setup(stores: AppStores = createAppStores()): {
  stores: AppStores
  store: BoundSettingsStore
  transactions: () => { synced: unknown[]; device: unknown[] }
} {
  const store = createSettingsStore(stores)
  destroyers.push(() => {
    store.destroy()
  })
  const seen = { synced: [] as unknown[], device: [] as unknown[] }
  const synced = stores.synced.addDidFinishTransactionListener(() => {
    seen.synced.push(stores.synced.getTransactionChanges()[1])
  })
  const device = stores.device.addDidFinishTransactionListener(() => {
    seen.device.push(stores.device.getTransactionChanges()[1])
  })
  destroyers.push(() => {
    stores.synced.delListener(synced)
    stores.device.delListener(device)
  })
  return {
    stores,
    store,
    transactions: () => ({ synced: seen.synced.splice(0), device: seen.device.splice(0) }),
  }
}

describe('createSettingsStore', () => {
  it('starts with the defaults on empty stores', () => {
    const { store } = setup()
    expect(store.device).toEqual(settings.DEVICE_DEFAULTS)
    expect(store.synced).toEqual(settings.SYNCED_DEFAULTS)
    expect(store.bindings).toBe(keymap.DEFAULT_BINDINGS)
  })

  it('starts with what the stores already hold', () => {
    const stores = createAppStores()
    stores.device.setValues({ themeMode: 'dark', locale: 'ja' })
    stores.synced.setValues({ loop: false, keymap: '{"newTimer":["Shift+T"]}' })
    const { store } = setup(stores)
    expect(store.device).toMatchObject({ themeMode: 'dark', locale: 'ja' })
    expect(store.synced).toMatchObject({ loop: false, keymap: { newTimer: ['Shift+T'] } })
    expect(store.bindings.newTimer).toEqual(['Shift+T'])
  })

  it('writes only the values that changed, with the schema version the first time', () => {
    const { store, transactions } = setup()
    store.updateDevice({ themeMode: 'dark' })
    expect(transactions().device).toEqual([{ themeMode: 'dark', schemaVersion: 1 }])
    store.updateDevice({ themeMode: 'dark', density: 'compact' })
    expect(transactions().device).toEqual([{ density: 'compact' }])
    store.updateSynced({ volume: 0.5, loop: true })
    expect(transactions().synced).toEqual([{ volume: 0.5, schemaVersion: 1 }])
    expect(store.device).toMatchObject({ themeMode: 'dark', density: 'compact' })
    expect(store.synced.volume).toBe(0.5)
  })

  it('writes nothing, and keeps its snapshots, for an update that changes nothing', () => {
    const { store, transactions } = setup()
    const { device, synced } = store
    store.updateDevice({ themeMode: 'system' })
    store.updateSynced({ quickAdd: [30_000, 60_000, 300_000], keymap: {} })
    store.updateSynced({})
    expect(transactions()).toEqual({ synced: [], device: [] })
    expect(store.device).toBe(device)
    expect(store.synced).toBe(synced)
  })

  it('validates updates: invalid values fall back and numbers are clamped and rounded', () => {
    const { stores, store } = setup()
    store.updateDevice({ fontWeight: 1234, digitScale: 9, seed: '#ABC' })
    expect(store.device).toMatchObject({ fontWeight: 700, digitScale: 1.5, seed: '#aabbcc' })
    store.updateSynced({
      volume: -1,
      quickAdd: [500, 90_061, 1e12],
      timeStyle: 'roman' as settings.TimeStyle,
    })
    expect(store.synced).toMatchObject({
      volume: 0,
      quickAdd: [1000, 90_000, 86_400_000],
      timeStyle: 'compact',
    })
    expect(stores.synced.getValue('quickAdd')).toBe('[1000,90000,86400000]')
  })

  it('derives the bindings from the keymap and keeps them while the keymap stays', () => {
    const { store } = setup()
    store.updateSynced({ keymap: { newTimer: ['Shift+T'], help: [] } })
    const bindings = store.bindings
    expect(bindings.newTimer).toEqual(['Shift+T'])
    expect(bindings.help).toEqual([])
    expect(bindings.palette).toEqual(keymap.DEFAULT_BINDINGS.palette)
    const map = store.synced.keymap
    store.updateSynced({ volume: 0.3 })
    expect(store.synced.keymap).toBe(map)
    expect(store.bindings).toBe(bindings)
    store.updateSynced({ keymap: { ...map } })
    expect(store.bindings).toBe(bindings)
    store.updateSynced({ keymap: {} })
    expect(store.bindings).toBe(keymap.DEFAULT_BINDINGS)
  })

  it('resets each group to its defaults, writing only what differs', () => {
    const { store, transactions } = setup()
    store.updateDevice({ themeMode: 'light', font: 'inter' })
    store.updateSynced({ loop: false, keymap: { newTimer: ['Shift+T'] } })
    transactions()
    store.resetDevice()
    expect(store.device).toEqual(settings.DEVICE_DEFAULTS)
    expect(transactions().device).toEqual([{ themeMode: 'system', font: 'roboto-flex' }])
    // Behavior's Reset leaves the shortcuts; the keyboard's Reset all restores only them.
    store.resetBehavior()
    expect(store.synced).toEqual({ ...settings.SYNCED_DEFAULTS, keymap: { newTimer: ['Shift+T'] } })
    expect(transactions().synced).toEqual([{ loop: true }])
    store.resetKeymap()
    expect(store.synced).toEqual(settings.SYNCED_DEFAULTS)
    expect(store.bindings).toBe(keymap.DEFAULT_BINDINGS)
    expect(transactions().synced).toEqual([{ keymap: '{}' }])
  })

  it('resets the keymap without touching the behavior settings', () => {
    const { store, transactions } = setup()
    store.updateSynced({ volume: 0.3, keymap: { lap: ['x'] } })
    transactions()
    store.resetKeymap()
    expect(store.synced.volume).toBe(0.3)
    expect(store.synced.keymap).toEqual({})
    store.resetBehavior()
    expect(store.synced).toEqual(settings.SYNCED_DEFAULTS)
  })

  it("follows another tab's writes, replacing a snapshot only when its content changed", () => {
    const { stores, store } = setup()
    stores.synced.setValues({ ...syncedSettingsToValues(settings.SYNCED_DEFAULTS), sound: 'bell' })
    expect(store.synced.sound).toBe('bell')
    const synced = store.synced
    stores.synced.setValue('seededAt', 1)
    expect(store.synced).toBe(synced)
    stores.device.setValue('locale', 'zh-TW')
    expect(store.device.locale).toBe('zh-TW')
    stores.device.setValue('locale', 'klingon')
    expect(store.device.locale).toBe('auto')
  })

  it('stops following the stores once destroyed', () => {
    const { stores, store } = setup()
    store.destroy()
    stores.device.setValue('themeMode', 'dark')
    expect(store.device.themeMode).toBe('system')
  })
})

describe('settingsStore', () => {
  it("follows the app's stores", () => {
    expect(settingsStore.device).toEqual(settings.DEVICE_DEFAULTS)
    appStores.device.setValue('density', 'compact')
    expect(settingsStore.device.density).toBe('compact')
    settingsStore.resetDevice()
    expect(appStores.device.getValue('density')).toBe('comfortable')
  })
})
