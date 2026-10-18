/**
 * Settings › Account › "Sync this device" (spec › Settings › Account: sync on / off): whether this
 * device syncs while signed in. On unless turned off here; it belongs to the device, never synced,
 * and lives in localStorage beside the account cache, so every tab of the app follows it (through
 * the `storage` event). Signing out turns it back on, so a sign-in always turns sync on (spec ›
 * Sync › Accounts are optional).
 *
 * Off, the app stays signed in but neither connects to the sync server nor corrects the clock; the
 * cards stay on the device as they are. Turning it on again exchanges everything that changed.
 */

import { untrack } from 'svelte'

/** The localStorage key; present (`"off"`) only while sync is off. */
export const SYNC_OFF_STORAGE_KEY = 'timer-app-sync-off'

/** Whether this device syncs while signed in. Reactive. */
export interface SyncPreference {
  readonly enabled: boolean
  setEnabled(enabled: boolean): void
}

/** Where the preference is kept, and how changes from other tabs arrive. */
export interface SyncPreferenceStorage {
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  /** Listens to `storage` events (other tabs); returns nothing to keep, as it lasts the page. */
  readonly listen?: ((onChange: () => void) => void) | undefined
}

function browserStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function browserListen(onChange: () => void): void {
  if (typeof window === 'undefined') return
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === SYNC_OFF_STORAGE_KEY) onChange()
  })
}

/** Creates the preference over `storage` (localStorage and its `storage` events by default). */
export function createSyncPreference(
  options: SyncPreferenceStorage = { storage: browserStorage(), listen: browserListen },
): SyncPreference {
  const { storage } = options
  const read = (): boolean => {
    try {
      // Off only when the key is there; no storage at all reads as on.
      return (storage?.getItem(SYNC_OFF_STORAGE_KEY) ?? null) === null
    } catch {
      return true
    }
  }
  let enabled = $state(read())
  options.listen?.(() => {
    enabled = read()
  })
  return {
    get enabled() {
      return enabled
    },
    setEnabled(next) {
      enabled = next
      try {
        if (next) storage?.removeItem(SYNC_OFF_STORAGE_KEY)
        else storage?.setItem(SYNC_OFF_STORAGE_KEY, 'off')
      } catch {
        // Blocked storage: the choice lasts for this page only.
      }
    },
  }
}

/** The app's preference. */
export const syncPreference: SyncPreference = createSyncPreference()

/**
 * Turns `preference` back on whenever `signedOut()` becomes true (however the device was signed
 * out: here, in another tab, or because the session ended), so the next sign-in syncs. Reads
 * `signedOut` in an effect, so pass a getter over reactive state. Returns a function that stops.
 */
export function syncOnAfterSignOut(
  signedOut: () => boolean,
  preference: SyncPreference = syncPreference,
): () => void {
  return $effect.root(() => {
    $effect(() => {
      if (signedOut() && !untrack(() => preference.enabled)) preference.setEnabled(true)
    })
  })
}
