/**
 * The card bridge: mirrors the card store (the app's reactive source of cards) to the synced
 * store's `cards` table and back.
 *
 * - Store → table: an effect on the card list writes, in one transaction, every card whose object
 *   changed since the table last held it (card objects are immutable, so `!==` is the dirty
 *   check), the position of every card whose index changed, and deletes the rows of removed cards.
 *   A card is written as the cells that differ from what the table last held for it, so a rename
 *   and a start made on two devices merge instead of one clobbering the other.
 * - Table → store: a table listener rebuilds the list (sorted by position, then `createdAt`, then
 *   id) and hands it to the card store, keeping the selection when its card still exists. A card
 *   that reads back the same as the store's keeps its object, and a list that reads back the same
 *   is not handed over at all.
 *
 * No echo: the listener skips the bridge's own transactions, and every card it hands over is
 * recorded as what the table holds, so the effect that follows finds nothing to write. The one
 * write a change from elsewhere can cause is a repair: when a merge leaves positions with gaps or
 * ties (two devices added a card at the same place while apart), the cards whose stored position
 * is not their index get it rewritten. Every copy computes the same repair, so it converges in one
 * round. Changes from other tabs, from storage and (in M4) from the sync server all arrive the
 * same way, as table changes. Undo of a delete (`lastRemoved`) stays in the card store's memory: a
 * restored card is written again as a new row.
 *
 * A local change that is not written yet when a table change arrives (both in one task, as when
 * Import replaces the data) is written first, inside that change's transaction (the listener is a
 * TinyBase mutator listener), so neither change is lost.
 *
 * The table wins at bind time: binding replaces the card store's list with the table's.
 */
import { untrack } from 'svelte'

import type { cards } from '../core'
import { cardToRow, cardsFromTable, sameCard, type CardRow } from './schema'
import type { SyncedStore } from './stores'

/** What the bridge needs from the card store (`state/cards.svelte.ts` fits). */
export interface BridgedCardStore {
  readonly list: cards.CardList
  replace(list: cards.CardList): void
}

/** A running bridge. */
export interface CardsBridge {
  /**
   * Writes the list's unwritten changes now instead of when effects next flush, e.g. right after
   * changing cards outside a component (startup).
   */
  flush(): void
  /** Stops mirroring in both directions. Later calls do nothing. */
  stop(): void
}

/** What the table holds for a card, as far as the bridge knows. */
interface Held {
  /** The card object last written to the table or read from it. */
  readonly card: cards.Card
  /** The position its row stores; NaN when the row has none. */
  readonly position: number
}

/**
 * The selection to keep after the list changed under it: the same card when it is still there,
 * else the card that took its place (as a local delete does), else nothing.
 */
function keptSelection(before: cards.CardList, after: readonly cards.Card[]): cards.CardId | null {
  const selected = before.selectedId
  if (selected === null) return null
  if (after.some((card) => card.id === selected)) return selected
  const index = before.cards.findIndex((card) => card.id === selected)
  return after[Math.min(Math.max(index, 0), after.length - 1)]?.id ?? null
}

/**
 * Binds `cardStore` to the `cards` table of `store`: first replaces the card list with the
 * table's, then mirrors changes both ways until stopped. See the module notes.
 */
export function bindCards(cardStore: BridgedCardStore, store: SyncedStore): CardsBridge {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never read reactively
  let held = new Map<cards.CardId, Held>()
  /** Set while the bridge's own transaction runs, so its table listener ignores it. */
  let writing = false
  let stopped = false

  /**
   * Writes `card`, at `index`, as the cells that differ from what the table last held for it
   * (`known`), or as a whole new row when the table held none.
   */
  function writeCard(card: cards.Card, index: number, known: Held | undefined): void {
    const next = cardToRow(card, index)
    if (known === undefined) {
      store.setRow('cards', card.id, next)
      return
    }
    const previous = cardToRow(known.card, known.position)
    for (const cell of Object.keys(next) as (keyof CardRow)[]) {
      const value = next[cell]
      if (value !== undefined && !Object.is(value, previous[cell])) {
        store.setCell('cards', card.id, cell, value)
      }
    }
    for (const cell of Object.keys(previous) as (keyof CardRow)[]) {
      if (!Object.hasOwn(next, cell)) store.delCell('cards', card.id, cell)
    }
  }

  /** Writes what changed in `list` since the table last held it. */
  function write(list: cards.CardList): void {
    if (stopped) return
    const changed: [card: cards.Card, index: number, known: Held | undefined][] = []
    let stillHeld = 0
    for (let index = 0; index < list.cards.length; index++) {
      const card = list.cards[index]
      if (card === undefined) continue
      const known = held.get(card.id)
      if (known !== undefined) stillHeld++
      if (known?.card === card && known.position === index) continue
      changed.push([card, index, known])
    }
    let removed: cards.CardId[] = []
    if (stillHeld < held.size) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
      const ids = new Set(list.cards.map((card) => card.id))
      removed = [...held.keys()].filter((id) => !ids.has(id))
    }
    if (changed.length === 0 && removed.length === 0) return
    writing = true
    try {
      store.transaction(() => {
        for (const [card, index, known] of changed) {
          writeCard(card, index, known)
          held.set(card.id, { card, position: index })
        }
        for (const id of removed) {
          store.delRow('cards', id)
          held.delete(id)
        }
      })
    } finally {
      writing = false
    }
  }

  /**
   * Hands the table's cards to the card store, unless they read back the same. With
   * `writePending`, first writes the local changes not written yet (only allowed in a mutator
   * listener or outside any listener).
   */
  function read(writePending: boolean): void {
    if (writing || stopped) return
    if (writePending) write(untrack(() => cardStore.list))
    const before = untrack(() => cardStore.list)
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
    const mine = new Map(before.cards.map((card) => [card.id, card]))
    const next: cards.Card[] = []
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never read reactively
    const nextHeld = new Map<cards.CardId, Held>()
    let same = true
    for (const { item, position } of cardsFromTable(store.getTable('cards'))) {
      const own = mine.get(item.id)
      const card = own !== undefined && sameCard(own, item) ? own : item
      if (before.cards[next.length] !== card) same = false
      next.push(card)
      nextHeld.set(card.id, { card, position })
    }
    held = nextHeld
    if (same && next.length === before.cards.length) return
    cardStore.replace({ cards: next, selectedId: keptSelection(before, next) })
  }

  read(false)
  const listenerId = store.addTableListener(
    'cards',
    () => {
      read(true)
    },
    true,
  )
  const destroyEffect = $effect.root(() => {
    $effect(() => {
      const list = cardStore.list
      untrack(() => {
        write(list)
      })
    })
  })

  return {
    flush() {
      write(untrack(() => cardStore.list))
    },
    stop() {
      if (stopped) return
      stopped = true
      destroyEffect()
      store.delListener(listenerId)
    },
  }
}
