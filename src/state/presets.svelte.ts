/**
 * The preset store: the user's timer presets (spec › Presets) as a reactive list that follows the
 * synced store's `presets` table, and the edits Settings › Presets makes to it (add, rename,
 * change the duration, reorder, delete).
 *
 * The table is the source of truth: every edit is a table write, and the list follows through a
 * table listener, so edits from another tab (or, in M4, another device) show up like local ones.
 * The list is replaced only when its content changed, and a preset that did not change keeps its
 * object. Order is each row's `position` (the list index), then id; a reorder or delete rewrites
 * the positions that changed.
 *
 * Methods read the list untracked and write state, so call them from event handlers and effects,
 * never from a template expression or `$derived`.
 *
 * One write follows changes from elsewhere: a repair. The built-in presets are seeded as defaults,
 * older than any change (`seedFirstRun`). When the account deleted one and this device then edited
 * it (renamed "Tea"), a merge keeps only the edited cells, which alone read as no preset; the
 * built-in duration is then written back, so the preset stays with this device's edits. Every copy
 * makes the same repair.
 */
import { untrack } from 'svelte'

import type { Ms } from '../core'
import { platform } from '../platform'
import { presetToRow, presetsFromTable } from '../sync/schema'
import { appStores, type SyncedStore } from '../sync/stores'
import { BUILTIN_PRESETS, isPresetDuration, presetName, type Preset } from './presets'

/** The presets and the edits on them. Every getter is reactive. */
export interface PresetStore {
  /** The presets in order. Frozen; replaced whole, never mutated. */
  readonly presets: readonly Preset[]
  /**
   * Adds a preset at the end and returns its id. The name is trimmed; a blank name, or a duration
   * that is not usable (`isPresetDuration`), adds nothing and returns `null`. Names may repeat.
   */
  add(name: string, duration: Ms): string | null
  /** Renames a preset; the name is trimmed, and a blank one or an unknown id changes nothing. */
  rename(id: string, name: string): void
  /** Changes a preset's duration; an unusable duration or an unknown id changes nothing. */
  setDuration(id: string, duration: Ms): void
  /** Moves a preset to `toIndex`, truncated and clamped into the list (NaN changes nothing). */
  move(id: string, toIndex: number): void
  /** Deletes a preset; an unknown id changes nothing. */
  remove(id: string): void
}

/** A preset store bound to a store of its own, which can be unbound (tests, isolated data). */
export interface BoundPresetStore extends PresetStore {
  /** Stops following the table. The list keeps its last content. */
  destroy(): void
}

/** What the store needs from outside. */
export interface PresetStoreDeps {
  /** A new unique id; a duplicate is tolerated (the store derives an unused one from it). */
  readonly newId: () => string
}

const NO_PRESETS: readonly Preset[] = Object.freeze([])

/**
 * Creates a preset store that follows the `presets` table of `store` (its rows as they are now,
 * then every change) until destroyed.
 */
export function createPresetStore(store: SyncedStore, deps: PresetStoreDeps): BoundPresetStore {
  /** The table's presets, reusing `previous` and its objects where nothing changed. */
  function read(previous: readonly Preset[]): readonly Preset[] {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
    const byId = new Map(previous.map((preset) => [preset.id, preset]))
    const next = presetsFromTable(store.getTable('presets')).map(({ item }) => {
      const old = byId.get(item.id)
      return old?.name === item.name && old.duration === item.duration ? old : Object.freeze(item)
    })
    const same = next.length === previous.length && next.every((p, i) => p === previous[i])
    if (same) return previous
    return next.length === 0 ? NO_PRESETS : Object.freeze(next)
  }

  /** Writes back the duration of built-in presets a merge left without one (see the notes). */
  function repairBuiltIns(): void {
    for (const builtIn of BUILTIN_PRESETS) {
      const row = store.getRow('presets', builtIn.id)
      if (Object.keys(row).length > 0 && row.duration === undefined) {
        store.setCell('presets', builtIn.id, 'duration', builtIn.duration)
      }
    }
  }

  repairBuiltIns()
  let presets = $state.raw(read(NO_PRESETS))
  const repairId = store.addTableListener('presets', repairBuiltIns, true)
  const listenerId = store.addTableListener('presets', () => {
    presets = read(untrack(() => presets))
  })

  /** The current list, without subscribing the caller to it. */
  const current = (): readonly Preset[] => untrack(() => presets)

  /** Writes each preset's index in `order` as its position where the row stores another. */
  function writePositions(order: readonly Preset[]): void {
    order.forEach((preset, index) => {
      if (store.getCell('presets', preset.id, 'position') !== index) {
        store.setCell('presets', preset.id, 'position', index)
      }
    })
  }

  /** An id from `deps.newId` that no row has. */
  function freshId(): string {
    const id = deps.newId()
    if (id !== '' && !store.hasRow('presets', id)) return id
    for (let n = 2; ; n++) {
      const candidate = `${id === '' ? 'preset' : id}-${n}`
      if (!store.hasRow('presets', candidate)) return candidate
    }
  }

  return {
    get presets() {
      return presets
    },
    add(name, duration) {
      const trimmed = presetName(name)
      if (trimmed === null || !isPresetDuration(duration)) return null
      const id = freshId()
      const list = current()
      store.transaction(() => {
        writePositions(list)
        store.setRow('presets', id, presetToRow({ id, name: trimmed, duration }, list.length))
      })
      return id
    },
    rename(id, name) {
      const trimmed = presetName(name)
      const preset = current().find((p) => p.id === id)
      if (trimmed === null || preset === undefined || preset.name === trimmed) return
      store.setCell('presets', id, 'name', trimmed)
    },
    setDuration(id, duration) {
      const preset = current().find((p) => p.id === id)
      if (!isPresetDuration(duration) || preset === undefined || preset.duration === duration)
        return
      store.setCell('presets', id, 'duration', duration)
    },
    move(id, toIndex) {
      const list = current()
      const from = list.findIndex((p) => p.id === id)
      if (from < 0 || Number.isNaN(toIndex)) return
      const to = Math.min(list.length - 1, Math.max(0, Math.trunc(toIndex)))
      if (to === from) return
      const order = list.slice()
      const [preset] = order.splice(from, 1)
      if (preset === undefined) return
      order.splice(to, 0, preset)
      store.transaction(() => {
        writePositions(order)
      })
    },
    remove(id) {
      const list = current()
      if (!list.some((p) => p.id === id)) return
      store.transaction(() => {
        store.delRow('presets', id)
        writePositions(list.filter((p) => p.id !== id))
      })
    },
    destroy() {
      store.delListener(repairId)
      store.delListener(listenerId)
    },
  }
}

/**
 * The app's presets. They follow the app's synced store from the start: none until `startAppData`
 * loads the saved ones (or seeds the built-ins on the first run).
 */
export const presetStore: PresetStore = createPresetStore(appStores.synced, {
  newId: () => platform.ids.newId(),
})
