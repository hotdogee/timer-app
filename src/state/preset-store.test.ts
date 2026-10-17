import { afterEach, describe, expect, it, vi } from 'vitest'

import { presetToRow } from '../sync/schema'
import { appStores, createSyncedStore, type SyncedStore } from '../sync/stores'
import { BUILTIN_PRESETS } from './presets'
import { createPresetStore, presetStore, type BoundPresetStore } from './presets.svelte'

vi.mock('../platform', () => ({ platform: { ids: { newId: () => 'from-platform' } } }))

const MINUTE = 60_000
const destroyers: (() => void)[] = []
afterEach(() => {
  for (const destroy of destroyers.splice(0)) destroy()
})

function counter(): () => string {
  let n = 0
  return () => `p${String(++n)}`
}

function setup(
  synced: SyncedStore = createSyncedStore(),
  newId: () => string = counter(),
): { synced: SyncedStore; store: BoundPresetStore; changes: () => unknown[] } {
  const store = createPresetStore(synced, { newId })
  const seen: unknown[] = []
  const id = synced.addDidFinishTransactionListener(() => {
    const [tables] = synced.getTransactionChanges()
    if (Object.keys(tables).length > 0) seen.push(tables)
  })
  destroyers.push(() => {
    store.destroy()
    synced.delListener(id)
  })
  return { synced, store, changes: () => seen.splice(0) }
}

/** A store holding the built-in presets at positions 0..3. */
function seeded(): SyncedStore {
  const synced = createSyncedStore()
  BUILTIN_PRESETS.forEach((p, i) => synced.setRow('presets', p.id, presetToRow(p, i)))
  return synced
}

const names = (store: BoundPresetStore): string[] => store.presets.map((p) => p.name)

describe('createPresetStore', () => {
  it('is empty on an empty store', () => {
    const { store } = setup()
    expect(store.presets).toEqual([])
    expect(Object.isFrozen(store.presets)).toBe(true)
  })

  it('lists the stored presets in order, frozen', () => {
    const { store } = setup(seeded())
    expect(store.presets).toEqual(BUILTIN_PRESETS)
    expect(Object.isFrozen(store.presets)).toBe(true)
    expect(Object.isFrozen(store.presets[0])).toBe(true)
  })

  it('adds a preset at the end and returns its id', () => {
    const { synced, store, changes } = setup(seeded())
    const id = store.add('  Coffee ', 4 * MINUTE)
    expect(id).toBe('p1')
    expect(store.presets.at(-1)).toEqual({ id: 'p1', name: 'Coffee', duration: 4 * MINUTE })
    expect(changes()).toEqual([
      { presets: { p1: { name: 'Coffee', duration: 4 * MINUTE, position: 4 } } },
    ])
    expect(synced.getRow('presets', 'p1').position).toBe(4)
  })

  it('adds nothing for a blank name or an unusable duration', () => {
    const { store, changes } = setup()
    expect(store.add('  ', MINUTE)).toBeNull()
    for (const duration of [0, -MINUTE, Number.NaN, Infinity, 9e15]) {
      expect(store.add('Tea', duration)).toBeNull()
    }
    expect(store.presets).toEqual([])
    expect(changes()).toEqual([])
  })

  it('keeps ids unique when the id source repeats itself', () => {
    const { store } = setup(createSyncedStore(), () => 'same')
    expect([store.add('A', MINUTE), store.add('B', MINUTE), store.add('C', MINUTE)]).toEqual([
      'same',
      'same-2',
      'same-3',
    ])
  })

  it('renames, trimmed, ignoring a blank name, the same name and unknown ids', () => {
    const { store, changes } = setup(seeded())
    store.rename('tea', ' Green tea ')
    expect(changes()).toEqual([{ presets: { tea: { name: 'Green tea' } } }])
    store.rename('tea', 'Green tea')
    store.rename('tea', '   ')
    store.rename('coffee', 'Coffee')
    expect(changes()).toEqual([])
    expect(names(store)[0]).toBe('Green tea')
  })

  it('changes the duration, ignoring unusable ones and unknown ids', () => {
    const { store, changes } = setup(seeded())
    store.setDuration('eggs', 8 * MINUTE)
    expect(store.presets.find((p) => p.id === 'eggs')?.duration).toBe(8 * MINUTE)
    expect(changes()).toEqual([{ presets: { eggs: { duration: 8 * MINUTE } } }])
    store.setDuration('eggs', 8 * MINUTE)
    store.setDuration('eggs', 0)
    store.setDuration('eggs', Number.NaN)
    store.setDuration('coffee', MINUTE)
    expect(changes()).toEqual([])
  })

  it('moves a preset, rewriting only the positions that changed', () => {
    const { store, changes } = setup(seeded())
    store.move('pomodoro', 2)
    expect(names(store)).toEqual(['Tea', 'Break', 'Pomodoro', 'Eggs'])
    expect(changes()).toEqual([{ presets: { break: { position: 1 }, pomodoro: { position: 2 } } }])
    store.move('eggs', -5)
    expect(names(store)).toEqual(['Eggs', 'Tea', 'Break', 'Pomodoro'])
    store.move('eggs', 99.7)
    expect(names(store)).toEqual(['Tea', 'Break', 'Pomodoro', 'Eggs'])
    changes()
    store.move('eggs', 3)
    store.move('eggs', Number.NaN)
    store.move('coffee', 0)
    expect(changes()).toEqual([])
  })

  it('removes a preset and closes the gap', () => {
    const { synced, store, changes } = setup(seeded())
    store.remove('pomodoro')
    expect(names(store)).toEqual(['Tea', 'Break', 'Eggs'])
    expect(synced.hasRow('presets', 'pomodoro')).toBe(false)
    expect(changes()).toEqual([
      {
        presets: {
          pomodoro: undefined,
          break: { position: 1 },
          eggs: { position: 2 },
        },
      },
    ])
    store.remove('pomodoro')
    expect(changes()).toEqual([])
  })

  it("follows another tab's changes, keeping unchanged presets and the list when it can", () => {
    const { synced, store } = setup(seeded())
    const list = store.presets
    const [tea] = list
    synced.setCell('presets', 'break', 'name', 'Rest')
    expect(names(store)).toEqual(['Tea', 'Pomodoro', 'Rest', 'Eggs'])
    expect(store.presets[0]).toBe(tea)
    const after = store.presets
    // Positions that keep the order (a gap left by a merge) leave the list as it is.
    synced.setCell('presets', 'eggs', 'position', 9)
    expect(store.presets).toBe(after)
    // A row that is not a usable preset is not listed.
    synced.setRow('presets', 'bad', { name: '', duration: MINUTE, position: 0 })
    expect(store.presets).toBe(after)
  })

  it('closes gaps a merge left when adding', () => {
    const synced = createSyncedStore()
    synced.setRow('presets', 'a', { name: 'A', duration: MINUTE, position: 3 })
    const { store } = setup(synced)
    store.add('B', MINUTE)
    expect(synced.getCell('presets', 'a', 'position')).toBe(0)
    expect(synced.getCell('presets', 'p1', 'position')).toBe(1)
  })

  it('stops following the table once destroyed', () => {
    const { synced, store } = setup(seeded())
    store.destroy()
    synced.delTable('presets')
    expect(store.presets).toHaveLength(4)
  })
})

describe('presetStore', () => {
  it("follows the app's synced store, with ids from the platform", () => {
    expect(presetStore.presets).toEqual([])
    expect(presetStore.add('Tea', 3 * MINUTE)).toBe('from-platform')
    expect(appStores.synced.getRow('presets', 'from-platform').name).toBe('Tea')
    presetStore.remove('from-platform')
    expect(presetStore.presets).toEqual([])
  })
})
