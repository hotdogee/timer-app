/**
 * Persistence for the two stores (tech-stack.md › Data store):
 *
 * - The synced store lives in IndexedDB. It is loaded once at startup and then saved after every
 *   change. It is never auto-loaded: IndexedDB has no change events, so TinyBase would poll it;
 *   other tabs' changes arrive through the BroadcastChannel synchronizer (`tabs.ts`) instead.
 * - The device store lives in localStorage, which is read without waiting on I/O, so the theme and
 *   language are known before the first paint. It is loaded, then followed (localStorage fires
 *   `storage` events in other tabs) and saved after every change.
 *
 * Storage can be missing, broken or stuck (private browsing, blocked site data, a full disk, an
 * open that never answers). The app then keeps running in memory with one console warning;
 * nothing here throws or waits forever. When the saved cards cannot be read, they are also never
 * written, so a passing failure cannot overwrite them with an empty or freshly seeded store.
 */
import { createLocalPersister } from 'tinybase/persisters/persister-browser/with-schemas'
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db/with-schemas'

import { createSyncedStore, type DeviceStore, type SyncedStore } from './stores'

/** The IndexedDB database of the synced store. */
export const SYNCED_DB_NAME = 'timer-app'

/** The localStorage key of the device store. */
export const DEVICE_STORAGE_KEY = 'timer-app-device'

/**
 * How long startup waits for IndexedDB to read the saved data before the app runs in memory. A
 * healthy read takes milliseconds.
 */
export const SYNCED_OPEN_TIMEOUT_MS = 3000

/** An opened persister. */
export interface StorageHandle {
  /**
   * Whether changes are being saved. False when the storage is unavailable, or (for the synced
   * store) when the saved data could not be read; the store then lives in memory only.
   */
  readonly saving: boolean
  /** Saves once more if saving, then detaches the persister. The store keeps its content. */
  stop(): Promise<void>
}

const NOT_SAVING: StorageHandle = Object.freeze({ saving: false, stop: () => Promise.resolve() })

/** Calls `warn` the first time only. */
function once(warn: (error: unknown) => void): (error: unknown) => void {
  let warned = false
  return (error) => {
    if (warned) return
    warned = true
    warn(error)
  }
}

/** Whether IndexedDB can be used: reading the property itself throws in some sandboxed origins. */
function indexedDbWorks(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

/** The error IndexedDB raises when an object store does not exist yet, as on the first run. */
function isNothingSavedYet(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotFoundError'
  )
}

/**
 * Loads `store` from IndexedDB database `dbName` and saves it after every change from then on. The
 * first run (nothing saved yet) is not an error. When IndexedDB is missing or blocked, the saved
 * data cannot be read, or IndexedDB does not answer within `timeoutMs` (a stuck first open, as
 * some WebKit versions have), it warns once and returns a handle that does not save.
 *
 * The saved data is read into a scratch store and copied into `store` only once it is all there,
 * so a read that finishes after the timeout never lands in a store the app already runs on.
 */
export async function openSyncedPersister(
  store: SyncedStore,
  dbName: string = SYNCED_DB_NAME,
  timeoutMs: number = SYNCED_OPEN_TIMEOUT_MS,
): Promise<StorageHandle> {
  if (!indexedDbWorks()) {
    console.warn('Timer App: IndexedDB is unavailable; cards and settings will not be saved')
    return NOT_SAVING
  }
  let abandoned = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null)
    }, timeoutMs)
  })
  const attached = attachSynced(store, dbName, () => abandoned).catch((error: unknown) => {
    console.warn(
      'Timer App: could not open saved cards and settings; changes stay in memory',
      error,
    )
    return NOT_SAVING
  })
  const handle = await Promise.race([attached, timeout])
  clearTimeout(timer)
  if (handle !== null) return handle
  abandoned = true
  console.warn('Timer App: IndexedDB did not answer; cards and settings will not be saved')
  return NOT_SAVING
}

/**
 * Reads database `dbName` into `store` and starts saving it, unless `abandoned()` turned true on
 * the way (the caller stopped waiting): then it changes nothing and saves nothing.
 */
async function attachSynced(
  store: SyncedStore,
  dbName: string,
  abandoned: () => boolean,
): Promise<StorageHandle> {
  let loadFailed = false
  const scratch = createSyncedStore()
  const reader = createIndexedDbPersister(scratch, dbName, undefined, (error: unknown) => {
    if (!isNothingSavedYet(error)) loadFailed = true
  })
  try {
    await reader.load()
  } finally {
    await reader.destroy()
  }
  if (abandoned()) return NOT_SAVING
  if (loadFailed) {
    console.warn('Timer App: could not read saved cards and settings; changes will not be saved')
    return NOT_SAVING
  }
  // A merge: nothing saved yet merges nothing, and saved content lands as `load()` would put it.
  store.applyMergeableChanges(scratch.getMergeableContent())
  const warnSave = once((error) => {
    console.warn('Timer App: could not save cards and settings; changes stay in memory', error)
  })
  const persister = createIndexedDbPersister(store, dbName, undefined, (error: unknown) => {
    if (!isNothingSavedYet(error)) warnSave(error)
  })
  await persister.startAutoSave()
  if (abandoned()) {
    await persister.destroy()
    return NOT_SAVING
  }
  return {
    saving: true,
    async stop() {
      await persister.save()
      await persister.destroy()
    },
  }
}

/** Whether localStorage can be used: reading the property itself throws where it is blocked. */
function localStorageWorks(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null
  } catch {
    return false
  }
}

/** Whether nothing is saved under `key` yet (or the storage cannot even be read). */
function nothingSaved(key: string): boolean {
  try {
    return localStorage.getItem(key) === null
  } catch {
    return false
  }
}

/**
 * Loads `store` from localStorage key `key`, follows changes other tabs save there and saves it
 * after every change. Within one task: nothing waits on I/O, so a caller that awaits this before
 * painting sees the saved settings in its first frame. Unreadable saved data is replaced by the
 * store's content on the next save. When localStorage is blocked, it warns once and returns a
 * handle that does not save.
 */
export async function openDevicePersister(
  store: DeviceStore,
  key: string = DEVICE_STORAGE_KEY,
): Promise<StorageHandle> {
  if (!localStorageWorks()) {
    console.warn('Timer App: localStorage is unavailable; appearance settings will not be saved')
    return NOT_SAVING
  }
  // TinyBase reports an empty key as unreadable content; on the first run that is expected.
  let quiet = nothingSaved(key)
  const warn = once((error) => {
    console.warn('Timer App: could not load or save appearance settings', error)
  })
  const persister = createLocalPersister(store, key, (error: unknown) => {
    if (!quiet) warn(error)
  })
  await persister.startAutoLoad()
  quiet = false
  await persister.startAutoSave()
  return {
    saving: true,
    async stop() {
      await persister.save()
      await persister.destroy()
    },
  }
}
