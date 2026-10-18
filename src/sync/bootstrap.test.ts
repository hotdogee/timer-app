import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Preset } from '../state/presets'
import { FIRST_CARD_ID, isSeeded, seedFirstRun } from './bootstrap'
import { createSyncedStore, type SyncedStore } from './stores'

const MINUTE = 60_000
const PRESETS: readonly Preset[] = [
  { id: 'tea', name: 'Tea', duration: 3 * MINUTE },
  { id: 'eggs', name: 'Eggs', duration: 7 * MINUTE },
]
const START = Date.UTC(2026, 9, 18, 9, 0, 0)

function names(store: SyncedStore): { card: unknown; presets: Record<string, unknown> } {
  return {
    card: store.getCell('cards', FIRST_CARD_ID, 'name'),
    presets: Object.fromEntries(
      store.getRowIds('presets').map((id) => [id, store.getCell('presets', id, 'duration')]),
    ),
  }
}

describe('seedFirstRun', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the first timer, the presets and the seeded mark', () => {
    const store = createSyncedStore()
    seedFirstRun(store, { cardName: 'Timer', presets: PRESETS }, START)
    expect(isSeeded(store)).toBe(true)
    expect(store.getValue('seededAt')).toBe(START)
    expect(names(store)).toEqual({
      card: 'Timer',
      presets: { tea: 3 * MINUTE, eggs: 7 * MINUTE },
    })
  })

  it('loses to every edit of an account when a fresh device signs in, however old the edit', () => {
    // A device used for a while: it renamed the first timer, changed a preset, deleted another.
    const account = createSyncedStore('account')
    seedFirstRun(account, { cardName: 'Timer', presets: PRESETS }, START)
    vi.setSystemTime(START + MINUTE)
    account.setCell('cards', FIRST_CARD_ID, 'name', 'Kitchen')
    account.setCell('presets', 'tea', 'duration', 4 * MINUTE)
    account.delRow('presets', 'eggs')

    // A month later a new device starts fresh and seeds the same ids, then signs in. Like the app,
    // it first merges what storage holds (nothing), which moves its merge clock to now.
    vi.setSystemTime(START + 30 * 24 * 60 * MINUTE)
    const fresh = createSyncedStore('fresh')
    fresh.applyMergeableChanges(createSyncedStore().getMergeableContent())
    seedFirstRun(fresh, { cardName: 'Timer', presets: PRESETS }, Date.now())
    fresh.merge(account)

    const expected = { card: 'Kitchen', presets: { tea: 4 * MINUTE } }
    expect(names(fresh)).toEqual(expected)
    expect(names(account)).toEqual(expected)
  })

  it('lets two fresh devices agree on one seed', () => {
    const first = createSyncedStore('first')
    seedFirstRun(first, { cardName: 'Timer', presets: PRESETS }, START)
    vi.setSystemTime(START + MINUTE)
    // Another language names things differently.
    const second = createSyncedStore('second')
    seedFirstRun(
      second,
      { cardName: 'タイマー', presets: [{ id: 'tea', name: 'お茶', duration: 3 * MINUTE }] },
      Date.now(),
    )
    first.merge(second)
    expect(first.getContent()).toEqual(second.getContent())
    expect(first.getRowIds('presets').sort()).toEqual(['eggs', 'tea'])
  })
})
