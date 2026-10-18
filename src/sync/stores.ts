/**
 * The app's two TinyBase stores, typed with the schemas in `schema.ts` so TinyBase drops any cell
 * or value of the wrong type (or a number that is not finite) instead of storing it.
 *
 * Creating a store does no I/O: a store is plain memory until `persist.ts` attaches a persister,
 * and the app works the same either way (tests, private browsing).
 */
import {
  createMergeableStore,
  createStore,
  type GetNow,
  type MergeableStore,
  type Store,
} from 'tinybase/with-schemas'

import { appClock } from '../state/app-clock'
import {
  DEVICE_TABLES_SCHEMA,
  DEVICE_VALUES_SCHEMA,
  SYNCED_TABLES_SCHEMA,
  SYNCED_VALUES_SCHEMA,
  type DeviceSchemas,
  type SyncedSchemas,
} from './schema'

/** Cards, presets and behavior settings; mergeable, so tabs (and in M4 devices) can sync it. */
export type SyncedStore = MergeableStore<SyncedSchemas>

/** Appearance settings and the language; this device only. */
export type DeviceStore = Store<DeviceSchemas>

/** Both stores, as the state modules bind to them. */
export interface AppStores {
  readonly synced: SyncedStore
  readonly device: DeviceStore
}

/**
 * Creates an empty synced store. `uniqueId` names this copy in the merge clocks (random by
 * default). `getNow` is the time those clocks start each change's stamp from: app time by default,
 * the device clock corrected to the server's while signed in, so changes from devices whose clocks
 * are wrong still order right (and TinyBase, which ignores changes stamped more than five minutes
 * ahead of its own clock, keeps accepting the others' changes on a slow device). Tests pass their
 * own.
 */
export function createSyncedStore(uniqueId?: string, getNow: GetNow = appClock): SyncedStore {
  return createMergeableStore(uniqueId, getNow)
    .setTablesSchema(SYNCED_TABLES_SCHEMA)
    .setValuesSchema(SYNCED_VALUES_SCHEMA)
}

/** Creates an empty device store. */
export function createDeviceStore(): DeviceStore {
  return createStore().setTablesSchema(DEVICE_TABLES_SCHEMA).setValuesSchema(DEVICE_VALUES_SCHEMA)
}

/** Creates both stores, empty. */
export function createAppStores(): AppStores {
  return { synced: createSyncedStore(), device: createDeviceStore() }
}

/**
 * The running app's stores. They start empty and in memory; `startAppData` loads them from
 * storage and keeps them saved. The app's settings and presets state follow them from the start.
 */
export const appStores: AppStores = createAppStores()
