import { flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import { cardStore, createCardStore } from './cards.svelte'

// The app singleton reads ids from the platform layer; keep this test independent of it.
vi.mock('../platform', () => ({
  platform: { ids: { newId: () => `id-${String(Math.random())}` } },
}))

describe('the client test project', () => {
  it("runs Svelte's browser runtime in a DOM", () => {
    expect(import.meta.env.SSR).toBe(false)
    expect(typeof document.createElement).toBe('function')
  })

  it('re-runs an effect on cardStore.list after addTimer(), once flushSync() runs', () => {
    const seen: number[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(cardStore.list.cards.length)
      })
    })
    flushSync()
    const before = cardStore.list.cards.length
    expect(seen).toEqual([before])
    cardStore.addTimer()
    expect(seen).toEqual([before]) // effects wait for the flush
    flushSync()
    expect(seen).toEqual([before, before + 1])
    stop()
    cardStore.addTimer()
    flushSync()
    expect(seen).toEqual([before, before + 1]) // a stopped root no longer runs
  })

  it('does not re-run an effect for a store method that changes nothing', () => {
    let n = 0
    const store = createCardStore({
      newId: () => `id${String(++n)}`,
      clock: () => 0,
      bump: () => 0,
    })
    let runs = 0
    const stop = $effect.root(() => {
      $effect(() => {
        void store.list
        runs++
      })
    })
    flushSync()
    store.select('missing')
    flushSync()
    expect(runs).toBe(1)
    store.addStopwatch()
    flushSync()
    expect(runs).toBe(2)
    stop()
  })
})
