import { flushSync } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'

import { keymap } from '../core'
import { createAppStores } from '../sync/stores'
import { createSettingsStore } from './settings.svelte'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function setup() {
  const stores = createAppStores()
  const store = createSettingsStore(stores)
  cleanups.push(() => {
    store.destroy()
  })
  return { stores, store }
}

/** Runs `read` in an effect and records what it returned on each run. */
function track<T>(read: () => T): T[] {
  const seen: T[] = []
  const stop = $effect.root(() => {
    $effect(() => {
      seen.push(read())
    })
  })
  cleanups.push(stop)
  flushSync()
  return seen
}

describe('settings store reactivity', () => {
  it('re-runs an effect on a setting when it changes, here or in another tab', () => {
    const { stores, store } = setup()
    const themes = track(() => store.device.themeMode)
    store.updateDevice({ themeMode: 'dark' })
    flushSync()
    stores.device.setValue('themeMode', 'light') // another tab's save, loaded
    flushSync()
    expect(themes).toEqual(['system', 'dark', 'light'])
  })

  it('does not re-run an effect for writes that leave the settings as they were', () => {
    const { stores, store } = setup()
    const runs = track(() => store.synced)
    store.updateSynced({ loop: true })
    stores.synced.setValue('seededAt', 5)
    stores.synced.setValue('schemaVersion', 1)
    flushSync()
    expect(runs).toHaveLength(1)
    store.updateSynced({ loop: false })
    flushSync()
    expect(runs).toHaveLength(2)
  })

  it('re-runs an effect on the bindings only when the keymap changes', () => {
    const { store } = setup()
    const bindings = track(() => store.bindings)
    store.updateSynced({ volume: 0.1 })
    flushSync()
    store.updateSynced({ keymap: { settings: ['Mod+.'] } })
    flushSync()
    store.updateSynced({ sound: 'beep' })
    flushSync()
    expect(bindings).toHaveLength(2)
    expect(bindings[0]).toBe(keymap.DEFAULT_BINDINGS)
    expect(bindings[1]?.settings).toEqual(['Mod+.'])
  })

  it('can be updated from inside an effect without the effect depending on the settings', () => {
    const { store } = setup()
    let runs = 0
    const stop = $effect.root(() => {
      $effect(() => {
        runs++
        store.updateSynced({ volume: 0.4 })
      })
    })
    cleanups.push(stop)
    flushSync()
    store.updateSynced({ volume: 0.9 })
    flushSync()
    expect(runs).toBe(1)
    expect(store.synced.volume).toBe(0.9)
  })
})
