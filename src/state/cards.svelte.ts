/**
 * The card store: the app's reactive card list. A thin shell around the pure model in
 * `core/card.ts`; every rule lives there, and this module only holds the current list in
 * `$state.raw`, replacing it whole on each change, and reads the clock for actions.
 *
 * Methods read the list untracked, so an effect that calls one (e.g. settling every frame) does
 * not come to depend on the whole list. They write state, so call them from event handlers and
 * effects, never from a template expression or `$derived`.
 *
 * M3 persistence and sync swap the backing by loading with {@link CardStore.replace} and saving
 * {@link CardStore.list} whenever it changes.
 */
import { untrack } from 'svelte'

import {
  cards,
  systemClock,
  type Clock,
  type EpochMs,
  type Ms,
  type StopwatchState,
  type TimerState,
} from '../core'
import { platform } from '../platform'
import { frameClock } from '../ui/frame-clock.svelte'

/** A deleted card and the position it had, kept so the delete can be undone. */
export interface RemovedCard {
  readonly card: cards.Card
  readonly index: number
}

/** The reactive card list and the actions on it. Every getter is reactive. */
export interface CardStore {
  /** The whole list (cards in grid order and the selected id). Replaced whole, never mutated. */
  readonly list: cards.CardList
  /** The cards in grid order; the same array as `list.cards`. */
  readonly cards: readonly cards.Card[]
  /** The selected card; `undefined` only when there are no cards. */
  readonly selected: cards.Card | undefined
  /** The last deleted card and its position, until it is restored or forgotten. */
  readonly lastRemoved: RemovedCard | null
  /**
   * Adds an idle timer (5:00 by default) after the last card, selects it and returns its id. The
   * name defaults to "Timer", "Timer 2", …; a given name (a preset's) is numbered the same way
   * when a card already has it ("Tea", "Tea 2"), and a blank one counts as not given.
   */
  addTimer(duration?: Ms, name?: string): cards.CardId
  /** Adds an idle stopwatch after the last card, selects it and returns its id. Names as above. */
  addStopwatch(name?: string): cards.CardId
  /**
   * Deletes a card, moving the selection to its neighbor, and remembers it in `lastRemoved` for
   * {@link undoRemove}. An unknown id does nothing.
   */
  remove(id: cards.CardId): void
  /**
   * Puts the last deleted card back where it was and selects it, renumbered if another card has
   * taken its name since (`cards.restoreCard`). Returns whether a card came back: false when
   * nothing was deleted, the delete was forgotten or already undone, or a card with its id is in
   * the list again.
   */
  undoRemove(): boolean
  /** Forgets the last deleted card, e.g. when its undo snackbar closes. */
  forgetRemoved(): void
  /** Renames a card; the name is trimmed and a blank one is ignored. */
  rename(id: cards.CardId, name: string): void
  /** Moves a card to `toIndex`, clamped into the list. */
  move(id: cards.CardId, toIndex: number): void
  /**
   * Moves a card one step on a grid of `columns` columns (Ctrl+Arrow, arrow keys on a drag
   * handle); see `cards.moveNeighbor`.
   */
  moveNeighbor(id: cards.CardId, direction: cards.Direction, columns: number): void
  setMuted(id: cards.CardId, muted: boolean): void
  /** Selects a card; an unknown id does nothing. */
  select(id: cards.CardId): void
  /** Moves the selection on a grid of `columns` columns (arrow keys); see `cards.selectNeighbor`. */
  selectNeighbor(direction: cards.Direction, columns: number): void
  /**
   * Runs a timer action: reads the clock once (bumping the frame clock), applies `update` with
   * that `now` to timer `id`, then settles every timer at `now`. Engine transitions fit as they
   * are: `store.timer(id, timer.start)`. An unknown id or a stopwatch changes nothing.
   */
  timer(id: cards.CardId, update: (t: TimerState, now: EpochMs) => TimerState): void
  /** The same for a stopwatch action: `store.stopwatch(id, stopwatch.lap)`. */
  stopwatch(id: cards.CardId, update: (s: StopwatchState, now: EpochMs) => StopwatchState): void
  /** Settles every running timer at `now`: those whose end has come start ringing. */
  settle(now: EpochMs): void
  /**
   * Replaces the whole list, e.g. with one loaded from storage. Repeated ids are dropped and a
   * missing selection goes to the first card (`cards.normalizeList`).
   */
  replace(list: cards.CardList): void
}

/** What the store needs from outside: ids, the time for new cards, and the clock for actions. */
export interface CardStoreDeps {
  /** A new unique id; a duplicate is tolerated (the store derives an unused one from it). */
  readonly newId: () => cards.CardId
  /** Read for each new card's `createdAt`. */
  readonly clock: Clock
  /** Reads the clock for an action and returns that `now` (the app bumps the frame clock). */
  readonly bump: () => EpochMs
}

/** Creates an empty card store. */
export function createCardStore(deps: CardStoreDeps): CardStore {
  let list = $state.raw<cards.CardList>(cards.EMPTY_LIST)
  let lastRemoved = $state.raw<RemovedCard | null>(null)
  const selected = $derived(cards.selectedCard(list))

  /** The current list, without subscribing the caller to it. */
  const current = (): cards.CardList => untrack(() => list)

  /** An id from `deps.newId` that no card in `within` has. */
  function freshId(within: cards.CardList): cards.CardId {
    const id = deps.newId()
    if (cards.findCard(within, id) === undefined) return id
    // A clash means a broken id source; a suffix still gives a usable, unique id.
    for (let n = 2; ; n++) {
      const candidate = `${id}-${n}`
      if (cards.findCard(within, candidate) === undefined) return candidate
    }
  }

  return {
    get list() {
      return list
    },
    get cards() {
      return list.cards
    },
    get selected() {
      return selected
    },
    get lastRemoved() {
      return lastRemoved
    },
    addTimer(duration, name) {
      const before = current()
      const id = freshId(before)
      const label = cards.nextDefaultName(before, 'timer', name)
      list = cards.addCard(before, cards.createTimerCard(id, label, deps.clock(), duration))
      return id
    },
    addStopwatch(name) {
      const before = current()
      const id = freshId(before)
      const label = cards.nextDefaultName(before, 'stopwatch', name)
      list = cards.addCard(before, cards.createStopwatchCard(id, label, deps.clock()))
      return id
    },
    remove(id) {
      const before = current()
      const index = before.cards.findIndex((card) => card.id === id)
      const card = before.cards[index]
      if (card === undefined) return
      lastRemoved = { card, index }
      list = cards.removeCard(before, id)
    },
    undoRemove() {
      const removed = untrack(() => lastRemoved)
      if (removed === null) return false
      lastRemoved = null
      const before = current()
      list = cards.restoreCard(before, removed.card, removed.index)
      return untrack(() => list) !== before
    },
    forgetRemoved() {
      lastRemoved = null
    },
    rename(id, name) {
      list = cards.renameCard(current(), id, name)
    },
    move(id, toIndex) {
      list = cards.moveCard(current(), id, toIndex)
    },
    moveNeighbor(id, direction, columns) {
      list = cards.moveNeighbor(current(), id, direction, columns)
    },
    setMuted(id, muted) {
      list = cards.setMuted(current(), id, muted)
    },
    select(id) {
      list = cards.selectCard(current(), id)
    },
    selectNeighbor(direction, columns) {
      list = cards.selectNeighbor(current(), direction, columns)
    },
    timer(id, update) {
      const now = deps.bump()
      const updated = cards.updateTimer(current(), id, (t) => update(t, now))
      list = cards.settleAll(updated, now)
    },
    stopwatch(id, update) {
      const now = deps.bump()
      const updated = cards.updateStopwatch(current(), id, (s) => update(s, now))
      list = cards.settleAll(updated, now)
    },
    settle(now) {
      list = cards.settleAll(current(), now)
    },
    replace(next) {
      list = cards.normalizeList(next)
    },
  }
}

/**
 * The app's card store: ids from the platform, `createdAt` from the system clock, and actions
 * timed by the shared frame clock. It starts as on first run (spec): one selected 5:00 "Timer".
 */
export const cardStore: CardStore = createCardStore({
  newId: () => platform.ids.newId(),
  clock: systemClock,
  bump: () => {
    frameClock.bump()
    return untrack(() => frameClock.now)
  },
})
cardStore.addTimer()
