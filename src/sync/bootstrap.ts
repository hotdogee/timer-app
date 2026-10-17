/**
 * Startup rules for the synced store that do not depend on the app's state modules: where the
 * data lives, and the first-run seed (spec › Persistence and instances: a fresh install starts
 * with one 5:00 timer and the built-in presets; deleting every card does not bring them back).
 */
import { cards, type EpochMs } from '../core'
import type { Preset } from '../state/presets'
import { DEVICE_STORAGE_KEY, SYNCED_DB_NAME } from './persist'
import { SCHEMA_VERSION, cardToRow, presetToRow } from './schema'
import type { SyncedStore } from './stores'
import { TAB_CHANNEL } from './tabs'

/** Where the app keeps its data. Tests pass names of their own. */
export interface StorageNames {
  /** The IndexedDB database of the synced store. */
  readonly dbName: string
  /** The localStorage key of the device store. */
  readonly deviceKey: string
  /** The BroadcastChannel the tabs share. */
  readonly channel: string
}

/** The app's own storage names. */
export const APP_STORAGE_NAMES: StorageNames = Object.freeze({
  dbName: SYNCED_DB_NAME,
  deviceKey: DEVICE_STORAGE_KEY,
  channel: TAB_CHANNEL,
})

/** Whether the first-run seed has run on this data (`seededAt` is set), here or in another tab. */
export function isSeeded(store: SyncedStore): boolean {
  return store.hasValue('seededAt')
}

/**
 * The first-run timer's id. Fixed, like the built-in presets' ids, so copies that seed at the same
 * moment (two tabs of a fresh install opened together; in M4 two fresh devices) converge on one
 * card instead of adding one each.
 */
export const FIRST_CARD_ID = 'first-timer'

/** What a fresh install starts with, in the UI language. */
export interface FirstRunSeed {
  /** The first timer's name ("Timer"). */
  readonly cardName: string
  readonly presets: readonly Preset[]
}

/**
 * Writes the first-run content and then marks the data seeded at `now`, with the current schema
 * version when none is stored: an idle 5:00 timer {@link FIRST_CARD_ID} after any cards already
 * there, and each preset whose id has no row yet, at its list index. One transaction.
 */
export function seedFirstRun(store: SyncedStore, seed: FirstRunSeed, now: EpochMs): void {
  const at = Number.isFinite(now) ? now : 0
  store.transaction(() => {
    if (!store.hasRow('cards', FIRST_CARD_ID)) {
      const card = cards.createTimerCard(FIRST_CARD_ID, seed.cardName, at)
      store.setRow('cards', FIRST_CARD_ID, cardToRow(card, store.getRowCount('cards')))
    }
    seed.presets.forEach((preset, index) => {
      if (!store.hasRow('presets', preset.id)) {
        store.setRow('presets', preset.id, presetToRow(preset, index))
      }
    })
    if (!store.hasValue('schemaVersion')) store.setValue('schemaVersion', SCHEMA_VERSION)
    store.setValue('seededAt', at)
  })
}
