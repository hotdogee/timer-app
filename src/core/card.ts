/**
 * Card list model: the cards on the grid, their order and the one selected card, as a pure
 * immutable value (spec.md › Layout, Card).
 *
 * Same conventions as the timer and stopwatch engines: functions never throw, and an operation
 * that does not apply returns the input list by reference, so `===` detects "nothing changed".
 * Lists and cards are plain JSON data, safe to store in `$state.raw` and replace whole.
 *
 * Selection (spec Q5): every operation here keeps `selectedId` pointing at a card in the list,
 * and a list built only through these operations always has a selected card unless it is empty.
 */

import * as digits from './digit-entry'
import * as stopwatch from './stopwatch'
import * as timer from './timer'
import type { DigitBuffer, EpochMs, Ms, StopwatchState, TimerState } from './types'

/** A card's identity: unique within a list, stable for the card's life (and across devices). */
export type CardId = string

/** What a card is. Fixed when the card is created (spec Q2). */
export type CardKind = 'timer' | 'stopwatch'

/** What every card has, whatever its kind. */
export interface CardBase {
  readonly id: CardId
  readonly kind: CardKind
  /** Shown in the header. Never empty and never padded with whitespace. */
  readonly name: string
  /** When the card was created. */
  readonly createdAt: EpochMs
  /** Whether the card's alarm is silenced. */
  readonly muted: boolean
  /**
   * The emoji the header shows in place of the kind's icon ({@link isCardIcon}); absent for the
   * kind's default icon. Never stored as `undefined`: a card without an icon has no such key.
   */
  readonly icon?: string
}

export type TimerCard = CardBase & { readonly kind: 'timer'; readonly timer: TimerState }
export type StopwatchCard = CardBase & {
  readonly kind: 'stopwatch'
  readonly stopwatch: StopwatchState
}
export type Card = TimerCard | StopwatchCard

/** The cards in grid order and the selected card's id, or `null` when there is no card. */
export interface CardList {
  readonly cards: readonly Card[]
  readonly selectedId: CardId | null
}

/** A grid direction for {@link neighborIndex}, {@link selectNeighbor} and {@link moveNeighbor}. */
export type Direction = 'left' | 'right' | 'up' | 'down'

/** A list with no cards and nothing selected. Frozen; shared by every caller. */
export const EMPTY_LIST: CardList = Object.freeze({ cards: Object.freeze([]), selectedId: null })

/** The duration of a new timer: 5:00 (spec › Layout). */
export const DEFAULT_TIMER_DURATION: Ms = 5 * 60_000

/** The base of the default names: "Timer", "Timer 2", … and "Stopwatch", "Stopwatch 2", … */
export const DEFAULT_NAMES: Readonly<Record<CardKind, string>> = Object.freeze({
  timer: 'Timer',
  stopwatch: 'Stopwatch',
})

/** A clock reading made storable: a non-finite one (NaN, ±Infinity) becomes 0. */
function finiteTime(at: EpochMs): EpochMs {
  return Number.isFinite(at) ? at : 0
}

/**
 * A card name made usable, as every card keeps it: trimmed, and the kind's default name ("Timer")
 * when nothing is left or it is not a string (stored or imported data).
 */
export function cardName(name: unknown, kind: CardKind): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed === '' ? DEFAULT_NAMES[kind] : trimmed
}

/**
 * The longest card icon, in UTF-16 code units: room for the longest emoji sequences (a family
 * with skin tones, a subdivision flag such as England's), but not for a paragraph of them.
 */
export const MAX_ICON_LENGTH = 32

/** The characters an emoji is made of, joiners, variation selectors, keycaps and tags included. */
const ICON_CHARS = /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{Regional_Indicator}]+$/u

/**
 * What makes those characters an emoji rather than a bare component: a pictograph, a flag's
 * regional indicator, or a keycap (`1️⃣` is a digit, VS16 and U+20E3).
 */
const ICON_BASE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u

/**
 * Whether `value` can be a card's icon: a non-empty string of at most {@link MAX_ICON_LENGTH}
 * code units made only of emoji characters, with at least one that draws something. Text
 * (`"abc"`, blanks) and lone components (a skin tone, a joiner, `#`) are not icons. This is a
 * check on the characters, not on Unicode's list of sequences: stored, synced and imported icons
 * pass through it, and an emoji newer than this code still has to get through.
 */
export function isCardIcon(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ICON_LENGTH &&
    ICON_CHARS.test(value) &&
    ICON_BASE.test(value)
  )
}

/**
 * An index made usable for inserting into a list of `length` items: truncated and clamped into
 * [0, length]. A missing or NaN index appends.
 */
function insertionIndex(index: number | undefined, length: number): number {
  if (index === undefined || Number.isNaN(index)) return length
  return Math.min(length, Math.max(0, Math.trunc(index)))
}

/** The position of card `id` in the list, or -1. */
function indexOf(list: CardList, id: CardId): number {
  return list.cards.findIndex((card) => card.id === id)
}

/** The list with the card at `index` replaced by `card`, keeping the selection. */
function replaceAt(list: CardList, index: number, card: Card): CardList {
  const cards = list.cards.slice()
  cards[index] = card
  return { cards, selectedId: list.selectedId }
}

/**
 * Creates an unmuted timer card, idle at `duration` (5:00 by default; invalid durations become 0
 * as in `timer.createTimer`). The name is trimmed and falls back to "Timer" when blank; a
 * non-finite `createdAt` becomes 0.
 */
export function createTimerCard(
  id: CardId,
  name: string,
  createdAt: EpochMs,
  duration: Ms = DEFAULT_TIMER_DURATION,
): TimerCard {
  return {
    id,
    kind: 'timer',
    name: cardName(name, 'timer'),
    createdAt: finiteTime(createdAt),
    muted: false,
    timer: timer.createTimer(duration),
  }
}

/**
 * Creates an unmuted, idle stopwatch card. The name is trimmed and falls back to "Stopwatch" when
 * blank; a non-finite `createdAt` becomes 0.
 */
export function createStopwatchCard(id: CardId, name: string, createdAt: EpochMs): StopwatchCard {
  return {
    id,
    kind: 'stopwatch',
    name: cardName(name, 'stopwatch'),
    createdAt: finiteTime(createdAt),
    muted: false,
    stopwatch: stopwatch.createStopwatch(),
  }
}

/**
 * The name for a new card of `kind`: `base` ("Timer" or "Stopwatch" by default) if no card has
 * that name, else `base 2`, `base 3`, … with the smallest number no card uses. Numbering follows
 * the names in the list, whatever the cards' kinds, so a renamed card frees its number and a
 * name the user typed is never duplicated. Names compare trimmed and case-insensitively. Pass a
 * preset's name as `base` to number it the same way ("Tea", "Tea 2"); a blank `base` uses the
 * default.
 */
export function nextDefaultName(list: CardList, kind: CardKind, base?: string): string {
  const name = cardName(base ?? '', kind)
  const taken = new Set(list.cards.map((card) => card.name.trim().toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  // n reaches at most cards.length + 1: each card can take only one of the numbered names.
  for (let n = 2; ; n++) {
    const numbered = `${name} ${n}`
    if (!taken.has(numbered.toLowerCase())) return numbered
  }
}

/**
 * Adds `card` and selects it. Appends by default; `index` inserts there instead, clamped into
 * [0, length] (NaN appends). A card whose id is already in the list returns `list` unchanged.
 */
export function addCard(list: CardList, card: Card, index?: number): CardList {
  if (indexOf(list, card.id) >= 0) return list
  const cards = list.cards.slice()
  cards.splice(insertionIndex(index, cards.length), 0, card)
  return { cards, selectedId: card.id }
}

/**
 * Removes card `id`. When it was selected, the selection moves to the next card (the one that
 * takes its place), else the previous card, else `null`; otherwise the selection stays. An
 * unknown id returns `list` unchanged.
 */
export function removeCard(list: CardList, id: CardId): CardList {
  const index = indexOf(list, id)
  if (index < 0) return list
  const cards = list.cards.filter((card) => card.id !== id)
  if (list.selectedId !== id) return { cards, selectedId: list.selectedId }
  const neighbor = cards[index] ?? cards[index - 1]
  return { cards, selectedId: neighbor?.id ?? null }
}

/** A trailing " 2", " 3", … on a name, as default and preset names are numbered. */
const NUMBER_SUFFIX = /^(.*\S)\s+\d+$/

/**
 * `name` if no card in the list has it (compared trimmed and case-insensitively), else the
 * smallest free numbering of its base: a taken "Timer 2" becomes "Timer 3" or later, the same as
 * {@link nextDefaultName} would pick for "Timer". Used when a card comes back (undo delete) after
 * another card took its name.
 */
export function uniqueName(list: CardList, kind: CardKind, name: string): string {
  const wanted = cardName(name, kind)
  const taken = list.cards.some((card) => card.name.trim().toLowerCase() === wanted.toLowerCase())
  if (!taken) return wanted
  return nextDefaultName(list, kind, NUMBER_SUFFIX.exec(wanted)?.[1] ?? wanted)
}

/**
 * Puts a removed card back (undo delete) at `index`, clamped into [0, length] so it lands at the
 * end when the list has shrunk since, and selects it. When another card has taken its name in
 * the meantime, the card comes back renumbered ({@link uniqueName}), so no two cards share a
 * name. A card whose id is already in the list returns `list` unchanged.
 */
export function restoreCard(list: CardList, card: Card, index: number): CardList {
  if (indexOf(list, card.id) >= 0) return list
  const name = uniqueName(list, card.kind, card.name)
  return addCard(list, name === card.name ? card : { ...card, name }, index)
}

/**
 * Renames card `id` to `name`, trimmed. A blank name, an unknown id and the same name return
 * `list` unchanged.
 */
export function renameCard(list: CardList, id: CardId, name: string): CardList {
  const index = indexOf(list, id)
  const trimmed = typeof name === 'string' ? name.trim() : ''
  const card = list.cards[index]
  if (card === undefined || trimmed === '' || card.name === trimmed) return list
  return replaceAt(list, index, { ...card, name: trimmed })
}

/**
 * Moves card `id` to position `toIndex` (truncated, then clamped into the list; ±Infinity moves to
 * an end), shifting the cards between. The selection stays. An unknown id, a NaN index and a move
 * to the card's own position return `list` unchanged.
 */
export function moveCard(list: CardList, id: CardId, toIndex: number): CardList {
  const from = indexOf(list, id)
  if (from < 0 || Number.isNaN(toIndex)) return list
  const to = Math.min(list.cards.length - 1, Math.max(0, Math.trunc(toIndex)))
  if (to === from) return list
  const cards = list.cards.slice()
  const [card] = cards.splice(from, 1)
  if (card === undefined) return list
  cards.splice(to, 0, card)
  return { cards, selectedId: list.selectedId }
}

/** Mutes or unmutes card `id`. An unknown id and no change return `list` unchanged. */
export function setMuted(list: CardList, id: CardId, muted: boolean): CardList {
  const index = indexOf(list, id)
  const card = list.cards[index]
  if (card === undefined || card.muted === muted) return list
  return replaceAt(list, index, { ...card, muted })
}

/**
 * Sets card `id`'s icon to the emoji `icon`, or removes it with `null` (the card shows its kind's
 * icon again; the key is deleted, not set to `undefined`). An unknown id, an icon that is not
 * {@link isCardIcon}, and no change return `list` unchanged.
 */
export function setIcon(list: CardList, id: CardId, icon: string | null): CardList {
  const index = indexOf(list, id)
  const card = list.cards[index]
  if (card === undefined || (icon !== null && !isCardIcon(icon))) return list
  if (icon === null) {
    if (card.icon === undefined) return list
    const { icon: removed, ...rest } = card
    void removed
    return replaceAt(list, index, rest)
  }
  return card.icon === icon ? list : replaceAt(list, index, { ...card, icon })
}

/** Selects card `id`. An unknown id and the already selected card return `list` unchanged. */
export function selectCard(list: CardList, id: CardId): CardList {
  if (list.selectedId === id || indexOf(list, id) < 0) return list
  return { cards: list.cards, selectedId: id }
}

/**
 * The index one step from `index` in `direction` on a grid of `columns` columns filled row by row
 * with `count` cards, or `index` itself when there is nowhere to go. Left and right go to the
 * previous and next position, across rows, and stop at the first and last (no wrap). Up and down
 * move one row: up from the first row and down from the last row stay put, and down into a
 * shorter last row lands on its last card. Columns are floored, and fewer than 1 (or NaN) count as
 * 1. An index outside the list is returned unchanged.
 *
 * The one grid geometry for moving the selection (arrow keys) and moving a card (Ctrl+Arrow, the
 * drag handle). Left and right are visual on a left-to-right grid; a right-to-left UI swaps them
 * before calling.
 */
export function neighborIndex(
  index: number,
  count: number,
  direction: Direction,
  columns: number,
): number {
  if (!Number.isInteger(index) || index < 0 || index >= count) return index
  const cols = Math.max(1, Math.floor(columns) || 1)
  const last = count - 1
  switch (direction) {
    case 'left':
      return Math.max(0, index - 1)
    case 'right':
      return Math.min(last, index + 1)
    case 'up':
      return index >= cols ? index - cols : index
    case 'down':
      return Math.floor(index / cols) < Math.floor(last / cols)
        ? Math.min(last, index + cols)
        : index
  }
}

/**
 * Moves the selection one step on a grid of `columns` columns (arrow keys), with the geometry of
 * {@link neighborIndex}. With nothing selected (or a stale selection) the first card is selected.
 * Any move that stays put and an empty list return `list` unchanged.
 */
export function selectNeighbor(list: CardList, direction: Direction, columns: number): CardList {
  const { cards } = list
  const first = cards[0]
  if (first === undefined) return list
  const from = list.selectedId === null ? -1 : indexOf(list, list.selectedId)
  if (from < 0) return { cards, selectedId: first.id }
  const to = neighborIndex(from, cards.length, direction, columns)
  const target = cards[to]
  return target === undefined || to === from ? list : { cards, selectedId: target.id }
}

/**
 * Moves card `id` one step in `direction` on a grid of `columns` columns (Ctrl+Arrow, arrow keys on
 * a drag handle), with the geometry of {@link neighborIndex}. The selection stays. An unknown id
 * and a move that stays put return `list` unchanged.
 */
export function moveNeighbor(
  list: CardList,
  id: CardId,
  direction: Direction,
  columns: number,
): CardList {
  const from = indexOf(list, id)
  if (from < 0) return list
  return moveCard(list, id, neighborIndex(from, list.cards.length, direction, columns))
}

/**
 * Applies `update` to the timer of card `id`. An unknown id, a stopwatch card, and an `update`
 * that returns the same state (as engine no-ops do) return `list` unchanged.
 */
export function updateTimer(
  list: CardList,
  id: CardId,
  update: (t: TimerState) => TimerState,
): CardList {
  const index = indexOf(list, id)
  const card = list.cards[index]
  if (card?.kind !== 'timer') return list
  const next = update(card.timer)
  return next === card.timer ? list : replaceAt(list, index, { ...card, timer: next })
}

/**
 * Applies `update` to the stopwatch of card `id`. An unknown id, a timer card, and an `update`
 * that returns the same state return `list` unchanged.
 */
export function updateStopwatch(
  list: CardList,
  id: CardId,
  update: (s: StopwatchState) => StopwatchState,
): CardList {
  const index = indexOf(list, id)
  const card = list.cards[index]
  if (card?.kind !== 'stopwatch') return list
  const next = update(card.stopwatch)
  return next === card.stopwatch ? list : replaceAt(list, index, { ...card, stopwatch: next })
}

/** The card with id `id`, if any. */
export function findCard(list: CardList, id: CardId): Card | undefined {
  return list.cards.find((card) => card.id === id)
}

/** The selected card, if any. */
export function selectedCard(list: CardList): Card | undefined {
  return list.selectedId === null ? undefined : findCard(list, list.selectedId)
}

/**
 * Settles every running timer at `now` (`timer.settle`): those whose end has come start ringing.
 * Called every frame, so it allocates nothing unless a timer changes, and returns `list` unchanged
 * when none does.
 */
export function settleAll(list: CardList, now: EpochMs): CardList {
  let cards: Card[] | null = null
  for (let i = 0; i < list.cards.length; i++) {
    const card = list.cards[i]
    if (card?.kind !== 'timer') continue
    const settled = timer.settle(card.timer, now)
    if (settled === card.timer) continue
    cards ??= list.cards.slice()
    cards[i] = { ...card, timer: settled }
  }
  return cards === null ? list : { cards, selectedId: list.selectedId }
}

/**
 * The earliest end time among running timers, for the background wake-up, or `null` when no
 * timer runs.
 */
export function nextDeadline(list: CardList): EpochMs | null {
  let earliest: EpochMs | null = null
  for (const card of list.cards) {
    if (card.kind !== 'timer' || card.timer.phase !== 'running') continue
    if (earliest === null || card.timer.endsAt < earliest) earliest = card.timer.endsAt
  }
  return earliest
}

/** Whether any card's display changes from frame to frame, so the frame loop must run. */
export function anyNeedsFrames(list: CardList): boolean {
  return list.cards.some((card) =>
    card.kind === 'timer' ? timer.needsFrames(card.timer) : stopwatch.needsFrames(card.stopwatch),
  )
}

/**
 * Applies typed digits to a timer before an action (spec › Digit entry): with digits typed, the
 * timer takes their duration (`timer.setDuration`, which resets a paused or ringing timer and
 * leaves a running one alone); with nothing typed it returns `t` unchanged. The keyboard layer and
 * the card's buttons both call this first, so Start, Space and Enter treat typed digits alike.
 */
export function applyTyped(t: TimerState, typed: DigitBuffer): TimerState {
  return digits.isEmpty(typed) ? t : timer.setDuration(t, digits.toDurationMs(typed))
}

/**
 * Repairs a list from outside the app (persistence, sync, import) so the rules above hold: later
 * cards with an id already seen are dropped, and a missing or stale `selectedId` becomes the first
 * card's id (or `null` when there is no card). A list that already follows the rules is returned
 * unchanged.
 */
export function normalizeList(list: CardList): CardList {
  const seen = new Set<CardId>()
  const unique = list.cards.filter((card) => {
    if (seen.has(card.id)) return false
    seen.add(card.id)
    return true
  })
  const cards = unique.length === list.cards.length ? list.cards : unique
  const selectedId =
    list.selectedId !== null && seen.has(list.selectedId) ? list.selectedId : (cards[0]?.id ?? null)
  return cards === list.cards && selectedId === list.selectedId ? list : { cards, selectedId }
}
