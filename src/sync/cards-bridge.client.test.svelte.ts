import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cards, timer } from '../core'
import { createCardStore, type CardStore } from '../state/cards.svelte'
import { bindCards, type CardsBridge } from './cards-bridge.svelte'
import { cardToRow, type CardRow } from './schema'
import { createSyncedStore, type SyncedStore } from './stores'
import { startTabSync, type Connection } from './tabs'

// The app's card store singleton reads ids from the platform layer; keep these tests independent.
vi.mock('../platform', () => ({ platform: { ids: { newId: () => 'unused' } } }))

/** 14:47 UTC on 2026-10-17. */
const NOW = Date.UTC(2026, 9, 17, 14, 47, 0)

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function counter(prefix = 'id'): () => string {
  let n = 0
  return () => `${prefix}${String(++n)}`
}

function newCardStore(ids = counter()): CardStore {
  return createCardStore({ newId: ids, clock: () => NOW, bump: () => NOW })
}

/**
 * The store as the bridge sees it, counting the transactions the bridge opens. TinyBase's methods
 * are closures, so a copy of the store object works like the store itself.
 */
function counted(store: SyncedStore): { store: SyncedStore; transactions: () => number } {
  let n = 0
  const copy = {
    ...store,
    transaction: ((actions: () => unknown) => {
      n++
      return store.transaction(actions)
    }) as SyncedStore['transaction'],
  }
  return { store: copy, transactions: () => n }
}

/** What the last transaction of `store` changed, as TinyBase reports it. */
function recordChanges(store: SyncedStore): () => unknown[] {
  const seen: unknown[] = []
  const id = store.addDidFinishTransactionListener(() => {
    const [tables] = store.getTransactionChanges()
    if (Object.keys(tables).length > 0) seen.push(tables)
  })
  cleanups.push(() => store.delListener(id))
  return () => seen.splice(0)
}

/** Counts how often an effect on `cardStore.list` runs. */
function listEffectRuns(cardStore: CardStore): () => number {
  let runs = 0
  const stop = $effect.root(() => {
    $effect(() => {
      void cardStore.list
      runs++
    })
  })
  cleanups.push(stop)
  flushSync()
  return () => runs
}

function setup(table?: Record<string, CardRow>) {
  const synced = createSyncedStore()
  if (table) synced.setTable('cards', table)
  const spy = counted(synced)
  const cardStore = newCardStore()
  const bridge = bindCards(cardStore, spy.store)
  cleanups.push(() => {
    bridge.stop()
  })
  flushSync()
  return { synced, cardStore, bridge, transactions: spy.transactions }
}

/** The card at `index`; fails the test when there is none. */
function nth(cardStore: CardStore, index: number): cards.Card {
  const card = cardStore.cards[index]
  if (card === undefined) throw new Error(`no card at ${String(index)}`)
  return card
}

const row = (id: string, name: string, position: number, createdAt = NOW): CardRow =>
  cardToRow(cards.createTimerCard(id, name, createdAt), position)

describe('bindCards: card store → table', () => {
  it('writes the cards, at their positions, in one transaction per flush', () => {
    const { synced, cardStore, transactions } = setup()
    cardStore.addTimer()
    cardStore.addStopwatch()
    cardStore.addTimer(3 * 60_000, 'Tea')
    expect(synced.getRowIds('cards')).toEqual([]) // effects wait for the flush
    flushSync()
    expect(transactions()).toBe(1)
    expect(synced.getTable('cards')).toEqual({
      id1: cardToRow(nth(cardStore, 0), 0),
      id2: cardToRow(nth(cardStore, 1), 1),
      id3: cardToRow(nth(cardStore, 2), 2),
    })
  })

  it('writes only the cells that changed', () => {
    const { synced, cardStore, transactions } = setup()
    const a = cardStore.addTimer()
    cardStore.addTimer()
    flushSync()
    const changes = recordChanges(synced)
    cardStore.rename(a, 'Tea')
    flushSync()
    expect(changes()).toEqual([{ cards: { id1: { name: 'Tea' } } }])
    cardStore.timer(a, timer.start)
    flushSync()
    expect(changes()).toEqual([{ cards: { id1: { phase: 'running', endsAt: NOW + 300_000 } } }])
    cardStore.timer(a, timer.pause)
    flushSync()
    expect(changes()).toEqual([
      { cards: { id1: { phase: 'paused', endsAt: undefined, remaining: 300_000 } } },
    ])
    expect(transactions()).toBe(4)
  })

  it('writes nothing for a change that leaves every card as it was (selection)', () => {
    const { cardStore, transactions } = setup()
    cardStore.addTimer()
    const b = cardStore.addTimer()
    flushSync()
    const before = transactions()
    cardStore.select('id1')
    flushSync()
    cardStore.select(b)
    flushSync()
    expect(transactions()).toBe(before)
  })

  it('deletes the row of a removed card, and writes it again when the delete is undone', () => {
    const { synced, cardStore } = setup()
    cardStore.addTimer()
    const b = cardStore.addTimer()
    cardStore.addTimer()
    flushSync()
    cardStore.remove(b)
    flushSync()
    expect(synced.getRowIds('cards')).toEqual(['id1', 'id3'])
    expect(synced.getCell('cards', 'id3', 'position')).toBe(1)
    expect(cardStore.undoRemove()).toBe(true)
    flushSync()
    expect(synced.getRow('cards', b)).toEqual(cardToRow(nth(cardStore, 1), 1))
    expect(synced.getCell('cards', 'id3', 'position')).toBe(2)
  })

  it('rewrites only the positions that a move changed', () => {
    const { synced, cardStore } = setup()
    for (let i = 0; i < 4; i++) cardStore.addTimer()
    flushSync()
    const changes = recordChanges(synced)
    cardStore.move('id2', 2)
    flushSync()
    expect(changes()).toEqual([{ cards: { id2: { position: 2 }, id3: { position: 1 } } }])
  })

  it('writes nothing when the list is replaced by cards with the same content', () => {
    const { synced, cardStore } = setup()
    cardStore.addTimer()
    cardStore.addStopwatch()
    flushSync()
    const changes = recordChanges(synced)
    const copies = cardStore.cards.map((card) => ({ ...card }))
    cardStore.replace({ cards: copies, selectedId: 'id2' })
    flushSync()
    expect(changes()).toEqual([])
  })

  it('writes pending changes at once on flush()', () => {
    const { synced, cardStore, bridge } = setup()
    cardStore.addTimer()
    bridge.flush()
    expect(synced.getRowIds('cards')).toEqual(['id1'])
  })
})

describe('bindCards: table → card store', () => {
  it('replaces the list with the table at bind time, in table order, first card selected', () => {
    const { cardStore } = setup({
      b: row('b', 'Second', 1),
      a: row('a', 'First', 0),
      junk: { name: 'not a card' },
    })
    expect(cardStore.cards.map((card) => card.name)).toEqual(['First', 'Second'])
    expect(cardStore.list.selectedId).toBe('a')
  })

  it("applies another tab's change at once and keeps the selection", () => {
    const { synced, cardStore } = setup({ a: row('a', 'A', 0), b: row('b', 'B', 1) })
    cardStore.select('b')
    flushSync()
    const runs = listEffectRuns(cardStore)
    const a = cardStore.cards[0]
    synced.transaction(() => {
      synced.setCell('cards', 'b', 'name', 'Renamed')
      synced.setRow('cards', 'c', row('c', 'C', 2))
    })
    expect(cardStore.cards.map((card) => card.name)).toEqual(['A', 'Renamed', 'C'])
    expect(cardStore.list.selectedId).toBe('b')
    expect(cardStore.cards[0]).toBe(a) // an unchanged card keeps its object
    flushSync()
    expect(runs()).toBe(2)
  })

  it('never echoes a change from the table back into it', () => {
    const { synced, cardStore, transactions } = setup({ a: row('a', 'A', 0) })
    const before = transactions()
    // What another tab's bridge writes: a start, an added card, then a delete with its moves.
    synced.setPartialRow('cards', 'a', { phase: 'running', endsAt: NOW + 1000 })
    flushSync()
    synced.setRow('cards', 'b', row('b', 'B', 1))
    flushSync()
    synced.transaction(() => {
      synced.delRow('cards', 'a')
      synced.setCell('cards', 'b', 'position', 0)
    })
    flushSync()
    expect(cardStore.cards.map((card) => card.id)).toEqual(['b'])
    expect(transactions()).toBe(before)
  })

  it('repairs positions a merge left with gaps or ties, once, and only then', () => {
    const { synced, cardStore, transactions } = setup({ a: row('a', 'A', 0), b: row('b', 'B', 1) })
    const before = transactions()
    // A device deleted `a` while another moved nothing: `b` is left at position 1.
    synced.delRow('cards', 'a')
    flushSync()
    expect(cardStore.cards.map((card) => card.id)).toEqual(['b'])
    expect(synced.getCell('cards', 'b', 'position')).toBe(0)
    expect(transactions()).toBe(before + 1)
    synced.setCell('cards', 'b', 'name', 'B2')
    flushSync()
    expect(transactions()).toBe(before + 1)
  })

  it('does not hand over a table change that reads back as the same cards', () => {
    const { synced, cardStore } = setup({
      a: { ...row('a', 'A', 0), phase: 'paused', remaining: 5 },
    })
    const list = cardStore.list
    const runs = listEffectRuns(cardStore)
    // A merge left a stale cell of another phase; the card reads the same.
    synced.setCell('cards', 'a', 'endsAt', NOW)
    flushSync()
    expect(cardStore.list).toBe(list)
    expect(runs()).toBe(1)
  })

  it('selects the card that took its place when the selected card is deleted elsewhere', () => {
    const { synced, cardStore } = setup({
      a: row('a', 'A', 0),
      b: row('b', 'B', 1),
      c: row('c', 'C', 2),
    })
    cardStore.select('b')
    synced.delRow('cards', 'b')
    expect(cardStore.list.selectedId).toBe('c')
    synced.delRow('cards', 'c')
    expect(cardStore.list.selectedId).toBe('a')
    synced.delRow('cards', 'a')
    expect(cardStore.list).toEqual(cards.EMPTY_LIST)
  })

  it('orders cards by position, then creation time, then id, and repairs the positions', () => {
    // Two devices both added a card at position 1 while apart.
    const { synced, cardStore } = setup({
      a: row('a', 'A', 0),
      y: row('y', 'Y', 1, NOW + 5),
      x: row('x', 'X', 1, NOW + 5),
      w: row('w', 'W', 1, NOW + 1),
    })
    expect(cardStore.cards.map((card) => card.id)).toEqual(['a', 'w', 'x', 'y'])
    // Positions are rewritten to 0..n-1 for the cards that need it.
    const positions = synced
      .getRowIds('cards')
      .map((id) => [id, synced.getCell('cards', id, 'position')])
    expect(Object.fromEntries(positions)).toEqual({ a: 0, w: 1, x: 2, y: 3 })
  })

  it('keeps local changes not written yet when a table change arrives in the same task', () => {
    const { synced, cardStore } = setup({
      a: row('a', 'A', 0),
      b: row('b', 'B', 1),
      c: row('c', 'C', 2),
    })
    // Local changes, still waiting for the effect: start `a`, delete `b`, add a card.
    cardStore.timer('a', timer.start)
    cardStore.remove('b')
    const added = cardStore.addTimer(60_000, 'New')
    // A change to the table in the same task, e.g. an import or another tab's rename of `a`.
    synced.setCell('cards', 'a', 'name', 'Renamed')
    // Both survive, merged cell by cell: the rename and the start of `a`.
    expect(cardStore.cards.map((card) => card.name)).toEqual(['Renamed', 'C', 'New'])
    expect(nth(cardStore, 0)).toMatchObject({ timer: { phase: 'running', endsAt: NOW + 300_000 } })
    expect(synced.getRowIds('cards').sort()).toEqual(['a', 'c', added].sort())
    expect(synced.getRow('cards', 'a')).toMatchObject({
      name: 'Renamed',
      phase: 'running',
      endsAt: NOW + 300_000,
      position: 0,
    })
    expect(synced.getCell('cards', added, 'position')).toBe(2)
    flushSync()
    expect(nth(cardStore, 0).name).toBe('Renamed')
  })

  it('stops mirroring both ways when stopped', () => {
    const { synced, cardStore, bridge } = setup({ a: row('a', 'A', 0) })
    bridge.stop()
    bridge.stop()
    synced.setCell('cards', 'a', 'name', 'Changed')
    expect(cardStore.cards[0]?.name).toBe('A')
    cardStore.addTimer()
    flushSync()
    bridge.flush()
    expect(synced.getRowIds('cards')).toEqual(['a'])
  })
})

describe('bindCards across two tabs', () => {
  it('shows a card added and started in one tab in the other, without echoing it back', async () => {
    const channel = `test-bridge-${String(Math.random())}`
    const tabs = [0, 1].map((i) => {
      const synced = createSyncedStore()
      const spy = counted(synced)
      const cardStore = newCardStore(counter(`tab${String(i)}-`))
      const bridge: CardsBridge = bindCards(cardStore, spy.store)
      const connection: Connection = startTabSync(synced, channel)
      cleanups.push(() => connection.stop())
      cleanups.push(() => {
        bridge.stop()
      })
      return { synced, cardStore, transactions: spy.transactions, connection }
    })
    const [one, two] = tabs as [(typeof tabs)[0], (typeof tabs)[0]]
    await Promise.all([one.connection.ready, two.connection.ready])
    flushSync()

    const id = one.cardStore.addTimer(60_000, 'Tea')
    one.cardStore.timer(id, timer.start)
    flushSync()
    expect(one.transactions()).toBe(1)
    await vi.waitFor(() => {
      expect(two.cardStore.cards.map((card) => card.id)).toEqual([id])
    })
    expect(two.cardStore.cards[0]).toEqual(one.cardStore.cards[0])
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 30))
    flushSync()
    expect(two.transactions()).toBe(0)
    expect(one.transactions()).toBe(1)

    // A rename in the second tab reaches the first; selection stays per tab.
    two.cardStore.rename(id, 'Green tea')
    flushSync()
    await vi.waitFor(() => {
      expect(one.cardStore.cards[0]?.name).toBe('Green tea')
    })
    expect(one.cardStore.cards[0]).toEqual({
      ...cards.createTimerCard(id, 'Green tea', NOW, 60_000),
      timer: { phase: 'running', duration: 60_000, endsAt: NOW + 60_000 },
    })
    flushSync()
    expect(one.transactions()).toBe(1)
    expect(two.transactions()).toBe(1)
  })
})
