/**
 * App data startup: loads both stores, keeps them saved and in step across tabs, binds the card
 * store to the synced store, seeds a fresh install, and offers the whole-data replace that Import
 * uses (spec › Persistence and instances, Settings › Data).
 *
 * Startup order, so the first painted frame is right:
 * 1. the device store from localStorage (no I/O wait), then `onDeviceReady`, where the caller
 *    applies the theme and language before anything can paint;
 * 2. the synced store from IndexedDB (milliseconds), then tab sync;
 * 3. the card bridge (the saved cards replace the card store's list);
 * 4. the first-run seed when the data was never seeded: one timer and the built-in presets. A tab
 *    that could not read storage first waits for the other tabs' answer (half a second when there
 *    is none): its empty store is not a first run when they hold the data, and a seed, newer than
 *    their data, would overwrite it in every tab;
 * 5. every card settled at `now`, so a timer that ended while the app was closed is ringing.
 *
 * The settings and preset stores follow the stores from the start (they are bound when created),
 * so they need no step here. Storage that is missing or broken only costs persistence: the app
 * runs in memory with a console warning.
 *
 * Tab sync is one connection on the synced store; M4 opens its sync-server connection beside it
 * here. Every bridge reads and writes only the store, so a new connection changes nothing else.
 */
import { cards, exportFormat, settings, type Clock, type EpochMs } from '../core'
import {
  APP_STORAGE_NAMES,
  appStores,
  bindCards,
  cardToRow,
  isSeeded,
  openDevicePersister,
  openSyncedPersister,
  presetToRow,
  seedFirstRun,
  startTabSync,
  type AppStores,
  type StorageNames,
} from '../sync'
import { cardStore as appCardStore, type CardStore } from './cards.svelte'
import { BUILTIN_PRESETS, type Preset } from './presets'
import { presetStore as appPresetStore, type PresetStore } from './presets.svelte'
import { settingsStore as appSettingsStore, type SettingsStore } from './settings.svelte'

/** The stores to load and the state bound to them. */
export interface AppDataTarget {
  readonly stores: AppStores
  readonly cardStore: CardStore
  /** Must follow `stores` (`createSettingsStore(stores)`). */
  readonly settingsStore: SettingsStore
  /** Must follow `stores.synced` (`createPresetStore(stores.synced, …)`). */
  readonly presetStore: PresetStore
}

/** The running app's stores and state. */
export const APP_TARGET: AppDataTarget = {
  stores: appStores,
  cardStore: appCardStore,
  settingsStore: appSettingsStore,
  presetStore: appPresetStore,
}

export interface AppDataOptions {
  /** Read for the first-run seed, for settling the loaded cards, and for settling imports. */
  readonly now: Clock
  /**
   * Called once the device settings are loaded and before the synced store is, within the same
   * task as the call to `startAppData` (nothing before it waits on I/O): apply the theme and the
   * language here, so the first frame the browser paints already has them.
   */
  readonly onDeviceReady?: (device: settings.DeviceSettings) => void
  /** The presets a fresh install starts with; the built-in ones by default. */
  readonly seedPresets?: readonly Preset[]
  /** The name of the timer a fresh install starts with; "Timer" by default. */
  readonly seedCardName?: string
  /** Where the data lives; the app's own names by default. */
  readonly storage?: Partial<StorageNames>
  /** The stores and state to use; the app's singletons by default. Tests pass fresh ones. */
  readonly target?: AppDataTarget
}

/** The loaded app data. */
export interface AppData {
  /** The loaded stores; the sync-server connection (`createRemoteSync`) runs on `stores.synced`. */
  readonly stores: AppStores
  readonly settingsStore: SettingsStore
  readonly presetStore: PresetStore
  readonly cardStore: CardStore
  /**
   * Whether each store is being saved. False means storage is unavailable (private browsing,
   * blocked site data) or the saved cards could not be read: changes then last until the page
   * closes.
   */
  readonly saving: { readonly synced: boolean; readonly device: boolean }
  /** Settles once the first exchange with other open tabs is done. Never rejects. */
  readonly ready: Promise<void>
  /**
   * Replaces all data with an import file's (Settings › Data › Import): cards (settled at `now`),
   * presets and the synced settings in one transaction on the synced store, then the device
   * settings. The selection stays when its card is still there; a pending undo is forgotten.
   */
  replaceAll(data: exportFormat.ExportData): void
  /** Stops saving, tab sync and the card bridge. The state keeps its last content. */
  stop(): Promise<void>
}

/**
 * Loads the app data and keeps it saved and synced. Never rejects: storage failures only cost
 * persistence. See the module notes for the order of the steps.
 */
export async function startAppData(options: AppDataOptions): Promise<AppData> {
  const names: StorageNames = { ...APP_STORAGE_NAMES, ...options.storage }
  const { stores, cardStore, settingsStore, presetStore } = options.target ?? APP_TARGET
  const { synced: syncedStore, device: deviceStore } = stores

  const device = await openDevicePersister(deviceStore, names.deviceKey)
  options.onDeviceReady?.(settingsStore.device)

  const synced = await openSyncedPersister(syncedStore, names.dbName)
  const tabs = startTabSync(syncedStore, names.channel)
  const bridge = bindCards(cardStore, syncedStore)

  // Storage failed here, but another tab may have the data: hear from the tabs before deciding
  // that this is a first run.
  if (!synced.saving) await tabs.ready
  if (!isSeeded(syncedStore)) {
    // One transaction, so the seed is saved and synced whole. The bridge hands the card to the
    // card store, which selects it.
    seedFirstRun(
      syncedStore,
      {
        cardName: options.seedCardName ?? cards.DEFAULT_NAMES.timer,
        presets: options.seedPresets ?? BUILTIN_PRESETS,
      },
      options.now(),
    )
  }
  cardStore.settle(options.now())
  bridge.flush()

  return {
    stores,
    settingsStore,
    presetStore,
    cardStore,
    saving: { synced: synced.saving, device: device.saving },
    ready: tabs.ready,
    replaceAll(data) {
      replaceAppData({ stores, cardStore, settingsStore, presetStore }, data, options.now())
    },
    async stop() {
      bridge.stop()
      await tabs.stop()
      await synced.stop()
      await device.stop()
    },
  }
}

/**
 * Replaces all data in `target` with an import file's (`AppData.replaceAll`): cards settled at
 * `now`, presets and the synced settings in one transaction on the synced store, then the device
 * settings. Also works on stores that are not being saved (main.ts falls back to it when
 * startup failed).
 */
export function replaceAppData(
  target: AppDataTarget,
  data: exportFormat.ExportData,
  now: EpochMs,
): void {
  const { stores, cardStore, settingsStore } = target
  const syncedStore = stores.synced
  const imported = cards.settleAll(
    cards.normalizeList({ cards: data.cards, selectedId: null }),
    now,
  ).cards
  cardStore.forgetRemoved()
  syncedStore.transaction(() => {
    // `setTable` with no rows leaves a table as it is; an empty import must empty it.
    if (imported.length === 0) syncedStore.delTable('cards')
    else {
      syncedStore.setTable(
        'cards',
        Object.fromEntries(imported.map((card, index) => [card.id, cardToRow(card, index)])),
      )
    }
    if (data.presets.length === 0) syncedStore.delTable('presets')
    else {
      syncedStore.setTable(
        'presets',
        Object.fromEntries(
          data.presets.map((preset, index) => [preset.id, presetToRow(preset, index)]),
        ),
      )
    }
    settingsStore.updateSynced(data.settings.synced)
  })
  settingsStore.updateDevice(data.settings.device)
}
