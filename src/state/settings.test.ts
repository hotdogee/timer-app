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

describe('desktop settings and the bearer token', () => {
  const EXPIRES = Date.UTC(2026, 10, 17)

  it('start as the defaults and no token on empty stores', () => {
    const { store } = setup()
    expect(store.desktop).toEqual(settings.DESKTOP_DEFAULTS)
    expect(store.auth).toBeNull()
  })

  it('start with what the device store already holds', () => {
    const stores = createAppStores()
    stores.device.setValues({
      closeBehavior: 'quit',
      hotkeyShowApp: 'Mod+Shift+T',
      authToken: 'abc',
      authExpiresAt: EXPIRES,
    })
    const { store } = setup(stores)
    expect(store.desktop).toEqual({
      ...settings.DESKTOP_DEFAULTS,
      closeBehavior: 'quit',
      hotkeys: { toggleLast: null, showApp: 'Mod+Shift+T' },
    })
    expect(store.auth).toEqual({ token: 'abc', expiresAt: EXPIRES })
  })

  it('write only the desktop values that changed, with the schema version the first time', () => {
    const { store, transactions } = setup()
    store.updateDesktop({ launchAtLogin: true })
    expect(transactions().device).toEqual([{ launchAtLogin: true, schemaVersion: 1 }])
    store.updateDesktop({ launchAtLogin: true, hotkeys: { toggleLast: 'Mod+Shift+Space' } })
    expect(transactions().device).toEqual([{ hotkeyToggleLast: 'Mod+Shift+Space' }])
    store.updateDesktop({ hotkeys: { showApp: 'Mod+Shift+T' } })
    expect(store.desktop.hotkeys).toEqual({ toggleLast: 'Mod+Shift+Space', showApp: 'Mod+Shift+T' })
    transactions()
    store.updateDesktop({ hotkeys: { toggleLast: null } })
    expect(transactions().device).toEqual([{ hotkeyToggleLast: '' }])
    expect(store.desktop.hotkeys).toEqual({ toggleLast: null, showApp: 'Mod+Shift+T' })
  })

  it('validate desktop updates, and keep the snapshot for one that changes nothing', () => {
    const { store, transactions } = setup()
    const desktop = store.desktop
    store.updateDesktop({ closeBehavior: 'tray-while-running', hotkeys: {} })
    expect(transactions().device).toEqual([])
    expect(store.desktop).toBe(desktop)
    store.updateDesktop({
      closeBehavior: 'explode' as settings.CloseBehavior,
      hotkeys: { showApp: 'Hyper+K' },
    })
    expect(store.desktop).toBe(desktop)
  })

  it('reset the desktop settings alone, and Appearance › Reset leaves them and the token', () => {
    const { store, transactions } = setup()
    store.updateDevice({ themeMode: 'dark' })
    store.updateDesktop({ miniAlwaysOnTop: false, hotkeys: { showApp: 'Mod+Shift+T' } })
    store.setAuth({ token: 'abc', expiresAt: EXPIRES })
    transactions()
    store.resetDevice()
    expect(store.desktop.miniAlwaysOnTop).toBe(false)
    expect(store.auth).not.toBeNull()
    expect(transactions().device).toEqual([{ themeMode: 'system' }])
    store.resetDesktop()
    expect(store.desktop).toEqual(settings.DESKTOP_DEFAULTS)
    expect(transactions().device).toEqual([{ miniAlwaysOnTop: true, hotkeyShowApp: '' }])
    expect(store.auth).toEqual({ token: 'abc', expiresAt: EXPIRES })
  })

  it('store a token, replace it, and delete it on sign-out', () => {
    const { stores, store, transactions } = setup()
    store.setAuth({ token: 'abc', expiresAt: EXPIRES })
    expect(store.auth).toEqual({ token: 'abc', expiresAt: EXPIRES })
    expect(transactions().device).toEqual([
      { authToken: 'abc', authExpiresAt: EXPIRES, schemaVersion: 1 },
    ])
    const auth = store.auth
    store.setAuth({ token: 'abc', expiresAt: EXPIRES })
    expect(transactions().device).toEqual([])
    expect(store.auth).toBe(auth)
    store.setAuth({ token: 'def', expiresAt: EXPIRES })
    expect(transactions().device).toEqual([{ authToken: 'def' }])
    store.setAuth(null)
    expect(store.auth).toBeNull()
    expect(stores.device.hasValue('authToken')).toBe(false)
    expect(stores.device.hasValue('authExpiresAt')).toBe(false)
    expect(stores.device.hasValue('schemaVersion')).toBe(true)
  })

  it('remove the token when given an invalid one', () => {
    const { stores, store } = setup()
    store.setAuth({ token: 'abc', expiresAt: EXPIRES })
    store.setAuth({ token: 'not a token', expiresAt: EXPIRES })
    expect(store.auth).toBeNull()
    expect(stores.device.hasValue('authToken')).toBe(false)
  })

  it("follow another window's writes", () => {
    const { stores, store } = setup()
    stores.device.setValues({ hotkeyToggleLast: 'Mod+Shift+Space', authToken: 'abc' })
    expect(store.desktop.hotkeys.toggleLast).toBe('Mod+Shift+Space')
    expect(store.auth).toBeNull()
    const hotkeys = store.desktop.hotkeys
    stores.device.setValue('authExpiresAt', EXPIRES)
    expect(store.auth).toEqual({ token: 'abc', expiresAt: EXPIRES })
    stores.device.setValue('closeBehavior', 'tray')
    expect(store.desktop.closeBehavior).toBe('tray')
    expect(store.desktop.hotkeys).toBe(hotkeys)
    stores.device.delValue('authToken')
    expect(store.auth).toBeNull()
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
