import { flushSync } from 'svelte'
import { describe, expect, it } from 'vitest'

import {
  SYNC_OFF_STORAGE_KEY,
  createSyncPreference,
  syncOnAfterSignOut,
} from './sync-preference.svelte'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  items: Map<string, string>
} {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a fake, never read reactively
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
    removeItem: (key) => {
      items.delete(key)
    },
  }
}

describe('createSyncPreference', () => {
  it('is on unless turned off, and keeps the choice for the next visit', () => {
    const storage = memoryStorage()
    const preference = createSyncPreference({ storage })
    expect(preference.enabled).toBe(true)
    preference.setEnabled(false)
    expect(preference.enabled).toBe(false)
    expect(storage.items.get(SYNC_OFF_STORAGE_KEY)).toBe('off')
    expect(createSyncPreference({ storage }).enabled).toBe(false)
    preference.setEnabled(true)
    expect(storage.items.has(SYNC_OFF_STORAGE_KEY)).toBe(false)
  })

  it('follows a change made in another tab', () => {
    const storage = memoryStorage()
    let changed: () => void = () => undefined
    const preference = createSyncPreference({
      storage,
      listen: (onChange) => {
        changed = onChange
      },
    })
    storage.setItem(SYNC_OFF_STORAGE_KEY, 'off')
    changed()
    expect(preference.enabled).toBe(false)
  })

  it('is on, for this page only, without storage', () => {
    const preference = createSyncPreference({ storage: null })
    expect(preference.enabled).toBe(true)
    preference.setEnabled(false)
    expect(preference.enabled).toBe(false)
    const throwing = createSyncPreference({
      storage: {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
        removeItem: () => undefined,
      },
    })
    expect(throwing.enabled).toBe(true)
    throwing.setEnabled(false)
    expect(throwing.enabled).toBe(false)
  })
})

describe('syncOnAfterSignOut', () => {
  it('turns sync back on once signed out, so the next sign-in syncs', () => {
    const preference = createSyncPreference({ storage: memoryStorage() })
    let signedOut = $state(false)
    const stop = syncOnAfterSignOut(() => signedOut, preference)
    preference.setEnabled(false)
    flushSync()
    expect(preference.enabled).toBe(false)
    signedOut = true
    flushSync()
    expect(preference.enabled).toBe(true)
    stop()
  })
})
